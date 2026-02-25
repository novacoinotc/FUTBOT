#!/bin/bash
# Deploy ScalpBot to VPS
# Usage: ./deploy.sh

set -e

VPS_HOST="159.65.42.23"
VPS_USER="root"
REMOTE_DIR="/root/scalpbot"
LOCAL_BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== ScalpBot Deploy ==="
echo "Local: $LOCAL_BOT_DIR"
echo "Remote: $VPS_USER@$VPS_HOST:$REMOTE_DIR"
echo ""

# 1. Sync bot files to VPS
echo "[1/5] Syncing files to VPS..."
rsync -avz --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'db/*.db' \
  --exclude 'bot.log' \
  --exclude '.env' \
  "$LOCAL_BOT_DIR/" "$VPS_USER@$VPS_HOST:$REMOTE_DIR/bot/"

# 2. Copy .env if not exists on remote
echo "[2/5] Checking .env..."
ssh "$VPS_USER@$VPS_HOST" "test -f $REMOTE_DIR/bot/.env || echo 'NEEDS_ENV=true'"
# If needed, uncomment:
# scp "$LOCAL_BOT_DIR/.env" "$VPS_USER@$VPS_HOST:$REMOTE_DIR/bot/.env"

# 3. Setup Python venv & install deps on VPS
echo "[3/5] Installing dependencies on VPS..."
ssh "$VPS_USER@$VPS_HOST" "
  cd $REMOTE_DIR
  python3 -m venv .venv 2>/dev/null || true
  source .venv/bin/activate
  pip install --upgrade pip -q
  pip install -r bot/requirements.txt -q
  echo 'Dependencies installed'
"

# 4. Install systemd service
echo "[4/5] Installing systemd service..."
scp "$LOCAL_BOT_DIR/deploy/scalpbot.service" "$VPS_USER@$VPS_HOST:/etc/systemd/system/scalpbot.service"
ssh "$VPS_USER@$VPS_HOST" "
  systemctl daemon-reload
  systemctl enable scalpbot
  systemctl restart scalpbot
  sleep 2
  systemctl status scalpbot --no-pager
"

# 5. Verify API is running
echo "[5/5] Verifying API..."
sleep 3
ssh "$VPS_USER@$VPS_HOST" "curl -s http://localhost:8080/api/status | python3 -m json.tool"

echo ""
echo "=== Deploy Complete ==="
echo "Bot: http://$VPS_HOST:8080/api/status"
echo "Logs: ssh $VPS_USER@$VPS_HOST journalctl -u scalpbot -f"
