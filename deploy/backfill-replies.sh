#!/usr/bin/env bash
# Import replies the portal never received.
#
# Webhook registration failed for the whole of a campaign ("Destination address is not
# allowed" — the gateway's SSRF guard refusing our internal hostname), so every inbound
# message was dropped on the floor: 51 sent, 0 replies recorded. The gateway persists
# messages in its own database regardless of webhook delivery, so those replies still
# exist and can be replayed into the portal.
#
# Replays through the real webhook endpoint rather than writing to the database, so every
# rule downstream still applies exactly once: lead creation, reply stats, group/broadcast
# filtering, and AI auto-reply if it is switched on. Re-running is safe — the endpoint
# dedupes on the gateway message id.
#
# Usage, on the host:  cd /opt/uptour && ./deploy/backfill-replies.sh [--dry-run]
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
DRY_RUN="${1:-}"

API_KEY=$(grep '^OPENWA_API_KEY=' .env.prod | cut -d= -f2-)
SECRET=$(grep '^OPENWA_WEBHOOK_SECRET=' .env.prod | cut -d= -f2-)
[ -z "$API_KEY" ] && { echo "OPENWA_API_KEY missing from .env.prod" >&2; exit 1; }

SESSION=$(docker exec uptour-openwa sh -c \
  "curl -s -m 10 http://localhost:2785/api/sessions -H 'X-API-Key: ${API_KEY}'" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); r=r if isinstance(r,list) else r.get("data",[]); print(r[0]["id"] if r else "")')

if [ -z "$SESSION" ]; then
  echo "No session on the gateway. Link WhatsApp first." >&2
  exit 1
fi
echo "==> Session ${SESSION}"

# Pull the stored history. 500 covers a campaign's worth of traffic; raise if needed.
docker exec uptour-openwa sh -c \
  "curl -s -m 60 'http://localhost:2785/api/sessions/${SESSION}/messages?limit=500' -H 'X-API-Key: ${API_KEY}'" \
  > /tmp/gw-messages.json

python3 - "$DRY_RUN" "$SECRET" <<'PY'
import hashlib, hmac, json, subprocess, sys

dry = sys.argv[1] == '--dry-run'
secret = sys.argv[2]

raw = json.load(open('/tmp/gw-messages.json'))
rows = raw if isinstance(raw, list) else (raw.get('data') or raw.get('messages') or [])

# Only inbound individual chats. Our own sends are already recorded, and group or broadcast
# traffic is deliberately ignored by the webhook handler — replaying it would create
# contacts named after groups.
def inbound(m):
    if m.get('fromMe') or m.get('from_me'):
        return False
    chat = str(m.get('chatId') or m.get('chat_id') or m.get('from') or '')
    return not any(s in chat for s in ('@g.us', '@broadcast', '@newsletter'))

replies = [m for m in rows if inbound(m)]
print(f"==> {len(rows)} stored messages, {len(replies)} inbound replies")

if not replies:
    print("    Nothing to replay.")
    raise SystemExit(0)

for m in replies[:5]:
    body = (m.get('body') or m.get('text') or '')[:60].replace('\n', ' ')
    print(f"    {m.get('from') or m.get('chatId')}: {body}")
if len(replies) > 5:
    print(f"    ... and {len(replies) - 5} more")

if dry:
    print("==> Dry run, nothing sent.")
    raise SystemExit(0)

ok = failed = 0
for m in replies:
    payload = json.dumps({'event': 'message.received', 'data': m}, separators=(',', ':'))
    # The controller rejects unsigned deliveries, so sign exactly as the gateway does.
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    r = subprocess.run(
        ['docker', 'exec', '-i', 'uptour-openwa', 'curl', '-s', '-o', '/dev/null',
         '-w', '%{http_code}', '-m', '20', '-X', 'POST',
         'http://backend:3000/api/webhooks/openwa',
         '-H', 'Content-Type: application/json',
         '-H', f'X-OpenWA-Signature: sha256={sig}',
         '--data-binary', '@-'],
        input=payload, capture_output=True, text=True,
    )
    if r.stdout.strip() in ('200', '201', '202'):
        ok += 1
    else:
        failed += 1
        if failed <= 3:
            print(f"    failed ({r.stdout.strip()}): {m.get('id')}")

print(f"==> Replayed {ok}, failed {failed}")
PY

echo "==> Portal now holds:"
$COMPOSE exec -T postgres psql -U uptour -d uptour -At -c \
  "select '    inbound=' || count(*) from messages where direction='incoming';"
$COMPOSE exec -T postgres psql -U uptour -d uptour -At -c \
  "select '    leads=' || count(*) from leads;"
