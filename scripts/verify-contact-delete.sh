#!/usr/bin/env bash
# Verifies DELETE /api/contacts/:id removes a contact that has a full history chain.
# None of the five tables referencing `contacts` declare ON DELETE CASCADE, so this
# is the case that a naive delete fails on.
set -uo pipefail

API="http://localhost:3000/api"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read the DB password from backend/.env rather than hard-coding it — this script is
# committed, and the repository is public.
read_env() {
  sed -n "s/^[[:space:]]*$1=//p" "$ROOT/backend/.env" 2>/dev/null | tail -n1 | tr -d '"'
}
PGPASSWORD="$(read_env DATABASE_PASSWORD)"
if [[ -z "$PGPASSWORD" ]]; then
  echo "error: DATABASE_PASSWORD not found in backend/.env" >&2
  exit 1
fi
export PGPASSWORD
DB_USER="$(read_env DATABASE_USERNAME)"; DB_USER="${DB_USER:-uptour}"
DB_NAME="$(read_env DATABASE_NAME)"; DB_NAME="${DB_NAME:-uptour}"
PSQL=(psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -At)

TOKEN=$(cat /tmp/uptour_token.txt)
CAMP="11111111-1111-1111-1111-111111111111"
CC="22222222-2222-2222-2222-222222222222"
MSG="33333333-3333-3333-3333-333333333333"
LEAD="44444444-4444-4444-4444-444444444444"

CID=$(curl -s -X POST "$API/contacts" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"History Test 3","whatsapp_number":"+919000000004"}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')
UID_=$("${PSQL[@]}" -c "select id from users limit 1")

echo "contact=$CID"
echo "user=$UID_"

"${PSQL[@]}" -v ON_ERROR_STOP=1 -q \
  -v cid="$CID" -v uid="$UID_" -v camp="$CAMP" -v cc="$CC" -v msg="$MSG" -v lead="$LEAD" <<'SQL'
INSERT INTO campaigns (id,name,status,created_by,created_at,updated_at)
  VALUES (:'camp','Hist Campaign','draft',:'uid',now(),now());
INSERT INTO campaign_contacts (id,campaign_id,contact_id,status,created_at,updated_at)
  VALUES (:'cc',:'camp',:'cid','pending',now(),now());
INSERT INTO messages (id,contact_id,campaign_contact_id,direction,type,body,status,created_at)
  VALUES (:'msg',:'cid',:'cc','outgoing','text','hi','sent',now());
INSERT INTO ai_analyses
  (id,message_id,contact_id,campaign_contact_id,destination_interest,questions,needs_human,opt_out,created_at)
  VALUES (gen_random_uuid(),:'msg',:'cid',:'cc','{}','{}',false,false,now());
INSERT INTO leads (id,contact_id,campaign_contact_id,campaign_id,status,destinations,currency,created_at,updated_at)
  VALUES (:'lead',:'cid',:'cc',:'camp','new','{}','INR',now(),now());
INSERT INTO deals (id,lead_id,name,currency,stage,created_at,updated_at)
  VALUES (gen_random_uuid(),:'lead','Hist Deal','INR','proposal',now(),now());
SQL

counts() {
  "${PSQL[@]}" -c "select
    'cc='   || (select count(*) from campaign_contacts where contact_id='$CID') ||
    ' msg=' || (select count(*) from messages where contact_id='$CID') ||
    ' ai='  || (select count(*) from ai_analyses where contact_id='$CID') ||
    ' leads='|| (select count(*) from leads where contact_id='$CID') ||
    ' deals='|| (select count(*) from deals where lead_id='$LEAD') ||
    ' contact=' || (select count(*) from contacts where id='$CID') ||
    ' campaign_kept=' || (select count(*) from campaigns where id='$CAMP');"
}

echo "BEFORE: $(counts)"
echo -n "DELETE -> "
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X DELETE "$API/contacts/$CID" -H "Authorization: Bearer $TOKEN"
echo "AFTER:  $(counts)"

# Clean up the scaffolding campaign so the database returns to empty.
"${PSQL[@]}" -q -c "delete from campaigns where id='$CAMP';"
echo "cleanup done; campaigns now: $("${PSQL[@]}" -c 'select count(*) from campaigns;')"
