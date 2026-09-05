import { describe, expect, it, afterEach } from "vitest";
import { LiveTalkingClient } from "./LiveTalkingClient";
import { startMockLiveTalkingServer, type MockLiveTalkingServer } from "../../../test/mock-livetalking-server";

describe("LiveTalkingClient", () => {
  let mockServer: MockLiveTalkingServer;

  afterEach(async () => {
    await mockServer.close();
  });

  it("creates a session, sends audio, interrupts, closes, and reports health", async () => {
    mockServer = await startMockLiveTalkingServer();
    const client = new LiveTalkingClient(mockServer.url);

    const session = await client.createSession({ avatarId: "agent-1" });
    expect(session.sessionId).toBe("mock-session-1");

    await client.sendAudioChunk(session.sessionId, Buffer.from("audio-bytes"));
    expect(mockServer.receivedAudioChunks).toHaveLength(1);
    expect(Buffer.from(mockServer.receivedAudioChunks[0], "base64").toString()).toBe("audio-bytes");

    await client.interrupt(session.sessionId);
    expect(mockServer.interruptCalls).toBe(1);

    await client.closeSession(session.sessionId);

    const health = await client.health();
    expect(health).toEqual({ engine: "wav2lip", cudaAvailable: false, status: "ready" });
  });
});
