import type { TextToSpeechProvider, VoiceConfig } from "./providers";

export interface OpenAITTSProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAITTSProvider implements TextToSpeechProvider {
  constructor(private config: OpenAITTSProviderConfig) {}

  async *synthesizeStream(
    text: AsyncIterable<string>,
    config: VoiceConfig,
    signal?: AbortSignal
  ): AsyncIterable<Buffer> {
    if (signal?.aborted) return;

    let full = "";
    for await (const chunk of text) {
      full += chunk;
    }
    if (signal?.aborted || !full) return;

    const response = await fetch(`${this.config.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.model, input: full, voice: config.voiceId ?? "alloy" }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`OpenAI TTS request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      yield Buffer.from(value);
    }
  }
}
