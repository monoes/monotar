import { z } from "zod";

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
