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
    if (event.type === "speech_started" && this.session.state === "LISTENING") {
      this.setState("USER_SPEAKING");
    }
    if (event.type === "final_transcript" && event.text) {
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
    this.history.push({ role: "assistant", content: full });
    this.deps.send({ type: "assistant_text", text: full });
  }

  private async runTurn(): Promise<void> {
    this.setState("THINKING");
    this.llmAbort = new AbortController();
    this.ttsAbort = new AbortController();

    const textStream = this.streamAssistantText(this.llmAbort.signal);
    this.setState("AI_SPEAKING");
    const avatarSession = await this.avatarSessionPromise;
    const audioStream = this.deps.tts.synthesizeStream(textStream, {}, this.ttsAbort.signal);
    await avatarSession.sendAudio(audioStream);

    if (this.session.state === "AI_SPEAKING") {
      this.setState("LISTENING");
    }
  }

  async interrupt(): Promise<void> {
    if (this.session.state !== "AI_SPEAKING") return;
    this.setState("INTERRUPTING");
    this.llmAbort?.abort();
    this.ttsAbort?.abort();
    const avatarSession = await this.avatarSessionPromise;
    await avatarSession.interrupt();
    this.setState("LISTENING");
  }

  async end(): Promise<void> {
    this.setState("ENDED");
    this.sttSession.close();
    const avatarSession = await this.avatarSessionPromise;
    await avatarSession.close();
  }
}
