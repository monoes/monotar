# Avatar Platform Phase 0-3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the avatar-platform monorepo, implement MonoES OAuth login, build tenant-scoped control-plane CRUD, and ship a fully working mock real-time conversation pipeline (mic → mock STT → mock LLM → mock TTS → mock avatar → browser, with interrupt).

**Architecture:** pnpm workspace monorepo with `apps/web` (Next.js), `services/api` (Fastify), and shared `packages/{contracts,config,auth}`. Postgres/Redis/MinIO run via Docker Compose. Real-time conversation uses a `RealtimeSession` state machine over a plain WebSocket (no LiveKit until Phase 4) driving swappable provider interfaces (`SpeechToTextProvider`, `LLMProvider`, `TextToSpeechProvider`, `AvatarEngine`) backed by Mock implementations in this slice.

**Tech Stack:** Node 24, TypeScript, pnpm workspaces, Fastify, Prisma, PostgreSQL, Redis, MinIO (S3-compatible), Next.js + React + Tailwind, Zod, Vitest, Docker Compose.

## Global Constraints

- Node >= 22 (spec requirement); this machine has 24.20.0.
- Package manager: pnpm only — never mix in npm/yarn lockfiles.
- ORM: Prisma only — never introduce Drizzle or raw SQL query builders alongside it.
- MonoES OAuth: Authorization Code + PKCE (S256) only. Never implement OAuth implicit flow. Never send a client secret (`token_endpoint_auth_method=none`).
- MonoES issuer is exactly `https://monoes.me/api/auth`; discovery URL is `https://monoes.me/api/auth/.well-known/oauth-authorization-server`. Discovered endpoints override hardcoded ones; production must fail-fast on a mismatch, development only warns.
- The opaque application-session value handed to the browser is never persisted server-side in plaintext — only its SHA-256 hash (Prisma field `sessionTokenHash`) is stored. Never store the session value in `localStorage`/`sessionStorage`.
- The configured-persona entity is named `AvatarAgent` in code (Prisma model + `/api/avatar-agents` routes) — never `Agent`, to avoid collision with monomind's AI-subagent terminology.
- Structured logs must redact: `authorization`, `cookie`, `set-cookie`, `access_token`, `refresh_token`.
- No LiveKit/WebRTC, no real STT/LLM/TTS providers, no GPU/avatar-rendering code in this plan — those are later phases. Everything here is Mock-backed behind real interfaces.
- Every file stays under 500 lines; split before it grows past that.
- Every task's deliverable must be independently testable — do not leave a task half-wired to a future task.
- Never write literal credential values into committed files (docker-compose.yml included) — Compose services pull local dev credentials from `.env.local` via `env_file`, never via an inline `${VAR:-default}`/`${VAR:?required}` expression in the YAML.

---

## File Structure

```
monotar/
  package.json                          # root workspace scripts
  pnpm-workspace.yaml
  tsconfig.base.json
  .gitignore
  .nvmrc
  .env.example
  docker-compose.yml
  eslint.config.js
  vitest.workspace.ts
  .github/workflows/ci.yml
  docs/upstream-dependencies.md
  docs/authentication.md
  packages/
    config/
      package.json  tsconfig.json
      src/env.ts  src/env.test.ts  src/index.ts
    contracts/
      package.json  tsconfig.json
      src/auth.ts  src/control-plane.ts  src/realtime.ts  src/index.ts
    auth/
      package.json  tsconfig.json
      src/pkce.ts  src/pkce.test.ts
      src/state.ts  src/state.test.ts
      src/discovery.ts  src/discovery.test.ts
      src/index.ts
  services/api/
    package.json  tsconfig.json
    prisma/schema.prisma
    src/db.ts
    src/app.ts  src/server.ts
    src/routes/health.ts  src/routes/health.test.ts
    src/routes/auth.ts  src/routes/auth.test.ts
    src/plugins/session.ts  src/plugins/session.test.ts
    src/routes/avatar-agents.ts  src/routes/avatar-agents.test.ts
    src/routes/avatars.ts  src/routes/avatars.test.ts
    src/rbac.ts  src/rbac.test.ts
    src/realtime/session-state-machine.ts  src/realtime/session-state-machine.test.ts
    src/realtime/providers.ts
    src/realtime/mock-providers.ts
    src/realtime/ws-route.ts  src/realtime/ws-route.test.ts
    test/mock-monoes-server.ts
  apps/web/
    package.json  tsconfig.json  next.config.js
    app/layout.tsx  app/page.tsx
    app/login/page.tsx
    app/dashboard/page.tsx  app/dashboard/avatar-agents-client.tsx
    app/talk/[agentId]/page.tsx  app/talk/[agentId]/talk-client.tsx
  scripts/
    register-monoes-client.ts
    check-monoes-oauth.ts
    scan-bundle-for-secrets.ts
```

---

### Task 1: Monorepo Bootstrap

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `eslint.config.js`, `vitest.workspace.ts`
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`, `packages/config/src/index.ts`

**Interfaces:**
- Produces: pnpm workspace with a working `pnpm test` and `pnpm lint` at the root, and a first real package (`@monotar/config`) other tasks build on.

- [ ] **Step 1: Write root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "services/*"
  - "packages/*"
```

`package.json`:
```json
{
  "name": "monotar",
  "private": true,
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@10.18.1",
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run",
    "typecheck": "pnpm -r --if-present run typecheck",
    "build": "pnpm -r --if-present run build"
  },
  "devDependencies": {
    "eslint": "^9.13.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
.env.local
*.log
.turbo/
coverage/
```

`.nvmrc`:
```
24
```

`eslint.config.js`:
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["dist/**", "node_modules/**", ".next/**"] }
);
```

`vitest.workspace.ts`:
```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*",
  "services/*",
]);
```

- [ ] **Step 2: Create the first real workspace package**

`packages/config/package.json`:
```json
{
  "name": "@monotar/config",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "vitest": "^2.1.4"
  }
}
```

`packages/config/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/config/src/index.ts`:
```ts
export const CONFIG_PACKAGE_VERSION = "0.1.0";
```

- [ ] **Step 3: Install and verify**

Run: `pnpm install`
Expected: lockfile `pnpm-lock.yaml` created, no errors.

Run: `pnpm lint`
Expected: exits 0 (no source files with violations yet).

- [ ] **Step 4: Init git and commit**

Run: `git init && git add -A && git commit -m "chore: bootstrap pnpm workspace"`
Expected: commit succeeds on a clean initial commit.

---

### Task 2: Local Infra via Docker Compose

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `docs/upstream-dependencies.md`

**Interfaces:**
- Produces: Postgres reachable at `$DATABASE_URL`, Redis at `$REDIS_URL`, MinIO S3 API at `$S3_ENDPOINT` (console on port 9001). Every credential-bearing environment variable is pulled into the containers via `env_file: .env.local` — the compose YAML itself never spells out a variable name next to a literal or inline-default value.

- [ ] **Step 1: Write docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16.4
    env_file: .env.local
    environment:
      POSTGRES_USER: monotar
      POSTGRES_DB: monotar
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U monotar"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7.4-alpine
    ports: ["6379:6379"]

  minio:
    image: minio/minio:RELEASE.2024-10-13T13-34-11Z
    command: server /data --console-address ":9001"
    env_file: .env.local
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio-data:/data"]

volumes:
  pgdata:
  minio-data:
```

`env_file: .env.local` loads every line of that file straight into the container's
environment. The Postgres image reads its own `POSTGRES_PASSWORD` var this way, and
the MinIO image reads `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` the same way — neither
name is ever written next to a value inside this YAML file.

- [ ] **Step 2: Write `.env.example`**

```env
POSTGRES_PASSWORD=changeme-local-dev-only
MINIO_ROOT_USER=monotar
MINIO_ROOT_PASSWORD=changeme-local-dev-only

DATABASE_URL=postgresql://monotar:changeme-local-dev-only@localhost:5432/monotar
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=monotar
S3_SECRET_KEY=changeme-local-dev-only
S3_BUCKET=avatar-assets

APP_URL=http://127.0.0.1:3000
API_PORT=4000

MONOES_ISSUER=https://monoes.me/api/auth
MONOES_METADATA_URL=https://monoes.me/api/auth/.well-known/oauth-authorization-server
MONOES_CLIENT_ID=
MONOES_SCOPES=openid profile email
MONOES_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback/monoes

SESSION_COOKIE_NAME=monotar_session
NODE_ENV=development
```

Note: MonoES requires the literal host `127.0.0.1`, not the hostname `localhost`, to
treat an `http://` redirect URI as loopback — registering with `localhost` fails with
`invalid_redirect_uri`. `APP_URL`/`MONOES_REDIRECT_URI` above use `127.0.0.1`
accordingly, and both dev servers must be accessed at `http://127.0.0.1:3000` (not
`localhost:3000`) for the OAuth redirect to match exactly.

Each developer copies this to `.env.local` and picks their own local-only Postgres/MinIO
dev password (it only ever protects a container bound to localhost); `MONOES_CLIENT_ID`
is filled in later by `pnpm monoes:register` (Task 12) and is never committed.

- [ ] **Step 3: Write `docs/upstream-dependencies.md`**

```markdown
# Upstream Dependencies (Phase 0-3)

| Dependency | Pinned Version | Purpose |
|---|---|---|
| postgres | 16.4 | primary datastore |
| redis | 7.4-alpine | login-transaction + future caching |
| minio | RELEASE.2024-10-13T13-34-11Z | S3-compatible object storage for avatar assets |

Start with `docker compose up -d` (after `cp .env.example .env.local` and filling in
your own local dev passwords, then `set -a && source .env.local && set +a`). Stop with
`docker compose down` (add `-v` to also wipe volumes).
```

- [ ] **Step 4: Verify infra starts**

Run: `cp .env.example .env.local && set -a && source .env.local && set +a && docker compose up -d && docker compose ps`
Expected: all three services show `running`/`healthy`.

Run: `psql "$DATABASE_URL" -c '\dt'`
Expected: connects successfully, empty table list (no relations yet).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example docs/upstream-dependencies.md
git commit -m "chore: add docker compose infra for postgres/redis/minio"
```

---

### Task 3: Typed Env Loader (`@monotar/config`)

**Files:**
- Modify: `packages/config/src/index.ts`
- Create: `packages/config/src/env.ts`, `packages/config/src/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(source?: Record<string, string | undefined>): Env` and `type Env` (fields: `databaseUrl, redisUrl, s3Endpoint, s3AccessKey, s3SecretKey, s3Bucket, appUrl, apiPort, monoesIssuer, monoesMetadataUrl, monoesClientId, monoesScopes: string[], monoesRedirectUri, sessionCookieName, nodeEnv`). Throws `Error` with a readable message on missing/invalid fields. This is imported by `services/api` in every later task that needs config.

- [ ] **Step 1: Write the failing test**

`packages/config/src/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const validSource = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "test-access-key-id",
  S3_SECRET_KEY: "test-value",
  S3_BUCKET: "bucket",
  APP_URL: "http://localhost:3000",
  API_PORT: "4000",
  MONOES_ISSUER: "https://monoes.me/api/auth",
  MONOES_METADATA_URL: "https://monoes.me/api/auth/.well-known/oauth-authorization-server",
  MONOES_CLIENT_ID: "test-client-id",
  MONOES_SCOPES: "openid profile email",
  MONOES_REDIRECT_URI: "http://localhost:3000/api/auth/callback/monoes",
  SESSION_COOKIE_NAME: "monotar_session",
  NODE_ENV: "development",
};

describe("loadEnv", () => {
  it("parses a valid environment", () => {
    const env = loadEnv(validSource);
    expect(env.apiPort).toBe(4000);
    expect(env.monoesScopes).toEqual(["openid", "profile", "email"]);
  });

  it("throws when a required field is missing", () => {
    const { DATABASE_URL, ...rest } = validSource;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/config test`
Expected: FAIL — `Cannot find module './env'`

- [ ] **Step 3: Write minimal implementation**

`packages/config/src/env.ts`:
```ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  APP_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive(),
  MONOES_ISSUER: z.string().url(),
  MONOES_METADATA_URL: z.string().url(),
  MONOES_CLIENT_ID: z.string().min(1),
  MONOES_SCOPES: z.string().min(1),
  MONOES_REDIRECT_URI: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export interface Env {
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
  appUrl: string;
  apiPort: number;
  monoesIssuer: string;
  monoesMetadataUrl: string;
  monoesClientId: string;
  monoesScopes: string[];
  monoesRedirectUri: string;
  sessionCookieName: string;
  nodeEnv: "development" | "test" | "production";
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const parsed = result.data;
  return {
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    s3Endpoint: parsed.S3_ENDPOINT,
    s3AccessKey: parsed.S3_ACCESS_KEY,
    s3SecretKey: parsed.S3_SECRET_KEY,
    s3Bucket: parsed.S3_BUCKET,
    appUrl: parsed.APP_URL,
    apiPort: parsed.API_PORT,
    monoesIssuer: parsed.MONOES_ISSUER,
    monoesMetadataUrl: parsed.MONOES_METADATA_URL,
    monoesClientId: parsed.MONOES_CLIENT_ID,
    monoesScopes: parsed.MONOES_SCOPES.split(" ").filter(Boolean),
    monoesRedirectUri: parsed.MONOES_REDIRECT_URI,
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    nodeEnv: parsed.NODE_ENV,
  };
}
```

`packages/config/src/index.ts`:
```ts
export { loadEnv } from "./env";
export type { Env } from "./env";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/config test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/config
git commit -m "feat(config): add typed env loader"
```

---

### Task 4: Shared Contracts (`@monotar/contracts`)

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/auth.ts`, `packages/contracts/src/control-plane.ts`, `packages/contracts/src/realtime.ts`, `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/control-plane.test.ts`

**Interfaces:**
- Produces:
  - `MeResponseSchema`, `type MeResponse` (`{ id, email, displayName, avatarUrl, organizationId, role }`)
  - `CreateAvatarAgentSchema`, `type CreateAvatarAgentInput` (`{ name, systemPrompt, llmConfig: Record<string, unknown>, voiceConfig: Record<string, unknown>, avatarId?: string }`)
  - `UpdateAvatarAgentSchema` (all fields of `CreateAvatarAgentSchema` optional)
  - `AvatarAgentSchema`, `type AvatarAgent` (adds `id, organizationId, createdAt, updatedAt` as strings)
  - `CreateAvatarSchema`, `type CreateAvatarInput` (`{ name }`)
  - `AvatarSchema`, `type Avatar` (`{ id, organizationId, name, thumbnailUrl: string | null, status: "PENDING"|"READY"|"FAILED", createdAt, updatedAt }`)
  - Realtime WS message unions: `ClientMessageSchema` (`{type:"audio_chunk", data: string} | {type:"interrupt"} | {type:"end"}`), `ServerMessageSchema` (`{type:"state", state: RealtimeState} | {type:"transcript", text: string} | {type:"assistant_text", text: string} | {type:"audio_chunk", data: string} | {type:"error", code: string, message: string}`), `RealtimeStateSchema` = the 9-state enum from the design doc.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/control-plane.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CreateAvatarAgentSchema } from "./control-plane";

describe("CreateAvatarAgentSchema", () => {
  it("accepts a valid payload", () => {
    const result = CreateAvatarAgentSchema.safeParse({
      name: "Sales Bot",
      systemPrompt: "You are a helpful sales assistant.",
      llmConfig: { provider: "mock" },
      voiceConfig: { provider: "mock" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = CreateAvatarAgentSchema.safeParse({
      name: "",
      systemPrompt: "x",
      llmConfig: {},
      voiceConfig: {},
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/contracts test`
Expected: FAIL — package/module not found

- [ ] **Step 3: Write minimal implementation**

`packages/contracts/package.json`:
```json
{
  "name": "@monotar/contracts",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "vitest": "^2.1.4" }
}
```

`packages/contracts/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/contracts/src/auth.ts`:
```ts
import { z } from "zod";

export const OrganizationRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

export const MeResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  organizationId: z.string(),
  role: OrganizationRoleSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
```

`packages/contracts/src/control-plane.ts`:
```ts
import { z } from "zod";

export const CreateAvatarAgentSchema = z.object({
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  llmConfig: z.record(z.unknown()),
  voiceConfig: z.record(z.unknown()),
  avatarId: z.string().optional(),
});
export type CreateAvatarAgentInput = z.infer<typeof CreateAvatarAgentSchema>;

export const UpdateAvatarAgentSchema = CreateAvatarAgentSchema.partial();
export type UpdateAvatarAgentInput = z.infer<typeof UpdateAvatarAgentSchema>;

export const AvatarAgentSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  systemPrompt: z.string(),
  llmConfig: z.record(z.unknown()),
  voiceConfig: z.record(z.unknown()),
  avatarId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AvatarAgent = z.infer<typeof AvatarAgentSchema>;

export const CreateAvatarSchema = z.object({
  name: z.string().min(1),
});
export type CreateAvatarInput = z.infer<typeof CreateAvatarSchema>;

export const AvatarStatusSchema = z.enum(["PENDING", "READY", "FAILED"]);

export const AvatarSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
  status: AvatarStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Avatar = z.infer<typeof AvatarSchema>;
```

`packages/contracts/src/realtime.ts`:
```ts
import { z } from "zod";

export const RealtimeStateSchema = z.enum([
  "CREATED",
  "CONNECTING",
  "LISTENING",
  "USER_SPEAKING",
  "THINKING",
  "AI_SPEAKING",
  "INTERRUPTING",
  "RECONNECTING",
  "ENDED",
  "ERROR",
]);
export type RealtimeState = z.infer<typeof RealtimeStateSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio_chunk"), data: z.string() }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("end") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: RealtimeStateSchema }),
  z.object({ type: z.literal("transcript"), text: z.string() }),
  z.object({ type: z.literal("assistant_text"), text: z.string() }),
  z.object({ type: z.literal("audio_chunk"), data: z.string() }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
```

`packages/contracts/src/index.ts`:
```ts
export * from "./auth";
export * from "./control-plane";
export * from "./realtime";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/contracts test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add shared zod schemas for auth, control-plane, realtime"
```

---

### Task 5: Fastify API Skeleton

**Files:**
- Create: `services/api/package.json`, `services/api/tsconfig.json`
- Create: `services/api/src/app.ts`, `services/api/src/server.ts`
- Create: `services/api/src/routes/health.ts`, `services/api/src/routes/health.test.ts`

**Interfaces:**
- Produces: `buildApp(): FastifyInstance` (exported from `src/app.ts`) — every later route task imports and extends this. `GET /health` returns `{ status: "ok" }`.

- [ ] **Step 1: Write the failing test**

`services/api/src/routes/health.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../app";

describe("GET /health", () => {
  it("returns ok status", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `Cannot find module '../app'`

- [ ] **Step 3: Write minimal implementation**

`services/api/package.json`:
```json
{
  "name": "@monotar/api",
  "version": "0.1.0",
  "type": "module",
  "main": "src/server.ts",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fastify": "^5.1.0",
    "@monotar/config": "workspace:*",
    "@monotar/contracts": "workspace:*",
    "@monotar/auth": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.19.1",
    "vitest": "^2.1.4",
    "typescript": "^5.6.3"
  }
}
```

`services/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`services/api/src/routes/health.ts`:
```ts
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
}
```

`services/api/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  return app;
}
```

`services/api/src/server.ts`:
```ts
import { loadEnv } from "@monotar/config";
import { buildApp } from "./app";

const env = loadEnv();
const app = buildApp();

app
  .listen({ port: env.apiPort, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add services/api
git commit -m "feat(api): add fastify app skeleton with health route"
```

---

### Task 6: Prisma Schema and Client

**Files:**
- Create: `services/api/prisma/schema.prisma`, `services/api/src/db.ts`
- Modify: `services/api/package.json` (add `prisma`, `@prisma/client`, `db:migrate` script)

**Interfaces:**
- Produces: `prisma: PrismaClient` singleton exported from `src/db.ts`, and generated Prisma models `User, ExternalIdentity, Session, Organization, OrganizationMember, AvatarAgent, Avatar` with enums `OrganizationRole, AvatarStatus` — every auth/CRUD task after this depends on these exact model/field names.

- [ ] **Step 1: Add Prisma dependencies**

Modify `services/api/package.json` — add to `dependencies`: `"@prisma/client": "^5.21.1"`; add to `devDependencies`: `"prisma": "^5.21.1"`; add to `scripts`: `"db:migrate": "prisma migrate dev", "db:generate": "prisma generate"`.

- [ ] **Step 2: Write the schema**

`services/api/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String    @id @default(uuid())
  email       String
  displayName String?
  avatarUrl   String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  lastLoginAt DateTime?

  externalIdentities  ExternalIdentity[]
  sessions            Session[]
  organizationMembers OrganizationMember[]
}

model ExternalIdentity {
  id              String   @id @default(uuid())
  userId          String
  provider        String
  providerSubject String
  email           String?
  profileMetadata Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerSubject])
}

model Session {
  id               String    @id @default(uuid())
  userId           String
  sessionTokenHash String    @unique
  createdAt        DateTime  @default(now())
  expiresAt        DateTime
  lastSeenAt       DateTime  @default(now())
  revokedAt        DateTime?
  userAgent        String?
  ipHash           String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Organization {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members      OrganizationMember[]
  avatarAgents AvatarAgent[]
  avatars      Avatar[]
}

enum OrganizationRole {
  OWNER
  ADMIN
  MEMBER
}

model OrganizationMember {
  id             String           @id @default(uuid())
  organizationId String
  userId         String
  role           OrganizationRole
  createdAt      DateTime         @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
}

model AvatarAgent {
  id             String   @id @default(uuid())
  organizationId String
  name           String
  systemPrompt   String
  llmConfig      Json
  voiceConfig    Json
  avatarId       String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  avatar       Avatar?      @relation(fields: [avatarId], references: [id])
}

enum AvatarStatus {
  PENDING
  READY
  FAILED
}

model Avatar {
  id             String       @id @default(uuid())
  organizationId String
  name           String
  thumbnailUrl   String?
  status         AvatarStatus @default(PENDING)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  avatarAgents AvatarAgent[]
}
```

`services/api/src/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

- [ ] **Step 3: Run migration against local Postgres**

Run: `cd services/api && pnpm exec prisma migrate dev --name init` (with `DATABASE_URL` already exported from `.env.local` per Task 2 Step 4)
Expected: creates `prisma/migrations/<timestamp>_init/migration.sql`, applies it, prints "Your database is now in sync with your schema."

- [ ] **Step 4: Verify tables exist**

Run: `psql "$DATABASE_URL" -c '\dt'`
Expected: lists `User, ExternalIdentity, Session, Organization, OrganizationMember, AvatarAgent, Avatar, _prisma_migrations`.

- [ ] **Step 5: Commit**

```bash
git add services/api/prisma services/api/src/db.ts services/api/package.json
git commit -m "feat(api): add prisma schema and generated client"
```

---

### Task 7: PKCE and State Utilities (`@monotar/auth`)

**Files:**
- Create: `packages/auth/package.json`, `packages/auth/tsconfig.json`
- Create: `packages/auth/src/pkce.ts`, `packages/auth/src/pkce.test.ts`
- Create: `packages/auth/src/state.ts`, `packages/auth/src/state.test.ts`
- Create: `packages/auth/src/index.ts`

**Interfaces:**
- Produces: `generateCodeVerifier(): string`, `generateCodeChallenge(verifier: string): string` (S256, base64url, no padding), `generateState(): string` — all pure, used by the login route in Task 9.

- [ ] **Step 1: Write the failing tests**

`packages/auth/src/pkce.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateCodeChallenge, generateCodeVerifier } from "./pkce";

describe("PKCE", () => {
  it("generates a verifier of sufficient length with no padding characters", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).not.toMatch(/[+/=]/);
  });

  it("generates a base64url SHA-256 challenge with the correct shape", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is deterministic for the same verifier and differs across verifiers", () => {
    const verifierA = generateCodeVerifier();
    const verifierB = generateCodeVerifier();
    expect(generateCodeChallenge(verifierA)).toBe(generateCodeChallenge(verifierA));
    expect(generateCodeChallenge(verifierA)).not.toBe(generateCodeChallenge(verifierB));
  });
});
```

`packages/auth/src/state.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateState } from "./state";

describe("generateState", () => {
  it("generates unique, URL-safe values", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(22);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @monotar/auth test`
Expected: FAIL — modules not found

- [ ] **Step 3: Write minimal implementation**

`packages/auth/package.json`:
```json
{
  "name": "@monotar/auth",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": {},
  "devDependencies": { "vitest": "^2.1.4" }
}
```

`packages/auth/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/auth/src/pkce.ts`:
```ts
import { createHash, randomBytes } from "node:crypto";

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  const hash = createHash("sha256").update(verifier).digest();
  return base64url(hash);
}
```

`packages/auth/src/state.ts`:
```ts
import { randomBytes } from "node:crypto";

export function generateState(): string {
  return randomBytes(16).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```

`packages/auth/src/index.ts`:
```ts
export { generateCodeVerifier, generateCodeChallenge } from "./pkce";
export { generateState } from "./state";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @monotar/auth test`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/auth
git commit -m "feat(auth): add PKCE and OAuth state generation utilities"
```

---

### Task 8: MonoES Discovery Client

**Files:**
- Create: `packages/auth/src/discovery.ts`, `packages/auth/src/discovery.test.ts`
- Modify: `packages/auth/src/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `fetchMonoesMetadata(metadataUrl: string, fetchImpl?: typeof fetch): Promise<MonoesMetadata>` where `MonoesMetadata = { issuer: string, authorization_endpoint: string, token_endpoint: string, registration_endpoint: string, code_challenge_methods_supported: string[], token_endpoint_auth_methods_supported: string[] }`; `validateMonoesMetadata(metadata: MonoesMetadata, expectedIssuer: string, mode: "development" | "production"): void` — throws in production on issuer mismatch, only warns (via `console.warn`) in development. Used by Task 9's login route at request time (or app startup).

- [ ] **Step 1: Write the failing tests**

`packages/auth/src/discovery.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { fetchMonoesMetadata, validateMonoesMetadata } from "./discovery";

const sampleMetadata = {
  issuer: "https://monoes.me/api/auth",
  authorization_endpoint: "https://monoes.me/api/auth/oauth2/authorize",
  token_endpoint: "https://monoes.me/api/auth/oauth2/token",
  registration_endpoint: "https://monoes.me/api/auth/oauth2/register",
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
};

describe("fetchMonoesMetadata", () => {
  it("fetches and parses discovery metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleMetadata,
    });
    const metadata = await fetchMonoesMetadata(
      "https://monoes.me/api/auth/.well-known/oauth-authorization-server",
      fetchImpl as unknown as typeof fetch
    );
    expect(metadata.issuer).toBe("https://monoes.me/api/auth");
  });

  it("throws when the response is not ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      fetchMonoesMetadata("https://example.com/meta", fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/discovery/i);
  });
});

describe("validateMonoesMetadata", () => {
  it("passes when issuer matches", () => {
    expect(() => validateMonoesMetadata(sampleMetadata, "https://monoes.me/api/auth", "production")).not.toThrow();
  });

  it("throws in production on issuer mismatch", () => {
    expect(() =>
      validateMonoesMetadata(sampleMetadata, "https://wrong.example.com", "production")
    ).toThrow(/issuer/i);
  });

  it("warns but does not throw in development on issuer mismatch", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      validateMonoesMetadata(sampleMetadata, "https://wrong.example.com", "development")
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @monotar/auth test`
Expected: FAIL — `Cannot find module './discovery'`

- [ ] **Step 3: Write minimal implementation**

`packages/auth/src/discovery.ts`:
```ts
export interface MonoesMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

export async function fetchMonoesMetadata(
  metadataUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<MonoesMetadata> {
  const response = await fetchImpl(metadataUrl);
  if (!response.ok) {
    throw new Error(`MonoES discovery request failed with status ${response.status}`);
  }
  return (await response.json()) as MonoesMetadata;
}

export function validateMonoesMetadata(
  metadata: MonoesMetadata,
  expectedIssuer: string,
  mode: "development" | "production"
): void {
  if (metadata.issuer !== expectedIssuer) {
    const message = `MonoES discovery issuer mismatch: expected "${expectedIssuer}", got "${metadata.issuer}"`;
    if (mode === "production") {
      throw new Error(message);
    }
    console.warn(message);
  }
}
```

Modify `packages/auth/src/index.ts` — append:
```ts
export { fetchMonoesMetadata, validateMonoesMetadata } from "./discovery";
export type { MonoesMetadata } from "./discovery";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @monotar/auth test`
Expected: PASS (9 tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/auth
git commit -m "feat(auth): add MonoES OIDC discovery fetch and validation"
```

---

### Task 9: Mock MonoES Server Test Helper + Login Route

**Files:**
- Create: `services/api/test/mock-monoes-server.ts`
- Create: `services/api/src/routes/auth.ts`, `services/api/src/routes/auth.test.ts`
- Modify: `services/api/src/app.ts`

**Interfaces:**
- Consumes: `generateCodeVerifier, generateCodeChallenge, generateState` from `@monotar/auth`; `loadEnv` from `@monotar/config`.
- Produces: `GET /api/auth/login` — sets an HttpOnly cookie `monotar_login_txn` containing JSON `{ state, codeVerifier }`, redirects (302) to `<authorizeUrl>?client_id=...&redirect_uri=...&response_type=code&scope=...&code_challenge=...&code_challenge_method=S256&state=...`. `startMockMonoesServer(): Promise<{ url: string, close: () => Promise<void> }>` test helper spun up in-process (plain `node:http` server) exposing `/oauth2/authorize` (redirects to the given `redirect_uri` with a freshly generated one-time authorization code and the given `state`) and `/oauth2/token` (returns `{ access_token: <freshly generated opaque test value>, id_token: <base64 fake JWT with sub/email>, token_type: "Bearer", expires_in: 3600 }`).

- [ ] **Step 1: Write the mock server helper (test infrastructure, not itself under TDD)**

`services/api/test/mock-monoes-server.ts`:
```ts
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export interface MockMonoesServer {
  url: string;
  close: () => Promise<void>;
}

function fakeIdToken(subject: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: subject, email })).toString("base64url");
  return `header.${payload}.signature`;
}

function generateTestOpaqueValue(): string {
  return randomBytes(16).toString("base64url");
}

export async function startMockMonoesServer(): Promise<MockMonoesServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/oauth2/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const target = new URL(redirectUri);
      target.searchParams.set("code", generateTestOpaqueValue());
      target.searchParams.set("state", state);
      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }
    if (url.pathname === "/oauth2/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: generateTestOpaqueValue(),
            id_token: fakeIdToken("test-subject", "user@example.com"),
            token_type: "Bearer",
            expires_in: 3600,
          })
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 2: Write the failing test for the login route**

`services/api/src/routes/auth.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";

vi.mock("@monotar/config", () => ({
  loadEnv: () => ({
    monoesIssuer: "https://monoes.me/api/auth",
    monoesMetadataUrl: "https://monoes.me/api/auth/.well-known/oauth-authorization-server",
    monoesClientId: "test-client-id",
    monoesScopes: ["openid", "profile", "email"],
    monoesRedirectUri: "http://localhost:3000/api/auth/callback/monoes",
    sessionCookieName: "monotar_session",
    nodeEnv: "test",
    apiPort: 4000,
    databaseUrl: "postgresql://placeholder",
    redisUrl: "redis://placeholder",
    s3Endpoint: "http://placeholder",
    s3AccessKey: "placeholder",
    s3SecretKey: "placeholder",
    s3Bucket: "placeholder",
    appUrl: "http://localhost:3000",
  }),
}));

describe("GET /api/auth/login", () => {
  it("redirects to the MonoES authorize endpoint with PKCE params", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/auth/login" });
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location as string);
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(response.headers["set-cookie"]).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `/api/auth/login` route not registered (404)

- [ ] **Step 4: Write minimal implementation**

Modify `services/api/package.json` — add to `dependencies`: `"@fastify/cookie": "^11.0.1"`.

`services/api/src/routes/auth.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { loadEnv } from "@monotar/config";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "@monotar/auth";

const LOGIN_TXN_COOKIE = "monotar_login_txn";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/login", async (_request, reply) => {
    const env = loadEnv();
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    reply.setCookie(LOGIN_TXN_COOKIE, JSON.stringify({ state, codeVerifier }), {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    const authorizeUrl = new URL(`${env.monoesIssuer}/oauth2/authorize`);
    authorizeUrl.searchParams.set("client_id", env.monoesClientId);
    authorizeUrl.searchParams.set("redirect_uri", env.monoesRedirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", env.monoesScopes.join(" "));
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);

    return reply.redirect(authorizeUrl.toString(), 302);
  });
}

export const LOGIN_TXN_COOKIE_NAME = LOGIN_TXN_COOKIE;
```

Modify `services/api/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cookie);
  app.register(healthRoutes);
  app.register(authRoutes);
  return app;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add services/api
git commit -m "feat(api): add GET /api/auth/login with PKCE + mock MonoES test server"
```

---

### Task 10: Callback Route — Full Auth Flow

**Files:**
- Modify: `services/api/src/routes/auth.ts`, `services/api/src/app.ts`
- Modify: `services/api/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: `LOGIN_TXN_COOKIE_NAME` (this task's own file), `startMockMonoesServer` from `../../test/mock-monoes-server`, `prisma` from `../db`.
- Produces: `GET /api/auth/callback/monoes` — on success: creates/updates `User` + `ExternalIdentity` (`provider="monoes"`), creates default `Organization` + `OWNER` `OrganizationMember` on first login, creates a `Session` row (hashed value stored, plaintext value only ever leaves the server once in the response cookie), sets an HttpOnly `monotar_session` cookie, redirects to `/dashboard`. On any of the 5 documented error cases, redirects to `/login?error=<code>` where `<code>` is one of `missing_state|invalid_state|missing_code|expired_transaction|token_exchange_failed`.

- [ ] **Step 1: Write the failing tests**

Append to `services/api/src/routes/auth.test.ts`:
```ts
import { startMockMonoesServer, type MockMonoesServer } from "../../test/mock-monoes-server";
import { prisma } from "../db";

describe("GET /api/auth/callback/monoes", () => {
  let mockMonoes: MockMonoesServer;

  beforeAll(async () => {
    mockMonoes = await startMockMonoesServer();
    process.env.MOCK_MONOES_URL = mockMonoes.url;
  });

  afterAll(async () => {
    await mockMonoes.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
  });

  it("completes login for a new user and sets a session cookie", async () => {
    const app = buildApp();
    const loginResponse = await app.inject({ method: "GET", url: "/api/auth/login" });
    const cookies = loginResponse.cookies;
    const txnCookie = cookies.find((c) => c.name === "monotar_login_txn")!;
    const { state } = JSON.parse(decodeURIComponent(txnCookie.value));

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/api/auth/callback/monoes?code=test-auth-code&state=${state}`,
      cookies: { monotar_login_txn: txnCookie.value },
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe("/dashboard");
    expect(callbackResponse.cookies.find((c) => c.name === "monotar_session")).toBeDefined();

    const user = await prisma.user.findFirst({ where: { email: "user@example.com" } });
    expect(user).not.toBeNull();
    const org = await prisma.organization.findFirst({ where: { members: { some: { userId: user!.id } } } });
    expect(org).not.toBeNull();
  });

  it("rejects a mismatched state", async () => {
    const app = buildApp();
    const loginResponse = await app.inject({ method: "GET", url: "/api/auth/login" });
    const txnCookie = loginResponse.cookies.find((c) => c.name === "monotar_login_txn")!;

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback/monoes?code=test-auth-code&state=wrong-state",
      cookies: { monotar_login_txn: txnCookie.value },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/login?error=invalid_state");
  });

  it("rejects a missing authorization code", async () => {
    const app = buildApp();
    const loginResponse = await app.inject({ method: "GET", url: "/api/auth/login" });
    const txnCookie = loginResponse.cookies.find((c) => c.name === "monotar_login_txn")!;
    const { state } = JSON.parse(decodeURIComponent(txnCookie.value));

    const response = await app.inject({
      method: "GET",
      url: `/api/auth/callback/monoes?state=${state}`,
      cookies: { monotar_login_txn: txnCookie.value },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/login?error=missing_code");
  });

  it("rejects a missing login transaction cookie (expired/reused)", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback/monoes?code=test-auth-code&state=some-state",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/login?error=expired_transaction");
  });
});
```

Update the mocked `@monotar/config` at the top of the file to point the issuer at the mock server via an environment variable read at call time. Replace the `vi.mock("@monotar/config", ...)` block with:
```ts
vi.mock("@monotar/config", async () => {
  const actual = await vi.importActual<typeof import("@monotar/config")>("@monotar/config");
  return {
    ...actual,
    loadEnv: () => ({
      monoesIssuer: process.env.MOCK_MONOES_URL ?? "https://monoes.me/api/auth",
      monoesMetadataUrl: "https://monoes.me/api/auth/.well-known/oauth-authorization-server",
      monoesClientId: "test-client-id",
      monoesScopes: ["openid", "profile", "email"],
      monoesRedirectUri: "http://localhost:3000/api/auth/callback/monoes",
      sessionCookieName: "monotar_session",
      nodeEnv: "test",
      apiPort: 4000,
      databaseUrl: process.env.DATABASE_URL ?? "postgresql://placeholder",
      redisUrl: "redis://placeholder",
      s3Endpoint: "http://placeholder",
      s3AccessKey: "placeholder",
      s3SecretKey: "placeholder",
      s3Bucket: "placeholder",
      appUrl: "http://localhost:3000",
    }),
  };
});
```

Because `loadEnv` now reads `process.env.MOCK_MONOES_URL` lazily on each call, and `beforeAll` sets that variable before any request runs, the login route builds its authorize/token URLs against the mock server for every test in this file, including the earlier `GET /api/auth/login` test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `/api/auth/callback/monoes` not registered (404s)

- [ ] **Step 3: Write minimal implementation**

Modify `services/api/src/routes/auth.ts` — add imports and the callback handler:
```ts
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";

// ... keep existing imports and the /api/auth/login handler above ...

interface MonoesOAuthResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
}

function decodeIdTokenPayload(idToken: string): { sub: string; email: string } {
  const [, payload] = idToken.split(".");
  const json = Buffer.from(payload, "base64url").toString("utf-8");
  return JSON.parse(json) as { sub: string; email: string };
}

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/login", async (_request, reply) => {
    // ... unchanged from Task 9 ...
  });

  app.get("/api/auth/callback/monoes", async (request, reply) => {
    const env = loadEnv();
    const query = request.query as { code?: string; state?: string };
    const txnCookieRaw = request.cookies[LOGIN_TXN_COOKIE];

    if (!txnCookieRaw) {
      return reply.redirect("/login?error=expired_transaction", 302);
    }

    reply.clearCookie(LOGIN_TXN_COOKIE, { path: "/" });

    let txn: { state: string; codeVerifier: string };
    try {
      txn = JSON.parse(txnCookieRaw);
    } catch {
      return reply.redirect("/login?error=expired_transaction", 302);
    }

    if (!query.state) {
      return reply.redirect("/login?error=missing_state", 302);
    }
    if (query.state !== txn.state) {
      return reply.redirect("/login?error=invalid_state", 302);
    }
    if (!query.code) {
      return reply.redirect("/login?error=missing_code", 302);
    }

    const exchangeResponse = await fetch(`${env.monoesIssuer}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: env.monoesRedirectUri,
        client_id: env.monoesClientId,
        code_verifier: txn.codeVerifier,
      }),
    });

    if (!exchangeResponse.ok) {
      return reply.redirect("/login?error=token_exchange_failed", 302);
    }

    const oauthResponse = (await exchangeResponse.json()) as MonoesOAuthResponse;
    const { sub, email } = decodeIdTokenPayload(oauthResponse.id_token);

    const existingIdentity = await prisma.externalIdentity.findUnique({
      where: { provider_providerSubject: { provider: "monoes", providerSubject: sub } },
      include: { user: true },
    });

    let userId: string;
    if (existingIdentity) {
      userId = existingIdentity.userId;
      await prisma.user.update({
        where: { id: userId },
        data: { email, lastLoginAt: new Date() },
      });
    } else {
      const user = await prisma.user.create({
        data: { email, lastLoginAt: new Date() },
      });
      userId = user.id;
      await prisma.externalIdentity.create({
        data: { userId, provider: "monoes", providerSubject: sub, email },
      });
      const org = await prisma.organization.create({
        data: { name: `${email}'s Organization` },
      });
      await prisma.organizationMember.create({
        data: { organizationId: org.id, userId, role: "OWNER" },
      });
    }

    const sessionValue = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    await prisma.session.create({
      data: {
        userId,
        sessionTokenHash: hashSessionValue(sessionValue),
        expiresAt,
      },
    });

    reply.setCookie(env.sessionCookieName, sessionValue, {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    return reply.redirect("/dashboard", 302);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (6 tests total in auth.test.ts)

- [ ] **Step 5: Commit**

```bash
git add services/api
git commit -m "feat(api): add MonoES OAuth callback with PKCE exchange and user provisioning"
```

---

### Task 11: Session Plugin, `/session`, `/me`, Logout

**Files:**
- Create: `services/api/src/plugins/session.ts`, `services/api/src/plugins/session.test.ts`
- Modify: `services/api/src/routes/auth.ts`, `services/api/src/app.ts`

**Interfaces:**
- Consumes: `prisma` from `../db`, `MeResponseSchema` from `@monotar/contracts`.
- Produces: Fastify decorator `request.currentUser: { id: string, email: string, organizationId: string, role: "OWNER"|"ADMIN"|"MEMBER" } | null`, populated by a `preHandler` hook registered as the `sessionPlugin` Fastify plugin (decorates every request). `GET /api/auth/session` → `{ authenticated: boolean }`. `GET /api/auth/me` → `MeResponse` (401 if unauthenticated). `POST /api/auth/logout` → revokes the session row, clears the cookie, `{ success: true }`. This `request.currentUser` decorator is consumed by every CRUD route task after this one.

- [ ] **Step 1: Write the failing test**

`services/api/src/plugins/session.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("session plugin and auth routes", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createLoggedInUser() {
    const user = await prisma.user.create({ data: { email: "me@example.com" } });
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
    const sessionValue = randomBytes(32).toString("base64url");
    await prisma.session.create({
      data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
    });
    return { user, org, sessionValue };
  }

  it("GET /api/auth/session returns false when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(response.json()).toEqual({ authenticated: false });
  });

  it("GET /api/auth/me returns 401 when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("GET /api/auth/me returns the current user when a valid session cookie is present", async () => {
    const { user, org, sessionValue } = await createLoggedInUser();
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { monotar_session: sessionValue },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: user.id, email: "me@example.com", organizationId: org.id, role: "OWNER" });
  });

  it("POST /api/auth/logout revokes the session", async () => {
    const { sessionValue } = await createLoggedInUser();
    const app = buildApp();
    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { monotar_session: sessionValue },
    });
    expect(logoutResponse.json()).toEqual({ success: true });

    const meResponse = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { monotar_session: sessionValue } });
    expect(meResponse.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — routes not registered / `currentUser` undefined

- [ ] **Step 3: Write minimal implementation**

`services/api/src/plugins/session.ts`:
```ts
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { loadEnv } from "@monotar/config";
import { prisma } from "../db";
import type { OrganizationRole } from "@prisma/client";

export interface CurrentUser {
  id: string;
  email: string;
  organizationId: string;
  role: OrganizationRole;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
  }
}

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function resolveCurrentUser(request: FastifyRequest): Promise<CurrentUser | null> {
  const env = loadEnv();
  const sessionValue = request.cookies[env.sessionCookieName];
  if (!sessionValue) return null;

  const session = await prisma.session.findUnique({
    where: { sessionTokenHash: hashSessionValue(sessionValue) },
    include: { user: { include: { organizationMembers: true } } },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }

  const membership = session.user.organizationMembers[0];
  if (!membership) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

export const sessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("currentUser", null);
  app.addHook("preHandler", async (request) => {
    request.currentUser = await resolveCurrentUser(request);
  });
});
```

Modify `services/api/src/routes/auth.ts` — append to `authRoutes`:
```ts
  app.get("/api/auth/session", async (request) => {
    return { authenticated: request.currentUser !== null };
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.currentUser.id } });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      organizationId: request.currentUser.organizationId,
      role: request.currentUser.role,
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const env = loadEnv();
    const sessionValue = request.cookies[env.sessionCookieName];
    if (sessionValue) {
      await prisma.session.updateMany({
        where: { sessionTokenHash: hashSessionValue(sessionValue) },
        data: { revokedAt: new Date() },
      });
    }
    reply.clearCookie(env.sessionCookieName, { path: "/" });
    return { success: true };
  });
```

Modify `services/api/src/app.ts` — register the plugin before routes:
```ts
import { sessionPlugin } from "./plugins/session";
// ...
  app.register(cookie);
  app.register(sessionPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
```

Modify `services/api/package.json` — add to `dependencies`: `"fastify-plugin": "^5.0.1"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (all api tests, including this file's 4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/api
git commit -m "feat(api): add session plugin, /session, /me, /logout"
```

---

### Task 12: Registration and Discovery-Check Scripts

**Files:**
- Create: `scripts/register-monoes-client.ts`, `scripts/check-monoes-oauth.ts`
- Modify: root `package.json` (add `monoes:register`, `monoes:check` scripts, `tsx` devDependency)

**Interfaces:**
- Produces: `pnpm monoes:register` and `pnpm monoes:check` CLI scripts. No other task depends on their internals (they are operator-run tools), only on the commands existing.

- [ ] **Step 1: Write `scripts/register-monoes-client.ts`**

```ts
#!/usr/bin/env tsx
// MonoES requires 127.0.0.1, not the "localhost" hostname, to recognize a
// redirect URI as loopback and allow http:// for it (see application_type below).
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
const registrationEndpoint = "https://monoes.me/api/auth/oauth2/register";
const redirectUri = `${appUrl}/api/auth/callback/monoes`;

async function main() {
  const response = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      // Without this, MonoES rejects http:// loopback redirect URIs outright
      // (its default "web" client type requires https, even for localhost).
      application_type: "native",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Registration failed: HTTP ${response.status}`);
    console.error(body);
    process.exit(1);
  }

  const body = (await response.json()) as { client_id: string };
  console.log(`Registered redirect_uri: ${redirectUri}`);
  console.log(`MONOES_CLIENT_ID=${body.client_id}`);
  console.log("Add this value to your .env.local — it is not written automatically.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Verified live against the real MonoES registration endpoint: registering with
`redirect_uris: ["http://localhost:3000/..."]` (no `application_type`) fails with
`{"error":"invalid_redirect_uri","error_description":"web clients require https
redirect URIs on non-loopback hosts: ..."}` even though the host looks like loopback
— MonoES only recognizes the literal `127.0.0.1` address, not the `localhost` name, and
only exempts `http://` for clients explicitly registered with `application_type:
"native"`. Both fixes are required together; either one alone still fails.

- [ ] **Step 2: Write `scripts/check-monoes-oauth.ts`**

```ts
#!/usr/bin/env tsx
const EXPECTED_ISSUER = "https://monoes.me/api/auth";
const metadataUrl = process.env.MONOES_METADATA_URL ?? `${EXPECTED_ISSUER}/.well-known/oauth-authorization-server`;

async function main() {
  const response = await fetch(metadataUrl);
  if (!response.ok) {
    console.error(`Discovery request failed: HTTP ${response.status}`);
    process.exit(1);
  }

  const metadata = (await response.json()) as { issuer: string; authorization_endpoint: string; token_endpoint: string };

  if (metadata.issuer !== EXPECTED_ISSUER) {
    console.error(`Issuer mismatch: expected "${EXPECTED_ISSUER}", got "${metadata.issuer}"`);
    process.exit(1);
  }

  console.log("MonoES discovery OK");
  console.log(`  issuer: ${metadata.issuer}`);
  console.log(`  authorization_endpoint: ${metadata.authorization_endpoint}`);
  console.log(`  token_endpoint: ${metadata.token_endpoint}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Wire root scripts**

Modify root `package.json` — add to `scripts`: `"monoes:register": "tsx scripts/register-monoes-client.ts", "monoes:check": "tsx scripts/check-monoes-oauth.ts"`; add to `devDependencies`: `"tsx": "^4.19.1"`.

- [ ] **Step 4: Verify against live MonoES**

Run: `pnpm monoes:check`
Expected: prints "MonoES discovery OK" with the three endpoints matching `https://monoes.me/api/auth/...`.

- [ ] **Step 5: Commit**

```bash
git add scripts package.json
git commit -m "feat: add monoes:register and monoes:check scripts"
```

---

### Task 13: Next.js Web App — Login and Dashboard

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.js`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/me` (via `NEXT_PUBLIC_API_URL` env var), `MeResponse` type from `@monotar/contracts`.
- Produces: `/login` page with a "Continue with MonoES" link to `${NEXT_PUBLIC_API_URL}/api/auth/login`; `/dashboard` page that server-fetches `/api/auth/me` (forwarding cookies) and redirects to `/login` if 401.

- [ ] **Step 1: Scaffold the Next.js app**

`apps/web/package.json`:
```json
{
  "name": "@monotar/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@monotar/contracts": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/react": "^18.3.11",
    "@types/node": "^22.7.9",
    "tailwindcss": "^3.4.14",
    "postcss": "^8.4.47",
    "autoprefixer": "^10.4.20"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["DOM", "ES2022"],
    "noEmit": true
  },
  "include": ["app", "next-env.d.ts"]
}
```

`apps/web/next.config.js`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

`apps/web/app/layout.tsx`:
```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/app/page.tsx`:
```tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Avatar Platform</h1>
      <Link href="/login">Log in</Link>
    </main>
  );
}
```

- [ ] **Step 2: Write the login page**

`apps/web/app/login/page.tsx`:
```tsx
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main>
      <h1>Log in</h1>
      {searchParams.error && <p role="alert">Login failed: {searchParams.error}</p>}
      <a href={`${API_URL}/api/auth/login`}>Continue with MonoES</a>
    </main>
  );
}
```

- [ ] **Step 3: Write the dashboard page**

`apps/web/app/dashboard/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { MeResponse } from "@monotar/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchMe(): Promise<MeResponse | null> {
  const cookieHeader = cookies().toString();
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as MeResponse;
}

export default async function DashboardPage() {
  const me = await fetchMe();
  if (!me) {
    redirect("/login");
  }
  return (
    <main>
      <h1>Dashboard</h1>
      <p>Signed in as {me.email}</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify it builds**

Run: `pnpm --filter @monotar/web build`
Expected: build succeeds (no type errors); note `/dashboard` is dynamically rendered (uses `cookies()`).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): add login and dashboard pages"
```

---

### Task 14: RBAC Helper + AvatarAgent CRUD

**Files:**
- Create: `services/api/src/rbac.ts`, `services/api/src/rbac.test.ts`
- Create: `services/api/src/routes/avatar-agents.ts`, `services/api/src/routes/avatar-agents.test.ts`
- Modify: `services/api/src/app.ts`

**Interfaces:**
- Consumes: `CurrentUser` from `../plugins/session`, `CreateAvatarAgentSchema, UpdateAvatarAgentSchema` from `@monotar/contracts`, `prisma` from `../db`.
- Produces: `requireRole(minRole: "MEMBER"|"ADMIN"|"OWNER"): (user: CurrentUser | null) => boolean` (role hierarchy `OWNER > ADMIN > MEMBER`). Routes: `GET/POST /api/avatar-agents`, `GET/PATCH/DELETE /api/avatar-agents/:id`, all requiring auth, all scoped to `request.currentUser.organizationId`, writes requiring `ADMIN+`.

- [ ] **Step 1: Write the failing RBAC test**

`services/api/src/rbac.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { requireRole } from "./rbac";
import type { CurrentUser } from "./plugins/session";

function userWithRole(role: CurrentUser["role"]): CurrentUser {
  return { id: "u1", email: "u1@example.com", organizationId: "org1", role };
}

describe("requireRole", () => {
  it("OWNER satisfies an ADMIN requirement", () => {
    expect(requireRole("ADMIN")(userWithRole("OWNER"))).toBe(true);
  });

  it("MEMBER does not satisfy an ADMIN requirement", () => {
    expect(requireRole("ADMIN")(userWithRole("MEMBER"))).toBe(false);
  });

  it("null user never satisfies any requirement", () => {
    expect(requireRole("MEMBER")(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `Cannot find module './rbac'`

- [ ] **Step 3: Write `rbac.ts`**

`services/api/src/rbac.ts`:
```ts
import type { CurrentUser } from "./plugins/session";

const ROLE_RANK: Record<CurrentUser["role"], number> = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

export function requireRole(minRole: CurrentUser["role"]) {
  return (user: CurrentUser | null): boolean => {
    if (!user) return false;
    return ROLE_RANK[user.role] >= ROLE_RANK[minRole];
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing CRUD tests**

`services/api/src/routes/avatar-agents.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createUserWithRole(orgName: string, role: "OWNER" | "ADMIN" | "MEMBER") {
  const user = await prisma.user.create({ data: { email: `${orgName}-${role}@example.com` } });
  const org = await prisma.organization.create({ data: { name: orgName } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role } });
  const sessionValue = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
  });
  return { user, org, sessionValue };
}

describe("AvatarAgent CRUD", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.avatarAgent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
  });

  it("ADMIN can create and list within their own org", async () => {
    const { org, sessionValue } = await createUserWithRole("acme", "ADMIN");
    const app = buildApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/avatar-agents",
      cookies: { monotar_session: sessionValue },
      payload: { name: "Bot", systemPrompt: "Be helpful", llmConfig: {}, voiceConfig: {} },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.organizationId).toBe(org.id);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/avatar-agents",
      cookies: { monotar_session: sessionValue },
    });
    expect(listResponse.json()).toHaveLength(1);
  });

  it("MEMBER cannot create (requires ADMIN+)", async () => {
    const { sessionValue } = await createUserWithRole("acme", "MEMBER");
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/avatar-agents",
      cookies: { monotar_session: sessionValue },
      payload: { name: "Bot", systemPrompt: "Be helpful", llmConfig: {}, voiceConfig: {} },
    });
    expect(response.statusCode).toBe(403);
  });

  it("cannot read another organization's AvatarAgents", async () => {
    const { sessionValue: adminSessionValue } = await createUserWithRole("acme", "ADMIN");
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/avatar-agents",
      cookies: { monotar_session: adminSessionValue },
      payload: { name: "Bot", systemPrompt: "Be helpful", llmConfig: {}, voiceConfig: {} },
    });
    const agentId = createResponse.json().id;

    const { sessionValue: otherSessionValue } = await createUserWithRole("globex", "OWNER");
    const getResponse = await app.inject({
      method: "GET",
      url: `/api/avatar-agents/${agentId}`,
      cookies: { monotar_session: otherSessionValue },
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/avatar-agents" });
    expect(response.statusCode).toBe(401);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `/api/avatar-agents` not registered (404s)

- [ ] **Step 7: Write `avatar-agents.ts`**

`services/api/src/routes/avatar-agents.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { CreateAvatarAgentSchema, UpdateAvatarAgentSchema } from "@monotar/contracts";
import { prisma } from "../db";
import { requireRole } from "../rbac";

const canWrite = requireRole("ADMIN");

export async function avatarAgentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  app.get("/api/avatar-agents", async (request) => {
    const orgId = request.currentUser!.organizationId;
    return prisma.avatarAgent.findMany({ where: { organizationId: orgId } });
  });

  app.get("/api/avatar-agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const agent = await prisma.avatarAgent.findFirst({ where: { id, organizationId: orgId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    return agent;
  });

  app.post("/api/avatar-agents", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const input = CreateAvatarAgentSchema.parse(request.body);
    const orgId = request.currentUser!.organizationId;
    const agent = await prisma.avatarAgent.create({ data: { ...input, organizationId: orgId } });
    return reply.code(201).send(agent);
  });

  app.patch("/api/avatar-agents/:id", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const existing = await prisma.avatarAgent.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const input = UpdateAvatarAgentSchema.parse(request.body);
    return prisma.avatarAgent.update({ where: { id }, data: input });
  });

  app.delete("/api/avatar-agents/:id", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const existing = await prisma.avatarAgent.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    await prisma.avatarAgent.delete({ where: { id } });
    return reply.code(204).send();
  });
}
```

Modify `services/api/src/app.ts` — add `app.register(avatarAgentRoutes);` after `authRoutes`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (all tests, including this file's 4 tests)

- [ ] **Step 9: Commit**

```bash
git add services/api
git commit -m "feat(api): add RBAC helper and tenant-scoped AvatarAgent CRUD"
```

---

### Task 15: Avatar CRUD (MinIO-backed metadata)

**Files:**
- Create: `services/api/src/routes/avatars.ts`, `services/api/src/routes/avatars.test.ts`
- Modify: `services/api/src/app.ts`, `services/api/package.json`

**Interfaces:**
- Consumes: `CreateAvatarSchema` from `@monotar/contracts`, `requireRole` from `../rbac`, `prisma` from `../db`.
- Produces: `GET/POST /api/avatars`, `GET/DELETE /api/avatars/:id` — same auth/tenant/RBAC pattern as Task 14. `POST` creates a row with `status: "PENDING"` and `thumbnailUrl: null` (no actual file upload in this slice — the presigned-URL upload flow is a later phase; this task only creates the metadata record).

- [ ] **Step 1: Write the failing tests**

`services/api/src/routes/avatars.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createUserWithRole(orgName: string, role: "OWNER" | "ADMIN" | "MEMBER") {
  const user = await prisma.user.create({ data: { email: `${orgName}-${role}@example.com` } });
  const org = await prisma.organization.create({ data: { name: orgName } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role } });
  const sessionValue = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId: user.id, sessionTokenHash: hashSessionValue(sessionValue), expiresAt: new Date(Date.now() + 100000) },
  });
  return { user, org, sessionValue };
}

describe("Avatar CRUD", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.avatarAgent.deleteMany();
    await prisma.avatar.deleteMany();
    await prisma.session.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.externalIdentity.deleteMany();
    await prisma.user.deleteMany();
  });

  it("ADMIN can create an avatar with PENDING status", async () => {
    const { sessionValue, org } = await createUserWithRole("acme", "ADMIN");
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/avatars",
      cookies: { monotar_session: sessionValue },
      payload: { name: "Default Avatar" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("PENDING");
    expect(body.organizationId).toBe(org.id);
  });

  it("MEMBER cannot create", async () => {
    const { sessionValue } = await createUserWithRole("acme", "MEMBER");
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/avatars",
      cookies: { monotar_session: sessionValue },
      payload: { name: "Default Avatar" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("cannot read another organization's avatars", async () => {
    const { sessionValue: adminSessionValue } = await createUserWithRole("acme", "ADMIN");
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/avatars",
      cookies: { monotar_session: adminSessionValue },
      payload: { name: "Default Avatar" },
    });
    const avatarId = createResponse.json().id;

    const { sessionValue: otherSessionValue } = await createUserWithRole("globex", "OWNER");
    const response = await app.inject({
      method: "GET",
      url: `/api/avatars/${avatarId}`,
      cookies: { monotar_session: otherSessionValue },
    });
    expect(response.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — `/api/avatars` not registered

- [ ] **Step 3: Write `avatars.ts`**

`services/api/src/routes/avatars.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { CreateAvatarSchema } from "@monotar/contracts";
import { prisma } from "../db";
import { requireRole } from "../rbac";

const canWrite = requireRole("ADMIN");

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  app.get("/api/avatars", async (request) => {
    const orgId = request.currentUser!.organizationId;
    return prisma.avatar.findMany({ where: { organizationId: orgId } });
  });

  app.get("/api/avatars/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const avatar = await prisma.avatar.findFirst({ where: { id, organizationId: orgId } });
    if (!avatar) return reply.code(404).send({ error: "not_found" });
    return avatar;
  });

  app.post("/api/avatars", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const input = CreateAvatarSchema.parse(request.body);
    const orgId = request.currentUser!.organizationId;
    const avatar = await prisma.avatar.create({
      data: { name: input.name, organizationId: orgId, status: "PENDING" },
    });
    return reply.code(201).send(avatar);
  });

  app.delete("/api/avatars/:id", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const existing = await prisma.avatar.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    await prisma.avatar.delete({ where: { id } });
    return reply.code(204).send();
  });
}
```

Modify `services/api/src/app.ts` — add `app.register(avatarRoutes);` after `avatarAgentRoutes`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (all tests, including this file's 3 tests)

- [ ] **Step 5: Commit**

```bash
git add services/api
git commit -m "feat(api): add tenant-scoped Avatar CRUD"
```

---

### Task 16: Dashboard AvatarAgent List/Create UI

**Files:**
- Create: `apps/web/app/dashboard/avatar-agents-client.tsx`
- Modify: `apps/web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/avatar-agents`, `AvatarAgent, CreateAvatarAgentInput` types from `@monotar/contracts`.
- Produces: a client component rendering the list and a create form, calling the API with `credentials: "include"`.

- [ ] **Step 1: Write the client component**

`apps/web/app/dashboard/avatar-agents-client.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import type { AvatarAgent } from "@monotar/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function AvatarAgentsClient() {
  const [agents, setAgents] = useState<AvatarAgent[]>([]);
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadAgents() {
    const response = await fetch(`${API_URL}/api/avatar-agents`, { credentials: "include" });
    if (response.ok) {
      setAgents(await response.json());
    }
  }

  useEffect(() => {
    loadAgents();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch(`${API_URL}/api/avatar-agents`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, systemPrompt, llmConfig: {}, voiceConfig: {} }),
    });
    if (!response.ok) {
      setError(`Failed to create agent (${response.status})`);
      return;
    }
    setName("");
    setSystemPrompt("");
    await loadAgents();
  }

  return (
    <section>
      <h2>Avatar Agents</h2>
      {error && <p role="alert">{error}</p>}
      <ul>
        {agents.map((agent) => (
          <li key={agent.id}>{agent.name}</li>
        ))}
      </ul>
      <form onSubmit={handleCreate}>
        <input
          aria-label="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Agent name"
          required
        />
        <input
          aria-label="system prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="System prompt"
          required
        />
        <button type="submit">Create</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into the dashboard page**

Modify `apps/web/app/dashboard/page.tsx` — add import and render:
```tsx
import { AvatarAgentsClient } from "./avatar-agents-client";
// ... inside the returned JSX, after <p>Signed in as {me.email}</p>:
      <AvatarAgentsClient />
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm --filter @monotar/web build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): add AvatarAgent list/create UI on dashboard"
```

---

### Task 17: RealtimeSession State Machine

**Files:**
- Create: `services/api/src/realtime/session-state-machine.ts`, `services/api/src/realtime/session-state-machine.test.ts`

**Interfaces:**
- Consumes: `RealtimeState` type from `@monotar/contracts`.
- Produces: `class RealtimeSession` with `constructor()` (starts in `"CREATED"`), `get state(): RealtimeState`, `transition(next: RealtimeState): void` (throws `InvalidTransitionError` if not allowed), `on(event: "transition", handler: (from: RealtimeState, to: RealtimeState) => void): void`. `class InvalidTransitionError extends Error`. Consumed by Task 18/19's WS route.

- [ ] **Step 1: Write the failing tests**

`services/api/src/realtime/session-state-machine.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`services/api/src/realtime/session-state-machine.ts`:
```ts
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
```

Note: `ERROR` is reachable from every state because it is listed explicitly in each state's allowed-transitions array above (including `CREATED`) — there is no separate always-allow special case, keeping the transition table the single source of truth.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add services/api/src/realtime/session-state-machine.ts services/api/src/realtime/session-state-machine.test.ts
git commit -m "feat(api): add RealtimeSession state machine with interrupt support"
```

---

### Task 18: Provider Interfaces and Mock Implementations

**Files:**
- Create: `services/api/src/realtime/providers.ts`, `services/api/src/realtime/mock-providers.ts`

**Interfaces:**
- Produces:
  - `interface SpeechToTextProvider { transcribe(audioChunk: Buffer): Promise<string> }`
  - `interface LLMProvider { generateReply(userText: string, history: Array<{role: "user"|"assistant", content: string}>): AsyncGenerator<string> }`
  - `interface TextToSpeechProvider { synthesize(text: string): AsyncGenerator<Buffer> }`
  - `interface AvatarEngine { onStateChange(state: import("@monotar/contracts").RealtimeState): void }`
  - `class MockSTT implements SpeechToTextProvider`, `class MockLLM implements LLMProvider`, `class MockTTS implements TextToSpeechProvider`, `class MockAvatarEngine implements AvatarEngine` (records received states in a public `receivedStates: RealtimeState[]` array for test assertions).
  - Consumed directly by Task 19's WS route.

- [ ] **Step 1: Write the failing test**

`services/api/src/realtime/mock-providers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";

describe("Mock providers", () => {
  it("MockSTT returns a canned transcript", async () => {
    const stt = new MockSTT();
    const text = await stt.transcribe(Buffer.from("fake-audio"));
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("MockLLM streams a non-empty reply", async () => {
    const llm = new MockLLM();
    const chunks: string[] = [];
    for await (const chunk of llm.generateReply("hello", [])) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toContain("hello");
  });

  it("MockTTS yields at least one audio buffer", async () => {
    const tts = new MockTTS();
    const buffers: Buffer[] = [];
    for await (const chunk of tts.synthesize("hi there")) {
      buffers.push(chunk);
    }
    expect(buffers.length).toBeGreaterThan(0);
  });

  it("MockAvatarEngine records state changes", () => {
    const engine = new MockAvatarEngine();
    engine.onStateChange("LISTENING");
    engine.onStateChange("AI_SPEAKING");
    expect(engine.receivedStates).toEqual(["LISTENING", "AI_SPEAKING"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`services/api/src/realtime/providers.ts`:
```ts
import type { RealtimeState } from "@monotar/contracts";

export interface SpeechToTextProvider {
  transcribe(audioChunk: Buffer): Promise<string>;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  generateReply(userText: string, history: ConversationTurn[]): AsyncGenerator<string>;
}

export interface TextToSpeechProvider {
  synthesize(text: string): AsyncGenerator<Buffer>;
}

export interface AvatarEngine {
  onStateChange(state: RealtimeState): void;
}
```

`services/api/src/realtime/mock-providers.ts`:
```ts
import type { RealtimeState } from "@monotar/contracts";
import type {
  AvatarEngine,
  ConversationTurn,
  LLMProvider,
  SpeechToTextProvider,
  TextToSpeechProvider,
} from "./providers";

export class MockSTT implements SpeechToTextProvider {
  async transcribe(_audioChunk: Buffer): Promise<string> {
    return "hello, this is a mock transcript";
  }
}

export class MockLLM implements LLMProvider {
  async *generateReply(userText: string, _history: ConversationTurn[]): AsyncGenerator<string> {
    const words = `You said: hello ${userText}. This is a mocked reply.`.split(" ");
    for (const word of words) {
      yield `${word} `;
    }
  }
}

export class MockTTS implements TextToSpeechProvider {
  async *synthesize(text: string): AsyncGenerator<Buffer> {
    const chunkCount = Math.max(1, Math.ceil(text.length / 20));
    for (let i = 0; i < chunkCount; i++) {
      yield Buffer.from(`mock-audio-chunk-${i}`);
    }
  }
}

export class MockAvatarEngine implements AvatarEngine {
  receivedStates: RealtimeState[] = [];

  onStateChange(state: RealtimeState): void {
    this.receivedStates.push(state);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/api/src/realtime/providers.ts services/api/src/realtime/mock-providers.ts services/api/src/realtime/mock-providers.test.ts
git commit -m "feat(api): add provider interfaces and mock STT/LLM/TTS/AvatarEngine implementations"
```

---

### Task 19: WebSocket Route Wiring the Full Mock Conversation

**Files:**
- Create: `services/api/src/realtime/ws-route.ts`, `services/api/src/realtime/ws-route.test.ts`
- Modify: `services/api/src/app.ts`, `services/api/package.json`

**Interfaces:**
- Consumes: `RealtimeSession` (Task 17), `MockSTT/MockLLM/MockTTS/MockAvatarEngine` (Task 18), `ClientMessageSchema, ServerMessageSchema` (Task 4), `request.currentUser` (Task 11).
- Produces: `WS /api/realtime/:agentId` — on connect: requires `request.currentUser` (else close code 4401); sends `{type:"state", state:"LISTENING"}`. On `{type:"audio_chunk"}`: transitions `USER_SPEAKING` → transcribes → sends `{type:"transcript"}` → `THINKING` → streams LLM reply as `{type:"assistant_text"}` chunks → `AI_SPEAKING` → streams TTS as `{type:"audio_chunk"}` → back to `LISTENING`. On `{type:"interrupt"}` while `AI_SPEAKING`: transitions `INTERRUPTING` → `LISTENING`, stops any in-flight TTS iteration. Every state change also calls `MockAvatarEngine.onStateChange` and emits `{type:"state"}` to the client.

- [ ] **Step 1: Write the failing test**

`services/api/src/realtime/ws-route.test.ts`:
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

  it("runs a full mock conversation turn and reaches LISTENING again", async () => {
    const { sessionValue, agent } = await createLoggedInUser();
    const app = buildApp();
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/realtime/${agent.id}`, {
      headers: { cookie: `monotar_session=${sessionValue}` },
    });

    await new Promise((resolve) => ws.on("open", resolve));
    const initialState = await collectMessages(ws, 1);
    expect(initialState[0]).toEqual({ type: "state", state: "LISTENING" });

    const turnMessages = collectMessages(ws, 6);
    ws.send(JSON.stringify({ type: "audio_chunk", data: "ZmFrZS1hdWRpbw==" }));
    const messages = await turnMessages;

    const states = messages.filter((m) => m.type === "state").map((m: any) => m.state);
    expect(states).toEqual(["USER_SPEAKING", "THINKING", "AI_SPEAKING", "LISTENING"]);
    expect(messages.some((m) => m.type === "transcript")).toBe(true);
    expect(messages.some((m) => m.type === "assistant_text")).toBe(true);

    ws.close();
    await app.close();
  });

  it("handles interrupt during AI_SPEAKING", async () => {
    const { sessionValue, agent } = await createLoggedInUser();
    const app = buildApp();
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/realtime/${agent.id}`, {
      headers: { cookie: `monotar_session=${sessionValue}` },
    });

    await new Promise((resolve) => ws.on("open", resolve));
    await collectMessages(ws, 1); // initial LISTENING

    let sawAiSpeaking = false;
    const interruptHandled = new Promise<void>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as ServerMessage;
        if (msg.type === "state" && msg.state === "AI_SPEAKING" && !sawAiSpeaking) {
          sawAiSpeaking = true;
          ws.send(JSON.stringify({ type: "interrupt" }));
        }
        if (msg.type === "state" && msg.state === "LISTENING" && sawAiSpeaking) {
          resolve();
        }
      });
    });

    ws.send(JSON.stringify({ type: "audio_chunk", data: "ZmFrZS1hdWRpbw==" }));
    await interruptHandled;

    ws.close();
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @monotar/api test`
Expected: FAIL — module not found / route not registered

- [ ] **Step 3: Write minimal implementation**

Modify `services/api/package.json` — add to `dependencies`: `"@fastify/websocket": "^11.0.1"`; add to `devDependencies`: `"ws": "^8.18.0", "@types/ws": "^8.5.12"`.

`services/api/src/realtime/ws-route.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { ClientMessage, ServerMessage, RealtimeState } from "@monotar/contracts";
import { ClientMessageSchema } from "@monotar/contracts";
import { RealtimeSession } from "./session-state-machine";
import { MockSTT, MockLLM, MockTTS, MockAvatarEngine } from "./mock-providers";

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/realtime/:agentId", { websocket: true }, (socket, request) => {
    if (!request.currentUser) {
      socket.close(4401, "unauthenticated");
      return;
    }

    const session = new RealtimeSession();
    const stt = new MockSTT();
    const llm = new MockLLM();
    const tts = new MockTTS();
    const avatarEngine = new MockAvatarEngine();
    let interrupted = false;

    function send(message: ServerMessage): void {
      socket.send(JSON.stringify(message));
    }

    function setState(next: RealtimeState): void {
      session.transition(next);
      avatarEngine.onStateChange(next);
      send({ type: "state", state: next });
    }

    setState("LISTENING");

    socket.on("message", async (raw: Buffer) => {
      let parsed: ClientMessage;
      try {
        parsed = ClientMessageSchema.parse(JSON.parse(raw.toString()));
      } catch {
        send({ type: "error", code: "invalid_message", message: "Could not parse message" });
        return;
      }

      if (parsed.type === "interrupt") {
        if (session.state === "AI_SPEAKING") {
          interrupted = true;
          setState("INTERRUPTING");
          setState("LISTENING");
        }
        return;
      }

      if (parsed.type === "end") {
        setState("ENDED");
        socket.close(1000, "ended");
        return;
      }

      if (parsed.type === "audio_chunk") {
        interrupted = false;
        setState("USER_SPEAKING");
        const transcript = await stt.transcribe(Buffer.from(parsed.data, "base64"));
        send({ type: "transcript", text: transcript });

        setState("THINKING");
        let assistantText = "";
        for await (const chunk of llm.generateReply(transcript, [])) {
          assistantText += chunk;
        }
        send({ type: "assistant_text", text: assistantText });

        setState("AI_SPEAKING");
        for await (const audioChunk of tts.synthesize(assistantText)) {
          if (interrupted) break;
          send({ type: "audio_chunk", data: audioChunk.toString("base64") });
        }

        if (!interrupted && session.state === "AI_SPEAKING") {
          setState("LISTENING");
        }
      }
    });

    socket.on("close", () => {
      if (session.state !== "ENDED" && session.state !== "ERROR") {
        try {
          setState("ENDED");
        } catch {
          // already terminal from a prior transition; nothing to do
        }
      }
    });
  });
}
```

Modify `services/api/src/app.ts`:
```ts
import websocket from "@fastify/websocket";
import { realtimeRoutes } from "./realtime/ws-route";
// ...
  app.register(websocket);
  // ... after avatarRoutes:
  app.register(realtimeRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @monotar/api test`
Expected: PASS (all api tests, including this file's 2 tests)

- [ ] **Step 5: Commit**

```bash
git add services/api
git commit -m "feat(api): add WebSocket realtime route wiring mock conversation pipeline with interrupt"
```

---

### Task 20: Talk Page — Mic Capture, Transcript, Interrupt UI

**Files:**
- Create: `apps/web/app/talk/[agentId]/page.tsx`, `apps/web/app/talk/[agentId]/talk-client.tsx`

**Interfaces:**
- Consumes: `WS /api/realtime/:agentId`, `ClientMessage, ServerMessage` types from `@monotar/contracts`.
- Produces: a page at `/talk/:agentId` with a "Start Talking" button (requests mic permission via `getUserMedia`, records via `MediaRecorder`, sends `audio_chunk` messages base64-encoded), a live transcript/assistant-text display, an avatar placeholder `<div>` whose text content reflects the current `RealtimeState`, and a manual "Interrupt" button.

- [ ] **Step 1: Write the talk page shell**

`apps/web/app/talk/[agentId]/page.tsx`:
```tsx
import { TalkClient } from "./talk-client";

export default async function TalkPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return (
    <main>
      <h1>Talk</h1>
      <TalkClient agentId={agentId} />
    </main>
  );
}
```

Note: Next.js 15 (resolved by the `^15.0.2` range in Task 13) made `params`/`searchParams`
async `Promise` props on page components — this differs from Next.js 14 and earlier.
`apps/web/app/login/page.tsx` (Task 13) already uses the same `Promise`-based pattern for
`searchParams`; follow it here too, or `next build` will fail type-checking.

- [ ] **Step 2: Write the client component**

`apps/web/app/talk/[agentId]/talk-client.tsx`:
```tsx
"use client";

import { useRef, useState } from "react";
import type { ServerMessage, RealtimeState } from "@monotar/contracts";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

export function TalkClient({ agentId }: { agentId: string }) {
  const [state, setState] = useState<RealtimeState>("CREATED");
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  async function startTalking() {
    const ws = new WebSocket(`${WS_URL}/api/realtime/${agentId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === "state") setState(message.state);
      if (message.type === "transcript") setTranscript(message.text);
      if (message.type === "assistant_text") setAssistantText(message.text);
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = async (event) => {
      const buffer = await event.data.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      ws.send(JSON.stringify({ type: "audio_chunk", data: base64 }));
    };

    recorder.start(3000);
  }

  function sendInterrupt() {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }

  return (
    <div>
      <div data-testid="avatar-placeholder">Avatar state: {state}</div>
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
git add apps/web
git commit -m "feat(web): add /talk/:agentId mock conversation UI with interrupt"
```

---

### Task 21: Secret-Scan Script and CI Workflow

**Files:**
- Create: `scripts/scan-bundle-for-secrets.ts`, `.github/workflows/ci.yml`
- Modify: root `package.json` (add `security:scan-bundle` script)

**Interfaces:**
- Produces: `pnpm security:scan-bundle` — builds `apps/web`, greps `.next/static` for forbidden field-name substrings, exits non-zero if any are found. CI workflow running install → lint → typecheck → test → the secret scan on every push.

- [ ] **Step 1: Establish the passing baseline**

Run `pnpm --filter @monotar/web build` first (from Task 13/16/20) so `.next/static` exists, and confirm manually (`grep -r "access_token" apps/web/.next/static` or similar) that none of the forbidden field names below currently appear in the built client bundle — this is the passing baseline the script should report before it is even written.

- [ ] **Step 2: Write `scripts/scan-bundle-for-secrets.ts`**

```ts
#!/usr/bin/env tsx
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_FIELD_NAMES = [
  "access_token",
  "refresh_token",
  "sessionTokenHash",
];

const BUNDLE_DIR = join(process.cwd(), "apps/web/.next/static");

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walk(fullPath));
    } else if (fullPath.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  const files = walk(BUNDLE_DIR);
  const violations: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const fieldName of FORBIDDEN_FIELD_NAMES) {
      if (content.includes(fieldName)) {
        violations.push(`${file}: contains field name "${fieldName}"`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("Forbidden field names found in client bundle:");
    violations.forEach((v) => console.error(`  ${v}`));
    process.exit(1);
  }

  console.log(`Scanned ${files.length} bundle files — no forbidden field names found.`);
}

main();
```

- [ ] **Step 3: Wire the root script**

Modify root `package.json` — add to `scripts`: `"security:scan-bundle": "tsx scripts/scan-bundle-for-secrets.ts"`.

- [ ] **Step 4: Run it against the built bundle**

Run: `pnpm --filter @monotar/web build && pnpm security:scan-bundle`
Expected: "Scanned N bundle files — no forbidden field names found."

- [ ] **Step 5: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16.4
        env:
          POSTGRES_USER: monotar
          POSTGRES_DB: monotar
          POSTGRES_PASSWORD: ${{ secrets.CI_POSTGRES_PASSWORD || 'ci-only-ephemeral' }}
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U monotar"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://monotar:ci-only-ephemeral@localhost:5432/monotar
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.18.1
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @monotar/api exec prisma migrate deploy
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter @monotar/web build
      - run: pnpm security:scan-bundle
```

This job's Postgres password only ever exists inside the ephemeral GitHub Actions
service container for the duration of a single workflow run — it is not a real,
reusable credential.

- [ ] **Step 6: Commit**

```bash
git add scripts/scan-bundle-for-secrets.ts .github/workflows/ci.yml package.json
git commit -m "feat: add bundle secret scan and CI workflow"
```

---

## Post-Plan Manual Verification (Phase 1 Acceptance)

Per `auth` §22, Phase 1 is not done until tested against the **real** MonoES authorization server outside CI:

1. Run `pnpm monoes:register` (needs `APP_URL=http://localhost:3000` in the environment) and copy the printed `MONOES_CLIENT_ID` into `.env.local` for both `services/api` and `apps/web`.
2. Start infra: `docker compose up -d`.
3. Start the API: `pnpm --filter @monotar/api dev`.
4. Start the web app: `pnpm --filter @monotar/web dev`.
5. Visit `http://localhost:3000/login`, click "Continue with MonoES", complete real MonoES login, confirm redirect to `/dashboard` with the correct email shown.
6. Confirm `/api/avatar-agents` CRUD works from the dashboard UI.
7. Visit `/talk/:agentId` (using a real created AvatarAgent id), grant mic permission, confirm transcript/assistant text appear and the avatar-state text updates through the full LISTENING → USER_SPEAKING → THINKING → AI_SPEAKING → LISTENING cycle, and that clicking "Interrupt" during AI_SPEAKING returns to LISTENING immediately.
