import { describe, expect, it, vi } from "vitest";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";
import type { SttEvent } from "./providers";

describe("MockSTT", () => {
  it("emits speech_started on the first audio chunk, then a final transcript after silence", async () => {
    vi.useFakeTimers();
    const stt = new MockSTT();
    const session = stt.createSession({ sampleRate: 16000 });
    const events: SttEvent[] = [];
    session.onEvent((e) => events.push(e));

    session.sendAudio(Buffer.from("chunk-1"));
    expect(events).toEqual([{ type: "speech_started" }]);

    await vi.advanceTimersByTimeAsync(20);
    expect(events).toEqual([
      { type: "speech_started" },
      { type: "final_transcript", text: "hello, this is a mock transcript" },
      { type: "speech_ended" },
    ]);
    vi.useRealTimers();
  });
});

describe("MockLLM", () => {
  it("streams tokens then done, and stops early when aborted", async () => {
    const llm = new MockLLM();
    const controller = new AbortController();
    const events = [];
    for await (const event of llm.streamChat({ messages: [{ role: "user", content: "hi" }] }, controller.signal)) {
      events.push(event);
      if (events.length === 2) controller.abort();
    }
    expect(events.length).toBe(2);
    expect(events.every((e) => e.type === "token")).toBe(true);
  });
});

describe("MockTTS", () => {
  async function* textOf(...words: string[]): AsyncIterable<string> {
    for (const w of words) yield w;
  }

  it("yields one audio buffer per input text chunk", async () => {
    const tts = new MockTTS();
    const buffers: Buffer[] = [];
    for await (const chunk of tts.synthesizeStream(textOf("hello", "world"), {})) {
      buffers.push(chunk);
    }
    expect(buffers).toHaveLength(2);
  });

  it("stops yielding once aborted", async () => {
    const tts = new MockTTS();
    const controller = new AbortController();
    controller.abort();
    const buffers: Buffer[] = [];
    for await (const chunk of tts.synthesizeStream(textOf("hello", "world"), {}, controller.signal)) {
      buffers.push(chunk);
    }
    expect(buffers).toHaveLength(0);
  });
});

describe("MockAvatarEngine", () => {
  async function* audioOf(...chunks: string[]): AsyncIterable<Buffer> {
    for (const c of chunks) yield Buffer.from(c);
  }

  it("tracks playback state across sendAudio/interrupt/close", async () => {
    const engine = new MockAvatarEngine();
    const session = await engine.createSession({});
    expect(await session.getPlaybackState()).toBe("idle");

    const sendPromise = session.sendAudio(audioOf("a", "b"));
    await sendPromise;
    expect(await session.getPlaybackState()).toBe("idle");

    await session.interrupt();
    expect(await session.getPlaybackState()).toBe("interrupted");

    await session.close();
    expect(await session.getPlaybackState()).toBe("idle");
  });
});
