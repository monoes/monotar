import { describe, expect, it, vi } from "vitest";
import { ConversationOrchestrator } from "./conversation-orchestrator";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";
import type { ServerMessage } from "@monotar/contracts";
import type { LlmEvent, LlmRequest, LLMProvider } from "./providers";

/** Mimics a real provider (e.g. OpenAILLMProvider) that throws on abort instead of returning cleanly. */
class AbortThrowingLLM implements LLMProvider {
  async *streamChat(_request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmEvent> {
    yield { type: "token", text: "partial " };
    await new Promise<void>((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }
}

class FailingLLM implements LLMProvider {
  // eslint-disable-next-line require-yield -- always throws before any yield point
  async *streamChat(): AsyncIterable<LlmEvent> {
    throw new Error("upstream exploded");
  }
}

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

    const states = sent
      .filter((m): m is Extract<ServerMessage, { type: "state" }> => m.type === "state")
      .map((m) => m.state);
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
    const states = sent
      .filter((m): m is Extract<ServerMessage, { type: "state" }> => m.type === "state")
      .map((m) => m.state);
    expect(states).toContain("INTERRUPTING");
    vi.useRealTimers();
  });

  it("interrupting a provider that throws on abort still reaches LISTENING, not ERROR", async () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    const orchestrator = new ConversationOrchestrator({
      stt: new MockSTT(),
      llm: new AbortThrowingLLM(),
      tts: new MockTTS(),
      avatar: new MockAvatarEngine(),
      send: (message) => sent.push(message),
    });

    orchestrator.handleAudioFrame(Buffer.from("frame"));
    await vi.waitFor(() => expect(orchestrator.state).toBe("AI_SPEAKING"));

    await orchestrator.interrupt();
    expect(orchestrator.state).toBe("LISTENING");
    expect(sent.some((m) => m.type === "error")).toBe(false);
    expect(sent.some((m) => m.type === "assistant_text")).toBe(false);
    vi.useRealTimers();
  });

  it("a real turn failure transitions to ERROR and notifies the client", async () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    const orchestrator = new ConversationOrchestrator({
      stt: new MockSTT(),
      llm: new FailingLLM(),
      tts: new MockTTS(),
      avatar: new MockAvatarEngine(),
      send: (message) => sent.push(message),
    });

    orchestrator.handleAudioFrame(Buffer.from("frame"));
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(orchestrator.state).toBe("ERROR"));

    const errorMessage = sent.find((m) => m.type === "error");
    expect(errorMessage).toBeDefined();
    vi.useRealTimers();
  });
});
