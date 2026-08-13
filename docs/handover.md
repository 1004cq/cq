# imimchat 项目移交文档

**文档版本**：v2.0
**更新日期**：2026-04-05
**编写人**：Manus AI

本文档提供了 imimchat 项目的完整移交信息，涵盖系统架构、部署环境、核心配置、运维指南及后续开发建议。

---

## 1. 项目概述

imimchat 是一个基于唐僧叨叨（TangSengDaoDao）和悟空 IM（WuKongIM）构建的即时通讯系统。系统提供 Web 端即时通讯功能，并定制了安全的注册流程。

### 1.1 核心访问入口

| 服务 | 访问地址 | 说明 |
|------|---------|------|
| **Web 客户端** | `https://wed.imim.chat` | 用户访问的主入口，包含登录、注册及聊天功能 |
| **管理后台** | `https://wed.imim.chat/admin/` | 平台管理系统，默认账号：`superAdmin`，密码见 `.env` 中的 `TS_ADMINPWD` |
| **注册接口** | `https://wed.imim.chat/register/` | 独立的注册安全中间件接口 |

### 1.2 基础设施信息

| 资源项 | 详情 |
|--------|------|
| **服务器 IP** | `42.194.167.201` |
| **操作系统** | Ubuntu 22.04 LTS (6.8.0-101-generic) |
| **SSH 登录** | 用户：`ubuntu`，使用提供的 `server.pem` 密钥免密登录 |
| **域名** | `wed.imim.chat` |
| **代码仓库** | [https://github.com/1004cq/imimchat](https://github.com/1004cq/imimchat) |

---

## 2. 系统架构与部署状态

系统采用 Docker 容器化部署，通过 Nginx 进行统一的反向代理和 SSL 卸载。

### 2.1 Docker 容器列表

所有核心服务均运行在 Docker 容器中。

| 容器名称 | 镜像 | 内部端口 | 宿主机映射端口 | 作用 |
|----------|------|----------|----------------|------|
| `tsdd-wukongim-1` | `wukongim:v2` | 5100, 5200, 5300 | 5100, 5200, 5300 | 悟空IM底层通讯服务，处理长连接和 WebSocket |
| `tsdd-tangsengdaodaoserver-1` | `tangsengdaodaoserver:v1.5` | 8090 | 8090 | 唐僧叨叨业务后端服务 |
| `tsdd-tangsengdaodaoweb-1` | `tangsengdaodaoweb:latest` | 80 | 82 | Web 前端静态资源服务 |
| `tsdd-tangsengdaodaomanager-1`| `tangsengdaodaomanager:latest` | 80 | 83 | 后台管理系统前端 |
| `tsdd-mysql-1` | `mysql:8.0.33` | 3306 | - | MySQL 数据库服务 |
| `tsdd-redis-1` | `redis:7.2.3` | 6379 | - | Redis 缓存服务 |
| `tsdd-minio-1` | `minio:RELEASE.2023-07-18...` | 9000, 9001 | 9000, 9001 | MinIO 对象存储服务 |
| `imimchat-register` | `imimchat-register:latest` | 9091 | 9091 | 自定义安全注册中间件 |

### 2.2 目录结构说明

服务器上位于 `/home/ubuntu/` 的核心目录说明：

- `/home/ubuntu/tsdd/`：唐僧叨叨核心部署目录
  - `.env`：系统环境变量配置
  - `docker-compose.yaml`：容器编排配置
  - `mysqldata/`：MySQL 数据持久化目录
  - `miniodata/`：MinIO 数据持久化目录
- `/home/ubuntu/register-service/`：注册中间件服务目录
  - `app.py`：注册服务核心逻辑
  - `Dockerfile`：注册服务镜像构建文件
  - `requirements.txt`：Python 依赖清单
- `/home/ubuntu/imimchat-repo/`：项目源代码本地备份（与 GitHub 仓库同步）

---

## 3. 核心配置说明

### 3.1 Nginx 反向代理与 SSL

Nginx 配置文件位于 `/etc/nginx/sites-enabled/tsdd`。
SSL 证书由 Let's Encrypt 提供，存储在 `/etc/nginx/ssl/`，到期时间为 **2026年5月11日**。

Nginx 核心路由规则：
- `/` $\rightarrow$ 代理到 `http://127.0.0.1:82` (Web 前端)
- `/api/` 和 `/v1/` $\rightarrow$ 代理到 `http://127.0.0.1:8090` (业务 API)
- `/ws` $\rightarrow$ 代理到 `http://127.0.0.1:5200` (WebSocket 长连接)
- `/admin/` $\rightarrow$ 代理到 `http://127.0.0.1:83` (管理后台)
- `/register/` $\rightarrow$ 代理到 `http://127.0.0.1:9091` (注册中间件)

**注意**：注册接口配置了限流规则（`limit_req zone=register_limit burst=5 nodelay;`），每 IP 每秒最多 2 个请求。

### 3.2 数据库与存储配置

（配置信息记录在 `/home/ubuntu/tsdd/.env` 中）

- **MySQL**：
  - 数据库名：`im`
  - Root 密码：见 `.env` 中的 `MYSQL_ROOT_PASSWORD`
- **MinIO**：
  - 用户名：`minio`
  - 密码：见 `.env` 中的 `MINIO_ROOT_PASSWORD`

### 3.3 注册中间件服务

为了解决原系统缺乏注册验证的问题，开发了独立的 Python 注册中间件服务。

**功能特性**：
1. 拦截注册请求，强制要求手机验证码
2. 防暴力破解（最大错误 3 次）、防重放（验证码用后失效）
3. 注册频率限制（单 IP 每小时 5 次）
4. 密码强度校验（8-32位，须含大小写字母和数字）
5. 支持集成阿里云号码认证服务（Dypnsapi）发送真实短信

**环境变量配置**（位于 Docker 启动参数中）：
- `TSDD_SMSCODE=123456`：后端业务服务固定的测试验证码，中间件在校验真实验证码通过后，会向后端发送此固定码。
- `SMS_PROVIDER`：当前为 `mock`（测试模式），验证码仅打印在日志中。如需发送真实短信，可修改为 `aliyun_dypns` 并配置阿里云 AccessKey。

---

## 4. 运维与管理指南

### 4.1 服务启停与查看日志

**唐僧叨叨主服务**：
```bash
cd /home/ubuntu/tsdd
# 查看状态
docker compose ps
# 重启所有服务
docker compose restart
# 查看特定服务日志（如业务后端）
docker compose logs -f tangsengdaodaoserver
```

**注册中间件服务**：
```bash
# 查看状态
docker ps | grep register
# 重启服务
docker restart imimchat-register
# 查看日志（在 mock 模式下用于获取验证码）
docker logs -f imimchat-register
```

### 4.2 Nginx 管理

```bash
# 测试配置语法
sudo nginx -t
# 重载配置
sudo systemctl reload nginx
# 查看 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log
```

### 4.3 SSL 证书续期

证书当前由 Certbot 管理，但配置在自定义目录。续期时需执行：
```bash
sudo certbot renew
# 续期成功后，将新证书复制到 Nginx 目录并重载
sudo cp /etc/letsencrypt/live/wed.imim.chat/fullchain.pem /etc/nginx/ssl/wed.imim.chat.crt
sudo cp /etc/letsencrypt/live/wed.imim.chat/privkey.pem /etc/nginx/ssl/wed.imim.chat.key
sudo systemctl reload nginx
```

---

## 5. 后续开发与优化建议

### 5.1 接入真实短信服务

当前注册服务的 `SMS_PROVIDER` 为 `mock`。建议接入阿里云短信服务：
1. 登录阿里云控制台，开通 **号码认证服务**（Dypnsapi）。
2. 获取 `AccessKey`、赠送的 `签名` 和 `模板 Code`。
3. 修改 `/home/ubuntu/register-service/Dockerfile` 中的环境变量：
   ```dockerfile
   ENV SMS_PROVIDER=aliyun_dypns
   ENV ALIYUN_ACCESS_KEY=你的AK
   ENV ALIYUN_ACCESS_SECRET=你的SK
   ENV ALIYUN_DYPNS_SIGN_NAME=赠送的签名
   ENV ALIYUN_DYPNS_TEMPLATE_CODE=赠送的模板Code
   ```
4. 重新构建并启动注册容器：
   ```bash
   cd /home/ubuntu/register-service
   docker build -t imimchat-register:latest .
   docker stop imimchat-register && docker rm imimchat-register
   docker run -d --name imimchat-register -p 9091:9091 \
     --env-file <(env | grep ALIYUN) \
     imimchat-register:latest
   ```

### 5.2 前端代码修改

Web 前端基于编译后的静态文件运行，修改均通过向 `imim_adaptive.js` 注入代码实现。
如需修改前端逻辑（如注册弹窗样式）：
1. 编辑服务器上的文件：`/usr/share/nginx/html/static/js/imim_adaptive.js`（需要进入 `tsdd-tangsengdaodaoweb-1` 容器）。
2. 为了持久化，建议修改本地仓库 `/home/ubuntu/imimchat-repo/frontend/static/js/imim_adaptive.js`，然后通过 `docker cp` 复制到容器内：
   ```bash
   docker cp /home/ubuntu/imimchat-repo/frontend/static/js/imim_adaptive.js tsdd-tangsengdaodaoweb-1:/usr/share/nginx/html/static/js/
   ```

### 5.3 数据库备份

建议定期备份 MySQL 数据库：
```bash
# 备份命令（请从 .env 获取 MYSQL_ROOT_PASSWORD）
docker exec tsdd-mysql-1 mysqldump -uroot -p"${MYSQL_ROOT_PASSWORD}" im > /home/ubuntu/im_backup_$(date +%Y%m%d).sql
```

---

**交付确认**
至此，imimchat 项目的核心功能（登录、安全注册、聊天、后台管理）已全部部署完毕并正常运行。代码已同步至 GitHub 仓库，服务器配置已完成固化。
