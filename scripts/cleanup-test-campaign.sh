#!/usr/bin/env bash
# Removes a test campaign and, optionally, the test contact it used.
# Usage: ./scripts/cleanup-test-campaign.sh <campaignId> [contactId]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAMP="${1:?campaign id required}"
CONTACT="${2:-}"

read_env() { sed -n "s/^[[:space:]]*$1=//p" "$ROOT/backend/.env" 2>/dev/null | tail -n1 | tr -d '"'; }
PGPASSWORD="$(read_env DATABASE_PASSWORD)"; export PGPASSWORD
PSQL=(psql -h 127.0.0.1 -U "$(read_env DATABASE_USERNAME)" -d "$(read_env DATABASE_NAME)" -q)

# Innermost-first: none of these FKs declare ON DELETE CASCADE.
"${PSQL[@]}" <<SQL
BEGIN;
DELETE FROM ai_analyses WHERE campaign_contact_id IN (SELECT id FROM campaign_contacts WHERE campaign_id='$CAMP');
DELETE FROM followup_jobs WHERE campaign_contact_id IN (SELECT id FROM campaign_contacts WHERE campaign_id='$CAMP');
DELETE FROM messages WHERE campaign_contact_id IN (SELECT id FROM campaign_contacts WHERE campaign_id='$CAMP');
DELETE FROM deals WHERE lead_id IN (SELECT id FROM leads WHERE campaign_id='$CAMP');
DELETE FROM leads WHERE campaign_id='$CAMP';
DELETE FROM campaign_contacts WHERE campaign_id='$CAMP';
DELETE FROM message_templates WHERE campaign_id='$CAMP';
DELETE FROM campaigns WHERE id='$CAMP';
COMMIT;
SQL
echo "removed campaign $CAMP"

if [[ -n "$CONTACT" ]]; then
  "${PSQL[@]}" <<SQL
BEGIN;
DELETE FROM ai_analyses WHERE contact_id='$CONTACT';
DELETE FROM messages WHERE contact_id='$CONTACT';
DELETE FROM leads WHERE contact_id='$CONTACT';
DELETE FROM campaign_contacts WHERE contact_id='$CONTACT';
UPDATE collection_results SET contact_id=NULL WHERE contact_id='$CONTACT';
DELETE FROM contacts WHERE id='$CONTACT';
COMMIT;
SQL
  echo "removed contact $CONTACT"
fi

"${PSQL[@]}" -At -c "select relname||' = '||n_live_tup from pg_stat_user_tables where n_live_tup>0;"
