import type { FastifyInstance } from "fastify";
import type { ClientMessage, ServerMessage, RealtimeState } from "@monotar/contracts";
import { ClientMessageSchema } from "@monotar/contracts";
import { RealtimeSession } from "./session-state-machine";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/realtime/:agentId", { websocket: true }, (socket, request) => {
    if (!request.currentUser) {
      socket.close(4401, "unauthenticated");
      return;
    }

    const session = new RealtimeSession();
    const stt = new MockSTT();
    const llm = new MockLLM();
    const tts = new MockTTS();
    const avatarEngine = new MockAvatarEngine();
    let interrupted = false;

    function send(message: ServerMessage): void {
      socket.send(JSON.stringify(message));
    }

    function setState(next: RealtimeState): void {
      session.transition(next);
      avatarEngine.onStateChange(next);
      send({ type: "state", state: next });
    }

    session.transition("CONNECTING");
    // Deferred two ticks: sending immediately can land in the same TCP read as the
    // client's WS handshake response, which races the client's "open" handler against
    // its "message" handler (ws's `socket.unshift(head)` replay runs via process.nextTick,
    // which beats a Promise continuation attached from an "open" listener).
    setImmediate(() => setImmediate(() => setState("LISTENING")));

    socket.on("message", async (raw: Buffer) => {
      let parsed: ClientMessage;
      try {
        parsed = ClientMessageSchema.parse(JSON.parse(raw.toString()));
      } catch {
        send({ type: "error", code: "invalid_message", message: "Could not parse message" });
        return;
      }

      if (parsed.type === "interrupt") {
        if (session.state === "AI_SPEAKING") {
          interrupted = true;
          setState("INTERRUPTING");
          setState("LISTENING");
        }
        return;
      }

      if (parsed.type === "end") {
        setState("ENDED");
        socket.close(1000, "ended");
        return;
      }

      if (parsed.type === "audio_chunk") {
        interrupted = false;
        setState("USER_SPEAKING");
        const transcript = await stt.transcribe(Buffer.from(parsed.data, "base64"));
        send({ type: "transcript", text: transcript });

        setState("THINKING");
        let assistantText = "";
        for await (const chunk of llm.generateReply(transcript, [])) {
          assistantText += chunk;
        }
        send({ type: "assistant_text", text: assistantText });

        setState("AI_SPEAKING");
        for await (const audioChunk of tts.synthesize(assistantText)) {
          if (interrupted) break;
          send({ type: "audio_chunk", data: audioChunk.toString("base64") });
        }

        if (!interrupted && session.state === "AI_SPEAKING") {
          setState("LISTENING");
        }
      }
    });

    socket.on("close", () => {
      if (session.state !== "ENDED" && session.state !== "ERROR") {
        try {
          setState("ENDED");
        } catch {
          // already terminal from a prior transition; nothing to do
        }
      }
    });
  });
}
