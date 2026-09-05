import type { LlmEvent, LlmRequest, LLMProvider } from "./providers";

export interface OpenAILLMProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAILLMProvider implements LLMProvider {
  constructor(private config: OpenAILLMProviderConfig) {}

  async *streamChat(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmEvent> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.model, messages: request.messages, stream: true }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`OpenAI chat completion request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const dataLines = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.replace(/^data:\s?/, ""));
        if (dataLines.length === 0) continue;
        const trimmed = dataLines.join("\n").trim();
        if (!trimmed) continue;
        if (trimmed === "[DONE]") {
          yield { type: "done" };
          return;
        }
        let parsed: { choices: { delta: { content?: string } }[] };
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Non-JSON or malformed SSE payload (e.g. a stray comment/keep-alive
          // line from a proxy or an OpenAI-compatible gateway) — skip it
          // instead of killing the whole stream.
          continue;
        }
        const text = parsed.choices[0]?.delta?.content;
        if (text) {
          yield { type: "token", text };
        }
      }
    }
  }
}
