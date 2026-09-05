# Upstream Dependencies (Phase 0-3)

| Dependency | Pinned Version | Purpose |
|---|---|---|
| postgres | 16.4 | primary datastore |
| redis | 7.4-alpine | login-transaction + future caching |
| minio | RELEASE.2024-10-13T13-34-11Z | S3-compatible object storage for avatar assets |

Start with `docker compose up -d` (after `cp .env.example .env.local` and filling in
your own local dev passwords, then `set -a && source .env.local && set +a`). Stop with
`docker compose down` (add `-v` to also wipe volumes).

## Phase 4-9 additions

| Dependency | Source | Pinned Commit | License | Notes |
|---|---|---|---|---|
| LiveTalking | github.com/lipku/LiveTalking | c4f8c16a86bdc4d217782cac52fb431dc5bca7b0 | see docs/licenses/livetalking.md | primary avatar renderer wrapper |
| MuseTalk | github.com/TMElyralab/MuseTalk | 0a89dec45a0192b824e3cf4daf96c239440c5ed8 | see docs/licenses/musetalk.md | requires CUDA; adapter built, not runnable on this hardware |
| Wav2Lip | github.com/Rudrabha/Wav2Lip | bac9a81e63ecc153202353372e5724b83d9e6322 | see docs/licenses/wav2lip.md | primary local renderer on this hardware (CPU-capable) |
| LiveKit Server | self-hosted, docker.io/livekit/livekit-server | pinned image tag in docker-compose.yml | Apache 2.0 | media transport |
| coturn | self-hosted, docker.io/coturn/coturn | pinned image tag in docker-compose.yml | BSD-3-Clause | TURN relay |
