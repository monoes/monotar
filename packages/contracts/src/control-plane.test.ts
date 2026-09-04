import { describe, expect, it } from "vitest";
import { CreateAvatarAgentSchema } from "./control-plane";

describe("CreateAvatarAgentSchema", () => {
  it("accepts a valid payload", () => {
    const result = CreateAvatarAgentSchema.safeParse({
      name: "Sales Bot",
      systemPrompt: "You are a helpful sales assistant.",
      llmConfig: { provider: "mock" },
      voiceConfig: { provider: "mock" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = CreateAvatarAgentSchema.safeParse({
      name: "",
      systemPrompt: "x",
      llmConfig: {},
      voiceConfig: {},
    });
    expect(result.success).toBe(false);
  });
});
