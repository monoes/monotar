import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";

vi.mock("@monotar/config", () => ({
  loadEnv: () => ({
    monoesIssuer: "https://monoes.me/api/auth",
    monoesMetadataUrl: "https://monoes.me/api/auth/.well-known/oauth-authorization-server",
    monoesClientId: "test-client-id",
    monoesScopes: ["openid", "profile", "email"],
    monoesRedirectUri: "http://localhost:3000/api/auth/callback/monoes",
    sessionCookieName: "monotar_session",
    nodeEnv: "test",
    apiPort: 4000,
    databaseUrl: "postgresql://placeholder",
    redisUrl: "redis://placeholder",
    s3Endpoint: "http://placeholder",
    s3AccessKey: "placeholder",
    s3SecretKey: "placeholder",
    s3Bucket: "placeholder",
    appUrl: "http://localhost:3000",
  }),
}));

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
