import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../app";
import { startMockMonoesServer, type MockMonoesServer } from "../../test/mock-monoes-server";
import { prisma } from "../db";

vi.mock("@monotar/config", async () => {
  const actual = await vi.importActual<typeof import("@monotar/config")>("@monotar/config");
  return {
    ...actual,
    loadEnv: () => ({
      monoesIssuer: process.env.MOCK_MONOES_URL ?? "https://monoes.me/api/auth",
      monoesMetadataUrl: "https://monoes.me/api/auth/.well-known/oauth-authorization-server",
      monoesClientId: "test-client-id",
      monoesScopes: ["openid", "profile", "email"],
      monoesRedirectUri: "http://localhost:3000/api/auth/callback/monoes",
      sessionCookieName: "monotar_session",
      nodeEnv: "test",
      apiPort: 4000,
      databaseUrl: process.env.DATABASE_URL ?? "postgresql://placeholder",
      redisUrl: "redis://placeholder",
      s3Endpoint: "http://placeholder",
      s3AccessKey: "placeholder",
      s3SecretKey: "placeholder",
      s3Bucket: "placeholder",
      appUrl: "http://localhost:3000",
    }),
  };
});

describe("GET /api/auth/login", () => {
  it("redirects to the MonoES authorize endpoint with PKCE params", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/auth/login" });
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location as string);
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(response.headers["set-cookie"]).toBeDefined();
  });
});

describe("GET /api/auth/callback/monoes", () => {
  let mockMonoes: MockMonoesServer;

  beforeAll(async () => {
    mockMonoes = await startMockMonoesServer();
    process.env.MOCK_MONOES_URL = mockMonoes.url;
  });

  afterAll(async () => {
    await mockMonoes.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
  });

  it("completes login for a new user and sets a session cookie", async () => {
    const app = buildApp();
    const loginResponse = await app.inject({ method: "GET", url: "/api/auth/login" });
    const cookies = loginResponse.cookies;
    const txnCookie = cookies.find((c) => c.name === "monotar_login_txn")!;
    const { state } = JSON.parse(decodeURIComponent(txnCookie.value));

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/api/auth/callback/monoes?code=test-auth-code&state=${state}`,
      cookies: { monotar_login_txn: txnCookie.value },
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe("/dashboard");
    expect(callbackResponse.cookies.find((c) => c.name === "monotar_session")).toBeDefined();

    const user = await prisma.user.findFirst({ where: { email: "user@example.com" } });
    expect(user).not.toBeNull();
    const org = await prisma.organization.findFirst({ where: { members: { some: { userId: user!.id } } } });
    expect(org).not.toBeNull();
  });

  it("rejects a mismatched state", async () => {
    const app = buildApp();
    const loginResponse = await app.inject({ method: "GET", url: "/api/auth/login" });
    const txnCookie = loginResponse.cookies.find((c) => c.name === "monotar_login_txn")!;

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback/monoes?code=test-auth-code&state=wrong-state",
      cookies: { monotar_login_txn: txnCookie.value },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/login?error=invalid_state");
  });

  it("rejects a missing authorization code", async () => {
    const app = buildApp();
    const loginResponse = await app.inject({ method: "GET", url: "/api/auth/login" });
    const txnCookie = loginResponse.cookies.find((c) => c.name === "monotar_login_txn")!;
    const { state } = JSON.parse(decodeURIComponent(txnCookie.value));

    const response = await app.inject({
      method: "GET",
      url: `/api/auth/callback/monoes?state=${state}`,
      cookies: { monotar_login_txn: txnCookie.value },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/login?error=missing_code");
  });

  it("rejects a missing login transaction cookie (expired/reused)", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback/monoes?code=test-auth-code&state=some-state",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/login?error=expired_transaction");
  });
});
