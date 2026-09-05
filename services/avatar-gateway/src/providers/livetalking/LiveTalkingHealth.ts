import type { LiveTalkingProvider } from "./LiveTalkingProvider";

export async function checkLiveTalkingHealth(provider: LiveTalkingProvider) {
  try {
    return await provider.health();
  } catch {
    return { engine: "unknown", cudaAvailable: false, status: "unreachable" };
  }
}
