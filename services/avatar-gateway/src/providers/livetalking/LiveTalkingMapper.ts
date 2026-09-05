export interface LiveTalkingHealthResponse {
  engine: string;
  cudaAvailable: boolean;
  status: string;
}

export const LiveTalkingMapper = {
  toWireAudio(chunk: Buffer): string {
    return chunk.toString("base64");
  },

  fromWireHealth(body: unknown): LiveTalkingHealthResponse {
    const parsed = body as Partial<LiveTalkingHealthResponse>;
    if (
      typeof parsed.engine !== "string" ||
      typeof parsed.cudaAvailable !== "boolean" ||
      typeof parsed.status !== "string"
    ) {
      throw new Error("Malformed LiveTalking health response");
    }
    return { engine: parsed.engine, cudaAvailable: parsed.cudaAvailable, status: parsed.status };
  },
};
