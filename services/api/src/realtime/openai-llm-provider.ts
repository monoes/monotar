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

      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.replace(/^data: /, "").trim();
        if (!trimmed) continue;
        if (trimmed === "[DONE]") {
          yield { type: "done" };
          return;
        }
        const parsed = JSON.parse(trimmed) as { choices: { delta: { content?: string } }[] };
        const text = parsed.choices[0]?.delta?.content;
        if (text) {
          yield { type: "token", text };
        }
      }
    }
  }
}
