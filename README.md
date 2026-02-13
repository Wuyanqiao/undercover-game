# 谁是卧底（Undercover Game）

在线版“谁是卧底”网页游戏，支持 2/3/4 真人 + AI 自动补位到 4 座，适配手机和桌面浏览器。

已按 Ubuntu 22.04 + 2核2G 服务器部署场景设计，支持 `docker compose up -d --build` 一键启动。

## 核心能力

- 固定 4 座位（Seat1~Seat4），真人不足自动补 AI
- 无登录系统，游客昵称即可进入
- 最多同时 3 个活跃房间
- Redis 存储房间状态、限流与重连令牌
- Fastify + Socket.IO 实时同步发言/投票/淘汰/结算
- DeepSeek API 后端接入（含超时、重试、降级）
- Nginx + Certbot 提供 HTTPS（Let's Encrypt）

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：Node.js + TypeScript + Fastify + Socket.IO
- 状态：Redis
- 反向代理/TLS：Nginx + Certbot
- 编排：Docker Compose

## 目录结构

```text
undercover/
  docker-compose.yml
  .env.example
  nginx/
    conf.d/app.conf
  certbot/
  backend/
    Dockerfile
    package.json
    src/...
  frontend/
    Dockerfile
    package.json
    src/...
  scripts/
    deploy.sh
    init-letsencrypt.sh
  README.md
```

## 1) 服务器准备（Ubuntu 22.04）

安装 Docker 与 Compose Plugin：

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin curl
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

重新登录终端后生效。

## 2) DNS 配置

你的域名：`who-is-spy.online`

请在域名服务商处配置 A 记录：

- 主机记录：`@`
- 记录类型：`A`
- 记录值：你的服务器公网 IP

等待解析生效后再申请证书。

## 3) 环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
DOMAIN=who-is-spy.online
EMAIL=jiujiangzhie@qq.com

DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

REDIS_URL=redis://redis:6379
NODE_ENV=production
PORT=3000

MAX_ROOMS=3
MAX_AI_CONCURRENT=2
ROOM_TIMEOUT_MINUTES=10
SPEECH_TIMEOUT_SECONDS=30
VOTE_TIMEOUT_SECONDS=20
TIEBREAK_TIMEOUT_SECONDS=15

JWT_SECRET=change-this-to-a-random-long-secret
```

## 4) 首次申请 HTTPS 证书

```bash
chmod +x scripts/init-letsencrypt.sh scripts/deploy.sh
./scripts/init-letsencrypt.sh
```

脚本会：

- 读取 `.env` 的 `DOMAIN/EMAIL`
- 创建临时证书拉起 Nginx
- 调用 Certbot 正式签发
- 重载 Nginx

## 5) 启动服务

```bash
docker compose up -d --build
```

访问：`https://who-is-spy.online`

健康检查：

```bash
curl -k https://who-is-spy.online/api/health
```

## 6) 更新部署

```bash
./scripts/deploy.sh
```

该脚本会执行：

- `git pull --rebase`（如果目录是 git 仓库）
- `docker compose up -d --build --remove-orphans`
- 后端健康检查

## 7) 游戏状态机与规则

状态流转：

`LOBBY -> DEAL -> SPEAKING -> VOTING -> RESOLVE -> ... -> END`

规则实现：

- 房间固定 4 座，开始时真人不足自动补 AI
- 至少 2 名真人才能开始
- 角色固定：1 卧底 + 3 平民
- 发言阶段：按存活座位顺序，每人 30 秒
  - 超时自动发言：`（超时）`
  - AI 回合由后端驱动生成发言
- 投票阶段：所有存活玩家 20 秒内投票
  - 超时默认策略：**弃权（0）**
  - AI 投票由后端驱动（失败自动降级）
- 真人中途离开：
  - 断线可用 `resumeToken` 重连恢复控制权
  - 对局进行中主动离开时，该座位转为 AI 接管，保证流程继续
- 平票处理：
  - 第一次平票 -> 加赛投票 15 秒（仅平票候选可被投）
  - 仍平票 -> 在平票候选中随机淘汰 1 人
- 胜负判断：
  - 卧底出局 -> 平民胜
  - 存活卧底数 >= 存活平民数 -> 卧底胜

房间生命周期：

- 同时最多 3 个活跃房间
- 最后一个真人离开后 10 分钟自动销毁

## 8) DeepSeek AI 接入说明

后端 AI 模块：`backend/src/ai/client.ts`

- API Key 仅后端读取（前端不可见）
- 请求超时 8 秒
- 最多重试 1 次
- 全局并发上限：`MAX_AI_CONCURRENT`（默认 2）
- JSON 强约束校验：
  - 发言：`{"speech":"...<=30字"}`
  - 投票：`{"vote":0|1|2|3|4}`
- base_url 或 key 不可用时自动降级模板，不阻塞游戏

安全可见性控制（Prompt）：

- AI 仅看到：自己的身份、自己的词、公共发言、存活座位、轮次、座位号
- 不会收到全局角色表或全局词分配

## 9) Socket.IO 事件协议

客户端 -> 服务端：

- `room:create { nickname }`
- `room:join { roomId, nickname }`
- `room:leave {}`
- `game:start {}`
- `game:speak { text }`
- `game:vote { toSeat }`
- `game:ping {}`

服务端 -> 客户端：

- `room:state { ...visibleSnapshot }`
- `room:error { message, code }`
- `game:phase { phase, round, deadlineTs }`
- `game:speech { seat, text, round }`
- `game:vote:result { tally, eliminatedSeat, round, tie, tieBreak }`
- `game:end { winner, reveal }`

重连恢复：

- `room:joined` 会下发 `resumeToken`（保存在浏览器）
- Socket 重连后自动 `room:resume { token }`
- 同一 token 仅允许一个连接在线，后恢复者会挤下旧连接

## 10) 邀请链接

使用 Hash 路由，可直接分享：

- `https://who-is-spy.online/#/room/ROOMID`

接收者打开后输入昵称即可加入。

## 11) 常用运维命令

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f nginx
docker compose restart backend
docker compose down
```

## 12) 常见问题排查

1. 证书申请失败

- 检查 A 记录是否生效
- 确保 80/443 端口开放
- 重新执行 `./scripts/init-letsencrypt.sh`

2. 页面能开但 WS 连不上

- 检查 `nginx/conf.d/app.conf` 中 `/socket.io/` 反代
- 查看 `docker compose logs -f nginx backend`

3. AI 不发言/不投票

- 检查 `.env` 中 `DEEPSEEK_*`
- 查看后端日志是否进入 fallback（这是容错设计，游戏仍可继续）

4. 无法创建新房间

- 已达到活跃房间上限 3
- 等待房间结束/销毁，或主动离开空房

## 13) 最小 e2e 自测（2 人 + 2 AI）

1. 浏览器 A 打开首页，输入昵称，创建房间
2. 浏览器 B 打开首页，输入昵称，加入同房间
3. 房主点击开始，观察座位自动补齐 2 个 AI
4. 完整走一局：发言 -> 投票 -> 淘汰 -> 胜负揭示
5. 断开一个浏览器网络再恢复，确认可自动恢复房间状态

---

如果你按本文执行：

- 配置 DNS A 记录
- 正确填写 `.env`
- 先跑 `scripts/init-letsencrypt.sh`
- 再跑 `docker compose up -d --build`

即可通过 `https://who-is-spy.online` 访问并完成完整对局。
