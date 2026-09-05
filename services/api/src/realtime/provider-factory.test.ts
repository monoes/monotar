import { describe, expect, it, afterEach } from "vitest";
import { buildProviders } from "./provider-factory";
import { MockSTT } from "./mock-providers";
import { GrpcSttClient } from "./grpc-stt-client";

describe("buildProviders", () => {
  const originalMode = process.env.REALTIME_PROVIDER_MODE;

  afterEach(() => {
    process.env.REALTIME_PROVIDER_MODE = originalMode;
  });

  it("defaults to mock providers when REALTIME_PROVIDER_MODE is unset", () => {
    delete process.env.REALTIME_PROVIDER_MODE;
    const providers = buildProviders();
    expect(providers.stt).toBeInstanceOf(MockSTT);
  });

  it("builds real providers when REALTIME_PROVIDER_MODE=real", () => {
    process.env.REALTIME_PROVIDER_MODE = "real";
    process.env.STT_GRPC_URL = "127.0.0.1:50051";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.LLM_MODEL = "gpt-4o-mini";
    process.env.AVATAR_GATEWAY_URL = "http://localhost:4100";

    const providers = buildProviders();
    expect(providers.stt).toBeInstanceOf(GrpcSttClient);
  });
});
