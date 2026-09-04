import { describe, expect, it } from "vitest";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";

describe("Mock providers", () => {
  it("MockSTT returns a canned transcript", async () => {
    const stt = new MockSTT();
    const text = await stt.transcribe(Buffer.from("fake-audio"));
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("MockLLM streams a non-empty reply", async () => {
    const llm = new MockLLM();
    const chunks: string[] = [];
    for await (const chunk of llm.generateReply("hello", [])) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toContain("hello");
  });

  it("MockTTS yields at least one audio buffer", async () => {
    const tts = new MockTTS();
    const buffers: Buffer[] = [];
    for await (const chunk of tts.synthesize("hi there")) {
      buffers.push(chunk);
    }
    expect(buffers.length).toBeGreaterThan(0);
  });

  it("MockAvatarEngine records state changes", () => {
    const engine = new MockAvatarEngine();
    engine.onStateChange("LISTENING");
    engine.onStateChange("AI_SPEAKING");
    expect(engine.receivedStates).toEqual(["LISTENING", "AI_SPEAKING"]);
  });
});
