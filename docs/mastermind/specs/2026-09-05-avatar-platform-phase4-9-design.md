# Design: Avatar Platform — Phases 4–9 (LiveKit, Real STT/LLM/TTS, LiveTalking, MuseTalk)

Status: Approved
Date: 2026-09-05
Source spec: `spec` (root), sections 3–5, 18–30, 36, 48–51, 60 (Phases 4–9)
Builds on: `docs/mastermind/specs/2026-09-04-avatar-platform-phase0-3-design.md`

## 1. Scope

Second build slice of the 15-phase avatar platform. Replaces the mock providers built
in Phase 0-3 (`MockSTT`, `MockLLM`, `MockTTS`, `MockAvatarEngine`, raw WebSocket
transport) with real implementations behind the *same* `SpeechToTextProvider` /
`LLMProvider` / `TextToSpeechProvider` / `AvatarEngine` interfaces, per spec §21
("engine-specific implementation must live behind adapters").

Covers exactly:
- **Phase 4** — self-hosted LiveKit + coturn real-time media transport.
- **Phase 5** — real STT (faster-whisper + Silero VAD).
- **Phase 6** — real LLM (OpenAI API, via the existing `LLMProvider` abstraction).
- **Phase 7** — real TTS (OpenAI-compatible speech API).
- **Phase 8** — LiveTalking containerization + adapter.
- **Phase 9** — MuseTalk configuration (adapter built; not runnable on this hardware —
  see §2).

Out of scope (later phases): barge-in latency optimization (10), RAG (11),
multi-session GPU worker pool (12), observability (13), admin polish (14), LiveAvatar
(15, explicitly excluded from the MVP dependency graph per spec §26).

## 2. Critical hardware constraint (resolved with user)

This machine has an **AMD GPU** (`Device 150e`), no NVIDIA/CUDA. Spec §24 requires
MuseTalk to validate `CUDA available` at startup — on this hardware that's a hard
startup failure, not merely slow.

**User decision:** build all 6 phases anyway. Concretely:
- **Wav2Lip is the primary, actually-working local avatar renderer** — spec §25
  designates it exactly for "lower resource environments," and it's the only one of
  the two renderers that can run on CPU at all.
- **MuseTalk's adapter code is built** (so it's ready to point at real NVIDIA hardware
  later) but is CUDA-gated: `avatar-gateway`'s health check reports
  `cudaAvailable: false`, and any attempt to create a MuseTalk session returns a typed
  `503 model_requires_cuda` rather than crashing.
- Phase 9's literal acceptance criterion ("a browser user can have a complete
  real-time conversation with a MuseTalk avatar") is **not achievable on this
  machine** — this is stated plainly rather than glossed over. What Phase 9 delivers
  here is: a correct, tested MuseTalk adapter that will work once run against a CUDA
  machine, verified by unit tests against a mock LiveTalking server, not a live
  MuseTalk conversation.

## 3. Resolved technical decisions

| Decision | Choice | Rationale |
|---|---|---|
| Service topology | Separate `services/stt` (Python) and `services/avatar-gateway` (Node/TS) | Matches spec §4's suggested structure; spec principle #20 requires components stay independently replaceable |
| Real-time media | LiveKit Server (self-hosted) + coturn (self-hosted TURN) | Spec §27 mandates this; hand-rolling WebRTC is explicitly forbidden (§3) |
| Node↔Python STT transport | gRPC bidirectional streaming | User's explicit choice over WS+HTTP |
| LLM backend | OpenAI API, behind the existing `LLMProvider` interface | User's explicit choice; `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` stay configurable so swapping to another OpenAI-compatible provider later needs no code change |
| TTS backend | OpenAI-compatible speech API (`POST /v1/audio/speech`), consumed as a streamed HTTP response body | User's explicit choice; means **no self-hosted TTS service or container is needed at all** — this lives entirely as an HTTP client inside `services/api` |
| Avatar renderer (this machine) | Wav2Lip primary; MuseTalk adapter built but CUDA-gated | See §2 |
| Avatar renderer service language | TypeScript (`services/avatar-gateway`), per spec §22's literal file names (`LiveTalkingProvider.ts` etc.) | Spec-mandated |
| GPU-tier compose file | New `docker-compose.cpu.yml` replacing the spec's `docker-compose.gpu.yml` for this hardware | The spec's gpu.yml assumes NVIDIA Container Toolkit throughout; ours must not require it |

## 4. Architecture

```
Browser (livekit-client, mic + <video> for avatar output)
   │ WebRTC
   ▼
LiveKit Server (docker) ──── coturn (docker, TURN)
   │ livekit-server-sdk (Node)
   ▼
services/api (Fastify) — RealtimeSession orchestrator (unchanged state machine)
   │                         │                              │
   │ gRPC (bidi stream)      │ HTTP SSE (streamChat)         │ HTTP (AvatarEngine calls)
   ▼                         ▼                               ▼
services/stt (Python,   OpenAI Chat Completions        services/avatar-gateway (Node)
faster-whisper +        (OpenAILLMProvider)              → LiveTalkingClient (only code
Silero VAD)                                                that knows LiveTalking's
                         OpenAI TTS API (direct HTTP,       actual HTTP/WebRTC protocol)
                         streamed response body,           → LiveTalking container
                         OpenAITTSProvider — no               (external/LiveTalking,
                         separate service/container)          Python/PyTorch)
                                                               → Wav2Lip (primary, CPU)
                                                               → MuseTalk (adapter built,
                                                                 CUDA-gated)
```

`services/api` still owns the `RealtimeSession` state machine built in Phase 0-3
unchanged — this slice only replaces what sits behind each provider interface and
swaps the transport from a raw WebSocket to LiveKit.

## 5. Components

**`apps/web`**
- `talk-client.tsx`: replace the raw `WebSocket` with `livekit-client` — connect to
  the room, publish the mic track, subscribe to the avatar's video/audio tracks,
  render them in a `<video>` element. The existing text state overlay
  (`Avatar state: {state}`) stays as a debug readout alongside the video.

**`services/api`**
- `LiveKitSessionManager` — creates/destroys a LiveKit room per `RealtimeSession`,
  issues short-lived scoped access tokens, subscribes server-side to the published
  mic track to feed STT.
- `GrpcSttClient implements SpeechToTextProvider` — bidirectional gRPC stream to
  `services/stt`.
- `OpenAILLMProvider implements LLMProvider` — SSE-streamed chat completions,
  `AbortSignal`-cancelable.
- `OpenAITTSProvider implements TextToSpeechProvider` — streams the
  `/v1/audio/speech` response body as it arrives.
- `AvatarGatewayClient` — HTTP client `services/api` uses to reach
  `services/avatar-gateway`.

**`services/stt`** (new, Python)
- `grpcio` server wrapping `faster-whisper` (CPU, `compute_type=int8`) + Silero VAD.
- `proto/stt.proto`: one bidirectional streaming RPC (`StreamTranscribe`) — audio
  frames in, `speech_started` / `partial_transcript` / `final_transcript` /
  `speech_ended` events out.

**`services/avatar-gateway`** (new, Node/TypeScript, per spec §22)
- `src/providers/livetalking/{LiveTalkingProvider,LiveTalkingSession,LiveTalkingClient,LiveTalkingMapper,LiveTalkingHealth}.ts`
- `src/providers/musetalk/` — the CUDA-gated MuseTalk path (thin, mostly delegates to
  LiveTalking's own MuseTalk support per spec §24: "use MuseTalk through LiveTalking
  where supported").
- Health endpoint reports `{ engine: "wav2lip", cudaAvailable: false, status: "ready" }`.

**`external/`** (new git submodules, pinned per spec §5)
- `LiveTalking` (`github.com/lipku/LiveTalking`)
- `MuseTalk` (`github.com/TMElyralab/MuseTalk`)
- `Wav2Lip` (`github.com/Rudrabha/Wav2Lip`)
- (LiveAvatar excluded — spec §26 keeps it out of the MVP dependency graph until Phase 15)
- `infra/docker/livetalking.Dockerfile` — CPU-mode build, no NVIDIA Container Toolkit.
- `scripts/fetch-models.sh` — downloads Wav2Lip/MuseTalk weights outside git into
  `/models/wav2lip/`, `/models/musetalk/`.
- `docs/licenses/` — per-dependency license summary (spec §6); Wav2Lip and MuseTalk
  both carry research-oriented licenses with commercial-use caveats, marked
  `REQUIRES_LEGAL_REVIEW` rather than assumed clear.

**Infra**
- `docker-compose.yml` additions: `livekit`, `coturn`.
- New `docker-compose.cpu.yml` (this hardware's substitute for the spec's
  `docker-compose.gpu.yml`) covering `stt`, `avatar-gateway`, `livetalking` — no
  NVIDIA runtime directive anywhere in it.

## 6. Data Flow

**Happy path (one turn):**
1. Browser publishes mic audio to the LiveKit room → `services/api` subscribes
   server-side.
2. Audio frames stream to `services/stt` over gRPC; VAD speech-start →
   `RealtimeSession` transitions `LISTENING → USER_SPEAKING`.
3. `final_transcript` → `→ THINKING` → `OpenAILLMProvider.streamChat()` starts,
   tokens fed incrementally into `OpenAITTSProvider.synthesizeStream()` (no waiting
   for the full LLM answer — Phase 7's acceptance criterion).
4. First TTS audio chunk → `→ AI_SPEAKING` → chunks forwarded to
   `AvatarGatewayClient.sendAudio()` → `LiveTalkingClient` → Wav2Lip renders
   lip-synced video → LiveTalking publishes the result back into the same LiveKit
   room → browser subscribes and plays it.
5. TTS stream ends without interrupt → `→ LISTENING`.

**Barge-in (real cancellation, spec §29):** VAD speech-start while `AI_SPEAKING` →
`→ INTERRUPTING` → abort the LLM `AbortController`, abort the TTS stream, call
`AvatarSession.interrupt()`, drop any generated-but-unsent TTS chunks → mark that
assistant turn `interrupted = true` → `→ USER_SPEAKING`. This replaces Phase 3's
mocked interrupt (a `for`-loop `break`) with real cancellation across three async
boundaries (LLM, TTS, avatar) simultaneously — the highest-risk correctness surface
in this slice, since all three must actually stop producing output, not merely stop
being read from.

## 7. Error Handling

- **LiveKit disconnect** → `RECONNECTING`, LiveKit's built-in reconnect; `→ ENDED` if
  it doesn't recover within a timeout (reuses the existing state machine transition).
- **STT gRPC stream drop** → reconnect with backoff; restart the stream fresh (not
  resume) if the audio gap exceeds ~2s — VAD recovers naturally on a fresh stream.
- **OpenAI LLM/TTS errors** (rate limit, timeout, 5xx) → `{type:"error",
  code:"llm_failed"|"tts_failed"}` to the client, `→ ERROR`. No silent mid-turn retry
  (spec: "never pretend the user heard text that wasn't played").
- **avatar-gateway/LiveTalking unhealthy** → health check runs at session creation;
  fail *before* the user starts talking, not mid-conversation.
- **MuseTalk requested, CUDA unavailable** → typed `503 model_requires_cuda` at
  session-create time.
- **Model weights missing** (`fetch-models.sh` never run) → same fail-fast pattern at
  startup health check with an actionable message.

## 8. Testing

- `services/stt`: Python unit tests against a synthetic short-WAV fixture (known
  transcript); VAD boundary tests.
- `OpenAILLMProvider` / `OpenAITTSProvider`: unit tests against a mock HTTP server
  (same pattern as `mock-monoes-server.ts` from Phase 0-3) — no real OpenAI calls in
  CI. Cover streaming and `AbortSignal` cancellation explicitly.
- `avatar-gateway`: unit tests against a mock LiveTalking HTTP server. A real
  Wav2Lip integration test is **manual-only**, documented as such — spinning up
  LiveTalking+Wav2Lip needs real model weights and PyTorch, unrealistic for a hosted
  CI runner.
- **Barge-in correctness** (highest-value test): assert that after `interrupt()`, no
  further LLM tokens/TTS chunks/avatar frames are emitted for the interrupted turn —
  directly targets the "old buffered response resumes afterward" bug the spec calls
  out in Phase 10.
- **Honest CI scope**: full end-to-end (real LiveKit + real STT + real avatar
  rendering) will not run in GitHub Actions. CI covers unit/contract tests only; the
  real end-to-end check is a manual verification step, the same pattern Phase 1's
  real MonoES login needed.

## 9. Self-review notes

- Placeholder scan: no TBD/TODO remain.
- Internal consistency: Phase 9's acceptance criterion is explicitly reconciled with
  the hardware constraint in §2 rather than left ambiguous.
- Scope check: LiveAvatar (Phase 15) and RAG/multi-session/observability (Phases
  11-13) confirmed out of scope; nothing here implies them.
- Ambiguity check: "TTS provider" could have meant a self-hosted service (Piper/XTTS)
  or a cloud API — resolved explicitly to OpenAI's cloud API with no local TTS
  service/container at all, stated in §3's table to prevent re-litigation later.
