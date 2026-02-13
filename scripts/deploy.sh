#!/bin/bash

# 部署脚本
# 使用方法: ./scripts/deploy.sh

set -e

echo "=== 开始部署 ==="

# 拉取最新代码（如果在 git 仓库中）
if [ -d ".git" ]; then
  echo "正在拉取最新代码..."
  git pull origin main || echo "未配置 git 远程仓库，跳过拉取"
fi

# 重建并启动容器
echo "正在构建并启动容器..."
docker compose down
docker compose up -d --build

# 等待服务启动
echo "等待服务启动..."
sleep 5

# 检查健康状态
echo "检查服务健康状态..."
if curl -s http://localhost/api/health | grep -q "OK"; then
  echo "✓ 后端服务运行正常"
else
  echo "✗ 后端服务可能未启动，请检查日志"
  docker compose logs backend
fi

echo ""
echo "=== 部署完成 ==="
echo "网站地址: https://who-is-spy.online"
echo ""
echo "查看日志命令:"
echo "  docker compose logs -f backend    # 查看后端日志"
echo "  docker compose logs -f nginx      # 查看 Nginx 日志"
echo ""
