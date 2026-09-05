import { z } from "zod";

// Shared validators for the Phase 4-9 realtime provider vars: these are only
// required at runtime when REALTIME_PROVIDER_MODE=real (enforced by
// provider-factory.ts's requiredEnvVars check), so they stay optional here —
// this schema only catches malformed values (empty strings, non-URLs) early.
const optionalString = z.string().min(1).optional();
const optionalUrl = z.string().url().optional();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  APP_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive(),
  MONOES_ISSUER: z.string().url(),
  MONOES_METADATA_URL: z.string().url(),
  MONOES_CLIENT_ID: z.string().min(1),
  MONOES_SCOPES: z.string().min(1),
  MONOES_REDIRECT_URI: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REALTIME_PROVIDER_MODE: z.enum(["mock", "real"]).default("mock"),
  STT_GRPC_URL: optionalString,
  OPENAI_API_KEY: optionalString,
  LLM_BASE_URL: optionalUrl,
  LLM_MODEL: optionalString,
  AVATAR_GATEWAY_URL: optionalUrl,
  LIVEKIT_API_KEY: optionalString,
  LIVEKIT_API_SECRET: optionalString,
  LIVEKIT_URL: optionalUrl,
  TTS_MODEL: optionalString,
});

export interface Env {
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
  appUrl: string;
  apiPort: number;
  monoesIssuer: string;
  monoesMetadataUrl: string;
  monoesClientId: string;
  monoesScopes: string[];
  monoesRedirectUri: string;
  sessionCookieName: string;
  nodeEnv: "development" | "test" | "production";
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const parsed = result.data;
  return {
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    s3Endpoint: parsed.S3_ENDPOINT,
    s3AccessKey: parsed.S3_ACCESS_KEY,
    s3SecretKey: parsed.S3_SECRET_KEY,
    s3Bucket: parsed.S3_BUCKET,
    appUrl: parsed.APP_URL,
    apiPort: parsed.API_PORT,
    monoesIssuer: parsed.MONOES_ISSUER,
    monoesMetadataUrl: parsed.MONOES_METADATA_URL,
    monoesClientId: parsed.MONOES_CLIENT_ID,
    monoesScopes: parsed.MONOES_SCOPES.split(" ").filter(Boolean),
    monoesRedirectUri: parsed.MONOES_REDIRECT_URI,
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    nodeEnv: parsed.NODE_ENV,
  };
}

// A narrower view of the schema for the Phase 4-9 realtime provider vars.
// provider-factory.ts and the livekit route only care about this subset —
// parsing the full envSchema there would force every caller (including their
// unit tests) to also supply unrelated infra vars like DATABASE_URL/S3_*,
// which have nothing to do with building realtime providers.
const realtimeEnvSchema = envSchema.pick({
  REALTIME_PROVIDER_MODE: true,
  STT_GRPC_URL: true,
  OPENAI_API_KEY: true,
  LLM_BASE_URL: true,
  LLM_MODEL: true,
  AVATAR_GATEWAY_URL: true,
  LIVEKIT_API_KEY: true,
  LIVEKIT_API_SECRET: true,
  LIVEKIT_URL: true,
  TTS_MODEL: true,
});

export interface RealtimeEnv {
  realtimeProviderMode: "mock" | "real";
  sttGrpcUrl?: string;
  openaiApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  avatarGatewayUrl?: string;
  livekitApiKey?: string;
  livekitApiSecret?: string;
  livekitUrl?: string;
  ttsModel?: string;
}

export function loadRealtimeEnv(source: Record<string, string | undefined> = process.env): RealtimeEnv {
  const result = realtimeEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const parsed = result.data;
  const { OPENAI_API_KEY, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = parsed;
  return {
    realtimeProviderMode: parsed.REALTIME_PROVIDER_MODE,
    sttGrpcUrl: parsed.STT_GRPC_URL,
    openaiApiKey: OPENAI_API_KEY,
    llmBaseUrl: parsed.LLM_BASE_URL,
    llmModel: parsed.LLM_MODEL,
    avatarGatewayUrl: parsed.AVATAR_GATEWAY_URL,
    livekitApiKey: LIVEKIT_API_KEY,
    livekitApiSecret: LIVEKIT_API_SECRET,
    livekitUrl: parsed.LIVEKIT_URL,
    ttsModel: parsed.TTS_MODEL,
  };
}
