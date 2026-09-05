import type { AvatarEngine, AvatarSession, AvatarSessionConfig, PlaybackState } from "./providers";

export class AvatarGatewayClient implements AvatarEngine {
  constructor(private baseUrl: string, private engine: "wav2lip" | "musetalk") {}

  async createSession(config: AvatarSessionConfig): Promise<AvatarSession> {
    const response = await fetch(`${this.baseUrl}/avatar-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: this.engine, avatarId: config.avatarId }),
    });
    if (!response.ok) {
      throw new Error(`avatar-gateway createSession failed with status ${response.status}`);
    }
    const { id } = (await response.json()) as { id: string };

    let playback: PlaybackState = "idle";
    const baseUrl = this.baseUrl;

    return {
      id,
      async sendAudio(audio: AsyncIterable<Buffer>) {
        playback = "playing";
        for await (const chunk of audio) {
          const response = await fetch(`${baseUrl}/avatar-sessions/${id}/audio`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: chunk.toString("base64") }),
          });
          if (!response.ok) {
            throw new Error(`avatar-gateway sendAudio failed with status ${response.status}`);
          }
        }
        if (playback === "playing") playback = "idle";
      },
      async interrupt() {
        const response = await fetch(`${baseUrl}/avatar-sessions/${id}/interrupt`, { method: "POST" });
        if (!response.ok) {
          throw new Error(`avatar-gateway interrupt failed with status ${response.status}`);
        }
        playback = "interrupted";
      },
      async getPlaybackState() {
        return playback;
      },
      async close() {
        await fetch(`${baseUrl}/avatar-sessions/${id}`, { method: "DELETE" });
        playback = "idle";
      },
    };
  }
}
