import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenAITTSProvider } from "./openai-tts-provider";

async function* textOf(...words: string[]): AsyncIterable<string> {
  for (const w of words) yield w;
}

function audioBody(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("OpenAITTSProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins the input text and streams the response body as audio chunks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: audioBody("audio-part-1", "audio-part-2") });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAITTSProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "tts-1" });
    const chunks: Buffer[] = [];
    for await (const chunk of provider.synthesizeStream(textOf("hello", " world"), {})) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.toString())).toEqual(["audio-part-1", "audio-part-2"]);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body).input).toBe("hello world");
  });

  it("yields nothing when the signal is already aborted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: audioBody("audio") }));
    const provider = new OpenAITTSProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "tts-1" });
    const controller = new AbortController();
    controller.abort();
    const chunks: Buffer[] = [];
    for await (const chunk of provider.synthesizeStream(textOf("hello"), {}, controller.signal)) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
  });
});
