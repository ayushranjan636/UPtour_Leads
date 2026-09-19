# UP HERITAGE TOURS — TECHNICAL ARCHITECTURE DOCUMENT

**Version:** 1.0  
**Date:** 2026-09-07  
**Status:** PENDING APPROVAL  

---

## 1. System Overview

UP Heritage Tours Outreach Platform is an internal B2B lead-generation system that:

1. **Collects** travel-agency contact data from public sources (Google Maps API, directories)
2. **Sends** professional WhatsApp outreach campaigns via OpenWA
3. **Understands** responses using AI (GPT-4o-mini)
4. **Qualifies** leads and routes them to human sales staff
5. **Tracks** deals through a lightweight CRM pipeline

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        BROWSER (React + Ant Design)                          │
│                                                                              │
│  Dashboard │ Data Collector │ Campaigns │ Contacts │ CRM │ Conversations    │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ HTTPS / JWT Auth
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       UP HERITAGE API  (NestJS + TypeScript)                 │
│                                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │   Data      │ │  Campaign   │ │    CRM     │ │    AI      │               │
│  │  Collector  │ │   Engine    │ │   Module   │ │  Service   │               │
│  └─────┬──────┘ └─────┬──────┘ └────────────┘ └─────┬──────┘               │
│        │               │                              │                      │
│  ┌─────┴───────────────┴──────────────────────────────┴──────┐              │
│  │                    BullMQ Workers (Redis)                   │              │
│  │                                                             │              │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │              │
│  │  │ data-collect  │  │ message-send │  │  ai-analysis │     │              │
│  │  │  (100/day)    │  │ (batch/24hr) │  │  (on reply)  │     │              │
│  │  └──────────────┘  └──────────────┘  └──────────────┘     │              │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │              │
│  │  │ follow-up    │  │ webhook-proc │  │ import-proc  │     │              │
│  │  │  (scheduled) │  │ (from OpenWA)│  │ (CSV/Excel)  │     │              │
│  │  └──────────────┘  └──────────────┘  └──────────────┘     │              │
│  └─────────────────────────────────────────────────────────────┘              │
│                                                                              │
│  ┌──────────┐  ┌──────────────┐                                             │
│  │  Redis   │  │  PostgreSQL  │                                              │
│  │ (Queues) │  │  (All Data)  │                                              │
│  └──────────┘  └──────────────┘                                             │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
              REST API calls ↓ │ ↑ Webhooks (HMAC signed)
                               │
┌──────────────────────────────┴───────────────────────────────────────────────┐
│                          OPENWA  (Separate Docker Container)                 │
│                                                                              │
│  WhatsApp Sessions │ Send/Receive │ Media │ Delivery Status │ Contacts      │
│                              │                                               │
│                         WhatsApp Web                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | React 18 + Vite + TypeScript + Ant Design | Fast CRM-style UI with built-in tables, forms, charts |
| **Backend** | NestJS 11 + TypeScript | Modular, same language as frontend, matches OpenWA |
| **Database** | PostgreSQL 16 | JSONB, array columns, full-text search, proven at scale |
| **Queue** | Redis 7 + BullMQ | Reliable job queue for sending, follow-ups, data collection |
| **AI** | OpenAI GPT-4o-mini | Best cost/quality for structured intent extraction (~$2/month) |
| **WhatsApp** | OpenWA (Docker) | Full-featured open-source WhatsApp API gateway |
| **ORM** | TypeORM | PostgreSQL support, migrations, matches OpenWA |
| **Phone Normalization** | google-libphonenumber | E.164 standard formatting |
| **File Parsing** | xlsx + csv-parse | CSV/Excel import |
| **Auth** | JWT + bcrypt | Standard token auth with role-based access |
| **Deployment** | Docker Compose + nginx | Single VPS, simple, affordable |
| **TLS** | Let's Encrypt | Free HTTPS |

---

## 4. Service Architecture

### 4.1 Separation of Concerns

```
┌────────────────────────────┐     ┌────────────────────────────┐
│     OUR APPLICATION        │     │         OPENWA             │
│                            │     │                            │
│  ✓ Contacts & Companies    │     │  ✓ WhatsApp connection     │
│  ✓ Data Collection logic   │     │  ✓ QR code / auth          │
│  ✓ Campaign orchestration  │     │  ✓ Send messages           │
│  ✓ Message templates       │     │  ✓ Receive messages        │
│  ✓ Sending schedule/limits │     │  ✓ Delivery status (ACK)   │
│  ✓ AI response analysis    │     │  ✓ Media transmission      │
│  ✓ Lead/Deal management    │     │  ✓ Number verification     │
│  ✓ Follow-up automation    │     │  ✓ Anti-ban (typing sim)   │
│  ✓ Human handover          │     │  ✓ Session management      │
│  ✓ User auth & RBAC        │     │  ✓ Webhook dispatch        │
│  ✓ Dashboard & analytics   │     │  ✓ Rate limiting (API)     │
│  ✓ Import/Export           │     │                            │
│  ✓ Opt-out enforcement     │     │                            │
│  ✓ Audit logging           │     │                            │
└─────────────┬──────────────┘     └──────────────┬─────────────┘
              │                                    │
              │  REST API (X-API-Key auth)          │
              │  ←─────────────────────────────→   │
              │  Webhooks (HMAC-SHA256 signed)      │
              └────────────────────────────────────┘
```

### 4.2 OpenWA Integration (Verified from Source Code)

**Outbound calls (Our App → OpenWA):**

| Action | OpenWA Endpoint | Verified |
|---|---|---|
| Send text | `POST /api/sessions/:id/messages/send-text` | ✅ |
| Send image | `POST /api/sessions/:id/messages/send-image` | ✅ |
| Send PDF/doc | `POST /api/sessions/:id/messages/send-document` | ✅ |
| Send video | `POST /api/sessions/:id/messages/send-video` | ✅ |
| Send bulk | `POST /api/sessions/:id/messages/send-bulk` (max 100, min 1s delay) | ✅ |
| Check number | `GET /api/sessions/:id/contacts/check/:number` | ✅ |
| List sessions | `GET /api/sessions` | ✅ |
| Session health | `GET /api/health/ready` | ✅ |

**Inbound events (OpenWA → Our App via Webhook):**

| Event | Payload | Verified |
|---|---|---|
| `message.received` | Incoming message with body, sender, media | ✅ |
| `message.sent` | Outgoing message confirmed | ✅ |
| `message.ack` | Status: `pending → sent → delivered → read → failed` | ✅ |
| `message.failed` | Send failure with reason | ✅ |
| `session.status` | Session connected/disconnected | ✅ |
| `session.disconnected` | WhatsApp session lost | ✅ |

### 4.3 Deployment Topology (MVP)

```
Single VPS (4-8 GB RAM, 2 vCPU)
│
├── docker-compose.yml
│   ├── nginx           (port 80/443 — reverse proxy + TLS)
│   ├── uptour-api      (port 3000 — internal)
│   ├── uptour-frontend (served via nginx)
│   ├── openwa          (port 2785 — internal)
│   ├── postgres        (port 5432 — internal only)
│   └── redis           (port 6379 — internal only)
│
├── volumes/
│   ├── postgres-data/
│   ├── redis-data/
│   ├── openwa-data/     (WhatsApp session data)
│   ├── uploads/         (CSV/Excel imports)
│   └── media/           (brochures, videos)
```

**Estimated cost: $15–30/month total** (VPS + LLM API)

---

## 5. Security Architecture

### 5.1 Authentication Layers

| Connection | Method | Details |
|---|---|---|
| User → Frontend | HTTPS | TLS via Let's Encrypt |
| Frontend → Backend | JWT | Access token (15min) + HttpOnly refresh cookie (7d) |
| Backend → OpenWA | API Key | `X-API-Key` header, operator role |
| OpenWA → Backend | HMAC-SHA256 | Webhook signature verification |
| Backend → LLM API | API Key | Environment variable, never exposed |
| Backend → PostgreSQL | Password | Docker internal network only |

### 5.2 Role-Based Access Control

| Resource | Admin | Salesperson |
|---|---|---|
| Dashboard (all metrics) | ✅ | Own assigned metrics only |
| User management | CRUD | Read self |
| Data collection jobs | CRUD | ❌ |
| Campaigns | CRUD | Read only |
| All contacts | CRUD | Read only |
| Imports | CRUD | ❌ |
| Leads | CRUD | Read/update assigned only |
| Deals | CRUD | Read/update assigned only |
| Conversations | All | Assigned contacts only |
| WhatsApp sessions | Manage | ❌ |
| Settings | ✅ | ❌ |

### 5.3 Data Protection

- All secrets in environment variables (never in code/frontend)
- Database not exposed to public network (Docker internal)
- CORS restricted to frontend domain
- Webhook signature validated before processing
- File uploads: type + size validated (CSV/Excel only, max 50MB)
- SQL injection prevented via TypeORM parameterized queries
- XSS prevented via React default escaping + CSP headers
- Login rate limiting: 5 attempts per 15 minutes
- API rate limiting: 100 requests per minute per user

---

## 6. Queue Architecture

### 6.1 BullMQ Queues

| Queue | Concurrency | Rate Limit | Retry | Purpose |
|---|---|---|---|---|
| `data-collect` | 1 | 1 per 5s | 2x, 60s backoff | Google Maps API calls |
| `message-send` | 1 | 1 per 3-5s | 2x, 30s backoff | Send via OpenWA |
| `webhook-process` | 5 | none | 3x, 5s backoff | Process OpenWA events |
| `ai-analysis` | 3 | none | 2x, 10s backoff | LLM calls |
| `follow-up` | 1 | 1 per 3-5s | 2x, 30s backoff | Scheduled follow-ups |
| `import-process` | 1 | none | none | CSV/Excel import |

### 6.2 Daily Collection + Send Cycle

```
┌──────────────────────────────────────────────────────────────────┐
│                    24-HOUR CYCLE (per campaign)                  │
│                                                                  │
│  00:00 ─── Data collection job starts                            │
│             ↓                                                    │
│  00:00-06:00 ─ Collect ~100 contacts (respecting API limits)     │
│             ↓                                                    │
│  06:00 ─── Validate & deduplicate collected contacts             │
│             ↓                                                    │
│  09:00 ─── Sending window opens (target timezone)                │
│             ↓                                                    │
│  09:00-18:00 ─ Send messages in batches                          │
│                 (100 contacts ÷ 9 hours ≈ 11/hour ≈ 1 per 5min)  │
│             ↓                                                    │
│  18:00 ─── Sending window closes                                 │
│             ↓                                                    │
│  18:00-23:59 ─ Process replies, AI analysis, follow-ups          │
│             ↓                                                    │
│  00:00 ─── Next cycle starts                                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Error Handling

| Scenario | System Behavior |
|---|---|
| OpenWA unavailable | Retry 2x → mark message FAILED → alert dashboard → campaign continues next contact |
| WhatsApp disconnected | Webhook triggers dashboard alert → campaign auto-pauses → admin reconnects |
| Message send failed | Log reason → mark FAILED → do NOT retry (avoid spam) → count in stats |
| Webhook duplicate | Idempotency: check openwa_message_id + event → skip if processed → return 200 |
| AI API unavailable | Retry 1x after 10s → flag message for human review → notify salesperson |
| AI invalid response | Retry 1x → store raw response → flag for human review |
| Invalid phone number | Blocked during import validation → reported in error list |
| Number not on WhatsApp | Mark `whatsapp_verified=false`, suppress contact, skip in campaigns |
| Database failure | Health check returns 503 → Docker restarts → BullMQ jobs resume from Redis |
| Google Maps API limit | Pause collection → retry next cycle → alert admin if quota exhausted |
| Import of large file | Background job in batches of 1000 → progress polling from UI |

---

## 8. Scalability Path

| Scale | Infrastructure | Changes Needed |
|---|---|---|
| **10K contacts** (MVP) | Single VPS, 4GB RAM | None — default setup handles this |
| **50K contacts** (6mo) | Single VPS, 8-16GB RAM | Add composite DB indexes, materialized stats views |
| **100K+ contacts** (12mo+) | Separate DB server, multiple VPS | Managed PostgreSQL, dedicated OpenWA server, 2-3 WhatsApp accounts |

### When to upgrade

| Trigger | Action |
|---|---|
| Message queue > 5K pending | Add second send worker |
| Dashboard loads > 3s | Add materialized stats views |
| AI queue latency > 30s | Increase concurrency to 5-10 |
| Single WhatsApp sending > 500/day | Add second WhatsApp account |
| VPS RAM sustained > 80% | Upgrade VPS or split services |
| Campaign needs > 3 countries simultaneously | Multiple WhatsApp sessions with campaign assignment |

---

## 9. Compliance & Legal Risks

### Technical Requirements (built into the system)

| Requirement | Implementation |
|---|---|
| Opt-out | Immediate suppression on any opt-out signal |
| Consent tracking | Store source, import file, collection method per contact |
| Data export | Admin can export all data for any contact |
| Data deletion | Admin can purge contact + all related records |
| Audit trail | All significant actions logged with user, IP, timestamp |
| Retention policy | Configurable auto-purge of old messages (default 12 months) |
| Data minimization | Only business-relevant fields collected |

### ⚠️ Requires Legal Review Before Launch

| Item | Risk | Action |
|---|---|---|
| Unofficial WhatsApp client | Account ban possible | Legal review on commercial use |
| GDPR (EU contacts) | Fines for non-compliance | Legal review if targeting EU agencies |
| India DPDP Act 2023 | New data protection law | Legal review for B2B exemptions |
| Per-country anti-spam laws | Varies by market | Legal review per target country |
| Google Maps data usage | ToS restrictions | Verify commercial use terms |
