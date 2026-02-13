#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "[ERROR] .env 不存在，请先 cp .env.example .env 并填写配置"
  exit 1
fi

set -a
source .env
set +a

DOMAIN="${DOMAIN:-who-is-spy.online}"
EMAIL="${EMAIL:-}"
RSA_KEY_SIZE=4096
DATA_PATH="./certbot"
STAGING="${LETSENCRYPT_STAGING:-0}"

mkdir -p "$DATA_PATH/conf" "$DATA_PATH/www"

if [[ ! -f "$DATA_PATH/conf/options-ssl-nginx.conf" ]] || [[ ! -f "$DATA_PATH/conf/ssl-dhparams.pem" ]]; then
  echo "[INFO] 下载推荐 TLS 参数..."
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$DATA_PATH/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$DATA_PATH/conf/ssl-dhparams.pem"
fi

echo "[INFO] 为 $DOMAIN 创建临时证书..."
CERT_PATH="/etc/letsencrypt/live/$DOMAIN"
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"

docker compose run --rm --entrypoint "openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 -keyout '$CERT_PATH/privkey.pem' -out '$CERT_PATH/fullchain.pem' -subj '/CN=localhost'" certbot

echo "[INFO] 启动 nginx（带临时证书）..."
docker compose up -d nginx

echo "[INFO] 删除临时证书..."
docker compose run --rm --entrypoint "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

if [[ -z "$EMAIL" ]]; then
  EMAIL_ARG="--register-unsafely-without-email"
else
  EMAIL_ARG="--email $EMAIL"
fi

if [[ "$STAGING" != "0" ]]; then
  STAGING_ARG="--staging"
else
  STAGING_ARG=""
fi

echo "[INFO] 申请 Let's Encrypt 证书..."
docker compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot $STAGING_ARG $EMAIL_ARG -d $DOMAIN --rsa-key-size $RSA_KEY_SIZE --agree-tos --force-renewal --non-interactive" certbot

echo "[INFO] 重载 nginx..."
docker compose exec nginx nginx -s reload

echo "[DONE] 证书初始化完成"
