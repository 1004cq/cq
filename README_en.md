# CQIM Full-stack Instant Messaging System

**English Version** | [中文版](./README.md)

> **CQIM** is a high-performance, ultra-secure full-stack IM system. The core development has shifted to **[cqim-app](./cqim-app/)**, featuring mandatory End-to-End Encryption (Signal/MLS), Moments (Social Feed), Sticker Store, and 10k+ concurrent group chat optimizations.

**Access URL:** https://wed.imim.chat (Subject to actual deployment)  
**Admin Dashboard:** https://wed.imim.chat/admin  
**Core Directory:** `./cqim-app`  
**Deployment:** Docker Compose + Nginx Reverse Proxy

---

## Project Components

This repository is centered around **CQIM**, while retaining legacy WuKongIM components as optional references.

| Component | Status | Tech Stack | Description |
|-----------|--------|------------|-------------|
| **CQIM** | **Core / Main** | React + Node.js + Go + MongoDB + Redis | Full-stack IM with mandatory E2EE, Moments, etc. |
| **WuKongIM** | Legacy / Optional | WuKongIM + TangSengDaoDao | Earlier private IM engine solution. |

---

## Tech Stack (CQIM)

- **Frontend**: TypeScript / React 19 / Vite / Zustand / Framer Motion / RxDB (IndexedDB)
- **Backend**: Node.js / Express / Prisma
- **Gateway**: Go Gateway (High-performance WebSocket fan-out for groups)
- **Database**: MongoDB (Primary), Redis (Cache/Presence/Pub-Sub), MySQL (Audit/Optional)
- **Security**: Signal Protocol (Private E2EE), MLS (Group E2EE), AES-GCM (Media Encryption)
- **Deployment**: Docker Compose + Nginx

---

## Core Features

- **Base Messaging**: Private/Group chat, Voice, Image/Video/File transfer, Message Recall.
- **Mandatory E2EE**: All private chats use Signal Protocol; group chats use MLS. Zero-knowledge storage.
- **Social Feed**: Full Moments system with images, videos, likes, and comments.
- **Extensions**: Sticker Store (Telegram sticker import), Multi-channel Push (Web Push/FCM/APNs), Admin Dashboard.
- **Performance**: Web Worker crypto, IndexedDB local persistence, Redis cache consistency.

---

## Directory Structure

```text
imimchat/
├── cqim-app/                   # ★ Core: CQIM Full-stack Application
│   ├── client/                 # Frontend source (React + Vite)
│   ├── server/                 # Backend source (Node.js + Express)
│   ├── go-gateway/             # Go Real-time Gateway
│   ├── prisma/                 # DB Schema & Migrations
│   └── docker-compose.yml      # Production orchestration
├── docs/                       # Detailed documentation
├── register-service/           # Registration middleware (Optional)
├── nginx/                      # Nginx reverse proxy samples
└── scripts/                    # Maintenance & Backup scripts
```

---

## Development & Deployment

### Quick Start (CQIM)

1. **Enter Workspace**:
   ```bash
   cd cqim-app
   ```

2. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Edit .env for DB credentials, strong passwords, and CORS whitelist.
   ```

3. **One-click Start**:
   ```bash
   docker-compose up -d --build
   ```

For detailed instructions, see: **[docs/DEPLOY.md](./cqim-app/docs/DEPLOY.md)**

---

## Documentation

| Document | Description |
|----------|-------------|
| [BUGFIX_VERIFY.md](./docs/BUGFIX_VERIFY.md) | Recent bug fixes and consistency verification. |
| [DEPLOY.md](./cqim-app/docs/DEPLOY.md) | Detailed CQIM production deployment guide. |
| [architecture.md](./docs/architecture.md) | System architecture (Updated for CQIM). |
| [optimization.md](./docs/optimization.md) | Performance optimization roadmap. |

---

## License

This project is licensed under the MIT License.
