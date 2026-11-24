#!/usr/bin/env bash
# One-time hardening + Docker install for a fresh Ubuntu 22.04/24.04 VPS.
# Run as root:  bash setup-vps.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run as root"; exit 1; fi
DEPLOY_USER=${DEPLOY_USER:-tadbeer}

echo "==> System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Firewall: only SSH, HTTP, HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> fail2ban for SSH brute force"
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
findtime = 10m
JAIL
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Deploy user '$DEPLOY_USER'"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
if [[ -f /root/.ssh/authorized_keys ]]; then
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /home/$DEPLOY_USER/.ssh
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
fi

echo "==> Daily database backup at 03:15"
cat > /etc/cron.d/tadbeer-backup <<CRON
15 3 * * * $DEPLOY_USER /home/$DEPLOY_USER/tadbeer/deploy/scripts/backup.sh >> /home/$DEPLOY_USER/backup.log 2>&1
CRON

cat <<MSG

Done. Next steps:
  1. su - $DEPLOY_USER
  2. git clone <your repo> tadbeer && cd tadbeer/deploy
  3. cp .env.example .env && nano .env   (fill the secrets)
  4. ./scripts/deploy.sh

Optional (only after you confirmed SSH key login works for $DEPLOY_USER):
  disable password SSH login → set 'PasswordAuthentication no' in /etc/ssh/sshd_config, then: systemctl reload ssh
MSG
