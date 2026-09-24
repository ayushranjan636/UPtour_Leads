# UPTour portal — AWS deployment

Single Graviton EC2 instance running the whole stack in Docker. Chosen over managed
services because at this scale RDS and ElastiCache would roughly triple the bill for
capacity the portal does not need.

## What is deployed

| | |
|---|---|
| Instance | `i-09fbe8b583005bd1f` — `t4g.small` (2 vCPU ARM, 2 GB), Ubuntu 24.04 |
| Region | `ap-south-1` (Mumbai) |
| Public IP | `43.205.132.61` (auto-assigned) |
| Security group | `sg-0c09e6085bbea3aea` |
| Disk | 20 GB gp3, encrypted |
| Path on host | `/opt/uptour` |

Nothing else in the account was modified. The existing instances (`dubcall-prod`,
`eraksha-dns`, `eraksha-backend` and the stopped ones) keep their own security groups.

### Why ARM

The OpenWA Dockerfile ships a native arm64 chromium path, so Graviton works and costs
about 20% less than the equivalent x86 instance for identical performance here.

### Why 2 GB plus swap

The gateway drives a headless Chromium, which needs roughly 1 GB while a chat list syncs.
2 GB runs the stack comfortably but cannot *build* the images, so the bootstrap adds 2 GB
of swap. Swap costs nothing per month; more RAM would cost every month for a need that
only arises during builds.

## Ports

Only Caddy is published. Postgres, Redis, the API and the gateway are reachable on the
internal Docker network alone.

| Port | Source | Purpose |
|---|---|---|
| 443 | anywhere | the portal, TLS terminated by Caddy |
| 80 | anywhere | ACME challenge and redirect to HTTPS |
| 22 | `152.57.0.0/16` | SSH. A `/32` was tried first and broke: the ISP uses CGNAT and the address rotates within this block |

The WhatsApp gateway dashboard is deliberately unpublished. It can send messages from the
linked account and mint API keys, so exposing it would widen the blast radius of a single
leaked credential. Reach it over a tunnel instead:

```bash
ssh -i ~/.ssh/uptour-portal.pem -L 2785:localhost:2785 ubuntu@43.205.132.61
# then open http://localhost:2785
```

## DNS

`uptours.in` is not in this account's Route 53 (only `slatemate.in` is), so add these at
whichever registrar or DNS provider holds the domain:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `portal` | `43.205.132.61` | 300 |

That is the only record required. No CNAME, no AAAA — the instance has no IPv6 address, and
publishing one that does not answer would make some clients fail before trying IPv4.

**One caveat with the auto-assigned IP:** it survives reboots but changes if the instance is
ever *stopped and started*. If that happens, read the new address and update the record:

```bash
aws ec2 describe-instances --instance-ids i-09fbe8b583005bd1f \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

An Elastic IP would pin it permanently for about ₹280/month. Worth taking if the portal
becomes business-critical.

### Certificates

Caddy requests a certificate from Let's Encrypt on first request and renews
automatically. It can only succeed **after** the A record resolves, because the ACME HTTP
challenge requires the domain to reach this host. Expect the first load to take a few
seconds while the certificate is issued.

## Operating it

All commands run from `/opt/uptour` on the host.

```bash
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.prod'

dc ps                    # what is running
dc logs -f backend       # follow the API
dc logs -f caddy         # certificate issues show up here
dc restart backend       # restart one service
dc pull && dc up -d      # apply base-image updates
```

### Deploying a change

```bash
# From a workstation, in the repo root:
rsync -az --delete -e "ssh -i ~/.ssh/uptour-portal.pem" \
  --exclude node_modules --exclude dist --exclude .git --exclude '.env*' \
  backend frontend docker-compose.prod.yml Caddyfile ubuntu@43.205.132.61:/opt/uptour/

ssh -i ~/.ssh/uptour-portal.pem ubuntu@43.205.132.61 \
  'cd /opt/uptour && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build'
```

### First-run database setup

The app has no migrations; it relies on TypeORM `synchronize`, which `app.module.ts`
disables when `NODE_ENV=production`. A production database therefore starts empty, and
there is no public register endpoint to create the first user. `deploy/bootstrap-db.sh`
creates the schema and seeds one admin:

```bash
cd /opt/uptour && ./deploy/bootstrap-db.sh 'you@example.com' 'a-strong-password'
```

It is idempotent — re-running will not reset an existing admin's password.

> Because the schema is created by `synchronize` rather than migrations, **any future
> entity change needs the same treatment**: the running production app will not alter its
> own schema. Adding real migrations is the durable fix.

### Backups

Nothing is scheduled yet. The data worth protecting is the Postgres volume (contacts,
messages, leads) and the OpenWA volume (the linked WhatsApp session — losing it means
re-scanning the QR).

```bash
# Database dump
cd /opt/uptour && docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T postgres pg_dump -U uptour uptour | gzip > ~/uptour-$(date +%F).sql.gz
```

## Secrets

`/opt/uptour/.env.prod` (mode 600) holds freshly generated production secrets. They are
deliberately different from the development values, which have been echoed into terminals
and chat logs. It is excluded from git and from the rsync deploy, so a deploy cannot
overwrite it.

The AI auto-reply switch ships **off**. Turn it on from Settings → AI Assistant when you
want the assistant answering prospects.

## Cost

Roughly, at Mumbai on-demand pricing:

| Item | Monthly |
|---|---|
| `t4g.small` on-demand | ~₹1,000 |
| 20 GB gp3 | ~₹150 |
| Data transfer out (light use) | ~₹0–80 |
| **Total** | **~₹1,150–1,250** |

Ways down from here, cheapest first:

- **Stop the instance when idle.** Billing is per-second while running; storage still
  accrues. Remember the public IP changes on stop/start.
- **A 1-year Savings Plan** cuts the instance cost by roughly 40% if this is long-lived.
- **`t4g.micro`** halves the instance cost but gives Chromium under 1 GB, which risks
  out-of-memory during WhatsApp chat syncs. Not recommended for a messaging workload.
