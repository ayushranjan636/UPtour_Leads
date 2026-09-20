#!/usr/bin/env bash
# End-to-end check of the campaign audience + send-preview flow.
#
# Proves the properties the UI depends on:
#   1. /contacts/count honours location filters and reachable_only
#   2. not_in_campaign_id excludes contacts already enrolled
#   3. by-filter enrolment is not capped at 100 (the old UI ceiling)
#   4. send-preview reports blockers when a campaign cannot usefully send
#   5. enrolling then adding a template clears the blockers
#
# Usage:
#   UPTOUR_PASSWORD=<admin password> ./scripts/verify-campaign-flow.sh
# Optionally set UPTOUR_EMAIL (defaults to admin@uptour.in).
# Creates a throwaway campaign and deletes it again on the way out.
set -uo pipefail

API="http://localhost:3000/api"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

read_env() {
  sed -n "s/^[[:space:]]*$1=//p" "$ROOT/backend/.env" 2>/dev/null | tail -n1 | tr -d '"'
}
PGPASSWORD="$(read_env DATABASE_PASSWORD)"; export PGPASSWORD
PSQL=(psql -h 127.0.0.1 -U "$(read_env DATABASE_USERNAME)" -d "$(read_env DATABASE_NAME)" -At)

TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${UPTOUR_EMAIL:-admin@uptour.in}\",\"password\":\"${UPTOUR_PASSWORD:?set UPTOUR_PASSWORD to your admin password}\"}" |
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("accessToken",""))')
[[ -z "$TOKEN" ]] && { echo "login failed"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN")
JSON=(-H 'Content-Type: application/json')

jqp() { python3 "$ROOT/scripts/jsonpath.py" "$@"; }

echo "=== 1. count: filter cascade ==="
for q in "" "country=India" "country=india" "state_region=Delhi" "city=New%20Delhi" "state_region=Tamil%20Nadu"; do
  printf "   %-28s " "${q:-(no filter)}"
  curl -s "${AUTH[@]}" "$API/contacts/count?$q" | jqp count
done

echo "=== 2. reachable_only ==="
printf "   all            "; curl -s "${AUTH[@]}" "$API/contacts/count" | jqp count
printf "   reachable only "; curl -s "${AUTH[@]}" "$API/contacts/count?reachable_only=true" | jqp count

echo "=== 3. create a campaign and enrol by filter ==="
CID=$(curl -s -X POST "$API/campaigns" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"name":"Audience Flow Test","product":"Heritage Tours","daily_send_limit":50}' | jqp id | sed 's/^id=//')
echo "   campaign=$CID"

printf "   matching Delhi (excl. this campaign): "
curl -s "${AUTH[@]}" "$API/contacts/count?state_region=Delhi&reachable_only=true&not_in_campaign_id=$CID" | jqp count

echo -n "   enrol by filter -> "
curl -s -X POST "$API/campaigns/$CID/contacts/by-filter" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"state_region":"Delhi"}' | jqp matched added skipped

printf "   not_in_campaign_id now excludes them: "
curl -s "${AUTH[@]}" "$API/contacts/count?state_region=Delhi&reachable_only=true&not_in_campaign_id=$CID" | jqp count

echo -n "   re-enrol same filter (must all skip) -> "
curl -s -X POST "$API/campaigns/$CID/contacts/by-filter" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"state_region":"Delhi"}' | jqp added skipped

echo "=== 4. send-preview BEFORE a template exists (expect a blocker) ==="
curl -s "${AUTH[@]}" "$API/campaigns/$CID/send-preview" \
  | jqp audience.sendable audience.unverified schedule.estimatedDays schedule.firstDayCount blockers

echo "=== 5. add a template, re-check ==="
# Body written to a file so the JSON keeps its double quotes regardless of shell quoting.
TEMPLATE_BODY=$(mktemp)
cat > "$TEMPLATE_BODY" <<JSONEOF
{
  "campaign_id": "$CID",
  "name": "Opener",
  "body": "Hello {{contact_name}} from {{company_name}} in {{city}}, {{state}}!",
  "sequence_order": 0,
  "type": "text"
}
JSONEOF
printf "   create template -> "
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$API/templates" "${AUTH[@]}" "${JSON[@]}" \
  --data-binary "@$TEMPLATE_BODY"
rm -f "$TEMPLATE_BODY"
curl -s "${AUTH[@]}" "$API/campaigns/$CID/send-preview" \
  | jqp blockers templates.name templates.0.body

echo "=== cleanup ==="
"${PSQL[@]}" -q -c "delete from campaign_contacts where campaign_id='$CID';
                    delete from message_templates where campaign_id='$CID';
                    delete from campaigns where id='$CID';"
echo "   removed test campaign"
