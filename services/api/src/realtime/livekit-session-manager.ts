import { AccessToken } from "livekit-server-sdk";

export interface LiveKitSessionManagerConfig {
  apiKey: string;
  secretValue: string;
}

export class LiveKitSessionManager {
  constructor(private config: LiveKitSessionManagerConfig) {}

  async createToken(roomName: string, identity: string): Promise<string> {
    const token = new AccessToken(this.config.apiKey, this.config.secretValue, { identity });
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
    return token.toJwt();
  }
}
