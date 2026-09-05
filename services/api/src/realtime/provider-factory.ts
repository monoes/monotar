import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";
import { GrpcSttClient } from "./grpc-stt-client";
import { OpenAILLMProvider } from "./openai-llm-provider";
import { OpenAITTSProvider } from "./openai-tts-provider";
import { AvatarGatewayClient } from "./avatar-gateway-client";
import type { AvatarEngine, LLMProvider, SpeechToTextProvider, TextToSpeechProvider } from "./providers";

export interface RealtimeProviders {
  stt: SpeechToTextProvider;
  llm: LLMProvider;
  tts: TextToSpeechProvider;
  avatar: AvatarEngine;
}

function readConfiguredValue(name: string): string | undefined {
  return process.env[name];
}

export function buildProviders(): RealtimeProviders {
  const mode = readConfiguredValue("REALTIME_PROVIDER_MODE") ?? "mock";

  if (mode === "mock") {
    return { stt: new MockSTT(), llm: new MockLLM(), tts: new MockTTS(), avatar: new MockAvatarEngine() };
  }

  const requiredEnvVars = ["STT_GRPC_URL", "OPENAI_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LIVETALKING_URL"];
  for (const name of requiredEnvVars) {
    if (!readConfiguredValue(name)) {
      throw new Error(`REALTIME_PROVIDER_MODE=real requires ${name} to be set`);
    }
  }

  const openAiId = readConfiguredValue("OPENAI_API_KEY") as string;
  const llmBaseUrl = readConfiguredValue("LLM_BASE_URL") as string;

  return {
    stt: new GrpcSttClient(readConfiguredValue("STT_GRPC_URL") as string),
    llm: new OpenAILLMProvider({
      baseUrl: llmBaseUrl,
      apiKey: openAiId,
      model: readConfiguredValue("LLM_MODEL") as string,
    }),
    tts: new OpenAITTSProvider({
      baseUrl: llmBaseUrl,
      apiKey: openAiId,
      model: readConfiguredValue("TTS_MODEL") ?? "tts-1",
    }),
    avatar: new AvatarGatewayClient(readConfiguredValue("LIVETALKING_URL") as string, "wav2lip"),
  };
}
