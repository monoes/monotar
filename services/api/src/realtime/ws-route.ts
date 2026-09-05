import type { FastifyInstance } from "fastify";
import type { ClientMessage } from "@monotar/contracts";
import { ClientMessageSchema } from "@monotar/contracts";
import { ConversationOrchestrator } from "./conversation-orchestrator";
import { buildProviders } from "./provider-factory";

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/realtime/:agentId", { websocket: true }, (socket, request) => {
    if (!request.currentUser) {
      socket.close(4401, "unauthenticated");
      return;
    }

    let orchestrator: ConversationOrchestrator;
    let closed = false;

    // Deferred two ticks: constructing immediately can land the orchestrator's initial
    // state message in the same TCP read as the client's WS handshake response, which
    // races the client's "open" handler against its "message" handler (ws's
    // `socket.unshift(head)` replay runs via process.nextTick, which beats a Promise
    // continuation attached from an "open" listener).
    setImmediate(() => setImmediate(() => {
      orchestrator = new ConversationOrchestrator({
        ...buildProviders(),
        send: (message) => socket.send(JSON.stringify(message)),
      });
      // The socket may have closed during the deferred ticks above, before
      // `orchestrator` existed for the close handler below to see and clean up.
      // Without this, that orchestrator's STT/avatar sessions would leak forever.
      if (closed) {
        void orchestrator.end();
      }
    }));

    socket.on("message", async (raw: Buffer) => {
      if (!orchestrator) return;

      let parsed: ClientMessage;
      try {
        parsed = ClientMessageSchema.parse(JSON.parse(raw.toString()));
      } catch {
        socket.send(JSON.stringify({ type: "error", code: "invalid_message", message: "Could not parse message" }));
        return;
      }

      try {
        if (parsed.type === "interrupt") {
          await orchestrator.interrupt();
          return;
        }
        if (parsed.type === "end") {
          await orchestrator.end();
          socket.close(1000, "ended");
        }
      } catch (error) {
        // orchestrator.interrupt()/end() can reject (e.g. the avatar-gateway
        // request they await fails). Left uncaught, this listener's rejected
        // promise becomes an unhandled promise rejection, which by default
        // crashes the whole Node process -- taking down every other active
        // realtime session, not just this one.
        socket.send(
          JSON.stringify({
            type: "error",
            code: "command_failed",
            message: error instanceof Error ? error.message : "Failed to process message",
          }),
        );
      }
    });

    socket.on("close", async () => {
      closed = true;
      if (orchestrator && orchestrator.state !== "ENDED" && orchestrator.state !== "ERROR") {
        await orchestrator.end();
      }
    });
  });
}
