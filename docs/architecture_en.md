# imimchat System Architecture

[**中文版**](./architecture.md) | **English Version**

## 1. Overall Architecture

imimchat is a private instant messaging system based on open-source frameworks. It uses **Docker Compose containerized deployment** and provides services externally through **Nginx reverse proxy**.

### 1.1 Technology Stack

| Layer | Component | Version | Description |
|-------|-----------|---------|-------------|
| Messaging Engine | WuKongIM | v2 | High-performance IM messaging engine supporting TCP/WebSocket |
| Business Service | TangSengDaoDao Server | v1.5 | IM business API service written in Go |
| Web Frontend | TangSengDaoDao Web | latest | Pre-compiled React SPA application |
| Admin Dashboard | TangSengDaoDao Manager | latest | Pre-compiled Vue admin dashboard |
| Database | MySQL | 8.0.33 | Business data such as users, messages, channels, etc. |
| Cache | Redis | 7.2.3 | Session cache, Token storage |
| File Storage | MinIO | 2023-07-18 | S3-compatible object storage for images/files |
| Reverse Proxy | Nginx | 1.18+ | SSL termination, route distribution, WebSocket proxy |

### 1.2 Server Information

| Item | Value |
|------|-------|
| Server IP | 42.194.167.201 |
| Cloud Provider | Tencent Cloud |
| OS | Ubuntu 22.04 LTS (x86_64) |
| Kernel Version | 6.8.0-101-generic |
| Docker Version | 29.3.1 |
| Disk Usage | 13GB / 40GB (35%) |
| Memory | 3.6GB Total, ~1.4GB Used |

---

## 2. Network Architecture

### 2.1 Port Mapping

```
External Port    →    Service
─────────────────────────────────────────
80 (HTTP)   →    Nginx (Redirect to HTTPS)
443 (HTTPS) →    Nginx (Main Entry)
5100        →    WuKongIM TCP Persistent Connection (Used by native mobile apps)
5200        →    WuKongIM WebSocket (Used by Web clients, proxied via Nginx /ws)

Internal Port (Container communication only)
─────────────────────────────────────────
82          →    tangsengdaodaoweb (Web Frontend)
83          →    tangsengdaodaomanager (Admin Dashboard)
8090        →    tangsengdaodaoserver (Business API)
5001        →    wukongim HTTP API (Internal only)
5300        →    wukongim Monitoring Port
3306        →    MySQL (Container internal network only)
6379        →    Redis (Container internal network only)
9000        →    MinIO API
9001        →    MinIO Console
127.0.0.1:8306 → Adminer (MySQL Web Admin, local access only)
```

### 2.2 Nginx Routing Rules

| Request Path | Proxy Target | Description |
|--------------|--------------|-------------|
| `/` | `127.0.0.1:82` | Web Frontend (React SPA) |
| `/v1/` | `127.0.0.1:8090/v1/` | Business API (Direct proxy) |
| `/api/` | `127.0.0.1:8090/` | Business API (Alias) |
| `/ws` | `127.0.0.1:5200` | WebSocket persistent connection |
| `/admin` | `127.0.0.1:83/` | Admin Dashboard (includes path rewriting) |
| `/admin/static/` | `127.0.0.1:83/static/` | Admin Dashboard static resources |

---

## 3. Data Flow

### 3.1 User Login Flow

```
User inputs phone number + password
    │
    ▼
Frontend imim_adaptive.js intercepts XHR request
    │  Corrects username format: 0086xxxxxxx → 86xxxxxxx
    ▼
POST /v1/user/login → Nginx → tangsengdaodaoserver:8090
    │
    ▼
Server verifies password (MD5 double hashing)
    │
    ▼
Returns Token + WuKongIM connection address
    │
    ▼
Frontend establishes WebSocket connection: wss://wed.imim.chat/ws
    │  Proxied via Nginx → wukongim:5200
    ▼
Persistent connection established, ready to send/receive messages
```

### 3.2 Message Sending Flow

```
User sends a message
    │
    ▼
Frontend SDK → WebSocket → wukongim (Messaging Engine)
    │
    ├── Persisted to WuKongIM built-in LevelDB
    ├── Pushed to online recipient (WebSocket)
    └── Triggers Webhook → tangsengdaodaoserver (Business processing)
            │
            └── Stored in MySQL (Message records, read status, etc.)
```

### 3.3 File Upload Flow

```
User selects image/file
    │
    ▼
POST /v1/file/upload → tangsengdaodaoserver
    │
    ▼
Server uploads to MinIO (S3-compatible storage)
    │
    ▼
Returns file URL (minio:9000/bucket/filename)
    │
    ▼
Message sent carrying the file URL
```

---

## 4. Container Dependencies

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

## 5. Frontend Customization Architecture

Since the Web frontend is a **pre-compiled React application** (without source code), all customizations are implemented through the following methods:

### 5.1 File Injection Mechanism

```
index.html loading order:
1. main.imim2026v2.js  ← Pre-compiled main application (cannot be modified)
2. main.946ff072.css   ← Pre-compiled main styles (cannot be modified)
3. imim_adaptive.js    ← Custom adaptation script (modifiable) ★
   └── Embedded equivalent logic of mobile.css
```

### 5.2 imim_adaptive.js Functional Modules

| Module | Trigger Timing | Function |
|--------|----------------|----------|
| XHR Interceptor | Immediately on page load | Corrects login username format |
| CSS Injection | After DOM load | Injects mobile media query styles |
| TabBar Creation | After successful login | Dynamically creates bottom navigation bar |
| Layout Listener | MutationObserver | Listens for DOM changes, continuously corrects layout |
| Theme Switcher | User click | Toggles dark/light mode |

---

## 6. Security Configurations

| Measure | Status | Description |
|---------|--------|-------------|
| HTTPS/TLS | ✅ Enabled | TLS 1.2/1.3, certificate path `/etc/nginx/ssl/` |
| Adminer Access Limit | ✅ Local only | `127.0.0.1:8306`, not exposed externally |
| MySQL Port | ✅ Not exposed | Container internal network communication only |
| Redis Port | ✅ Not exposed | Container internal network communication only |
| WuKongIM API | ✅ Not exposed | Port 5001 is not mapped to external network |
| Token Auth | ✅ Enabled | `WK_TOKENAUTHON=true` |
| Fixed SMS Code | ⚠️ Test only | `TS_SMSCODE=123456`, change to real SMS service in production |
| DB Auto Backup | ⚠️ Pending | Recommend configuring cron for scheduled backups |
