import { z } from "zod";

export const RealtimeStateSchema = z.enum([
  "CREATED",
  "CONNECTING",
  "LISTENING",
  "USER_SPEAKING",
  "THINKING",
  "AI_SPEAKING",
  "INTERRUPTING",
  "RECONNECTING",
  "ENDED",
  "ERROR",
]);
export type RealtimeState = z.infer<typeof RealtimeStateSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio_chunk"), data: z.string() }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("end") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: RealtimeStateSchema }),
  z.object({ type: z.literal("transcript"), text: z.string() }),
  z.object({ type: z.literal("assistant_text"), text: z.string() }),
  z.object({ type: z.literal("audio_chunk"), data: z.string() }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
