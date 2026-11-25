#!/usr/bin/env bash
# One-shot installer for Tadbeer Daily's API on a VPS (CloudPanel-friendly).
# Run as root from a fresh clone:
#   git clone -b <branch> https://github.com/iftiyak7/claude-code.git /root/tadbeer-src
#   bash /root/tadbeer-src/deploy/scripts/install.sh
# Safe to run again: it never overwrites an existing .env or database.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Please run as root (type: exit, then run again)"; exit 1; fi

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
USER_NAME=tadbeer
APP_DIR=/home/$USER_NAME/tadbeer
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "Checking firewall (keeping SSH and CloudPanel reachable)"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow OpenSSH >/dev/null || true
  ufw allow 80/tcp >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
  command -v clpctl >/dev/null && ufw allow 8443/tcp >/dev/null || true
fi

say "Installing Docker (if missing)"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

say "Creating user '$USER_NAME' (if missing)"
id "$USER_NAME" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG docker "$USER_NAME"

say "Copying app to $APP_DIR"
if [[ "$SRC" != "$APP_DIR" ]]; then
  mkdir -p "$APP_DIR"
  # keep an existing .env / backups when re-installing
  rsync -a --exclude 'deploy/.env' --exclude 'deploy/backups' "$SRC"/ "$APP_DIR"/ 2>/dev/null || cp -a "$SRC"/. "$APP_DIR"/
fi
chown -R "$USER_NAME:$USER_NAME" "/home/$USER_NAME"

ENV_FILE="$APP_DIR/deploy/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  say "Creating secrets"
  read -r -p "Your email (for notices): " EMAIL
  printf 'POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nACME_EMAIL=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$EMAIL" > "$ENV_FILE"
  chown "$USER_NAME:$USER_NAME" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  say "Keeping existing .env"
fi

say "Daily database backup at 03:15"
echo "15 3 * * * $USER_NAME $APP_DIR/deploy/scripts/backup.sh >> /home/$USER_NAME/backup.log 2>&1" > /etc/cron.d/tadbeer-backup

say "Updating the website (CloudPanel static site, if it exists)"
for D in /home/*/htdocs/www.tadbeerdaily.com /home/*/htdocs/tadbeerdaily.com; do
  if [[ -d "$D" ]]; then
    cp -r "$SRC"/web/. "$D"/
    chown -R "$(stat -c %U:%G "$D")" "$D"
    echo "website updated: $D"
  fi
done

say "Building and starting the API (first time takes a few minutes)"
su - "$USER_NAME" -c "cd $APP_DIR/deploy && ./scripts/deploy.sh"

cat <<'MSG'

========================================================
 API is running on this server at http://127.0.0.1:3807
 Next: in CloudPanel, add a Reverse Proxy site
   Domain:            api.tadbeerdaily.com
   Reverse Proxy Url: http://127.0.0.1:3807
 then issue a Let's Encrypt certificate for it.
========================================================
MSG
