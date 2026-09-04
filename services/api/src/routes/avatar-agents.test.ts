import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createUserWithRole(orgName: string, role: "OWNER" | "ADMIN" | "MEMBER") {
  const user = await prisma.user.create({ data: { email: `${orgName}-${role}@example.com` } });
  const org = await prisma.organization.create({ data: { name: orgName } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role } });
  const sessionValue = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
  });
  return { user, org, sessionValue };
}

describe("AvatarAgent CRUD", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.avatarAgent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
  });

  it("ADMIN can create and list within their own org", async () => {
    const { org, sessionValue } = await createUserWithRole("acme", "ADMIN");
    const app = buildApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/avatar-agents",
      cookies: { monotar_session: sessionValue },
      payload: { name: "Bot", systemPrompt: "Be helpful", llmConfig: {}, voiceConfig: {} },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.organizationId).toBe(org.id);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/avatar-agents",
      cookies: { monotar_session: sessionValue },
    });
    expect(listResponse.json()).toHaveLength(1);
  });

  it("MEMBER cannot create (requires ADMIN+)", async () => {
    const { sessionValue } = await createUserWithRole("acme", "MEMBER");
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/avatar-agents",
      cookies: { monotar_session: sessionValue },
      payload: { name: "Bot", systemPrompt: "Be helpful", llmConfig: {}, voiceConfig: {} },
    });
    expect(response.statusCode).toBe(403);
  });

  it("cannot read another organization's AvatarAgents", async () => {
    const { sessionValue: adminSessionValue } = await createUserWithRole("acme", "ADMIN");
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/avatar-agents",
      cookies: { monotar_session: adminSessionValue },
      payload: { name: "Bot", systemPrompt: "Be helpful", llmConfig: {}, voiceConfig: {} },
    });
    const agentId = createResponse.json().id;

    const { sessionValue: otherSessionValue } = await createUserWithRole("globex", "OWNER");
    const getResponse = await app.inject({
      method: "GET",
      url: `/api/avatar-agents/${agentId}`,
      cookies: { monotar_session: otherSessionValue },
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/avatar-agents" });
    expect(response.statusCode).toBe(401);
  });
});
