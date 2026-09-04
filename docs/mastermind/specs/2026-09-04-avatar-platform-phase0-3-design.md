# Design: Avatar Platform — Phases 0–3 (Bootstrap, Auth, Control Plane, Mock Conversation)

Status: Approved
Date: 2026-09-04
Source specs: `spec` (root), `auth` (root)

## 1. Scope

This is the first build slice of the 15-phase avatar platform described in `spec`. It
covers:

- **Phase 0** — repo bootstrap (monorepo layout, tooling, CI skeleton, docker-compose
  for local infra).
- **Phase 1** — MonoES OAuth 2.0 Authorization Code + PKCE login, exactly per `auth`.
- **Phase 2** — control-plane CRUD (Organizations, Agents, Avatars) behind
  authenticated + tenant-scoped API routes.
- **Phase 3** — full mock real-time conversation pipeline (browser mic → WebRTC-free
  mock transport → MockSTT → MockLLM → MockTTS → MockAvatarEngine → browser), with a
  working `RealtimeSession` state machine including barge-in/interrupt handling.

Out of scope for this slice (later phases, not touched): LiveKit/coturn (Phase 4), real
STT/VAD (Phase 5), real LLM (Phase 6), real TTS (Phase 7), LiveTalking (Phase 8),
MuseTalk (Phase 9), barge-in latency optimization (Phase 10), RAG/pgvector (Phase 11),
multi-session GPU worker pool (Phase 12), observability (Phase 13), admin polish
(Phase 14), LiveAvatar experimental (Phase 15).

## 2. Environment facts (verified this session)

- Node 24.20.0, pnpm 10.18.1, git 2.43.0 present.
- Docker 29.1.3 + docker-compose-v2 2.40.3 + postgresql-client 16 installed and running
  (`systemctl is-active docker` → active). User is in the `docker` group.
- GPU is AMD (`Advanced Micro Devices, Inc. [AMD/ATI] Device 150e`), not NVIDIA. Not
  relevant to this slice (no GPU inference until Phase 8/9) — flag again before that
  phase, since `spec`'s LiveTalking/MuseTalk stack assumes CUDA.
- MonoES OIDC discovery verified live against
  `https://monoes.me/api/auth/.well-known/oauth-authorization-server`: issuer, endpoints,
  `S256` PKCE, `none` token_endpoint_auth_method, and scopes (`openid profile email
  community:read community:write offline_access`) all match `auth` exactly.

## 3. Tech stack decisions

| Decision | Choice | Rationale |
|---|---|---|
| Monorepo tool | pnpm workspaces | `auth` already assumes pnpm (`pnpm monoes:register`); no need for Turborepo/Nx at this package count |
| Backend framework | Fastify | Lighter bootstrap than NestJS for a control-plane API this size; plugin model fits the auth/session/CRUD split cleanly |
| ORM | Prisma | Migration DX; `spec` allows Prisma or Drizzle but forbids mixing — picking Prisma |
| Frontend | Next.js + React + TypeScript + Tailwind | Per `spec` §8 |
| Local infra | Docker Compose: Postgres, Redis, MinIO | Per `spec` §48; no GPU services in this slice |
| Validation | Zod, shared via `packages/contracts` | Single source of truth for request/response shapes across API and web |
| Session transport (Phase 3 mock) | In-process EventEmitter/WebSocket, no LiveKit | LiveKit is Phase 4; a mock transport keeps the `RealtimeSession` and `AvatarEngine` interfaces real without the media-server dependency |

## 4. Monorepo structure

```
monotar/
  apps/
    web/                      # Next.js: /login, /dashboard, /talk/:agentId
  services/
    api/                      # Fastify control-plane + auth + mock conversation API
  packages/
    contracts/                # Zod schemas + shared TS types (auth, CRUD, realtime events)
    config/                   # Typed env loader (zod-validated) for services/api and apps/web
    auth/                     # MonoES OAuth/PKCE client, session issuance/verification
  scripts/
    register-monoes-client.ts # pnpm monoes:register
    check-monoes-oauth.ts     # pnpm monoes:check
  docs/
    mastermind/specs/         # this file + future design docs
    upstream-dependencies.md
    authentication.md
  docker-compose.yml           # postgres, redis, minio
  pnpm-workspace.yaml
  turbo.json                   # NOT added — plain pnpm --filter scripts instead
  .github/workflows/ci.yml     # lint, typecheck, test on push
```

No `turbo.json` — deliberately deferred; pnpm workspace `--filter` scripts are enough
at 4 packages, avoiding an unused config surface.

## 5. Phase 1 — MonoES Auth

Implemented exactly per `auth`, no deviations:

- `packages/auth`: PKCE verifier/challenge generation (S256), state generation/
  verification, MonoES discovery-document fetch with startup validation (fail in
  production if discovered endpoints differ from configured ones, warn in dev — `auth`
  §15), token exchange via `application/x-www-form-urlencoded` POST, no client secret.
- `services/api` routes: `GET /api/auth/login`, `GET /api/auth/callback/monoes`,
  `POST /api/auth/logout`, `GET /api/auth/session`, `GET /api/auth/me`, and
  dev-only `GET /api/auth/debug` (never exposes tokens).
- Data model (Prisma): `User`, `ExternalIdentity` (unique on `provider,
  providerSubject`), `Session` (opaque token, hash stored, HttpOnly cookie),
  `Organization`, `OrganizationMember`.
- First login creates User + ExternalIdentity + default Organization + OWNER
  OrganizationMember + Session, per `auth` §10.
- `scripts/register-monoes-client.ts` → `pnpm monoes:register`, reads `APP_URL`,
  prints `client_id`, never auto-writes secrets to committed files.
- `scripts/check-monoes-oauth.ts` → `pnpm monoes:check`, validates discovery metadata
  against `MONOES_ISSUER`.
- Login transaction (state + code_verifier) stored in a short-lived HttpOnly cookie,
  not server session storage — no shared state needed since it's a single request/
  redirect round trip.
- Headless agent flow (`auth` §18/19) is explicitly **not implemented** in this slice —
  no concrete agent use case yet.

## 6. Phase 2 — Control Plane CRUD

Authenticated, tenant-scoped REST endpoints under `services/api`, all requiring a valid
Session and resolving the caller's Organization via `OrganizationMember`:

- `Organization`: read own org, update name/settings (OWNER/ADMIN only).
- `Agent` (the configured avatar persona/config, not an AI "agent" in the swarm sense):
  CRUD scoped to the caller's Organization. Fields: name, system prompt, LLM config
  reference, voice config reference, avatar asset reference — all mock-backed in this
  slice (real provider wiring is later phases).
  - **Naming clarification needed before implementation**: `spec` uses "Agent" for
    this configured-persona entity, while `monomind` conventions use "agent" for AI
    coding subagents. To avoid confusion in this codebase, the Prisma model is named
    `AvatarAgent` and API routes are `/api/avatar-agents`. Domain managers must use
    this name consistently.
- `Avatar` asset records: metadata for avatar visual assets (name, thumbnail URL in
  MinIO, status) — no rendering pipeline yet, just CRUD + storage references.
- RBAC: `OWNER`, `ADMIN`, `MEMBER` roles on `OrganizationMember`; write operations on
  Organization/AvatarAgent/Avatar require ADMIN+; MEMBER has read-only + can start
  conversations (Phase 3).
- Every list/get/update/delete query filters by `organizationId` derived from the
  session — no client-supplied org ID is ever trusted.

## 7. Phase 3 — Mock Conversation Pipeline

- `RealtimeSession` state machine (per `spec`): `CREATED → CONNECTING → LISTENING →
  USER_SPEAKING → THINKING → AI_SPEAKING → INTERRUPTING → RECONNECTING → ENDED →
  ERROR`, implemented as a single class in `services/api` with explicit allowed-
  transition table (invalid transitions throw, never silently ignored).
- Provider interfaces (real contracts, mock implementations only in this slice):
  - `SpeechToTextProvider` → `MockSTT` (returns canned/echoed transcript after a
    simulated delay).
  - `LLMProvider` → `MockLLM` (returns canned or template-based streamed response).
  - `TextToSpeechProvider` → `MockTTS` (returns silent/generated audio buffer,
    streamed in chunks to simulate real TTS timing).
  - `AvatarEngine` → `MockAvatarEngine` (emits scripted state events, no real video).
- Transport: browser mic captured via `MediaRecorder`/Web Audio API, chunks sent over
  a WebSocket to `services/api` (no LiveKit/WebRTC yet — that's Phase 4). This keeps
  the client-side `AvatarEngine`/session-state consumption code structurally identical
  to what Phase 4+ will use, since the state machine and provider interfaces don't
  change — only the transport and provider implementations swap later.
- Barge-in: user speech detected (mocked via a simple volume/VAD-stub threshold) while
  `AI_SPEAKING` triggers `INTERRUPTING → LISTENING`, cancelling the in-flight
  MockTTS/MockLLM stream. This is a first-class test case, not an afterthought.
- `apps/web` `/talk/:agentId` page: mic capture UI, live transcript display, avatar
  placeholder (static image swapped by mock state events), interrupt button (manual
  trigger in addition to auto-VAD-stub).

## 8. Error Handling

- API boundary: all request bodies validated against `packages/contracts` Zod schemas;
  invalid input → `400` with field-level errors, never a raw stack trace.
- Auth callback errors (`auth` §5: missing/wrong state, missing code, expired/reused
  transaction) → redirect to `/login?error=<code>` with a generic user-facing message;
  detail logged server-side only.
- RealtimeSession: invalid state transitions throw a typed `InvalidTransitionError`,
  caught at the WebSocket handler boundary and surfaced to the client as a structured
  `{type: "error", code}` message — the socket is not silently dropped.
- Tenant isolation violations (org ID mismatch) → `403`, logged as a security event.
- Structured logging redacts `authorization`, `cookie`, `set-cookie`, `access_token`,
  `refresh_token` per `auth` §21.

## 9. Testing Strategy

- **Auth** (`auth` §20): unit tests for PKCE verifier/challenge generation, state
  generation/verification, and integration tests against a mock MonoES authorization
  server for: successful callback, missing code, missing state, wrong state, expired
  transaction, reused transaction, token endpoint errors, new-user creation,
  returning-user login, changed email, session creation/expiration, logout.
- **Control plane**: RBAC tests (OWNER/ADMIN/MEMBER permission boundaries), tenant
  isolation tests (org A cannot read/write org B's AvatarAgents/Avatars).
- **Realtime**: state machine unit tests covering every defined transition and
  rejecting every undefined one; end-to-end mock-conversation test exercising the full
  LISTENING → USER_SPEAKING → THINKING → AI_SPEAKING loop plus an interrupt mid-
  AI_SPEAKING.
- **Security**: frontend bundle scan asserting no `access_token`/`refresh_token`/
  session-hash/encryption-key strings are present in built client JS.
- CI (`.github/workflows/ci.yml`): install → lint → typecheck → test, on every push.

## 10. Acceptance Criteria

Phase 1 is not "done" until tested against the real MonoES authorization server at
least once outside CI (`auth` §22, all 16 sub-criteria). Phases 2–3 are done when:
CRUD endpoints enforce tenant isolation and RBAC under test, and the mock conversation
end-to-end test (including interrupt) passes with the actual `apps/web` UI exercised
manually in a browser (mic permission → speak → see mock transcript → see mock AI
response → avatar placeholder state changes → interrupt works).

## 11. Self-review notes

- Placeholder scan: no `TODO`/`TBD`/`<...>` placeholders remain in this doc.
- Internal consistency: entity naming (`AvatarAgent` vs spec's "Agent") reconciled
  explicitly in §6 to prevent ambiguity during multi-agent build.
- Scope check: confirmed nothing from Phase 4+ (LiveKit, real providers, GPU) is
  implied by any component named here.
- Ambiguity check: transport for Phase 3 (WebSocket, not LiveKit) stated explicitly
  since `spec` discusses WebRTC broadly — resolved by scoping WebRTC/LiveKit to
  Phase 4 only.
