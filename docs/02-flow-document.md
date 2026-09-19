# UP HERITAGE TOURS — FLOW DOCUMENT

**Version:** 1.0  
**Date:** 2026-09-07  
**Status:** PENDING APPROVAL  

---

## 1. Master Business Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DAILY AUTOMATED PIPELINE                            │
│                                                                             │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│   │  1. COLLECT  │───→│  2. VALIDATE │───→│  3. SEND     │                │
│   │  100 contacts │    │  Dedup+Verify │    │  In batches  │                │
│   │  (auto daily) │    │  (auto)       │    │  over 24hrs  │                │
│   └──────────────┘    └──────────────┘    └──────┬───────┘                  │
│                                                   │                         │
│                                                   ▼                         │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│   │  6. DEAL     │←───│  5. HUMAN    │←───│  4. AI       │                  │
│   │  Track+Close │    │  HANDOVER    │    │  UNDERSTAND  │                  │
│   │              │    │  Sales takes  │    │  + QUALIFY   │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                  │
│                                                                             │
│   Repeats every 24 hours with new contacts                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Collection Flow

### How Data Collection Works

**You MUST select search parameters. The system then collects automatically.**

```
ADMIN CONFIGURES COLLECTION JOB
│
├── Select COUNTRY         → e.g., "Thailand"
├── Select CITY (optional) → e.g., "Bangkok" (or "All cities")
├── Select CATEGORY        → e.g., "Travel Agency"
├── Select KEYWORDS        → e.g., "Buddhist tourism", "India tours"
├── Set DAILY LIMIT        → e.g., 100 contacts/day
├── Set DATA SOURCE        → e.g., "Google Maps API"
└── Activate Job
```

### Why Manual Selection is Required

| Reason | Explanation |
|---|---|
| **Targeting** | You need agencies in specific markets that send tourists to India |
| **Relevance** | "Travel agency Bangkok" yields relevant contacts; random scraping doesn't |
| **Legal compliance** | Each country/source has different rules |
| **API costs** | Google Maps charges per request — targeted searches save money |
| **Quality** | Curated searches produce contacts more likely to convert |

### Collection Process (Automatic After Configuration)

```
┌──────────────────────────────────────────────────────────────────┐
│                    DAILY COLLECTION CYCLE                         │
│                                                                  │
│  Step 1: Collection Job triggers (midnight or configured time)   │
│          ↓                                                       │
│  Step 2: Query data source                                       │
│          Google Maps API: "Travel Agency in Bangkok, Thailand"    │
│          ↓                                                       │
│  Step 3: Parse results                                           │
│          For each result extract:                                 │
│          • Business name                                         │
│          • Phone number                                          │
│          • Address                                               │
│          • Website                                               │
│          • Business type                                         │
│          • Rating/reviews                                        │
│          ↓                                                       │
│  Step 4: Normalize phone numbers                                 │
│          "+66 81-234-5678" → "+66812345678" (E.164)             │
│          ↓                                                       │
│  Step 5: Deduplicate                                             │
│          Check: Does this phone number already exist?            │
│          YES → Skip (or update if new info is richer)            │
│          NO  → Add to contact database                           │
│          ↓                                                       │
│  Step 6: Verify WhatsApp (optional, configurable)                │
│          Call OpenWA: GET /contacts/check/:number                │
│          EXISTS → Mark whatsapp_verified = true                  │
│          NOT EXISTS → Mark suppressed (don't waste messages)     │
│          ↓                                                       │
│  Step 7: Add verified contacts to campaign                       │
│          ↓                                                       │
│  Step 8: Ready for sending in next batch window                  │
│                                                                  │
│  Result: ~100 new verified contacts added per day                │
└──────────────────────────────────────────────────────────────────┘
```

### Multiple Collection Jobs (Parallel)

```
Job 1: Thailand → Bangkok → Travel Agencies     → 50/day
Job 2: Thailand → Chiang Mai → Tour Operators    → 30/day
Job 3: Sri Lanka → Colombo → Travel Agencies     → 20/day
                                                    ─────
                                          Total:   100/day

Each job runs independently.
Each job feeds into its own campaign OR a shared campaign.
```

### Data Sources

| Source | How It Works | Data Available | Cost |
|---|---|---|---|
| **Google Maps Places API** | Search by keyword + location | Name, phone, address, website, type, rating | ~$17 per 1000 searches |
| **CSV/Excel Upload** | Manual upload from purchased lists or manual research | Whatever columns the file has | Free (data cost separate) |
| **Manual Entry** | Admin types in contact info | Full control | Free (time cost) |
| **Future: Web directories** | Scrape public tourism directories | Varies | Development time |

### Google Maps Collection — Detailed

```
Admin sets up job:
  Country: Thailand
  City: Bangkok  
  Keyword: "travel agency"
  Additional: "Buddhist tourism" OR "India tours"
  Daily limit: 50

System executes:
  1. API call: Places API "travel agency near Bangkok, Thailand"
  2. Get 20 results per page
  3. For each result → Places Detail API for phone + website
  4. Paginate with next_page_token (up to 60 results per query)
  5. Try keyword variations: "tour operator Bangkok", "DMC Bangkok"
  6. Stop when daily limit (50) reached
  7. Store raw results + parsed contacts
  8. Resume from last position tomorrow

Rate limiting:
  - Google Places API: respect quota (max ~1000/day on basic plan)  
  - Space requests: 1 every 2-3 seconds
  - Track usage to avoid surprise billing
```

---

## 3. Campaign + Sending Flow

### Campaign Creation

```
Admin creates campaign:
│
├── Campaign Name: "Thailand Buddhist Travel Agents - Q4 2026"
├── Product: "Buddhist Pilgrimage India"
├── Target: Thailand
├── WhatsApp Session: session-1
│
├── Initial Message Template:
│   "Hello {{company_name}},
│    We are UP Heritage Tours from India, specialists in 
│    Buddhist pilgrimage circuits (Bodh Gaya, Varanasi, 
│    Kushinagar, Lumbini).
│    Would you be interested in receiving our B2B program 
│    for your clients interested in India?"
│
├── Follow-up (Day 2):
│   "Hi {{contact_name}}, just following up on our message 
│    about Buddhist pilgrimage programs. Would this be 
│    relevant for your agency?"
│
├── Follow-up (Day 5 — final):
│   "Hi, this is our last follow-up. If you'd ever like to 
│    explore Buddhist circuit programs for your clients, 
│    feel free to reach out anytime. Thank you!"
│
├── Daily Send Limit: 100
├── Send Window: 09:00-18:00 (Asia/Bangkok timezone)
├── Link to Collection Job: Thailand collection
│
└── Activate Campaign
```

### 24-Hour Send Cycle

```
┌─────────────────────────────────────────────────────────────────┐
│                     24-HOUR SEND CYCLE                           │
│                                                                 │
│  TIME        ACTION                                             │
│  ─────────── ──────────────────────────────────────────────     │
│  00:00       Data collection job runs                           │
│              → Collects ~100 new contacts                       │
│              → Validates, deduplicates, verifies WhatsApp       │
│              → Adds to campaign contact list (status: pending)  │
│                                                                 │
│  09:00       Send window opens (target timezone)                │
│              Campaign scheduler picks pending contacts:         │
│              → Checks daily limit not exceeded                  │
│              → Checks contact not opted out / suppressed        │
│              → Queues batch of messages                         │
│                                                                 │
│  09:00-18:00 Messages sent in controlled batches:               │
│              → ~11 messages per hour                             │
│              → 1 message every ~5 minutes                       │
│              → Random jitter ±30s (anti-ban)                    │
│              → Each message: render template → OpenWA send      │
│              → Track: queued → sent → delivered → read          │
│                                                                 │
│  All day     Process incoming replies:                          │
│              → Webhook receives message.received                │
│              → Match to contact + campaign                      │
│              → AI analyzes intent + interest                    │
│              → Create lead if qualified                         │
│              → Notify sales team if handover needed             │
│                                                                 │
│  18:00       Send window closes                                 │
│              No new outgoing campaign messages until tomorrow    │
│              Replies still processed 24/7                       │
│                                                                 │
│  00:00       NEXT CYCLE                                         │
│              New 100 contacts collected                          │
│              Yesterday's follow-ups scheduled for Day 2          │
│              Repeat                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Batch Sending Logic

```
100 contacts per day
÷ 9 hour send window (09:00-18:00)
= ~11 contacts per hour
= ~1 contact every 5.5 minutes

With jitter: 4-7 minutes between messages
This is SAFE — well below WhatsApp's detection thresholds
```

---

## 4. Message Sequence Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    PER-CONTACT MESSAGE SEQUENCE                  │
│                                                                 │
│  Day 0: INITIAL MESSAGE (text only)                             │
│         "Hello, we are UP Heritage Tours..."                    │
│         ↓                                                       │
│         Wait for reply                                          │
│         ↓                                                       │
│  ┌──────────────────────────────────────────────┐              │
│  │  DID CONTACT REPLY?                           │              │
│  │                                               │              │
│  │  YES (positive) ──→ Continue to engagement    │              │
│  │  YES (negative) ──→ Stop sequence             │              │
│  │  YES (opt-out)  ──→ Suppress immediately      │              │
│  │  YES (question) ──→ AI answers or human        │              │
│  │  NO             ──→ Follow-up Day 2            │              │
│  └──────────────────────────────────────────────┘              │
│         ↓ (no reply)                                            │
│  Day 2: FOLLOW-UP 1                                             │
│         "Just following up..."                                  │
│         ↓                                                       │
│         Wait for reply (same logic)                             │
│         ↓ (no reply)                                            │
│  Day 5: FOLLOW-UP 2 (FINAL)                                    │
│         "This is our last follow-up..."                         │
│         ↓                                                       │
│  Day 5+: Mark as UNRESPONSIVE                                   │
│          Stop all automated messages                            │
│          Contact stays in database for future campaigns          │
└─────────────────────────────────────────────────────────────────┘
```

### Positive Reply Path

```
Contact replies: "Yes, we handle Buddhist tours to India"
    ↓
AI Analysis:
    intent: interested
    interest_level: high
    product_interest: Buddhist pilgrimage
    confidence: 0.9
    ↓
System actions:
    1. Create LEAD (status: interested)
    2. Stop automated follow-ups
    3. Assign to salesperson
    4. Switch to HUMAN mode
    ↓
Salesperson sees notification:
    "New qualified lead: ABC Travel, Bangkok — interested in Buddhist tours"
    ↓
Salesperson sends manually:
    "Thank you for your interest! Let me share our B2B program..."
    → Sends PDF brochure
    → Sends video (if available)
    → Asks qualifying questions
    ↓
Qualify further:
    → Client volume?
    → Travel dates?
    → Group sizes?
    → Budget range?
    ↓
Create DEAL:
    Product: Buddhist Pilgrimage Circuit
    Estimated value: ₹5,00,000
    Expected close: December 2026
    ↓
Track through pipeline:
    PROPOSAL → NEGOTIATION → WON / LOST
```

---

## 5. AI Response Analysis Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI ANALYSIS PIPELINE                          │
│                                                                 │
│  Incoming WhatsApp message                                      │
│  "Yes, we have clients from Thailand interested in              │
│   Buddhist tours in India around November."                     │
│         ↓                                                       │
│  Build prompt:                                                  │
│  ┌────────────────────────────────────────────────────┐        │
│  │ SYSTEM: You are an assistant for UP Heritage Tours  │        │
│  │ analyzing WhatsApp messages from travel agencies.   │        │
│  │ Extract structured information. Never invent data.  │        │
│  │ If something is not mentioned, return null.         │        │
│  │ Company: UP Heritage Tours, Lucknow, India          │        │
│  │ Products: Buddhist Pilgrimage, UP Tourism, ...      │        │
│  │                                                     │        │
│  │ USER: [Conversation history + new message]          │        │
│  └────────────────────────────────────────────────────┘        │
│         ↓                                                       │
│  LLM returns structured JSON:                                   │
│  {                                                              │
│    "intent": "interested",                                      │
│    "interest_level": "high",                                    │
│    "product_interest": "Buddhist pilgrimage",                   │
│    "destination_interest": ["Bodh Gaya", "Varanasi"],          │
│    "travel_period": "November",                                 │
│    "traveller_count": null,     ← NOT MENTIONED, stays null    │
│    "budget": null,              ← NOT MENTIONED, stays null    │
│    "requirements": null,                                        │
│    "questions": null,                                           │
│    "needs_human": true,                                         │
│    "opt_out": false,                                            │
│    "confidence": 0.92,                                          │
│    "lead_score": 85,                                            │
│    "reasoning": "Explicit interest with travel period"          │
│  }                                                              │
│         ↓                                                       │
│  BUSINESS RULES ENGINE:                                         │
│                                                                 │
│  confidence >= 0.7 AND interest_level = "high"                  │
│  → CREATE LEAD (auto)                                           │
│  → ASSIGN to salesperson                                        │
│  → SWITCH to human mode                                         │
│  → NOTIFY salesperson                                           │
│                                                                 │
│  confidence >= 0.7 AND interest_level = "medium"                │
│  → CREATE LEAD (auto)                                           │
│  → Continue AI engagement (ask qualifying questions)            │
│                                                                 │
│  confidence >= 0.7 AND intent = "not_interested"                │
│  → Mark as NOT_INTERESTED                                       │
│  → Stop sequence                                                │
│                                                                 │
│  opt_out = true                                                 │
│  → IMMEDIATELY suppress contact                                 │
│  → Cancel all follow-ups                                        │
│  → Log opt-out event                                            │
│                                                                 │
│  confidence < 0.5                                               │
│  → DO NOT act automatically                                     │
│  → Flag for HUMAN REVIEW                                        │
│  → Salesperson decides                                          │
│                                                                 │
│  intent = "question" AND confidence >= 0.7                      │
│  → Check if AI can answer from knowledge base                   │
│  → If yes: AI responds + continue                               │
│  → If no: human handover                                        │
└─────────────────────────────────────────────────────────────────┘
```

### AI Safety Rules

```
RULE 1: NEVER invent information
    "I might be interested" 
    → interest_level: "low", travel_period: null, budget: null
    → AI does NOT guess dates, budget, or group size

RULE 2: ALWAYS detect opt-out
    "Please stop messaging" → opt_out: true (immediate)
    "Not interested, don't contact again" → opt_out: true
    "Remove me" → opt_out: true

RULE 3: LOW confidence = human review
    "..." (ambiguous emoji) → confidence: 0.3 → human reviews
    "ok" (unclear intent) → confidence: 0.4 → human reviews

RULE 4: NEVER send promotional content automatically
    AI analysis triggers human handover
    HUMAN decides when to send brochure/PDF/video
    System does NOT auto-send media to everyone
```

---

## 6. Human Handover Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    HUMAN HANDOVER                                │
│                                                                 │
│  TRIGGER (any of):                                              │
│  • AI detects high interest → needs_human: true                │
│  • AI confidence < 0.5 → can't understand reliably             │
│  • Contact asks complex question → beyond AI knowledge         │
│  • Manual: admin clicks "Assign to human"                      │
│         ↓                                                       │
│  HANDOVER ACTIONS:                                              │
│  1. Set campaign_contact.mode = 'human'                        │
│  2. Assign salesperson (round-robin or manual)                 │
│  3. Cancel all pending follow-up jobs                          │
│  4. Stop AI auto-responses                                      │
│  5. Notify salesperson                                          │
│         ↓                                                       │
│  SALESPERSON DASHBOARD:                                         │
│  ┌────────────────────────────────────────────────────┐        │
│  │  NEW HANDOVER: ABC Travel Agency, Bangkok           │        │
│  │                                                     │        │
│  │  Contact: Somchai K. | +66 81-234-5678              │        │
│  │  Company: ABC Travel Agency                         │        │
│  │  Campaign: Thailand Buddhist Travel Agents           │        │
│  │  AI Score: 85/100 | Interest: HIGH                  │        │
│  │                                                     │        │
│  │  AI Summary:                                        │        │
│  │  "Explicit interest in Buddhist pilgrimage circuits. │        │
│  │   Has clients traveling Nov 2026. Needs pricing     │        │
│  │   and itinerary details."                           │        │
│  │                                                     │        │
│  │  Conversation:                                      │        │
│  │  [Full WhatsApp message history]                    │        │
│  │                                                     │        │
│  │  Actions:                                           │        │
│  │  [Reply] [Send Brochure] [Send Video]               │        │
│  │  [Update Lead] [Create Deal]                        │        │
│  │  [Return to AI] [Mark Not Interested]               │        │
│  └────────────────────────────────────────────────────┘        │
│         ↓                                                       │
│  HUMAN MODE:                                                    │
│  • All messages from salesperson go through OpenWA              │
│  • Replies from contact visible in real-time                   │
│  • AI analysis still runs (for scoring) but does NOT respond   │
│  • Salesperson manually updates lead status                    │
│  • Salesperson can create deal when ready                      │
│         ↓                                                       │
│  OPTIONAL: Return to AI mode                                    │
│  • Salesperson clicks "Return to AI"                           │
│  • AI resumes automated responses                              │
│  • Follow-ups can restart                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Follow-Up Flow

```
FOLLOW-UP SCHEDULING:

Campaign created with follow-up rules:
  Step 1: Initial message (Day 0)
  Step 2: Follow-up 1 (Day 2) — if no reply
  Step 3: Follow-up 2 (Day 5) — if still no reply

After initial message sent to Contact X:
  → Create followup_job: scheduled_at = now + 2 days
  → Status: scheduled

Every 5 minutes, follow-up worker checks:
  SELECT * FROM followup_jobs 
  WHERE status = 'scheduled' 
  AND scheduled_at <= NOW()

For each due follow-up:
  ┌─────────────────────────────────────────────────┐
  │  PRE-SEND SAFETY CHECKS (ALL must pass):        │
  │                                                  │
  │  ✓ Contact has NOT replied                       │
  │  ✓ Contact has NOT opted out                     │
  │  ✓ Mode is still 'ai' (no human takeover)       │
  │  ✓ Lead is not closed (won/lost)                │
  │  ✓ Campaign is still active (not paused)        │
  │  ✓ Max follow-ups not exceeded                  │
  │                                                  │
  │  ANY check fails → skip with reason logged      │
  │  ALL checks pass → send follow-up message       │
  └─────────────────────────────────────────────────┘

After follow-up sent:
  → Schedule next follow-up (Day 5) if sequence continues
  → Or mark sequence complete if final follow-up
```

---

## 8. Opt-Out Flow

```
TRIGGERS:
  • Contact sends "stop", "unsubscribe", "don't message", "remove me"
  • AI detects opt_out: true (any confidence level)
  • Admin manually opts out a contact

IMMEDIATE ACTIONS:
  1. contact.is_opted_out = true
  2. contact.opted_out_at = NOW()
  3. Cancel ALL pending follow-up jobs for this contact
  4. Remove from ALL active campaign queues
  5. Mark campaign_contact.status = 'opted_out' (all campaigns)
  6. Log audit event: contact.opted_out
  7. Send confirmation: "You have been removed from our list. 
     We will not contact you again. Thank you."

PERMANENT:
  • Contact is NEVER automatically re-added to any campaign
  • Manual override by admin is possible but logged
  • Opt-out status visible everywhere in UI
```

---

## 9. CRM Pipeline Flow

```
LEAD PIPELINE:

  NEW ──────────→ Automatically created from AI analysis
    ↓
  CONTACTED ────→ Initial message sent
    ↓
  ENGAGED ──────→ Contact replied (any response)
    ↓
  INTERESTED ───→ AI detected positive interest
    ↓
  QUALIFIED ────→ Salesperson confirmed interest + requirements
    ↓
  HUMAN_HANDOVER → Assigned to salesperson
    ↓
  PROPOSAL_SENT → Brochure/pricing sent
    ↓
  NEGOTIATION ──→ Active discussion on terms
    ↓
  ┌─────┴─────┐
  WON        LOST
  (Deal!)    (Document reason)
  
  
SIDE EXITS (from any stage):
  → NOT_INTERESTED (contact explicitly declines)
  → OPTED_OUT (contact requests no more messages)


DEAL STAGES (after lead is qualified):

  PROPOSAL ──→ NEGOTIATION ──→ VERBAL_AGREEMENT ──→ WON
                                                      ↓
                                                    LOST
```

---

## 10. Import Flow (CSV/Excel)

```
Step 1: UPLOAD
  Admin uploads file (CSV or Excel, max 50MB)
  → File stored in uploads/ directory
  → System detects file type and encoding

Step 2: PREVIEW
  System shows:
  ┌──────────────────────────────────────────────────────┐
  │  Detected Columns:                                    │
  │  A: "Agency Name"    B: "Contact Person"              │
  │  C: "Phone"          D: "Country"                     │
  │  E: "Email"          F: "Website"                     │
  │                                                       │
  │  Sample Rows (first 5):                               │
  │  ABC Travel | Somchai | +66812345678 | Thailand | ... │
  │  XYZ Tours  | Wanida  | +66898765432 | Thailand | ... │
  └──────────────────────────────────────────────────────┘

Step 3: MAP COLUMNS
  Admin maps each column to a system field:
    "Agency Name"     → company.name
    "Contact Person"  → contact.name
    "Phone"           → contact.whatsapp_number
    "Country"         → company.country
    "Email"           → contact.email
    "Website"         → company.website
  
  Admin sets:
    Default country code: +66 (if phones don't have country code)

Step 4: VALIDATE (background job)
  For each row:
    1. Normalize phone → E.164 format
    2. Check required fields (phone is mandatory)
    3. Check duplicate (phone number exists in DB?)
    4. Check company duplicate (name + country match?)
  
  Result:
  ┌──────────────────────────────────────────────────────┐
  │  Validation Report:                                   │
  │  Total rows:     500                                  │
  │  Valid:          423  ✅                               │
  │  Duplicates:      52  ⚠️ (same phone already exists)  │
  │  Invalid phone:   18  ❌                               │
  │  Missing phone:    7  ❌                               │
  │                                                       │
  │  [View Errors]  [Import 423 Valid Records]            │
  └──────────────────────────────────────────────────────┘

Step 5: IMPORT
  Admin confirms → background job inserts 423 records
  → Creates companies (or links to existing)
  → Creates contacts with source = 'csv_import'
  → Records import_file_id on each contact
  → Done notification
```
