import { LiveTalkingClient } from "./LiveTalkingClient";
import { LiveTalkingSession } from "./LiveTalkingSession";

export class LiveTalkingProvider {
  private client: LiveTalkingClient;

  constructor(liveTalkingBaseUrl: string) {
    this.client = new LiveTalkingClient(liveTalkingBaseUrl);
  }

  async createSession(config: { avatarId?: string }): Promise<LiveTalkingSession> {
    const result = await this.client.createSession(config);
    return new LiveTalkingSession(this.client, result.sessionId);
  }

  async health() {
    return this.client.health();
  }
}
