import type {
  AvatarEngine,
  AvatarSession,
  AvatarSessionConfig,
  LlmEvent,
  LlmRequest,
  LLMProvider,
  PlaybackState,
  SpeechToTextProvider,
  SttEvent,
  SttSession,
  SttSessionConfig,
  TextToSpeechProvider,
  VoiceConfig,
} from "./providers";

export class MockSTT implements SpeechToTextProvider {
  createSession(_config: SttSessionConfig): SttSession {
    let handler: ((event: SttEvent) => void) | null = null;
    let speaking = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    return {
      sendAudio(_chunk: Buffer) {
        if (!speaking) {
          speaking = true;
          handler?.({ type: "speech_started" });
        }
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (!speaking) return;
          speaking = false;
          handler?.({ type: "final_transcript", text: "hello, this is a mock transcript" });
          handler?.({ type: "speech_ended" });
        }, 10);
      },
      onEvent(h) {
        handler = h;
      },
      close() {
        if (silenceTimer) clearTimeout(silenceTimer);
        speaking = false;
        handler = null;
      },
    };
  }
}

export class MockLLM implements LLMProvider {
  async *streamChat(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmEvent> {
    const last = request.messages[request.messages.length - 1]?.content ?? "";
    const words = `You said: ${last}. This is a mocked reply.`.split(" ");
    for (const word of words) {
      if (signal?.aborted) return;
      yield { type: "token", text: `${word} ` };
    }
    yield { type: "done" };
  }
}

export class MockTTS implements TextToSpeechProvider {
  async *synthesizeStream(
    text: AsyncIterable<string>,
    _config: VoiceConfig,
    signal?: AbortSignal
  ): AsyncIterable<Buffer> {
    let index = 0;
    for await (const _chunk of text) {
      if (signal?.aborted) return;
      yield Buffer.from(`mock-audio-chunk-${index}`);
      index += 1;
    }
  }
}

export class MockAvatarEngine implements AvatarEngine {
  async createSession(_config: AvatarSessionConfig): Promise<AvatarSession> {
    let playback: PlaybackState = "idle";
    return {
      id: "mock-avatar-session",
      async sendAudio(audio: AsyncIterable<Buffer>) {
        playback = "playing";
        for await (const _chunk of audio) {
          // mock: drain the stream, no real playback
        }
        if (playback === "playing") playback = "idle";
      },
      async interrupt() {
        playback = "interrupted";
      },
      async getPlaybackState() {
        return playback;
      },
      async close() {
        playback = "idle";
      },
    };
  }
}
