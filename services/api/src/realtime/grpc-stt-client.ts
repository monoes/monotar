import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import type { SpeechToTextProvider, SttEvent, SttSession, SttSessionConfig } from "./providers";

const PROTO_PATH = path.resolve(__dirname, "../../../../packages/stt-proto/stt.proto");

interface SttServiceClient extends grpc.Client {
  StreamTranscribe(): grpc.ClientDuplexStream<{ pcm16_data: Buffer; sample_rate: number }, { type: string; text: string }>;
}

function loadSttServiceClient(grpcUrl: string): SttServiceClient {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {});
  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  return new proto.monotar.stt.SttService(grpcUrl, grpc.credentials.createInsecure());
}

export class GrpcSttClient implements SpeechToTextProvider {
  constructor(private grpcUrl: string) {}

  createSession(config: SttSessionConfig): SttSession {
    const client = loadSttServiceClient(this.grpcUrl);
    const stream = client.StreamTranscribe();
    let handler: ((event: SttEvent) => void) | null = null;

    stream.on("data", (message: { type: string; text: string }) => {
      handler?.({ type: message.type as SttEvent["type"], text: message.text || undefined });
    });
    stream.on("error", () => {});

    return {
      sendAudio(chunk: Buffer) {
        stream.write({ pcm16_data: chunk, sample_rate: config.sampleRate });
      },
      onEvent(h) {
        handler = h;
      },
      close() {
        stream.end();
        client.close();
      },
    };
  }
}
