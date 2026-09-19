# UP Heritage Tours — B2B WhatsApp Outreach + CRM Platform

Collects travel-agency contacts from Google Maps, runs paced WhatsApp outreach via
OpenWA, understands replies with AI, and tracks qualified leads through a CRM.

---

## Architecture

```
Frontend (React + Ant Design)  →  Backend (NestJS)  →  OpenWA  →  WhatsApp
                                       ↕                  ↑
                            PostgreSQL + Redis         webhooks
                                       ↕
                     OpenAI / Gemini  ·  Google Maps Places API
```

| Service | Port | Purpose |
|---|---|---|
| Frontend | 5173 | React SPA |
| Backend API | 3000 | NestJS REST API (`/api`) |
| PostgreSQL | 5432 | Primary datastore |
| Redis | 6379 | BullMQ queues + counters |
| OpenWA | 2785 | WhatsApp gateway |

---

## Quick Start — Local Development

### Prerequisites
- Node.js 22+
- PostgreSQL 16 and Redis 7 (either native or via Docker)
- An OpenAI **or** Gemini API key (for reply analysis)
- A Google Maps **Places API (New)** key (for data collection)

### 1. Start Postgres and Redis

With Docker:
```bash
cp .env.example .env      # then fill in POSTGRES_PASSWORD, JWT secrets, etc.
docker compose up postgres redis -d
```

Or with Homebrew:
```bash
brew services start postgresql@16
brew services start redis
createuser -s uptour && createdb -O uptour uptour
```

### 2. Backend
```bash
cd backend
cp .env.example .env       # fill in DATABASE_PASSWORD + your API keys
npm install
npm run start:dev
```

Tables are created automatically on first boot (TypeORM `synchronize` is on
outside production) and a default admin user is seeded.

### 3. Frontend
```bash
cd frontend
cp .env.example .env       # optional; defaults to http://localhost:3000/api
npm install
npm run dev
```

### 4. Open the app
- Frontend: http://localhost:5173
- Swagger: http://localhost:3000/api/docs
- Health: http://localhost:3000/api/health
- Default login: `admin@uptour.in` / `admin123` — **change this immediately.**

---

## Full stack with Docker

```bash
cp .env.example .env       # all values marked `:?` are required
docker compose up --build -d
docker compose logs -f backend
```

`openwa` in this repo is a symlink. Docker cannot use a symlinked build context,
so set `OPENWA_CONTEXT` in `.env` to the real checkout path (default `../OpenWA`).

---

## OpenWA setup (WhatsApp gateway)

OpenWA is a general-purpose gateway that ships white-labelled for another product,
so it needs wiring before UP Heritage Tours can use it.

```bash
cp .env.example .env                          # fill in the OPENWA_* values
docker compose up -d --no-deps openwa         # see the note on --no-deps below
./scripts/setup-openwa.sh                     # registers the webhook + verifies delivery
```

Then open http://localhost:2785, create a session, and scan the QR with the
WhatsApp account that will send the outreach.

**Use `--no-deps` when Postgres/Redis already run natively on your machine** —
otherwise compose starts its own `postgres` and collides on port 5432. Set
`OPENWA_DATABASE_TYPE=sqlite` (as `.env.example` does) to keep OpenWA
self-contained; drop `--no-deps` for the fully containerised stack.

### Two things that are easy to get wrong

**1. `OPENWA_SESSION_ID` must be the session's generated UUID, not its name.**
OpenWA looks sessions up by id only, so a friendly value like `default` returns
404 on every send. Read the real one and put it in `backend/.env`:

```bash
curl -s -H "X-API-Key: $OPENWA_API_KEY" http://localhost:2785/api/sessions
```

`setup-openwa.sh` prints a warning when `backend/.env` disagrees with reality.

**2. Webhooks are not configured by environment variables.** OpenWA reads no
`WEBHOOK_URL`/`WEBHOOK_SECRET`; a webhook is a row owned by a session, created
via `POST /api/sessions/:id/webhooks`. Until it is registered, replies and
delivery receipts never reach the backend and the CRM stays empty.
`setup-openwa.sh` registers it (idempotently) with the six events the backend
handles, attaches the HMAC secret, and fires a signed test delivery to confirm
the backend accepts the signature.

Because the backend is an internal address, OpenWA's SSRF guard blocks delivery
to it until the host is allowlisted. Compose sets
`SSRF_ALLOWED_HOSTS=backend,host.docker.internal`, which is far narrower than
turning the guard off.

### Optional: turn off the bundled AI auto-reply

OpenWA has its own `ai-reply` plugin with a knowledge base for a *different*
company. It ships **disabled**, and it should stay that way — UP Heritage Tours
generates replies itself via `AiService`. Two AI responders on one number would
answer prospects twice, with the wrong content. Verify with:

```bash
curl -s -H "X-API-Key: $OPENWA_API_KEY" http://localhost:2785/api/plugins \
  | python3 -c 'import json,sys; [print(p["id"], p["status"]) for p in json.load(sys.stdin)]'
```

`ai-reply` should read `installed` (loaded but inactive), never `enabled`.

---

## Data Collection (Google Maps scraping)

Collection uses the **Places API (New) Text Search** endpoint — real listings, not
generated data.

1. Create a Google Cloud project and enable **Places API (New)**.
2. Create an API key, restrict it to the Places API, and set a budget alert.
3. Put it in `backend/.env` as `GOOGLE_MAPS_API_KEY`, then restart the backend.
4. Check it is picked up: `GET /api/collection/status` → `{"configured": true}`.

A job turns country / city / category / keywords into a series of Text Search
queries, paginates each one 20 results at a time, and stops at `daily_limit` **new**
contacts. It persists a cursor (`search_offset` + `pagination_token`), so the next
run resumes where the last one stopped instead of re-scraping page 1.

Dedup happens on `google_place_id` (same listing) and `whatsapp_number` (same
number from a different listing). Listings without a valid phone number are stored
as `invalid` and skipped. Every raw result is retained for auditability.

**Cost control:** requests use a minimal field mask, are spaced 2s apart, and a
`429` pauses the job until the next day rather than burning quota.

---

## Verification

```bash
# Unit tests
cd backend && npm test

# Type checks
cd backend && npm run typecheck
cd frontend && npx tsc -b

# End-to-end API smoke test (needs the backend running)
./scripts/smoke-test.sh
```

The smoke test walks the real flow — login → company → contact → campaign →
template → assignment → collection job → CRM → dashboard → import — and prints a
PASS/FAIL line per step.

---

## The outreach pipeline

```
Collection / CSV import
        ↓
Campaign scheduler (cron, every 60s)
   · checks send window in the campaign's timezone
   · checks daily limit (Redis counter, keyed on local date)
        ↓
Send distributor  → spreads the daily quota across the window with jitter
        ↓
message-send queue → OpenWA → WhatsApp
        ↓
Webhook (HMAC-verified) ← delivery ACKs and replies
        ↓
ai-analysis queue → intent, interest, lead score
        ↓
Business rules → create lead · handover to human · honour opt-out
        ↓
Follow-up scheduler → Day 2 / Day 5, all stop conditions checked pre-send
```

---

## Project structure

```
UpTour/
├── backend/            NestJS API
│   ├── src/entities/   TypeORM entities
│   ├── src/modules/    Feature modules
│   │   ├── collection/ Google Maps scraping
│   │   └── engine/     Schedulers + queue processors
│   └── src/common/     Shared utils (phone, timezone, redis)
├── frontend/           React SPA
├── docs/               Architecture, flow, DB design, work breakdown
├── scripts/            smoke-test.sh, init-databases.sh
└── docker-compose.yml
```

---

## Security notes

- All `.env` files are gitignored; `.env.example` files hold placeholders only.
  Never commit real keys — rotate anything that has been committed.
- Every route is JWT-protected by default; `@Public()` opts a route out.
- Admin-only areas (users, data collection) are additionally role-guarded.
- Change the seeded admin password before exposing the app to a network.
