import type { FastifyInstance } from "fastify";
import { LiveKitSessionManager } from "../realtime/livekit-session-manager";

function readConfiguredValue(name: string): string | undefined {
  return process.env[name];
}

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/realtime/livekit-token", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }

    const { agentId } = request.query as { agentId?: string };
    if (!agentId) {
      return reply.code(400).send({ error: "missing_agent_id" });
    }

    const liveKitId = readConfiguredValue("LIVEKIT_API_KEY");
    const liveKitSigning = readConfiguredValue("LIVEKIT_API_SECRET");
    if (!liveKitId || !liveKitSigning) {
      return reply.code(500).send({ error: "livekit_not_configured" });
    }

    const manager = new LiveKitSessionManager({ apiKey: liveKitId, secretValue: liveKitSigning });
    const token = await manager.createToken(`agent-${agentId}`, request.currentUser.id);
    return { token, url: readConfiguredValue("LIVEKIT_URL") ?? "ws://localhost:7880" };
  });
}
