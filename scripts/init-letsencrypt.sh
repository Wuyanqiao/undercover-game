#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "[ERROR] .env 不存在，请先执行: cp .env.example .env"
  exit 1
fi

set -a
source .env
set +a

DOMAIN="${DOMAIN:-who-is-spy.online}"
EMAIL="${EMAIL:-}"
STAGING="${LETSENCRYPT_STAGING:-0}"
RSA_KEY_SIZE=4096

DATA_PATH="./certbot"
CONF_PATH="$DATA_PATH/conf"
WEBROOT_PATH="$DATA_PATH/www"

mkdir -p "$CONF_PATH" "$WEBROOT_PATH"

echo "[INFO] DOMAIN=$DOMAIN"

if [[ ! -f "$CONF_PATH/options-ssl-nginx.conf" ]] || [[ ! -f "$CONF_PATH/ssl-dhparams.pem" ]]; then
  echo "[INFO] 下载推荐 TLS 参数..."
  curl -fsSL "https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf" -o "$CONF_PATH/options-ssl-nginx.conf"
  curl -fsSL "https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem" -o "$CONF_PATH/ssl-dhparams.pem"
fi

LIVE_PATH="$CONF_PATH/live/$DOMAIN"
HAS_CERT=0
if [[ -f "$LIVE_PATH/fullchain.pem" ]] && [[ -f "$LIVE_PATH/privkey.pem" ]]; then
  HAS_CERT=1
fi

if [[ "$HAS_CERT" -eq 0 ]]; then
  echo "[INFO] 首次签发，创建临时证书以拉起 nginx ..."
  CERT_PATH="/etc/letsencrypt/live/$DOMAIN"
  mkdir -p "$LIVE_PATH"
  docker compose run --rm --entrypoint "openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 -keyout '$CERT_PATH/privkey.pem' -out '$CERT_PATH/fullchain.pem' -subj '/CN=localhost'" certbot
fi

echo "[INFO] 启动 nginx ..."
docker compose up -d nginx

CHALLENGE_TOKEN="acme-selfcheck-$(date +%s)-$RANDOM"
CHALLENGE_DIR="$WEBROOT_PATH/.well-known/acme-challenge"
CHALLENGE_FILE="$CHALLENGE_DIR/$CHALLENGE_TOKEN"
mkdir -p "$CHALLENGE_DIR"
printf "%s" "$CHALLENGE_TOKEN" > "$CHALLENGE_FILE"

echo "[INFO] 自检 challenge 路由（本机 Host 头）..."
LOCAL_CHECK="$(curl -fsS -H "Host: $DOMAIN" "http://127.0.0.1/.well-known/acme-challenge/$CHALLENGE_TOKEN" || true)"
if [[ "$LOCAL_CHECK" != "$CHALLENGE_TOKEN" ]]; then
  echo "[ERROR] challenge 本机校验失败，请检查 nginx location /.well-known/acme-challenge/ 配置"
  rm -f "$CHALLENGE_FILE"
  exit 1
fi

echo "[INFO] 自检 challenge 路由（公网域名）..."
PUBLIC_CHECK="$(curl -fsS "http://$DOMAIN/.well-known/acme-challenge/$CHALLENGE_TOKEN" || true)"
if [[ "$PUBLIC_CHECK" != "$CHALLENGE_TOKEN" ]]; then
  echo "[ERROR] challenge 公网校验失败。请检查："
  echo "        1) DNS A 记录是否指向当前服务器"
  echo "        2) 80 端口是否放通（安全组/防火墙）"
  rm -f "$CHALLENGE_FILE"
  exit 1
fi
rm -f "$CHALLENGE_FILE"

if [[ "$HAS_CERT" -eq 0 ]]; then
  echo "[INFO] 删除临时证书..."
  docker compose run --rm --entrypoint "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf" certbot
fi

if [[ -n "$EMAIL" ]]; then
  EMAIL_ARG=(--email "$EMAIL")
else
  EMAIL_ARG=(--register-unsafely-without-email)
fi

STAGING_ARG=()
if [[ "$STAGING" != "0" ]]; then
  STAGING_ARG=(--staging)
  echo "[WARN] 当前使用 Let's Encrypt staging 环境（测试证书）"
fi

echo "[INFO] 申请 Let's Encrypt 证书..."
docker compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot -d $DOMAIN ${EMAIL_ARG[*]} ${STAGING_ARG[*]} --agree-tos --non-interactive --rsa-key-size $RSA_KEY_SIZE" certbot

echo "[INFO] 重载 nginx ..."
docker compose exec nginx nginx -s reload

echo "[DONE] 证书初始化完成"
