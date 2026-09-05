export interface MuseTalkAvailability {
  available: boolean;
  reason?: "cuda_unavailable";
}

export class MuseTalkGate {
  constructor(private hardware: { cudaAvailable: boolean }) {}

  checkAvailable(): MuseTalkAvailability {
    if (!this.hardware.cudaAvailable) {
      return { available: false, reason: "cuda_unavailable" };
    }
    return { available: true };
  }
}
