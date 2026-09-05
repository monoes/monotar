import { describe, expect, it, vi } from "vitest";
import { ConversationOrchestrator } from "./conversation-orchestrator";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";
import type { ServerMessage } from "@monotar/contracts";

function buildOrchestrator(sent: ServerMessage[]) {
  return new ConversationOrchestrator({
    stt: new MockSTT(),
    llm: new MockLLM(),
    tts: new MockTTS(),
    avatar: new MockAvatarEngine(),
    send: (message) => sent.push(message),
  });
}

describe("ConversationOrchestrator", () => {
  it("starts in LISTENING and sends an initial state message", () => {
    const sent: ServerMessage[] = [];
    const orchestrator = buildOrchestrator(sent);
    expect(orchestrator.state).toBe("LISTENING");
    expect(sent).toEqual([{ type: "state", state: "LISTENING" }]);
  });

  it("runs a full turn from an audio frame through to LISTENING again", async () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    const orchestrator = buildOrchestrator(sent);

    orchestrator.handleAudioFrame(Buffer.from("frame"));
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(orchestrator.state).toBe("LISTENING"));

    const states = sent.filter((m) => m.type === "state").map((m: any) => m.state);
    expect(states).toEqual(["LISTENING", "USER_SPEAKING", "THINKING", "AI_SPEAKING", "LISTENING"]);
    expect(sent.some((m) => m.type === "transcript")).toBe(true);
    expect(sent.some((m) => m.type === "assistant_text")).toBe(true);
    vi.useRealTimers();
  });

  it("interrupt() during AI_SPEAKING transitions through INTERRUPTING back to LISTENING", async () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    const orchestrator = buildOrchestrator(sent);

    orchestrator.handleAudioFrame(Buffer.from("frame"));
    await vi.waitFor(() => expect(orchestrator.state).toBe("AI_SPEAKING"));

    await orchestrator.interrupt();
    expect(orchestrator.state).toBe("LISTENING");
    const states = sent.filter((m) => m.type === "state").map((m: any) => m.state);
    expect(states).toContain("INTERRUPTING");
    vi.useRealTimers();
  });
});
