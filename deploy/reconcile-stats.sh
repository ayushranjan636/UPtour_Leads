#!/usr/bin/env bash
# Reconcile campaign stats from the gateway's own ack records.
#
# Why this is needed: webhook registration failed for an entire campaign (the gateway's
# SSRF guard refused our internal hostname), so no `message.ack` ever reached the portal.
# The dashboard therefore showed 51 sent / 0 delivered / 0 read — not because delivery
# failed, but because nobody was listening. Those acks are not lost: the gateway records a
# per-message status in its own database, keyed by the same id the portal stores as
# `openwa_message_id`.
#
# This reads that status and corrects `messages` and `campaigns.stats_*` to match what
# actually happened. Idempotent, and safe to run at any time.
#
# Usage, on the host:  cd /opt/uptour && ./deploy/reconcile-stats.sh [--dry-run]
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
DRY_RUN="${1:-}"

API_KEY=$(grep '^OPENWA_API_KEY=' .env.prod | cut -d= -f2-)
[ -z "$API_KEY" ] && { echo "OPENWA_API_KEY missing from .env.prod" >&2; exit 1; }

SESSION=$(docker exec uptour-openwa sh -c \
  "curl -s -m 10 http://localhost:2785/api/sessions -H 'X-API-Key: ${API_KEY}'" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); r=r if isinstance(r,list) else r.get("data",[]); print(r[0]["id"] if r else "")')

[ -z "$SESSION" ] && { echo "No session on the gateway. Link WhatsApp first." >&2; exit 1; }
echo "==> Session ${SESSION}"

docker exec uptour-openwa sh -c \
  "curl -s -m 60 'http://localhost:2785/api/sessions/${SESSION}/messages?limit=1000' -H 'X-API-Key: ${API_KEY}'" \
  > /tmp/gw-acks.json

# Build "<waMessageId> <status>" pairs for outbound messages only. Inbound messages carry
# no delivery state of ours.
python3 - <<'PY' > /tmp/ack-pairs.txt
import json
raw = json.load(open('/tmp/gw-acks.json'))
rows = raw if isinstance(raw, list) else (raw.get('data') or raw.get('messages') or [])
for m in rows:
    if not (m.get('fromMe') or m.get('from_me')):
        continue
    wid = m.get('waMessageId') or m.get('wa_message_id') or m.get('id')
    st = (m.get('status') or '').lower()
    if wid and st in ('sent', 'delivered', 'read', 'failed'):
        print(f"{wid}\t{st}")
PY

COUNT=$(wc -l < /tmp/ack-pairs.txt | tr -d ' ')
echo "==> ${COUNT} outbound messages with a known status on the gateway"
[ "$COUNT" = "0" ] && { echo "    Nothing to reconcile."; exit 0; }
cut -f2 /tmp/ack-pairs.txt | sort | uniq -c | sed 's/^/    /'

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "==> Dry run, no changes written."
  exit 0
fi

docker cp /tmp/ack-pairs.txt uptour-postgres:/tmp/ack-pairs.txt >/dev/null

$COMPOSE exec -T postgres psql -U uptour -d uptour -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

CREATE TEMP TABLE gw_acks (wa_id text, status text);
COPY gw_acks FROM '/tmp/ack-pairs.txt';

-- Only ever move a message forward. A stale gateway row must not demote a message the
-- portal already knows was read.
UPDATE messages m SET
  status = g.status::messages_status_enum,
  delivered_at = COALESCE(m.delivered_at, CASE WHEN g.status IN ('delivered','read') THEN now() END),
  read_at      = COALESCE(m.read_at,      CASE WHEN g.status = 'read' THEN now() END)
FROM gw_acks g
WHERE m.openwa_message_id = g.wa_id
  AND m.direction = 'outgoing'
  AND CASE g.status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END
    > CASE m.status::text WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END;

-- Mirror the furthest state onto the enrolment, which is what the contacts table shows.
UPDATE campaign_contacts cc SET status = m.status::text::campaign_contacts_status_enum
FROM messages m
WHERE m.campaign_contact_id = cc.id
  AND m.direction = 'outgoing'
  AND m.status::text IN ('delivered','read')
  AND CASE m.status::text WHEN 'read' THEN 3 ELSE 2 END
    > CASE cc.status::text WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END;

-- Recompute the campaign counters from the message rows rather than incrementing them.
-- The rows are the ground truth, and deriving avoids the double-counting that incremental
-- updates produced before.
UPDATE campaigns c SET
  stats_sent      = s.sent,
  stats_delivered = s.delivered,
  stats_read      = s.read,
  stats_replied   = s.replied,
  updated_at      = now()
FROM (
  SELECT cc.campaign_id,
         count(*) FILTER (WHERE m.direction='outgoing' AND m.openwa_message_id IS NOT NULL) AS sent,
         count(*) FILTER (WHERE m.direction='outgoing' AND m.delivered_at IS NOT NULL)      AS delivered,
         count(*) FILTER (WHERE m.direction='outgoing' AND m.read_at IS NOT NULL)           AS read,
         count(DISTINCT CASE WHEN m.direction='incoming' THEN m.contact_id END)             AS replied
  FROM campaign_contacts cc
  JOIN messages m ON m.campaign_contact_id = cc.id
  GROUP BY cc.campaign_id
) s
WHERE c.id = s.campaign_id;

COMMIT;
SQL

echo "==> Campaign stats now:"
$COMPOSE exec -T postgres psql -U uptour -d uptour -c \
  "select name, stats_sent as sent, stats_delivered as delivered, stats_read as read, stats_replied as replied from campaigns;"
