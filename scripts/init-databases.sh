#!/bin/bash
# Creates the additional `openwa` database inside the same Postgres instance.
# Docker runs everything in /docker-entrypoint-initdb.d only on FIRST init
# (i.e. when the postgres_data volume is empty).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE openwa OWNER $POSTGRES_USER'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'openwa')\gexec
EOSQL

echo "init-databases: ensured 'openwa' database exists"
