#!/usr/bin/env bash
# Proves a campaign can be created against an existing group in ONE request, with its
# audience enrolled and its opening message in place — i.e. "campaign this dataset again"
# is a single action rather than create-then-remember-to-add-contacts.
#
# Non-destructive: groups a few existing contacts, then removes the group and the test
# campaign again. Sends nothing (the campaign is left in draft).
#
# Usage: UPTOUR_PASSWORD=<admin password> ./scripts/verify-campaign-audience.sh
set -uo pipefail

API="http://localhost:3000/api"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GROUP="Audience Check"

read_env() { sed -n "s/^[[:space:]]*$1=//p" "$ROOT/backend/.env" 2>/dev/null | tail -n1 | tr -d '"'; }
PGPASSWORD="$(read_env DATABASE_PASSWORD)"; export PGPASSWORD
PSQL=(psql -h 127.0.0.1 -U "$(read_env DATABASE_USERNAME)" -d "$(read_env DATABASE_NAME)" -At)
jqp() { python3 "$ROOT/scripts/jsonpath.py" "$@"; }

TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${UPTOUR_EMAIL:-admin@uptour.in}\",\"password\":\"${UPTOUR_PASSWORD:?set UPTOUR_PASSWORD}\"}" |
  jqp accessToken | sed 's/^accessToken=//')
[[ -z "$TOKEN" ]] && { echo "login failed"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN"); JSON=(-H 'Content-Type: application/json')

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "=== 1. group two existing contacts ==="
curl -s "${AUTH[@]}" "$API/contacts?limit=2" > "$WORK/contacts.json"
python3 - "$WORK" "$GROUP" <<'PY'
import json, sys
work, group = sys.argv[1], sys.argv[2]
ids = [c['id'] for c in json.load(open(f'{work}/contacts.json'))['data']]
json.dump({'contactIds': ids, 'group': group}, open(f'{work}/group.json', 'w'))
print(f"   grouping {len(ids)} contacts as '{group}'")
PY
curl -s -X POST "$API/contacts/bulk/group" "${AUTH[@]}" "${JSON[@]}" \
  --data-binary "@$WORK/group.json" | jqp updated group | sed 's/^/   /'

echo "=== 2. how many does that group match? ==="
curl -s "${AUTH[@]}" "$API/contacts/count?groups=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$GROUP")&reachable_only=true" \
  | jqp count | sed 's/^/   /'

echo "=== 3. create a campaign targeting that group, in ONE request ==="
cat > "$WORK/campaign.json" <<JSONEOF
{
  "name": "Audience Check Campaign",
  "product": "UP Heritage Tours",
  "daily_send_limit": 30,
  "first_message": "{Hi|Hello} {{contact_name}}, heritage tours across UP. {Interested|Worth a chat}?",
  "audience": { "groups": ["$GROUP"] }
}
JSONEOF
CAMP=$(curl -s -X POST "$API/campaigns" "${AUTH[@]}" "${JSON[@]}" \
  --data-binary "@$WORK/campaign.json" | jqp id | sed 's/^id=//')
echo "   campaign=$CAMP"

echo "=== 4. was the audience enrolled automatically? ==="
"${PSQL[@]}" -c "
  select count(*) || ' contacts enrolled' from campaign_contacts where campaign_id='$CAMP';" \
  | sed 's/^/   /'
echo "=== 5. and is it ready to activate? (no blockers) ==="
curl -s "${AUTH[@]}" "$API/campaigns/$CAMP/send-preview" \
  | jqp audience.sendable templates.name blockers | sed 's/^/   /'

echo "=== cleanup: remove the test campaign and ungroup ==="
bash "$ROOT/scripts/cleanup-test-campaign.sh" "$CAMP" >/dev/null 2>&1
curl -s -o /dev/null -X POST "$API/contacts/bulk/ungroup" "${AUTH[@]}" "${JSON[@]}" \
  --data-binary "@$WORK/group.json"
echo "   groups now: $(curl -s "${AUTH[@]}" "$API/contacts/groups")"
echo "   contacts intact: $(curl -s "${AUTH[@]}" "$API/contacts/count" | jqp count)"
