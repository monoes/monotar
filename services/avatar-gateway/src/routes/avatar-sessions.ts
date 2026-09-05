import type { FastifyInstance } from "fastify";
import { LiveTalkingProvider } from "../providers/livetalking/LiveTalkingProvider";
import { MuseTalkGate } from "../providers/musetalk/MuseTalkGate";

export interface AvatarSessionsConfig {
  liveTalkingBaseUrl: string;
  cudaAvailable: boolean;
}

export async function avatarSessionRoutes(app: FastifyInstance, config: AvatarSessionsConfig): Promise<void> {
  const provider = new LiveTalkingProvider(config.liveTalkingBaseUrl);
  const museTalkGate = new MuseTalkGate({ cudaAvailable: config.cudaAvailable });
  const sessions = new Map<string, Awaited<ReturnType<LiveTalkingProvider["createSession"]>>>();

  app.post("/avatar-sessions", async (request, reply) => {
    const body = request.body as { engine: "wav2lip" | "musetalk"; avatarId?: string };

    if (body.engine === "musetalk") {
      const availability = museTalkGate.checkAvailable();
      if (!availability.available) {
        return reply.code(503).send({ error: "model_requires_cuda" });
      }
    }

    const session = await provider.createSession({ avatarId: body.avatarId });
    sessions.set(session.sessionId, session);
    return reply.code(201).send({ id: session.sessionId });
  });

  app.post("/avatar-sessions/:id/audio", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { audioBase64 } = request.body as { audioBase64: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: "not_found" });
    await session.sendAudio(Buffer.from(audioBase64, "base64"));
    return { ok: true };
  });

  app.post("/avatar-sessions/:id/interrupt", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: "not_found" });
    await session.interrupt();
    return { ok: true };
  });

  app.delete("/avatar-sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: "not_found" });
    try {
      await session.close();
    } finally {
      // Always drop the local entry, even if the upstream close failed:
      // otherwise a session that fails to close cleanly is stuck in this map
      // forever, and every future DELETE for the same id keeps failing.
      sessions.delete(id);
    }
    return reply.code(204).send();
  });

  app.get("/health", async () => {
    return provider.health();
  });
}
