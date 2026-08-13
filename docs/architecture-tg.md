# 类 Telegram 即时通讯项目架构图

## 架构全景图

```mermaid
flowchart TB
    %% Client Layer
    subgraph Client["客户端层"]
        IOS["iOS App"]
        Android["Android App"]
        Web["Web App"]
        Desktop["Windows / macOS / Linux 客户端"]
    end

    %% Access Layer
    subgraph Access["接入与加速层"]
        DNS["DNSPod"]
        Edge["EdgeOne / CDN"]
        GAAP["全球应用加速 GAAP"]
        WAF["WAF / Anti-DDoS"]
        CLB["CLB / API Gateway"]
    end

    %% Core Business Layer
    subgraph Biz["核心业务服务层"]
        Account["账号服务\n注册/登录/二步验证/设备管理"]
        User["用户资料服务\n昵称/头像/用户名"]
        Relation["关系链服务\n好友/黑名单/联系人"]
        Group["群组服务\n普通群/超级群/权限/禁言"]
        Channel["频道服务\n公开频道/私有频道/订阅/广播"]
        Bot["Bot 平台\nToken/Webhook/命令/限流"]
        FileSvc["文件服务\n上传/转发/权限/预览"]
        Search["搜索服务\n消息/频道/群/Bot/文件"]
        Notify["通知服务\n离线推送/系统通知"]
        Risk["风控服务\n反垃圾/限流/封禁"]
        Audit["审核后台\n举报/人工审核/内容治理"]
        Admin["运营管理后台"]
    end

    %% Communication Layer
    subgraph Comm["通信能力层"]
        IM["腾讯云 IM / Chat\n单聊/群聊/消息/离线/历史"]
        TRTC["TRTC\n语音/视频/群通话"]
        TPNS["TPNS\n移动端离线推送"]
    end

    %% Data Layer
    subgraph Data["数据与中间件层"]
        DB["TDSQL-C / MySQL / PostgreSQL\n用户/群/频道/Bot/权限"]
        Redis["Redis\n会话/热点/限流/缓存"]
        MQ["CKafka / TDMQ\n异步任务/广播/审核流转"]
        ES["Elasticsearch / 搜索服务\n全文索引"]
        COS["COS 对象存储\n图片/语音/视频/文件/贴纸"]
        CI["数据万象 CI\n缩略图/转码/图片处理"]
    end

    %% Security Ops
    subgraph SecOps["安全、治理与运维层"]
        Content["内容安全\n文本/图片/音频/视频审核"]
        CLS["CLS 日志服务"]
        Monitor["云监控"]
        APM["APM 应用性能监控"]
        CAM["CAM / 操作审计"]
        Alert["告警通知"]
    end

    %% Client to Access
    Client --> DNS
    DNS --> Edge
    DNS --> GAAP
    Edge --> WAF
    GAAP --> WAF
    WAF --> CLB

    %% Access to Business
    CLB --> Account
    CLB --> User
    CLB --> Relation
    CLB --> Group
    CLB --> Channel
    CLB --> Bot
    CLB --> FileSvc
    CLB --> Search
    CLB --> Admin

    %% Business to Communication
    Account --> IM
    Group --> IM
    Channel --> IM
    Bot --> IM
    Notify --> TPNS
    Group --> TRTC
    Account --> TRTC

    %% Business to Data
    Account --> DB
    User --> DB
    Relation --> DB
    Group --> DB
    Channel --> DB
    Bot --> DB
    FileSvc --> COS
    FileSvc --> DB
    Search --> ES
    Risk --> Redis
    Group --> Redis
    Channel --> Redis
    Channel --> MQ
    Bot --> MQ
    Audit --> MQ
    COS --> CI
    COS --> Edge

    %% Security & Ops
    IM --> Content
    FileSvc --> Content
    Channel --> Content
    Bot --> Content
    Risk --> Audit
    Audit --> Admin

    Biz --> CLS
    Comm --> CLS
    Data --> CLS
    Biz --> Monitor
    Biz --> APM
    SecOps --> Alert
    Admin --> CAM
```

---

## 架构说明

### 1. 客户端层
覆盖 iOS / Android / Web / Windows / macOS / Linux 桌面端。核心要求：多端同步、设备管理、消息一致性、草稿同步。

### 2. 接入与加速层
保证访问稳定性和安全性：DNSPod 域名解析、EdgeOne/CDN 文件加速、GAAP 全球加速、WAF/Anti-DDoS 防护、CLB/API Gateway 统一入口。

### 3. 核心业务服务层（自研重点）
账号服务、用户资料服务、关系链服务、普通群/超级群服务、频道服务、Bot 平台、文件服务、搜索服务、通知服务、风控服务、审核后台、运营管理后台。超级群、频道、Bot、搜索、风控是类 TG 的关键差异点。

### 4. 腾讯云通信能力层
对接腾讯云 IM/Chat（单聊/群聊/消息）、TRTC（音视频通话）、TPNS（移动端推送）。

### 5. 数据与中间件层
TDSQL-C/MySQL/PostgreSQL（业务数据）、Redis（缓存/限流）、CKafka/TDMQ（异步任务/广播）、Elasticsearch（全文搜索）、COS（文件存储）、数据万象 CI（图片处理）。

### 6. 安全治理和运维层
内容安全、举报处理、人工审核、封禁管理、日志检索、监控告警、APM、操作审计。

---

## 当前项目对照与落地分析

### 已具备的能力（cqim-app + imimchat）

| 架构层级 | 架构图组件 | 当前实现 | 状态 |
|---------|-----------|---------|------|
| 接入层 | CLB/Nginx | nginx/wed.imim.chat.conf（HTTPS/SSL/限流/安全头） | ✅ 生产就绪 |
| 接入层 | CDN | EdgeOne（已连接） | ✅ 已接入 |
| 通信层 | IM 单聊/群聊 | cqim-app/server/private-chat.ts + group-message.ts | ✅ 生产就绪 |
| 通信层 | TRTC 音视频 | cqim-app（TRTC SDK v5）+ register-service/trtc.py | ✅ 已集成 |
| 通信层 | 推送 | APNs + FCM + 个推（apns.ts/fcm.ts/getui.ts） | ✅ 三通道覆盖 |
| 业务层 | 账号/资料 | server/auth.ts + User model | ✅ 完整 |
| 业务层 | 好友关系 | server/friend.ts | ✅ 完整 |
| 业务层 | 群组 | server/group-message.ts（支持万人群） | ✅ 核心功能 |
| 业务层 | 文件服务 | COS + MinIO 双存储 | ✅ 完整 |
| 业务层 | E2EE 加密 | Signal Protocol + MLS | ✅ 已实现 |
| 数据层 | PostgreSQL | 当前用 MongoDB + SQLite，PostgreSQL 在 Go 版设计中 | 🔶 架构设计中 |
| 数据层 | Redis | Redis 7.2（会话/缓存/PubSub） | ✅ 生产就绪 |
| 数据层 | COS + CI | cos-signer.ts + imageMogr2 实时缩略图 | ✅ 完整 |

### 需要新建的能力

| 架构图组件 | 当前缺失 | 优先级 |
|-----------|---------|--------|
| 频道服务 | 无 Channel 概念（最核心的 TG 差异点） | P0 |
| 频道服务 | ✅ 已实现 — server/channel.ts + ChannelsPage + ChannelDetailPage | ✅ 已完成 |
| 超级群组 | 当前群组上限较低，无慢速模式/精细权限 | P0 |
| Bot 平台 | 仅有基础 OneBot，无完整 Bot API | P0 |
| 搜索服务 | 无 Elasticsearch 全文索引 | P1 |
| 风控服务 | 基础 IP 限流，无反垃圾/内容审核 | P1 |
| MQ 消息队列 | 当前用 Redis Pub/Sub，无持久化 MQ | P1 |
| 桌面客户端 | 无原生桌面端 | P2 |
| GAAP 全球加速 | 未配置 | P2 |

### MVP 第一阶段推荐范围

基于当前 cqim-app 的成熟度，MVP 应聚焦三个核心缺口：

1. **频道服务** — ✅ 已实现：新建 channel 数据模型和 API，复用现有的消息和推送基础设施
2. **Bot 平台升级** — 从 OneBot 适配升级为类 Telegram Bot API
3. **搜索服务** — 接入 Elasticsearch，对消息和频道建立全文索引

这三个能力补上后，当前项目就能覆盖 TG 约 80% 的核心体验。
