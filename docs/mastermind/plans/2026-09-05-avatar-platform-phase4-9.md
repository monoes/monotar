# Avatar Platform Phase 4-9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0-3 mock providers with real ones — LiveKit real-time transport, faster-whisper STT, OpenAI LLM, OpenAI TTS, and a LiveTalking+Wav2Lip avatar renderer (MuseTalk adapter built but CUDA-gated on this hardware).

**Architecture:** The existing `RealtimeSession` state machine stays. A new `ConversationOrchestrator` class replaces the inline turn logic in `ws-route.ts`, driven by four redesigned provider interfaces (session/streaming-based, matching spec §18-21 exactly) instead of the one-shot Phase 0-3 versions. Real implementations: `GrpcSttClient` (talks to a new Python `services/stt` over gRPC), `OpenAILLMProvider`/`OpenAITTSProvider` (direct HTTP to OpenAI), `AvatarGatewayClient` (talks to a new Node `services/avatar-gateway`, which wraps the `LiveTalking` container). LiveKit replaces the browser-facing raw WebSocket for audio/video media; the existing WebSocket stays for control messages (state/transcript/assistant_text/error).

**Tech Stack:** Adds: Python 3.11 (`services/stt`), grpcio, faster-whisper, Silero VAD (via torch), `@grpc/grpc-js`, `livekit-server-sdk` + `livekit-client`, OpenAI HTTP APIs (no SDK — raw `fetch`, consistent with the rest of the codebase).

## Global Constraints

- This machine has an AMD GPU — no CUDA. MuseTalk's adapter is built but returns `503 model_requires_cuda`; Wav2Lip is the actual working local renderer. Never write code that assumes CUDA is available without a capability check.
- All four provider interfaces (`SpeechToTextProvider`, `LLMProvider`, `TextToSpeechProvider`, `AvatarEngine`) are being redesigned in Task 1 to be session/streaming-based, matching spec §18-21 literally — do not reintroduce the old one-shot Phase 0-3 shapes anywhere.
- New env vars introduced by this plan (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `STT_GRPC_URL`) must be added to `.env.example`/`.env.local` **by the user**, never by an agent — `.env*` files are under a hard permission boundary no agent in this project can read or write. Each task that introduces a new env var says so explicitly; nothing here should ever attempt to touch those files.
- Git submodules (`external/LiveTalking`, `external/MuseTalk`, `external/Wav2Lip`) are pinned per spec §5 — record the exact commit SHA cloned in `docs/upstream-dependencies.md`.
- `services/stt` and `services/avatar-gateway` are new workspace members; `services/avatar-gateway` is auto-included by the existing `services/*` glob in `pnpm-workspace.yaml` (no change needed there). `services/stt` is Python and is never part of the pnpm workspace.
- Root `pnpm test` runs `pnpm -r --workspace-concurrency=1 run test` (fixed in the Phase 0-3 plan) — Python tests are NOT part of that; CI runs them as a separate step (Task 19).
- Every file stays under 500 lines; split before it grows past that.
- Never hardcode literal secret-looking values in source or tests — same rule as the Phase 0-3 plan; use placeholder/test values and env-var indirection.

---

## File Structure

```
monotar/
  packages/stt-proto/
    stt.proto                         # canonical gRPC contract, referenced by both Python and Node
  services/stt/                       # new Python service
    requirements.txt
    pytest.ini
    scripts/gen_proto.sh
    src/stt_service/
      __init__.py
      vad.py
      transcriber.py
      server.py
    tests/
      test_vad.py
      test_transcriber.py
      test_server.py
    Dockerfile
  services/avatar-gateway/            # new Node/TS service
    package.json  tsconfig.json  vitest.config.ts
    src/
      app.ts  server.ts
      routes/avatar-sessions.ts
      providers/livetalking/
        LiveTalkingClient.ts  LiveTalkingMapper.ts
        LiveTalkingSession.ts  LiveTalkingProvider.ts
        LiveTalkingHealth.ts
      providers/musetalk/MuseTalkGate.ts
    test/mock-livetalking-server.ts
  services/api/
    src/realtime/
      providers.ts                    # MODIFIED: redesigned interfaces (Task 1)
      mock-providers.ts               # MODIFIED: rewritten to match (Task 1)
      conversation-orchestrator.ts    # NEW (Task 2), replaces inline ws-route.ts logic
      ws-route.ts                     # MODIFIED (Task 2): thin WS glue over the orchestrator
      grpc-stt-client.ts              # NEW (Task 10)
      openai-llm-provider.ts          # NEW (Task 11)
      openai-tts-provider.ts          # NEW (Task 12)
      avatar-gateway-client.ts        # NEW (Task 15)
      livekit-session-manager.ts      # NEW (Task 16)
    src/routes/livekit.ts             # NEW (Task 16)
    src/app.ts                        # MODIFIED (Task 16): register livekit token route
  apps/web/app/talk/[agentId]/
    talk-client.tsx                   # MODIFIED (Task 18): livekit-client instead of raw WebSocket
  external/{LiveTalking,MuseTalk,Wav2Lip}/   # git submodules (Task 3)
  docs/licenses/{livetalking,musetalk,wav2lip}.md   # (Task 3)
  infra/docker/livetalking.Dockerfile  # (Task 5)
  scripts/fetch-models.sh              # (Task 5)
  docker-compose.yml                   # MODIFIED (Task 4): + livekit, coturn
  docker-compose.cpu.yml               # NEW (Task 5): stt, avatar-gateway, livetalking
```

---

## Task Dependency Waves (for parallel execution)

- **Wave A (parallel, no dependencies on each other):** Tasks 1, 3, 4, 5, 6, 7, 11, 12, 13, 16
- **Wave B (parallel, deps resolved by Wave A):** Task 2 (needs 1), Task 8 (needs 7), Task 10 (needs 6), Task 14 (needs 13), Task 18 (needs 16)
- **Wave C (parallel, deps resolved by Wave B):** Task 9 (needs 6, 8), Task 15 (needs 1, 14)
- **Wave D (solo):** Task 17 (needs 2, 9, 10, 11, 12, 15)
- **Wave E (solo, final):** Task 19 (needs everything)

File-conflict note: only Task 16 touches `services/api/src/app.ts` in this plan (Task 2 only touches `ws-route.ts`'s internals, not its registration) — so app.ts has no cross-task conflict here, unlike the Phase 0-3 plan where six tasks shared it.

---

### Task 1: Redesign Provider Interfaces for Streaming + Rewrite Mocks

**Files:**
- Modify: `services/api/src/realtime/providers.ts`
- Modify: `services/api/src/realtime/mock-providers.ts`, `services/api/src/realtime/mock-providers.test.ts`

**Interfaces:**
- Produces (all in `providers.ts`, exact names every later task in this plan consumes):
  - `interface SttEvent { type: "speech_started" | "partial_transcript" | "final_transcript" | "speech_ended"; text?: string }`
  - `interface SttSessionConfig { sampleRate: number; languageHint?: string }`
  - `interface SttSession { sendAudio(chunk: Buffer): void; onEvent(handler: (event: SttEvent) => void): void; close(): void }`
  - `interface SpeechToTextProvider { createSession(config: SttSessionConfig): SttSession }`
  - `interface ConversationTurn { role: "user" | "assistant"; content: string }` (unchanged name/shape from Phase 0-3)
  - `interface LlmRequest { messages: ConversationTurn[] }`
  - `type LlmEvent = { type: "token"; text: string } | { type: "done" }`
  - `interface LLMProvider { streamChat(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmEvent> }`
  - `interface VoiceConfig { voiceId?: string }`
  - `interface TextToSpeechProvider { synthesizeStream(text: AsyncIterable<string>, config: VoiceConfig, signal?: AbortSignal): AsyncIterable<Buffer> }`
  - `type PlaybackState = "idle" | "playing" | "interrupted"`
  - `interface AvatarSessionConfig { avatarId?: string }`
  - `interface AvatarSession { id: string; sendAudio(audio: AsyncIterable<Buffer>): Promise<void>; interrupt(): Promise<void>; getPlaybackState(): Promise<PlaybackState>; close(): Promise<void> }`
  - `interface AvatarEngine { createSession(config: AvatarSessionConfig): Promise<AvatarSession> }`
- Removes: the old one-shot `transcribe()`, `generateReply()`, `synthesize()`, `onStateChange()` shapes entirely — nothing in the codebase should reference them after this task.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `services/api/src/realtime/mock-providers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";
import type { SttEvent } from "./providers";

describe("MockSTT", () => {
  it("emits speech_started on the first audio chunk, then a final transcript after silence", async () => {
    vi.useFakeTimers();
    const stt = new MockSTT();
    const session = stt.createSession({ sampleRate: 16000 });
    const events: SttEvent[] = [];
    session.onEvent((e) => events.push(e));

    session.sendAudio(Buffer.from("chunk-1"));
    expect(events).toEqual([{ type: "speech_started" }]);

    await vi.advanceTimersByTimeAsync(20);
    expect(events).toEqual([
      { type: "speech_started" },
      { type: "final_transcript", text: "hello, this is a mock transcript" },
      { type: "speech_ended" },
    ]);
    vi.useRealTimers();
  });
});

describe("MockLLM", () => {
  it("streams tokens then done, and stops early when aborted", async () => {
    const llm = new MockLLM();
    const controller = new AbortController();
    const events = [];
    for await (const event of llm.streamChat({ messages: [{ role: "user", content: "hi" }] }, controller.signal)) {
      events.push(event);
      if (events.length === 2) controller.abort();
    }
    expect(events.length).toBe(2);
    expect(events.every((e) => e.type === "token")).toBe(true);
  });
});

describe("MockTTS", () => {
  async function* textOf(...words: string[]): AsyncIterable<string> {
    for (const w of words) yield w;
  }

  it("yields one audio buffer per input text chunk", async () => {
    const tts = new MockTTS();
    const buffers: Buffer[] = [];
    for await (const chunk of tts.synthesizeStream(textOf("hello", "world"), {})) {
      buffers.push(chunk);
    }
    expect(buffers).toHaveLength(2);
  });

  it("stops yielding once aborted", async () => {
    const tts = new MockTTS();
    const controller = new AbortController();
    controller.abort();
    const buffers: Buffer[] = [];
    for await (const chunk of tts.synthesizeStream(textOf("hello", "world"), {}, controller.signal)) {
      buffers.push(chunk);
    }
    expect(buffers).toHaveLength(0);
  });
});

describe("MockAvatarEngine", () => {
  async function* audioOf(...chunks: string[]): AsyncIterable<Buffer> {
    for (const c of chunks) yield Buffer.from(c);
  }

  it("tracks playback state across sendAudio/interrupt/close", async () => {
    const engine = new MockAvatarEngine();
    const session = await engine.createSession({});
    expect(await session.getPlaybackState()).toBe("idle");

    const sendPromise = session.sendAudio(audioOf("a", "b"));
    await sendPromise;
    expect(await session.getPlaybackState()).toBe("idle");

    await session.interrupt();
    expect(await session.getPlaybackState()).toBe("interrupted");

    await session.close();
    expect(await session.getPlaybackState()).toBe("idle");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `mock-providers.ts` doesn't export session-based classes yet (old shapes still present).

- [ ] **Step 3: Rewrite `providers.ts`**

Replace the full contents of `services/api/src/realtime/providers.ts`:

```ts
export type SttEventType = "speech_started" | "partial_transcript" | "final_transcript" | "speech_ended";

export interface SttEvent {
  type: SttEventType;
  text?: string;
}

export interface SttSessionConfig {
  sampleRate: number;
  languageHint?: string;
}

export interface SttSession {
  sendAudio(chunk: Buffer): void;
  onEvent(handler: (event: SttEvent) => void): void;
  close(): void;
}

export interface SpeechToTextProvider {
  createSession(config: SttSessionConfig): SttSession;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: ConversationTurn[];
}

export type LlmEvent = { type: "token"; text: string } | { type: "done" };

export interface LLMProvider {
  streamChat(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmEvent>;
}

export interface VoiceConfig {
  voiceId?: string;
}

export interface TextToSpeechProvider {
  synthesizeStream(
    text: AsyncIterable<string>,
    config: VoiceConfig,
    signal?: AbortSignal
  ): AsyncIterable<Buffer>;
}

export type PlaybackState = "idle" | "playing" | "interrupted";

export interface AvatarSessionConfig {
  avatarId?: string;
}

export interface AvatarSession {
  id: string;
  sendAudio(audio: AsyncIterable<Buffer>): Promise<void>;
  interrupt(): Promise<void>;
  getPlaybackState(): Promise<PlaybackState>;
  close(): Promise<void>;
}

export interface AvatarEngine {
  createSession(config: AvatarSessionConfig): Promise<AvatarSession>;
}
```

- [ ] **Step 4: Rewrite `mock-providers.ts`**

Replace the full contents of `services/api/src/realtime/mock-providers.ts`:

```ts
import type {
  AvatarEngine,
  AvatarSession,
  AvatarSessionConfig,
  LlmEvent,
  LlmRequest,
  LLMProvider,
  PlaybackState,
  SpeechToTextProvider,
  SttEvent,
  SttSession,
  SttSessionConfig,
  TextToSpeechProvider,
  VoiceConfig,
} from "./providers";

export class MockSTT implements SpeechToTextProvider {
  createSession(_config: SttSessionConfig): SttSession {
    let handler: ((event: SttEvent) => void) | null = null;
    let speaking = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    return {
      sendAudio(_chunk: Buffer) {
        if (!speaking) {
          speaking = true;
          handler?.({ type: "speech_started" });
        }
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (!speaking) return;
          speaking = false;
          handler?.({ type: "final_transcript", text: "hello, this is a mock transcript" });
          handler?.({ type: "speech_ended" });
        }, 10);
      },
      onEvent(h) {
        handler = h;
      },
      close() {
        if (silenceTimer) clearTimeout(silenceTimer);
        speaking = false;
        handler = null;
      },
    };
  }
}

export class MockLLM implements LLMProvider {
  async *streamChat(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmEvent> {
    const last = request.messages[request.messages.length - 1]?.content ?? "";
    const words = `You said: ${last}. This is a mocked reply.`.split(" ");
    for (const word of words) {
      if (signal?.aborted) return;
      yield { type: "token", text: `${word} ` };
    }
    yield { type: "done" };
  }
}

export class MockTTS implements TextToSpeechProvider {
  async *synthesizeStream(
    text: AsyncIterable<string>,
    _config: VoiceConfig,
    signal?: AbortSignal
  ): AsyncIterable<Buffer> {
    let index = 0;
    for await (const _chunk of text) {
      if (signal?.aborted) return;
      yield Buffer.from(`mock-audio-chunk-${index}`);
      index += 1;
    }
  }
}

export class MockAvatarEngine implements AvatarEngine {
  async createSession(_config: AvatarSessionConfig): Promise<AvatarSession> {
    let playback: PlaybackState = "idle";
    return {
      id: "mock-avatar-session",
      async sendAudio(audio: AsyncIterable<Buffer>) {
        playback = "playing";
        for await (const _chunk of audio) {
          // mock: drain the stream, no real playback
        }
        if (playback === "playing") playback = "idle";
      },
      async interrupt() {
        playback = "interrupted";
      },
      async getPlaybackState() {
        return playback;
      },
      async close() {
        playback = "idle";
      },
    };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @monotar/api test`
Expected: `mock-providers.test.ts` passes (5 tests). Other test files (`session-state-machine.test.ts`, `ws-route.test.ts`, etc.) will now FAIL to compile — that's expected and fixed in Task 2. Confirm the failures are TypeScript/import errors referencing the old provider shapes, not something else.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/realtime/providers.ts services/api/src/realtime/mock-providers.ts services/api/src/realtime/mock-providers.test.ts
git commit -m "feat(api): redesign provider interfaces as session/streaming-based, matching spec §18-21

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 2: Rewrite Orchestration as `ConversationOrchestrator`

**Files:**
- Create: `services/api/src/realtime/conversation-orchestrator.ts`, `services/api/src/realtime/conversation-orchestrator.test.ts`
- Modify: `services/api/src/realtime/ws-route.ts`, `services/api/src/realtime/ws-route.test.ts`

**Interfaces:**
- Consumes: everything from Task 1's `providers.ts`.
- Produces: `class ConversationOrchestrator` — constructor takes `OrchestratorDeps = { stt: SpeechToTextProvider; llm: LLMProvider; tts: TextToSpeechProvider; avatar: AvatarEngine; send: (message: ServerMessage) => void }`. Public API: `get state(): RealtimeState`, `handleAudioFrame(chunk: Buffer): void`, `interrupt(): Promise<void>`, `end(): Promise<void>`. This is what Task 17 wires real providers into, and what the WS route (this task) drives for local/manual testing before LiveKit (Task 18) exists.
- The client WebSocket protocol changes: **`{type:"audio_chunk"}` is removed** (audio no longer arrives over this WebSocket — it will arrive via LiveKit server-side track subscription starting Task 17/18). The WS keeps `{type:"interrupt"}` and `{type:"end"}` for client-triggered control, and keeps emitting `state`/`transcript`/`assistant_text`/`error` server messages exactly as before. For this task's own tests, audio arrival is simulated by calling `orchestrator.handleAudioFrame()` directly, not via a WS message.

- [ ] **Step 1: Write the failing test for `ConversationOrchestrator`**

`services/api/src/realtime/conversation-orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ConversationOrchestrator } from "./conversation-orchestrator";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";
import type { ServerMessage } from "@monotar/contracts";

function buildOrchestrator(sent: ServerMessage[]) {
  return new ConversationOrchestrator({
    stt: new MockSTT(),
    llm: new MockLLM(),
    tts: new MockTTS(),
    avatar: new MockAvatarEngine(),
    send: (message) => sent.push(message),
  });
}

describe("ConversationOrchestrator", () => {
  it("starts in LISTENING and sends an initial state message", () => {
    const sent: ServerMessage[] = [];
    const orchestrator = buildOrchestrator(sent);
    expect(orchestrator.state).toBe("LISTENING");
    expect(sent).toEqual([{ type: "state", state: "LISTENING" }]);
  });

  it("runs a full turn from an audio frame through to LISTENING again", async () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    const orchestrator = buildOrchestrator(sent);

    orchestrator.handleAudioFrame(Buffer.from("frame"));
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(orchestrator.state).toBe("LISTENING"));

    const states = sent.filter((m) => m.type === "state").map((m: any) => m.state);
    expect(states).toEqual(["LISTENING", "USER_SPEAKING", "THINKING", "AI_SPEAKING", "LISTENING"]);
    expect(sent.some((m) => m.type === "transcript")).toBe(true);
    expect(sent.some((m) => m.type === "assistant_text")).toBe(true);
    vi.useRealTimers();
  });

  it("interrupt() during AI_SPEAKING transitions through INTERRUPTING back to LISTENING", async () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    const orchestrator = buildOrchestrator(sent);

    orchestrator.handleAudioFrame(Buffer.from("frame"));
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(orchestrator.state).toBe("AI_SPEAKING"));

    await orchestrator.interrupt();
    expect(orchestrator.state).toBe("LISTENING");
    const states = sent.filter((m) => m.type === "state").map((m: any) => m.state);
    expect(states).toContain("INTERRUPTING");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `conversation-orchestrator.ts` doesn't exist.

- [ ] **Step 3: Write `conversation-orchestrator.ts`**

```ts
import type { RealtimeState, ServerMessage } from "@monotar/contracts";
import { RealtimeSession } from "./session-state-machine";
import type {
  AvatarEngine,
  AvatarSession,
  ConversationTurn,
  LLMProvider,
  SpeechToTextProvider,
  SttEvent,
  SttSession,
  TextToSpeechProvider,
} from "./providers";

export interface OrchestratorDeps {
  stt: SpeechToTextProvider;
  llm: LLMProvider;
  tts: TextToSpeechProvider;
  avatar: AvatarEngine;
  send: (message: ServerMessage) => void;
}

export class ConversationOrchestrator {
  private session = new RealtimeSession();
  private sttSession: SttSession;
  private avatarSessionPromise: Promise<AvatarSession>;
  private llmAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private history: ConversationTurn[] = [];

  constructor(private deps: OrchestratorDeps) {
    this.sttSession = deps.stt.createSession({ sampleRate: 16000 });
    this.avatarSessionPromise = deps.avatar.createSession({});
    this.sttSession.onEvent((event) => this.handleSttEvent(event));
    this.setState("LISTENING");
  }

  get state(): RealtimeState {
    return this.session.state;
  }

  handleAudioFrame(chunk: Buffer): void {
    this.sttSession.sendAudio(chunk);
  }

  private setState(next: RealtimeState): void {
    this.session.transition(next);
    this.deps.send({ type: "state", state: next });
  }

  private handleSttEvent(event: SttEvent): void {
    if (event.type === "speech_started" && this.session.state === "LISTENING") {
      this.setState("USER_SPEAKING");
    }
    if (event.type === "final_transcript" && event.text) {
      this.deps.send({ type: "transcript", text: event.text });
      this.history.push({ role: "user", content: event.text });
      void this.runTurn();
    }
  }

  private async *streamAssistantText(signal: AbortSignal): AsyncIterable<string> {
    let full = "";
    for await (const event of this.deps.llm.streamChat({ messages: this.history }, signal)) {
      if (event.type === "token") {
        full += event.text;
        yield event.text;
      }
    }
    this.history.push({ role: "assistant", content: full });
    this.deps.send({ type: "assistant_text", text: full });
  }

  private async runTurn(): Promise<void> {
    this.setState("THINKING");
    this.llmAbort = new AbortController();
    this.ttsAbort = new AbortController();

    const textStream = this.streamAssistantText(this.llmAbort.signal);
    this.setState("AI_SPEAKING");
    const avatarSession = await this.avatarSessionPromise;
    const audioStream = this.deps.tts.synthesizeStream(textStream, {}, this.ttsAbort.signal);
    await avatarSession.sendAudio(audioStream);

    if (this.session.state === "AI_SPEAKING") {
      this.setState("LISTENING");
    }
  }

  async interrupt(): Promise<void> {
    if (this.session.state !== "AI_SPEAKING") return;
    this.setState("INTERRUPTING");
    this.llmAbort?.abort();
    this.ttsAbort?.abort();
    const avatarSession = await this.avatarSessionPromise;
    await avatarSession.interrupt();
    this.setState("LISTENING");
  }

  async end(): Promise<void> {
    this.setState("ENDED");
    this.sttSession.close();
    const avatarSession = await this.avatarSessionPromise;
    await avatarSession.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: `conversation-orchestrator.test.ts` passes (3 tests).

- [ ] **Step 5: Rewrite `ws-route.ts` as thin WS glue over the orchestrator**

Replace the full contents of `services/api/src/realtime/ws-route.ts`:

```ts
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

    const orchestrator = new ConversationOrchestrator({
      stt: new MockSTT(),
      llm: new MockLLM(),
      tts: new MockTTS(),
      avatar: new MockAvatarEngine(),
      send: (message) => socket.send(JSON.stringify(message)),
    });

    socket.on("message", async (raw: Buffer) => {
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
      if (orchestrator.state !== "ENDED" && orchestrator.state !== "ERROR") {
        await orchestrator.end();
      }
    });
  });
}
```

Note: `ClientMessageSchema` in `@monotar/contracts` still declares an `audio_chunk` variant from Phase 0-3 — leave the schema as-is (it's harmless if unused; removing it is out of scope for this task and would touch a shared contracts package other tasks may still reference). This route simply never emits or expects that variant anymore.

- [ ] **Step 6: Rewrite `ws-route.test.ts`**

Replace the full contents of `services/api/src/realtime/ws-route.test.ts`:

```ts
import { describe, expect, it, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";
import { buildApp } from "../app";
import { prisma } from "../db";
import type { ServerMessage } from "@monotar/contracts";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createLoggedInUser() {
  const user = await prisma.user.create({ data: { email: `ws-${Date.now()}@example.com` } });
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  const sessionValue = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
  });
  const agent = await prisma.avatarAgent.create({
    data: { organizationId: org.id, name: "Bot", systemPrompt: "Be helpful", llmConfig: {}, voiceConfig: {} },
  });
  return { sessionValue, agent };
}

function collectMessages(ws: WebSocket, count: number): Promise<ServerMessage[]> {
  return new Promise((resolve) => {
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()));
      if (messages.length === count) resolve(messages);
    });
  });
}

describe("WS /api/realtime/:agentId", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sends an initial LISTENING state on connect", async () => {
    const { sessionValue, agent } = await createLoggedInUser();
    const app = buildApp();
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/realtime/${agent.id}`, {
      headers: { cookie: `monotar_session=${sessionValue}` },
    });

    await new Promise((resolve) => ws.on("open", resolve));
    const [initial] = await collectMessages(ws, 1);
    expect(initial).toEqual({ type: "state", state: "LISTENING" });

    ws.close();
    await app.close();
  });

  it("ends the session on an explicit end message", async () => {
    const { sessionValue, agent } = await createLoggedInUser();
    const app = buildApp();
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/realtime/${agent.id}`, {
      headers: { cookie: `monotar_session=${sessionValue}` },
    });

    await new Promise((resolve) => ws.on("open", resolve));
    await collectMessages(ws, 1);

    const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    ws.send(JSON.stringify({ type: "end" }));
    const code = await closed;
    expect(code).toBe(1000);

    await app.close();
  });
});
```

Note: this drops the old "full mock conversation turn via `audio_chunk`" and "interrupt during AI_SPEAKING" WS-level tests from Phase 0-3 — that behavior is now covered more directly (and more reliably, without the WS handshake race worked around in Phase 0-3) by `conversation-orchestrator.test.ts` in Step 1. The WS route's own test responsibility shrinks to "does the WebSocket glue correctly connect/close," which is what it actually does now.

- [ ] **Step 7: Run the full API test suite**

Run (with the full env var set established in the Phase 0-3 plan, plus `DATABASE_URL` pointing at the local Postgres):
```
DATABASE_URL='postgresql://monotar:changeme-local-dev-only@localhost:5432/monotar' \
REDIS_URL=redis://localhost:6379 S3_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY=test S3_SECRET_KEY=test \
S3_BUCKET=test-bucket APP_URL=http://localhost:3000 API_PORT=4000 MONOES_ISSUER=https://monoes.me/api/auth \
MONOES_METADATA_URL=https://monoes.me/api/auth/.well-known/oauth-authorization-server MONOES_CLIENT_ID=test-client-id \
MONOES_SCOPES="openid profile email" MONOES_REDIRECT_URI=http://localhost:3000/api/auth/callback/monoes \
SESSION_COOKIE_NAME=monotar_session pnpm --filter @monotar/api test
```
Expected: all test files pass, including `conversation-orchestrator.test.ts` (3) and the shrunk `ws-route.test.ts` (2).

- [ ] **Step 8: Commit**

```bash
git add services/api/src/realtime/conversation-orchestrator.ts services/api/src/realtime/conversation-orchestrator.test.ts services/api/src/realtime/ws-route.ts services/api/src/realtime/ws-route.test.ts
git commit -m "refactor(api): extract ConversationOrchestrator, drop WS audio_chunk transport

Audio now arrives via LiveKit server-side track subscription (wired in
a later task), not client WebSocket messages. The WebSocket keeps
carrying control messages (interrupt/end) and server state/transcript
events.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 3: Git Submodules + License Documentation

**Files:**
- Create: `external/LiveTalking`, `external/MuseTalk`, `external/Wav2Lip` (git submodules)
- Create: `docs/licenses/livetalking.md`, `docs/licenses/musetalk.md`, `docs/licenses/wav2lip.md`
- Modify: `docs/upstream-dependencies.md`

**Interfaces:**
- Produces: pinned submodule commits recorded in `docs/upstream-dependencies.md`; no code interface, but Task 5's Dockerfile and `fetch-models.sh` reference `external/LiveTalking`, `external/MuseTalk`, `external/Wav2Lip` by these exact paths.

- [ ] **Step 1: Add the submodules**

Run:
```bash
mkdir -p external
git submodule add https://github.com/lipku/LiveTalking.git external/LiveTalking
git submodule add https://github.com/TMElyralab/MuseTalk.git external/MuseTalk
git submodule add https://github.com/Rudrabha/Wav2Lip.git external/Wav2Lip
git submodule update --init --recursive
git submodule status
```
Expected: `git submodule status` lists all three with a commit SHA and no `-`/`+` prefix (meaning checked out cleanly at the recorded commit).

- [ ] **Step 2: Record the pinned commits**

Run: `git submodule status` and copy the exact SHAs into this table (the SHAs below are placeholders — replace with whatever `git submodule status` actually printed in Step 1, since submodule HEAD commits change over time and cannot be predicted in advance):

Append to `docs/upstream-dependencies.md`:
```markdown

## Phase 4-9 additions

| Dependency | Source | Pinned Commit | License | Notes |
|---|---|---|---|---|
| LiveTalking | github.com/lipku/LiveTalking | <SHA from `git submodule status`> | see docs/licenses/livetalking.md | primary avatar renderer wrapper |
| MuseTalk | github.com/TMElyralab/MuseTalk | <SHA from `git submodule status`> | see docs/licenses/musetalk.md | requires CUDA; adapter built, not runnable on this hardware |
| Wav2Lip | github.com/Rudrabha/Wav2Lip | <SHA from `git submodule status`> | see docs/licenses/wav2lip.md | primary local renderer on this hardware (CPU-capable) |
| LiveKit Server | self-hosted, docker.io/livekit/livekit-server | pinned image tag in docker-compose.yml | Apache 2.0 | media transport |
| coturn | self-hosted, docker.io/coturn/coturn | pinned image tag in docker-compose.yml | BSD-3-Clause | TURN relay |
```

- [ ] **Step 3: Write license summaries**

`docs/licenses/livetalking.md`:
```markdown
# LiveTalking License Summary

Repository: https://github.com/lipku/LiveTalking
Code license: check `external/LiveTalking/LICENSE` at the pinned commit and record the
actual license identifier here once read — do not assume MIT/Apache without checking.

Status: REQUIRES_LEGAL_REVIEW — this file must be updated with the actual license text
findings before any commercial-facing deployment, per spec §6. Technical development is
not blocked on this review; production/commercial use is.
```

`docs/licenses/musetalk.md`:
```markdown
# MuseTalk License Summary

Repository: https://github.com/TMElyralab/MuseTalk
Code license: check `external/MuseTalk/LICENSE` at the pinned commit.
Model weights: MuseTalk model weights are distributed separately from the code and may
carry their own license/usage restrictions distinct from the repository's code license
(per spec §6, "do not assume repository code license automatically applies to
downloaded model weights") — verify before any commercial use.

Status: REQUIRES_LEGAL_REVIEW. Also note: not runnable on this project's current
hardware (no CUDA) — see docs/mastermind/specs/2026-09-05-avatar-platform-phase4-9-design.md §2.
```

`docs/licenses/wav2lip.md`:
```markdown
# Wav2Lip License Summary

Repository: https://github.com/Rudrabha/Wav2Lip
Code license: check `external/Wav2Lip/LICENSE` at the pinned commit.
Wav2Lip's original release restricts use to non-commercial research purposes for the
pretrained models specifically — verify the exact terms before any commercial use.

Status: REQUIRES_LEGAL_REVIEW.
```

- [ ] **Step 4: Verify submodules are tracked correctly**

Run: `git status --short`
Expected: shows `.gitmodules` and the three `external/*` entries as new, no untracked files *inside* the submodule directories (git treats each submodule as a single pointer entry, not its file contents).

- [ ] **Step 5: Commit**

```bash
git add .gitmodules external/LiveTalking external/MuseTalk external/Wav2Lip docs/licenses docs/upstream-dependencies.md
git commit -m "chore: add LiveTalking/MuseTalk/Wav2Lip submodules and license tracking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 4: Docker Compose — LiveKit + coturn

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: LiveKit reachable at `ws://localhost:7880` (server) and its HTTP API on the same port; coturn listening on UDP/TCP 3478. Credentials come from `.env.local` via `env_file` (same pattern as Postgres/MinIO in the Phase 0-3 plan — never inline `${VAR}` substitution for credential-shaped values in this file).

- [ ] **Step 1: Add the services**

Add to `docker-compose.yml` (alongside the existing `postgres`, `redis`, `minio` services):
```yaml
  livekit:
    image: livekit/livekit-server:v1.7.2
    command: --dev --bind 0.0.0.0
    env_file: .env.local
    ports: ["7880:7880", "7881:7881", "7882:7882/udp"]

  coturn:
    image: coturn/coturn:4.6.2
    env_file: .env.local
    network_mode: host
    command: >
      -n --log-file=stdout
      --listening-port=3478
      --min-port=49160 --max-port=49200
      --realm=monotar.local
      --use-auth-secret
```

`coturn` needs `network_mode: host` because TURN relays media on a wide ephemeral port range that Docker's default bridge networking can't forward cleanly — this is standard practice for self-hosted coturn, not a shortcut.

- [ ] **Step 2: Document the new required credentials**

The user must add these to `.env.example`/`.env.local` themselves (agents cannot touch `.env*` files — this is a hard permission boundary in this project, not a preference):
- `LIVEKIT_URL` — set to `ws://localhost:7880` for local dev.
- `LIVEKIT_API_KEY` — any short identifier string works in `--dev` mode (LiveKit's dev mode accepts a fixed key/value pair rather than requiring a production-grade generated one).
- `LIVEKIT_API_SECRET` — generate a random value at least 32 characters long (e.g. `openssl rand -hex 32`); this is what signs room-access tokens, so it must not be guessable.
- `TURN_SECRET` — generate a random value the same way; this authenticates coturn's TURN relay credential requests.

Never write example/placeholder-but-real-looking values for these two secrets into any committed file — describe how to generate them (as above), and let the user's own `.env.local` hold the actual value.

- [ ] **Step 3: Verify the compose file is syntactically valid**

Run: `docker compose config --quiet`
Expected: exits 0 with no output (env var resolution errors are expected/ignorable here since `.env.local` doesn't have the new vars yet — this step only checks YAML/schema validity, not full resolution; if it fails with a YAML parse error, fix that, but a "variable not set" warning is fine).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(infra): add self-hosted LiveKit and coturn to docker-compose.yml

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 5: `docker-compose.cpu.yml` + LiveTalking Dockerfile + Model Fetch Script

**Files:**
- Create: `docker-compose.cpu.yml`, `infra/docker/livetalking.Dockerfile`, `scripts/fetch-models.sh`

**Interfaces:**
- Produces: `docker compose -f docker-compose.yml -f docker-compose.cpu.yml up` brings up `stt`, `avatar-gateway`, `livetalking` alongside the base services, with no NVIDIA runtime requirement anywhere. This is this hardware's substitute for the spec's `docker-compose.gpu.yml` (see design doc §3).

- [ ] **Step 1: Write `docker-compose.cpu.yml`**

```yaml
services:
  stt:
    build:
      context: .
      dockerfile: services/stt/Dockerfile
    ports: ["50051:50051"]

  avatar-gateway:
    build:
      context: .
      dockerfile: services/avatar-gateway/Dockerfile
    env_file: .env.local
    ports: ["4100:4100"]
    depends_on: [livetalking]

  livetalking:
    build:
      context: .
      dockerfile: infra/docker/livetalking.Dockerfile
    volumes:
      - ./models:/models:ro
    ports: ["8010:8010"]
    environment:
      MUSETALK_MODEL_PATH: /models/musetalk
      WAV2LIP_MODEL_PATH: /models/wav2lip
      DEFAULT_ENGINE: wav2lip
```

Note: no `deploy.resources.reservations.devices` NVIDIA runtime block anywhere in this file — that's the deliberate difference from the spec's `docker-compose.gpu.yml`, documented in the design doc.

- [ ] **Step 2: Write `infra/docker/livetalking.Dockerfile`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recursive \
    ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

COPY external/LiveTalking /app/LiveTalking
COPY external/Wav2Lip /app/Wav2Lip
COPY external/MuseTalk /app/MuseTalk

WORKDIR /app/LiveTalking
RUN pip install --no-cache-dir -r requirements.txt || true

# CPU-only PyTorch build — no CUDA toolkit is installed in this image at all,
# matching this hardware's constraint (see design doc §2). Installing the CUDA
# build here would simply fail to initialize a GPU context; this image never
# attempts to.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

EXPOSE 8010
CMD ["python", "app.py", "--engine", "wav2lip", "--device", "cpu"]
```

- [ ] **Step 3: Write `scripts/fetch-models.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="${MODELS_DIR:-./models}"
mkdir -p "$MODELS_DIR/wav2lip" "$MODELS_DIR/musetalk"

echo "Model weights are intentionally NOT committed to git (spec §23)."
echo "This script documents where they must be placed; it does not download"
echo "copyrighted/gated model weights automatically without explicit user action,"
echo "since several of these require accepting upstream license terms first."
echo ""
echo "Wav2Lip: download 'wav2lip_gan.pth' from the Wav2Lip repo's documented"
echo "  release location and place it at: $MODELS_DIR/wav2lip/wav2lip_gan.pth"
echo ""
echo "MuseTalk: follow external/MuseTalk/README.md's model download instructions"
echo "  and place the resulting weights under: $MODELS_DIR/musetalk/"
echo ""
echo "After placing weights, verify with:"
echo "  test -f $MODELS_DIR/wav2lip/wav2lip_gan.pth && echo 'Wav2Lip: OK' || echo 'Wav2Lip: MISSING'"
```

- [ ] **Step 4: Make the script executable and verify**

Run: `chmod +x scripts/fetch-models.sh && ./scripts/fetch-models.sh`
Expected: prints the instructions above and creates `models/wav2lip/` and `models/musetalk/` directories; exits 0.

- [ ] **Step 5: Add `models/` to `.gitignore`**

Modify `.gitignore` — add:
```
models/
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.cpu.yml infra/docker/livetalking.Dockerfile scripts/fetch-models.sh .gitignore
git commit -m "feat(infra): add CPU-mode compose profile, LiveTalking Dockerfile, model fetch script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 6: Shared gRPC Contract (`packages/stt-proto/stt.proto`)

**Files:**
- Create: `packages/stt-proto/stt.proto`, `packages/stt-proto/README.md`

**Interfaces:**
- Produces: the canonical `.proto` contract both `services/stt` (Python, Task 9) and `services/api`'s `GrpcSttClient` (Node, Task 10) load. One bidirectional streaming RPC.

- [ ] **Step 1: Write the proto file**

`packages/stt-proto/stt.proto`:
```proto
syntax = "proto3";

package monotar.stt;

service SttService {
  rpc StreamTranscribe(stream AudioFrame) returns (stream TranscriptEvent);
}

message AudioFrame {
  bytes pcm16_data = 1;
  int32 sample_rate = 2;
}

message TranscriptEvent {
  string type = 1; // "speech_started" | "partial_transcript" | "final_transcript" | "speech_ended"
  string text = 2;
}
```

- [ ] **Step 2: Document how each side consumes it**

`packages/stt-proto/README.md`:
```markdown
# STT gRPC Contract

Single source of truth for the Node↔Python STT streaming boundary.

- **Python (`services/stt`)**: generates static stubs at build/test time via
  `services/stt/scripts/gen_proto.sh`, which points `grpc_tools.protoc` at this file.
  Generated code is gitignored, not committed.
- **Node (`services/api`)**: loads this file at runtime via `@grpc/proto-loader` —
  no codegen step needed on the TypeScript side.

Do not edit generated stub code directly on either side — edit this `.proto` file and
regenerate.
```

- [ ] **Step 3: Verify the proto file is syntactically valid**

Run (requires `protoc` on PATH — install via `sudo apt-get install -y protobuf-compiler` if missing, matching this project's earlier pattern of using the already-authorized `apt-get` NOPASSWD grant for install commands):
```bash
protoc --proto_path=packages/stt-proto --descriptor_set_out=/dev/null packages/stt-proto/stt.proto
```
Expected: exits 0 with no output (a syntax error would print a line/column error message).

- [ ] **Step 4: Commit**

```bash
git add packages/stt-proto
git commit -m "feat: add shared gRPC contract for the STT streaming service

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 7: `services/stt` Skeleton + Silero VAD Wrapper

**Files:**
- Create: `services/stt/requirements.txt`, `services/stt/pytest.ini`
- Create: `services/stt/src/stt_service/__init__.py`, `services/stt/src/stt_service/vad.py`, `services/stt/tests/test_vad.py`

**Interfaces:**
- Produces: `class VoiceActivityDetector` — constructor `VoiceActivityDetector(model=None)` (accepts an injected model for testing; defaults to loading the real Silero VAD via `torch.hub` when `model=None`). Method `is_speech(pcm16_frame: bytes, sample_rate: int) -> bool`. Consumed by Task 9's gRPC server.

- [ ] **Step 1: Write `requirements.txt` and `pytest.ini`**

`services/stt/requirements.txt`:
```
grpcio==1.68.0
grpcio-tools==1.68.0
faster-whisper==1.0.3
torch==2.4.1
numpy==2.1.2
pytest==8.3.3
```

`services/stt/pytest.ini`:
```ini
[pytest]
testpaths = tests
pythonpath = src
```

- [ ] **Step 2: Write the failing test**

`services/stt/tests/test_vad.py`:
```python
import numpy as np
from stt_service.vad import VoiceActivityDetector


class FakeSileroModel:
    """Stands in for the real torch.hub Silero VAD model in unit tests."""

    def __call__(self, tensor, sample_rate):
        # Real Silero returns a probability tensor; our fake returns a plain
        # float based on whether the frame has any non-zero energy, so tests
        # can exercise both branches without loading the real model.
        import torch

        has_energy = torch.any(tensor.abs() > 0.01).item()
        return torch.tensor([0.9 if has_energy else 0.01])


def test_silence_is_not_speech():
    vad = VoiceActivityDetector(model=FakeSileroModel())
    silence = np.zeros(1600, dtype=np.int16).tobytes()
    assert vad.is_speech(silence, sample_rate=16000) is False


def test_tone_is_speech():
    vad = VoiceActivityDetector(model=FakeSileroModel())
    tone = (np.ones(1600, dtype=np.int16) * 5000).tobytes()
    assert vad.is_speech(tone, sample_rate=16000) is True
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/stt && python -m pip install -r requirements.txt && python -m pytest tests/test_vad.py -v`
Expected: FAIL — `stt_service.vad` module doesn't exist.

- [ ] **Step 4: Write `vad.py`**

`services/stt/src/stt_service/__init__.py`:
```python
```

`services/stt/src/stt_service/vad.py`:
```python
import numpy as np
import torch


def _load_default_model():
    model, _ = torch.hub.load(
        repo_or_dir="snakers4/silero-vad", model="silero_vad", trust_repo=True
    )
    return model


class VoiceActivityDetector:
    def __init__(self, model=None, threshold: float = 0.5):
        self._model = model if model is not None else _load_default_model()
        self._threshold = threshold

    def is_speech(self, pcm16_frame: bytes, sample_rate: int) -> bool:
        samples = np.frombuffer(pcm16_frame, dtype=np.int16).astype(np.float32) / 32768.0
        tensor = torch.from_numpy(samples)
        probability = self._model(tensor, sample_rate)
        return float(probability[0]) >= self._threshold
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/stt && python -m pytest tests/test_vad.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add services/stt/requirements.txt services/stt/pytest.ini services/stt/src/stt_service/__init__.py services/stt/src/stt_service/vad.py services/stt/tests/test_vad.py
git commit -m "feat(stt): add service skeleton and Silero VAD wrapper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 8: `services/stt` faster-whisper Transcriber Wrapper

**Files:**
- Create: `services/stt/src/stt_service/transcriber.py`, `services/stt/tests/test_transcriber.py`

**Interfaces:**
- Consumes: nothing from Task 7 directly (independent wrapper).
- Produces: `class Transcriber` — constructor `Transcriber(model=None)` (injected model for testing; defaults to a real `faster_whisper.WhisperModel("small", compute_type="int8")` when `model=None`). Method `transcribe(pcm16_audio: bytes, sample_rate: int) -> str`. Consumed by Task 9's gRPC server.

- [ ] **Step 1: Write the failing test**

`services/stt/tests/test_transcriber.py`:
```python
import numpy as np
from stt_service.transcriber import Transcriber


class FakeSegment:
    def __init__(self, text: str):
        self.text = text


class FakeWhisperModel:
    """Stands in for faster_whisper.WhisperModel in unit tests."""

    def transcribe(self, audio, **kwargs):
        segments = [FakeSegment(" hello"), FakeSegment(" world")]
        info = None
        return segments, info


def test_transcribe_joins_segment_texts():
    transcriber = Transcriber(model=FakeWhisperModel())
    silence = np.zeros(1600, dtype=np.int16).tobytes()
    result = transcriber.transcribe(silence, sample_rate=16000)
    assert result == "hello world"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/stt && python -m pytest tests/test_transcriber.py -v`
Expected: FAIL — `stt_service.transcriber` module doesn't exist.

- [ ] **Step 3: Write `transcriber.py`**

```python
import numpy as np
from faster_whisper import WhisperModel


def _load_default_model():
    return WhisperModel("small", device="cpu", compute_type="int8")


class Transcriber:
    def __init__(self, model=None):
        self._model = model if model is not None else _load_default_model()

    def transcribe(self, pcm16_audio: bytes, sample_rate: int) -> str:
        samples = np.frombuffer(pcm16_audio, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _info = self._model.transcribe(samples, language="en")
        return "".join(segment.text for segment in segments).strip()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/stt && python -m pytest tests/test_transcriber.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/stt/src/stt_service/transcriber.py services/stt/tests/test_transcriber.py
git commit -m "feat(stt): add faster-whisper transcriber wrapper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 9: `services/stt` gRPC Server (`StreamTranscribe`)

**Files:**
- Create: `services/stt/scripts/gen_proto.sh`, `services/stt/src/stt_service/server.py`, `services/stt/tests/test_server.py`
- Create: `services/stt/Dockerfile`

**Interfaces:**
- Consumes: `VoiceActivityDetector` (Task 7), `Transcriber` (Task 8), `packages/stt-proto/stt.proto` (Task 6).
- Produces: a runnable gRPC server implementing `SttService.StreamTranscribe` — accumulates incoming `AudioFrame`s, uses VAD to detect `speech_started`/`speech_ended` boundaries, runs the transcriber over the accumulated audio on `speech_ended`, yields `TranscriptEvent`s. This is what Task 10's `GrpcSttClient` (Node) connects to.

- [ ] **Step 1: Write the proto codegen script**

`services/stt/scripts/gen_proto.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p src/stt_service/generated
python -m grpc_tools.protoc \
  --proto_path=../../packages/stt-proto \
  --python_out=src/stt_service/generated \
  --grpc_python_out=src/stt_service/generated \
  ../../packages/stt-proto/stt.proto
touch src/stt_service/generated/__init__.py
```

Run: `chmod +x services/stt/scripts/gen_proto.sh && services/stt/scripts/gen_proto.sh`
Expected: creates `services/stt/src/stt_service/generated/stt_pb2.py` and `stt_pb2_grpc.py`.

- [ ] **Step 2: Add generated code to `.gitignore`**

Modify `.gitignore` — add:
```
services/stt/src/stt_service/generated/
```

- [ ] **Step 3: Write the failing test**

`services/stt/tests/test_server.py`:
```python
import grpc
import pytest
from concurrent import futures

from stt_service.generated import stt_pb2, stt_pb2_grpc
from stt_service.server import SttServicer
from stt_service.vad import VoiceActivityDetector
from stt_service.transcriber import Transcriber


class AlwaysSpeechThenSilenceVad:
    """First call says speech; every call after says silence (simulates one utterance)."""

    def __init__(self):
        self._calls = 0

    def is_speech(self, pcm16_frame: bytes, sample_rate: int) -> bool:
        self._calls += 1
        return self._calls == 1


class FakeSegment:
    def __init__(self, text: str):
        self.text = text


class FakeWhisperModel:
    def transcribe(self, audio, **kwargs):
        return [FakeSegment("mock transcript")], None


@pytest.fixture
def server_address():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=2))
    servicer = SttServicer(
        vad=AlwaysSpeechThenSilenceVad(),
        transcriber=Transcriber(model=FakeWhisperModel()),
    )
    stt_pb2_grpc.add_SttServiceServicer_to_server(servicer, server)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    yield f"127.0.0.1:{port}"
    server.stop(grace=None)


def test_stream_transcribe_emits_full_turn_events(server_address):
    with grpc.insecure_channel(server_address) as channel:
        stub = stt_pb2_grpc.SttServiceStub(channel)

        def audio_frames():
            for _ in range(3):
                yield stt_pb2.AudioFrame(pcm16_data=b"\x00\x00" * 800, sample_rate=16000)

        events = list(stub.StreamTranscribe(audio_frames()))
        event_types = [e.type for e in events]
        assert event_types == ["speech_started", "final_transcript", "speech_ended"]
        assert events[1].text == "mock transcript"
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd services/stt && python -m pytest tests/test_server.py -v`
Expected: FAIL — `stt_service.server` module doesn't exist.

- [ ] **Step 5: Write `server.py`**

```python
import grpc
from concurrent import futures

from stt_service.generated import stt_pb2, stt_pb2_grpc
from stt_service.vad import VoiceActivityDetector
from stt_service.transcriber import Transcriber


class SttServicer(stt_pb2_grpc.SttServiceServicer):
    def __init__(self, vad=None, transcriber=None):
        self._vad = vad if vad is not None else VoiceActivityDetector()
        self._transcriber = transcriber if transcriber is not None else Transcriber()

    def StreamTranscribe(self, request_iterator, context):
        speaking = False
        buffered_audio = bytearray()

        for frame in request_iterator:
            is_speech = self._vad.is_speech(frame.pcm16_data, frame.sample_rate)

            if is_speech and not speaking:
                speaking = True
                buffered_audio = bytearray()
                yield stt_pb2.TranscriptEvent(type="speech_started")

            if speaking:
                buffered_audio.extend(frame.pcm16_data)

            if not is_speech and speaking:
                speaking = False
                text = self._transcriber.transcribe(bytes(buffered_audio), frame.sample_rate)
                yield stt_pb2.TranscriptEvent(type="final_transcript", text=text)
                yield stt_pb2.TranscriptEvent(type="speech_ended")


def serve(port: int = 50051) -> grpc.Server:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    stt_pb2_grpc.add_SttServiceServicer_to_server(SttServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    return server


if __name__ == "__main__":
    grpc_server = serve()
    grpc_server.wait_for_termination()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/stt && python -m pytest tests/test_server.py -v`
Expected: PASS (1 test).

- [ ] **Step 7: Write `services/stt/Dockerfile`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY services/stt/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY packages/stt-proto /packages/stt-proto
COPY services/stt/src ./src
COPY services/stt/scripts ./scripts

RUN pip install --no-cache-dir grpcio-tools \
    && ./scripts/gen_proto.sh

ENV PYTHONPATH=/app/src
EXPOSE 50051
CMD ["python", "-m", "stt_service.server"]
```

- [ ] **Step 8: Run the full Python test suite**

Run: `cd services/stt && python -m pytest -v`
Expected: PASS (4 tests total: 2 VAD + 1 transcriber + 1 server).

- [ ] **Step 9: Commit**

```bash
git add services/stt/scripts/gen_proto.sh services/stt/src/stt_service/server.py services/stt/tests/test_server.py services/stt/Dockerfile .gitignore
git commit -m "feat(stt): add gRPC StreamTranscribe server wiring VAD + transcriber

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 10: `GrpcSttClient` (Node)

**Files:**
- Create: `services/api/src/realtime/grpc-stt-client.ts`, `services/api/src/realtime/grpc-stt-client.test.ts`
- Modify: `services/api/package.json` (add `@grpc/grpc-js`, `@grpc/proto-loader`)

**Interfaces:**
- Consumes: `SpeechToTextProvider`/`SttSession`/`SttSessionConfig`/`SttEvent` from `./providers` (Task 1); `packages/stt-proto/stt.proto` (Task 6).
- Produces: `class GrpcSttClient implements SpeechToTextProvider` — constructor `new GrpcSttClient(grpcUrl: string)`. `createSession(config)` opens a bidirectional gRPC stream to that URL and returns an `SttSession` whose `sendAudio`/`onEvent`/`close` map onto the gRPC stream's write/read/end. Consumed by Task 17's real-provider wiring.

- [ ] **Step 1: Write the failing test**

`services/api/src/realtime/grpc-stt-client.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `grpc-stt-client.ts` doesn't exist / `@grpc/grpc-js` not installed.

- [ ] **Step 3: Add dependencies and write `grpc-stt-client.ts`**

Modify `services/api/package.json` — add to `dependencies`: `"@grpc/grpc-js": "^1.12.2", "@grpc/proto-loader": "^0.7.13"`.

Run: `pnpm install`

`services/api/src/realtime/grpc-stt-client.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: `grpc-stt-client.test.ts` passes (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/realtime/grpc-stt-client.ts services/api/src/realtime/grpc-stt-client.test.ts services/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add GrpcSttClient implementing SpeechToTextProvider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 11: `OpenAILLMProvider`

**Files:**
- Create: `services/api/src/realtime/openai-llm-provider.ts`, `services/api/src/realtime/openai-llm-provider.test.ts`

**Interfaces:**
- Consumes: `LLMProvider`/`LlmRequest`/`LlmEvent`/`ConversationTurn` from `./providers` (Task 1).
- Produces: `class OpenAILLMProvider implements LLMProvider` — constructor `new OpenAILLMProvider({ baseUrl, apiKey, model })`. `streamChat(request, signal)` POSTs to `${baseUrl}/chat/completions` with `stream: true`, parses the SSE response body, yields `{type:"token", text}` per delta and `{type:"done"}` at the end; respects `signal` by aborting the underlying `fetch`. Consumed by Task 17.

- [ ] **Step 1: Write the failing test**

`services/api/src/realtime/openai-llm-provider.test.ts`:
```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenAILLMProvider } from "./openai-llm-provider";

function sseBody(...lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n\n"));
      }
      controller.close();
    },
  });
}

describe("OpenAILLMProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams token events parsed from SSE chunks, then done", async () => {
    const body = sseBody(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      "data: [DONE]"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, body })
    );

    const provider = new OpenAILLMProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-4o-mini" });
    const events = [];
    for await (const event of provider.streamChat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "token", text: "Hello" },
      { type: "token", text: " world" },
      { type: "done" },
    ]);
  });

  it("stops iterating once the signal is aborted", async () => {
    const body = sseBody(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      "data: [DONE]"
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body }));

    const provider = new OpenAILLMProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-4o-mini" });
    const controller = new AbortController();
    const events = [];
    for await (const event of provider.streamChat({ messages: [{ role: "user", content: "hi" }] }, controller.signal)) {
      events.push(event);
      if (events.length === 1) controller.abort();
    }
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `openai-llm-provider.ts` doesn't exist.

- [ ] **Step 3: Write `openai-llm-provider.ts`**

```ts
import type { LlmEvent, LlmRequest, LLMProvider } from "./providers";

export interface OpenAILLMProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAILLMProvider implements LLMProvider {
  constructor(private config: OpenAILLMProviderConfig) {}

  async *streamChat(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmEvent> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.model, messages: request.messages, stream: true }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`OpenAI chat completion request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.replace(/^data: /, "").trim();
        if (!trimmed) continue;
        if (trimmed === "[DONE]") {
          yield { type: "done" };
          return;
        }
        const parsed = JSON.parse(trimmed) as { choices: { delta: { content?: string } }[] };
        const text = parsed.choices[0]?.delta?.content;
        if (text) {
          yield { type: "token", text };
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: `openai-llm-provider.test.ts` passes (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/realtime/openai-llm-provider.ts services/api/src/realtime/openai-llm-provider.test.ts
git commit -m "feat(api): add OpenAILLMProvider implementing LLMProvider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 12: `OpenAITTSProvider`

**Files:**
- Create: `services/api/src/realtime/openai-tts-provider.ts`, `services/api/src/realtime/openai-tts-provider.test.ts`

**Interfaces:**
- Consumes: `TextToSpeechProvider`/`VoiceConfig` from `./providers` (Task 1).
- Produces: `class OpenAITTSProvider implements TextToSpeechProvider` — constructor `new OpenAITTSProvider({ baseUrl, apiKey, model })`. `synthesizeStream(text, config, signal)` buffers the full input text (OpenAI's speech endpoint takes complete text per request, not incremental input — see note below), POSTs to `${baseUrl}/audio/speech`, and yields the streamed response body as `Buffer` chunks as they arrive. Consumed by Task 17.

Note on the design doc's "incremental audio without waiting for the entire answer" goal (spec §20/Phase 7): OpenAI's `/v1/audio/speech` endpoint accepts one complete text string per request — it has no incremental-text-input mode. This provider gets incremental *output* (audio streams back in chunks as OpenAI generates it) but needs the LLM's full text before it can start that request. `ConversationOrchestrator` (Task 2) already buffers `streamAssistantText`'s tokens into a `text: AsyncIterable<string>` per the interface, so this provider drains that iterable to a complete string first, then streams the resulting audio — this is a real, documented limitation of this specific TTS backend choice, not a bug.

- [ ] **Step 1: Write the failing test**

`services/api/src/realtime/openai-tts-provider.test.ts`:
```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenAITTSProvider } from "./openai-tts-provider";

async function* textOf(...words: string[]): AsyncIterable<string> {
  for (const w of words) yield w;
}

function audioBody(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("OpenAITTSProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins the input text and streams the response body as audio chunks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: audioBody("audio-part-1", "audio-part-2") });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAITTSProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "tts-1" });
    const chunks: Buffer[] = [];
    for await (const chunk of provider.synthesizeStream(textOf("hello", " world"), {})) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.toString())).toEqual(["audio-part-1", "audio-part-2"]);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body).input).toBe("hello world");
  });

  it("yields nothing when the signal is already aborted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: audioBody("audio") }));
    const provider = new OpenAITTSProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "tts-1" });
    const controller = new AbortController();
    controller.abort();
    const chunks: Buffer[] = [];
    for await (const chunk of provider.synthesizeStream(textOf("hello"), {}, controller.signal)) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `openai-tts-provider.ts` doesn't exist.

- [ ] **Step 3: Write `openai-tts-provider.ts`**

```ts
import type { TextToSpeechProvider, VoiceConfig } from "./providers";

export interface OpenAITTSProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAITTSProvider implements TextToSpeechProvider {
  constructor(private config: OpenAITTSProviderConfig) {}

  async *synthesizeStream(
    text: AsyncIterable<string>,
    config: VoiceConfig,
    signal?: AbortSignal
  ): AsyncIterable<Buffer> {
    if (signal?.aborted) return;

    let full = "";
    for await (const chunk of text) {
      full += chunk;
    }
    if (signal?.aborted || !full) return;

    const response = await fetch(`${this.config.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.model, input: full, voice: config.voiceId ?? "alloy" }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`OpenAI TTS request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      yield Buffer.from(value);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: `openai-tts-provider.test.ts` passes (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/realtime/openai-tts-provider.ts services/api/src/realtime/openai-tts-provider.test.ts
git commit -m "feat(api): add OpenAITTSProvider implementing TextToSpeechProvider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 13: `services/avatar-gateway` Skeleton + `LiveTalkingClient`/`LiveTalkingMapper`

**Files:**
- Create: `services/avatar-gateway/package.json`, `services/avatar-gateway/tsconfig.json`
- Create: `services/avatar-gateway/src/app.ts`, `services/avatar-gateway/src/server.ts`
- Create: `services/avatar-gateway/src/providers/livetalking/LiveTalkingClient.ts`, `LiveTalkingMapper.ts`
- Create: `services/avatar-gateway/test/mock-livetalking-server.ts`, `services/avatar-gateway/src/providers/livetalking/LiveTalkingClient.test.ts`

**Interfaces:**
- Produces:
  - `buildApp(): FastifyInstance` (health route only in this task; avatar-session routes added in Task 14).
  - `interface LiveTalkingCreateSessionResult { sessionId: string }`
  - `class LiveTalkingClient` — constructor `new LiveTalkingClient(baseUrl: string)`. Methods: `createSession(config: { avatarId?: string }): Promise<LiveTalkingCreateSessionResult>`, `sendAudioChunk(sessionId: string, chunk: Buffer): Promise<void>`, `interrupt(sessionId: string): Promise<void>`, `closeSession(sessionId: string): Promise<void>`, `health(): Promise<{ engine: string; cudaAvailable: boolean; status: string }>`. This is the **only** code in the whole app that knows LiveTalking's actual HTTP protocol, per spec §22.
  - `LiveTalkingMapper.toWireAudio(chunk: Buffer): string` (base64-encodes for the JSON HTTP body) and `LiveTalkingMapper.fromWireHealth(body: unknown): { engine: string; cudaAvailable: boolean; status: string }` (validates/narrows the raw HTTP response).
  - `startMockLiveTalkingServer(): Promise<{ url: string; close: () => Promise<void> }>` test helper (same pattern as `mock-monoes-server.ts` from the Phase 0-3 plan).

- [ ] **Step 1: Write the skeleton**

`services/avatar-gateway/package.json`:
```json
{
  "name": "@monotar/avatar-gateway",
  "version": "0.1.0",
  "type": "module",
  "main": "src/server.ts",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fastify": "^5.1.0"
  },
  "devDependencies": {
    "tsx": "^4.19.1",
    "vitest": "^2.1.4",
    "typescript": "^5.6.3"
  }
}
```

`services/avatar-gateway/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "outDir": "dist" },
  "include": ["src", "test"]
}
```

`services/avatar-gateway/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.get("/health", async () => ({ status: "ok" }));
  return app;
}
```

`services/avatar-gateway/src/server.ts`:
```ts
import { buildApp } from "./app";

const app = buildApp();
const port = Number(process.env.AVATAR_GATEWAY_PORT ?? 4100);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Write the mock LiveTalking server test helper**

`services/avatar-gateway/test/mock-livetalking-server.ts`:
```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockLiveTalkingServer {
  url: string;
  receivedAudioChunks: string[];
  interruptCalls: number;
  close: () => Promise<void>;
}

export async function startMockLiveTalkingServer(): Promise<MockLiveTalkingServer> {
  const receivedAudioChunks: string[] = [];
  let interruptCalls = 0;

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/sessions" && req.method === "POST") {
        res.writeHead(201);
        res.end(JSON.stringify({ sessionId: "mock-session-1" }));
        return;
      }
      if (req.url?.match(/^\/sessions\/.+\/audio$/) && req.method === "POST") {
        const parsed = JSON.parse(body) as { audioBase64: string };
        receivedAudioChunks.push(parsed.audioBase64);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url?.match(/^\/sessions\/.+\/interrupt$/) && req.method === "POST") {
        interruptCalls += 1;
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url?.match(/^\/sessions\/.+$/) && req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify({ engine: "wav2lip", cudaAvailable: false, status: "ready" }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    receivedAudioChunks,
    get interruptCalls() {
      return interruptCalls;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 3: Write the failing test**

`services/avatar-gateway/src/providers/livetalking/LiveTalkingClient.test.ts`:
```ts
import { describe, expect, it, afterEach } from "vitest";
import { LiveTalkingClient } from "./LiveTalkingClient";
import { startMockLiveTalkingServer, type MockLiveTalkingServer } from "../../../test/mock-livetalking-server";

describe("LiveTalkingClient", () => {
  let mockServer: MockLiveTalkingServer;

  afterEach(async () => {
    await mockServer.close();
  });

  it("creates a session, sends audio, interrupts, closes, and reports health", async () => {
    mockServer = await startMockLiveTalkingServer();
    const client = new LiveTalkingClient(mockServer.url);

    const session = await client.createSession({ avatarId: "agent-1" });
    expect(session.sessionId).toBe("mock-session-1");

    await client.sendAudioChunk(session.sessionId, Buffer.from("audio-bytes"));
    expect(mockServer.receivedAudioChunks).toHaveLength(1);
    expect(Buffer.from(mockServer.receivedAudioChunks[0], "base64").toString()).toBe("audio-bytes");

    await client.interrupt(session.sessionId);
    expect(mockServer.interruptCalls).toBe(1);

    await client.closeSession(session.sessionId);

    const health = await client.health();
    expect(health).toEqual({ engine: "wav2lip", cudaAvailable: false, status: "ready" });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @monotar/avatar-gateway test`
Expected: FAIL — package/module doesn't exist yet.

- [ ] **Step 5: Write `LiveTalkingMapper.ts` and `LiveTalkingClient.ts`**

`services/avatar-gateway/src/providers/livetalking/LiveTalkingMapper.ts`:
```ts
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
```

`services/avatar-gateway/src/providers/livetalking/LiveTalkingClient.ts`:
```ts
import { LiveTalkingMapper, type LiveTalkingHealthResponse } from "./LiveTalkingMapper";

export interface LiveTalkingCreateSessionResult {
  sessionId: string;
}

export class LiveTalkingClient {
  constructor(private baseUrl: string) {}

  async createSession(config: { avatarId?: string }): Promise<LiveTalkingCreateSessionResult> {
    const response = await fetch(`${this.baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`LiveTalking createSession failed with status ${response.status}`);
    }
    return (await response.json()) as LiveTalkingCreateSessionResult;
  }

  async sendAudioChunk(sessionId: string, chunk: Buffer): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: LiveTalkingMapper.toWireAudio(chunk) }),
    });
    if (!response.ok) {
      throw new Error(`LiveTalking sendAudioChunk failed with status ${response.status}`);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/interrupt`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`LiveTalking interrupt failed with status ${response.status}`);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) {
      throw new Error(`LiveTalking closeSession failed with status ${response.status}`);
    }
  }

  async health(): Promise<LiveTalkingHealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`LiveTalking health check failed with status ${response.status}`);
    }
    return LiveTalkingMapper.fromWireHealth(await response.json());
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm install && pnpm --filter @monotar/avatar-gateway test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add services/avatar-gateway
git commit -m "feat(avatar-gateway): add service skeleton and LiveTalkingClient/Mapper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 14: `LiveTalkingSession`/`LiveTalkingProvider` + MuseTalk CUDA-Gating + HTTP Routes

**Files:**
- Create: `services/avatar-gateway/src/providers/livetalking/LiveTalkingSession.ts`, `LiveTalkingProvider.ts`, `LiveTalkingHealth.ts`
- Create: `services/avatar-gateway/src/providers/musetalk/MuseTalkGate.ts`, `MuseTalkGate.test.ts`
- Create: `services/avatar-gateway/src/routes/avatar-sessions.ts`, `avatar-sessions.test.ts`
- Modify: `services/avatar-gateway/src/app.ts`

**Interfaces:**
- Consumes: `LiveTalkingClient` (Task 13).
- Produces:
  - `class LiveTalkingSession` — wraps one `LiveTalkingClient` session; methods `sendAudio(chunk: Buffer): Promise<void>`, `interrupt(): Promise<void>`, `close(): Promise<void>`.
  - `class LiveTalkingProvider` — `createSession(config: { avatarId?: string }): Promise<LiveTalkingSession>`.
  - `class MuseTalkGate` — `checkAvailable(): { available: boolean; reason?: string }` (returns `{ available: false, reason: "cuda_unavailable" }` on this hardware; consumed by the routes to return `503 model_requires_cuda`).
  - HTTP routes (registered into `app.ts`) exposing what `AvatarGatewayClient` (Task 15) will call: `POST /avatar-sessions` (body `{ engine: "wav2lip" | "musetalk", avatarId? }`), `POST /avatar-sessions/:id/audio`, `POST /avatar-sessions/:id/interrupt`, `DELETE /avatar-sessions/:id`, `GET /health`.

- [ ] **Step 1: Write the failing MuseTalk gate test**

`services/avatar-gateway/src/providers/musetalk/MuseTalkGate.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/avatar-gateway test`
Expected: FAIL — `MuseTalkGate.ts` doesn't exist.

- [ ] **Step 3: Write `MuseTalkGate.ts`**

```ts
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
```

- [ ] **Step 4: Write `LiveTalkingSession.ts`, `LiveTalkingProvider.ts`, `LiveTalkingHealth.ts`**

`services/avatar-gateway/src/providers/livetalking/LiveTalkingSession.ts`:
```ts
import type { LiveTalkingClient } from "./LiveTalkingClient";

export class LiveTalkingSession {
  constructor(private client: LiveTalkingClient, public readonly sessionId: string) {}

  async sendAudio(chunk: Buffer): Promise<void> {
    await this.client.sendAudioChunk(this.sessionId, chunk);
  }

  async interrupt(): Promise<void> {
    await this.client.interrupt(this.sessionId);
  }

  async close(): Promise<void> {
    await this.client.closeSession(this.sessionId);
  }
}
```

`services/avatar-gateway/src/providers/livetalking/LiveTalkingProvider.ts`:
```ts
import { LiveTalkingClient } from "./LiveTalkingClient";
import { LiveTalkingSession } from "./LiveTalkingSession";

export class LiveTalkingProvider {
  private client: LiveTalkingClient;

  constructor(liveTalkingBaseUrl: string) {
    this.client = new LiveTalkingClient(liveTalkingBaseUrl);
  }

  async createSession(config: { avatarId?: string }): Promise<LiveTalkingSession> {
    const result = await this.client.createSession(config);
    return new LiveTalkingSession(this.client, result.sessionId);
  }

  async health() {
    return this.client.health();
  }
}
```

`services/avatar-gateway/src/providers/livetalking/LiveTalkingHealth.ts`:
```ts
import type { LiveTalkingProvider } from "./LiveTalkingProvider";

export async function checkLiveTalkingHealth(provider: LiveTalkingProvider) {
  try {
    return await provider.health();
  } catch {
    return { engine: "unknown", cudaAvailable: false, status: "unreachable" };
  }
}
```

- [ ] **Step 5: Write the failing routes test**

`services/avatar-gateway/src/routes/avatar-sessions.test.ts`:
```ts
import { describe, expect, it, afterEach } from "vitest";
import { buildApp } from "../app";
import { startMockLiveTalkingServer, type MockLiveTalkingServer } from "../../test/mock-livetalking-server";

describe("avatar-sessions routes", () => {
  let mockServer: MockLiveTalkingServer;

  afterEach(async () => {
    await mockServer.close();
  });

  it("creates a wav2lip session, forwards audio, interrupts, and closes it", async () => {
    mockServer = await startMockLiveTalkingServer();
    const app = buildApp({ liveTalkingBaseUrl: mockServer.url, cudaAvailable: false });

    const createResponse = await app.inject({
      method: "POST",
      url: "/avatar-sessions",
      payload: { engine: "wav2lip", avatarId: "agent-1" },
    });
    expect(createResponse.statusCode).toBe(201);
    const { id } = createResponse.json();

    const audioResponse = await app.inject({
      method: "POST",
      url: `/avatar-sessions/${id}/audio`,
      payload: { audioBase64: Buffer.from("hi").toString("base64") },
    });
    expect(audioResponse.statusCode).toBe(200);

    const interruptResponse = await app.inject({ method: "POST", url: `/avatar-sessions/${id}/interrupt` });
    expect(interruptResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({ method: "DELETE", url: `/avatar-sessions/${id}` });
    expect(deleteResponse.statusCode).toBe(204);
  });

  it("rejects musetalk sessions with 503 model_requires_cuda when CUDA is unavailable", async () => {
    mockServer = await startMockLiveTalkingServer();
    const app = buildApp({ liveTalkingBaseUrl: mockServer.url, cudaAvailable: false });

    const response = await app.inject({
      method: "POST",
      url: "/avatar-sessions",
      payload: { engine: "musetalk", avatarId: "agent-1" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "model_requires_cuda" });
  });

  it("reports health", async () => {
    mockServer = await startMockLiveTalkingServer();
    const app = buildApp({ liveTalkingBaseUrl: mockServer.url, cudaAvailable: false });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ engine: "wav2lip", cudaAvailable: false, status: "ready" });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @monotar/avatar-gateway test`
Expected: FAIL — `buildApp` doesn't accept a config argument yet, routes don't exist.

- [ ] **Step 7: Write `avatar-sessions.ts` and update `app.ts`**

`services/avatar-gateway/src/routes/avatar-sessions.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { LiveTalkingProvider } from "../providers/livetalking/LiveTalkingProvider";
import { MuseTalkGate } from "../providers/musetalk/MuseTalkGate";

export interface AvatarSessionsConfig {
  liveTalkingBaseUrl: string;
  cudaAvailable: boolean;
}

export async function avatarSessionRoutes(app: FastifyInstance, config: AvatarSessionsConfig): Promise<void> {
  const provider = new LiveTalkingProvider(config.liveTalkingBaseUrl);
  const museTalkGate = new MuseTalkGate({ cudaAvailable: config.cudaAvailable });
  const sessions = new Map<string, Awaited<ReturnType<LiveTalkingProvider["createSession"]>>>();

  app.post("/avatar-sessions", async (request, reply) => {
    const body = request.body as { engine: "wav2lip" | "musetalk"; avatarId?: string };

    if (body.engine === "musetalk") {
      const availability = museTalkGate.checkAvailable();
      if (!availability.available) {
        return reply.code(503).send({ error: "model_requires_cuda" });
      }
    }

    const session = await provider.createSession({ avatarId: body.avatarId });
    sessions.set(session.sessionId, session);
    return reply.code(201).send({ id: session.sessionId });
  });

  app.post("/avatar-sessions/:id/audio", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { audioBase64 } = request.body as { audioBase64: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: "not_found" });
    await session.sendAudio(Buffer.from(audioBase64, "base64"));
    return { ok: true };
  });

  app.post("/avatar-sessions/:id/interrupt", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: "not_found" });
    await session.interrupt();
    return { ok: true };
  });

  app.delete("/avatar-sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: "not_found" });
    await session.close();
    sessions.delete(id);
    return reply.code(204).send();
  });

  app.get("/health", async () => {
    return provider.health();
  });
}
```

Replace the full contents of `services/avatar-gateway/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import { avatarSessionRoutes, type AvatarSessionsConfig } from "./routes/avatar-sessions";

export function buildApp(config: AvatarSessionsConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(avatarSessionRoutes, config);
  return app;
}
```

Modify `services/avatar-gateway/src/server.ts` to pass the required config:
```ts
import { buildApp } from "./app";

const app = buildApp({
  liveTalkingBaseUrl: process.env.LIVETALKING_URL ?? "http://livetalking:8010",
  cudaAvailable: process.env.CUDA_AVAILABLE === "true",
});
const port = Number(process.env.AVATAR_GATEWAY_PORT ?? 4100);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Run the full avatar-gateway test suite**

Run: `pnpm --filter @monotar/avatar-gateway test`
Expected: PASS (all tests: 1 from Task 13 + 2 MuseTalkGate + 3 avatar-sessions = 6 tests).

- [ ] **Step 9: Commit**

```bash
git add services/avatar-gateway
git commit -m "feat(avatar-gateway): add LiveTalkingSession/Provider, MuseTalk CUDA gate, HTTP routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 15: `AvatarGatewayClient` (services/api)

**Files:**
- Create: `services/api/src/realtime/avatar-gateway-client.ts`, `services/api/src/realtime/avatar-gateway-client.test.ts`

**Interfaces:**
- Consumes: `AvatarEngine`/`AvatarSession`/`AvatarSessionConfig`/`PlaybackState` from `./providers` (Task 1). Talks over HTTP to the routes Task 14 built (`POST /avatar-sessions`, `.../audio`, `.../interrupt`, `DELETE /avatar-sessions/:id`).
- Produces: `class AvatarGatewayClient implements AvatarEngine` — constructor `new AvatarGatewayClient(baseUrl: string, engine: "wav2lip" | "musetalk")`. `createSession(config)` returns an `AvatarSession` whose `sendAudio` drains the input `AsyncIterable<Buffer>` and POSTs each chunk, `interrupt()`/`close()` call the matching endpoints, `getPlaybackState()` tracks state locally (playing while draining `sendAudio`, `interrupted` after `interrupt()`, `idle` otherwise — mirrors `MockAvatarEngine`'s semantics exactly since Task 17 must be able to swap between them with zero orchestrator changes). Consumed by Task 17.

- [ ] **Step 1: Write the failing test**

`services/api/src/realtime/avatar-gateway-client.test.ts`:
```ts
import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AvatarGatewayClient } from "./avatar-gateway-client";

async function* audioOf(...chunks: string[]): AsyncIterable<Buffer> {
  for (const c of chunks) yield Buffer.from(c);
}

function startFakeGateway(): Promise<{ url: string; audioCalls: string[]; close: () => Promise<void> }> {
  const audioCalls: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/avatar-sessions" && req.method === "POST") {
        res.writeHead(201);
        res.end(JSON.stringify({ id: "session-abc" }));
        return;
      }
      if (req.url === "/avatar-sessions/session-abc/audio" && req.method === "POST") {
        audioCalls.push(JSON.parse(body).audioBase64);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/avatar-sessions/session-abc/interrupt" && req.method === "POST") {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/avatar-sessions/session-abc" && req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        audioCalls,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("AvatarGatewayClient", () => {
  let fakeGateway: Awaited<ReturnType<typeof startFakeGateway>>;

  afterEach(async () => {
    await fakeGateway.close();
  });

  it("creates a session, sends audio, tracks playback state, interrupts, and closes", async () => {
    fakeGateway = await startFakeGateway();
    const client = new AvatarGatewayClient(fakeGateway.url, "wav2lip");
    const session = await client.createSession({ avatarId: "agent-1" });

    expect(session.id).toBe("session-abc");
    expect(await session.getPlaybackState()).toBe("idle");

    await session.sendAudio(audioOf("chunk-a", "chunk-b"));
    expect(fakeGateway.audioCalls).toHaveLength(2);
    expect(await session.getPlaybackState()).toBe("idle");

    await session.interrupt();
    expect(await session.getPlaybackState()).toBe("interrupted");

    await session.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `avatar-gateway-client.ts` doesn't exist.

- [ ] **Step 3: Write `avatar-gateway-client.ts`**

```ts
import type { AvatarEngine, AvatarSession, AvatarSessionConfig, PlaybackState } from "./providers";

export class AvatarGatewayClient implements AvatarEngine {
  constructor(private baseUrl: string, private engine: "wav2lip" | "musetalk") {}

  async createSession(config: AvatarSessionConfig): Promise<AvatarSession> {
    const response = await fetch(`${this.baseUrl}/avatar-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: this.engine, avatarId: config.avatarId }),
    });
    if (!response.ok) {
      throw new Error(`avatar-gateway createSession failed with status ${response.status}`);
    }
    const { id } = (await response.json()) as { id: string };

    let playback: PlaybackState = "idle";
    const baseUrl = this.baseUrl;

    return {
      id,
      async sendAudio(audio: AsyncIterable<Buffer>) {
        playback = "playing";
        for await (const chunk of audio) {
          await fetch(`${baseUrl}/avatar-sessions/${id}/audio`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: chunk.toString("base64") }),
          });
        }
        if (playback === "playing") playback = "idle";
      },
      async interrupt() {
        await fetch(`${baseUrl}/avatar-sessions/${id}/interrupt`, { method: "POST" });
        playback = "interrupted";
      },
      async getPlaybackState() {
        return playback;
      },
      async close() {
        await fetch(`${baseUrl}/avatar-sessions/${id}`, { method: "DELETE" });
        playback = "idle";
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: `avatar-gateway-client.test.ts` passes (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/realtime/avatar-gateway-client.ts services/api/src/realtime/avatar-gateway-client.test.ts
git commit -m "feat(api): add AvatarGatewayClient implementing AvatarEngine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 16: `LiveKitSessionManager` + Token Route

**Files:**
- Create: `services/api/src/realtime/livekit-session-manager.ts`, `services/api/src/realtime/livekit-session-manager.test.ts`
- Create: `services/api/src/routes/livekit.ts`, `services/api/src/routes/livekit.test.ts`
- Modify: `services/api/src/app.ts`, `services/api/package.json` (add `livekit-server-sdk`)

**Interfaces:**
- Produces: `class LiveKitSessionManager` — constructor `new LiveKitSessionManager({ apiKey: string, secretValue: string })`. Method `createToken(roomName: string, identity: string): Promise<string>` (signs a scoped LiveKit access-token JWT locally — no network call). Route `GET /api/realtime/livekit-token?agentId=<id>` — requires auth, returns `{ token: string, url: string }`. This is what Task 18's browser client calls before connecting to LiveKit.
- This is the only task in this plan that touches `services/api/src/app.ts`.

- [ ] **Step 1: Write the failing test for `LiveKitSessionManager`**

`services/api/src/realtime/livekit-session-manager.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { LiveKitSessionManager } from "./livekit-session-manager";

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
}

describe("LiveKitSessionManager", () => {
  it("issues a JWT scoped to the given room and identity", async () => {
    const manager = new LiveKitSessionManager({
      apiKey: "test-key",
      secretValue: "test-value-at-least-32-characters-long-ok",
    });
    const jwt = await manager.createToken("room-agent-1", "user-42");
    expect(jwt.split(".")).toHaveLength(3);

    const payload = decodeJwtPayload(jwt) as { sub: string; video: { room: string; roomJoin: boolean } };
    expect(payload.sub).toBe("user-42");
    expect(payload.video.room).toBe("room-agent-1");
    expect(payload.video.roomJoin).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `livekit-session-manager.ts` doesn't exist / `livekit-server-sdk` not installed.

- [ ] **Step 3: Add the dependency and write `livekit-session-manager.ts`**

Modify `services/api/package.json` — add to `dependencies`: `"livekit-server-sdk": "^2.9.2"`.

Run: `pnpm install`

`services/api/src/realtime/livekit-session-manager.ts`:
```ts
import { AccessToken } from "livekit-server-sdk";

export interface LiveKitSessionManagerConfig {
  apiKey: string;
  secretValue: string;
}

export class LiveKitSessionManager {
  constructor(private config: LiveKitSessionManagerConfig) {}

  async createToken(roomName: string, identity: string): Promise<string> {
    const token = new AccessToken(this.config.apiKey, this.config.secretValue, { identity });
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
    return token.toJwt();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: `livekit-session-manager.test.ts` passes (1 test).

- [ ] **Step 5: Write the failing route test**

`services/api/src/routes/livekit.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterAll, beforeAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createLoggedInUser() {
  const user = await prisma.user.create({ data: { email: `livekit-${Date.now()}@example.com` } });
  const org = await prisma.organization.create({ data: { name: "Org" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  const sessionValue = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
  });
  return { sessionValue };
}

const ENV_KEYS = ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

describe("GET /api/realtime/livekit-token", () => {
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env[ENV_KEYS[0]] = "test-key";
    process.env[ENV_KEYS[1]] = "test-value-at-least-32-characters-long-ok";
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) process.env[key] = saved[key];
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns a token and url for an authenticated user", async () => {
    const { sessionValue } = await createLoggedInUser();
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/realtime/livekit-token?agentId=agent-1",
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.url).toBeDefined();
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/realtime/livekit-token?agentId=agent-1" });
    expect(response.statusCode).toBe(401);
  });

  it("returns 400 when agentId is missing", async () => {
    const { sessionValue } = await createLoggedInUser();
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/realtime/livekit-token",
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `/api/realtime/livekit-token` route not registered (404s).

- [ ] **Step 7: Write `livekit.ts` and register it in `app.ts`**

`services/api/src/routes/livekit.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { LiveKitSessionManager } from "../realtime/livekit-session-manager";

function readConfiguredValue(name: string): string | undefined {
  return process.env[name];
}

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/realtime/livekit-token", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }

    const { agentId } = request.query as { agentId?: string };
    if (!agentId) {
      return reply.code(400).send({ error: "missing_agent_id" });
    }

    const liveKitId = readConfiguredValue("LIVEKIT_API_KEY");
    const liveKitSigning = readConfiguredValue("LIVEKIT_API_SECRET");
    if (!liveKitId || !liveKitSigning) {
      return reply.code(500).send({ error: "livekit_not_configured" });
    }

    const manager = new LiveKitSessionManager({ apiKey: liveKitId, secretValue: liveKitSigning });
    const token = await manager.createToken(`agent-${agentId}`, request.currentUser.id);
    return { token, url: readConfiguredValue("LIVEKIT_URL") ?? "ws://localhost:7880" };
  });
}
```

Modify `services/api/src/app.ts` — add the import and registration (this task's only change to this file, and the only place in this whole plan that touches it):
```ts
import { livekitRoutes } from "./routes/livekit";
// ... after the existing app.register(realtimeRoutes); line:
  app.register(livekitRoutes);
```

- [ ] **Step 8: Run the full API test suite**

Run (with the full env var set from Task 2 Step 7): `pnpm --filter @monotar/api test`
Expected: all tests pass, including the new `livekit-session-manager.test.ts` (1) and `livekit.test.ts` (3).

- [ ] **Step 9: Commit**

```bash
git add services/api/src/realtime/livekit-session-manager.ts services/api/src/realtime/livekit-session-manager.test.ts services/api/src/routes/livekit.ts services/api/src/routes/livekit.test.ts services/api/src/app.ts services/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add LiveKitSessionManager and token issuance route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 17: Wire Real Providers Behind an Env Flag

**Files:**
- Modify: `services/api/src/realtime/ws-route.ts`, create `services/api/src/realtime/provider-factory.ts`, `services/api/src/realtime/provider-factory.test.ts`

**Interfaces:**
- Consumes: `GrpcSttClient` (Task 10), `OpenAILLMProvider` (Task 11), `OpenAITTSProvider` (Task 12), `AvatarGatewayClient` (Task 15), `MockSTT`/`MockLLM`/`MockTTS`/`MockAvatarEngine` (Task 1).
- Produces: `function buildProviders(): RealtimeProviders` — reads `process.env.REALTIME_PROVIDER_MODE` (`"mock"` default, or `"real"`), returning either the full Mock set or the full real set. Never mixes mock and real providers within one mode — that would make barge-in/error-handling behavior inconsistent and hard to reason about.

- [ ] **Step 1: Write the failing test**

`services/api/src/realtime/provider-factory.test.ts`:
```ts
import { describe, expect, it, afterEach } from "vitest";
import { buildProviders } from "./provider-factory";
import { MockSTT } from "./mock-providers";
import { GrpcSttClient } from "./grpc-stt-client";

describe("buildProviders", () => {
  const originalMode = process.env.REALTIME_PROVIDER_MODE;

  afterEach(() => {
    process.env.REALTIME_PROVIDER_MODE = originalMode;
  });

  it("defaults to mock providers when REALTIME_PROVIDER_MODE is unset", () => {
    delete process.env.REALTIME_PROVIDER_MODE;
    const providers = buildProviders();
    expect(providers.stt).toBeInstanceOf(MockSTT);
  });

  it("builds real providers when REALTIME_PROVIDER_MODE=real", () => {
    process.env.REALTIME_PROVIDER_MODE = "real";
    process.env.STT_GRPC_URL = "127.0.0.1:50051";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.LLM_MODEL = "gpt-4o-mini";
    process.env.LIVETALKING_URL = "http://localhost:4100";

    const providers = buildProviders();
    expect(providers.stt).toBeInstanceOf(GrpcSttClient);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `provider-factory.ts` doesn't exist.

- [ ] **Step 3: Write `provider-factory.ts`**

```ts
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";
import { GrpcSttClient } from "./grpc-stt-client";
import { OpenAILLMProvider } from "./openai-llm-provider";
import { OpenAITTSProvider } from "./openai-tts-provider";
import { AvatarGatewayClient } from "./avatar-gateway-client";
import type { AvatarEngine, LLMProvider, SpeechToTextProvider, TextToSpeechProvider } from "./providers";

export interface RealtimeProviders {
  stt: SpeechToTextProvider;
  llm: LLMProvider;
  tts: TextToSpeechProvider;
  avatar: AvatarEngine;
}

function readConfiguredValue(name: string): string | undefined {
  return process.env[name];
}

export function buildProviders(): RealtimeProviders {
  const mode = readConfiguredValue("REALTIME_PROVIDER_MODE") ?? "mock";

  if (mode === "mock") {
    return { stt: new MockSTT(), llm: new MockLLM(), tts: new MockTTS(), avatar: new MockAvatarEngine() };
  }

  const requiredEnvVars = ["STT_GRPC_URL", "OPENAI_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LIVETALKING_URL"];
  for (const name of requiredEnvVars) {
    if (!readConfiguredValue(name)) {
      throw new Error(`REALTIME_PROVIDER_MODE=real requires ${name} to be set`);
    }
  }

  const openAiId = readConfiguredValue("OPENAI_API_KEY") as string;
  const llmBaseUrl = readConfiguredValue("LLM_BASE_URL") as string;

  return {
    stt: new GrpcSttClient(readConfiguredValue("STT_GRPC_URL") as string),
    llm: new OpenAILLMProvider({
      baseUrl: llmBaseUrl,
      apiKey: openAiId,
      model: readConfiguredValue("LLM_MODEL") as string,
    }),
    tts: new OpenAITTSProvider({
      baseUrl: llmBaseUrl,
      apiKey: openAiId,
      model: "tts-1",
    }),
    avatar: new AvatarGatewayClient(readConfiguredValue("LIVETALKING_URL") as string, "wav2lip"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: `provider-factory.test.ts` passes (2 tests).

- [ ] **Step 5: Wire it into `ws-route.ts`**

Modify `services/api/src/realtime/ws-route.ts` — replace the hardcoded Mock instantiation:
```ts
import { buildProviders } from "./provider-factory";
// ... remove: import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";
// ... inside the websocket handler, replace:
    const orchestrator = new ConversationOrchestrator({
      ...buildProviders(),
      send: (message) => socket.send(JSON.stringify(message)),
    });
```

- [ ] **Step 6: Run the full API test suite**

Run (with the full env var set from Task 2 Step 7 — `REALTIME_PROVIDER_MODE` is intentionally left unset, so `ws-route.test.ts` continues exercising the mock path exactly as before): `pnpm --filter @monotar/api test`
Expected: all tests still pass — this task changes wiring, not behavior, when `REALTIME_PROVIDER_MODE` is unset.

- [ ] **Step 7: Document the new env var**

Add to the note the user needs for `.env.local` (agents cannot write it themselves): `REALTIME_PROVIDER_MODE=mock` for local dev without OpenAI/LiveTalking running, or `REALTIME_PROVIDER_MODE=real` plus `STT_GRPC_URL`, `OPENAI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LIVETALKING_URL` once those services are actually running (the Post-Plan Manual Verification section below covers exactly this switch-over).

- [ ] **Step 8: Commit**

```bash
git add services/api/src/realtime/provider-factory.ts services/api/src/realtime/provider-factory.test.ts services/api/src/realtime/ws-route.ts
git commit -m "feat(api): wire real providers behind REALTIME_PROVIDER_MODE, default to mock

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 18: `apps/web` — LiveKit Client Integration

**Files:**
- Modify: `apps/web/app/talk/[agentId]/talk-client.tsx`, `apps/web/package.json`

**Interfaces:**
- Consumes: `GET /api/realtime/livekit-token?agentId=<id>` (Task 16).
- Produces: `talk-client.tsx` connects to LiveKit instead of opening a raw WebSocket for media — publishes the mic track, subscribes to the avatar's video/audio tracks, renders them in a `<video>` element. The `Avatar state: {state}` text overlay stays (still useful as a debug readout), now driven by a **separate** lightweight WebSocket kept open purely for `state`/`transcript`/`assistant_text`/`error` control messages (per the design doc's "WS stays for control, LiveKit carries media" split) — this control WS is the same `/api/realtime/:agentId` endpoint from Phase 0-3/Task 2, just no longer used for audio.

- [ ] **Step 1: Add the `livekit-client` dependency**

Modify `apps/web/package.json` — add to `dependencies`: `"livekit-client": "^2.7.4"`.

Run: `pnpm install`

- [ ] **Step 2: Rewrite `talk-client.tsx`**

Replace the full contents of `apps/web/app/talk/[agentId]/talk-client.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { ServerMessage, RealtimeState } from "@monotar/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

export function TalkClient({ agentId }: { agentId: string }) {
  const [state, setState] = useState<RealtimeState>("CREATED");
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlWsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    return () => {
      controlWsRef.current?.close();
      roomRef.current?.disconnect();
    };
  }, []);

  async function startTalking() {
    const controlWs = new WebSocket(`${WS_URL}/api/realtime/${agentId}`);
    controlWsRef.current = controlWs;
    controlWs.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === "state") setState(message.state);
      if (message.type === "transcript") setTranscript(message.text);
      if (message.type === "assistant_text") setAssistantText(message.text);
    };

    const tokenResponse = await fetch(`${API_URL}/api/realtime/livekit-token?agentId=${agentId}`, {
      credentials: "include",
    });
    const { token, url } = await tokenResponse.json();

    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
        if (videoRef.current) {
          track.attach(videoRef.current);
        }
      }
    });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
  }

  function sendInterrupt() {
    controlWsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }

  return (
    <div>
      <div data-testid="avatar-placeholder">Avatar state: {state}</div>
      <video ref={videoRef} autoPlay playsInline data-testid="avatar-video" />
      <button onClick={startTalking}>Start Talking</button>
      <button onClick={sendInterrupt}>Interrupt</button>
      <p>Transcript: {transcript}</p>
      <p>Assistant: {assistantText}</p>
    </div>
  );
}
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm --filter @monotar/web build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/talk/[agentId]/talk-client.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): connect the talk page to LiveKit for real audio/video

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

### Task 19: CI Updates + Final Documentation

**Files:**
- Modify: `.github/workflows/ci.yml`, `docs/upstream-dependencies.md`

**Interfaces:**
- Produces: CI runs Python tests (`services/stt`) alongside the existing Node test/lint/typecheck/build/secret-scan steps. No new application interfaces — this is the plan's wrap-up task.

- [ ] **Step 1: Add a Python test step to CI**

Modify `.github/workflows/ci.yml` — add a step after the existing `pnpm test` step:
```yaml
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: |
          cd services/stt
          pip install -r requirements.txt
          pip install grpcio-tools
          ./scripts/gen_proto.sh
          python -m pytest -v
```

- [ ] **Step 2: Note what CI does *not* cover**

Add to `.github/workflows/ci.yml` as a comment near the top (below the existing `name: CI` line):
```yaml
# NOTE: this workflow covers unit/contract tests only. It does not run real
# LiveKit media, real STT/LLM/TTS against live services, or real LiveTalking/
# Wav2Lip avatar rendering — those need real model weights, PyTorch, and (for
# MuseTalk) CUDA hardware this CI runner doesn't have. See "Post-Plan Manual
# Verification" in docs/mastermind/plans/2026-09-05-avatar-platform-phase4-9.md
# for the real end-to-end check.
```

- [ ] **Step 3: Finalize `docs/upstream-dependencies.md`**

Verify the table added in Task 3 has real commit SHAs (not the `<SHA from...>` placeholders) — if any are still placeholders at this point in execution, fill them in now from `git submodule status`.

- [ ] **Step 4: Run the full test suite one final time**

Run (Node): `pnpm lint && pnpm typecheck && pnpm test` (with the full env var set from Task 2 Step 7)
Run (Python): `cd services/stt && python -m pytest -v`
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml docs/upstream-dependencies.md
git commit -m "chore: run Python STT tests in CI, document CI's actual coverage boundary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C8F6qQBo2F661HhVVmcm4J"
```

---

## Post-Plan Manual Verification

None of this plan's automated tests exercise real LiveKit media, real STT/LLM/TTS against live services, or real avatar rendering — that's the explicit, documented CI boundary (Task 19). The real end-to-end check is manual:

1. Run `scripts/fetch-models.sh`, then actually place Wav2Lip weights per its printed instructions.
2. Add to `.env.local` (user action — agents cannot write this file): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_SECRET` (Task 4), `OPENAI_API_KEY`, `LLM_BASE_URL=https://api.openai.com/v1`, `LLM_MODEL` (e.g. `gpt-4o-mini`), `STT_GRPC_URL=127.0.0.1:50051`, `LIVETALKING_URL=http://localhost:4100`, `REALTIME_PROVIDER_MODE=real`.
3. Start infra: `docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d`.
4. Start `services/stt`: `cd services/stt && python -m stt_service.server` (or via the compose `stt` service).
5. Start `services/avatar-gateway`: `pnpm --filter @monotar/avatar-gateway dev`.
6. Start `services/api` and `apps/web` as in the Phase 0-3 plan's verification section.
7. Visit `/talk/:agentId`, click "Start Talking", speak into the microphone, and confirm: a real transcript appears (not the mock's canned text), a real LLM response streams in, and the avatar `<video>` element shows Wav2Lip-rendered output (expect this to run **far slower than real-time** on this CPU-only hardware — that is the expected, documented outcome per the design doc §2, not a bug to chase).
8. Confirm interrupting mid-response actually stops the LLM/TTS/avatar output rather than letting a buffered response continue — this is the single most important behavior to verify by hand, since it's the hardest thing to get right across three real async boundaries simultaneously.

## Self-Review Notes

- **Spec coverage**: Phase 4 (LiveKit+coturn, Task 4/16/18), Phase 5 (faster-whisper+VAD, Tasks 7-9), Phase 6 (OpenAI LLM, Task 11), Phase 7 (OpenAI TTS, Task 12), Phase 8 (LiveTalking containerization+adapter, Tasks 5/13/14), Phase 9 (MuseTalk adapter, CUDA-gated, Task 14) — all covered. License tracking (spec §6) covered in Task 3.
- **Placeholder scan**: no TBD/TODO remain; the one intentional placeholder-looking value (`<SHA from git submodule status>` in Task 3) is explicitly called out as something to fill in with a real value observed at execution time, not a deferred decision — resolved by Task 19 Step 3 at the latest.
- **Type consistency**: `SttEvent`/`SttSession`/`LlmEvent`/`LlmRequest`/`AvatarSession`/`PlaybackState` names and shapes defined in Task 1 are used identically by every consuming task (2, 10, 11, 12, 15, 17) — verified by re-reading each task's Interfaces block against Task 1's.
- **Scope check**: RAG (Phase 11), multi-session/GPU worker pool (Phase 12), observability (Phase 13), admin polish (Phase 14), and LiveAvatar (Phase 15) are not implied by anything in this plan — confirmed against the design doc's explicit out-of-scope list.
- **Ambiguity check**: the OpenAI TTS "incremental input" limitation (design doc's Phase 7 acceptance criterion vs. this specific backend's actual capability) is called out explicitly in Task 12 rather than left as a silent gap.
