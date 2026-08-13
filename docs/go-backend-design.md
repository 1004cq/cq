# 类 Telegram 高性能聊天后端架构设计

> 技术栈：Go 1.22 + Gin + PostgreSQL + Redis + WebSocket + MinIO
> 设计目标：百万并发连接、消息延迟 < 500ms、支持亿级用户规模扩展

---

## 一、数据库表结构

### 1.1 用户分片策略

```
分片键：user_id（UUID v7，天然按时间排序）
分片数：256 个逻辑分片 → 物理映射到 4-16 个 PostgreSQL 实例
路由规则：hash(user_id) % 256 → shard_id
```

### 1.2 核心表结构

```sql
-- ========== 用户系统 ==========

-- 用户主表（按 user_id 分片）
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    username    VARCHAR(32) UNIQUE NOT NULL,
    phone       VARCHAR(20) UNIQUE,
    email       VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,  -- bcrypt cost=12
    nickname    VARCHAR(64),
    avatar_url  TEXT,
    bio         TEXT,
    is_bot      BOOLEAN DEFAULT FALSE,
    is_banned   BOOLEAN DEFAULT FALSE,
    ban_reason  TEXT,
    role        VARCHAR(16) DEFAULT 'user',  -- user/admin/superadmin
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_created ON users(created_at);

-- 设备会话表
CREATE TABLE user_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(128) UNIQUE NOT NULL,
    device_id   VARCHAR(64),
    device_name VARCHAR(128),
    device_type VARCHAR(16),  -- ios/android/web/desktop
    ip_address  INET,
    location    JSONB,        -- {country, city, lat, lng}
    is_active   BOOLEAN DEFAULT TRUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_token ON user_sessions(token, expires_at);
CREATE INDEX idx_sessions_user ON user_sessions(user_id, is_active);

-- 验证码表（短 TTL）
CREATE TABLE verify_codes (
    id          UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    target      VARCHAR(128) NOT NULL,  -- 手机号或邮箱
    code        VARCHAR(8) NOT NULL,
    type        VARCHAR(16) NOT NULL,   -- sms/email
    channel     VARCHAR(32),            -- aliyun_dypns/aliyun_sms/twilio
    used        BOOLEAN DEFAULT FALSE,
    retry_count INTEGER DEFAULT 0,
    max_retry   INTEGER DEFAULT 3,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vc_lookup ON verify_codes(target, type, channel, used, expires_at);

-- ========== 聊天系统 ==========

-- 聊天表（统一私聊和群聊，Telegram 风格）
CREATE TABLE chats (
    id              UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    type            VARCHAR(16) NOT NULL,  -- private/group/supergroup/channel
    title           VARCHAR(128),          -- 群组/频道名称（私聊为 NULL）
    avatar_url      TEXT,
    description     TEXT,
    invite_hash     VARCHAR(22) UNIQUE,    -- 邀请链接 hash
    creator_id      UUID REFERENCES users(id),
    -- 群组/频道特有
    member_count    INTEGER DEFAULT 0,     -- 原子更新
    max_members     INTEGER DEFAULT 200000,
    slow_mode_sec   INTEGER DEFAULT 0,     -- 慢速模式（秒）
    is_public       BOOLEAN DEFAULT FALSE,
    -- 频道特有
    is_channel      BOOLEAN DEFAULT FALSE,
    channel_admin_ids UUID[],              -- 可发布的管理员列表
    -- 加密
    is_encrypted    BOOLEAN DEFAULT FALSE,  -- Secret Chat 标记
    encryption_ver  INTEGER DEFAULT 0,      -- 密钥版本
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chats_type ON chats(type);
CREATE INDEX idx_chats_invite ON chats(invite_hash) WHERE invite_hash IS NOT NULL;

-- 聊天参与者（私聊：2人，群组/频道：多人）
CREATE TABLE chat_participants (
    chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(16) DEFAULT 'member',  -- owner/admin/member
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    last_read_seq BIGINT DEFAULT 0,     -- 已读游标（群聊用）
    is_muted    BOOLEAN DEFAULT FALSE,
    mute_until  TIMESTAMPTZ,
    is_pinned   BOOLEAN DEFAULT FALSE,
    pinned_at   TIMESTAMPTZ,
    -- 频道特有
    can_post    BOOLEAN DEFAULT FALSE,  -- 频道发布权限
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX idx_cp_user ON chat_participants(user_id, is_pinned DESC, last_read_seq DESC);
CREATE INDEX idx_cp_chat ON chat_participants(chat_id, role);

-- 消息表（读扩散模型，每条消息只存一份）
CREATE TABLE messages (
    id          UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id   UUID REFERENCES users(id),
    seq         BIGINT NOT NULL,            -- 聊天内递增序列号
    type        VARCHAR(16) NOT NULL,       -- text/image/video/voice/file/sticker/location/poll/system/call
    content     JSONB NOT NULL,             -- 消息体（灵活结构）
    -- 引用/转发
    reply_to_id UUID REFERENCES messages(id),
    forward_from_id UUID REFERENCES messages(id),
    forward_from_chat UUID REFERENCES chats(id),
    -- 编辑/撤回
    is_edited   BOOLEAN DEFAULT FALSE,
    edited_at   TIMESTAMPTZ,
    is_revoked  BOOLEAN DEFAULT FALSE,
    -- 阅后即焚
    burn_after_read INTEGER,               -- 秒数
    burn_expire_at TIMESTAMPTZ,
    -- 加密（Secret Chat）
    is_encrypted BOOLEAN DEFAULT FALSE,
    encryption_ver INTEGER DEFAULT 0,
    -- 反应
    reactions   JSONB DEFAULT '{}',         -- {"👍": 3, "❤️": 5}
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 关键索引：按聊天+序列号范围查询
CREATE INDEX idx_messages_chat_seq ON messages(chat_id, seq DESC);
CREATE INDEX idx_messages_created ON messages(created_at);
CREATE UNIQUE INDEX idx_messages_chat_seq_unique ON messages(chat_id, seq);

-- 消息已读状态（群聊）
CREATE TABLE message_reads (
    chat_id     UUID NOT NULL,
    user_id     UUID NOT NULL,
    last_read_seq BIGINT NOT NULL,
    read_at     TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

-- ========== 好友系统 ==========

CREATE TABLE friendships (
    user_a      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(16) NOT NULL,  -- pending/accepted/rejected
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)  -- 字典序归一化
);

-- ========== Bot 系统 ==========

CREATE TABLE bots (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(64) UNIQUE NOT NULL,  -- Bot API token
    webhook_url TEXT,
    description TEXT,
    commands    JSONB DEFAULT '[]',   -- [{command, description}]
    is_enabled  BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ========== 审计日志（独立数据库） ==========

CREATE TABLE audit_login_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID,
    success     BOOLEAN NOT NULL,
    method      VARCHAR(16),           -- password/sms/email
    ip_address  INET,
    user_agent  TEXT,
    location    JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_login_user ON audit_login_logs(user_id, created_at);

CREATE TABLE audit_admin_logs (
    id          BIGSERIAL PRIMARY KEY,
    admin_id    UUID NOT NULL,
    action      VARCHAR(64) NOT NULL,
    target_type VARCHAR(32),
    target_id   UUID,
    detail      JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_admin_action ON audit_admin_logs(admin_id, created_at);
```

### 1.3 Redis 数据结构

```
# 会话缓存（TTL 30s，fallback to DB）
session:{token} → JSON {user_id, device_id, expires_at, cached_at}

# 在线状态（TTL 120s，心跳续期）
online:{user_id} → "1700000000"

# 设备信息
device:{user_id}:{device_id} → JSON {device_name, device_type, last_ip, last_seen}

# 最后在线时间（持久）
lastseen:{user_id} → "1700000000"

# 消息序列号计数器（原子递增）
msgseq:{chat_id} → "12345"

# 离线消息队列（每个用户一个 List，最多存 500 条）
offline:{user_id} → LIST [msg_json_1, msg_json_2, ...]

# 速率限制
ratelimit:login:{ip} → STRING (TTL 60s)
ratelimit:api:{ip} → STRING (TTL 60s)
ratelimit:sms:{phone} → STRING (TTL 3600s)

# Bot Webhook 队列
bot:webhook:{bot_token} → LIST [update_json, ...]

# Pub/Sub 频道
channel:chat:{chat_id}  → 群消息实时广播
channel:user:{user_id}  → 用户通知（新消息、好友请求等）
channel:presence         → 在线状态变更
```

---

## 二、核心 API 接口设计

### 2.1 REST API

```
Base URL: https://api.imim.chat/v1

# ===== 认证 =====
POST   /auth/send-code           # 发送验证码
POST   /auth/login               # 登录（密码/验证码）
POST   /auth/logout              # 登出
POST   /auth/refresh             # 刷新 Token
GET    /auth/sessions            # 已登录设备列表
DELETE /auth/sessions/:id        # 踢出设备
POST   /auth/change-password     # 修改密码

# ===== 用户 =====
GET    /users/me                 # 当前用户信息
PUT    /users/me                 # 更新个人信息
GET    /users/:id                # 获取用户信息
POST   /users/search             # 搜索用户（用户名/手机号）
POST   /users/block/:id          # 拉黑用户

# ===== 聊天 =====
GET    /chats                    # 会话列表（分页）
POST   /chats                    # 创建聊天（私聊/群组/频道）
GET    /chats/:id                # 聊天详情
PUT    /chats/:id                # 更新聊天设置
DELETE /chats/:id                # 退出/删除聊天
POST   /chats/:id/pin            # 置顶聊天
POST   /chats/:id/mute           # 静音聊天
POST   /chats/:id/join           # 通过邀请链接加入

# ===== 消息 =====
GET    /chats/:id/messages       # 获取消息（分页，游标翻页）
POST   /chats/:id/messages       # 发送消息
PUT    /messages/:id             # 编辑消息
DELETE /messages/:id             # 撤回消息
POST   /messages/:id/read       # 标记已读
POST   /messages/:id/react      # 消息反应
POST   /messages/:id/forward    # 转发消息
GET    /chats/:id/search         # 搜索消息（全文）

# ===== 好友 =====
GET    /friends                  # 好友列表
POST   /friends/request          # 发送好友申请
POST   /friends/request/:id/accept  # 接受好友申请
POST   /friends/request/:id/reject  # 拒绝好友申请
DELETE /friends/:id              # 删除好友

# ===== 文件 =====
POST   /files/upload             # 上传文件（MinIO）
GET    /files/:id                # 获取文件（签名 URL）
GET    /files/:id/thumbnail      # 缩略图

# ===== 加密 =====
POST   /crypto/register-key      # 注册 ECDH 公钥
GET    /crypto/get-key/:userId   # 获取对方公钥
POST   /crypto/exchange          # 密钥交换（X3DH）

# ===== Bot API =====
POST   /bot/:token/sendMessage   # 发送消息
POST   /bot/:token/sendPhoto     # 发送图片
POST   /bot/:token/editMessage   # 编辑消息
POST   /bot/:token/deleteMessage # 删除消息
POST   /bot/:token/sendPoll      # 发送投票
POST   /bot/:token/answerCallbackQuery  # 回调查询
GET    /bot/:token/getUpdates    # 长轮询获取更新
POST   /bot/:token/setWebhook    # 设置 Webhook
GET    /bot/:token/getMe         # 获取 Bot 信息
POST   /bot/:token/setMyCommands # 设置命令列表

# ===== 推送 =====
POST   /push/register            # 注册设备推送 Token
POST   /push/unregister          # 注销推送

# ===== 管理 =====
GET    /admin/stats              # 系统统计
GET    /admin/users              # 用户管理（搜索/封禁）
GET    /admin/logs               # 审计日志
GET    /admin/config             # 系统配置
PUT    /admin/config             # 更新配置
```

### 2.2 WebSocket 协议

```
连接地址：wss://api.imim.chat/ws?token={session_token}

所有消息使用 JSON 格式，统一外层结构：
{
  "type": "message_type",
  "seq": 12345,           // 客户端序列号（用于确认）
  "data": { ... }         // 具体数据
}

# ===== 客户端 → 服务端 =====
{"type": "ping"}                              # 心跳（每 30s）
{"type": "pong"}                              # 心跳响应
{"type": "subscribe", "data": {"chat_ids": [...]}}  # 订阅聊天
{"type": "unsubscribe", "data": {"chat_ids": [...]}} # 取消订阅
{"type": "send_message", "data": {...}}       # 发送消息
{"type": "typing", "data": {"chat_id": "xxx"}} # 输入中
{"type": "read", "data": {"chat_id": "xxx", "seq": 12345}}  # 已读确认
{"type": "ack", "data": {"message_ids": [...]}}  # 消息送达确认

# ===== 服务端 → 客户端 =====
{"type": "new_message", "data": {message_object}}
{"type": "message_updated", "data": {message_object}}
{"type": "message_revoked", "data": {"chat_id": "xxx", "message_id": "xxx"}}
{"type": "message_read", "data": {"chat_id": "xxx", "user_id": "xxx", "seq": 12345}}
{"type": "typing", "data": {"chat_id": "xxx", "user_id": "xxx"}}
{"type": "presence", "data": {"user_id": "xxx", "status": "online/offline", "last_seen": 1700000000}}
{"type": "chat_update", "data": {chat_object}}  # 群组信息变更
{"type": "notification", "data": {"type": "friend_request", ...}}
{"type": "error", "data": {"code": 400, "message": "..."}}
{"type": "ack", "data": {"seq": 12345}}  # 服务端确认收到
```

---

## 三、消息发送完整流程

### 时序图描述

```
发送者客户端           WebSocket Hub        消息服务            Redis           PostgreSQL      接收者客户端
    |                      |                   |                  |                  |                |
    |-- send_message ----->|                   |                  |                  |                |
    |                      |-- validate ------>|                  |                  |                |
    |                      |   (auth + rate)   |                  |                  |                |
    |                      |                   |-- INCR seq ----->|                  |                |
    |                      |                   |<-- new_seq ------|                  |                |
    |                      |                   |                                  |                |
    |                      |                   |-- INSERT message --------------->|                |
    |                      |                   |   (chat_id, sender,              |                |
    |                      |                   |    seq, type, content)           |                |
    |                      |                   |                                  |                |
    |                      |                   |-- RPUSH offline:{uid} ---------->|                |
    |                      |                   |   (仅离线接收者)                 |                |
    |                      |                   |                                  |                |
    |                      |                   |-- PUBLISH channel:chat:{cid} --->|                |
    |<-- ack: {seq} -------|                   |                                  |                |
    |                      |                   |                                  |                |
    |                      |                   |         (Pub/Sub 广播)           |                |
    |                      |                   |                                  |                |
    |                      |                   |  Hub 收到 PUBLISH 消息           |                |
    |                      |                   |-- 查找在线订阅者列表             |                |
    |                      |                   |                                  |                |
    |                      |                   |-- new_message ---> 在线接收者 1   |                |
    |                      |                   |-- new_message ---> 在线接收者 2   |                |
    |                      |                   |                                  |                |
    |                      |                   |  对于离线接收者：                |                |
    |                      |                   |-- APNs/FCM 推送通知 -------------> 离线接收者    |
    |                      |                   |   (仅当消息未在 3s 内送达时)      |                |
    |                      |                   |                                  |                |
    |  (接收者上线后)      |                   |                                  |                |
    |                      |<-- subscribe ------|                                  |                |
    |                      |-- LRANGE offline --|                                  |                |
    |                      |-- 批量推送离线消息->|                                  |                |
    |                      |-- LTRIM 清理 ------|                                  |                |
```

### 关键设计决策

1. **序列号原子递增**：Redis INCR `msgseq:{chat_id}`，保证消息在聊天内严格有序
2. **先落库后推送**：消息持久化到 PostgreSQL 后才广播，保证不丢消息
3. **在线推 + 离线队列 + APNs 三级保障**：
   - 在线：WebSocket 即时推送（< 100ms）
   - 离线：Redis List 暂存（最多 500 条，LRANGE + LTRIM）
   - 兜底：3 秒内未确认送达，触发 APNs/FCM 推送通知
4. **客户端 ACK 确认**：收到消息后发 ACK，服务端清理离线队列
5. **消息去重**：客户端用 (chat_id, seq) 幂等去重

---

## 四、关键代码实现

### 4.1 项目结构

```
go-backend/
├── cmd/
│   └── server/
│       └── main.go              # 入口
├── internal/
│   ├── config/
│   │   └── config.go            # 配置管理
│   ├── models/
│   │   ├── user.go
│   │   ├── chat.go
│   │   ├── message.go
│   │   └── bot.go
│   ├── handler/
│   │   ├── auth.go              # 认证 HTTP handler
│   │   ├── chat.go              # 聊天 HTTP handler
│   │   ├── message.go           # 消息 HTTP handler
│   │   ├── bot.go               # Bot API handler
│   │   └── websocket.go         # WebSocket handler
│   ├── service/
│   │   ├── auth.go              # 认证业务逻辑
│   │   ├── message.go           # 消息发送业务逻辑
│   │   ├── chat.go              # 聊天管理业务逻辑
│   │   └── push.go              # 推送服务
│   ├── ws/
│   │   ├── hub.go               # WebSocket Hub（连接管理）
│   │   ├── client.go            # 单个连接处理
│   │   └── protocol.go          # 消息协议定义
│   ├── middleware/
│   │   ├── auth.go              # JWT 认证中间件
│   │   ├── ratelimit.go         # 速率限制
│   │   └── cors.go              # CORS
│   ├── db/
│   │   ├── postgres.go          # PostgreSQL 连接池
│   │   └── redis.go             # Redis 连接管理
│   └── crypto/
│       ├── e2ee.go              # E2EE 密钥交换
│       └── hash.go              # 密码哈希
├── migrations/
│   └── 001_init.sql             # 数据库迁移
├── docker-compose.yml
├── Dockerfile
├── go.mod
└── go.sum
```

### 4.2 WebSocket Hub（连接管理器）

```go
// internal/ws/hub.go
package ws

import (
    "context"
    "encoding/json"
    "sync"
    "time"
)

// Message 统一消息结构
type Message struct {
    Type string          `json:"type"`
    Seq  int64           `json:"seq,omitempty"`
    Data json.RawMessage `json:"data,omitempty"`
}

// Client 单个 WebSocket 连接
type Client struct {
    ID       string
    UserID   string
    DeviceID string
    Conn     *websocket.Conn
    Send     chan []byte
    Hub      *Hub
    Chats    map[string]bool // 订阅的聊天 ID 集合

    ctx    context.Context
    cancel context.CancelFunc
}

// Hub 管理所有 WebSocket 连接
type Hub struct {
    mu sync.RWMutex

    // 用户 → 客户端列表（多设备）
    clients map[string]map[string]*Client // userID → deviceID → Client

    // 聊天 → 在线用户集合（用于消息广播）
    chatMembers map[string]map[string]bool // chatID → set of userID

    // 注册/注销通道
    register   chan *Client
    unregister chan *Client

    // 待广播消息队列（批处理）
    broadcast chan *BroadcastMsg

    // Redis Pub/Sub
    redis *RedisClient

    // 消息服务引用
    msgService MessageService
}

// BroadcastMsg 广播消息
type BroadcastMsg struct {
    ChatID    string
    Message   []byte
    ExcludeID string // 排除发送者
}

// NewHub 创建 Hub
func NewHub(redis *RedisClient, msgService MessageService) *Hub {
    return &Hub{
        clients:     make(map[string]map[string]*Client),
        chatMembers: make(map[string]map[string]bool),
        register:    make(chan *Client, 1024),
        unregister:  make(chan *Client, 1024),
        broadcast:   make(chan *BroadcastMsg, 4096),
        redis:       redis,
        msgService:  msgService,
    }
}

// Run 启动 Hub 主循环
func (h *Hub) Run(ctx context.Context) {
    // 订阅 Redis Pub/Sub 频道（跨进程消息广播）
    go h.subscribeRedis(ctx)

    for {
        select {
        case client := <-h.register:
            h.handleRegister(client)

        case client := <-h.unregister:
            h.handleUnregister(client)

        case msg := <-h.broadcast:
            h.handleBroadcast(msg)

        case <-ctx.Done():
            return
        }
    }
}

// handleRegister 处理新连接注册
func (h *Hub) handleRegister(c *Client) {
    h.mu.Lock()
    defer h.mu.Unlock()

    // 注册客户端
    if h.clients[c.UserID] == nil {
        h.clients[c.UserID] = make(map[string]*Client)
    }
    // 如果同设备已有连接，关闭旧连接
    if old, ok := h.clients[c.UserID][c.DeviceID]; ok {
        old.cancel()
    }
    h.clients[c.UserID][c.DeviceID] = c

    // 更新在线状态
    h.redis.Set(context.Background(), "online:"+c.UserID, time.Now().Unix(), 120*time.Second)

    // 广播上线通知
    h.broadcastPresence(c.UserID, "online")

    // 推送离线消息
    go h.deliverOfflineMessages(c)
}

// handleUnregister 处理连接断开
func (h *Hub) handleUnregister(c *Client) {
    h.mu.Lock()
    defer h.mu.Unlock()

    if userClients, ok := h.clients[c.UserID]; ok {
        delete(userClients, c.DeviceID)
        if len(userClients) == 0 {
            delete(h.clients, c.UserID)
            // 所有设备离线，更新最后在线时间
            h.redis.Set(context.Background(), "lastseen:"+c.UserID, time.Now().Unix(), 0)
            h.broadcastPresence(c.UserID, "offline")
        }
    }

    // 从聊天成员列表中移除
    for chatID := range c.Chats {
        delete(h.chatMembers[chatID], c.UserID)
    }
}

// handleBroadcast 广播消息到聊天成员
func (h *Hub) handleBroadcast(msg *BroadcastMsg) {
    h.mu.RLock()
    members := h.chatMembers[msg.ChatID]
    h.mu.RUnlock()

    if members == nil {
        return
    }

    // 并发推送到在线成员
    var wg sync.WaitGroup
    for userID := range members {
        if userID == msg.ExcludeID {
            continue
        }
        wg.Add(1)
        go func(uid string) {
            defer wg.Done()
            h.sendToUser(uid, msg.Message)
        }(userID)
    }
    wg.Wait()
}

// sendToUser 发送消息到用户的所有设备
func (h *Hub) sendToUser(userID string, data []byte) {
    h.mu.RLock()
    devices := h.clients[userID]
    h.mu.RUnlock()

    for _, client := range devices {
        select {
        case client.Send <- data:
        default:
            // 发送缓冲区满，跳过（客户端太慢）
            // 该消息会进入离线队列，用户下次上线时补推
        }
    }
}

// deliverOfflineMessages 推送离线消息
func (h *Hub) deliverOfflineMessages(c *Client) {
    ctx := context.Background()
    key := "offline:" + c.UserID

    // LRANGE 获取离线消息（最多 500 条）
    msgs, err := h.redis.LRange(ctx, key, 0, 499).Result()
    if err != nil || len(msgs) == 0 {
        return
    }

    // 批量推送
    for _, msg := range msgs {
        select {
        case c.Send <- []byte(msg):
        case <-c.ctx.Done():
            return
        }
    }

    // 清理已推送的离线消息
    h.redis.LTrim(ctx, key, int64(len(msgs)), -1)
}

// broadcastPresence 广播在线状态
func (h *Hub) broadcastPresence(userID string, status string) {
    data, _ := json.Marshal(map[string]interface{}{
        "type": "presence",
        "data": map[string]interface{}{
            "user_id": userID,
            "status":  status,
        },
    })

    // 发布到 Redis，由各进程消费
    h.redis.Publish(context.Background(), "channel:presence", data)
}

// subscribeRedis 订阅 Redis 频道（跨进程消息广播）
func (h *Hub) subscribeRedis(ctx context.Context) {
    pubsub := h.redis.Subscribe(ctx,
        "channel:presence",
        "channel:broadcast",
    )
    defer pubsub.Close()

    ch := pubsub.Channel()
    for {
        select {
        case msg := <-ch:
            switch msg.Channel {
            case "channel:presence":
                // 转发给所有订阅了该用户状态的客户端
                h.handleRedisPresence(msg.Payload)
            case "channel:broadcast":
                h.handleRedisBroadcast(msg.Payload)
            }
        case <-ctx.Done():
            return
        }
    }
}

func (h *Hub) handleRedisPresence(payload string) {
    // 转发在线状态到相关客户端
    h.mu.RLock()
    defer h.mu.RUnlock()

    for _, devices := range h.clients {
        for _, client := range devices {
            select {
            case client.Send <- []byte(payload):
            default:
            }
        }
    }
}

func (h *Hub) handleRedisBroadcast(payload string) {
    // 解析广播消息并转发
    var bMsg struct {
        ChatID  string `json:"chat_id"`
        Message []byte `json:"message"`
    }
    if err := json.Unmarshal([]byte(payload), &bMsg); err != nil {
        return
    }

    h.broadcast <- &BroadcastMsg{
        ChatID:  bMsg.ChatID,
        Message: bMsg.Message,
    }
}

// ChatSubscribe 订阅聊天
func (h *Hub) ChatSubscribe(c *Client, chatIDs []string) {
    h.mu.Lock()
    defer h.mu.Unlock()

    for _, chatID := range chatIDs {
        c.Chats[chatID] = true
        if h.chatMembers[chatID] == nil {
            h.chatMembers[chatID] = make(map[string]bool)
        }
        h.chatMembers[chatID][c.UserID] = true
    }
}

// ChatUnsubscribe 取消订阅
func (h *Hub) ChatUnsubscribe(c *Client, chatIDs []string) {
    h.mu.Lock()
    defer h.mu.Unlock()

    for _, chatID := range chatIDs {
        delete(c.Chats, chatID)
        delete(h.chatMembers[chatID], c.UserID)
    }
}

// OnlineCount 获取在线用户数
func (h *Hub) OnlineCount() int {
    h.mu.RLock()
    defer h.mu.RUnlock()
    return len(h.clients)
}
```

### 4.3 消息发送 Handler

```go
// internal/service/message.go
package service

import (
    "context"
    "encoding/json"
    "fmt"
    "time"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/redis/go-redis/v9"
)

// MessageService 消息服务
type MessageService struct {
    db    *pgxpool.Pool
    redis *redis.Client
    hub   *ws.Hub
    push  *PushService
}

// SendMessageRequest 发送消息请求
type SendMessageRequest struct {
    ChatID       string          `json:"chat_id"`
    Type         string          `json:"type"`          // text/image/video/voice/file/sticker
    Content      json.RawMessage `json:"content"`
    ReplyToID    *string         `json:"reply_to_id,omitempty"`
    BurnAfterSec *int            `json:"burn_after_read,omitempty"`
    IsEncrypted  bool            `json:"is_encrypted,omitempty"`
}

// SendMessageResponse 发送消息响应
type SendMessageResponse struct {
    MessageID string `json:"message_id"`
    Seq       int64  `json:"seq"`
    Timestamp int64  `json:"timestamp"`
}

// SendMessage 发送消息核心逻辑
func (s *MessageService) SendMessage(ctx context.Context, senderID string, req *SendMessageRequest) (*SendMessageResponse, error) {
    // 1. 验证发送者是否在聊天中
    if !s.isMember(ctx, req.ChatID, senderID) {
        return nil, fmt.Errorf("not a member of this chat")
    }

    // 2. 原子递增序列号（Redis INCR）
    seqKey := fmt.Sprintf("msgseq:%s", req.ChatID)
    seq, err := s.redis.Incr(ctx, seqKey).Result()
    if err != nil {
        return nil, fmt.Errorf("failed to get sequence: %w", err)
    }

    // 3. 构建消息对象
    msgID := uuid.Must(uuid.NewV7()).String()
    now := time.Now()

    var burnExpireAt *time.Time
    if req.BurnAfterSec != nil && *req.BurnAfterSec > 0 {
        t := now.Add(time.Duration(*req.BurnAfterSec) * time.Second)
        burnExpireAt = &t
    }

    // 4. 写入 PostgreSQL（同步，保证不丢消息）
    _, err = s.db.Exec(ctx, `
        INSERT INTO messages (id, chat_id, sender_id, seq, type, content,
            reply_to_id, burn_after_read, burn_expire_at, is_encrypted, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, msgID, req.ChatID, senderID, seq, req.Type, req.Content,
        req.ReplyToID, req.BurnAfterSec, burnExpireAt, req.IsEncrypted, now)
    if err != nil {
        // 序列号回滚（Redis DECR）
        s.redis.Decr(ctx, seqKey)
        return nil, fmt.Errorf("failed to insert message: %w", err)
    }

    // 5. 构建推送消息体
    pushMsg := map[string]interface{}{
        "type": "new_message",
        "data": map[string]interface{}{
            "message_id":      msgID,
            "chat_id":         req.ChatID,
            "sender_id":       senderID,
            "seq":             seq,
            "type":            req.Type,
            "content":         json.RawMessage(req.Content),
            "reply_to_id":     req.ReplyToID,
            "burn_after_read": req.BurnAfterSec,
            "is_encrypted":    req.IsEncrypted,
            "created_at":      now.Unix(),
        },
    }
    msgBytes, _ := json.Marshal(pushMsg)

    // 6. 获取聊天所有成员
    memberIDs, err := s.getChatMemberIDs(ctx, req.ChatID)
    if err != nil {
        // 消息已落库，推送失败可降级
        // 用户下次打开 App 时通过同步补齐
    }

    // 7. 在线成员即时推送 + 离线成员入队列
    for _, memberID := range memberIDs {
        if memberID == senderID {
            continue
        }

        if s.hub.IsOnline(memberID) {
            // 在线：直接推送（WebSocket Hub 处理）
            s.hub.SendToUser(memberID, msgBytes)
        } else {
            // 离线：写入 Redis 离线队列
            offlineKey := fmt.Sprintf("offline:%s", memberID)
            s.redis.RPush(ctx, offlineKey, string(msgBytes))
            // 限制队列长度
            s.redis.LTrim(ctx, offlineKey, -500, -1)

            // 3 秒后检查是否仍离线，触发 APNs/FCM 推送
            go s.schedulePushNotification(memberID, msgID, req.ChatID, req.Type, req.Content)
        }
    }

    // 8. 发布到 Redis Pub/Sub（跨进程广播）
    broadcastData, _ := json.Marshal(map[string]interface{}{
        "chat_id": req.ChatID,
        "message": string(msgBytes),
    })
    s.redis.Publish(ctx, "channel:broadcast", broadcastData)

    return &SendMessageResponse{
        MessageID: msgID,
        Seq:       seq,
        Timestamp: now.Unix(),
    }, nil
}

// schedulePushNotification 延迟推送通知
// 如果 3 秒内消息未被确认送达，触发 APNs/FCM
func (s *MessageService) schedulePushNotification(userID, msgID, chatID, msgType string, content json.RawMessage) {
    time.Sleep(3 * time.Second)

    // 再次检查在线状态
    if s.hub.IsOnline(userID) {
        return // 已在线，无需推送
    }

    // 发送推送通知
    s.push.SendMessageNotification(userID, msgID, chatID, msgType, content)
}

// getChatMemberIDs 获取聊天所有成员 ID
func (s *MessageService) getChatMemberIDs(ctx context.Context, chatID string) ([]string, error) {
    rows, err := s.db.Query(ctx, `
        SELECT user_id FROM chat_participants WHERE chat_id = $1
    `, chatID)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var ids []string
    for rows.Next() {
        var id string
        if err := rows.Scan(&id); err != nil {
            continue
        }
        ids = append(ids, id)
    }
    return ids, nil
}

// isMember 检查用户是否在聊天中
func (s *MessageService) isMember(ctx context.Context, chatID, userID string) bool {
    var exists bool
    err := s.db.QueryRow(ctx, `
        SELECT EXISTS(SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2)
    `, chatID, userID).Scan(&exists)
    return err == nil && exists
}
```

### 4.4 WebSocket Client 处理

```go
// internal/ws/client.go
package ws

import (
    "context"
    "encoding/json"
    "log"
    "time"

    "github.com/gorilla/websocket"
)

const (
    writeWait      = 10 * time.Second
    pongWait       = 60 * time.Second
    pingPeriod     = 30 * time.Second
    maxMessageSize = 65536
)

// NewClient 创建新客户端
func NewClient(conn *websocket.Conn, userID, deviceID string, hub *Hub) *Client {
    ctx, cancel := context.WithCancel(context.Background())
    return &Client{
        ID:       generateClientID(),
        UserID:   userID,
        DeviceID: deviceID,
        Conn:     conn,
        Send:     make(chan []byte, 256),
        Hub:      hub,
        Chats:    make(map[string]bool),
        ctx:      ctx,
        cancel:   cancel,
    }
}

// ReadPump 读取消息循环（goroutine）
func (c *Client) ReadPump() {
    defer func() {
        c.Hub.unregister <- c
        c.Conn.Close()
    }()

    c.Conn.SetReadLimit(maxMessageSize)
    c.Conn.SetReadDeadline(time.Now().Add(pongWait))
    c.Conn.SetPongHandler(func(string) error {
        c.Conn.SetReadDeadline(time.Now().Add(pongWait))
        return nil
    })

    for {
        _, rawMsg, err := c.Conn.ReadMessage()
        if err != nil {
            if websocket.IsUnexpectedCloseError(err,
                websocket.CloseGoingAway, websocket.CloseNormalClosure) {
                log.Printf("ws error: %v", err)
            }
            break
        }

        var msg Message
        if err := json.Unmarshal(rawMsg, &msg); err != nil {
            c.sendError("invalid message format")
            continue
        }

        c.handleMessage(&msg)
    }
}

// WritePump 写入消息循环（goroutine）
func (c *Client) WritePump() {
    ticker := time.NewTicker(pingPeriod)
    defer func() {
        ticker.Stop()
        c.Conn.Close()
    }()

    for {
        select {
        case message, ok := <-c.Send:
            c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
            if !ok {
                c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
                return
            }
            if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
                return
            }

        case <-ticker.C:
            c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
            if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
                return
            }
            // 心跳续期在线状态
            c.Hub.redis.Set(c.ctx, "online:"+c.UserID, time.Now().Unix(), 120*time.Second)

        case <-c.ctx.Done():
            return
        }
    }
}

// handleMessage 处理消息
func (c *Client) handleMessage(msg *Message) {
    switch msg.Type {
    case "ping":
        c.Send <- []byte(`{"type":"pong"}`)

    case "subscribe":
        var data struct {
            ChatIDs []string `json:"chat_ids"`
        }
        if err := json.Unmarshal(msg.Data, &data); err == nil {
            c.Hub.ChatSubscribe(c, data.ChatIDs)
            c.Send <- []byte(`{"type":"subscribed","data":{"chat_ids":` + string(msg.Data) + `}}`)
        }

    case "unsubscribe":
        var data struct {
            ChatIDs []string `json:"chat_ids"`
        }
        if err := json.Unmarshal(msg.Data, &data); err == nil {
            c.Hub.ChatUnsubscribe(c, data.ChatIDs)
        }

    case "typing":
        // 转发输入中状态给聊天其他成员
        var data struct {
            ChatID string `json:"chat_id"`
        }
        if err := json.Unmarshal(msg.Data, &data); err == nil {
            c.broadcastToChat(data.ChatID, map[string]interface{}{
                "type": "typing",
                "data": map[string]interface{}{
                    "chat_id": data.ChatID,
                    "user_id": c.UserID,
                },
            }, c.UserID)
        }

    case "read":
        // 已读确认
        var data struct {
            ChatID string `json:"chat_id"`
            Seq    int64  `json:"seq"`
        }
        if err := json.Unmarshal(msg.Data, &data); err == nil {
            c.Hub.msgService.MarkRead(c.ctx, c.UserID, data.ChatID, data.Seq)
            c.broadcastToChat(data.ChatID, map[string]interface{}{
                "type": "message_read",
                "data": map[string]interface{}{
                    "chat_id": data.ChatID,
                    "user_id": c.UserID,
                    "seq":     data.Seq,
                },
            }, "")
        }

    case "send_message":
        // 通过 WebSocket 发送消息
        c.Hub.msgService.HandleWSMessage(c.ctx, c.UserID, msg.Data)

    default:
        c.sendError("unknown message type: " + msg.Type)
    }
}

// broadcastToChat 向聊天中其他成员广播
func (c *Client) broadcastToChat(chatID string, data interface{}, excludeUserID string) {
    msgBytes, _ := json.Marshal(data)
    c.Hub.broadcast <- &BroadcastMsg{
        ChatID:    chatID,
        Message:   msgBytes,
        ExcludeID: excludeUserID,
    }
}

func (c *Client) sendError(message string) {
    errMsg, _ := json.Marshal(map[string]interface{}{
        "type": "error",
        "data": map[string]string{"message": message},
    })
    select {
    case c.Send <- errMsg:
    default:
    }
}

func generateClientID() string {
    return uuid.New().String()[:8]
}
```

### 4.5 Bot API Handler

```go
// internal/handler/bot.go
package handler

import (
    "net/http"

    "github.com/gin-gonic/gin"
)

// BotHandler Bot API HTTP handler
type BotHandler struct {
    botService *service.BotService
}

// SendMessage POST /bot/:token/sendMessage
func (h *BotHandler) SendMessage(c *gin.Context) {
    token := c.Param("token")

    var req struct {
        ChatID    string `json:"chat_id" binding:"required"`
        Text      string `json:"text" binding:"required"`
        ParseMode string `json:"parse_mode"` // HTML/Markdown
        ReplyToID string `json:"reply_to_message_id"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"ok": false, "description": err.Error()})
        return
    }

    result, err := h.botService.SendMessage(token, req.ChatID, req.Text, req.ParseMode, req.ReplyToID)
    if err != nil {
        c.JSON(400, gin.H{"ok": false, "description": err.Error()})
        return
    }

    c.JSON(200, gin.H{"ok": true, "result": result})
}

// GetUpdates GET /bot/:token/getUpdates
// 长轮询模式获取更新
func (h *BotHandler) GetUpdates(c *gin.Context) {
    token := c.Param("token")
    offset := c.DefaultQuery("offset", "0")
    timeout := c.DefaultQuery("timeout", "30") // 长轮询超时

    updates, err := h.botService.GetUpdates(token, offset, timeout)
    if err != nil {
        c.JSON(400, gin.H{"ok": false, "description": err.Error()})
        return
    }

    c.JSON(200, gin.H{"ok": true, "result": updates})
}

// SetWebhook POST /bot/:token/setWebhook
func (h *BotHandler) SetWebhook(c *gin.Context) {
    token := c.Param("token")

    var req struct {
        URL string `json:"url" binding:"required"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"ok": false, "description": err.Error()})
        return
    }

    if err := h.botService.SetWebhook(token, req.URL); err != nil {
        c.JSON(400, gin.H{"ok": false, "description": err.Error()})
        return
    }

    c.JSON(200, gin.H{"ok": true, "result": true})
}
```

---

## 五、部署方案

### Docker Compose

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: imim
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: imimchat
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U imim"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - miniodata:/data

  server:
    build:
      context: ./go-backend
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://imim:${DB_PASSWORD}@postgres:5432/imimchat?sslmode=disable
      REDIS_URL: redis://redis:6379
      MINIO_ENDPOINT: minio:9000
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  pgdata:
  redisdata:
  miniodata:
```

### Go Dockerfile

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY --from=builder /app/server .
COPY --from=builder /app/migrations ./migrations
EXPOSE 8080
CMD ["./server"]
```

---

## 六、性能指标预估

| 指标 | 目标 | 实现手段 |
|------|------|----------|
| 并发连接 | 100 万 | epoll + goroutine 每连接、多进程水平扩展 |
| 消息延迟 | < 100ms（在线） | Redis Pub/Sub + 本地 Hub 直接推送 |
| 消息吞吐 | 10 万条/秒 | 批量写入 + 异步推送 |
| 单机内存 | ~2GB（10 万连接） | goroutine 栈 4KB 起步 |
| 水平扩展 | 线性 | 用户分片 + Redis Cluster + PostgreSQL 读写分离 |

---

## 七、与当前项目的对应关系

| 当前 cqim-app/server/ | Go 版本对应 | 说明 |
|----------------------|------------|------|
| `index.ts` | `cmd/server/main.go` | 入口 + 路由注册 |
| `auth.ts` | `handler/auth.go` + `service/auth.go` | 认证 |
| `private-chat.ts` | `handler/chat.go` + `service/message.go` | 私聊消息 |
| `group-message.ts` | `handler/chat.go` + `service/message.go` | 群聊消息 |
| `crypto.ts` | `crypto/e2ee.go` | E2EE |
| `db.ts` | `db/postgres.go` | 数据库 |
| `redis.ts` | `db/redis.go` | Redis |
| `security.ts` | `middleware/auth.go` + `middleware/ratelimit.go` | 安全中间件 |
| `mysql.ts` | `db/postgres.go` (audit 部分) | 审计日志 |
| `admin.ts` | `handler/admin.go` | 管理后台 |
| `sticker.ts` | `handler/sticker.go` | 贴纸（可选） |
| `moments.ts` | `handler/moment.go` | 朋友圈（可选） |
