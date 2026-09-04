import { describe, expect, it, vi } from "vitest";
import { RealtimeSession, InvalidTransitionError } from "./session-state-machine";

describe("RealtimeSession", () => {
  it("starts in CREATED", () => {
    const session = new RealtimeSession();
    expect(session.state).toBe("CREATED");
  });

  it("allows the full happy-path transition sequence", () => {
    const session = new RealtimeSession();
    session.transition("CONNECTING");
    session.transition("LISTENING");
    session.transition("USER_SPEAKING");
    session.transition("THINKING");
    session.transition("AI_SPEAKING");
    session.transition("LISTENING");
    session.transition("ENDED");
    expect(session.state).toBe("ENDED");
  });

  it("allows AI_SPEAKING -> INTERRUPTING -> LISTENING for barge-in", () => {
    const session = new RealtimeSession();
    session.transition("CONNECTING");
    session.transition("LISTENING");
    session.transition("USER_SPEAKING");
    session.transition("THINKING");
    session.transition("AI_SPEAKING");
    session.transition("INTERRUPTING");
    session.transition("LISTENING");
    expect(session.state).toBe("LISTENING");
  });

  it("rejects an undefined transition", () => {
    const session = new RealtimeSession();
    expect(() => session.transition("AI_SPEAKING")).toThrow(InvalidTransitionError);
  });

  it("allows any state to transition to ERROR", () => {
    const session = new RealtimeSession();
    session.transition("CONNECTING");
    session.transition("ERROR");
    expect(session.state).toBe("ERROR");
  });

  it("emits a transition event with from/to states", () => {
    const session = new RealtimeSession();
    const handler = vi.fn();
    session.on("transition", handler);
    session.transition("CONNECTING");
    expect(handler).toHaveBeenCalledWith("CREATED", "CONNECTING");
  });
});
