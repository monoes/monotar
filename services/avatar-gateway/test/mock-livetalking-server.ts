import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockLiveTalkingServer {
  url: string;
  receivedAudioChunks: string[];
  interruptCalls: number;
  close: () => Promise<void>;
}

export async function startMockLiveTalkingServer(): Promise<MockLiveTalkingServer> {
  const receivedAudioChunks: string[] = [];
  let interruptCalls = 0;

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/sessions" && req.method === "POST") {
        res.writeHead(201);
        res.end(JSON.stringify({ sessionId: "mock-session-1" }));
        return;
      }
      if (req.url?.match(/^\/sessions\/.+\/audio$/) && req.method === "POST") {
        const parsed = JSON.parse(body) as { audioBase64: string };
        receivedAudioChunks.push(parsed.audioBase64);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url?.match(/^\/sessions\/.+\/interrupt$/) && req.method === "POST") {
        interruptCalls += 1;
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url?.match(/^\/sessions\/.+$/) && req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify({ engine: "wav2lip", cudaAvailable: false, status: "ready" }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    receivedAudioChunks,
    get interruptCalls() {
      return interruptCalls;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
