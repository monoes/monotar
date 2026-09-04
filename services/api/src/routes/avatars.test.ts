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

describe("Avatar CRUD", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.avatarAgent.deleteMany();
    await prisma.avatar.deleteMany();
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
  });

  it("ADMIN can create an avatar with PENDING status", async () => {
    const { sessionValue, org } = await createUserWithRole("acme", "ADMIN");
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/avatars",
      cookies: { monotar_session: sessionValue },
      payload: { name: "Default Avatar" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("PENDING");
    expect(body.organizationId).toBe(org.id);
  });

  it("MEMBER cannot create", async () => {
    const { sessionValue } = await createUserWithRole("acme", "MEMBER");
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/avatars",
      cookies: { monotar_session: sessionValue },
      payload: { name: "Default Avatar" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("cannot read another organization's avatars", async () => {
    const { sessionValue: adminSessionValue } = await createUserWithRole("acme", "ADMIN");
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/avatars",
      cookies: { monotar_session: adminSessionValue },
      payload: { name: "Default Avatar" },
    });
    const avatarId = createResponse.json().id;

    const { sessionValue: otherSessionValue } = await createUserWithRole("globex", "OWNER");
    const response = await app.inject({
      method: "GET",
      url: `/api/avatars/${avatarId}`,
      cookies: { monotar_session: otherSessionValue },
    });
    expect(response.statusCode).toBe(404);
  });
});
