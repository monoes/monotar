import type { RealtimeState } from "@monotar/contracts";

export interface SpeechToTextProvider {
  transcribe(audioChunk: Buffer): Promise<string>;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  generateReply(userText: string, history: ConversationTurn[]): AsyncGenerator<string>;
}

export interface TextToSpeechProvider {
  synthesize(text: string): AsyncGenerator<Buffer>;
}

export interface AvatarEngine {
  onStateChange(state: RealtimeState): void;
}
