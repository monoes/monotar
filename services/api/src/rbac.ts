import type { CurrentUser } from "./plugins/session";

const ROLE_RANK: Record<CurrentUser["role"], number> = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

export function requireRole(minRole: CurrentUser["role"]) {
  return (user: CurrentUser | null): boolean => {
    if (!user) return false;
    return ROLE_RANK[user.role] >= ROLE_RANK[minRole];
  };
}
