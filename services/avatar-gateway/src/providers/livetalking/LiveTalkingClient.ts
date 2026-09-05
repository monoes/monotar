import { LiveTalkingMapper, type LiveTalkingHealthResponse } from "./LiveTalkingMapper";

export interface LiveTalkingCreateSessionResult {
  sessionId: string;
}

export class LiveTalkingClient {
  constructor(private baseUrl: string) {}

  async createSession(config: { avatarId?: string }): Promise<LiveTalkingCreateSessionResult> {
    const response = await fetch(`${this.baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`LiveTalking createSession failed with status ${response.status}`);
    }
    return (await response.json()) as LiveTalkingCreateSessionResult;
  }

  async sendAudioChunk(sessionId: string, chunk: Buffer): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: LiveTalkingMapper.toWireAudio(chunk) }),
    });
    if (!response.ok) {
      throw new Error(`LiveTalking sendAudioChunk failed with status ${response.status}`);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/interrupt`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`LiveTalking interrupt failed with status ${response.status}`);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) {
      throw new Error(`LiveTalking closeSession failed with status ${response.status}`);
    }
  }

  async health(): Promise<LiveTalkingHealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`LiveTalking health check failed with status ${response.status}`);
    }
    return LiveTalkingMapper.fromWireHealth(await response.json());
  }
}
