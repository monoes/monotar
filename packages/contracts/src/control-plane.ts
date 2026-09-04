import { z } from "zod";

export const CreateAvatarAgentSchema = z.object({
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  llmConfig: z.record(z.unknown()),
  voiceConfig: z.record(z.unknown()),
  avatarId: z.string().optional(),
});
export type CreateAvatarAgentInput = z.infer<typeof CreateAvatarAgentSchema>;

export const UpdateAvatarAgentSchema = CreateAvatarAgentSchema.partial();
export type UpdateAvatarAgentInput = z.infer<typeof UpdateAvatarAgentSchema>;

export const AvatarAgentSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  systemPrompt: z.string(),
  llmConfig: z.record(z.unknown()),
  voiceConfig: z.record(z.unknown()),
  avatarId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AvatarAgent = z.infer<typeof AvatarAgentSchema>;

export const CreateAvatarSchema = z.object({
  name: z.string().min(1),
});
export type CreateAvatarInput = z.infer<typeof CreateAvatarSchema>;

export const AvatarStatusSchema = z.enum(["PENDING", "READY", "FAILED"]);

export const AvatarSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
  status: AvatarStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Avatar = z.infer<typeof AvatarSchema>;
