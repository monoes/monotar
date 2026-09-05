import type { FastifyInstance } from "fastify";
import { loadRealtimeEnv } from "@monotar/config";
import { LiveKitSessionManager } from "../realtime/livekit-session-manager";
import { prisma } from "../db";

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/realtime/livekit-token", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }

    const { agentId } = request.query as { agentId?: string };
    if (!agentId) {
      return reply.code(400).send({ error: "missing_agent_id" });
    }

    const agent = await prisma.avatarAgent.findFirst({
      where: { id: agentId, organizationId: request.currentUser.organizationId },
    });
    if (!agent) {
      return reply.code(404).send({ error: "not_found" });
    }

    const env = loadRealtimeEnv();
    const liveKitId = env.livekitApiKey;
    const liveKitSigning = env.livekitApiSecret;
    if (!liveKitId || !liveKitSigning) {
      return reply.code(500).send({ error: "livekit_not_configured" });
    }

    const manager = new LiveKitSessionManager({ apiKey: liveKitId, secretValue: liveKitSigning });
    const token = await manager.createToken(`agent-${agentId}`, request.currentUser.id);
    return { token, url: env.livekitUrl ?? "ws://localhost:7880" };
  });
}
