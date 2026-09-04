import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("session plugin and auth routes", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createLoggedInUser() {
    const user = await prisma.user.create({ data: { email: "me@example.com" } });
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
    const sessionValue = randomBytes(32).toString("base64url");
    await prisma.session.create({
      data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
    });
    return { user, org, sessionValue };
  }

  it("GET /api/auth/session returns false when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(response.json()).toEqual({ authenticated: false });
  });

  it("GET /api/auth/me returns 401 when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("GET /api/auth/me returns the current user when a valid session cookie is present", async () => {
    const { user, org, sessionValue } = await createLoggedInUser();
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: user.id, email: "me@example.com", organizationId: org.id, role: "OWNER" });
  });

  it("POST /api/auth/logout revokes the session", async () => {
    const { sessionValue } = await createLoggedInUser();
    const app = buildApp();
    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { monotar_session: sessionValue },
    });
    expect(logoutResponse.json()).toEqual({ success: true });

    const meResponse = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { monotar_session: sessionValue } });
    expect(meResponse.statusCode).toBe(401);
  });
});
