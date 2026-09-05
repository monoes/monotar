import { describe, expect, it, afterEach } from "vitest";
import { buildApp } from "../app";
import { startMockLiveTalkingServer, type MockLiveTalkingServer } from "../../test/mock-livetalking-server";

describe("avatar-sessions routes", () => {
  let mockServer: MockLiveTalkingServer;

  afterEach(async () => {
    await mockServer.close();
  });

  it("creates a wav2lip session, forwards audio, interrupts, and closes it", async () => {
    mockServer = await startMockLiveTalkingServer();
    const app = buildApp({ liveTalkingBaseUrl: mockServer.url, cudaAvailable: false });

    const createResponse = await app.inject({
      method: "POST",
      url: "/avatar-sessions",
      payload: { engine: "wav2lip", avatarId: "agent-1" },
    });
    expect(createResponse.statusCode).toBe(201);
    const { id } = createResponse.json();

    const audioResponse = await app.inject({
      method: "POST",
      url: `/avatar-sessions/${id}/audio`,
      payload: { audioBase64: Buffer.from("hi").toString("base64") },
    });
    expect(audioResponse.statusCode).toBe(200);

    const interruptResponse = await app.inject({ method: "POST", url: `/avatar-sessions/${id}/interrupt` });
    expect(interruptResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({ method: "DELETE", url: `/avatar-sessions/${id}` });
    expect(deleteResponse.statusCode).toBe(204);
  });

  it("rejects musetalk sessions with 503 model_requires_cuda when CUDA is unavailable", async () => {
    mockServer = await startMockLiveTalkingServer();
    const app = buildApp({ liveTalkingBaseUrl: mockServer.url, cudaAvailable: false });

    const response = await app.inject({
      method: "POST",
      url: "/avatar-sessions",
      payload: { engine: "musetalk", avatarId: "agent-1" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "model_requires_cuda" });
  });

  it("reports health", async () => {
    mockServer = await startMockLiveTalkingServer();
    const app = buildApp({ liveTalkingBaseUrl: mockServer.url, cudaAvailable: false });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ engine: "wav2lip", cudaAvailable: false, status: "ready" });
  });
});
