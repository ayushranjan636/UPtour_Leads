# UP HERITAGE TOURS — DATABASE DESIGN DOCUMENT

**Version:** 1.0  
**Date:** 2026-09-07  
**Status:** PENDING APPROVAL  
**Database:** PostgreSQL 16  
**ORM:** TypeORM  

---

## 1. Entity Relationship Diagram

```
users
  │
  ├──→ campaigns.created_by
  ├──→ campaign_contacts.assigned_to
  ├──→ leads.assigned_to
  ├──→ deals.assigned_to
  ├──→ import_files.imported_by
  └──→ audit_logs.user_id

companies
  │
  ├──→ contacts.company_id
  └──→ leads.company_id

contacts
  │
  ├──→ campaign_contacts.contact_id
  ├──→ messages.contact_id
  ├──→ ai_analyses.contact_id
  └──→ leads.contact_id

campaigns
  │
  ├──→ campaign_contacts.campaign_id
  ├──→ message_templates.campaign_id
  └──→ leads.campaign_id

campaign_contacts
  │
  ├──→ messages.campaign_contact_id
  ├──→ ai_analyses.campaign_contact_id
  ├──→ followup_jobs.campaign_contact_id
  └──→ leads.campaign_contact_id

messages ──→ ai_analyses.message_id

leads ──→ deals.lead_id

collection_jobs ──→ collection_results.job_id
```

---

## 2. Table Definitions

---

### 2.1 `users`

**Purpose:** Admin and salesperson accounts for the platform.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Login email |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt (12 rounds) |
| name | VARCHAR(255) | NOT NULL | Display name |
| role | VARCHAR(20) | NOT NULL, CHECK IN ('admin','salesperson') | Access level |
| is_active | BOOLEAN | DEFAULT true | Soft disable |
| last_login_at | TIMESTAMP | NULLABLE | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `UNIQUE(email)`

---

### 2.2 `companies`

**Purpose:** Travel agencies, tour operators, DMCs collected or imported.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| name | VARCHAR(255) | NOT NULL | Agency name |
| country | VARCHAR(100) | | |
| state_region | VARCHAR(100) | | State/province |
| city | VARCHAR(100) | | |
| address | TEXT | | Full address |
| website | VARCHAR(500) | | |
| agency_type | VARCHAR(100) | | 'travel_agency', 'tour_operator', 'dmc', 'specialist' |
| source | VARCHAR(100) | | 'csv_import', 'manual', 'google_maps', 'scraper' |
| source_url | VARCHAR(500) | | Original listing URL |
| google_place_id | VARCHAR(255) | | For dedup with Google Maps data |
| rating | DECIMAL(2,1) | | Google Maps rating |
| tags | TEXT[] | DEFAULT '{}' | PostgreSQL array for flexible tagging |
| notes | TEXT | | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(country, agency_type)` — filter by target market
- `INDEX(name, country)` — duplicate detection
- `UNIQUE(google_place_id) WHERE google_place_id IS NOT NULL` — prevent re-importing same business

---

### 2.3 `contacts`

**Purpose:** Individual contact persons at travel agencies. Primary outreach targets.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| company_id | UUID | FK → companies, NULLABLE | Individual contacts may not have a company |
| name | VARCHAR(255) | | Contact person name |
| designation | VARCHAR(200) | | Job title |
| phone | VARCHAR(50) | | Raw phone (may differ from WhatsApp) |
| whatsapp_number | VARCHAR(50) | UNIQUE, NOT NULL | E.164 format: +66812345678 |
| whatsapp_verified | BOOLEAN | DEFAULT false | Verified via OpenWA checkNumber |
| whatsapp_chat_id | VARCHAR(100) | | OpenWA JID (e.g., 66812345678@c.us) |
| email | VARCHAR(255) | | |
| source | VARCHAR(100) | | 'csv_import', 'manual', 'google_maps' |
| import_file_id | UUID | FK → import_files, NULLABLE | Which import brought this contact |
| is_opted_out | BOOLEAN | DEFAULT false | Permanent suppression |
| opted_out_at | TIMESTAMP | NULLABLE | When they opted out |
| is_suppressed | BOOLEAN | DEFAULT false | Temp suppression (bad number, etc.) |
| suppressed_reason | VARCHAR(255) | | 'not_on_whatsapp', 'number_invalid', etc. |
| tags | TEXT[] | DEFAULT '{}' | |
| notes | TEXT | | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `UNIQUE(whatsapp_number)` — PRIMARY dedup key
- `INDEX(company_id)`
- `INDEX(is_opted_out, is_suppressed)` — fast suppression checks
- `INDEX(whatsapp_chat_id)` — webhook message matching
- `INDEX(source)` — filter by origin

**Dedup strategy:** `whatsapp_number` is the single source of truth. Same phone = same contact, always.

---

### 2.4 `campaigns`

**Purpose:** Outreach campaigns targeting specific markets/products.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| name | VARCHAR(255) | NOT NULL | e.g., "Thailand Buddhist Travel Agents Q4" |
| description | TEXT | | |
| product | VARCHAR(255) | | 'Buddhist Pilgrimage', 'UP Tourism', etc. |
| target_country | VARCHAR(100) | | Primary target market |
| target_region | VARCHAR(100) | | |
| target_agency_type | VARCHAR(100) | | |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'draft' | draft/active/paused/completed/cancelled |
| daily_send_limit | INTEGER | DEFAULT 100 | Max messages per day |
| send_window_start | TIME | DEFAULT '09:00' | |
| send_window_end | TIME | DEFAULT '18:00' | |
| send_window_timezone | VARCHAR(50) | DEFAULT 'Asia/Kolkata' | Target timezone |
| openwa_session_id | VARCHAR(100) | | Which WhatsApp session |
| max_followups | INTEGER | DEFAULT 2 | Max follow-up messages |
| stats_sent | INTEGER | DEFAULT 0 | Denormalized counter |
| stats_delivered | INTEGER | DEFAULT 0 | |
| stats_read | INTEGER | DEFAULT 0 | |
| stats_replied | INTEGER | DEFAULT 0 | |
| stats_opted_out | INTEGER | DEFAULT 0 | |
| stats_leads | INTEGER | DEFAULT 0 | |
| created_by | UUID | FK → users | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(status)` — scheduler queries active campaigns
- `INDEX(openwa_session_id)`

---

### 2.5 `campaign_contacts`

**Purpose:** Junction table linking contacts to campaigns with per-contact state.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| campaign_id | UUID | FK → campaigns, NOT NULL | |
| contact_id | UUID | FK → contacts, NOT NULL | |
| status | VARCHAR(30) | DEFAULT 'pending' | pending/sent/delivered/read/replied/opted_out/failed/human_takeover/unresponsive |
| mode | VARCHAR(10) | DEFAULT 'ai' | 'ai' or 'human' |
| assigned_to | UUID | FK → users, NULLABLE | Salesperson |
| current_sequence_step | INTEGER | DEFAULT 0 | Which template step we're on |
| first_sent_at | TIMESTAMP | NULLABLE | |
| last_sent_at | TIMESTAMP | NULLABLE | |
| last_reply_at | TIMESTAMP | NULLABLE | |
| next_followup_at | TIMESTAMP | NULLABLE | |
| followup_count | INTEGER | DEFAULT 0 | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `UNIQUE(campaign_id, contact_id)` — no duplicate enrollment
- `INDEX(campaign_id, status)` — campaign stats / scheduler picks pending
- `INDEX(next_followup_at)` — follow-up scheduler query
- `INDEX(assigned_to)` — salesperson's assigned contacts
- `INDEX(contact_id)` — find all campaigns for a contact

---

### 2.6 `message_templates`

**Purpose:** Reusable message templates with variable substitution for campaign sequences.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| campaign_id | UUID | FK → campaigns, NULLABLE | NULL = shared/global template |
| name | VARCHAR(255) | NOT NULL | |
| type | VARCHAR(20) | DEFAULT 'text' | text/image/document/video |
| body | TEXT | NOT NULL | Supports `{{company_name}}`, `{{contact_name}}` |
| media_url | VARCHAR(500) | NULLABLE | For media templates |
| media_filename | VARCHAR(255) | NULLABLE | |
| sequence_order | INTEGER | DEFAULT 0 | Position in campaign sequence |
| trigger_condition | VARCHAR(50) | DEFAULT 'initial' | 'initial', 'positive_reply', 'followup_day_2', 'followup_day_5' |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(campaign_id, sequence_order)`

**Template variables available:**
- `{{contact_name}}` → contact.name
- `{{company_name}}` → company.name
- `{{country}}` → company.country
- `{{product}}` → campaign.product

---

### 2.7 `messages`

**Purpose:** Every WhatsApp message sent or received, linked to contacts and campaigns.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| campaign_contact_id | UUID | FK → campaign_contacts, NULLABLE | NULL for manual/non-campaign messages |
| contact_id | UUID | FK → contacts, NOT NULL | |
| direction | VARCHAR(10) | NOT NULL | 'outgoing' or 'incoming' |
| type | VARCHAR(20) | DEFAULT 'text' | text/image/document/video/audio |
| body | TEXT | | Message content |
| media_url | VARCHAR(500) | | |
| openwa_message_id | VARCHAR(100) | | OpenWA's msg ID for ACK tracking |
| openwa_session_id | VARCHAR(100) | | |
| status | VARCHAR(20) | DEFAULT 'queued' | queued/sent/delivered/read/failed |
| failed_reason | VARCHAR(500) | | |
| template_id | UUID | FK → message_templates, NULLABLE | Which template was used |
| sent_at | TIMESTAMP | NULLABLE | |
| delivered_at | TIMESTAMP | NULLABLE | |
| read_at | TIMESTAMP | NULLABLE | |
| created_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(contact_id, created_at)` — conversation view (chronological)
- `INDEX(openwa_message_id)` — webhook status update lookup (critical)
- `INDEX(campaign_contact_id)` — messages in a campaign context
- `INDEX(status)` — analytics queries

---

### 2.8 `ai_analyses`

**Purpose:** Structured AI analysis of every incoming message.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| message_id | UUID | FK → messages, NOT NULL | |
| contact_id | UUID | FK → contacts | |
| campaign_contact_id | UUID | FK → campaign_contacts, NULLABLE | |
| intent | VARCHAR(50) | | interested/not_interested/question/opt_out/greeting/request_info/out_of_office/unclear |
| interest_level | VARCHAR(20) | NULLABLE | high/medium/low/none |
| product_interest | VARCHAR(255) | NULLABLE | Only if explicitly mentioned |
| destination_interest | TEXT[] | NULLABLE | Only if explicitly mentioned |
| travel_period | VARCHAR(100) | NULLABLE | Only if explicitly mentioned |
| traveller_count | VARCHAR(50) | NULLABLE | Only if explicitly mentioned |
| requirements | TEXT | NULLABLE | Summarized from message |
| questions | TEXT[] | NULLABLE | Questions the contact asked |
| needs_human | BOOLEAN | DEFAULT false | |
| opt_out | BOOLEAN | DEFAULT false | |
| confidence | DECIMAL(3,2) | | 0.00–1.00 |
| lead_score | INTEGER | | 0–100 |
| reasoning | TEXT | | AI's brief explanation |
| raw_llm_response | JSONB | | Full LLM response for debugging |
| model_used | VARCHAR(100) | | e.g., 'gpt-4o-mini' |
| processing_time_ms | INTEGER | | |
| created_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(message_id)` — find analysis for a message
- `INDEX(contact_id)` — all analyses for a contact
- `INDEX(intent, interest_level)` — analytics

**Critical rule:** Fields like `travel_period`, `traveller_count`, `destination_interest` are NULLABLE. AI must return NULL if not explicitly mentioned in the message.

---

### 2.9 `leads`

**Purpose:** Qualified prospects in the sales pipeline.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| contact_id | UUID | FK → contacts, NOT NULL | |
| company_id | UUID | FK → companies, NULLABLE | |
| campaign_id | UUID | FK → campaigns, NULLABLE | |
| campaign_contact_id | UUID | FK → campaign_contacts, NULLABLE | |
| status | VARCHAR(30) | DEFAULT 'new' | See pipeline below |
| assigned_to | UUID | FK → users, NULLABLE | Salesperson |
| source | VARCHAR(100) | | 'whatsapp_campaign', 'manual' |
| product_interest | VARCHAR(255) | | |
| destinations | TEXT[] | | |
| travel_period | VARCHAR(100) | | |
| group_size | VARCHAR(50) | | |
| requirements | TEXT | | |
| notes | TEXT | | |
| lead_score | INTEGER | | 0–100 |
| next_followup_date | DATE | NULLABLE | |
| estimated_value | DECIMAL(12,2) | NULLABLE | |
| currency | VARCHAR(3) | DEFAULT 'INR' | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Lead status values:**
```
new → contacted → engaged → interested → qualified → 
human_handover → proposal_sent → negotiation → won | lost | not_interested | opted_out
```

**Indexes:**
- `INDEX(status, assigned_to)` — salesperson's pipeline view
- `INDEX(contact_id)` — leads for a contact
- `INDEX(campaign_id)` — leads from a campaign
- `INDEX(next_followup_date)` — due follow-ups

---

### 2.10 `deals`

**Purpose:** Business deals created from qualified leads.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| lead_id | UUID | FK → leads, NOT NULL | |
| name | VARCHAR(255) | | e.g., "ABC Travel - Buddhist Circuit Nov 2026" |
| product | VARCHAR(255) | | |
| estimated_value | DECIMAL(12,2) | | |
| currency | VARCHAR(3) | DEFAULT 'INR' | |
| stage | VARCHAR(30) | DEFAULT 'proposal' | proposal/negotiation/verbal_agreement/won/lost |
| assigned_to | UUID | FK → users, NULLABLE | |
| expected_close_date | DATE | NULLABLE | |
| notes | TEXT | | |
| won_at | TIMESTAMP | NULLABLE | |
| lost_at | TIMESTAMP | NULLABLE | |
| lost_reason | VARCHAR(500) | | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(stage, assigned_to)` — deal pipeline view
- `INDEX(lead_id)` — deal for a lead

---

### 2.11 `import_files`

**Purpose:** Track CSV/Excel file imports for audit and re-reference.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| filename | VARCHAR(255) | | Stored filename |
| original_filename | VARCHAR(255) | | User's original filename |
| file_size | INTEGER | | Bytes |
| mime_type | VARCHAR(100) | | |
| column_mapping | JSONB | NULLABLE | User-defined field mapping |
| total_rows | INTEGER | DEFAULT 0 | |
| valid_rows | INTEGER | DEFAULT 0 | |
| duplicate_rows | INTEGER | DEFAULT 0 | |
| error_rows | INTEGER | DEFAULT 0 | |
| status | VARCHAR(20) | DEFAULT 'uploaded' | uploaded/mapped/validating/importing/completed/failed |
| errors | JSONB | NULLABLE | Row-level error details |
| imported_by | UUID | FK → users | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| completed_at | TIMESTAMP | NULLABLE | |

**Indexes:**
- `INDEX(status)`
- `INDEX(imported_by)`

---

### 2.12 `followup_jobs`

**Purpose:** Scheduled follow-up messages with safety-check tracking.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| campaign_contact_id | UUID | FK → campaign_contacts, NOT NULL | |
| template_id | UUID | FK → message_templates, NULLABLE | |
| scheduled_at | TIMESTAMP | NOT NULL | When to send |
| status | VARCHAR(20) | DEFAULT 'scheduled' | scheduled/sent/cancelled/skipped |
| skip_reason | VARCHAR(255) | NULLABLE | 'contact_replied', 'opted_out', 'human_takeover', 'campaign_paused', 'lead_closed' |
| sent_at | TIMESTAMP | NULLABLE | |
| created_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(scheduled_at, status)` — the scheduler query: `WHERE status='scheduled' AND scheduled_at <= NOW()`
- `INDEX(campaign_contact_id)` — find follow-ups for a contact

---

### 2.13 `collection_jobs`

**Purpose:** Automated data collection job configurations.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| name | VARCHAR(255) | NOT NULL | e.g., "Thailand Bangkok Travel Agencies" |
| country | VARCHAR(100) | NOT NULL | Target country |
| city | VARCHAR(100) | NULLABLE | Specific city or NULL for all |
| category | VARCHAR(100) | NOT NULL | 'travel_agency', 'tour_operator', etc. |
| keywords | TEXT[] | DEFAULT '{}' | Additional search terms |
| data_source | VARCHAR(50) | DEFAULT 'google_maps' | google_maps / manual |
| daily_limit | INTEGER | DEFAULT 100 | Max contacts to collect per day |
| status | VARCHAR(20) | DEFAULT 'active' | active/paused/completed/failed |
| auto_add_to_campaign_id | UUID | FK → campaigns, NULLABLE | Auto-assign collected contacts |
| auto_verify_whatsapp | BOOLEAN | DEFAULT true | Check numbers on WhatsApp |
| last_run_at | TIMESTAMP | NULLABLE | |
| next_run_at | TIMESTAMP | NULLABLE | |
| total_collected | INTEGER | DEFAULT 0 | Running total |
| pagination_token | TEXT | NULLABLE | Google Maps next_page_token for resume |
| search_offset | INTEGER | DEFAULT 0 | Track position in search results |
| created_by | UUID | FK → users | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| updated_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(status, next_run_at)` — scheduler picks due active jobs
- `INDEX(auto_add_to_campaign_id)`

---

### 2.14 `collection_results`

**Purpose:** Raw results from each collection run for audit and dedup.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| job_id | UUID | FK → collection_jobs, NOT NULL | |
| run_date | DATE | NOT NULL | |
| raw_data | JSONB | NOT NULL | Full API response |
| business_name | VARCHAR(255) | | Parsed |
| phone | VARCHAR(50) | | Parsed, normalized |
| country | VARCHAR(100) | | |
| city | VARCHAR(100) | | |
| address | TEXT | | |
| website | VARCHAR(500) | | |
| google_place_id | VARCHAR(255) | | |
| status | VARCHAR(20) | DEFAULT 'collected' | collected/imported/duplicate/invalid/skipped |
| contact_id | UUID | FK → contacts, NULLABLE | If imported |
| company_id | UUID | FK → companies, NULLABLE | If imported |
| created_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(job_id, run_date)` — results per run
- `INDEX(google_place_id)` — dedup across runs
- `INDEX(status)` — filter imported vs skipped

---

### 2.15 `audit_logs`

**Purpose:** Track all significant system actions for compliance and debugging.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users, NULLABLE | NULL for system actions |
| action | VARCHAR(100) | NOT NULL | e.g., 'campaign.activated', 'contact.opted_out', 'lead.created' |
| entity_type | VARCHAR(50) | | 'campaign', 'contact', 'lead', 'deal', etc. |
| entity_id | UUID | NULLABLE | |
| details | JSONB | NULLABLE | Context-specific payload |
| ip_address | VARCHAR(45) | NULLABLE | |
| created_at | TIMESTAMP | DEFAULT NOW() | |

**Indexes:**
- `INDEX(entity_type, entity_id)` — history for any entity
- `INDEX(action)` — find specific event types
- `INDEX(created_at)` — chronological browsing, retention purge

**Retention:** Configurable auto-purge (default 12 months).

---

## 3. Key Queries

### Campaign scheduler (runs every 60s)
```sql
-- Find pending contacts for active campaigns
SELECT cc.* FROM campaign_contacts cc
JOIN contacts c ON c.id = cc.contact_id
JOIN campaigns camp ON camp.id = cc.campaign_id
WHERE camp.status = 'active'
  AND cc.status = 'pending'
  AND c.is_opted_out = false
  AND c.is_suppressed = false
ORDER BY cc.created_at ASC
LIMIT 50;
```

### Follow-up scheduler (runs every 5 min)
```sql
-- Find due follow-ups
SELECT fj.* FROM followup_jobs fj
WHERE fj.status = 'scheduled'
  AND fj.scheduled_at <= NOW()
ORDER BY fj.scheduled_at ASC
LIMIT 100;
```

### Webhook message matching
```sql
-- Match incoming message to contact
SELECT c.* FROM contacts c
WHERE c.whatsapp_chat_id = :senderJid
LIMIT 1;

-- Update message delivery status
UPDATE messages
SET status = :newStatus, delivered_at = NOW()
WHERE openwa_message_id = :openwaMessageId;
```

### Dashboard metrics
```sql
-- Campaign overview
SELECT
  stats_sent, stats_delivered, stats_read,
  stats_replied, stats_opted_out, stats_leads,
  CASE WHEN stats_sent > 0 
    THEN ROUND(stats_replied::numeric / stats_sent * 100, 1) 
    ELSE 0 END AS response_rate
FROM campaigns WHERE id = :campaignId;
```

---

## 4. Migration Order

```
Migration 1:  users
Migration 2:  companies
Migration 3:  import_files
Migration 4:  contacts (depends on companies, import_files)
Migration 5:  campaigns (depends on users)
Migration 6:  message_templates (depends on campaigns)
Migration 7:  campaign_contacts (depends on campaigns, contacts, users)
Migration 8:  messages (depends on contacts, campaign_contacts, message_templates)
Migration 9:  ai_analyses (depends on messages, contacts, campaign_contacts)
Migration 10: leads (depends on contacts, companies, campaigns, campaign_contacts, users)
Migration 11: deals (depends on leads, users)
Migration 12: followup_jobs (depends on campaign_contacts, message_templates)
Migration 13: collection_jobs (depends on campaigns, users)
Migration 14: collection_results (depends on collection_jobs, contacts, companies)
Migration 15: audit_logs (depends on users)
```
