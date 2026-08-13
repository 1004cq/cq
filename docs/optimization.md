# imimchat 优化方案与路线图

**中文版** | [English Version](./optimization_en.md)

## 概述

本文档从**安全性、稳定性、性能、用户体验、功能扩展**五个维度，对 imimchat 当前部署进行全面评估，并给出优先级排序的优化建议。

---

## 一、安全性优化（优先级：高）

### 1.1 替换固定验证码为真实短信服务

**当前问题：** `.env` 中 `TS_SMSCODE=123456`，任何人都可以用固定验证码注册账号。

**优化方案：**

```bash
# 接入阿里云短信服务
TS_SMSPROVIDER=aliyun
TS_ALIYUN_ACCESSKEYID=your_access_key
TS_ALIYUN_ACCESSSECRET=your_access_secret
TS_ALIYUN_SIGNNAME=imimchat
TS_ALIYUN_TEMPLATECODE=SMS_xxxxxxxx
```

**预期效果：** 防止恶意批量注册，提升账号安全性。

---

### 1.2 配置数据库定时备份

**当前问题：** 无自动备份机制，数据库损坏将导致数据永久丢失。

**优化方案：**

```bash
# 配置 cron 每天凌晨 3 点自动备份
crontab -e
# 添加以下行：
0 3 * * * /home/ubuntu/tsdd/scripts/backup-db.sh >> /var/log/imimchat-backup.log 2>&1

# 同时配置备份文件上传到对象存储（异地备份）
# 可使用 rclone 同步到阿里云 OSS 或腾讯云 COS
```

**预期效果：** 数据可恢复，最多丢失 24 小时数据。

---

### 1.3 加强密码策略

**当前问题：** 测试账号密码 `Test123456` 过于简单；管理后台密码强度未强制要求。

**优化方案：**
- 修改所有默认密码为强密码（16位以上，含大小写+数字+特殊字符）
- 在管理后台配置密码复杂度要求
- 定期轮换 JWT Secret（`WK_JWT_SECRET`）

---

### 1.4 配置 Nginx 安全头

**当前问题：** 缺少 HTTP 安全响应头，存在 XSS、点击劫持等风险。

**优化方案：** 在 Nginx 配置中添加：

```nginx
# 在 server 块中添加
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self' https: wss:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

### 1.5 限制 API 请求频率

**当前问题：** 无请求频率限制，存在暴力破解和 DDoS 风险。

**优化方案：** 在 Nginx 中配置限流：

```nginx
# 在 http 块中添加
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

# 在 /v1/user/login location 中添加
limit_req zone=login burst=3 nodelay;
```

---

## 二、稳定性优化（优先级：高）

### 2.1 配置服务健康监控

**当前问题：** 无监控告警，服务宕机后只能被动发现。

**优化方案 A（轻量级）：** 使用 UptimeRobot 免费监控

```
1. 注册 https://uptimerobot.com
2. 添加监控：https://wed.imim.chat/v1/ping
3. 配置邮件/微信告警
```

**优化方案 B（自托管）：** 部署 Uptime Kuma

```bash
docker run -d --restart=always \
  -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --name uptime-kuma \
  louislam/uptime-kuma:1
```

---

### 2.2 配置 Docker 容器自动重启策略

**当前状态：** 大部分容器已配置 `restart: always`，但需要验证。

**验证命令：**

```bash
docker inspect tsdd-tangsengdaodaoserver-1 | grep RestartPolicy
```

---

### 2.3 SSL 证书自动续期

**当前问题：** SSL 证书到期后需要手动更新，否则 HTTPS 失效。

**优化方案：** 使用 Certbot 自动续期

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx -y

# 申请证书（如果是 Let's Encrypt）
sudo certbot --nginx -d wed.imim.chat

# 配置自动续期（已自动添加 cron）
sudo certbot renew --dry-run
```

> 注意：如果当前证书是购买的商业证书，需在到期前手动更新。

---

### 2.4 配置日志轮转

**当前问题：** 容器日志无限增长，可能占满磁盘。

**优化方案：** 配置 Docker 日志大小限制

```yaml
# 在 docker-compose.yaml 各服务中添加：
logging:
  driver: "json-file"
  options:
    max-size: "100m"
    max-file: "3"
```

---

## 三、性能优化（优先级：中）

### 3.1 升级服务器配置

**当前状态：** 3.6GB 内存，已使用 1.4GB（约 39%），Swap 使用 1.3MB。

**评估：** 当前配置可支撑约 500 并发用户。如用户量增长，建议：

| 用户规模 | 推荐配置 |
|----------|----------|
| < 500 人 | 当前配置（2核4GB）够用 |
| 500-2000 人 | 4核8GB |
| 2000-10000 人 | 8核16GB + 独立 MySQL 服务器 |
| > 10000 人 | 集群部署，参考 WuKongIM 集群文档 |

---

### 3.2 配置 Nginx 静态资源缓存

**优化方案：** 为 JS/CSS/图片等静态资源添加缓存头：

```nginx
# 在 location / 代理块中添加
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
    proxy_pass http://127.0.0.1:82;
    proxy_cache_valid 200 7d;
    add_header Cache-Control "public, max-age=604800, immutable";
}
```

---

### 3.3 启用 Nginx Gzip 压缩

**优化方案：** 在 Nginx 配置中启用压缩：

```nginx
# 在 http 块中添加
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
gzip_comp_level 6;
```

---

### 3.4 MinIO 配置 CDN 加速

**当前问题：** 用户上传的图片/文件直接从服务器 MinIO 读取，大文件传输消耗服务器带宽。

**优化方案：** 配置腾讯云 CDN 或阿里云 OSS 作为文件存储后端：

```bash
# .env 中修改文件服务类型
TS_FILESERVICE=oss  # 或 cos
TS_OSS_ENDPOINT=your-oss-endpoint
TS_OSS_ACCESSKEYID=your-key
TS_OSS_ACCESSSECRET=your-secret
TS_OSS_BUCKET=imimchat-files
```

---

## 四、用户体验优化（优先级：中）

### 4.1 移动端 UI 深度优化

**当前状态：** 已通过 `imim_adaptive.js v3` 完成基础移动端适配。

**待优化项：**

| 功能 | 状态 | 说明 |
|------|------|------|
| 底部导航栏 | ✅ 已完成 | 消息/联系人/发现/我 |
| 布局修复 | ✅ 已完成 | 隐藏侧边栏，全屏内容区 |
| 聊天页滑入动画 | ✅ 已完成 | 从右侧滑入 |
| 登录 username 修复 | ✅ 已完成 | XHR 拦截器 |
| 消息气泡样式 | 🔄 部分完成 | CSS 已注入，需真机验证 |
| 图片预览 | ❌ 待优化 | 移动端图片查看体验 |
| 语音消息 | ❌ 待优化 | 移动端录音按钮适配 |
| 下拉刷新 | ❌ 待优化 | 移动端下拉刷新会话列表 |

**下一步建议：** 在真实 iOS/Android 设备上测试，收集具体问题后针对性修复。

---

### 4.2 配置推送通知

**当前问题：** Web 端无法在后台收到消息推送。

**优化方案：** 配置 Web Push 通知

```javascript
// 在 imim_adaptive.js 中添加 Service Worker 注册
if ('serviceWorker' in navigator && 'PushManager' in window) {
  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    // 申请推送权限
    return reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: 'your-vapid-public-key'
    });
  });
}
```

---

### 4.3 配置自定义注册邀请码

**当前问题：** 任何人都可以注册账号，无法控制用户来源。

**优化方案：** 在管理后台配置注册限制：
- 关闭开放注册
- 启用邀请码注册
- 配置用户审核机制

---

## 五、功能扩展（优先级：低）

### 5.1 接入 AI 助手

**方案：** 创建一个机器人账号，接入 OpenAI API，实现 AI 聊天助手功能。

```bash
# 创建 Webhook 服务，监听消息事件
# 当用户 @AI助手 时，调用 OpenAI API 回复
```

---

### 5.2 配置多媒体消息增强

- 视频通话：WuKongIM 支持 WebRTC，需配置 TURN 服务器
- 位置共享：接入高德地图 API
- 名片分享：扩展消息类型

---

### 5.3 数据分析看板

**方案：** 接入 Grafana + Prometheus，监控以下指标：
- 日活用户数（DAU）
- 消息发送量
- 服务器资源使用率
- API 响应时间

---

## 优化路线图

```
第一阶段（1-2周，安全加固）
├── ✅ 移动端 UI 修复（已完成）
├── ✅ 配置数据库定时备份（backup-db.sh 增强版已就绪）
├── ✅ register-service 集成到 docker-compose（SMS_PROVIDER=aliyun_dypns 即可启用真实验证码）
├── ✅ 添加 Nginx 安全头 + 限流（安全头 + Gzip + 缓存 + 限流 + Permissions-Policy 已全部配置）
├── ✅ 移除文档中的明文密码
├── ✅ register-service 代码重构（模块化、配置校验、错误处理、结构化日志）
├── ✅ Docker 资源限制（所有服务配置 memory limits）
├── ✅ MySQL 优化（连接池参数、慢查询日志、字符集优化）
├── ✅ Redis 持久化（AOF + RDB + maxmemory 策略）
├── ✅ SSL 加密套件强化（禁用弱加密，启用 TLSv1.2+）

第二阶段（2-4周，稳定性）
├── 🔲 配置服务监控告警（UptimeRobot / Uptime Kuma）
├── 🔲 SSL 证书自动续期
├── ✅ Docker 日志轮转（所有服务已配置 max-size: 100m, max-file: 3）
├── ✅ register-service 已集成到 docker-compose.yaml
├── ✅ 健康检查完善（所有服务含 healthcheck + start_period）
└── 🔲 真机移动端测试与修复

第三阶段（1-2月，性能与体验）
├── ✅ Nginx 缓存 + Gzip 优化
├── 🔲 MinIO 接入 CDN
├── 🔲 Web Push 推送通知
└── 🔲 注册邀请码机制

第四阶段（长期，功能扩展）
├── 🔲 AI 助手接入
├── 🔲 视频通话（WebRTC）
└── 🔲 数据分析看板
```

---

## 附：当前已知问题清单

| 编号 | 问题描述 | 严重程度 | 状态 |
|------|----------|----------|------|
| #001 | 固定验证码 `123456` 可被滥用注册 | 高 | ✅ 已修复（设置 SMS_PROVIDER=aliyun_dypns 即可启用真实验证码） |
| #002 | 无数据库自动备份 | 高 | ✅ 已修复（backup-db.sh 增强版 + cron 建议） |
| #003 | SSL 证书到期无告警 | 中 | 待修复 |
| #004 | 移动端图片/语音消息体验待优化 | 中 | 待测试 |
| #005 | 无服务监控告警 | 中 | 待配置 |
| #006 | Docker 日志无大小限制 | 低 | ✅ 已修复（所有服务已配置日志轮转） |
| #007 | 管理后台 Adminer 无额外认证 | 低 | 已限制本机访问 |
| #008 | register-service 单文件架构 | 低 | ✅ 已修复（模块化重构） |
| #009 | 服务无资源限制 | 中 | ✅ 已修复（所有服务已配置 memory limits） |
| #010 | MySQL 未优化配置 | 中 | ✅ 已修复（连接池、慢查询日志、字符集） |
