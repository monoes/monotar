import type { LiveTalkingClient } from "./LiveTalkingClient";

export class LiveTalkingSession {
  constructor(private client: LiveTalkingClient, public readonly sessionId: string) {}

  async sendAudio(chunk: Buffer): Promise<void> {
    await this.client.sendAudioChunk(this.sessionId, chunk);
  }

  async interrupt(): Promise<void> {
    await this.client.interrupt(this.sessionId);
  }

  async close(): Promise<void> {
    await this.client.closeSession(this.sessionId);
  }
}
