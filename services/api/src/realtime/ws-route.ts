import type { FastifyInstance } from "fastify";
import type { ClientMessage } from "@monotar/contracts";
import { ClientMessageSchema } from "@monotar/contracts";
import { ConversationOrchestrator } from "./conversation-orchestrator";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/realtime/:agentId", { websocket: true }, (socket, request) => {
    if (!request.currentUser) {
      socket.close(4401, "unauthenticated");
      return;
    }

    let orchestrator: ConversationOrchestrator;

    // Deferred two ticks: constructing immediately can land the orchestrator's initial
    // state message in the same TCP read as the client's WS handshake response, which
    // races the client's "open" handler against its "message" handler (ws's
    // `socket.unshift(head)` replay runs via process.nextTick, which beats a Promise
    // continuation attached from an "open" listener).
    setImmediate(() => setImmediate(() => {
      orchestrator = new ConversationOrchestrator({
        stt: new MockSTT(),
        llm: new MockLLM(),
        tts: new MockTTS(),
        avatar: new MockAvatarEngine(),
        send: (message) => socket.send(JSON.stringify(message)),
      });
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

      if (parsed.type === "interrupt") {
        await orchestrator.interrupt();
        return;
      }
      if (parsed.type === "end") {
        await orchestrator.end();
        socket.close(1000, "ended");
      }
    });

    socket.on("close", async () => {
      if (orchestrator && orchestrator.state !== "ENDED" && orchestrator.state !== "ERROR") {
        await orchestrator.end();
      }
    });
  });
}
