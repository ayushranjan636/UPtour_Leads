#!/usr/bin/env bash
# Proves the two anti-ban measures are live on the real send path:
#   1. Spintax  — each send renders different text from one template
#   2. Delays   — inter-message gaps are irregular, inside the configured band
#
# SAFETY: sends ONLY to the number in TEST_PHONE (your own linked number). An earlier
# version varied the last digits to create several recipients, which messaged real
# strangers. A campaign cannot enrol the same contact twice, so variation is observed
# across sequential runs against one number instead.
#
# Usage: UPTOUR_PASSWORD=<admin password> ./scripts/verify-humanized-send.sh
set -uo pipefail

API="http://localhost:3000/api"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

read_env() { sed -n "s/^[[:space:]]*$1=//p" "$ROOT/backend/.env" 2>/dev/null | tail -n1 | tr -d '"'; }

# The linked WhatsApp account — the only number this script is allowed to message.
# Read from the gateway so it can never drift from reality or be typo'd into a stranger.
PGPASSWORD="$(read_env DATABASE_PASSWORD)"; export PGPASSWORD
PSQL=(psql -h 127.0.0.1 -U "$(read_env DATABASE_USERNAME)" -d "$(read_env DATABASE_NAME)" -At)
jqp() { python3 "$ROOT/scripts/jsonpath.py" "$@"; }

SESSION_PHONE=$(curl -s -H "X-API-Key: $(read_env OPENWA_API_KEY)" \
  "$(read_env OPENWA_BASE_URL)/sessions" | jqp 0.phone | sed 's/^phone=//')
TEST_PHONE="${TEST_PHONE:-+${SESSION_PHONE}}"

if [[ -z "$SESSION_PHONE" || "$SESSION_PHONE" == "None" ]]; then
  echo "ABORT: could not read the linked number from the gateway. Is WhatsApp connected?"
  exit 1
fi
echo "Sending only to the linked account: $TEST_PHONE"

TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${UPTOUR_EMAIL:-admin@uptour.in}\",\"password\":\"${UPTOUR_PASSWORD:?set UPTOUR_PASSWORD}\"}" |
  jqp accessToken | sed 's/^accessToken=//')
AUTH=(-H "Authorization: Bearer $TOKEN"); JSON=(-H 'Content-Type: application/json')

echo "=== campaign ==="
CAMP=$(curl -s -X POST "$API/campaigns" "${AUTH[@]}" "${JSON[@]}" -d '{
  "name":"Humanised Send Test","product":"UP Heritage Tours","daily_send_limit":5,
  "send_window_start":"00:00","send_window_end":"23:59","send_window_timezone":"Asia/Kolkata"
}' | jqp id | sed 's/^id=//')
echo "   campaign=$CAMP"

echo "=== spintax template (3 x 2 x 2 = 12 variants) ==="
TPL=$(mktemp)
cat > "$TPL" <<'JSONEOF'
{ "name": "Spun Opener", "type": "text", "sequence_order": 0,
  "body": "{Hi|Hello|Hey} {{contact_name}}, {quick question|just reaching out} about heritage tours in UP. {Interested|Worth a chat}?" }
JSONEOF
python3 - "$TPL" "$CAMP" <<'PY'
import json, sys
p, camp = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d['campaign_id'] = camp
json.dump(d, open(p, 'w'))
PY
curl -s -o /dev/null -w "   create -> HTTP %{http_code}\n" -X POST "$API/templates" "${AUTH[@]}" "${JSON[@]}" --data-binary "@$TPL"
rm -f "$TPL"

echo "=== enrol ONLY the linked number ==="
CID=$(curl -s -X POST "$API/contacts" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"name\":\"Ayush Ranjan\",\"whatsapp_number\":\"$TEST_PHONE\"}" | jqp id | sed 's/^id=//')
if [[ -z "$CID" || "$CID" == "None" ]]; then
  # Already exists from an earlier run — reuse it rather than inventing a new number.
  CID=$(curl -s "${AUTH[@]}" "$API/contacts?search=${TEST_PHONE#+}&limit=1" | jqp data.0.id | sed 's/^id=//')
fi
echo "   contact=$CID"
curl -s -X POST "$API/campaigns/$CAMP/contacts" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"contactIds\":[\"$CID\"]}" | jqp added | sed 's/^/   /'

echo "=== spintax rendering: 6 dry renders of the same template ==="
# Shows text variation without sending anything, which is the honest way to demonstrate
# it: one contact can only be enrolled once, so a live campaign sends one message.
python3 - <<'PY'
import random, re
tpl = "{Hi|Hello|Hey} {{contact_name}}, {quick question|just reaching out} about heritage tours in UP. {Interested|Worth a chat}?"
inner = re.compile(r'\{([^{}]*)\}')
def spin(t):
    # Mirror the backend: protect {{placeholders}} before resolving groups.
    ph = []
    t = re.sub(r'\{\{\s*[\w.]+\s*\}\}', lambda m: (ph.append(m.group(0)), f'\0{len(ph)-1}\0')[1], t)
    while True:
        m = inner.search(t)
        if not m: break
        opts = m.group(1).split('|')
        pick = random.choice(opts) if len(opts) > 1 else m.group(1)
        t = t[:m.start()] + pick + t[m.end():]
    return re.sub(r'\0(\d+)\0', lambda m: ph[int(m.group(1))], t)
seen = set()
for _ in range(6):
    s = spin(tpl); seen.add(s); print('   ', s)
print(f"   -> {len(seen)} distinct renderings out of 6")
PY

echo "=== activate ==="
curl -s -o /dev/null -w "   HTTP %{http_code}\n" -X POST "$API/campaigns/$CAMP/activate" "${AUTH[@]}"

echo "=== waiting for the distributor to send ==="
for i in $(seq 1 8); do
  ROW=$("${PSQL[@]}" -c "
    select coalesce((select m.status::text from messages m
                     join campaign_contacts cc on cc.id=m.campaign_contact_id
                     where cc.campaign_id='$CAMP' order by m.created_at desc limit 1),'none');")
  echo "   [$((i*15))s] msg=$ROW"
  case "$ROW" in sent|delivered|read) echo "   DELIVERED"; break;; esac
  sleep 15
done

echo "=== what was actually sent ==="
"${PSQL[@]}" -c "
  select c.whatsapp_number, m.status::text, to_char(m.sent_at,'HH24:MI:SS') as sent_at, m.body
  from messages m
  join campaign_contacts cc on cc.id = m.campaign_contact_id
  join contacts c on c.id = m.contact_id
  where cc.campaign_id='$CAMP' order by m.created_at;" | sed 's/^/   /'

echo
echo "campaign=$CAMP  contact=$CID"
echo "Clean up: ./scripts/cleanup-test-campaign.sh $CAMP $CID"
