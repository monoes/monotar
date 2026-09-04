import type { RealtimeState } from "@monotar/contracts";
import type {
  AvatarEngine,
  ConversationTurn,
  LLMProvider,
  SpeechToTextProvider,
  TextToSpeechProvider,
} from "./providers";

export class MockSTT implements SpeechToTextProvider {
  async transcribe(_audioChunk: Buffer): Promise<string> {
    return "hello, this is a mock transcript";
  }
}

export class MockLLM implements LLMProvider {
  async *generateReply(userText: string, _history: ConversationTurn[]): AsyncGenerator<string> {
    const words = `You said: hello ${userText}. This is a mocked reply.`.split(" ");
    for (const word of words) {
      yield `${word} `;
    }
  }
}

export class MockTTS implements TextToSpeechProvider {
  async *synthesize(text: string): AsyncGenerator<Buffer> {
    const chunkCount = Math.max(1, Math.ceil(text.length / 20));
    for (let i = 0; i < chunkCount; i++) {
      yield Buffer.from(`mock-audio-chunk-${i}`);
    }
  }
}

export class MockAvatarEngine implements AvatarEngine {
  receivedStates: RealtimeState[] = [];

  onStateChange(state: RealtimeState): void {
    this.receivedStates.push(state);
  }
}
