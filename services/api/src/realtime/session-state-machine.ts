import { EventEmitter } from "node:events";
import type { RealtimeState } from "@monotar/contracts";

export class InvalidTransitionError extends Error {
  constructor(from: RealtimeState, to: RealtimeState) {
    super(`Invalid transition from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

const ALLOWED_TRANSITIONS: Record<RealtimeState, RealtimeState[]> = {
  CREATED: ["CONNECTING", "ERROR"],
  CONNECTING: ["LISTENING", "RECONNECTING", "ERROR", "ENDED"],
  LISTENING: ["USER_SPEAKING", "RECONNECTING", "ENDED", "ERROR"],
  USER_SPEAKING: ["THINKING", "LISTENING", "RECONNECTING", "ENDED", "ERROR"],
  THINKING: ["AI_SPEAKING", "LISTENING", "RECONNECTING", "ENDED", "ERROR"],
  AI_SPEAKING: ["LISTENING", "INTERRUPTING", "RECONNECTING", "ENDED", "ERROR"],
  INTERRUPTING: ["LISTENING", "USER_SPEAKING", "ERROR"],
  RECONNECTING: ["LISTENING", "ENDED", "ERROR"],
  ENDED: [],
  ERROR: ["ENDED"],
};

export class RealtimeSession {
  private currentState: RealtimeState = "CREATED";
  private emitter = new EventEmitter();

  get state(): RealtimeState {
    return this.currentState;
  }

  transition(next: RealtimeState): void {
    const allowed = ALLOWED_TRANSITIONS[this.currentState];
    if (!allowed.includes(next)) {
      throw new InvalidTransitionError(this.currentState, next);
    }
    const from = this.currentState;
    this.currentState = next;
    this.emitter.emit("transition", from, next);
  }

  on(event: "transition", handler: (from: RealtimeState, to: RealtimeState) => void): void {
    this.emitter.on(event, handler);
  }
}
