#!/usr/bin/env bash
#
# End-to-end smoke test for the UP Heritage Tours API.
#
# Walks the real product flow against a running backend:
#   login → company → contact → campaign → template → assign → collection job
#   → dashboard → conversation → search → workflow
#
# Prints one PASS/FAIL line per step and exits non-zero if any step fails.
# Deliberately prints only HTTP status codes and non-sensitive ids — never tokens.
#
# Usage: ./scripts/smoke-test.sh [BASE_URL]

set -uo pipefail

BASE="${1:-http://localhost:3000/api}"
EMAIL="${SMOKE_EMAIL:-admin@uptour.in}"
PASSWORD="${SMOKE_PASSWORD:-admin123}"

PASS=0
FAIL=0
TOKEN=""

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

# check <label> <expected-code> <actual-code>
check() {
  if [[ "$2" == "$3" ]]; then
    green "  PASS  $1 ($3)"
    PASS=$((PASS + 1))
  else
    red   "  FAIL  $1 (expected $2, got $3)"
    FAIL=$((FAIL + 1))
  fi
}

# api <METHOD> <PATH> [JSON_BODY]
# Sets globals: BODY (response body), CODE (http status).
# Writes to globals rather than echoing, because command substitution runs in a
# subshell and any variable assigned there would be lost.
BODY=""
CODE=""
api() {
  local method="$1" path="$2" body="${3:-}" out
  if [[ -n "$body" ]]; then
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$BASE$path" \
      -H 'Content-Type: application/json' \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
      -d "$body" 2>/dev/null)
  else
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$BASE$path" \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"} 2>/dev/null)
  fi
  BODY=$(printf '%s' "$out" | sed '$d')
  CODE=$(printf '%s' "$out" | tail -n1)
}

# Extract a top-level JSON string field without needing jq.
jget() {
  printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

echo
echo "UP Heritage Tours — End-to-End Smoke Test"
echo "Target: $BASE"
echo "────────────────────────────────────────────────────"

# ── 1. Infrastructure ───────────────────────────────────
echo "1. Infrastructure"
api GET /health
check "GET /health" 200 "$CODE"
dim   "        $(printf '%s' "$BODY" | head -c 160)"

api GET /contacts
check "GET /contacts rejects anonymous access" 401 "$CODE"

# ── 2. Auth ─────────────────────────────────────────────
echo "2. Authentication"
api POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
check "POST /auth/login" 200 "$CODE"
TOKEN=$(jget "$BODY" accessToken)
REFRESH=$(jget "$BODY" refreshToken)
if [[ -n "$TOKEN" ]]; then
  green "  PASS  received accessToken"; PASS=$((PASS + 1))
else
  red   "  FAIL  no accessToken in login response"; FAIL=$((FAIL + 1))
  echo; red "Cannot continue without a token."; exit 1
fi

api POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}"
check "POST /auth/refresh" 200 "$CODE"

api POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}"
check "POST /auth/login rejects a bad password" 401 "$CODE"

# ── 3. Companies & contacts ─────────────────────────────
echo "3. Companies & Contacts"
STAMP=$(date +%s)
api POST /companies "{\"name\":\"Smoke Test Agency $STAMP\",\"country\":\"Thailand\",\"city\":\"Bangkok\",\"agency_type\":\"travel_agency\"}"
check "POST /companies" 201 "$CODE"
COMPANY_ID=$(jget "$BODY" id)

# Deterministic unique number in a reserved test range.
PHONE="+6699${STAMP: -7}"
api POST /contacts "{\"company_id\":\"$COMPANY_ID\",\"name\":\"Smoke Contact\",\"whatsapp_number\":\"$PHONE\"}"
check "POST /contacts" 201 "$CODE"
CONTACT_ID=$(jget "$BODY" id)

api GET "/contacts?page=1&limit=5"
check "GET /contacts (paginated)" 200 "$CODE"

api GET "/contacts/$CONTACT_ID"
check "GET /contacts/:id" 200 "$CODE"

# forbidNonWhitelisted must reject unknown fields.
api POST /contacts "{\"name\":\"Bad\",\"whatsapp_number\":\"+6600000000\",\"totally_unknown_field\":1}"
check "POST /contacts rejects unknown fields" 400 "$CODE"

# ── 4. Campaigns & templates ────────────────────────────
echo "4. Campaigns & Templates"
# "India" is not a valid IANA zone — it must be normalised, not crash.
api POST /campaigns "{\"name\":\"Smoke Campaign $STAMP\",\"product\":\"Buddhist Circuit\",\"daily_send_limit\":10,\"send_window_start\":\"09:00\",\"send_window_end\":\"18:00\",\"send_window_timezone\":\"India\"}"
check "POST /campaigns (friendly timezone accepted)" 201 "$CODE"
CAMPAIGN_ID=$(jget "$BODY" id)
TZ_STORED=$(jget "$BODY" send_window_timezone)
if [[ "$TZ_STORED" == "Asia/Kolkata" ]]; then
  green "  PASS  timezone \"India\" normalised to Asia/Kolkata"; PASS=$((PASS + 1))
else
  red   "  FAIL  timezone stored as \"$TZ_STORED\", expected Asia/Kolkata"; FAIL=$((FAIL + 1))
fi

api POST /templates "{\"campaign_id\":\"$CAMPAIGN_ID\",\"name\":\"Opener\",\"sequence_order\":1,\"body\":\"Hello {{company.name}}, greetings from UP Heritage Tours!\"}"
check "POST /templates" 201 "$CODE"

api POST /templates/preview "{\"body\":\"Hello {{company.name}}\",\"sample_company\":{\"name\":\"Smoke Agency\"}}"
check "POST /templates/preview" 201 "$CODE"

api POST "/campaigns/$CAMPAIGN_ID/contacts" "{\"contactIds\":[\"$CONTACT_ID\"]}"
check "POST /campaigns/:id/contacts" 200 "$CODE"

api GET "/campaigns/$CAMPAIGN_ID/stats"
check "GET /campaigns/:id/stats" 200 "$CODE"

api GET "/engine/distribution-plan?daily_limit=10&window_start=09:00&window_end=18:00"
check "GET /engine/distribution-plan (hypothetical limit)" 200 "$CODE"
dim   "        $(printf '%s' "$BODY" | head -c 200)"

# The campaign-aware form is the one the UI uses: the pending recipient count is
# resolved server-side so the plan is bounded by contacts that can really be sent to.
api GET "/engine/distribution-plan?campaign_id=$CAMPAIGN_ID"
check "GET /engine/distribution-plan (campaign)" 200 "$CODE"
dim   "        $(printf '%s' "$BODY" | head -c 200)"

# ── 5. Data collection (scraping) ───────────────────────
echo "5. Data Collection (Google Maps scraping)"
api GET /collection/status
check "GET /collection/status" 200 "$CODE"
CONFIGURED=$(printf '%s' "$BODY" | grep -o '"configured":[a-z]*' | cut -d: -f2)
dim   "        Google Maps configured: ${CONFIGURED:-unknown}"

api POST /collection "{\"name\":\"Smoke Collection $STAMP\",\"country\":\"Thailand\",\"city\":\"Bangkok\",\"category\":\"travel agency\",\"keywords\":\"tour operator, DMC\",\"daily_limit\":20}"
check "POST /collection (comma-separated keywords accepted)" 201 "$CODE"
JOB_ID=$(jget "$BODY" id)

api GET /collection
check "GET /collection" 200 "$CODE"

api GET "/collection/$JOB_ID/results?page=1&limit=10"
check "GET /collection/:id/results" 200 "$CODE"

api PATCH "/collection/$JOB_ID/pause"
check "PATCH /collection/:id/pause" 200 "$CODE"
api PATCH "/collection/$JOB_ID/resume"
check "PATCH /collection/:id/resume" 200 "$CODE"

if [[ "$CONFIGURED" == "true" ]]; then
  api POST "/collection/$JOB_ID/run-now"
  check "POST /collection/:id/run-now (live scrape)" 201 "$CODE"
  dim   "        $(printf '%s' "$BODY" | head -c 300)"
else
  api POST "/collection/$JOB_ID/run-now"
  check "POST /collection/:id/run-now returns a clear 400 without an API key" 400 "$CODE"
  dim   "        Set GOOGLE_MAPS_API_KEY in backend/.env to enable live scraping."
fi

# ── 6. CRM ──────────────────────────────────────────────
echo "6. CRM (leads, deals, conversations)"
api POST /leads "{\"contact_id\":\"$CONTACT_ID\",\"campaign_id\":\"$CAMPAIGN_ID\",\"company_id\":\"$COMPANY_ID\",\"lead_score\":80,\"notes\":\"Smoke test lead\"}"
check "POST /leads" 201 "$CODE"
LEAD_ID=$(jget "$BODY" id)

api GET "/leads?page=1&limit=10"
check "GET /leads" 200 "$CODE"

api POST /deals "{\"lead_id\":\"$LEAD_ID\",\"name\":\"Smoke Deal\",\"estimated_value\":50000,\"currency\":\"INR\"}"
check "POST /deals" 201 "$CODE"

api GET "/deals?page=1&limit=10"
check "GET /deals" 200 "$CODE"

api GET "/messages/conversation/$CONTACT_ID"
check "GET /messages/conversation/:contactId" 200 "$CODE"

# ── 7. Dashboard & observability ────────────────────────
echo "7. Dashboard & Observability"
for path in /dashboard/overview /dashboard/campaigns /dashboard/pipeline /dashboard/funnel; do
  api GET "$path"
  check "GET $path" 200 "$CODE"
done

api GET "/search?q=Smoke&type=all"
check "GET /search" 200 "$CODE"

api GET /notifications
check "GET /notifications" 200 "$CODE"

api GET "/workflow/contact/$CONTACT_ID"
check "GET /workflow/contact/:contactId" 200 "$CODE"

api GET "/workflow/campaign/$CAMPAIGN_ID/health"
check "GET /workflow/campaign/:id/health" 200 "$CODE"

api GET /whatsapp/health
# OpenWA is optional locally: 200 when up, 5xx/503 when not running.
if [[ "$CODE" == "200" || "$CODE" == "500" || "$CODE" == "502" || "$CODE" == "503" ]]; then
  green "  PASS  GET /whatsapp/health reachable ($CODE)"; PASS=$((PASS + 1))
  [[ "$CODE" != "200" ]] && dim "        OpenWA not running — expected unless you started it."
else
  red   "  FAIL  GET /whatsapp/health unexpected status ($CODE)"; FAIL=$((FAIL + 1))
fi

# ── 8. Import pipeline ──────────────────────────────────
echo "8. Import Pipeline"
api GET /imports
check "GET /imports" 200 "$CODE"

CSV=$(mktemp /tmp/uptour-smoke-XXXXXX.csv)
printf 'company_name,name,whatsapp_number,country\nCSV Agency %s,CSV Contact,+6688%s,Thailand\n' "$STAMP" "${STAMP: -7}" > "$CSV"
CODE=$(curl -sS -o /tmp/uptour-upload.json -w '%{http_code}' -X POST "$BASE/imports/upload" \
  -H "Authorization: Bearer $TOKEN" -F "file=@$CSV;type=text/csv" 2>/dev/null)
check "POST /imports/upload" 201 "$CODE"
IMPORT_ID=$(jget "$(cat /tmp/uptour-upload.json)" id)
if [[ -n "$IMPORT_ID" ]]; then
  api GET "/imports/$IMPORT_ID/preview"
  check "GET /imports/:id/preview" 200 "$CODE"
fi

# A generic binary content type must still be accepted based on the extension.
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/imports/upload" \
  -H "Authorization: Bearer $TOKEN" -F "file=@$CSV;type=application/octet-stream" 2>/dev/null)
check "POST /imports/upload accepts application/octet-stream .csv" 201 "$CODE"

# A disallowed extension must be a clean 400, not a 500.
BAD=$(mktemp /tmp/uptour-smoke-XXXXXX.txt)
echo "not a spreadsheet" > "$BAD"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/imports/upload" \
  -H "Authorization: Bearer $TOKEN" -F "file=@$BAD" 2>/dev/null)
check "POST /imports/upload rejects .txt with 400 (not 500)" 400 "$CODE"

rm -f "$CSV" "$BAD" /tmp/uptour-upload.json

# ── 9. Cleanup ──────────────────────────────────────────
echo "9. Cleanup"
# A campaign starts as `draft`; the state machine only allows draft → active,
# so activate before pausing.
api POST "/campaigns/$CAMPAIGN_ID/activate"
check "POST /campaigns/:id/activate" 200 "$CODE"
api POST "/campaigns/$CAMPAIGN_ID/pause"
check "POST /campaigns/:id/pause" 200 "$CODE"
api PATCH "/collection/$JOB_ID/pause"
check "PATCH /collection/:id/pause" 200 "$CODE"

echo "────────────────────────────────────────────────────"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo

if [[ "$FAIL" -gt 0 ]]; then
  red "SMOKE TEST FAILED"
  exit 1
fi
green "ALL CHECKS PASSED"
