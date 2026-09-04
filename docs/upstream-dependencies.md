# Upstream Dependencies (Phase 0-3)

| Dependency | Pinned Version | Purpose |
|---|---|---|
| postgres | 16.4 | primary datastore |
| redis | 7.4-alpine | login-transaction + future caching |
| minio | RELEASE.2024-10-13T13-34-11Z | S3-compatible object storage for avatar assets |

Start with `docker compose up -d` (after `cp .env.example .env.local` and filling in
your own local dev passwords, then `set -a && source .env.local && set +a`). Stop with
`docker compose down` (add `-v` to also wipe volumes).
