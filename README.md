# Hotel Offer Orchestrator

> Work in progress.

## Running locally

```bash
docker compose up -d --build --wait
```

| Service     | Port | Notes                                                           |
| ----------- | ---- | --------------------------------------------------------------- |
| API         | 3000 | `GET /health`; mock suppliers `GET /supplier{A,B}/hotels?city=` |
| Temporal UI | 8080 | <http://localhost:8080>                                         |
| Temporal    | 7233 | gRPC frontend                                                   |
| Redis       | 6379 |                                                                 |

For development outside Docker (needs Redis and Temporal from compose running):

```bash
npm ci
npm run dev          # API, watch mode
npm run dev:worker   # Temporal worker, bundles workflows from source
```

## Temporal compose setup

The Temporal services in `docker-compose.yml` and the files under `docker/temporal/` are adapted
from [temporalio/samples-server/compose](https://github.com/temporalio/samples-server/tree/main/compose)
(`docker-compose-postgres.yml`). The older `temporalio/docker-compose` repository is archived and
points there.

Image versions follow upstream's `compose/.env`, pinned to exact tags:

| Image                    | Upstream `.env` | Pinned here |
| ------------------------ | --------------- | ----------- |
| `temporalio/server`      | `1.31.0`        | `1.31.4`    |
| `temporalio/admin-tools` | `1.31.0`        | `1.31.4`    |
| `temporalio/ui`          | `2.49.1`        | `2.49.1`    |
| `postgres`               | `16`            | `16.15`     |

Temporal server and admin-tools stay on upstream's 1.31 line but take its latest patch release.
PostgreSQL is pinned to a patch release because upstream's `16` tag floats.

Local change: `docker/temporal/scripts/create-namespace.sh` fixes an upstream typo
(`$MAX_ATTdMPTS` → `$MAX_ATTEMPTS`) on the namespace-creation retry path. Because the script runs
with `set -u`, the typo would abort it with an "unbound variable" error instead of retrying.
