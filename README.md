# Hotel Offer Orchestrator

An API that searches two hotel suppliers in parallel and returns the best offer per hotel.
A Temporal workflow calls the suppliers, merges the results and saves them in Redis.
Price filtering runs in Redis.

## Setup (Docker)

Prerequisite: Docker with Compose v2.

```bash
git clone <repo-url> hotel-offer-orchestrator
cd hotel-offer-orchestrator
docker compose up --build -d --wait
```

The first start takes a few minutes: it pulls the images and sets up the Temporal database.

Try it:

```bash
curl 'http://localhost:3000/api/hotels?city=delhi'
curl -i 'http://localhost:3000/api/hotels?city=delhi&minPrice=5000&maxPrice=9000'
curl 'http://localhost:3000/health'
```

| URL                   | What                                             |
| --------------------- | ------------------------------------------------ |
| http://localhost:3000 | API                                              |
| http://localhost:8080 | Temporal UI (workflow runs and their activities) |

Stop with `docker compose down`. Add `-v` to also remove the Temporal database.

## Local development

Start only the infrastructure in Docker:

```bash
docker compose up -d --wait postgresql temporal temporal-create-namespace temporal-ui redis
```

Then, on your machine:

```bash
cp .env.example .env
npm ci
npm run dev          # terminal 1: API on :3000
npm run dev:worker   # terminal 2: Temporal worker
```

Both scripts load `.env` and restart on file changes.

## Testing

| Command                    | What it runs                                 | Needs                                                     |
| -------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `npm test`                 | Unit, workflow and route tests               | No Docker; the first run downloads a Temporal test server |
| `npm run test:integration` | Redis cache tests                            | The compose Redis running                                 |
| Postman collection         | End-to-end checks of every endpoint and case | The full compose stack                                    |

- Integration tests use database 0 of the Redis at `REDIS_URL` (default
  `redis://localhost:6379`) and delete all `hotels:*` keys there.
- Postman: import `postman/hotel-offers.postman_collection.json` and run it with the
  Collection Runner, or run `npx newman run postman/hotel-offers.postman_collection.json`.
  The collection resets the mock suppliers itself, so it can run repeatedly.

## Deployment

The same compose file runs on any Docker host: clone, set the environment, `docker compose up --build -d --wait`.

For a real deployment:

- Set `ENABLE_MOCK_SUPPLIERS=false` and point `SUPPLIER_A_URL` / `SUPPLIER_B_URL` at the real suppliers.
- Use managed Redis and Temporal instead of the compose containers.
- Take secrets from the platform's secret store, not from `.env`.


| Variable                    | Default                                  | Meaning                                                         |
| --------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`                  | `development`                            | `production` makes the worker load the prebuilt workflow bundle |
| `LOG_LEVEL`                 | `info`                                   | pino log level                                                  |
| `PORT`                      | `3000`                                   | API port                                                        |
| `REDIS_URL`                 | `redis://localhost:6379`                 | Redis connection                                                |
| `TEMPORAL_ADDRESS`          | `localhost:7233`                         | Temporal frontend                                               |
| `TEMPORAL_NAMESPACE`        | `default`                                | Temporal namespace                                              |
| `TEMPORAL_TASK_QUEUE`       | `hotel-offers`                           | Task queue shared by API and worker                             |
| `SUPPLIER_A_URL`            | `http://localhost:3000/supplierA/hotels` | Supplier A hotels endpoint                                      |
| `SUPPLIER_B_URL`            | `http://localhost:3000/supplierB/hotels` | Supplier B hotels endpoint                                      |
| `CACHE_TTL_SECONDS`         | `300`                                    | Cache lifetime of a full result                                 |
| `PARTIAL_CACHE_TTL_SECONDS` | `30`                                     | Cache lifetime when a supplier failed                           |
| `ENABLE_MOCK_SUPPLIERS`     | `false`                                  | Mounts the mock supplier and `/mock/suppliers/*` control routes |

## Design decisions

| Decision              | Choice                                                                                   | Reason                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Hotel identity        | Normalized name: trim, lowercase, collapse spaces                                        | Suppliers spell the same hotel differently (`"Radison"`, `"radison "`)                     |
| Tie-breaks            | Lower price, then higher `commissionPct`, then supplier name, then display name          | Deterministic result; supplier name stands in for a configured priority                    |
| Supplier failure      | One down: partial result and `X-Partial-Results` header. Both down: 502                  | A partial answer is more useful than an error, and the client can see it                   |
| Retries               | Timeout, network errors and 5xx retry (3 attempts); 4xx and invalid data do not          | Retrying only helps with temporary failures                                                |
| Cache                 | Redis sorted set with price as score, plus a meta key; TTL 300s, 30s for partial results | Range queries in Redis; the meta key caches empty results; partial results recover quickly |
| When to use the cache | No price filter: fresh search. With a filter: Redis first (`X-Cache: HIT/MISS/BYPASS`)   | Plain searches stay fresh; filters reuse the saved list                                    |
| Redis failure         | A failed save does not fail the search; only filtered requests return 503                | Redis is only required for filtering                                                       |
| Health                | `/health`: one supplier down = `degraded` with 200. Docker uses `/livez`                 | A 503 would pull a working service out of a load balancer                                  |
| Mock suppliers        | Mounted only when `ENABLE_MOCK_SUPPLIERS=true` (on in compose, off by default)           | Test hooks are never exposed by accident                                                   |
| Limitation            | Identity is name only, as in the spec                                                    | Real matching would map supplier `hotelId`s by address or geo location                     |
