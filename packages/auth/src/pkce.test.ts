import { describe, expect, it } from "vitest";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce";

describe("PKCE", () => {
  it("generates a verifier of sufficient length with no padding characters", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).not.toMatch(/[+/=]/);
  });

  it("generates a base64url SHA-256 challenge with the correct shape", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is deterministic for the same verifier and differs across verifiers", () => {
    const verifierA = generateCodeVerifier();
    const verifierB = generateCodeVerifier();
    expect(generateCodeChallenge(verifierA)).toBe(generateCodeChallenge(verifierA));
    expect(generateCodeChallenge(verifierA)).not.toBe(generateCodeChallenge(verifierB));
  });
});
