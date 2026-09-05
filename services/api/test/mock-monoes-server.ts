import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export interface MockMonoesServer {
  url: string;
  close: () => Promise<void>;
}

function fakeIdToken(subject: string): string {
  // Matches real MonoES: the id_token carries only auth/identity claims, not email.
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString("base64url");
  return `header.${payload}.signature`;
}

function generateTestOpaqueValue(): string {
  return randomBytes(16).toString("base64url");
}

export async function startMockMonoesServer(): Promise<MockMonoesServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/oauth2/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const target = new URL(redirectUri);
      target.searchParams.set("code", generateTestOpaqueValue());
      target.searchParams.set("state", state);
      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }
    if (url.pathname === "/oauth2/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: generateTestOpaqueValue(),
            id_token: fakeIdToken("test-subject"),
            token_type: "Bearer",
            expires_in: 3600,
          })
        );
      });
      return;
    }
    if (url.pathname === "/oauth2/userinfo" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sub: "test-subject", email: "user@example.com" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
