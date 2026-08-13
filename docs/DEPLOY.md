# CQIM 生产环境部署指南 (Docker Compose 版)

本文档介绍如何使用 Docker Compose 部署 CQIM（cqim-app）生产环境。

## 1. 架构说明

CQIM 采用单机容器化部署方案，拓扑结构如下：

- **Nginx**: 统一入口，负责 TLS 终止、静态资源分流及 WebSocket 升级。
- **Node API (cqim)**: 核心业务逻辑，处理 API 请求、私聊消息及朋友圈。
- **Go Gateway**: 实时消息网关，处理群聊 WebSocket 连接与扇出。
- **MongoDB**: 主业务数据库（Replica Set 模式）。
- **Redis**: 实时状态、缓存及 Pub/Sub 消息总线。
- **MySQL**: 审计日志与后台运营数据。

## 2. 部署步骤

### 2.1 环境准备
- 安装 Docker 24.0+ 和 Docker Compose 2.20+。
- 准备域名并获取 SSL 证书（存放至 `./certs` 目录）。

### 2.2 配置文件
1. 复制模板：`cp .env.example .env`
2. 修改 `.env` 中的生产密钥（**严禁使用默认密码**）：
   - `MYSQL_ROOT_PASSWORD`: 强随机密码。
   - `DATABASE_URL`: 确保包含正确的 MongoDB 凭据。
   - `REDIS_PASSWORD`: 建议为 Redis 设置密码。
   - `REDIS_ADDR`: 指向 `redis:6379`。

### 2.3 启动服务
```bash
# 构建并启动所有服务
docker-compose up -d --build

# 检查服务状态
docker-compose ps

# 查看日志
docker-compose logs -f cqim
```

## 3. 安全建议

- **端口隔离**: 数据库服务（Mongo/Redis/MySQL）默认不对外映射端口，仅限容器内访问。如需本地维护，请使用 `ssh` 隧道或将 `ports` 改为 `127.0.0.1:27017:27017`。
- **非 Root 运行**: 应用镜像已配置为以 `nodeuser` 用户运行，降低容器逃逸风险。
- **资源限制**: `cqim` 容器默认限制内存为 1GB，建议根据实际负载调整 `deploy.resources`。

## 4. 备份与维护

### 4.1 数据库备份
- **MongoDB**: `docker exec cqim-mongo mongodump --out /data/db/backups/$(date +%F)`
- **MySQL**: `docker exec cqim-mysql mysqldump -u root -p$MYSQL_ROOT_PASSWORD cqim_audit > backup.sql`

### 4.2 升级流程
```bash
git pull
docker-compose up -d --build cqim go-gateway
```

## 5. 验证部署

1. **API 健康检查**: 访问 `https://your-domain/api/health`。
2. **WebSocket 连通性**:
   - 使用工具连接 `wss://your-domain/ws/group`。
   - 验证握手是否成功（需携带有效 Token）。
3. **朋友圈图片**: 验证发布后图片能否正常上传至 COS 或本地目录。
