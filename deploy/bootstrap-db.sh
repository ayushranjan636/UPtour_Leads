#!/usr/bin/env bash
# Create the schema and the first admin user on a fresh production database.
#
# The app has no migrations: it relies on TypeORM `synchronize`, which app.module.ts
# disables when NODE_ENV=production (correctly — auto-altering a live schema can drop
# columns). A production database therefore starts with no tables at all, and since there
# is no public register endpoint there would be no way to log in.
#
# This runs the API once with synchronize enabled to create the schema, then inserts one
# admin user. Idempotent: re-running it leaves an existing admin untouched.
#
# Usage, on the host:  cd /opt/uptour && ./deploy/bootstrap-db.sh 'admin@example.com' 'password'
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

EMAIL="${1:?usage: bootstrap-db.sh <email> <password>}"
PASSWORD="${2:?usage: bootstrap-db.sh <email> <password>}"

if [ "${#PASSWORD}" -lt 8 ]; then
  echo "Refusing: the password must be at least 8 characters." >&2
  exit 1
fi

echo "==> Waiting for Postgres"
for _ in $(seq 1 30); do
  if $COMPOSE exec -T postgres pg_isready -U uptour >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "==> Creating the schema"
# NODE_ENV=development flips synchronize on for this one-off run. The container exits once
# the schema exists; nothing serves traffic from it, so production behaviour is unchanged.
$COMPOSE run --rm --no-deps \
  -e NODE_ENV=development \
  -e DATABASE_HOST=postgres \
  -e REDIS_HOST=redis \
  backend sh -c '
    node -e "
      const { NestFactory } = require(\"@nestjs/core\");
      const { AppModule } = require(\"./dist/app.module\");
      NestFactory.createApplicationContext(AppModule, { logger: [\"error\"] })
        .then(async (app) => { await app.close(); console.log(\"schema ready\"); process.exit(0); })
        .catch((e) => { console.error(e.message); process.exit(1); });
    "
  ' 2>&1 | tail -5

TABLES=$($COMPOSE exec -T postgres psql -U uptour -d uptour -At \
  -c "select count(*) from pg_tables where schemaname='public';" 2>/dev/null | tr -d '[:space:]')
echo "==> Tables present: ${TABLES}"
if [ "${TABLES:-0}" -lt 10 ]; then
  echo "Schema creation failed — refusing to continue without tables." >&2
  exit 1
fi

echo "==> Seeding the admin user"
# bcrypt via the API image, so the hash matches exactly what AuthService verifies against.
HASH=$($COMPOSE run --rm --no-deps -T backend \
  node -e "process.stdout.write(require('bcrypt').hashSync(process.argv[1], 10))" "$PASSWORD" 2>/dev/null | tail -1)

if [ -z "$HASH" ]; then
  echo "Could not hash the password." >&2
  exit 1
fi

# The column is `password_hash` (see user.entity.ts), and `role` is a Postgres enum, so the
# value must be cast explicitly. ON CONFLICT DO NOTHING: re-running must never silently
# reset a password that has since been changed.
$COMPOSE exec -T postgres psql -U uptour -d uptour -v ON_ERROR_STOP=1 <<SQL
INSERT INTO users (email, password_hash, name, role, is_active)
VALUES ('${EMAIL}', '${HASH}', 'Admin', 'admin'::users_role_enum, true)
ON CONFLICT (email) DO NOTHING;
SQL

COUNT=$($COMPOSE exec -T postgres psql -U uptour -d uptour -At \
  -c "select count(*) from users;" | tr -d '[:space:]')
echo "==> Users: ${COUNT}"
echo "==> Done. Sign in as ${EMAIL}"
