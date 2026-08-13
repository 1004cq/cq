# imimchat 系统架构说明

**中文版** | [English Version](./architecture_en.md)

## 1. 整体架构

imimchat 是一套基于开源框架私有化部署的即时通讯系统，采用 **Docker Compose 容器化部署**，通过 **Nginx 反向代理**统一对外提供服务。

### 1.1 技术栈

| 层次 | 组件 | 版本 | 说明 |
|------|------|------|------|
| 通讯引擎 | WuKongIM | v2 | 高性能 IM 消息引擎，支持 TCP/WebSocket |
| 业务服务 | TangSengDaoDao Server | v1.5 | Go 语言编写的 IM 业务 API 服务 |
| Web 前端 | TangSengDaoDao Web | latest | React 预编译 SPA 应用 |
| 管理后台 | TangSengDaoDao Manager | latest | Vue 预编译管理后台 |
| 数据库 | MySQL | 8.0.33 | 用户、消息、频道等业务数据 |
| 缓存 | Redis | 7.2.3 | 会话缓存、Token 存储 |
| 文件存储 | MinIO | 2023-07-18 | S3 兼容的对象存储，用于图片/文件 |
| 反向代理 | Nginx | 1.18+ | SSL 终止、路由分发、WebSocket 代理 |

### 1.2 服务器信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 42.194.167.201 |
| 云服务商 | 腾讯云 |
| 操作系统 | Ubuntu 22.04 LTS (x86_64) |
| 内核版本 | 6.8.0-101-generic |
| Docker 版本 | 29.3.1 |
| 磁盘使用 | 13GB / 40GB (35%) |
| 内存 | 3.6GB 总量，约 1.4GB 使用中 |

---

## 2. 网络架构

### 2.1 端口映射

```
外网端口    →    服务
─────────────────────────────────────────
80 (HTTP)   →    Nginx（重定向到 HTTPS）
443 (HTTPS) →    Nginx（主入口）
5100        →    WuKongIM TCP 长连接（移动端原生 App 使用）
5200        →    WuKongIM WebSocket（Web 端使用，经 Nginx /ws 代理）

内网端口（仅容器间通信）
─────────────────────────────────────────
82          →    tangsengdaodaoweb（Web 前端）
83          →    tangsengdaodaomanager（管理后台）
8090        →    tangsengdaodaoserver（业务 API）
5001        →    wukongim HTTP API（仅内网）
5300        →    wukongim 监控端口
3306        →    MySQL（仅容器内网）
6379        →    Redis（仅容器内网）
9000        →    MinIO API
9001        →    MinIO 控制台
127.0.0.1:8306 → Adminer（MySQL Web 管理，仅本机访问）
```

### 2.2 Nginx 路由规则

| 请求路径 | 代理目标 | 说明 |
|----------|----------|------|
| `/` | `127.0.0.1:82` | Web 前端（React SPA） |
| `/v1/` | `127.0.0.1:8090/v1/` | 业务 API（直接代理） |
| `/api/` | `127.0.0.1:8090/` | 业务 API（别名） |
| `/ws` | `127.0.0.1:5200` | WebSocket 长连接 |
| `/admin` | `127.0.0.1:83/` | 管理后台（含路径重写） |
| `/admin/static/` | `127.0.0.1:83/static/` | 管理后台静态资源 |

---

## 3. 数据流

### 3.1 用户登录流程

```
用户输入手机号+密码
    │
    ▼
前端 imim_adaptive.js 拦截 XHR 请求
    │  修正 username 格式：0086xxxxxxx → 86xxxxxxx
    ▼
POST /v1/user/login → Nginx → tangsengdaodaoserver:8090
    │
    ▼
服务端验证密码（MD5 双重哈希）
    │
    ▼
返回 Token + WuKongIM 连接地址
    │
    ▼
前端建立 WebSocket 连接：wss://wed.imim.chat/ws
    │  经 Nginx 代理 → wukongim:5200
    ▼
长连接建立，开始收发消息
```

### 3.2 消息发送流程

```
用户发送消息
    │
    ▼
前端 SDK → WebSocket → wukongim（消息引擎）
    │
    ├── 持久化到 WuKongIM 内置 LevelDB
    ├── 推送给在线接收方（WebSocket）
    └── 触发 Webhook → tangsengdaodaoserver（业务处理）
            │
            └── 存储到 MySQL（消息记录、已读状态等）
```

### 3.3 文件上传流程

```
用户选择图片/文件
    │
    ▼
POST /v1/file/upload → tangsengdaodaoserver
    │
    ▼
服务端上传到 MinIO（S3 兼容存储）
    │
    ▼
返回文件 URL（minio:9000/bucket/filename）
    │
    ▼
消息中携带文件 URL 发送
```

---

## 4. 容器依赖关系

```
mysql ──────────────────────────┐
redis ──────────────────────────┤
wukongim ───────────────────────┤
minio ──────────────────────────┤
                                ▼
                    tangsengdaodaoserver (healthy)
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            tangsengdaodaoweb    tangsengdaodaomanager
```

---

## 5. 前端定制架构

由于 Web 前端是**预编译的 React 应用**（无源码），所有定制通过以下方式实现：

### 5.1 文件注入机制

```
index.html 加载顺序：
1. main.imim2026v2.js  ← 预编译主应用（不可修改）
2. main.946ff072.css   ← 预编译主样式（不可修改）
3. imim_adaptive.js    ← 自定义适配脚本（可修改）★
   └── 内嵌 mobile.css 的等效逻辑
```

### 5.2 imim_adaptive.js 功能模块

| 模块 | 触发时机 | 功能 |
|------|----------|------|
| XHR 拦截器 | 页面加载立即执行 | 修正登录 username 格式 |
| CSS 注入 | DOM 加载后 | 注入移动端媒体查询样式 |
| TabBar 创建 | 登录成功后 | 动态创建底部导航栏 |
| 布局监听 | MutationObserver | 监听 DOM 变化，持续修正布局 |
| 主题切换 | 用户点击 | 深色/浅色模式切换 |

---

## 6. 安全配置

| 措施 | 状态 | 说明 |
|------|------|------|
| HTTPS/TLS | ✅ 已启用 | TLS 1.2/1.3，证书路径 `/etc/nginx/ssl/` |
| Adminer 访问限制 | ✅ 仅本机 | `127.0.0.1:8306`，不对外暴露 |
| MySQL 端口 | ✅ 不对外 | 仅容器内网通信 |
| Redis 端口 | ✅ 不对外 | 仅容器内网通信 |
| WuKongIM API | ✅ 不对外 | 5001 端口未映射到外网 |
| Token 认证 | ✅ 已启用 | `WK_TOKENAUTHON=true` |
| 固定验证码 | ⚠️ 测试用 | `TS_SMSCODE=123456`，生产环境需改为短信服务 |
| 数据库定期备份 | ⚠️ 待配置 | 建议配置 cron 定时备份 |
