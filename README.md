# CQIM 全栈即时通讯系统

[English Version](./README_en.md) | **中文版**

> **CQIM** 是一套高性能、高安全性的全栈即时通讯系统。本仓库的核心迭代已全面转向 **[cqim-app](./cqim-app/)**，支持强制端到端加密（Signal/MLS）、朋友圈、贴纸商店及万人群聊优化。

**访问地址：** https://wed.imim.chat（以实际部署为准）  
**管理后台：** https://wed.imim.chat/admin  
**核心目录：** `./cqim-app`  
**部署方式：** Docker Compose + Nginx 反向代理

---

## 项目组成

本仓库以自研 **CQIM** 为核心，同时保留了早期的 WuKongIM 组件作为可选/遗留参考。

| 组件 | 状态 | 技术栈 | 说明 |
|------|------|--------|------|
| **CQIM** | **核心/主迭代** | React + Node.js + Go + MongoDB + Redis | 高性能全栈 IM，支持强制 E2EE、朋友圈等 |
| **WuKongIM** | 可选/遗留 | WuKongIM + TangSengDaoDao | 早期采用的私有化 IM 引擎方案 |

---

## 技术栈 (CQIM)

- **前端**：TypeScript / React 19 / Vite / Zustand / Framer Motion / RxDB (IndexedDB)
- **后端**：Node.js / Express / Prisma
- **网关**：Go Gateway (高性能群聊 WebSocket 扇出)
- **数据**：MongoDB (主存)、Redis (缓存/在线状态/Pub-Sub)、MySQL (审计/可选)
- **安全**：Signal Protocol (私聊 E2EE)、MLS (群聊 E2EE)、AES-GCM (媒体加密)
- **部署**：Docker Compose + Nginx

---

## 核心功能

- **基础通讯**：私聊、群聊、语音消息、图片/视频/文件传输、消息撤回。
- **强制 E2EE**：所有私聊强制 Signal 加密，群聊强制 MLS 加密，服务器零明文存储。
- **社交动态**：完整的朋友圈（Moments）系统，支持图文、视频、点赞与评论。
- **扩展能力**：贴纸商店（支持 Telegram 贴纸导入）、多渠道推送（Web Push/FCM/APNs/个推）、管理后台。
- **性能优化**：Web Worker 加解密、IndexedDB 本地持久化秒开、Redis 缓存一致性优化。

---

## 目录结构

```text
imimchat/
├── cqim-app/                   # ★ 核心：CQIM 全栈 IM 应用
│   ├── client/                 # 前端源码 (React + Vite)
│   ├── server/                 # 后端源码 (Node.js + Express)
│   ├── go-gateway/             # Go 实时消息网关
│   ├── prisma/                 # 数据库 Schema 与迁移
│   └── docker-compose.yml      # 生产环境编排配置
├── docs/                       # 项目详细文档
├── register-service/           # 注册中间件（可选）
├── nginx/                      # Nginx 反向代理配置参考
└── scripts/                    # 运维与备份脚本
```

---

## 开发与部署

### 快速启动 (CQIM)

1. **进入工作目录**：
   ```bash
   cd cqim-app
   ```

2. **配置环境变量**：
   ```bash
   cp .env.example .env
   # 按需修改 .env 中的数据库连接、强密码及 CORS 白名单
   ```

3. **一键启动**：
   ```bash
   docker-compose up -d --build
   ```

详细部署指引请参考：**[docs/DEPLOY.md](./cqim-app/docs/DEPLOY.md)**

---

## 文档导航

| 文档 | 说明 |
|------|------|
| [BUGFIX_VERIFY.md](./docs/BUGFIX_VERIFY.md) | 最新 BUG 修复与一致性验证说明 |
| [DEPLOY.md](./cqim-app/docs/DEPLOY.md) | CQIM 生产环境详细部署指南 |
| [architecture.md](./docs/architecture.md) | 系统架构说明 (已更新为 CQIM 架构) |
| [optimization.md](./docs/optimization.md) | 性能优化方案与路线图 |

---

## 许可证

本项目遵循 MIT 许可证。
