# imimchat 安全注册服务文档

## 概述

imimchat 注册中间件服务（`register-service`）为前端提供安全的用户注册 API，解决了后端 TangSengDaoDao 使用固定验证码 `123456` 的安全漏洞。

## 架构设计

```
用户浏览器
    │
    ├─ POST /register/sms    → Nginx → 注册中间件（:9091）
    │                                     ├─ 手机号格式校验
    │                                     ├─ 频率限制（每手机号/IP）
    │                                     ├─ 生成随机 6 位验证码
    │                                     └─ 发送短信（mock/阿里云）
    │
    └─ POST /register/submit → Nginx → 注册中间件（:9091）
                                          ├─ 验证码校验（有效期/重试次数/防重放）
                                          ├─ 密码强度校验
                                          ├─ IP 注册频率限制
                                          └─ 调用 TangSengDaoDao API 完成注册
```

## 安全特性

| 特性 | 说明 |
|------|------|
| 随机验证码 | 每次生成 6 位随机数字验证码（非固定值） |
| 验证码有效期 | 5 分钟自动过期 |
| 最大错误次数 | 连续错误 3 次后验证码作废，需重新获取 |
| 防重放攻击 | 验证码使用后立即标记为已使用 |
| 短信频率限制 | 同一手机号每小时最多发送 3 次验证码 |
| IP 频率限制 | 同一 IP 每小时最多注册 5 次 |
| Nginx 限流 | 每 IP 每秒最多 2 个请求，突发最多 5 个 |
| 密码强度校验 | 8-32 位，须含大写字母、小写字母和数字 |
| CORS 限制 | 仅允许来自 `https://wed.imim.chat` 的请求 |

## 部署信息

### Docker 容器

```bash
# 查看容器状态
docker ps | grep imimchat-register

# 查看日志（含验证码，测试模式）
docker logs imimchat-register --tail=20

# 重启服务
docker restart imimchat-register
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TSDD_API` | `http://tangsengdaodaoserver:8090` | 后端 API 地址 |
| `TSDD_SMSCODE` | `123456` | 后端固定验证码（与 TS_SMSCODE 保持一致） |
| `SMS_PROVIDER` | `mock` | 短信服务商（mock/aliyun） |
| `CODE_EXPIRE` | `300` | 验证码有效期（秒） |
| `CODE_MAX_RETRY` | `3` | 最大错误次数 |
| `RATE_LIMIT_PER_HOUR` | `5` | 每 IP 每小时注册上限 |
| `RATE_LIMIT_SMS_PER_HOUR` | `3` | 每手机号每小时短信上限 |

### API 接口

#### 发送验证码

```
POST /register/sms
Content-Type: application/json

{"phone": "13900001234"}
```

响应：
```json
{"code": 200, "msg": "验证码已发送至 139****1234，5 分钟内有效"}
```

#### 提交注册

```
POST /register/submit
Content-Type: application/json

{
  "phone": "13900001234",
  "code": "123456",
  "name": "用户昵称",
  "password": "Test123456"
}
```

响应：
```json
{
  "code": 200,
  "msg": "注册成功！",
  "data": {
    "uid": "xxx",
    "name": "用户昵称",
    "token": "xxx"
  }
}
```

#### 健康检查

```
GET /register/health
```

## 接入真实短信服务

### 阿里云短信

1. 在阿里云控制台申请短信签名和模板
2. 修改 Docker 启动命令，添加以下环境变量：

```bash
docker run -d \
  --name imimchat-register \
  ...
  -e SMS_PROVIDER=aliyun \
  -e ALIYUN_ACCESS_KEY=your_access_key \
  -e ALIYUN_ACCESS_SECRET=your_access_secret \
  -e ALIYUN_SIGN_NAME=你的签名名称 \
  -e ALIYUN_TEMPLATE_CODE=SMS_xxxxxxxx \
  imimchat-register:latest
```

3. 安装阿里云 SDK（在 Dockerfile 中添加）：

```dockerfile
RUN pip install alibabacloud-dysmsapi20170525
```

## 注意事项

1. **当前为测试模式**：`SMS_PROVIDER=mock`，验证码不会真实发送，需查看 Docker 日志获取验证码
2. **内存存储**：验证码存储在内存中，服务重启后所有验证码失效（生产环境建议改用 Redis）
3. **单 Worker**：使用单进程模式确保内存存储一致性，接入 Redis 后可改为多 Worker
4. **后端固定码**：`TSDD_SMSCODE` 必须与 `/home/ubuntu/tsdd/.env` 中的 `TS_SMSCODE` 保持一致

## 文件位置

| 文件 | 说明 |
|------|------|
| `/home/ubuntu/register-service/app.py` | 注册服务主程序 |
| `/home/ubuntu/register-service/Dockerfile` | Docker 构建文件 |
| `register-service/app.py` | GitHub 仓库备份 |
