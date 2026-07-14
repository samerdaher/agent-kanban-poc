# Deployment notes

## TLS (Caddy reverse proxy)

The app currently serves plain HTTP on port 3000. To put it behind HTTPS
(automatic Let's Encrypt certificates), run these **with sudo**:

```bash
sudo apt install -y caddy                          # installs + enables caddy.service
sudo cp /opt/agent-kanban-poc/deploy/Caddyfile /etc/caddy/Caddyfile
# edit /etc/caddy/Caddyfile: replace board.example.com with your domain
sudo systemctl reload caddy
```

Then point your domain's A record at this server. If you have no domain yet,
use the `tls internal` variant at the bottom of the Caddyfile (encrypted, but
browsers show a warning for the self-signed cert).

Once TLS is on, also close port 3000 from the outside (keep it for Caddy):

```bash
sudo ufw allow 443/tcp && sudo ufw allow 80/tcp && sudo ufw deny 3000/tcp
```

## Backups

`scripts/backup.mjs` checkpoints the SQLite WAL and copies the database +
vault key to `data/backups/<timestamp>/`, keeping the newest 14. Install the
nightly cron (no sudo needed):

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/agent-kanban-poc && /usr/bin/node scripts/backup.mjs >> data/backups/backup.log 2>&1") | crontab -
```

For offsite copies, sync `data/backups/` to object storage (rclone, restic,
or litestream for continuous replication).

## Tests

```bash
npm run build   # tests run against the built app
npm test        # boots an isolated instance (simulation mode) and drives the API
```

CI runs the same on every push via `.github/workflows/ci.yml`.

## Service

`agentboard.service` (systemd) runs `npm start` on port 3000 with
`Restart=always`. After deploying new code:

```bash
cd /opt/agent-kanban-poc && npm run build && sudo systemctl restart agentboard
```

Environment lives in `/opt/agent-kanban-poc/.env` (gitignored):
`ANTHROPIC_API_KEY`, optional `CLAUDE_MODEL`, `AGENT_CONCURRENCY`,
`AGENT_MAX_ITERATIONS`, `AGENTBOARD_SECRET_KEY`.
