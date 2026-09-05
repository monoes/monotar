import { describe, expect, it } from "vitest";
import { LiveKitSessionManager } from "./livekit-session-manager";

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
}

describe("LiveKitSessionManager", () => {
  it("issues a JWT scoped to the given room and identity", async () => {
    const manager = new LiveKitSessionManager({
      apiKey: "test-key",
      secretValue: "test-value-at-least-32-characters-long-ok",
    });
    const jwt = await manager.createToken("room-agent-1", "user-42");
    expect(jwt.split(".")).toHaveLength(3);

    const payload = decodeJwtPayload(jwt) as { sub: string; video: { room: string; roomJoin: boolean } };
    expect(payload.sub).toBe("user-42");
    expect(payload.video.room).toBe("room-agent-1");
    expect(payload.video.roomJoin).toBe(true);
  });
});
