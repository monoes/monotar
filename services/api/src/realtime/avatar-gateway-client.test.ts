import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AvatarGatewayClient } from "./avatar-gateway-client";

async function* audioOf(...chunks: string[]): AsyncIterable<Buffer> {
  for (const c of chunks) yield Buffer.from(c);
}

function startFakeGateway(): Promise<{ url: string; audioCalls: string[]; close: () => Promise<void> }> {
  const audioCalls: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/avatar-sessions" && req.method === "POST") {
        res.writeHead(201);
        res.end(JSON.stringify({ id: "session-abc" }));
        return;
      }
      if (req.url === "/avatar-sessions/session-abc/audio" && req.method === "POST") {
        audioCalls.push(JSON.parse(body).audioBase64);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/avatar-sessions/session-abc/interrupt" && req.method === "POST") {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/avatar-sessions/session-abc" && req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        audioCalls,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("AvatarGatewayClient", () => {
  let fakeGateway: Awaited<ReturnType<typeof startFakeGateway>>;

  afterEach(async () => {
    await fakeGateway.close();
  });

  it("creates a session, sends audio, tracks playback state, interrupts, and closes", async () => {
    fakeGateway = await startFakeGateway();
    const client = new AvatarGatewayClient(fakeGateway.url, "wav2lip");
    const session = await client.createSession({ avatarId: "agent-1" });

    expect(session.id).toBe("session-abc");
    expect(await session.getPlaybackState()).toBe("idle");

    await session.sendAudio(audioOf("chunk-a", "chunk-b"));
    expect(fakeGateway.audioCalls).toHaveLength(2);
    expect(await session.getPlaybackState()).toBe("idle");

    await session.interrupt();
    expect(await session.getPlaybackState()).toBe("interrupted");

    await session.close();
  });
});
