# Deploying to the VPS (72.62.198.94)

Stack: **Caddy** (automatic Let's Encrypt HTTPS) → **API** (Node) → **PostgreSQL**. Only ports 22/80/443 are open; the database is never reachable from the internet.

| Host | Serves |
|---|---|
| `www.tadbeerdaily.com` | landing page (`web/`) |
| `tadbeerdaily.com` | redirects to www |
| `api.tadbeerdaily.com` | sync/auth API |
| `app.tadbeerdaily.com` | optional browser version of the app |

## 1. DNS (at your domain registrar)

| Type | Name | Value |
|---|---|---|
| A | `@` | `72.62.198.94` |
| A | `www` | `72.62.198.94` |
| A | `api` | `72.62.198.94` |
| A | `app` | `72.62.198.94` |

Wait until `ping api.tadbeerdaily.com` shows the VPS IP before step 3 (HTTPS certificates need it).

## 2. Prepare the server (once, as root)

```bash
ssh root@72.62.198.94
curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/scripts/setup-vps.sh -o setup-vps.sh   # or scp it
bash setup-vps.sh
```

This updates Ubuntu, enables automatic security updates, a firewall (ufw), fail2ban, installs Docker, creates a `tadbeer` user and a daily 03:15 database backup.

## 3. Start the stack

```bash
su - tadbeer
git clone <repo-url> tadbeer && cd tadbeer/deploy
cp .env.example .env
# fill POSTGRES_PASSWORD, JWT_SECRET (64 random chars each) and ACME_EMAIL:
openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-64
nano .env
./scripts/deploy.sh
```

Check: `curl https://api.tadbeerdaily.com/health` → `{"ok":true}`.

## Updating

```bash
cd ~/tadbeer/deploy && ./scripts/deploy.sh     # pulls, rebuilds, restarts; data is kept
```

## Backups

- Automatic: `deploy/backups/tadbeer-*.sql.gz`, 14 days kept.
- Manual: `./scripts/backup.sh`
- Restore: `./scripts/restore.sh backups/<file>.sql.gz`
- Copy backups off the server regularly (e.g. `scp`), a VPS disk is a single point of failure.

## Optional: browser version

```bash
cd mobile && npx expo export --platform web --output-dir ../deploy/app-web
```
