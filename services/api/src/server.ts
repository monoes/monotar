import { loadEnv } from "@monotar/config";
import { buildApp } from "./app";
import { prisma } from "./db";

const env = loadEnv();
const app = buildApp();

app
  .listen({ port: env.apiPort, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received, shutting down gracefully`);
  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
