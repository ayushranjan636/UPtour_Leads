#!/usr/bin/env bash
# Wires a running OpenWA instance up to the UP Heritage Tours backend.
#
# OpenWA reads NO webhook configuration from the environment: webhooks are rows
# owned by a session, created via POST /api/sessions/:id/webhooks. So a fresh
# container never delivers a single event to us until this script runs.
#
# Idempotent: re-running reconciles the existing webhook instead of duplicating it.
#
#   ./scripts/setup-openwa.sh
#
# Reads OPENWA_* from backend/.env (the values the backend actually uses) and
# OPENWA_WEBHOOK_URL from the root .env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The six events documented in docs/01-technical-architecture.md §4.2 and handled
# by backend WebhooksService. Deliberately NOT '*': group.*/session.qr are noise
# the backend has no handler for.
EVENTS='["message.received","message.sent","message.ack","message.failed","session.status","session.disconnected"]'

die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
info() { printf '\033[36m›\033[0m %s\n' "$1"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$1"; }

# Read a KEY=value from an env file without sourcing it (values contain URLs,
# spaces and '#' that a naive `source` would mangle or execute).
read_env() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" "$file" | tail -n1 | sed -e 's/^"//' -e 's/"$//'
}

BACKEND_ENV="$ROOT/backend/.env"
ROOT_ENV="$ROOT/.env"
[[ -f "$BACKEND_ENV" ]] || die "backend/.env not found — copy backend/.env.example first."

BASE_URL="$(read_env "$BACKEND_ENV" OPENWA_BASE_URL)"
API_KEY="$(read_env "$BACKEND_ENV" OPENWA_API_KEY)"
SECRET="$(read_env "$BACKEND_ENV" OPENWA_WEBHOOK_SECRET)"
SESSION_ID="$(read_env "$BACKEND_ENV" OPENWA_SESSION_ID)"
WEBHOOK_URL="$(read_env "$ROOT_ENV" OPENWA_WEBHOOK_URL)"
WEBHOOK_URL="${WEBHOOK_URL:-http://host.docker.internal:3000/api/webhooks/openwa}"

[[ -n "$BASE_URL" ]] || die "OPENWA_BASE_URL missing from backend/.env"
[[ -n "$API_KEY" ]] || die "OPENWA_API_KEY missing from backend/.env"
[[ -n "$SECRET" ]] || die "OPENWA_WEBHOOK_SECRET missing from backend/.env"

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json')
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}" "${BASE_URL}${path}"
}

info "OpenWA at $BASE_URL"
api GET /health >/dev/null 2>&1 || die "OpenWA is not reachable. Start it: docker compose up -d --no-deps openwa"
ok "reachable"

# ── Resolve the session ─────────────────────────────────────────────────────
# Session ids are generated UUIDs; a name like 'default' can never be an id.
SESSIONS="$(api GET /sessions)"
RESOLVED="$(
  SESSIONS="$SESSIONS" WANT="$SESSION_ID" python3 - <<'PY'
import json, os
sessions = json.loads(os.environ["SESSIONS"] or "[]")
want = os.environ.get("WANT", "").strip()
if not sessions:
    raise SystemExit("NO_SESSIONS")
match = next((s for s in sessions if s.get("id") == want), None)
if match is None:
    # Fall back to a ready session so a renamed/recreated session self-heals.
    match = next((s for s in sessions if s.get("status") == "ready"), sessions[0])
print(f"{match['id']}\t{match.get('name','')}\t{match.get('status','')}")
PY
)" || die "no WhatsApp session exists yet — create one and scan the QR at http://localhost:2785"

SID="$(cut -f1 <<<"$RESOLVED")"
SNAME="$(cut -f2 <<<"$RESOLVED")"
SSTATUS="$(cut -f3 <<<"$RESOLVED")"
ok "session '$SNAME' ($SSTATUS) → $SID"

if [[ "$SID" != "$SESSION_ID" ]]; then
  printf '\033[33m!\033[0m backend/.env OPENWA_SESSION_ID=%s does not match. Set it to:\n  OPENWA_SESSION_ID=%s\n' \
    "${SESSION_ID:-<unset>}" "$SID"
fi
[[ "$SSTATUS" == "ready" ]] || printf '\033[33m!\033[0m session is "%s", not "ready" — sends will fail until it connects.\n' "$SSTATUS"

# ── Reconcile the webhook ───────────────────────────────────────────────────
EXISTING="$(api GET "/sessions/$SID/webhooks")"
EXISTING_ID="$(
  EXISTING="$EXISTING" URL="$WEBHOOK_URL" python3 - <<'PY'
import json, os
hooks = json.loads(os.environ["EXISTING"] or "[]")
if isinstance(hooks, dict):
    hooks = hooks.get("data", [])
match = next((h for h in hooks if h.get("url") == os.environ["URL"]), None)
print(match["id"] if match else "")
PY
)"

# `secret` is write-only (never returned by the API), so always send it: that is
# what makes the backend's HMAC check pass.
PAYLOAD="$(URL="$WEBHOOK_URL" SECRET="$SECRET" EVENTS="$EVENTS" python3 - <<'PY'
import json, os
print(json.dumps({
    "url": os.environ["URL"],
    "events": json.loads(os.environ["EVENTS"]),
    "secret": os.environ["SECRET"],
    "retryCount": 3,
}))
PY
)"

if [[ -n "$EXISTING_ID" ]]; then
  info "updating existing webhook $EXISTING_ID"
  RESULT="$(api PUT "/sessions/$SID/webhooks/$EXISTING_ID" "$PAYLOAD")"
else
  info "creating webhook → $WEBHOOK_URL"
  RESULT="$(api POST "/sessions/$SID/webhooks" "$PAYLOAD")"
fi

HOOK_ID="$(RESULT="$RESULT" python3 -c 'import json,os; print(json.loads(os.environ["RESULT"]).get("id",""))' 2>/dev/null || true)"
[[ -n "$HOOK_ID" ]] || die "webhook registration failed: $RESULT"
ok "webhook $HOOK_ID → $WEBHOOK_URL"
printf '  events: %s\n' "$(tr -d '[]"' <<<"$EVENTS")"

# ── Verify delivery ─────────────────────────────────────────────────────────
# Proves the container can reach the host AND that our HMAC secret matches:
# a signature mismatch surfaces as 401 from the backend.
info "sending test delivery"
TEST="$(api POST "/sessions/$SID/webhooks/$HOOK_ID/test" || true)"
if grep -q '"success":true' <<<"$TEST"; then
  ok "backend accepted the signed test event"
else
  printf '\033[33m!\033[0m test delivery did not report success:\n  %s\n' "$TEST"
  printf '  If this is 401, backend OPENWA_WEBHOOK_SECRET != the value registered here.\n'
  printf '  If it is a connection error, the backend is not listening on :3000.\n'
fi

ok "OpenWA is wired to UP Heritage Tours"
