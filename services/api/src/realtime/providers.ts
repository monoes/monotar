export type SttEventType = "speech_started" | "partial_transcript" | "final_transcript" | "speech_ended";

export interface SttEvent {
  type: SttEventType;
  text?: string;
}

export interface SttSessionConfig {
  sampleRate: number;
  languageHint?: string;
}

export interface SttSession {
  sendAudio(chunk: Buffer): void;
  onEvent(handler: (event: SttEvent) => void): void;
  close(): void;
}

export interface SpeechToTextProvider {
  createSession(config: SttSessionConfig): SttSession;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: ConversationTurn[];
}

export type LlmEvent = { type: "token"; text: string } | { type: "done" };

export interface LLMProvider {
  streamChat(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmEvent>;
}

export interface VoiceConfig {
  voiceId?: string;
}

export interface TextToSpeechProvider {
  synthesizeStream(
    text: AsyncIterable<string>,
    config: VoiceConfig,
    signal?: AbortSignal
  ): AsyncIterable<Buffer>;
}

export type PlaybackState = "idle" | "playing" | "interrupted";

export interface AvatarSessionConfig {
  avatarId?: string;
}

export interface AvatarSession {
  id: string;
  sendAudio(audio: AsyncIterable<Buffer>): Promise<void>;
  interrupt(): Promise<void>;
  getPlaybackState(): Promise<PlaybackState>;
  close(): Promise<void>;
}

export interface AvatarEngine {
  createSession(config: AvatarSessionConfig): Promise<AvatarSession>;
}
