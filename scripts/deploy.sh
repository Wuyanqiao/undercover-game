#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "[INFO] 开始部署"

if [[ -d .git ]]; then
  echo "[INFO] 检测到 git 仓库，尝试拉取最新代码"
  git pull --rebase || echo "[WARN] git pull 失败，请手动处理冲突后重试"
fi

if [[ -d .git ]]; then
  APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
else
  APP_VERSION="dev"
fi
export APP_VERSION
echo "[INFO] 使用版本指纹 APP_VERSION=$APP_VERSION"

echo "[INFO] 构建并启动容器"
docker compose up -d --build --remove-orphans

echo "[INFO] 等待后端健康检查"
for i in {1..20}; do
  if docker compose exec -T backend node -e "fetch('http://localhost:3000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"; then
    echo "[DONE] 部署完成，后端健康检查通过"
    exit 0
  fi
  sleep 2
done

echo "[ERROR] 后端健康检查失败，请查看日志"
docker compose logs --tail=200 backend
exit 1
