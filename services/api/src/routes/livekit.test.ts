import { describe, expect, it, beforeEach, afterAll, beforeAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createLoggedInUser() {
  const user = await prisma.user.create({ data: { email: `livekit-${Date.now()}@example.com` } });
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  const sessionValue = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
  });
  return { sessionValue };
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
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns a token and url for an authenticated user", async () => {
    const { sessionValue } = await createLoggedInUser();
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/realtime/livekit-token?agentId=agent-1",
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.url).toBeDefined();
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/realtime/livekit-token?agentId=agent-1" });
    expect(response.statusCode).toBe(401);
  });

  it("returns 400 when agentId is missing", async () => {
    const { sessionValue } = await createLoggedInUser();
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/realtime/livekit-token",
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(400);
  });
});
