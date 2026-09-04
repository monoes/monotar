import { describe, expect, it } from "vitest";
import { requireRole } from "./rbac";
import type { CurrentUser } from "./plugins/session";

function userWithRole(role: CurrentUser["role"]): CurrentUser {
  return { id: "u1", email: "u1@example.com", organizationId: "org1", role };
}

describe("requireRole", () => {
  it("OWNER satisfies an ADMIN requirement", () => {
    expect(requireRole("ADMIN")(userWithRole("OWNER"))).toBe(true);
  });

  it("MEMBER does not satisfy an ADMIN requirement", () => {
    expect(requireRole("ADMIN")(userWithRole("MEMBER"))).toBe(false);
  });

  it("null user never satisfies any requirement", () => {
    expect(requireRole("MEMBER")(null)).toBe(false);
  });
});
