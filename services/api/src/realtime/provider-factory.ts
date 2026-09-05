import { loadRealtimeEnv } from "@monotar/config";
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

export function buildProviders(): RealtimeProviders {
  const env = loadRealtimeEnv();

  if (env.realtimeProviderMode === "mock") {
    return { stt: new MockSTT(), llm: new MockLLM(), tts: new MockTTS(), avatar: new MockAvatarEngine() };
  }

  const requiredEnvVars = {
    STT_GRPC_URL: env.sttGrpcUrl,
    OPENAI_API_KEY: env.openaiApiKey,
    LLM_BASE_URL: env.llmBaseUrl,
    LLM_MODEL: env.llmModel,
    AVATAR_GATEWAY_URL: env.avatarGatewayUrl,
  };
  for (const [name, value] of Object.entries(requiredEnvVars)) {
    if (!value) {
      throw new Error(`REALTIME_PROVIDER_MODE=real requires ${name} to be set`);
    }
  }

  const openAiId = env.openaiApiKey as string;
  const llmBaseUrl = env.llmBaseUrl as string;

  return {
    stt: new GrpcSttClient(env.sttGrpcUrl as string),
    llm: new OpenAILLMProvider({
      baseUrl: llmBaseUrl,
      apiKey: openAiId,
      model: env.llmModel as string,
    }),
    tts: new OpenAITTSProvider({
      baseUrl: llmBaseUrl,
      apiKey: openAiId,
      model: env.ttsModel ?? "tts-1",
    }),
    avatar: new AvatarGatewayClient(env.avatarGatewayUrl as string, "wav2lip"),
  };
}
