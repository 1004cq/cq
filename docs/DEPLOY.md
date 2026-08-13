# CQIM 部署文档

> 版本：v3.0（cqim + pyq 合并版）  
> 数据库：SQLite（Prisma ORM）  
> 架构：单体应用，无外部依赖

---

## 一、项目架构

```
cqim/
├── server/           # Express 后端
│   ├── index.ts      # 主入口，WebSocket + HTTP 路由
│   ├── admin.ts      # 管理后台 API（Prisma 版）
│   ├── moments.ts    # 朋友圈 API（Prisma 版）
│   ├── db.ts         # Prisma 客户端 + 数据库初始化
│   └── pyq-admin.ts  # 占位（已整合到 admin.ts）
├── client/           # Vite + React 前端
│   └── src/
│       ├── pages/AdminPage.tsx     # 管理后台（10 个模块）
│       ├── pages/MomentsPage.tsx   # 朋友圈主页
│       └── pages/MomentsSharePage.tsx  # 外链朋友圈页
├── prisma/
│   ├── schema.prisma # 数据库模型（17 张表）
│   └── data/         # SQLite 数据库文件（运行时生成）
├── dist/             # 构建产物（运行时生成）
└── docs/             # 文档
```

### 数据库模型一览

| 模型 | 说明 |
|------|------|
| `User` | 应用用户（含封禁、角色字段） |
| `UserSession` | 用户登录 Session |
| `Moment` | 朋友圈动态（含置顶、可见范围、话题） |
| `MomentMedia` | 动态附件（图片/视频） |
| `MomentComment` | 评论（支持嵌套回复） |
| `MomentLike` | 点赞（唯一约束） |
| `MediaFile` | 媒体文件记录（COS 存储） |
| `AdminAccount` | 管理员账号 |
| `AdminSession` | 管理员 Session |
| `AdminLog` | 管理员操作日志 |
| `LoginLog` | 用户登录日志 |
| `IpBlacklist` | IP 黑名单 |
| `IllegalRequest` | 非法请求记录 |
| `SystemConfig` | 系统配置 KV 表（SMTP/COS/站点/AI 等） |
| `Announcement` | 系统公告 |
| `SensitiveWord` | 敏感词库 |
| `Report` | 举报记录 |
| `CustomPage` | 自定义外链页面（/p/:slug） |

---

## 二、快速部署（推荐：PM2 + Nginx）

### 1. 环境要求

| 依赖 | 版本要求 |
|------|---------|
| Node.js | ≥ 18.x |
| pnpm | ≥ 8.x |
| Nginx | ≥ 1.20 |
| PM2 | ≥ 5.x |

```bash
# 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt install -y nodejs

# 安装 pnpm 和 PM2
npm install -g pnpm pm2
```

### 2. 克隆并构建

```bash
# 克隆项目
git clone https://github.com/1004cq/cqim.git
cd cqim

# 安装依赖
pnpm install

# 构建前端
cd client && pnpm build && cd ..

# 生成 Prisma Client（首次部署必须执行）
npx prisma generate

# 创建数据库目录
mkdir -p prisma/data
```

### 3. 环境变量配置

```bash
# 创建 .env 文件
cat > .env << 'EOF'
# 数据库路径（SQLite，相对于项目根目录）
DATABASE_URL="file:./prisma/data/cqim.db"

# 服务端口（可选，默认 3000）
PORT=3000

# 运行环境
NODE_ENV=production

# OpenAI API Key（AI 聊天功能，可选）
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
EOF
```

### 4. PM2 启动配置

```bash
# 创建 ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'cqim',
    script: 'dist/index.js',
    cwd: '/path/to/cqim',   // ← 修改为实际路径
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
  }]
};
EOF

# 创建日志目录
mkdir -p logs

# 启动
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # 设置开机自启
```

### 5. Nginx 反向代理

```nginx
# /etc/nginx/sites-available/cqim
server {
    listen 80;
    server_name your-domain.com;   # ← 修改为实际域名
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;   # ← 修改为实际域名

    # SSL 证书（Let's Encrypt 或其他）
    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # 安全头
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # 文件上传大小限制
    client_max_body_size 50M;

    # WebSocket 代理（实时通信）
    location /signal {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    # OneBot WebSocket
    location /onebot/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    # HTTP API 代理
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# 启用配置
sudo ln -s /etc/nginx/sites-available/cqim /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 三、首次启动说明

首次启动时，`initDatabase()` 会自动执行以下初始化：

1. 创建所有数据库表（Prisma db push）
2. 创建默认超级管理员账号：`admin` / `admin123`
3. 初始化默认系统配置（SMTP、COS、站点信息、AI 配置、邮件模板）
4. 创建默认公告和敏感词

**⚠️ 首次登录后请立即修改管理员密码！**

---

## 四、管理后台功能

访问 `https://your-domain.com/admin`，使用 `admin` / `admin123` 登录。

| 模块 | 路径 | 说明 |
|------|------|------|
| 仪表盘 | 默认 | 用户数、动态数、媒体数等统计 |
| 用户管理 | 用户 | 搜索、封禁/解封、删除 |
| 动态管理 | 动态 | 搜索、置顶、批量删除 |
| 媒体管理 | 媒体 | 图片/视频网格展示 |
| 站点设置 | 外链朋友圈 → 站点设置 | 站点名称、备案号、注册开关等 |
| 云存储配置 | 外链朋友圈 → 云存储配置 | 腾讯云 COS 配置 |
| 登录日志 | 外链朋友圈 → 登录日志 | 查看/清空登录记录 |
| IP 黑名单 | 外链朋友圈 → IP 黑名单 | 添加/移除封禁 IP |
| 非法请求 | 外链朋友圈 → 非法请求 | 查看/清空异常请求 |
| SMTP 配置 | 邮箱配置 | 邮件服务器、模板管理 |
| OneBot 配置 | OneBot 配置 | AstrBot 接入配置 |
| 自定义外链页面 | 外链朋友圈 → 自定义页面 | 创建 /p/:slug 外链页面 |

---

## 五、外链朋友圈功能

### 用户专属外链

每个用户都有专属的朋友圈外链：

```
https://your-domain.com/q/{userId}
```

例如：`https://wed.imim.chat/q/user123`

该页面无需登录即可访问，展示该用户的所有公开动态。

### 自定义外链页面

在管理后台创建自定义页面后，可通过以下路径访问：

```
https://your-domain.com/p/{slug}
```

---

## 六、数据备份

SQLite 数据库文件位于 `prisma/data/cqim.db`，定期备份此文件即可。

```bash
# 手动备份
cp prisma/data/cqim.db backups/cqim-$(date +%Y%m%d-%H%M%S).db

# 定时备份（crontab）
# 每天凌晨 3 点备份，保留 30 天
0 3 * * * cp /path/to/cqim/prisma/data/cqim.db /path/to/backups/cqim-$(date +\%Y\%m\%d).db && find /path/to/backups -name "cqim-*.db" -mtime +30 -delete
```

---

## 七、更新部署

```bash
cd /path/to/cqim

# 拉取最新代码
git pull

# 安装新依赖（如有）
pnpm install

# 重新构建前端
cd client && pnpm build && cd ..

# 重新生成 Prisma Client（如 schema 有变更）
npx prisma generate

# 重启服务
pm2 restart cqim
```

---

## 八、常见问题

**Q: 启动报错 `Cannot find module '@prisma/client'`**  
A: 执行 `npx prisma generate` 重新生成 Prisma Client。

**Q: 数据库文件不存在**  
A: 确保 `prisma/data/` 目录存在，服务启动时会自动创建数据库文件。

**Q: 管理员密码忘记**  
A: 删除数据库文件 `prisma/data/cqim.db` 后重启服务，会重新初始化默认账号。或通过 SQLite 命令行工具直接修改密码哈希值。

**Q: WebSocket 连接失败**  
A: 检查 Nginx 配置中 `/signal` 路径的 WebSocket 代理设置，确保 `Upgrade` 和 `Connection` 头已正确配置。

**Q: 朋友圈图片不显示**  
A: 需要配置腾讯云 COS 存储，在管理后台「外链朋友圈 → 云存储配置」中填写 SecretId、SecretKey、存储桶和地域。
