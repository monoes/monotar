import { describe, expect, it } from "vitest";
import { MuseTalkGate } from "./MuseTalkGate";

describe("MuseTalkGate", () => {
  it("reports unavailable with a cuda_unavailable reason when no CUDA is detected", () => {
    const gate = new MuseTalkGate({ cudaAvailable: false });
    expect(gate.checkAvailable()).toEqual({ available: false, reason: "cuda_unavailable" });
  });

  it("reports available when CUDA is detected", () => {
    const gate = new MuseTalkGate({ cudaAvailable: true });
    expect(gate.checkAvailable()).toEqual({ available: true });
  });
});
