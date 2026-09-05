import type { RealtimeState, ServerMessage } from "@monotar/contracts";
import { RealtimeSession } from "./session-state-machine";
import type {
  AvatarEngine,
  AvatarSession,
  ConversationTurn,
  LLMProvider,
  SpeechToTextProvider,
  SttEvent,
  SttSession,
  TextToSpeechProvider,
} from "./providers";

export interface OrchestratorDeps {
  stt: SpeechToTextProvider;
  llm: LLMProvider;
  tts: TextToSpeechProvider;
  avatar: AvatarEngine;
  send: (message: ServerMessage) => void;
}

export class ConversationOrchestrator {
  private session = new RealtimeSession();
  private sttSession: SttSession;
  private avatarSessionPromise: Promise<AvatarSession>;
  private llmAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private history: ConversationTurn[] = [];
  private turnEpoch = 0;

  constructor(private deps: OrchestratorDeps) {
    this.sttSession = deps.stt.createSession({ sampleRate: 16000 });
    this.avatarSessionPromise = deps.avatar.createSession({});
    this.sttSession.onEvent((event) => this.handleSttEvent(event));
    this.session.transition("CONNECTING");
    this.setState("LISTENING");
  }

  get state(): RealtimeState {
    return this.session.state;
  }

  handleAudioFrame(chunk: Buffer): void {
    this.sttSession.sendAudio(chunk);
  }

  private setState(next: RealtimeState): void {
    this.session.transition(next);
    this.deps.send({ type: "state", state: next });
  }

  private handleSttEvent(event: SttEvent): void {
    if (event.type === "speech_started") {
      if (this.session.state === "LISTENING") {
        this.setState("USER_SPEAKING");
      } else if (this.session.state === "AI_SPEAKING") {
        // Barge-in: the user started talking while the assistant was speaking.
        void this.interrupt();
      }
      return;
    }
    if (event.type === "final_transcript" && event.text) {
      if (this.session.state !== "USER_SPEAKING") return;
      this.deps.send({ type: "transcript", text: event.text });
      this.history.push({ role: "user", content: event.text });
      void this.runTurn();
    }
  }

  private async *streamAssistantText(signal: AbortSignal): AsyncIterable<string> {
    let full = "";
    for await (const event of this.deps.llm.streamChat({ messages: this.history }, signal)) {
      if (event.type === "token") {
        full += event.text;
        yield event.text;
      }
    }
    if (signal.aborted) return;
    this.history.push({ role: "assistant", content: full });
    this.deps.send({ type: "assistant_text", text: full });
  }

  private async runTurn(): Promise<void> {
    const epoch = ++this.turnEpoch;
    this.setState("THINKING");
    const llmAbort = new AbortController();
    const ttsAbort = new AbortController();
    this.llmAbort = llmAbort;
    this.ttsAbort = ttsAbort;

    try {
      const textStream = this.streamAssistantText(llmAbort.signal);
      this.setState("AI_SPEAKING");
      const avatarSession = await this.avatarSessionPromise;
      if (epoch !== this.turnEpoch) return;

      const audioStream = this.deps.tts.synthesizeStream(textStream, {}, ttsAbort.signal);
      await avatarSession.sendAudio(audioStream);
      if (epoch !== this.turnEpoch) return;

      if (this.session.state === "AI_SPEAKING") {
        this.setState("LISTENING");
      }
    } catch (error) {
      if (epoch !== this.turnEpoch) return;
      const wasAborted =
        llmAbort.signal.aborted || ttsAbort.signal.aborted || (error instanceof Error && error.name === "AbortError");
      if (wasAborted) return;

      if (this.session.state !== "ENDED" && this.session.state !== "ERROR") {
        this.setState("ERROR");
      }
      this.deps.send({
        type: "error",
        code: "turn_failed",
        message: error instanceof Error ? error.message : "Unknown error during conversation turn",
      });
    }
  }

  async interrupt(): Promise<void> {
    if (this.session.state !== "AI_SPEAKING") return;
    this.turnEpoch += 1;
    this.setState("INTERRUPTING");
    this.llmAbort?.abort();
    this.ttsAbort?.abort();
    const avatarSession = await this.avatarSessionPromise;
    await avatarSession.interrupt();
    this.setState("LISTENING");
  }

  async end(): Promise<void> {
    this.turnEpoch += 1;
    this.setState("ENDED");
    this.sttSession.close();
    const avatarSession = await this.avatarSessionPromise;
    await avatarSession.close();
  }
}
