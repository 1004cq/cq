# DoveIM 后续开发文档 v2.0

> **文档版本**：v2.0  
> **编写日期**：2026 年 4 月 6 日  
> **作者**：Manus AI  
> **GitHub 仓库**：https://github.com/1004cq/cqim  
> **在线预览**：https://imq.manus.space

---

## 一、项目现状概述

DoveIM（灵鸽 IM）v1.0 已完成前端原型的全部核心功能开发，当前版本采用 React 19 + TypeScript + Tailwind CSS 4 构建，以纯前端静态应用的形式运行。所有数据均存储在浏览器内存中（React Context + useReducer），通讯、加密、音视频通话等模块均为模拟实现。

### 1.1 已实现功能清单

| 模块 | 功能 | 实现方式 | 状态 |
|------|------|---------|------|
| 用户认证 | 手机号 + 验证码登录 | 前端模拟，任意号码 + 123456 | 已完成 |
| 消息列表 | 会话排序、置顶、免打扰、未读角标 | React Context 状态管理 | 已完成 |
| 聊天详情 | 文本/图片消息、E2EE 加密标识、消息气泡 | 模拟数据 + XOR 演示加密 | 已完成 |
| 通讯录 | 首字母分组、在线状态、联系人搜索 | 前端静态数据 | 已完成 |
| 朋友圈 | Feed 流、九宫格图片、点赞评论 | React Context 状态管理 | 已完成 |
| 音视频通话 | 语音/视频通话 UI、呼吸动画 | 模拟信令，无真实媒体流 | 已完成 |
| 个人中心 | 用户信息、设置菜单、退出登录 | 前端静态页面 | 已完成 |
| PWA | manifest.json、可安装配置 | 基础 PWA 配置 | 已完成 |

### 1.2 当前技术架构

```
client/
├── src/
│   ├── App.tsx              ← 主入口，状态驱动路由
│   ├── contexts/
│   │   └── AppContext.tsx    ← 全局状态（useReducer）
│   ├── lib/
│   │   ├── store.ts         ← 数据模型 + 模拟数据
│   │   ├── crypto.ts        ← E2EE 模拟（XOR 演示）
│   │   ├── websocket.ts     ← WebSocket 模拟层
│   │   └── webrtc.ts        ← WebRTC 模拟层
│   ├── pages/               ← 6 个页面组件
│   └── components/          ← 可复用 UI 组件
```

### 1.3 需要升级的核心差距

当前 v1.0 与文档规划的完整系统之间存在以下关键差距，后续开发将围绕这三个方向逐步填补。

| 差距领域 | 当前状态 | 目标状态 |
|---------|---------|---------|
| 后端服务 | 无后端，纯前端模拟 | WuKongIM (Go) + PostgreSQL + Redis |
| 实时通讯 | MockWebSocket 类 | 真实 WebSocket 长连接 |
| 端对端加密 | XOR 演示加密 | libsignal (Signal Protocol) |
| 音视频通话 | 模拟 UI，无媒体流 | WebRTC + Mediasoup SFU |
| 数据持久化 | 浏览器内存 | PostgreSQL + IndexedDB 本地缓存 |
| 用户认证 | 任意验证码登录 | JWT + SMS 真实验证 |

---

## 二、阶段一：升级为全栈项目

### 2.1 目标

将 DoveIM 从纯前端原型升级为具备真实后端服务的全栈应用，实现多用户实时通讯和消息持久化存储。

### 2.2 后端技术选型

根据 v1.0 开发文档的五层架构设计，后端技术栈建议如下：

| 层级 | 组件 | 技术选型 | 说明 |
|------|------|---------|------|
| L1 通讯层 | 消息路由 | WuKongIM Core (Go) | 开源 IM 引擎，支持长连接、消息路由、离线推送 |
| L2 加密层 | 密钥管理 | libsignal-protocol-typescript | Signal Protocol 的 TypeScript 实现 |
| 数据库 | 关系型 | PostgreSQL 15+ | 用户、会话、消息、朋友圈等核心数据 |
| 缓存 | 内存 | Redis 7+ | 在线状态、会话缓存、消息队列 |
| 对象存储 | 文件 | MinIO / S3 | 图片、语音、文件等媒体资源 |
| 认证 | JWT | jsonwebtoken + bcrypt | 用户注册登录、Token 刷新 |

### 2.3 数据库设计

#### 2.3.1 核心表结构

**users 表 — 用户基础信息**

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(20) UNIQUE NOT NULL,
    nickname        VARCHAR(50) NOT NULL,
    avatar_url      TEXT,
    bio             VARCHAR(200),
    status          VARCHAR(10) DEFAULT 'offline',  -- online/offline/busy
    identity_key    TEXT,          -- Signal Protocol 身份密钥（公钥）
    signed_prekey   TEXT,          -- 签名预密钥
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone);
```

**conversations 表 — 会话**

```sql
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(10) NOT NULL,  -- private/group
    name            VARCHAR(100),
    avatar_url      TEXT,
    creator_id      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversation_members (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(10) DEFAULT 'member',  -- owner/admin/member
    is_pinned       BOOLEAN DEFAULT FALSE,
    is_muted        BOOLEAN DEFAULT FALSE,
    unread_count    INTEGER DEFAULT 0,
    last_read_at    TIMESTAMPTZ,
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);
```

**messages 表 — 消息**

```sql
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID REFERENCES users(id),
    content_type    SMALLINT NOT NULL,     -- 1:文本 2:图片 3:文件 4:语音 5:位置 10:撤回 ...
    ciphertext      TEXT,                  -- 加密后的消息内容
    plaintext       TEXT,                  -- 系统消息等不加密的内容
    metadata        JSONB,                 -- 附加信息（图片尺寸、文件名、时长等）
    reply_to_id     UUID REFERENCES messages(id),
    is_revoked      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    server_time     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
```

**prekeys 表 — Signal Protocol 预密钥**

```sql
CREATE TABLE prekeys (
    id              SERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    prekey_id       INTEGER NOT NULL,
    public_key      TEXT NOT NULL,
    is_used         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, prekey_id)
);
```

**moments 表 — 朋友圈**

```sql
CREATE TABLE moments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT,
    images          TEXT[],                -- 图片 URL 数组
    visibility      VARCHAR(10) DEFAULT 'friends',  -- public/friends/private
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE moment_likes (
    moment_id       UUID REFERENCES moments(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (moment_id, user_id)
);

CREATE TABLE moment_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moment_id       UUID REFERENCES moments(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    reply_to_id     UUID REFERENCES moment_comments(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2.3.2 Redis 数据结构

```
# 用户在线状态
user:online:{userId}           → "1" (TTL 60s, 心跳续期)

# 会话最后消息缓存
conv:last_msg:{conversationId} → JSON { content, senderId, timestamp }

# 未读计数
conv:unread:{conversationId}:{userId} → INTEGER

# 正在输入指示器
typing:{conversationId}:{userId} → "1" (TTL 5s)

# WebSocket 连接映射
ws:conn:{userId}               → connectionId
```

### 2.4 后端 API 设计

#### 2.4.1 RESTful API 端点

**认证模块**

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | `/api/auth/send-code` | 发送验证码 | `{ phone }` |
| POST | `/api/auth/login` | 验证码登录 | `{ phone, code }` |
| POST | `/api/auth/refresh` | 刷新 Token | `{ refreshToken }` |
| GET | `/api/auth/me` | 获取当前用户 | — |

**用户模块**

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| GET | `/api/users/:id` | 获取用户信息 | — |
| PUT | `/api/users/profile` | 更新个人资料 | `{ nickname, avatar, bio }` |
| GET | `/api/users/search?q=` | 搜索用户 | — |
| POST | `/api/users/prekeys` | 上传预密钥 | `{ identityKey, signedPreKey, preKeys[] }` |
| GET | `/api/users/:id/prekey-bundle` | 获取预密钥包 | — |

**会话模块**

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| GET | `/api/conversations` | 获取会话列表 | — |
| POST | `/api/conversations` | 创建会话 | `{ type, memberIds, name? }` |
| PUT | `/api/conversations/:id/pin` | 置顶/取消置顶 | `{ isPinned }` |
| PUT | `/api/conversations/:id/mute` | 静音/取消静音 | `{ isMuted }` |
| DELETE | `/api/conversations/:id` | 删除会话 | — |

**消息模块**

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| GET | `/api/messages/:conversationId` | 获取历史消息 | `?before=&limit=50` |
| POST | `/api/messages/:conversationId` | 发送消息 | `{ contentType, ciphertext, metadata? }` |
| PUT | `/api/messages/:id/revoke` | 撤回消息 | — |
| POST | `/api/messages/:id/reaction` | 添加表情回应 | `{ emoji }` |

**朋友圈模块**

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| GET | `/api/moments` | 获取动态列表 | `?before=&limit=20` |
| POST | `/api/moments` | 发布动态 | `{ content, images[], visibility }` |
| POST | `/api/moments/:id/like` | 点赞/取消 | — |
| POST | `/api/moments/:id/comment` | 评论 | `{ content, replyToId? }` |

**文件上传**

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | `/api/upload/image` | 上传图片 | `multipart/form-data` |
| POST | `/api/upload/file` | 上传文件 | `multipart/form-data` |
| POST | `/api/upload/voice` | 上传语音 | `multipart/form-data` |

#### 2.4.2 WebSocket 协议设计

WebSocket 连接建立后，客户端与服务端通过 JSON 帧进行通信。连接地址为 `wss://api.doveIM.com/ws?token={jwt}`。

**客户端 → 服务端（上行消息）**

```typescript
// 发送聊天消息
interface WS_SendMessage {
  action: 'send_message';
  data: {
    conversationId: string;
    contentType: number;       // 1:文本 2:图片 3:文件 4:语音 ...
    ciphertext: string;        // E2EE 加密后的内容
    clientMsgId: string;       // 客户端去重 ID
    metadata?: Record<string, any>;
  };
}

// 标记已读
interface WS_MarkRead {
  action: 'mark_read';
  data: {
    conversationId: string;
    lastReadMsgId: string;
  };
}

// 正在输入
interface WS_Typing {
  action: 'typing';
  data: {
    conversationId: string;
  };
}

// 心跳
interface WS_Ping {
  action: 'ping';
}
```

**服务端 → 客户端（下行消息）**

```typescript
// 新消息推送
interface WS_NewMessage {
  event: 'new_message';
  data: {
    id: string;
    conversationId: string;
    senderId: string;
    contentType: number;
    ciphertext: string;
    metadata?: Record<string, any>;
    serverTime: number;
  };
}

// 已读回执
interface WS_ReadReceipt {
  event: 'read_receipt';
  data: {
    conversationId: string;
    userId: string;
    lastReadMsgId: string;
  };
}

// 在线状态变更
interface WS_PresenceChange {
  event: 'presence';
  data: {
    userId: string;
    status: 'online' | 'offline';
  };
}

// 正在输入指示
interface WS_TypingIndicator {
  event: 'typing';
  data: {
    conversationId: string;
    userId: string;
  };
}

// 消息撤回通知
interface WS_MessageRevoked {
  event: 'message_revoked';
  data: {
    messageId: string;
    conversationId: string;
  };
}
```

### 2.5 前端改造要点

#### 2.5.1 状态管理升级

当前的 `AppContext.tsx` 使用 `useReducer` 管理全部状态，升级后需要拆分为多个独立的状态域，并引入服务端数据同步机制。

```typescript
// 建议的状态管理架构
// 方案 A：继续使用 Context，但拆分为多个 Provider
AuthContext      → 用户认证状态、JWT Token 管理
ChatContext      → 会话列表、当前会话、消息列表
ContactContext   → 联系人列表、好友申请
MomentContext    → 朋友圈动态
CallContext      → 通话状态
WebSocketContext → 连接状态、消息分发

// 方案 B：引入 Zustand（推荐，更轻量）
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthStore {
  token: string | null;
  user: User | null;
  login: (phone: string, code: string) => Promise<void>;
  logout: () => void;
}

const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: async (phone, code) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ phone, code }),
        });
        const { token, user } = await res.json();
        set({ token, user });
      },
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'dove-auth' }
  )
);
```

#### 2.5.2 WebSocket 客户端重构

将 `lib/websocket.ts` 中的 `MockWebSocket` 替换为真实的 WebSocket 客户端，需要实现自动重连、心跳保活、消息队列等机制。

```typescript
// lib/websocket.ts — 重构后的核心结构
class DoveWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageQueue: any[] = [];  // 断线期间的消息队列

  connect(token: string) {
    this.ws = new WebSocket(`wss://${API_HOST}/ws?token=${token}`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.dispatchEvent(data);
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.scheduleReconnect(token);
    };
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.send({ action: 'ping' });
    }, 30000);
  }

  private scheduleReconnect(token: string) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(token);
    }, delay);
  }
}
```

#### 2.5.3 E2EE 加密层替换

将 `lib/crypto.ts` 中的 XOR 演示加密替换为 `@nicolo-ribaudo/libsignal-protocol-typescript` 或 `@nicolo-ribaudo/signal-protocol`，实现真正的 Signal Protocol。

```typescript
// lib/crypto.ts — 升级后的核心流程

// 1. 注册阶段：生成并上传密钥
async function registerKeys() {
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  const preKeys = await Promise.all(
    Array.from({ length: 100 }, (_, i) => KeyHelper.generatePreKey(i + 1))
  );

  // 上传到服务器
  await fetch('/api/users/prekeys', {
    method: 'POST',
    body: JSON.stringify({
      identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
        signature: arrayBufferToBase64(signedPreKey.signature),
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: arrayBufferToBase64(pk.keyPair.pubKey),
      })),
    }),
  });

  // 本地存储私钥（IndexedDB）
  await localStore.saveIdentityKeyPair(identityKeyPair);
  await localStore.saveSignedPreKey(signedPreKey);
  await localStore.savePreKeys(preKeys);
}

// 2. 建立会话：从服务器获取对方的 PreKey Bundle
async function establishSession(peerId: string) {
  const bundle = await fetch(`/api/users/${peerId}/prekey-bundle`).then(r => r.json());
  const address = new SignalProtocolAddress(peerId, 1);
  const sessionBuilder = new SessionBuilder(localStore, address);
  await sessionBuilder.processPreKey(bundle);
}

// 3. 加密消息
async function encryptMessage(peerId: string, plaintext: string) {
  const address = new SignalProtocolAddress(peerId, 1);
  const sessionCipher = new SessionCipher(localStore, address);
  const ciphertext = await sessionCipher.encrypt(new TextEncoder().encode(plaintext));
  return {
    type: ciphertext.type,  // 1: PreKeyWhisperMessage, 3: WhisperMessage
    body: arrayBufferToBase64(ciphertext.body),
  };
}

// 4. 解密消息
async function decryptMessage(senderId: string, ciphertext: { type: number; body: string }) {
  const address = new SignalProtocolAddress(senderId, 1);
  const sessionCipher = new SessionCipher(localStore, address);
  const plainBuffer = ciphertext.type === 3
    ? await sessionCipher.decryptWhisperMessage(base64ToArrayBuffer(ciphertext.body))
    : await sessionCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(ciphertext.body));
  return new TextDecoder().decode(plainBuffer);
}
```

### 2.6 实施步骤

本阶段建议分为 4 个迭代周期，每个周期约 1-2 周。

**迭代 2.1 — 基础后端搭建（第 1-2 周）**

首先搭建后端项目骨架，建立数据库连接，实现用户注册登录的完整流程。具体工作包括：初始化 Node.js + Express（或 Go + Gin）后端项目，配置 PostgreSQL 数据库并执行建表迁移，实现 `/api/auth/*` 系列接口（发送验证码、验证码校验、JWT 签发与刷新），前端 `LoginPage.tsx` 对接真实登录 API，以及实现 JWT 中间件保护需要认证的 API 端点。

**迭代 2.2 — WebSocket 实时通讯（第 3-4 周）**

建立 WebSocket 长连接服务，实现消息的实时收发。具体工作包括：搭建 WebSocket 服务端（ws 库或 Socket.IO），实现连接认证（从 URL 参数或首帧提取 JWT），实现消息的存储、转发和离线推送逻辑，前端重构 `websocket.ts` 对接真实 WebSocket，以及实现在线状态和正在输入指示器。

**迭代 2.3 — Signal Protocol 集成（第 5-6 周）**

将 E2EE 加密从演示模式升级为真实的 Signal Protocol。具体工作包括：集成 libsignal-protocol-typescript 库，实现密钥生成、上传、分发的完整流程，实现 X3DH 密钥协商和 Double Ratchet 消息加解密，使用 IndexedDB 持久化存储本地密钥材料，以及实现 Safety Number 验证功能。

**迭代 2.4 — 数据持久化与同步（第 7-8 周）**

实现消息和会话数据的完整持久化与多端同步。具体工作包括：实现消息分页加载（游标分页，每页 50 条），使用 IndexedDB 缓存本地消息实现离线可读，实现会话列表的增量同步机制，实现朋友圈动态的服务端存储与分页加载，以及实现文件上传服务（对接 MinIO 或 S3）。

---

## 三、阶段二：完善消息类型

### 3.1 目标

在文本和图片消息的基础上，新增语音消息录制播放、文件传输、位置分享等富媒体消息类型，使 DoveIM 具备完整的即时通讯能力。

### 3.2 消息类型扩展

根据 v1.0 文档定义的消息类型编号体系，需要实现以下新增类型：

| content_type | 类型名称 | 说明 | metadata 字段 |
|:---:|---------|------|--------------|
| 1 | 文本 | 纯文本消息（已实现） | — |
| 2 | 图片 | 图片消息（已实现） | `{ width, height, thumbnailUrl, originalUrl }` |
| 3 | 文件 | 文件传输 | `{ fileName, fileSize, fileType, downloadUrl }` |
| 4 | 语音 | 语音消息 | `{ duration, waveform, audioUrl }` |
| 5 | 位置 | 位置分享 | `{ latitude, longitude, address, staticMapUrl }` |
| 6 | 视频 | 短视频消息 | `{ duration, width, height, thumbnailUrl, videoUrl }` |
| 7 | 名片 | 联系人名片 | `{ userId, nickname, avatar }` |
| 10 | 撤回 | 消息撤回通知 | `{ originalMsgId, revokerName }` |
| 11 | 表情回应 | Reaction | `{ emoji, targetMsgId }` |

### 3.3 语音消息实现

语音消息是 IM 应用中使用频率最高的富媒体类型之一，需要实现录制、编码、上传、播放的完整链路。

#### 3.3.1 录制模块

```typescript
// hooks/useVoiceRecorder.ts
import { useState, useRef, useCallback } from 'react';

interface VoiceRecorderState {
  isRecording: boolean;
  duration: number;       // 秒
  waveform: number[];     // 波形数据（0-1 之间的振幅值）
}

export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceRecorderState>({
    isRecording: false,
    duration: 0,
    waveform: [],
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    });
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunksRef.current.push(event.data);
    };

    mediaRecorder.start(100);  // 每 100ms 收集一次数据

    // 实时采集波形
    const waveformData: number[] = [];
    timerRef.current = setInterval(() => {
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(dataArray);
      const amplitude = Math.max(...Array.from(dataArray).map(v => Math.abs(v - 128) / 128));
      waveformData.push(amplitude);
      setState(prev => ({
        ...prev,
        duration: prev.duration + 0.1,
        waveform: [...waveformData],
      }));
    }, 100);

    setState({ isRecording: true, duration: 0, waveform: [] });
  }, []);

  const stopRecording = useCallback(async (): Promise<{
    blob: Blob;
    duration: number;
    waveform: number[];
  }> => {
    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (!mediaRecorder) return;

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (timerRef.current) clearInterval(timerRef.current);
        resolve({
          blob,
          duration: state.duration,
          waveform: state.waveform,
        });
        setState({ isRecording: false, duration: 0, waveform: [] });
      };

      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    });
  }, [state]);

  return { ...state, startRecording, stopRecording };
}
```

#### 3.3.2 语音气泡组件

```tsx
// components/VoiceBubble.tsx
interface VoiceBubbleProps {
  audioUrl: string;
  duration: number;       // 秒
  waveform: number[];     // 波形数据
  isSelf: boolean;
}

export function VoiceBubble({ audioUrl, duration, waveform, isSelf }: VoiceBubbleProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  // 波形宽度随时长动态调整：最短 80px，最长 200px
  const barCount = Math.min(Math.max(Math.floor(duration * 4), 8), 40);
  const bubbleWidth = Math.min(80 + duration * 8, 200);

  return (
    <button onClick={togglePlay} style={{ width: bubbleWidth }}>
      <audio ref={audioRef} src={audioUrl}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / duration)}
        onEnded={() => { setIsPlaying(false); setProgress(0); }}
      />
      {/* 播放图标 */}
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
      {/* 波形可视化 */}
      <div className="flex items-center gap-[2px]">
        {Array.from({ length: barCount }, (_, i) => {
          const amplitude = waveform[Math.floor(i / barCount * waveform.length)] || 0.3;
          const isActive = i / barCount <= progress;
          return (
            <div key={i}
              className={`w-[2px] rounded-full transition-all ${
                isActive ? (isSelf ? 'bg-white' : 'bg-dove-green') : 'bg-current opacity-30'
              }`}
              style={{ height: `${8 + amplitude * 16}px` }}
            />
          );
        })}
      </div>
      {/* 时长 */}
      <span>{Math.ceil(duration)}"</span>
    </button>
  );
}
```

### 3.4 文件传输实现

#### 3.4.1 文件选择与上传

文件传输需要支持拖拽上传、进度显示和断点续传。对于大文件（超过 5MB），建议采用分片上传策略。

```typescript
// lib/fileUpload.ts
interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

async function uploadFile(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ url: string; fileId: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/file');
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percentage: Math.round((event.loaded / event.total) * 100),
        });
      }
    };

    xhr.onload = () => resolve(new Response(xhr.response));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(formData);
  });

  return response.json();
}
```

#### 3.4.2 文件消息气泡

```tsx
// components/FileBubble.tsx
interface FileBubbleProps {
  fileName: string;
  fileSize: string;       // "2.3 MB"
  fileType: string;       // "pdf", "docx", "zip" ...
  downloadUrl: string;
  isSelf: boolean;
}

// 根据文件类型返回对应图标和颜色
function getFileIcon(type: string) {
  const map: Record<string, { icon: LucideIcon; color: string }> = {
    pdf:  { icon: FileText, color: '#E74C3C' },
    doc:  { icon: FileText, color: '#2B579A' },
    docx: { icon: FileText, color: '#2B579A' },
    xls:  { icon: Sheet,    color: '#217346' },
    xlsx: { icon: Sheet,    color: '#217346' },
    zip:  { icon: Archive,  color: '#F39C12' },
    rar:  { icon: Archive,  color: '#F39C12' },
    // ... 更多类型
  };
  return map[type] || { icon: File, color: '#95A5A6' };
}
```

### 3.5 位置分享实现

位置分享需要集成地图 SDK，在发送端选择位置，在接收端展示静态地图预览。

#### 3.5.1 位置选择器

```tsx
// components/LocationPicker.tsx
// 使用高德地图 JS API 或 Google Maps API
interface LocationData {
  latitude: number;
  longitude: number;
  address: string;
  name: string;           // POI 名称
  staticMapUrl: string;   // 静态地图截图 URL
}

// 发送位置消息时的 metadata
const locationMetadata = {
  latitude: 34.2583,
  longitude: 108.9286,
  address: '陕西省西安市雁塔区大雁塔南广场',
  name: '大雁塔',
  staticMapUrl: `https://restapi.amap.com/v3/staticmap?location=${lng},${lat}&zoom=15&size=300*200&key=${AMAP_KEY}`,
};
```

#### 3.5.2 位置消息气泡

位置消息气泡展示静态地图缩略图、地点名称和详细地址。点击后可打开完整地图页面，支持导航跳转到系统地图应用。

### 3.6 视频消息实现

视频消息需要支持录制短视频（最长 15 秒）和从相册选择视频。上传前需要在前端生成缩略图，上传后服务端进行转码（H.264 + AAC）以确保跨平台兼容性。

```typescript
// 视频消息 metadata 结构
interface VideoMetadata {
  duration: number;        // 秒
  width: number;
  height: number;
  thumbnailUrl: string;    // 首帧缩略图
  videoUrl: string;        // 视频播放地址
  fileSize: number;        // 字节
}
```

### 3.7 实施步骤

**迭代 3.1 — 语音消息（第 1-2 周）**

实现语音录制（MediaRecorder API + Web Audio API 波形采集）、语音上传（Opus 编码 → 服务端存储）、语音播放（带波形动画的播放器组件），以及在 `ChatDetailPage.tsx` 中集成语音录制按钮（长按录制交互）。

**迭代 3.2 — 文件传输（第 3-4 周）**

实现文件选择（点击 + 拖拽）、分片上传与进度显示、文件消息气泡（图标 + 文件名 + 大小 + 下载按钮），以及服务端文件存储和下载接口。

**迭代 3.3 — 位置分享（第 5 周）**

集成高德地图或 Google Maps JS API，实现位置选择器（搜索 + 拖拽定位）、位置消息气泡（静态地图 + 地址文字），以及点击跳转到完整地图或系统导航。

**迭代 3.4 — 视频消息与名片（第 6 周）**

实现短视频录制（最长 15 秒）和相册选择、视频缩略图生成与上传、视频播放器组件（内联播放 + 全屏），以及联系人名片消息的发送与展示。

---

## 四、阶段三：消息搜索与聊天管理

### 4.1 目标

实现全局消息搜索、聊天记录导出、消息撤回和已读回执等精细化聊天管理功能，提升用户的消息管理效率和沟通体验。

### 4.2 全局消息搜索

#### 4.2.1 搜索架构

消息搜索需要支持两个层面：本地搜索（IndexedDB 中的已缓存消息）和服务端搜索（全量历史消息）。建议采用"本地优先、服务端补充"的策略。

```
用户输入关键词
    ↓
┌─────────────────────────────────────┐
│  前端搜索引擎（IndexedDB + Fuse.js）  │  ← 本地已缓存的消息
│  响应时间 < 50ms                      │
└─────────────┬───────────────────────┘
              ↓ 同时发起
┌─────────────────────────────────────┐
│  后端搜索 API（PostgreSQL 全文检索）   │  ← 全量历史消息
│  响应时间 < 500ms                     │
└─────────────┬───────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  结果合并去重 → 按相关度 + 时间排序    │
└─────────────────────────────────────┘
```

#### 4.2.2 后端全文检索

PostgreSQL 内置的 `tsvector` 和 `tsquery` 对中文支持有限，建议安装 `pg_jieba` 或 `zhparser` 扩展实现中文分词。

```sql
-- 添加全文检索索引
ALTER TABLE messages ADD COLUMN search_vector tsvector;

-- 使用 zhparser 中文分词
CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
ALTER TEXT SEARCH CONFIGURATION chinese
  ADD MAPPING FOR n,v,a,i,e,l WITH simple;

CREATE INDEX idx_messages_search ON messages USING gin(search_vector);

-- 更新触发器
CREATE OR REPLACE FUNCTION update_message_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('chinese', COALESCE(NEW.plaintext, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_message_search
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_message_search_vector();
```

**搜索 API**

```typescript
// GET /api/search?q=水墨画&scope=all&before=&limit=20
interface SearchResult {
  messages: {
    id: string;
    conversationId: string;
    conversationName: string;
    senderId: string;
    senderName: string;
    content: string;          // 高亮后的内容片段
    timestamp: number;
    contentType: number;
  }[];
  contacts: {
    id: string;
    nickname: string;
    avatar: string;
    phone: string;
  }[];
  moments: {
    id: string;
    authorName: string;
    content: string;
    timestamp: number;
  }[];
  total: number;
}
```

#### 4.2.3 前端搜索组件

```tsx
// components/GlobalSearch.tsx
// 搜索页面分为三个 Tab：聊天记录、联系人、朋友圈
// 聊天记录结果按会话分组展示，点击可跳转到对应消息位置

interface SearchPageProps {
  onClose: () => void;
}

export function GlobalSearch({ onClose }: SearchPageProps) {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'messages' | 'contacts' | 'moments'>('messages');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // 防抖搜索：输入停止 300ms 后触发
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      // 并行执行本地搜索和远程搜索
      const [localResults, remoteResults] = await Promise.all([
        searchLocal(query),
        searchRemote(query),
      ]);
      setResults(mergeResults(localResults, remoteResults));
      setIsSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="h-full flex flex-col">
      {/* 搜索输入框 */}
      {/* Tab 切换：聊天记录 | 联系人 | 朋友圈 */}
      {/* 搜索结果列表 */}
    </div>
  );
}
```

### 4.3 聊天记录导出

#### 4.3.1 导出格式

支持三种导出格式，满足不同场景需求：

| 格式 | 适用场景 | 包含内容 |
|------|---------|---------|
| TXT | 纯文本备份 | 时间戳 + 发送者 + 消息内容 |
| HTML | 可视化归档 | 完整聊天界面样式 + 图片内嵌 |
| JSON | 数据迁移 | 完整消息结构 + 元数据 |

#### 4.3.2 导出实现

```typescript
// lib/chatExport.ts

interface ExportOptions {
  conversationId: string;
  format: 'txt' | 'html' | 'json';
  dateRange?: { start: Date; end: Date };
  includeMedia?: boolean;     // 是否包含图片/文件
}

async function exportChat(options: ExportOptions): Promise<Blob> {
  // 1. 获取消息列表（本地 + 服务端补全）
  const messages = await fetchAllMessages(options.conversationId, options.dateRange);

  switch (options.format) {
    case 'txt':
      return exportAsTxt(messages);
    case 'html':
      return exportAsHtml(messages, options.includeMedia);
    case 'json':
      return exportAsJson(messages);
  }
}

function exportAsTxt(messages: Message[]): Blob {
  const lines = messages.map(msg => {
    const time = new Date(msg.timestamp).toLocaleString('zh-CN');
    const sender = getUserById(msg.senderId)?.nickname || msg.senderId;
    const content = msg.contentType === 1 ? msg.plaintext
      : msg.contentType === 2 ? '[图片]'
      : msg.contentType === 4 ? `[语音 ${msg.metadata?.duration}秒]`
      : '[其他消息]';
    return `[${time}] ${sender}: ${content}`;
  });
  return new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
}

function exportAsHtml(messages: Message[], includeMedia?: boolean): Blob {
  // 生成带样式的 HTML 文件，模拟聊天界面
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>聊天记录导出</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; }
    .msg { margin: 8px 0; display: flex; }
    .msg.self { flex-direction: row-reverse; }
    .bubble { padding: 8px 12px; border-radius: 12px; max-width: 70%; }
    .bubble.other { background: #fff; }
    .bubble.self { background: #E8F5E9; }
    .time { font-size: 11px; color: #999; text-align: center; margin: 16px 0 8px; }
    .sender { font-size: 12px; color: #666; margin-bottom: 2px; }
  </style>
</head>
<body>
  ${messages.map(renderMessageHtml).join('\n')}
</body>
</html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}
```

### 4.4 消息撤回

#### 4.4.1 撤回规则

消息撤回遵循以下业务规则：普通用户只能撤回发送后 2 分钟内的消息，群管理员可以撤回任意成员的消息且不受时间限制，撤回后所有端同步显示"某某撤回了一条消息"的系统提示，被撤回的消息在数据库中标记 `is_revoked = true` 但不物理删除。

#### 4.4.2 撤回流程

```
发送者点击"撤回"
    ↓
前端检查时间限制（< 2 分钟）
    ↓
PUT /api/messages/:id/revoke
    ↓
服务端验证权限 + 时间
    ↓
更新数据库 is_revoked = true
    ↓
通过 WebSocket 广播撤回事件
    ↓
所有在线客户端收到 message_revoked 事件
    ↓
前端替换消息内容为系统提示
```

#### 4.4.3 前端实现

```typescript
// AppContext 新增 Action
| { type: 'REVOKE_MESSAGE'; conversationId: string; messageId: string; revokerName: string }

// Reducer 处理
case 'REVOKE_MESSAGE': {
  const msgs = state.messages[action.conversationId] || [];
  return {
    ...state,
    messages: {
      ...state.messages,
      [action.conversationId]: msgs.map(m =>
        m.id === action.messageId
          ? {
              ...m,
              type: 'system' as const,
              content: `${action.revokerName}撤回了一条消息`,
              isRevoked: true,
            }
          : m
      ),
    },
  };
}
```

### 4.5 已读回执

#### 4.5.1 已读回执机制

已读回执分为单聊和群聊两种场景。单聊场景下，当接收方打开聊天窗口并滚动到消息可视区域时，自动发送已读回执；群聊场景下，记录每个成员的最后已读消息 ID，发送者可以查看消息被多少人阅读。

**单聊已读状态流转**

```
sending → sent → delivered → read
   ↓        ↓        ↓         ↓
  发送中   已发送   已送达    已读
  (灰色)  (单勾)  (双勾灰)  (双勾绿)
```

#### 4.5.2 实现方案

```typescript
// hooks/useReadReceipt.ts
// 使用 IntersectionObserver 检测消息是否进入可视区域

export function useReadReceipt(conversationId: string) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const { markRead } = useAppActions();

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visibleMessages = entries
          .filter(e => e.isIntersecting)
          .map(e => e.target.getAttribute('data-msg-id'))
          .filter(Boolean);

        if (visibleMessages.length > 0) {
          const lastVisibleId = visibleMessages[visibleMessages.length - 1]!;
          // 发送已读回执到服务端
          ws.send({
            action: 'mark_read',
            data: { conversationId, lastReadMsgId: lastVisibleId },
          });
        }
      },
      { threshold: 0.5 }  // 消息 50% 可见时触发
    );

    return () => observerRef.current?.disconnect();
  }, [conversationId]);

  // 返回 ref 回调，用于注册消息元素
  const observeMessage = useCallback((element: HTMLElement | null) => {
    if (element && observerRef.current) {
      observerRef.current.observe(element);
    }
  }, []);

  return { observeMessage };
}
```

#### 4.5.3 已读状态 UI

```tsx
// 消息状态图标组件
function MessageStatus({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return <Clock size={12} className="text-muted-foreground" />;
    case 'sent':
      return <Check size={12} className="text-muted-foreground" />;
    case 'delivered':
      return <CheckCheck size={12} className="text-muted-foreground" />;
    case 'read':
      return <CheckCheck size={12} className="text-dove-green" />;
  }
}
```

### 4.6 实施步骤

**迭代 4.1 — 全局搜索（第 1-2 周）**

实现搜索 UI 组件（搜索框 + 三 Tab 结果展示），集成 Fuse.js 实现本地模糊搜索，开发后端搜索 API（PostgreSQL 全文检索 + zhparser 中文分词），以及实现搜索结果点击跳转到对应消息位置。

**迭代 4.2 — 消息撤回（第 3 周）**

实现消息长按菜单（复制、转发、撤回、删除），开发撤回 API 和 WebSocket 撤回事件广播，前端处理撤回事件并替换消息为系统提示，以及实现 2 分钟撤回时间限制的前后端校验。

**迭代 4.3 — 已读回执（第 4 周）**

实现 IntersectionObserver 检测消息可见性，开发已读回执的 WebSocket 上报和下发机制，实现消息状态图标（发送中 → 已发送 → 已送达 → 已读），以及群聊已读人数统计。

**迭代 4.4 — 聊天记录导出（第 5 周）**

实现 TXT / HTML / JSON 三种格式的导出功能，开发导出进度提示和大量消息的分批加载，HTML 格式导出需还原聊天界面样式，以及实现日期范围筛选和媒体文件包含选项。

---

## 五、项目路线图总览

以下是三个阶段的整体时间规划，总计约 19 周（约 5 个月）。

```
2026 Q2                                    2026 Q3
├── 4月 ──┤── 5月 ──┤── 6月 ──┤── 7月 ──┤── 8月 ──┤
│                                                    │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                │
│ 阶段一：全栈升级（8 周）                              │
│ 2.1 基础后端  2.2 WebSocket  2.3 E2EE  2.4 持久化   │
│                                                    │
│                 ░░░░░░░░░░░░░░░░░░░░░░░░           │
│                 阶段二：富媒体消息（6 周）              │
│                 3.1 语音  3.2 文件  3.3 位置  3.4 视频│
│                                                    │
│                                   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
│                                   阶段三：搜索管理（5周）│
│                                   4.1 搜索  4.2 撤回 │
│                                   4.3 已读  4.4 导出 │
└────────────────────────────────────────────────────┘
```

| 阶段 | 时长 | 核心交付物 | 里程碑 |
|------|------|----------|--------|
| 阶段一 | 8 周 | 全栈后端 + 实时通讯 + E2EE | 多用户可真实收发加密消息 |
| 阶段二 | 6 周 | 语音 + 文件 + 位置 + 视频 | 富媒体消息完整支持 |
| 阶段三 | 5 周 | 搜索 + 撤回 + 已读 + 导出 | 聊天管理功能完善 |

---

## 六、开发环境与工具建议

### 6.1 推荐开发工具链

| 工具 | 用途 | 说明 |
|------|------|------|
| Docker Compose | 本地开发环境 | 一键启动 PostgreSQL + Redis + MinIO |
| Prisma | ORM | TypeScript 友好的数据库 ORM，自动生成类型 |
| Vitest | 单元测试 | 与 Vite 深度集成，速度快 |
| Playwright | E2EE 测试 | 跨浏览器端到端测试 |
| GitHub Actions | CI/CD | 自动化测试、构建、部署 |

### 6.2 Docker Compose 开发环境

```yaml
# docker-compose.dev.yml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: doveIM
      POSTGRES_USER: dove
      POSTGRES_PASSWORD: dove_dev_2026
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - '9000:9000'
      - '9001:9001'
    volumes:
      - miniodata:/data

volumes:
  pgdata:
  miniodata:
```

### 6.3 环境变量配置

```bash
# .env.development
DATABASE_URL=postgresql://dove:dove_dev_2026@localhost:5432/doveIM
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
JWT_SECRET=dove-im-dev-secret-2026
SMS_PROVIDER=mock          # 开发环境使用模拟短信
```

---

## 七、安全与性能注意事项

### 7.1 安全清单

在全栈升级过程中，以下安全措施需要从第一天就纳入考虑：

所有 API 端点必须进行 JWT 认证校验，WebSocket 连接建立时需验证 Token 有效性。密码和敏感信息使用 bcrypt 或 argon2 进行哈希存储，永远不要以明文形式存储或传输。文件上传需要严格校验文件类型和大小限制（建议图片 10MB、文件 100MB、语音 5MB），防止恶意文件上传。所有用户输入在展示前必须进行 XSS 转义处理。数据库查询使用参数化查询防止 SQL 注入。CORS 配置仅允许已知的前端域名。Rate Limiting 限制 API 调用频率，特别是验证码发送接口（建议每分钟 1 次、每天 10 次）。

### 7.2 性能优化建议

消息列表应使用虚拟滚动（react-window 或 @tanstack/virtual）以支持大量消息的流畅渲染。图片消息需要生成缩略图，聊天列表中展示缩略图，点击后加载原图。WebSocket 消息采用二进制协议（Protocol Buffers）替代 JSON 可以显著减少带宽消耗。数据库查询需要合理使用索引，特别是消息表的 `(conversation_id, created_at)` 复合索引。Redis 缓存热点数据（会话列表、在线状态），减少数据库查询压力。前端使用 Service Worker 缓存静态资源，实现离线可访问。

---

> **文档结束**  
> 本文档为 DoveIM 后续三个阶段的开发指南，涵盖了从全栈升级到功能完善的完整路径。建议按照阶段顺序逐步推进，每个迭代完成后进行代码审查和功能测试，确保质量稳步提升。
