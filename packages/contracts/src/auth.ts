import { z } from "zod";

export const OrganizationRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

export const MeResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  organizationId: z.string(),
  role: OrganizationRoleSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
