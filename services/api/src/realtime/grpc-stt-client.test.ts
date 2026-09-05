import { describe, expect, it, afterAll } from "vitest";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { GrpcSttClient } from "./grpc-stt-client";
import type { SttEvent } from "./providers";

const PROTO_PATH = path.resolve(__dirname, "../../../../packages/stt-proto/stt.proto");

function startFakeSttServer(): Promise<{ url: string; close: () => void }> {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {});
  const proto = grpc.loadPackageDefinition(packageDefinition) as any;

  const server = new grpc.Server();
  server.addService(proto.monotar.stt.SttService.service, {
    StreamTranscribe: (call: grpc.ServerDuplexStream<any, any>) => {
      let frameCount = 0;
      call.on("data", () => {
        frameCount += 1;
        if (frameCount === 1) {
          call.write({ type: "speech_started", text: "" });
        }
        if (frameCount === 2) {
          call.write({ type: "final_transcript", text: "hello from fake grpc server" });
          call.write({ type: "speech_ended", text: "" });
        }
      });
      call.on("end", () => call.end());
    },
  });

  return new Promise((resolve) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (_err, port) => {
      resolve({ url: `127.0.0.1:${port}`, close: () => server.forceShutdown() });
    });
  });
}

describe("GrpcSttClient", () => {
  it("forwards audio and surfaces transcript events from the gRPC stream", async () => {
    const fakeServer = await startFakeSttServer();
    const client = new GrpcSttClient(fakeServer.url);
    const session = client.createSession({ sampleRate: 16000 });

    const events: SttEvent[] = [];
    const gotFinal = new Promise<void>((resolve) => {
      session.onEvent((event) => {
        events.push(event);
        if (event.type === "speech_ended") resolve();
      });
    });

    session.sendAudio(Buffer.from([0, 0]));
    session.sendAudio(Buffer.from([0, 0]));
    await gotFinal;

    expect(events.map((e) => e.type)).toEqual(["speech_started", "final_transcript", "speech_ended"]);
    expect(events[1].text).toBe("hello from fake grpc server");

    session.close();
    fakeServer.close();
  });
});
