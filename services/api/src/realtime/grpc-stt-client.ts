import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import type { SpeechToTextProvider, SttEvent, SttSession, SttSessionConfig } from "./providers";

const PROTO_PATH = path.resolve(__dirname, "../../../../packages/stt-proto/stt.proto");

interface SttServiceClient extends grpc.Client {
  StreamTranscribe(): grpc.ClientDuplexStream<{ pcm16_data: Buffer; sample_rate: number }, { type: string; text: string }>;
}

interface SttServiceConstructor {
  new (address: string, credentials: grpc.ChannelCredentials): SttServiceClient;
}

interface SttServiceDefinition {
  monotar: { stt: { SttService: SttServiceConstructor } };
}

// Loaded once per process: proto parsing/reflection is pure I/O + CPU work that
// doesn't depend on the target address, so there's no reason to redo it for
// every session.
let cachedServiceConstructor: SttServiceConstructor | null = null;

function getSttServiceConstructor(): SttServiceConstructor {
  if (!cachedServiceConstructor) {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, { keepCase: true });
    const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as SttServiceDefinition;
    cachedServiceConstructor = proto.monotar.stt.SttService;
  }
  return cachedServiceConstructor;
}

function loadSttServiceClient(grpcUrl: string): SttServiceClient {
  const SttService = getSttServiceConstructor();
  return new SttService(grpcUrl, grpc.credentials.createInsecure());
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
    stream.on("error", (err: Error) => {
      // Not a reconnect strategy — just making a previously-silent failure
      // observable. A dropped STT stream currently has no recovery path;
      // the session is effectively dead until the client tears it down.
      console.error("[GrpcSttClient] STT stream error:", err);
    });

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
