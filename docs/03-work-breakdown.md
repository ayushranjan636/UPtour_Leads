# UP HERITAGE TOURS — WORK BREAKDOWN DOCUMENT

**Version:** 1.0  
**Date:** 2026-09-07  
**Status:** PENDING APPROVAL  

---

## Phase 1A — Core Outreach Loop (5 weeks)

---

### Sprint 0: Foundation (Days 1–4)

| # | Task | Depends On | Est. | Description |
|---|---|---|---|---|
| 1 | NestJS project init + TypeScript + ESLint + Prettier | — | 2h | Scaffold backend project |
| 2 | Docker Compose: postgres, redis, openwa, api, nginx | — | 4h | Full local dev environment |
| 3 | PostgreSQL connection + TypeORM setup | 1 | 2h | Database config, connection pooling |
| 4 | DB migrations: users, companies, contacts, import_files | 3 | 4h | Core entity tables |
| 5 | User auth module: JWT login, refresh, role guard | 3,4 | 6h | Admin + salesperson auth |
| 6 | OpenWA service wrapper: health, sessions, send message | 2 | 4h | Typed HTTP client for OpenWA |
| 7 | Webhook endpoint: HMAC validation + event routing | 6 | 4h | Receives all OpenWA events |
| 8 | BullMQ setup: Redis connection, queue definitions | 2 | 3h | Queue infrastructure |
| 9 | React frontend scaffold: Vite, routing, auth, API client | 5 | 4h | Login, layout, protected routes |

**Sprint 0 Total: ~33 hours**

---

### Sprint 1: Contacts & Import (Days 5–10)

| # | Task | Depends On | Est. | Description |
|---|---|---|---|---|
| 10 | Company CRUD API + UI | 4,9 | 6h | List, create, edit companies |
| 11 | Contact CRUD API + phone normalization | 4,9 | 8h | E.164 formatting with libphonenumber |
| 12 | CSV/Excel upload endpoint + file storage | 4 | 4h | Multer upload, file validation |
| 13 | Import preview: column detection + sample rows | 12 | 4h | Parse headers, show first 10 rows |
| 14 | Import field mapping UI | 13 | 4h | Drag-drop or dropdown column mapping |
| 15 | Import validation worker: normalize, dedup, errors | 11,13 | 8h | Background job with progress tracking |
| 16 | Import execution: batch insert + source tracking | 15 | 4h | Insert valid records, log source |
| 17 | Contact list UI with filters | 11 | 6h | Filter by country, type, status, campaign |

**Sprint 1 Total: ~44 hours**

---

### Sprint 2: Campaigns & Sending (Days 11–17)

| # | Task | Depends On | Est. | Description |
|---|---|---|---|---|
| 18 | DB migrations: campaigns, campaign_contacts, templates, messages | 3 | 3h | Campaign-related tables |
| 19 | Campaign CRUD API | 18 | 6h | Create, list, update, activate, pause |
| 20 | Message template CRUD with variable substitution | 18 | 4h | `{{company_name}}` variable rendering |
| 21 | Campaign contact assignment (add/filter/select) | 19,11 | 6h | Add contacts to campaigns |
| 22 | Campaign scheduler: pick contacts, respect limits/window | 19,8 | 8h | Cron: every 60s check active campaigns |
| 23 | Message send worker: call OpenWA, record, track status | 6,22 | 6h | BullMQ → OpenWA send-text/media |
| 24 | Webhook: message.ack → update message status | 7,18 | 4h | sent → delivered → read → failed |
| 25 | Webhook: message.received → store + match contact | 7,18 | 6h | Match sender to contact + campaign |
| 26 | Campaign UI: create, manage, activate, monitor | 19,9 | 8h | Full campaign management interface |

**Sprint 2 Total: ~51 hours**

---

### Sprint 3: AI & Leads (Days 18–23)

| # | Task | Depends On | Est. | Description |
|---|---|---|---|---|
| 27 | DB migrations: ai_analyses, leads, deals, followup_jobs, audit_logs | 3 | 3h | Remaining tables |
| 28 | AI service: LLM client, system prompt, JSON output parsing | — | 6h | OpenAI integration with structured output |
| 29 | AI analysis worker: message → LLM → store result | 25,28 | 6h | BullMQ job processes each incoming reply |
| 30 | Business rules engine: intent → actions | 29,27 | 8h | Auto-create leads, handover, opt-out |
| 31 | Lead CRUD API + auto-creation from AI | 27,30 | 6h | Lead management endpoints |
| 32 | Opt-out handler: suppress, cancel followups, stop sequence | 30,21 | 4h | Immediate enforcement |
| 33 | Follow-up scheduler: create jobs, check stop conditions | 22,27 | 6h | Schedule Day 2, Day 5 follow-ups |
| 34 | Follow-up worker: send due follow-ups with safety checks | 33,23 | 4h | All 6 stop conditions checked pre-send |

**Sprint 3 Total: ~43 hours**

---

### Sprint 4: CRM & Conversations (Days 24–29)

| # | Task | Depends On | Est. | Description |
|---|---|---|---|---|
| 35 | Conversation API: message history + AI annotations | 25,29 | 4h | Full chat for a contact |
| 36 | Conversation UI: chat view, AI sidebar, contact info | 35,9 | 10h | WhatsApp-style chat interface |
| 37 | Human handover: toggle mode, stop automation, assign | 30,21 | 6h | AI ↔ human mode switch |
| 38 | Manual message send via dashboard through OpenWA | 36,6 | 4h | Salesperson types → sent via OpenWA |
| 39 | Lead management UI: list, detail, status, assignment | 31,9 | 8h | Lead pipeline view |
| 40 | Deal CRUD API + UI: create from lead, track stage/value | 27,39 | 6h | Basic deal management |

**Sprint 4 Total: ~38 hours**

---

### Sprint 5: Dashboard, Data Collection & Polish (Days 30–35)

| # | Task | Depends On | Est. | Description |
|---|---|---|---|---|
| 41 | Dashboard API: aggregate metrics | 18,27 | 6h | Sent, delivered, read, replied, leads, deals |
| 42 | Dashboard UI: overview cards, campaign breakdown, funnel | 41,9 | 8h | Main analytics dashboard |
| 43 | OpenWA session UI: status, QR code, health indicator | 6,9 | 4h | Connect/disconnect WhatsApp |
| 44 | Data collection: Google Maps API integration | 8 | 8h | Search → parse → store contacts |
| 45 | Data collection UI: create jobs, set country/city/keyword | 44,9 | 6h | Collection job management |
| 46 | Data collection scheduler: daily auto-run, limits, dedup | 44,11 | 6h | 100/day cycle automation |
| 47 | Audit logging across all modules | 27 | 4h | Decorator/interceptor pattern |
| 48 | Error handling sweep + retry logic | All | 4h | Graceful degradation everywhere |
| 49 | End-to-end testing: full workflow | All | 8h | Import → campaign → send → reply → AI → lead |
| 50 | Production deployment: Docker build, env, TLS, backup | All | 6h | Deploy to VPS |

**Sprint 5 Total: ~60 hours**

---

## Phase 1A Summary

| Sprint | Duration | Hours |
|---|---|---|
| Sprint 0: Foundation | Days 1–4 | ~33h |
| Sprint 1: Contacts & Import | Days 5–10 | ~44h |
| Sprint 2: Campaigns & Sending | Days 11–17 | ~51h |
| Sprint 3: AI & Leads | Days 18–23 | ~43h |
| Sprint 4: CRM & Conversations | Days 24–29 | ~38h |
| Sprint 5: Dashboard + Data Collection + Polish | Days 30–35 | ~60h |
| **Total Phase 1A** | **~5 weeks** | **~269h** |

---

## Phase 1B — Enhanced (Weeks 6–8)

| # | Task | Est. | Description |
|---|---|---|---|
| 51 | Number verification: pre-check via OpenWA before sending | 6h | Reduce wasted messages |
| 52 | Media templates: PDF brochure + video in sequences | 8h | send-document / send-video via OpenWA |
| 53 | Message sequence builder: multi-step with conditions | 10h | Visual sequence editor |
| 54 | Advanced campaign analytics: per-campaign breakdown charts | 8h | Conversion funnel per campaign |
| 55 | Salesperson assignment: round-robin auto-assign | 4h | Load-balanced lead distribution |
| 56 | Contact search: full-text search across all fields | 6h | PostgreSQL full-text or ILIKE |
| 57 | Notification system: in-app alerts for salespeople | 6h | New lead, new reply, handover alerts |
| 58 | Performance testing: 10K contacts simulation | 8h | Load test all queues and queries |
| 59 | Bug fixes + polish | 8h | Based on real usage feedback |

**Phase 1B Total: ~64 hours (2–3 weeks)**

---

## Phase 2 — Growth (Weeks 9–14, after business validation)

| # | Feature | Est. | Description |
|---|---|---|---|
| 60 | Multi-WhatsApp account management | 16h | Campaign → session assignment |
| 61 | Advanced message branching (if/else flows) | 16h | Conditional sequences based on replies |
| 62 | Knowledge base for AI Q&A | 12h | Structured data → AI can answer FAQs |
| 63 | Advanced reporting + CSV export | 10h | Custom date ranges, exports |
| 64 | Additional data sources (web directories) | 16h | Beyond Google Maps |
| 65 | Email channel integration | 12h | Parallel email outreach |
| 66 | API for external integrations | 10h | Webhook out, REST API |

---

## Phase 3 — Scale (Future)

| Feature | Description |
|---|---|
| WhatsApp Business API migration | Official API for higher volume, lower ban risk |
| AI calling integration (DubCall) | Voice outreach to existing customers |
| Intent-based lead generation | Research feasibility |
| Multi-language support | Hindi, Thai, Japanese, etc. |
| Mobile-responsive dashboard | Salespeople on phones |

---

## Dependency Graph (Critical Path)

```
NestJS Init ──→ PostgreSQL ──→ Migrations ──→ User Auth ──→ React Scaffold
                                   │
Docker Compose ─→ OpenWA Wrapper ──┤
                                   │
                    ┌──────────────┤
                    ▼              ▼
              Contact CRUD    Campaign CRUD
                    │              │
                    ▼              ▼
              CSV Import    Campaign Scheduler
                    │              │
                    └──────┬───────┘
                           ▼
                    Message Send Worker
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         Webhook      AI Service   Follow-up
         Handler      + Worker     Scheduler
              │            │            │
              └────────────┼────────────┘
                           ▼
                    Lead Auto-Creation
                           │
                    ┌──────┼──────┐
                    ▼      ▼      ▼
                  CRM   Convo   Dashboard
                  UI     UI      UI
```
