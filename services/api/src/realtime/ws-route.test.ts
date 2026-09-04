import { describe, expect, it, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";
import { buildApp } from "../app";
import { prisma } from "../db";
import type { ServerMessage } from "@monotar/contracts";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createLoggedInUser() {
  const user = await prisma.user.create({ data: { email: `ws-${Date.now()}@example.com` } });
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  const sessionValue = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
  });
  const agent = await prisma.avatarAgent.create({
    data: { organizationId: org.id, name: "Bot", systemPrompt: "Be helpful", llmConfig: {}, voiceConfig: {} },
  });
  return { sessionValue, agent };
}

function collectMessages(ws: WebSocket, count: number): Promise<ServerMessage[]> {
  return new Promise((resolve) => {
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()));
      if (messages.length === count) resolve(messages);
    });
  });
}

describe("WS /api/realtime/:agentId", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs a full mock conversation turn and reaches LISTENING again", async () => {
    const { sessionValue, agent } = await createLoggedInUser();
    const app = buildApp();
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/realtime/${agent.id}`, {
      headers: { cookie: `monotar_session=${sessionValue}` },
    });

    await new Promise((resolve) => ws.on("open", resolve));
    const initialState = await collectMessages(ws, 1);
    expect(initialState[0]).toEqual({ type: "state", state: "LISTENING" });

    const turnMessages = collectMessages(ws, 6);
    ws.send(JSON.stringify({ type: "audio_chunk", data: "ZmFrZS1hdWRpbw==" }));
    const messages = await turnMessages;

    const states = messages
      .filter((m): m is Extract<ServerMessage, { type: "state" }> => m.type === "state")
      .map((m) => m.state);
    expect(states).toEqual(["USER_SPEAKING", "THINKING", "AI_SPEAKING", "LISTENING"]);
    expect(messages.some((m) => m.type === "transcript")).toBe(true);
    expect(messages.some((m) => m.type === "assistant_text")).toBe(true);

    ws.close();
    await app.close();
  });

  it("handles interrupt during AI_SPEAKING", async () => {
    const { sessionValue, agent } = await createLoggedInUser();
    const app = buildApp();
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/realtime/${agent.id}`, {
      headers: { cookie: `monotar_session=${sessionValue}` },
    });

    await new Promise((resolve) => ws.on("open", resolve));
    await collectMessages(ws, 1); // initial LISTENING

    let sawAiSpeaking = false;
    const interruptHandled = new Promise<void>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as ServerMessage;
        if (msg.type === "state" && msg.state === "AI_SPEAKING" && !sawAiSpeaking) {
          sawAiSpeaking = true;
          ws.send(JSON.stringify({ type: "interrupt" }));
        }
        if (msg.type === "state" && msg.state === "LISTENING" && sawAiSpeaking) {
          resolve();
        }
      });
    });

    ws.send(JSON.stringify({ type: "audio_chunk", data: "ZmFrZS1hdWRpbw==" }));
    await interruptHandled;

    ws.close();
    await app.close();
  });
});
