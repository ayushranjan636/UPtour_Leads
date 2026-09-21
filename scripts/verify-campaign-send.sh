#!/usr/bin/env bash
# Proves a campaign sends automatically, end to end, with no manual push:
#   contact -> campaign -> template -> activate -> distributor cron -> queue -> WhatsApp
#
# Deliberately exercises the real scheduled path rather than calling the send API
# directly, because "does an activated campaign actually deliver" is the property
# that matters and the one that was broken.
#
# Usage: UPTOUR_PASSWORD=<admin password> ./scripts/verify-campaign-send.sh [phone]
set -uo pipefail

API="http://localhost:3000/api"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHONE="${1:-+919025867204}"
BODY_TEXT="Hey This is Ayush Ranjan this is a text message"

read_env() { sed -n "s/^[[:space:]]*$1=//p" "$ROOT/backend/.env" 2>/dev/null | tail -n1 | tr -d '"'; }
PGPASSWORD="$(read_env DATABASE_PASSWORD)"; export PGPASSWORD
PSQL=(psql -h 127.0.0.1 -U "$(read_env DATABASE_USERNAME)" -d "$(read_env DATABASE_NAME)" -At)
jqp() { python3 "$ROOT/scripts/jsonpath.py" "$@"; }

TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${UPTOUR_EMAIL:-admin@uptour.in}\",\"password\":\"${UPTOUR_PASSWORD:?set UPTOUR_PASSWORD}\"}" |
  jqp accessToken | sed 's/^accessToken=//')
[[ -z "$TOKEN" ]] && { echo "login failed"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN"); JSON=(-H 'Content-Type: application/json')

echo "=== 1. gateway + session must be ready ==="
KEY="$(read_env OPENWA_API_KEY)"
BASE="$(read_env OPENWA_BASE_URL)"
STATUS=$(curl -s -H "X-API-Key: $KEY" "$BASE/sessions" | jqp 0.status | sed 's/^status=//')
echo "   session status = $STATUS"
[[ "$STATUS" != "ready" ]] && { echo "   ABORT: WhatsApp is not connected — scan the QR first."; exit 1; }

echo "=== 2. contact ==="
CID=$(curl -s -X POST "$API/contacts" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"name\":\"Ayush Ranjan\",\"whatsapp_number\":\"$PHONE\"}" | jqp id | sed 's/^id=//')
# Already present from a previous run? Reuse it.
if [[ -z "$CID" || "$CID" == "None" ]]; then
  CID=$(curl -s "${AUTH[@]}" "$API/contacts?search=${PHONE#+}&limit=1" | jqp data.0.id | sed 's/^id=//')
fi
echo "   contact=$CID"

echo "=== 3. campaign with a send window that includes right now ==="
# The default 09:00-18:00 window would park the campaign until morning; this proves
# the scheduled path without waiting hours for it.
CAMP=$(curl -s -X POST "$API/campaigns" "${AUTH[@]}" "${JSON[@]}" -d "{
  \"name\":\"WhatsApp Send Test\",
  \"product\":\"UP Heritage Tours\",
  \"daily_send_limit\":5,
  \"send_window_start\":\"00:00\",
  \"send_window_end\":\"23:59\",
  \"send_window_timezone\":\"Asia/Kolkata\"
}" | jqp id | sed 's/^id=//')
echo "   campaign=$CAMP"

echo "=== 4. template (sequence_order 0 — current_sequence_step starts at 0) ==="
TPL=$(mktemp)
cat > "$TPL" <<JSONEOF
{ "campaign_id": "$CAMP", "name": "Opener", "type": "text",
  "body": "$BODY_TEXT", "sequence_order": 0 }
JSONEOF
curl -s -o /dev/null -w "   create template -> HTTP %{http_code}\n" \
  -X POST "$API/templates" "${AUTH[@]}" "${JSON[@]}" --data-binary "@$TPL"
rm -f "$TPL"

echo "=== 5. enrol the audience ==="
curl -s -X POST "$API/campaigns/$CAMP/contacts" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"contactIds\":[\"$CID\"]}" | jqp added skipped | sed 's/^/   /'

echo "=== 6. pre-send review (blockers must be empty) ==="
curl -s "${AUTH[@]}" "$API/campaigns/$CAMP/send-preview" \
  | jqp audience.sendable blockers | sed 's/^/   /'

echo "=== 7. activate — from here nothing is pushed manually ==="
curl -s -o /dev/null -w "   activate -> HTTP %{http_code}\n" \
  -X POST "$API/campaigns/$CAMP/activate" "${AUTH[@]}"

echo "=== 8. waiting for the distributor cron (runs every minute) ==="
for i in $(seq 1 16); do
  # Cast the enum to text before coalescing: comparing it against a placeholder
  # string makes Postgres reject the literal as an invalid enum value.
  ROW=$("${PSQL[@]}" -c "
    select coalesce((select cc.status::text from campaign_contacts cc where cc.campaign_id='$CAMP' limit 1),'-')
        || ' | msg=' || coalesce((select m.status::text from messages m
                                  join campaign_contacts c2 on c2.id=m.campaign_contact_id
                                  where c2.campaign_id='$CAMP' order by m.created_at desc limit 1),'none');")
  echo "   [$((i*15))s] cc=$ROW"
  case "$ROW" in *"msg=sent"*|*"msg=delivered"*|*"msg=read"*) echo "   DELIVERED"; break;; esac
  sleep 15
done

echo "=== 9. final state ==="
"${PSQL[@]}" -c "
  select m.status, m.openwa_message_id is not null as has_wa_id,
         left(m.openwa_session_id,8) as session, left(m.body,45) as body
  from messages m join campaign_contacts cc on cc.id=m.campaign_contact_id
  where cc.campaign_id='$CAMP';" | sed 's/^/   /'

echo
echo "campaign=$CAMP  contact=$CID"
echo "Clean up with: ./scripts/cleanup-test-campaign.sh $CAMP $CID"
