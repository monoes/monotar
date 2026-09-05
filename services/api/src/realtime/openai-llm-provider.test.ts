import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenAILLMProvider } from "./openai-llm-provider";

function sseBody(...lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n\n"));
      }
      controller.close();
    },
  });
}

describe("OpenAILLMProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams token events parsed from SSE chunks, then done", async () => {
    const body = sseBody(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      "data: [DONE]"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, body })
    );

    const provider = new OpenAILLMProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-4o-mini" });
    const events = [];
    for await (const event of provider.streamChat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "token", text: "Hello" },
      { type: "token", text: " world" },
      { type: "done" },
    ]);
  });

  it("stops iterating once the signal is aborted", async () => {
    const body = sseBody(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      "data: [DONE]"
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body }));

    const provider = new OpenAILLMProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-4o-mini" });
    const controller = new AbortController();
    const events = [];
    for await (const event of provider.streamChat({ messages: [{ role: "user", content: "hi" }] }, controller.signal)) {
      events.push(event);
      if (events.length === 1) controller.abort();
    }
    expect(events).toHaveLength(1);
  });
});
