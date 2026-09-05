import { describe, expect, it, beforeEach, afterAll, beforeAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createLoggedInUser(orgName: string) {
  const user = await prisma.user.create({ data: { email: `livekit-${orgName}-${Date.now()}@example.com` } });
  const org = await prisma.organization.create({ data: { name: orgName } });
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

const ENV_KEYS = ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

describe("GET /api/realtime/livekit-token", () => {
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env[ENV_KEYS[0]] = "test-key";
    process.env[ENV_KEYS[1]] = "test-value-at-least-32-characters-long-ok";
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) process.env[key] = saved[key];
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.avatarAgent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns a token and url for an authenticated user requesting their own org's agent", async () => {
    const { sessionValue, agent } = await createLoggedInUser("acme");
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/realtime/livekit-token?agentId=${agent.id}`,
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.url).toBeDefined();
  });

  it("returns 404 when requesting another organization's agent", async () => {
    const { agent: otherOrgAgent } = await createLoggedInUser("acme");
    const { sessionValue } = await createLoggedInUser("globex");
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/realtime/livekit-token?agentId=${otherOrgAgent.id}`,
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/realtime/livekit-token?agentId=agent-1" });
    expect(response.statusCode).toBe(401);
  });

  it("returns 400 when agentId is missing", async () => {
    const { sessionValue } = await createLoggedInUser("acme");
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/realtime/livekit-token",
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(400);
  });
});
