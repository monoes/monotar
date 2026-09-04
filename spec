# MASTER IMPLEMENTATION SPEC — SELF-HOSTED REAL-TIME AI AVATAR PLATFORM

You are the lead architect and implementation engineer for this project.

Your job is to BUILD a working, production-oriented, self-hosted real-time conversational AI avatar platform similar in product behavior to Anam.ai.

Do not merely create plans or architecture documents.

Implement the system incrementally, run it, test it, fix failures, and keep the repository in a working state.

The platform must use existing open-source projects wherever practical rather than reimplementing avatar models, WebRTC stacks, speech recognition, or other mature infrastructure.

The first production renderer is LiveTalking.

MuseTalk is the preferred first high-quality avatar backend.

Wav2Lip may be supported as a simpler fallback.

LiveAvatar must be integrated only as an experimental/optional renderer and must not block the MVP.

Authentication must use MonoES (`monoes.me`) OAuth/OIDC.

---

# 1. PRIMARY PRODUCT GOAL

Build a web application where a user can:

1. Sign in using MonoES OAuth.
2. Create/configure an AI agent.
3. Select an avatar.
4. Select a voice.
5. Attach knowledge/document sources.
6. Configure an LLM.
7. Configure tools/actions.
8. Start a real-time conversation.
9. Speak through the browser microphone.
10. Have speech transcribed in real time.
11. Send the conversation to an AI agent.
12. Generate streaming TTS.
13. Animate an avatar using the generated speech.
14. Receive synchronized avatar video/audio in the browser.
15. Interrupt the avatar by speaking.
16. Resume conversations naturally.
17. Store session history, transcript and usage statistics.
18. Operate multiple simultaneous sessions.
19. Run almost entirely self-hosted.
20. Allow individual infrastructure components to be replaced later.

The final architecture must NOT couple the application directly to LiveTalking internals.

Use an AvatarEngine abstraction.

---

# 2. CORE REAL-TIME PIPELINE

Implement this logical flow:

Browser microphone

→ WebRTC/media transport

→ VAD

→ streaming STT

→ conversation orchestrator

→ LLM

→ optional RAG

→ optional tool execution

→ streaming TTS

→ AvatarEngine

→ LiveTalking

→ MuseTalk/Wav2Lip

→ WebRTC video/audio

→ Browser

Critical requirement:

The user must be able to interrupt the AI while it is speaking.

When VAD determines the user has started talking:

1. stop current TTS generation if possible;
2. stop queued avatar audio;
3. notify the avatar renderer of interruption;
4. cancel the unfinished assistant generation if appropriate;
5. start STT immediately;
6. begin the next conversational turn.

Target perceived interruption latency should be as low as practical.

Instrument actual latency rather than assuming vendor claims.

---

# 3. DO NOT REIMPLEMENT EXISTING PROJECTS

Use upstream open-source projects.

Do NOT implement any of the following from scratch unless absolutely required:

- lip-sync model
- WebRTC protocol stack
- TURN server
- STT neural model
- vector database
- base LLM inference engine
- TTS model
- video codec
- authentication provider

Build adapters and orchestration around existing systems.

Before modifying upstream projects, determine whether the requirement can be implemented through:

1. configuration;
2. adapter/wrapper;
3. extension/plugin;
4. sidecar service.

Only fork or patch upstream code when these approaches cannot reasonably solve the requirement.

Document every upstream patch.

---

# 4. INITIAL REPOSITORY STRUCTURE

Create a monorepo similar to:

```text
avatar-platform/
│
├── apps/
│   ├── web/
│   └── admin/
│
├── services/
│   ├── api/
│   ├── agent/
│   ├── avatar-gateway/
│   ├── realtime/
│   ├── stt/
│   ├── tts/
│   ├── rag/
│   └── worker-manager/
│
├── packages/
│   ├── contracts/
│   ├── config/
│   ├── logger/
│   ├── auth/
│   ├── sdk/
│   └── shared/
│
├── external/
│   ├── LiveTalking/
│   ├── MuseTalk/
│   ├── Wav2Lip/
│   └── LiveAvatar/
│
├── infra/
│   ├── docker/
│   ├── livekit/
│   ├── coturn/
│   ├── postgres/
│   ├── redis/
│   ├── object-storage/
│   ├── prometheus/
│   └── grafana/
│
├── scripts/
│   ├── bootstrap.sh
│   ├── fetch-models.sh
│   ├── verify-gpu.sh
│   └── dev.sh
│
├── docs/
│   ├── architecture.md
│   ├── authentication.md
│   ├── avatar-engine.md
│   ├── realtime.md
│   ├── deployment.md
│   ├── upstream-dependencies.md
│   └── security.md
│
├── docker-compose.yml
├── docker-compose.gpu.yml
├── .env.example
├── Makefile
└── README.md
```

Do not create unnecessary microservices merely because they appear above.

Initially, services can be combined where operationally sensible.

Prefer a modular monolith for control-plane functionality and separate GPU/media workers where isolation is useful.

---

# 5. CLONE AND PIN UPSTREAM PROJECTS

Add the upstream projects explicitly.

Preferred approach: Git submodules.

Execute:

```bash
mkdir -p external

git submodule add \
  https://github.com/lipku/LiveTalking.git \
  external/LiveTalking

git submodule add \
  https://github.com/TMElyralab/MuseTalk.git \
  external/MuseTalk

git submodule add \
  https://github.com/Rudrabha/Wav2Lip.git \
  external/Wav2Lip

git submodule add \
  https://github.com/Alibaba-Quark/LiveAvatar.git \
  external/LiveAvatar
```

LiveAvatar is OPTIONAL/experimental and must not become part of the MVP critical path.

After cloning:

```bash
git submodule update --init --recursive
git submodule status
```

Record pinned revisions in:

```text
docs/upstream-dependencies.md
```

For every upstream dependency document:

- repository
- commit SHA
- tag/release if applicable
- license
- model license
- model source
- patches we apply
- commercial-use considerations
- GPU requirements
- upgrade procedure

Never automatically track upstream `main` in production.

Pin known-working commits.

---

# 6. VERIFY LICENSES BEFORE PRODUCTIZATION

Before integrating each model into a commercial-facing build:

Inspect:

- repository license
- model-weight license
- associated dataset restrictions
- likeness restrictions
- redistribution restrictions
- commercial-use restrictions

Do not assume repository code license automatically applies to downloaded model weights.

Generate:

```text
docs/licenses/
```

with a summary for every external dependency.

If commercial usage is uncertain, mark it:

```text
REQUIRES_LEGAL_REVIEW
```

Do not block technical development unless execution is legally prohibited, but surface uncertainty clearly.

---

# 7. BACKEND TECHNOLOGY

Preferred control-plane implementation:

Node.js
TypeScript
Fastify or NestJS

Use Node 22+ where compatible.

Use:

PostgreSQL
Redis
S3-compatible storage
Prisma or Drizzle

Choose ONE ORM after inspecting project requirements.

Do not mix ORMs.

GPU inference services may use Python/FastAPI where appropriate.

---

# 8. FRONTEND TECHNOLOGY

Build the application using:

Next.js
React
TypeScript
Tailwind CSS

Use a clean component library where useful.

Pages:

```text
/
 /login
 /dashboard
 /agents
 /agents/new
 /agents/:id
 /avatars
 /knowledge
 /sessions
 /sessions/:id
 /settings
 /settings/auth
 /settings/providers
 /admin
```

Primary real-time interface:

```text
/talk/:agentId
```

The talk UI must contain:

- avatar video
- connection status
- microphone state
- mute button
- start/end conversation
- live captions
- AI speaking indicator
- user speaking indicator
- reconnect state
- optional transcript panel
- latency/debug panel in development mode

---

# 9. MONOES.ME AUTHENTICATION

Authentication MUST use MonoES.

Do not introduce Auth0, Clerk, Firebase Auth, Supabase Auth, Cognito, Keycloak or another primary identity provider.

MonoES is authoritative for user identity.

## OAuth implementation

First determine whether MonoES supports OpenID Connect discovery.

Attempt:

```text
https://monoes.me/.well-known/openid-configuration
```

or obtain the correct issuer from configuration/documentation.

DO NOT assume the issuer is the root domain.

If OIDC discovery succeeds, use the discovered:

- authorization_endpoint
- token_endpoint
- userinfo_endpoint
- jwks_uri
- issuer
- supported scopes
- signing algorithms
- logout endpoint if provided

Do NOT hard-code undocumented endpoint paths.

If MonoES does not expose OIDC discovery, support explicit configuration:

```env
MONOES_ISSUER=
MONOES_CLIENT_ID=
MONOES_CLIENT_SECRET=

MONOES_AUTHORIZATION_URL=
MONOES_TOKEN_URL=
MONOES_USERINFO_URL=
MONOES_JWKS_URL=

MONOES_SCOPES="openid profile email"

MONOES_REDIRECT_URI=http://localhost:3000/api/auth/callback/monoes
MONOES_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/
```

Preferred flow:

OAuth 2.0 Authorization Code Flow.

Use PKCE where supported.

Never use implicit flow.

Never expose client secret to the browser.

Generate and validate:

- state
- nonce
- PKCE verifier/challenge

Validate token claims:

- issuer
- audience
- expiry
- nonce
- signature

Do not simply decode a JWT without verification.

---

# 10. AUTHENTICATION SESSION ARCHITECTURE

After successful MonoES authentication:

Map external identity into our local database.

Create:

```text
User
ExternalIdentity
Session
Organization
OrganizationMember
```

Do NOT use email as the stable identity.

Use the OAuth/OIDC provider subject identifier:

```text
provider = monoes
providerSubject = sub
```

Example:

```text
ExternalIdentity

id
userId
provider
providerSubject
email
metadata
createdAt
updatedAt
```

Unique constraint:

```text
(provider, providerSubject)
```

User record:

```text
User

id UUID
displayName
email
avatarUrl
createdAt
updatedAt
lastLoginAt
```

---

# 11. APPLICATION SESSION SECURITY

After MonoES login, create our own application session.

Preferred:

secure HttpOnly cookie.

Cookie settings in production:

```text
HttpOnly
Secure
SameSite=Lax
Path=/
```

Do not store OAuth access tokens in:

```text
localStorage
sessionStorage
browser-readable cookies
```

If provider access/refresh tokens need to be retained:

encrypt them at rest.

Use an application-level encryption key obtained from secrets management.

Support:

- session rotation
- session revocation
- logout
- expiration
- concurrent session listing later

---

# 12. AUTHORIZATION

Authentication and authorization are separate.

Implement application roles.

Initial roles:

```text
OWNER
ADMIN
MEMBER
VIEWER
```

Each user belongs to an organization.

All business objects belong to an organization.

Examples:

```text
Agent.organizationId
Avatar.organizationId
KnowledgeBase.organizationId
Conversation.organizationId
ApiKey.organizationId
```

Never trust an organization ID submitted by the browser without authorization checks.

Enforce tenancy server-side.

---

# 13. FIRST LOGIN BEHAVIOR

When a MonoES user logs in for the first time:

1. verify MonoES identity;
2. create local User;
3. create ExternalIdentity;
4. create personal/default Organization if appropriate;
5. add OWNER membership;
6. create application session;
7. redirect to dashboard.

Returning user:

1. verify MonoES identity;
2. find `(provider, sub)`;
3. update safe profile attributes;
4. update lastLoginAt;
5. create/rotate application session.

---

# 14. AUTH API

Implement:

```text
GET  /api/auth/login
GET  /api/auth/callback/monoes
POST /api/auth/logout
GET  /api/auth/session
GET  /api/auth/me
```

If refresh tokens are supported:

```text
POST /internal/auth/refresh
```

Do not expose refresh functionality directly to arbitrary browser requests.

---

# 15. AUTH ACCEPTANCE TESTS

Create tests proving:

- unauthenticated user cannot access dashboard;
- login redirects to MonoES;
- callback rejects invalid state;
- callback rejects invalid nonce;
- callback rejects incorrect issuer;
- callback rejects incorrect audience;
- expired token is rejected;
- invalid JWT signature is rejected;
- successful login creates/reuses correct user;
- second login does not duplicate identity;
- cookies are HttpOnly;
- OAuth client secret never appears in browser bundle;
- tenant boundary cannot be bypassed;
- logout revokes local session.

Mock the provider in CI if necessary.

Do not require the real MonoES service for unit tests.

---

# 16. DATABASE MODEL

At minimum support:

```text
User
ExternalIdentity
Session

Organization
OrganizationMember

Agent
AgentVersion

Avatar
AvatarAsset

Voice
VoiceProvider

KnowledgeBase
KnowledgeDocument
KnowledgeChunk

Conversation
ConversationTurn

ToolDefinition
AgentTool

ProviderCredential

UsageEvent

GpuWorker
AvatarSession

AuditLog
```

Use migrations.

Never rely on ORM auto-sync in production.

---

# 17. AGENT MODEL

Agent:

```text
id
organizationId
name
description
systemPrompt
avatarId
voiceId
llmProvider
llmModel
temperature
knowledgeBaseId
enabled
createdAt
updatedAt
```

Version important configuration changes.

Never silently mutate historical conversation configuration.

Store the effective agent version with every conversation.

---

# 18. LLM PROVIDER ABSTRACTION

Create:

```typescript
interface LLMProvider {
  streamChat(
    request: LLMRequest,
    signal?: AbortSignal
  ): AsyncIterable<LLMEvent>;
}
```

Implement at least:

OpenAI-compatible provider.

This allows:

- OpenAI
- vLLM
- Ollama-compatible gateways where appropriate
- other OpenAI-compatible APIs

Configuration:

```env
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
```

Never hard-code a specific commercial LLM provider into business logic.

---

# 19. STT

Create:

```typescript
interface SpeechToTextProvider {
  createSession(config: STTConfig): STTSession;
}
```

Start with:

faster-whisper or another Whisper-compatible implementation.

Support streaming/chunked transcription.

Return events such as:

```text
speech_started
partial_transcript
final_transcript
speech_ended
```

Use VAD.

Candidate:

Silero VAD.

Keep VAD implementation replaceable.

---

# 20. TTS

Create:

```typescript
interface TextToSpeechProvider {
  synthesizeStream(
    text: AsyncIterable<string>,
    config: VoiceConfig,
    signal?: AbortSignal
  ): AsyncIterable<AudioChunk>;
}
```

Support an initial self-hosted TTS provider.

Possible implementations:

Piper
XTTS
OpenAI-compatible speech API

Choose whichever gets the MVP working reliably.

Do NOT tightly couple avatar generation to one TTS engine.

---

# 21. AVATAR ENGINE ABSTRACTION

This is one of the most important architecture requirements.

Create something conceptually equivalent to:

```typescript
interface AvatarEngine {
  createSession(
    config: AvatarSessionConfig
  ): Promise<AvatarSession>;
}
```

AvatarSession:

```typescript
interface AvatarSession {
  id: string;

  sendAudio(
    audio: AsyncIterable<AudioChunk>
  ): Promise<void>;

  interrupt(): Promise<void>;

  getPlaybackState(): Promise<PlaybackState>;

  close(): Promise<void>;
}
```

Engine-specific implementation must live behind adapters.

---

# 22. IMPLEMENT LIVETALKING ADAPTER FIRST

Create:

```text
services/avatar-gateway/src/providers/livetalking/
```

Example structure:

```text
LiveTalkingProvider.ts
LiveTalkingSession.ts
LiveTalkingClient.ts
LiveTalkingMapper.ts
LiveTalkingHealth.ts
```

The rest of the application must not directly call LiveTalking HTTP/WebRTC endpoints.

Only `LiveTalkingClient` should know LiveTalking-specific protocol details.

Capabilities:

```text
create avatar session
submit audio
interrupt playback
close session
health check
connection status
capture renderer metrics
```

If LiveTalking lacks a required stable API:

build a small wrapper service around it.

Prefer wrapper over invasive fork.

---

# 23. LIVETALKING CONTAINER

Build a reproducible Docker image from:

```text
external/LiveTalking
```

Use NVIDIA Container Toolkit.

Do not install GPU dependencies manually on every deployment.

Provide:

```text
infra/docker/livetalking.Dockerfile
```

Mount models as volumes where practical.

Large model weights should not be committed to Git.

Create:

```bash
scripts/fetch-models.sh
```

for reproducible model installation.

---

# 24. MUSETALK

Use MuseTalk through LiveTalking where supported.

Do not independently duplicate a second MuseTalk runtime unless technically necessary.

Model files must live outside Git.

Recommended:

```text
/models/musetalk/
```

Provide environment configuration for location.

Validate startup:

- CUDA available
- model present
- model loads
- warmup succeeds
- health endpoint succeeds

---

# 25. WAV2LIP FALLBACK

Integrate Wav2Lip only as a fallback renderer.

Use it for:

- development
- debugging
- lower resource environments
- comparison

It should use the same AvatarEngine interface.

---

# 26. LIVEAVATAR EXPERIMENTAL PROVIDER

Do not include LiveAvatar in the MVP dependency graph.

Create only after the core platform works.

Add:

```text
services/avatar-gateway/src/providers/liveavatar/
```

Implement:

```text
LiveAvatarProvider
LiveAvatarSession
```

Feature flag:

```env
ENABLE_LIVEAVATAR=false
```

LiveAvatar should run on dedicated GPU workers.

Never assume the same GPU capacity profile as LiveTalking.

---

# 27. REAL-TIME MEDIA

Prefer LiveKit for the product media layer.

Self-host:

LiveKit Server.

Self-host TURN using:

coturn.

Flow:

```text
Browser
   │
   │ WebRTC
   ▼
LiveKit
   │
   ├── user microphone audio
   │
   ├── avatar video
   │
   └── avatar audio
```

Do not expose internal GPU workers directly to the public Internet.

---

# 28. REALTIME SESSION MANAGER

Create a RealtimeSession object.

State machine:

```text
CREATED
CONNECTING
LISTENING
USER_SPEAKING
THINKING
AI_SPEAKING
INTERRUPTING
RECONNECTING
ENDED
ERROR
```

Do not scatter conversation state across arbitrary services.

Represent transitions explicitly.

---

# 29. BARGE-IN / INTERRUPTION

Implement interruption as a first-class feature.

When user speech is detected while:

```text
state = AI_SPEAKING
```

perform:

```text
1. transition AI_SPEAKING → INTERRUPTING
2. abort LLM stream
3. abort TTS stream
4. clear pending audio chunks
5. call AvatarSession.interrupt()
6. preserve already-played assistant text
7. mark unfinished turn as interrupted
8. transition → USER_SPEAKING
```

Store:

```text
interrupted = true
```

on that assistant turn.

Never pretend the user heard text that was generated but not played.

---

# 30. LATENCY MEASUREMENT

Record timestamps:

```text
user_speech_started_at
user_speech_ended_at
stt_final_at
llm_first_token_at
tts_first_audio_at
avatar_first_frame_at
playback_started_at
```

Calculate:

```text
STT latency
LLM TTFT
TTS TTFA
avatar rendering delay
end-to-end turn latency
barge-in latency
```

Provide p50/p95 metrics.

---

# 31. KNOWLEDGE / RAG

Implement RAG as a separate capability.

Initial vector storage:

PostgreSQL + pgvector.

Pipeline:

```text
document upload
→ parsing
→ chunking
→ embeddings
→ pgvector
```

During conversation:

```text
user query
→ retrieval
→ relevant chunks
→ LLM context
```

Store citations internally so future UI can expose knowledge sources.

Do not send the entire document corpus to the LLM.

---

# 32. TOOLS

Implement tool calling through a controlled registry.

Example:

```typescript
interface Tool {
  name: string;
  description: string;
  schema: JSONSchema;
  execute(input: unknown, context: ToolContext): Promise<unknown>;
}
```

The LLM must NEVER receive arbitrary network or shell access.

Tools must be explicitly registered.

Examples for development:

```text
getCurrentTime
searchKnowledgeBase
getWeather via configured provider
```

Consequential actions must support confirmation later.

---

# 33. PROVIDER CREDENTIALS

Organizations may configure external AI providers.

Never store plaintext API keys.

Use envelope encryption.

Application receives:

```text
APP_ENCRYPTION_KEY
```

Encrypt:

```text
ProviderCredential.secret
```

Return masked values in APIs:

```text
sk-...1234
```

Never return decrypted credential to browser.

---

# 34. AVATAR MANAGEMENT

Avatar:

```text
id
organizationId
name
engine
status
thumbnail
configuration
createdAt
```

Avatar asset pipeline:

```text
upload
→ validate
→ preprocess
→ engine preparation
→ READY
```

States:

```text
UPLOADED
PROCESSING
READY
FAILED
```

For LiveTalking, build preprocessing jobs where required.

---

# 35. USER CONSENT

Require users to explicitly confirm they have rights to any uploaded:

- human likeness
- voice
- photograph
- training/reference video

Store:

```text
consentConfirmedAt
consentVersion
```

Add appropriate UI disclosure that the visible character is AI-generated/AI-controlled.

---

# 36. GPU WORKER ARCHITECTURE

Do not bind one GPU to one tenant.

Workers advertise:

```text
workerId
hostname
gpuModel
totalVram
freeVram
activeSessions
supportedEngines
health
```

Store worker presence in Redis.

Worker manager assigns avatar sessions.

Logical architecture:

```text
API
 │
 ▼
Session Manager
 │
 ▼
Redis
 │
 ▼
Worker Manager
 │
 ├── GPU Worker 1
 ├── GPU Worker 2
 └── GPU Worker N
```

Initial MVP may run one worker.

Architecture must support multiple workers later.

---

# 37. RESOURCE SCHEDULER

First scheduler can be simple:

Filter healthy workers.

Filter workers supporting requested renderer.

Sort by:

```text
activeSessions
freeVRAM
```

Select best worker.

Do not prematurely build Kubernetes-style scheduling.

---

# 38. REDIS

Use Redis for ephemeral state:

```text
session presence
worker heartbeats
job queues
rate limits
distributed locks
realtime ephemeral events
```

Do NOT use Redis as the system of record.

Persistent state belongs in PostgreSQL.

---

# 39. POSTGRESQL

Use PostgreSQL for:

```text
users
organizations
agents
avatars
conversations
turns
usage
audit logs
credentials metadata
knowledge metadata
worker history
```

Add indexes for:

```text
organizationId
agentId
conversationId
createdAt
status
```

---

# 40. OBJECT STORAGE

Use S3-compatible storage.

Local development:

MinIO.

Production:

any compatible object storage.

Store:

```text
avatar source files
processed avatar assets
knowledge documents
optional recordings
```

Never commit uploaded assets to Git.

---

# 41. CONVERSATION STORAGE

Conversation:

```text
id
organizationId
agentId
agentVersionId
userId
startedAt
endedAt
status
avatarEngine
sttProvider
ttsProvider
llmProvider
```

ConversationTurn:

```text
id
conversationId
role
text
startedAt
completedAt
interrupted
latency
metadata
```

---

# 42. RECORDING

Recording must be opt-in.

Do not automatically record raw microphone/video unless configured.

Separate:

```text
transcript retention
audio retention
video retention
```

Expose these settings.

---

# 43. API DESIGN

Primary endpoints:

```text
GET    /health
GET    /ready

GET    /api/me

GET    /api/agents
POST   /api/agents
GET    /api/agents/:id
PATCH  /api/agents/:id
DELETE /api/agents/:id

GET    /api/avatars
POST   /api/avatars
GET    /api/avatars/:id
DELETE /api/avatars/:id

POST   /api/conversations
GET    /api/conversations
GET    /api/conversations/:id
POST   /api/conversations/:id/end

POST   /api/realtime/token

POST   /api/knowledge
POST   /api/knowledge/:id/documents

GET    /api/providers
PUT    /api/providers/:provider

GET    /api/usage
```

Validate all input.

Prefer a schema validator such as Zod.

Generate API types shared with frontend.

---

# 44. INTERNAL APIs

Use internal authentication between services.

Never assume Docker network == trusted network.

Initial method can use:

```text
INTERNAL_SERVICE_TOKEN
```

Later replacement can use mTLS.

Internal endpoints should not be publicly routed.

---

# 45. OBSERVABILITY

Use structured logging.

Every request/session must carry:

```text
requestId
organizationId
conversationId
avatarSessionId
workerId
```

Never log:

```text
OAuth secrets
provider API keys
refresh tokens
raw authorization headers
```

---

# 46. PROMETHEUS METRICS

Expose:

```text
active_conversations
active_avatar_sessions
gpu_sessions
stt_latency_seconds
llm_ttft_seconds
tts_ttfa_seconds
avatar_first_frame_seconds
turn_latency_seconds
barge_in_latency_seconds
webrtc_disconnects_total
conversation_errors_total
```

---

# 47. GPU METRICS

Where possible expose:

```text
GPU utilization
GPU memory used
GPU memory available
temperature
encoder utilization
worker sessions
```

Use NVIDIA tooling/exporters where practical.

---

# 48. DEVELOPMENT DOCKER COMPOSE

Create:

```text
docker-compose.yml
```

CPU/control-plane services:

```text
web
api
postgres
redis
minio
livekit
coturn
```

Create:

```text
docker-compose.gpu.yml
```

for:

```text
stt
tts
livetalking
avatar-worker
```

Allow:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.gpu.yml \
  up
```

---

# 49. DEVELOPMENT COMMANDS

Implement:

```bash
make bootstrap
make models
make dev
make dev-gpu
make test
make lint
make typecheck
make migrate
make seed
make health
```

`make bootstrap` must:

1. initialize submodules;
2. validate environment;
3. install JS dependencies;
4. prepare Python environments/images;
5. verify required Docker support;
6. print missing GPU prerequisites without crashing unnecessarily.

---

# 50. ENVIRONMENT CONFIGURATION

Create `.env.example`.

Never include real secrets.

Include:

```env
NODE_ENV=development

DATABASE_URL=
REDIS_URL=

APP_URL=http://localhost:3000
API_URL=http://localhost:4000

SESSION_SECRET=
APP_ENCRYPTION_KEY=

MONOES_ISSUER=
MONOES_CLIENT_ID=
MONOES_CLIENT_SECRET=
MONOES_AUTHORIZATION_URL=
MONOES_TOKEN_URL=
MONOES_USERINFO_URL=
MONOES_JWKS_URL=
MONOES_SCOPES="openid profile email"
MONOES_REDIRECT_URI=http://localhost:3000/api/auth/callback/monoes

LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=

LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=

STT_PROVIDER=faster-whisper
TTS_PROVIDER=

AVATAR_ENGINE=livetalking
ENABLE_LIVEAVATAR=false

LIVETALKING_URL=
```

---

# 51. HEALTH CHECKS

Every service must provide:

```text
/health
/ready
```

Health means process alive.

Ready means required dependencies available.

For GPU worker readiness verify:

```text
CUDA
model loaded
renderer warm
dependencies reachable
```

---

# 52. SECURITY BASELINE

Implement:

- CSRF protection where needed
- secure OAuth state handling
- PKCE
- secure cookies
- rate limiting
- request validation
- output encoding
- authorization checks
- tenant isolation
- encrypted secrets
- security headers
- audit logs
- upload MIME/type validation
- file size limits

Never execute uploaded files.

Never execute arbitrary LLM-generated shell commands.

---

# 53. TENANT ISOLATION TESTS

Write integration tests proving:

Organization A cannot retrieve:

```text
Organization B agents
avatars
conversations
knowledge
credentials
usage
```

Test both API and direct object-ID attacks.

---

# 54. FRONTEND MVP EXPERIENCE

Dashboard:

```text
Agents
Avatars
Recent conversations
Usage
```

Create Agent wizard:

```text
Step 1: name/persona
Step 2: avatar
Step 3: voice
Step 4: model
Step 5: knowledge
Step 6: test conversation
```

Talk screen should prioritize the avatar.

Do not overload the MVP UI.

---

# 55. DEBUG MODE

In development, expose a diagnostics panel showing:

```text
WebRTC RTT
packet loss
STT latency
LLM TTFT
TTS latency
avatar latency
GPU worker
renderer
conversation state
```

This is essential for tuning.

---

# 56. CI

Create GitHub Actions.

Required jobs:

```text
lint
typecheck
unit-tests
integration-tests
build
dependency-security-check
```

GPU tests should be optional/separate.

Normal CI must not require a GPU.

Mock AvatarEngine for CI.

---

# 57. MOCK AVATAR ENGINE

Implement:

```text
MockAvatarEngine
```

It must behave like the real interface without GPU inference.

Use it for:

```text
unit tests
CI
frontend development
backend development
```

This avoids making every developer require NVIDIA hardware.

---

# 58. MOCK MONOES OAUTH SERVER

For integration tests implement a minimal fake OIDC/OAuth provider or use a standards-compliant test fixture.

It should expose test equivalents of:

```text
authorize
token
userinfo
JWKS
discovery
```

This is TEST ONLY.

Production authentication must use MonoES.

---

# 59. TEST PYRAMID

Unit tests:

```text
auth
RBAC
agent orchestration
provider adapters
state machines
scheduler
```

Integration tests:

```text
Postgres
Redis
OAuth callback
conversation lifecycle
RAG
```

E2E:

```text
login mock
create agent
start conversation
mock STT
mock LLM
mock TTS
mock avatar
interrupt AI
end conversation
view transcript
```

GPU smoke tests separately.

---

# 60. IMPLEMENTATION PHASES

Execute sequentially.

Do not attempt everything simultaneously.

## PHASE 0 — Repository bootstrap

Deliver:

- monorepo
- package manager
- Docker Compose
- configuration
- formatting/linting
- CI skeleton
- upstream Git submodules
- dependency documentation

Acceptance:

```text
make bootstrap
```

works on a clean machine with documented prerequisites.

---

## PHASE 1 — MonoES authentication

Implement:

- OAuth/OIDC discovery
- Authorization Code
- PKCE
- state
- nonce
- callback
- token validation
- user mapping
- organizations
- sessions
- logout
- RBAC

Acceptance:

A developer with valid MonoES credentials can sign in and reach:

```text
/dashboard
```

No other login system is required.

---

## PHASE 2 — Core control plane

Implement:

```text
users
organizations
agents
avatars metadata
provider configuration
conversation records
```

Build CRUD APIs and basic dashboard.

---

## PHASE 3 — Mock conversation

Implement the entire conversation state machine using:

```text
MockSTT
MockLLM
MockTTS
MockAvatarEngine
```

Do this BEFORE GPU integration.

Acceptance:

Browser conversation works end-to-end with simulated components.

Interruption must work.

---

## PHASE 4 — LiveKit

Integrate self-hosted LiveKit.

Browser:

```text
connect
publish microphone
subscribe avatar streams
reconnect
```

Add coturn.

Acceptance:

Works on local network and documented external-network setup.

---

## PHASE 5 — Real STT

Integrate faster-whisper.

Add VAD.

Acceptance:

Speech from browser produces streaming transcription.

---

## PHASE 6 — Real LLM

Integrate OpenAI-compatible LLM interface.

Acceptance:

Final transcript produces streaming model response.

Cancellation must work.

---

## PHASE 7 — Real TTS

Integrate streaming TTS.

Acceptance:

LLM text produces incremental audio without waiting for entire answer where provider permits.

---

## PHASE 8 — LiveTalking

Containerize pinned LiveTalking dependency.

Implement LiveTalkingAdapter.

Start with supported avatar backend.

Acceptance:

TTS audio causes real avatar video/audio output.

---

## PHASE 9 — MuseTalk

Configure LiveTalking + MuseTalk.

Prepare sample avatar.

Acceptance:

A browser user can have a complete real-time conversation with a MuseTalk avatar.

---

## PHASE 10 — Barge-in optimization

Measure and optimize interruption.

Acceptance:

Talking over the avatar reliably stops current speech.

No old buffered response resumes afterward.

---

## PHASE 11 — RAG

Implement:

```text
upload
parse
chunk
embed
retrieve
```

Acceptance:

Agent answers using uploaded knowledge.

---

## PHASE 12 — Multi-session

Implement worker registry and scheduler.

Acceptance:

At least multiple logical conversations can coexist.

Measure actual GPU capacity.

Never invent capacity estimates.

---

## PHASE 13 — Observability

Implement Prometheus, Grafana and structured tracing.

Acceptance:

Dashboard shows latency breakdown for conversations.

---

## PHASE 14 — Admin/product polish

Implement:

```text
agent management
avatar management
usage
conversation history
audit records
provider settings
```

---

## PHASE 15 — LiveAvatar experiment

ONLY after previous phases work.

Run LiveAvatar separately.

Benchmark:

```text
VRAM
FPS
first-frame latency
continuous-generation latency
visual quality
stability
cost/session
```

Implement adapter only if results justify it.

---

# 61. PERFORMANCE TARGETS

These are engineering goals, not promises.

Measure:

```text
speech-end → final STT
final STT → LLM first token
first text → TTS first audio
first audio → avatar first frame
overall response latency
interrupt latency
```

Store p50/p95.

Never optimize based only on average latency.

---

# 62. MODEL WARMING

GPU services should support warm startup.

Before accepting sessions:

```text
load model
run warm-up inference
verify GPU
publish READY
```

Do not assign sessions to a worker still loading a model.

---

# 63. FAILURE HANDLING

Handle:

```text
STT crash
LLM timeout
TTS timeout
avatar renderer crash
GPU OOM
LiveKit disconnect
Redis interruption
database interruption
browser reconnect
```

Return user-friendly states.

Never leave Conversation permanently in ACTIVE after worker loss.

Add cleanup/reconciliation process.

---

# 64. GPU OOM

If renderer returns CUDA OOM:

1. mark session errored;
2. release associated worker reservation;
3. clean model/session resources;
4. record metric;
5. optionally retry on another healthy worker ONCE;
6. never infinite retry.

---

# 65. SESSION CLEANUP

Implement cleanup of abandoned sessions.

Use:

```text
heartbeat
lastSeenAt
timeout
```

Close:

```text
LiveKit room
AvatarSession
STT session
TTS stream
LLM generation
worker reservation
```

---

# 66. DOCUMENTATION

README must allow a new engineer to go from clone → running system.

Include:

```text
prerequisites
GPU requirements
Docker
MonoES OAuth configuration
model downloads
development setup
production configuration
troubleshooting
```

Do not hide important setup exclusively in shell history.

---

# 67. ARCHITECTURE DECISIONS

Create ADRs under:

```text
docs/adr/
```

At minimum:

```text
001-control-plane-architecture.md
002-monoes-authentication.md
003-avatar-engine-interface.md
004-livetalking-adoption.md
005-livekit-media-layer.md
006-gpu-worker-pool.md
007-rag-storage.md
```

---

# 68. UPSTREAM PATCH POLICY

If LiveTalking must be changed:

Do NOT casually edit the submodule.

First determine whether wrapper/adapter can solve it.

If patch unavoidable:

store patch files under:

```text
patches/livetalking/
```

Provide:

```bash
scripts/apply-upstream-patches.sh
```

Document WHY every patch exists.

This makes future upstream upgrades manageable.

---

# 69. CONFIGURATION RULE

Never scatter:

```text
URLs
ports
model paths
secrets
provider names
```

through source code.

Use typed centralized configuration.

Application must fail fast with clear errors when required production configuration is missing.

---

# 70. DO NOT BUILD THESE YET

Unless needed for MVP, postpone:

- mobile apps
- custom avatar model training
- custom TTS training
- LiveAvatar optimization
- Kubernetes
- complicated billing
- marketplace
- custom CDN
- multi-region failover
- enterprise SAML
- avatar marketplace
- fine-tuning UI
- elaborate workflow builder

Keep architecture extensible but implementation focused.

---

# 71. CODING REQUIREMENTS

Use:

TypeScript strict mode.

Avoid:

```text
any
unchecked casts
duplicated API types
large god classes
silent catch blocks
```

All external integrations need interfaces.

All network calls need:

```text
timeout
error handling
structured logs
```

Cancellation must propagate through the real-time pipeline using AbortController or equivalent.

---

# 72. SECURITY REQUIREMENT FOR AVATAR / VOICE CLONING

Do not build functionality designed to clone arbitrary people without authorization.

Require explicit acknowledgement of rights/consent for custom likeness and voice assets.

Keep an audit record.

---

# 73. FIRST WORKING VERTICAL SLICE

Do not build all dashboards first.

The first meaningful target is:

```text
MonoES login
      ↓
Dashboard
      ↓
Open one predefined agent
      ↓
Start conversation
      ↓
Browser microphone
      ↓
STT
      ↓
LLM
      ↓
TTS
      ↓
LiveTalking + MuseTalk
      ↓
Avatar responds over WebRTC
      ↓
User interrupts
      ↓
Avatar immediately stops
```

Everything should prioritize making this vertical slice work.

---

# 74. DEFINITION OF MVP DONE

MVP is complete when:

A new user can authenticate with MonoES.

The user can create an agent.

The user can select an avatar.

The user can select/configure an LLM and voice.

The user can start a browser conversation.

Microphone audio reaches STT.

Speech becomes text.

Text reaches the LLM.

LLM output streams to TTS.

TTS audio reaches LiveTalking.

MuseTalk renders the avatar.

Avatar audio/video reaches browser.

The user can interrupt the avatar.

Conversation transcript is saved.

Tenant authorization works.

System metrics expose turn latency.

Everything can be started reproducibly using documented Docker commands.

---

# 75. DEFINITION OF PRODUCTION-CANDIDATE DONE

Production candidate additionally requires:

- TURN works outside LAN
- TLS
- secrets management
- encrypted credentials
- rate limiting
- audit logs
- session cleanup
- worker recovery
- GPU OOM handling
- multi-worker scheduling
- observability
- backups
- health checks
- readiness checks
- container restart strategy
- load tests
- security tests
- tenant isolation tests

---

# 76. EXECUTION STYLE

You are authorized to:

- inspect the repository;
- create files;
- install project dependencies;
- initialize submodules;
- run Docker containers;
- write migrations;
- run tests;
- run builds;
- fix errors;
- refactor code;
- create documentation.

Do not stop after generating boilerplate.

After every phase:

1. build;
2. lint;
3. typecheck;
4. run relevant tests;
5. start relevant services;
6. fix failures;
7. commit logical changes if Git workflow permits.

Do not claim something works unless it has been executed or explicitly mark it unverified.

---

# 77. DO NOT INVENT EXTERNAL API DETAILS

Especially for MonoES.

If documentation is unavailable:

1. inspect OIDC discovery;
2. inspect existing MonoES integration/configuration if present;
3. search authoritative project documentation;
4. identify required missing values;
5. implement generic standards-compliant configuration.

Never fabricate:

```text
authorization URLs
token URLs
JWKS URLs
OAuth scopes
claims
API endpoints
```

---

# 78. FIRST ACTIONS

Start by executing the following work in order.

### A. Inspect current repository

Determine whether files already exist.

Do NOT overwrite useful existing work.

### B. Check machine

Verify:

```bash
git --version
docker --version
docker compose version
node --version
npm --version
nvidia-smi
```

Record GPU information if available.

### C. Initialize repository structure

Create required directories and root configuration.

### D. Add upstream submodules

Clone and pin:

```text
LiveTalking
MuseTalk
Wav2Lip
LiveAvatar
```

Do not download giant model files yet unless needed for the current phase.

### E. Inspect LiveTalking

Determine:

- startup method
- available APIs
- WebRTC flow
- session model
- interruption behavior
- MuseTalk integration
- model storage
- configuration system

Write findings to:

```text
docs/upstream-dependencies.md
```

### F. Investigate MonoES

Attempt OIDC discovery.

Determine actual configuration required.

Document findings in:

```text
docs/authentication.md
```

If credentials are missing, implement everything around environment variables and a mock provider so development can continue.

Do not block unrelated development because production OAuth credentials are unavailable.

### G. Implement Phase 0

Run tests/build.

### H. Implement Phase 1 authentication

Run tests.

### I. Continue phase-by-phase.

---

# 79. PROGRESS TRACKING

Create:

```text
IMPLEMENTATION_STATUS.md
```

Format:

```text
Phase 0 — DONE
Phase 1 — IN PROGRESS
Phase 2 — NOT STARTED
...
```

For each phase include:

```text
completed
remaining
known issues
manual requirements
test status
```

Keep it updated during development.

---

# 80. IMPORTANT FINAL PRINCIPLE

We are building OUR platform.

LiveTalking, MuseTalk, Wav2Lip and LiveAvatar are implementation dependencies.

The application architecture must look like:

```text
Our Product
      │
      ▼
Our Agent/Realtime Platform
      │
      ▼
Our AvatarEngine API
      │
      ├───────────────┬───────────────┐
      ▼               ▼               ▼
 LiveTalking       LiveAvatar       Future Engine
      │
      ├─────────┐
      ▼         ▼
  MuseTalk    Wav2Lip
```

NOT:

```text
Our frontend
      ↓
random modifications inside LiveTalking
      ↓
everything tightly coupled
```

Maintain this boundary throughout implementation.

Now inspect the environment/repository and BEGIN Phase 0.

Do not merely explain what you intend to do.

Execute it.