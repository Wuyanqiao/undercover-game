# 谁是卧底 - 在线游戏

一个基于 Web 的多人在线"谁是卧底"游戏，支持真人玩家和 AI 玩家混合对战。

## 功能特性

- **4人房间**：固定4个座位，支持2-4名真人玩家
- **AI 补位**：人数不足时自动用 AI 补齐到4人
- **DeepSeek AI**：AI 玩家使用 DeepSeek API 进行智能发言和投票
- **实时同步**：使用 WebSocket 实现游戏状态实时同步
- **响应式设计**：支持手机和电脑浏览器访问
- **HTTPS**：自动 SSL 证书管理

## 技术栈

- **前端**：React + Vite + TypeScript
- **后端**：Node.js + Fastify + Socket.IO
- **数据库**：Redis
- **AI**：DeepSeek API
- **部署**：Docker Compose + Nginx + Let's Encrypt

## 目录结构

```
undercover/
├── docker-compose.yml      # Docker Compose 配置
├── .env.example            # 环境变量示例
├── nginx/
│   └── conf.d/
│       └── app.conf        # Nginx 配置文件
├── certbot/                # SSL 证书目录
├── backend/                # 后端代码
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── config.ts
│       ├── logger.ts
│       ├── redis.ts
│       ├── ai/
│       │   └── client.ts
│       ├── game/
│       │   ├── words.ts
│       │   └── logic.ts
│       ├── socket/
│       │   └── handlers.ts
│       └── types/
│           └── index.ts
├── frontend/               # 前端代码
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── store/
│       │   └── gameStore.ts
│       └── pages/
│           ├── HomePage.tsx
│           ├── HomePage.css
│           ├── RoomPage.tsx
│           └── RoomPage.css
├── scripts/
│   ├── init-letsencrypt.sh # SSL 证书初始化脚本
│   └── deploy.sh           # 部署脚本
└── README.md
```

## 快速开始

### 1. 服务器准备

确保你有一台 Ubuntu 22.04 服务器，配置要求：
- CPU：2核
- 内存：2GB
- 磁盘：20GB+
- 公网 IP

安装 Docker 和 Docker Compose：

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Docker
sudo apt install -y docker.io
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER

# 安装 Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 重新登录以使 docker 组生效
newgrp docker
```

### 2. 配置 DNS

在你的域名提供商处添加 A 记录：

```
主机记录: @
记录类型: A
记录值: <你的服务器公网IP>
```

等待 DNS 生效（通常需要几分钟到几小时）。

### 3. 部署项目

```bash
# 克隆项目（或上传项目文件到服务器）
cd ~
# 如果通过 git 克隆
git clone <你的仓库地址>
cd undercover

# 或者手动上传项目后
cd ~/undercover

# 复制环境变量配置
cp .env.example .env

# 编辑 .env 文件，填写必要的环境变量
nano .env
```

编辑 `.env` 文件：

```env
# 域名配置
DOMAIN=who-is-spy.online
EMAIL=jiujiangzhie@qq.com

# DeepSeek AI 配置
DEEPSEEK_API_KEY=sk-ef3b48bedcda4b53bb74da5fcc34176b
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# Redis 配置（保持默认即可）
REDIS_URL=redis://redis:6379

# 后端配置
NODE_ENV=production
PORT=3000

# 游戏配置
MAX_ROOMS=3
MAX_AI_CONCURRENT=2

# JWT 密钥（请务必修改为一个随机字符串）
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

### 4. 申请 SSL 证书

```bash
# 首次运行证书申请脚本
./scripts/init-letsencrypt.sh
```

脚本会自动：
1. 创建临时证书启动 Nginx
2. 申请 Let's Encrypt 证书
3. 重新加载 Nginx 配置

**注意**：证书申请需要域名已经解析到服务器 IP。

### 5. 启动服务

```bash
# 使用部署脚本启动
docker compose up -d --build

# 或者使用一键部署脚本
./scripts/deploy.sh
```

### 6. 验证部署

```bash
# 检查容器状态
docker compose ps

# 查看后端日志
docker compose logs -f backend

# 查看 Nginx 日志
docker compose logs -f nginx

# 测试健康检查接口
curl https://who-is-spy.online/api/health
```

## 游戏玩法

### 创建房间

1. 访问 https://who-is-spy.online
2. 输入你的昵称
3. 点击"创建房间"
4. 将房间号分享给朋友

### 加入房间

1. 访问 https://who-is-spy.online
2. 输入你的昵称
3. 输入房间号（6位字母数字）
4. 点击"加入房间"

### 开始游戏

1. 房主点击"开始游戏"
2. 系统会自动用 AI 补齐到4人（如果真人不足4人）
3. 游戏开始，查看你的身份和词

### 游戏规则

1. **角色分配**：3个平民 + 1个卧底
2. **平民**：看到相同的词（平民词）
3. **卧底**：看到不同的词（卧底词）
4. **发言阶段**：按座位顺序依次发言，每人限时30秒
5. **投票阶段**：投票淘汰最可疑的玩家，限时20秒
6. **胜负判定**：
   - 卧底被淘汰 → 平民获胜
   - 卧底存活且存活卧底数 ≥ 存活平民数 → 卧底获胜

## 管理操作

### 查看日志

```bash
# 查看所有日志
docker compose logs

# 查看后端实时日志
docker compose logs -f backend

# 查看前端日志
docker compose logs -f frontend

# 查看 Nginx 访问日志
docker compose logs -f nginx
```

### 重启服务

```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart backend
```

### 更新部署

```bash
# 拉取最新代码并重新部署
./scripts/deploy.sh
```

### 停止服务

```bash
# 停止所有服务
docker compose down

# 停止并删除数据卷（慎用）
docker compose down -v
```

## 常见问题

### Q: 无法访问网站

1. 检查防火墙是否开放 80/443 端口：
   ```bash
   sudo ufw status
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

2. 检查 Docker 容器状态：
   ```bash
   docker compose ps
   ```

3. 检查 Nginx 日志：
   ```bash
   docker compose logs nginx
   ```

### Q: SSL 证书申请失败

1. 确保域名已正确解析到服务器 IP
2. 检查 80 端口是否被占用：
   ```bash
   sudo netstat -tlnp | grep :80
   ```
3. 重新运行证书申请脚本

### Q: WebSocket 连接失败

1. 检查 Nginx 配置中的 WebSocket 代理设置
2. 确保防火墙允许 WebSocket 连接
3. 检查浏览器开发者工具中的网络请求

### Q: AI 不工作

1. 检查 DeepSeek API Key 是否正确配置
2. 查看后端日志中的 AI 调用错误：
   ```bash
   docker compose logs -f backend | grep -i "ai\|deepseek"
   ```
3. 检查网络是否能访问 DeepSeek API

### Q: Redis 连接失败

1. 检查 Redis 容器状态：
   ```bash
   docker compose ps redis
   ```
2. 查看 Redis 日志：
   ```bash
   docker compose logs redis
   ```

## 性能调优

### 调整 AI 并发数

在 `.env` 文件中修改：
```env
MAX_AI_CONCURRENT=2  # 根据服务器性能调整
```

### 调整房间上限

在 `.env` 文件中修改：
```env
MAX_ROOMS=3  # 根据服务器性能调整
```

## 安全建议

1. **修改 JWT_SECRET**：生产环境务必修改为随机长字符串
2. **定期更新依赖**：运行 `npm audit` 检查漏洞
3. **限制 IP 访问**：可以通过防火墙限制管理接口访问
4. **启用日志监控**：配置日志收集和分析系统

## 备份与恢复

### 备份 Redis 数据

```bash
# 导出 Redis 数据
docker compose exec redis redis-cli BGSAVE
docker cp undercover-redis:/data/dump.rdb ./backup/redis-backup.rdb
```

### 恢复 Redis 数据

```bash
# 停止服务
docker compose down

# 恢复数据文件
cp ./backup/redis-backup.rdb ./redis-data/dump.rdb

# 启动服务
docker compose up -d
```

## 开发调试

### 本地开发

```bash
# 后端
cd backend
npm install
npm run dev

# 前端
cd frontend
npm install
npm run dev
```

### 测试 AI 功能

```bash
# 检查 AI 连接
curl -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## 协议与许可

本项目仅供学习和娱乐使用。

## 技术支持

如有问题，请通过以下方式联系：
- 邮箱：jiujiangzhie@qq.com
- 项目地址：https://github.com/yourusername/undercover

## 更新日志

### v1.0.0 (2024-XX-XX)
- 初始版本发布
- 支持 4 人房间和 AI 补位
- 集成 DeepSeek AI
- 实现完整的游戏流程
