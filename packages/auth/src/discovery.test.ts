import { describe, expect, it, vi } from "vitest";
import { fetchMonoesMetadata, validateMonoesMetadata } from "./discovery";

const sampleMetadata = {
  issuer: "https://monoes.me/api/auth",
  authorization_endpoint: "https://monoes.me/api/auth/oauth2/authorize",
  token_endpoint: "https://monoes.me/api/auth/oauth2/token",
  registration_endpoint: "https://monoes.me/api/auth/oauth2/register",
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
};

describe("fetchMonoesMetadata", () => {
  it("fetches and parses discovery metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleMetadata,
    });
    const metadata = await fetchMonoesMetadata(
      "https://monoes.me/api/auth/.well-known/oauth-authorization-server",
      fetchImpl as unknown as typeof fetch
    );
    expect(metadata.issuer).toBe("https://monoes.me/api/auth");
  });

  it("throws when the response is not ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      fetchMonoesMetadata("https://example.com/meta", fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/discovery/i);
  });
});

describe("validateMonoesMetadata", () => {
  it("passes when issuer matches", () => {
    expect(() => validateMonoesMetadata(sampleMetadata, "https://monoes.me/api/auth", "production")).not.toThrow();
  });

  it("throws in production on issuer mismatch", () => {
    expect(() =>
      validateMonoesMetadata(sampleMetadata, "https://wrong.example.com", "production")
    ).toThrow(/issuer/i);
  });

  it("warns but does not throw in development on issuer mismatch", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      validateMonoesMetadata(sampleMetadata, "https://wrong.example.com", "development")
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
