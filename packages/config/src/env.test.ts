import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const validSource = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "test-access-key-id",
  S3_SECRET_KEY: "test-value",
  S3_BUCKET: "bucket",
  APP_URL: "http://localhost:3000",
  API_PORT: "4000",
  MONOES_ISSUER: "https://monoes.me/api/auth",
  MONOES_METADATA_URL: "https://monoes.me/api/auth/.well-known/oauth-authorization-server",
  MONOES_CLIENT_ID: "test-client-id",
  MONOES_SCOPES: "openid profile email",
  MONOES_REDIRECT_URI: "http://localhost:3000/api/auth/callback/monoes",
  SESSION_COOKIE_NAME: "monotar_session",
  NODE_ENV: "development",
};

describe("loadEnv", () => {
  it("parses a valid environment", () => {
    const env = loadEnv(validSource);
    expect(env.apiPort).toBe(4000);
    expect(env.monoesScopes).toEqual(["openid", "profile", "email"]);
  });

  it("throws when a required field is missing", () => {
    const { DATABASE_URL: _DATABASE_URL, ...rest } = validSource;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
