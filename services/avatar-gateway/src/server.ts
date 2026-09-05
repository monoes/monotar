import { buildApp } from "./app";

const app = buildApp({
  liveTalkingBaseUrl: process.env.LIVETALKING_URL ?? "http://livetalking:8010",
  cudaAvailable: process.env.CUDA_AVAILABLE === "true",
});
const port = Number(process.env.AVATAR_GATEWAY_PORT ?? 4100);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received, shutting down gracefully`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
