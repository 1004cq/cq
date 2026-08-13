# CQIM 与 PYQ 朋友圈外链融合部署文档

本文档详细说明了如何将 `cqim`（即时通讯系统）与 `pyq`（外链朋友圈系统）进行融合部署，实现两个独立系统的动态互通与统一管理。

## 1. 架构说明

`cqim` 和 `pyq` 是两个技术栈完全不同的独立项目，为了保证系统的稳定性和可维护性，我们采用了 **HTTP API 代理桥接** 的融合架构，而非强行合并代码库。

### 1.1 技术栈对比

| 维度 | CQIM (主系统) | PYQ (外链朋友圈系统) |
|------|--------------|----------------------|
| **前端框架** | React 18 + Vite + TailwindCSS | Next.js 15 (App Router) + TailwindCSS |
| **后端框架** | Express.js (Node.js) | Next.js API Routes (Serverless) |
| **数据库** | 内存存储 (可扩展为 Redis/MongoDB) | MySQL 8.0 + Prisma ORM |
| **认证机制** | 自定义 JWT (Bearer Token) | NextAuth.js v5 (Cookie-based) |
| **运行端口** | 默认 `3000` | 默认 `3001` |

### 1.2 融合机制

1. **独立运行**：两个项目在服务器上分别占用不同的端口独立运行（如 CQIM 运行在 3000，PYQ 运行在 3001）。
2. **统一管理**：CQIM 的管理后台新增了「外链朋友圈」模块，管理员在此配置 PYQ 的服务地址和 Admin Token。CQIM 后端会将所有管理操作（如封禁用户、删除动态、修改配置）通过 HTTP 代理转发到 PYQ 的真实 API。
3. **动态同步**：当用户在 CQIM 中发布朋友圈动态时，如果开启了同步开关，CQIM 后端会自动调用 PYQ 的发布接口，将动态内容和图片同步到 PYQ 数据库中。
4. **专属外链**：CQIM 为每个用户生成了专属的外链地址格式 `https://cqim.example.com/q/{userId}`，访问该链接即可查看该用户在 CQIM 中的公开动态。

---

## 2. 部署方式

由于两个项目需要同时运行，推荐使用 **PM2** 或 **Docker Compose** 进行部署。以下以 PM2 为例说明部署步骤。

### 2.1 环境准备

- Node.js >= 18.17.0
- MySQL >= 8.0 (仅 PYQ 需要)
- PM2 (`npm install -g pm2`)
- Nginx (用于反向代理和配置域名)

### 2.2 部署 PYQ (外链朋友圈系统)

1. **克隆代码并安装依赖**
   ```bash
   git clone https://github.com/1004cq/pyq.git
   cd pyq
   npm install
   ```

2. **配置环境变量**
   复制 `.env.example` 为 `.env`，并修改数据库连接和其他配置：
   ```env
   DATABASE_URL="mysql://root:password@localhost:3306/pyq_db"
   NEXTAUTH_SECRET="your-super-secret-key-min-32-chars"
   NEXTAUTH_URL="https://pyq.example.com"
   ```

3. **初始化数据库**
   ```bash
   npx prisma db push
   npx prisma generate
   ```

4. **构建并启动**
   ```bash
   npm run build
   pm2 start ecosystem.config.js --env production
   ```
   *注：PYQ 默认运行在 3001 端口。*

### 2.3 部署 CQIM (主系统)

1. **克隆代码并安装依赖**
   ```bash
   git clone https://github.com/1004cq/cqim.git
   cd cqim
   npm install
   cd client && npm install && cd ..
   ```

2. **构建前端**
   ```bash
   cd client
   npm run build
   cd ..
   ```

3. **启动后端服务**
   ```bash
   NODE_ENV=production pm2 start dist/index.js --name "cqim-server"
   ```
   *注：CQIM 默认运行在 3000 端口。*

### 2.4 Nginx 反向代理配置

在 Nginx 中为两个系统配置不同的域名（或同一域名的不同路径）：

```nginx
# CQIM 主系统配置
server {
    listen 80;
    server_name cqim.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# PYQ 外链系统配置
server {
    listen 80;
    server_name pyq.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 3. 融合配置要点

部署完成后，需要进行以下配置才能实现两个系统的互通。

### 3.1 获取 PYQ Admin Token

1. 访问 PYQ 的管理后台（如 `https://pyq.example.com/admin/login`）。
2. 使用管理员账号登录（默认账号：`admin`，密码：`admin123`）。
3. 登录成功后，打开浏览器的开发者工具 (F12) -> Application (应用) -> Cookies。
4. 找到名为 `admin_token` 的 Cookie，复制其值。

### 3.2 在 CQIM 中配置同步

1. 访问 CQIM 的管理后台（如 `https://cqim.example.com/admin`）。
2. 使用管理员账号登录。
3. 在左侧导航栏点击「**外链朋友圈**」图标（绿色的 Rss 图标）。
4. 切换到「**同步配置**」Tab。
5. 填写以下信息：
   - **PYQ 服务地址**：填写 PYQ 的访问域名（如 `https://pyq.example.com`）。
   - **Admin Token**：粘贴刚才复制的 `admin_token` 值。
   - **开启同步**：勾选「发布动态时自动同步到 PYQ」。
6. 点击「**测试连接**」按钮，如果提示“连接成功！pyq 服务正常，Token 有效”，则说明配置正确。
7. 点击「**保存配置**」。

### 3.3 验证融合功能

1. **管理功能验证**：在 CQIM 的「外链朋友圈」面板中，切换到「仪表盘」或「用户管理」，确认能正常读取到 PYQ 的数据。
2. **同步功能验证**：在 CQIM 前端发布一条朋友圈动态，然后访问 PYQ 的首页，确认该动态已成功同步显示。
3. **专属外链验证**：在 CQIM 管理后台的「用户管理」列表中，点击某个用户的「复制外链」按钮，在浏览器中打开该链接（如 `https://cqim.example.com/q/u1`），确认能正常看到该用户的专属朋友圈页面。

---

## 4. 常见问题排查

- **测试连接提示 Token 无效**：PYQ 的 `admin_token` 可能会过期，请重新登录 PYQ 后台获取最新的 Token 并更新到 CQIM 中。
- **动态同步失败**：检查 CQIM 服务器是否能正常访问 PYQ 的域名；检查 PYQ 的 `/api/posts` 接口是否正常工作。
- **图片无法显示**：如果使用了 COS 云存储，请确保在 PYQ 和 CQIM 中都正确配置了 COS 的访问域名和跨域规则 (CORS)。
