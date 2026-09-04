import { describe, expect, it } from "vitest";
import { generateState } from "./state";

describe("generateState", () => {
  it("generates unique, URL-safe values", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(22);
  });
});
