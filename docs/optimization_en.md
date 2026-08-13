# imimchat Optimization Plan & Roadmap

[**中文版**](./optimization.md) | **English Version**

## Overview

This document provides a comprehensive evaluation of the current imimchat deployment from five dimensions: **Security, Stability, Performance, User Experience, and Functional Expansion**, offering prioritized optimization recommendations.

---

## 1. Security Optimization (Priority: High)

### 1.1 Replace Fixed SMS Code with Real SMS Service

**Current Issue:** `.env` contains `TS_SMSCODE=123456`, allowing anyone to register an account using the fixed verification code.

**Optimization Plan:**

```bash
# Integrate Aliyun SMS Service
TS_SMSPROVIDER=aliyun
TS_ALIYUN_ACCESSKEYID=your_access_key
TS_ALIYUN_ACCESSSECRET=your_access_secret
TS_ALIYUN_SIGNNAME=imimchat
TS_ALIYUN_TEMPLATECODE=SMS_xxxxxxxx
```

**Expected Result:** Prevents malicious mass registration and enhances account security.

---

### 1.2 Configure Automated Database Backups

**Current Issue:** No automated backup mechanism. Database corruption will lead to permanent data loss.

**Optimization Plan:**

```bash
# Configure cron to automatically backup at 3 AM daily
crontab -e
# Add the following line:
0 3 * * * /home/ubuntu/tsdd/scripts/backup-db.sh >> /var/log/imimchat-backup.log 2>&1

# Simultaneously configure backup file upload to object storage (off-site backup)
# Can use rclone to sync to Aliyun OSS or Tencent Cloud COS
```

**Expected Result:** Data is recoverable, with a maximum of 24 hours of data loss.

---

### 1.3 Strengthen Password Policies

**Current Issue:** The test account password `Test123456` is too simple; admin dashboard password strength is not enforced.

**Optimization Plan:**
- Change all default passwords to strong passwords (16+ characters, mixed case + numbers + special characters)
- Enforce password complexity requirements in the admin dashboard
- Periodically rotate JWT Secret (`WK_JWT_SECRET`)

---

### 1.4 Configure Nginx Security Headers

**Current Issue:** Missing HTTP security response headers, exposing risks like XSS and clickjacking.

**Optimization Plan:** Add the following to the Nginx configuration:

```nginx
# Add inside the server block
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self' https: wss:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

### 1.5 Rate Limit API Requests

**Current Issue:** No request frequency limits, exposing risks of brute-force attacks and DDoS.

**Optimization Plan:** Configure rate limiting in Nginx:

```nginx
# Add inside the http block
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

# Add inside the /v1/user/login location
limit_req zone=login burst=3 nodelay;
```

---

## 2. Stability Optimization (Priority: High)

### 2.1 Configure Service Health Monitoring

**Current Issue:** No monitoring alerts; service downtime is only discovered passively.

**Optimization Plan A (Lightweight):** Use UptimeRobot free monitoring

```
1. Register at https://uptimerobot.com
2. Add monitor: https://wed.imim.chat/v1/ping
3. Configure Email/WeChat alerts
```

**Optimization Plan B (Self-hosted):** Deploy Uptime Kuma

```bash
docker run -d --restart=always \
  -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --name uptime-kuma \
  louislam/uptime-kuma:1
```

---

### 2.2 Configure Docker Container Auto-Restart Policies

**Current Status:** Most containers have `restart: always` configured, but verification is needed.

**Verification Command:**

```bash
docker inspect tsdd-tangsengdaodaoserver-1 | grep RestartPolicy
```

---

### 2.3 Automated SSL Certificate Renewal

**Current Issue:** SSL certificates need manual renewal upon expiration, otherwise HTTPS fails.

**Optimization Plan:** Use Certbot for automated renewal

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Request certificate (if using Let's Encrypt)
sudo certbot --nginx -d wed.imim.chat

# Configure auto-renewal (automatically adds cron job)
sudo certbot renew --dry-run
```

> Note: If the current certificate is a purchased commercial certificate, it must be manually renewed before expiration.

---

### 2.4 Configure Log Rotation

**Current Issue:** Container logs grow indefinitely and may fill up the disk.

**Optimization Plan:** Configure Docker log size limits

```yaml
# Add to each service in docker-compose.yaml:
logging:
  driver: "json-file"
  options:
    max-size: "100m"
    max-file: "3"
```

---

## 3. Performance Optimization (Priority: Medium)

### 3.1 Upgrade Server Specifications

**Current Status:** 3.6GB Memory, ~1.4GB used (approx. 39%), Swap usage 1.3MB.

**Assessment:** The current specs can support around 500 concurrent users. If the user base grows, recommendations are:

| User Scale | Recommended Specs |
|------------|-------------------|
| < 500 Users | Current specs (2 Cores 4GB) are sufficient |
| 500-2000 Users | 4 Cores 8GB |
| 2000-10000 Users | 8 Cores 16GB + Dedicated MySQL Server |
| > 10000 Users | Cluster deployment, refer to WuKongIM cluster docs |

---

### 3.2 Configure Nginx Static Resource Caching

**Optimization Plan:** Add cache headers for static resources like JS/CSS/images:

```nginx
# Add inside the location / proxy block
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
    proxy_pass http://127.0.0.1:82;
    proxy_cache_valid 200 7d;
    add_header Cache-Control "public, max-age=604800, immutable";
}
```

---

### 3.3 Enable Nginx Gzip Compression

**Optimization Plan:** Enable compression in Nginx configuration:

```nginx
# Add inside the http block
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
gzip_comp_level 6;
```

---

### 3.4 MinIO CDN Acceleration Configuration

**Current Issue:** Images/files uploaded by users are read directly from the server's MinIO, consuming server bandwidth for large files.

**Optimization Plan:** Configure Tencent Cloud CDN or Aliyun OSS as the file storage backend:

```bash
# Modify file service type in .env
TS_FILESERVICE=oss  # or cos
TS_OSS_ENDPOINT=your-oss-endpoint
TS_OSS_ACCESSKEYID=your-key
TS_OSS_ACCESSSECRET=your-secret
TS_OSS_BUCKET=imimchat-files
```

---

## 4. User Experience Optimization (Priority: Medium)

### 4.1 Deep Mobile UI Optimization

**Current Status:** Basic mobile adaptation completed via `imim_adaptive.js v3`.

**Pending Optimizations:**

| Feature | Status | Description |
|---------|--------|-------------|
| Bottom Navigation Bar | ✅ Completed | Chat/Contacts/Discover/Me |
| Layout Fixes | ✅ Completed | Hide sidebar, full-screen content area |
| Chat Page Slide Animation | ✅ Completed | Slide in from right |
| Login Username Fix | ✅ Completed | XHR Interceptor |
| Message Bubble Styles | 🔄 Partially Completed | CSS injected, requires real device testing |
| Image Preview | ❌ Pending | Mobile image viewing experience |
| Voice Messages | ❌ Pending | Mobile recording button adaptation |
| Pull-to-Refresh | ❌ Pending | Mobile pull-to-refresh chat list |

**Next Steps:** Test on real iOS/Android devices, collect specific issues, and fix them targetedly.

---

### 4.2 Configure Push Notifications

**Current Issue:** Web clients cannot receive message push notifications in the background.

**Optimization Plan:** Configure Web Push Notifications

```javascript
// Add Service Worker registration in imim_adaptive.js
if ('serviceWorker' in navigator && 'PushManager' in window) {
  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    // Request push permission
    return reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: 'your-vapid-public-key'
    });
  });
}
```

---

### 4.3 Configure Custom Registration Invitation Codes

**Current Issue:** Anyone can register an account, making it impossible to control user sources.

**Optimization Plan:** Configure registration restrictions in the admin dashboard:
- Disable open registration
- Enable invitation code registration
- Configure user approval mechanism

---

## 5. Functional Expansion (Priority: Low)

### 5.1 Integrate AI Assistant

**Plan:** Create a bot account, integrate OpenAI API, and implement an AI chat assistant feature.

```bash
# Create a Webhook service listening to message events
# When a user @AIAssistant, call OpenAI API to reply
```

---

### 5.2 Configure Multimedia Message Enhancements

- Video Calls: WuKongIM supports WebRTC, requires TURN server configuration
- Location Sharing: Integrate Amap API
- Business Card Sharing: Extend message types

---

### 5.3 Data Analytics Dashboard

**Plan:** Integrate Grafana + Prometheus to monitor the following metrics:
- Daily Active Users (DAU)
- Message send volume
- Server resource utilization rates
- API response times

---

## Optimization Roadmap

```
Phase 1 (1-2 Weeks, Security Hardening)
├── ✅ Mobile UI Fixes (Completed)
├── 🔲 Configure Automated Database Backups
├── 🔲 Replace Fixed SMS Code with Real SMS Service
└── 🔲 Add Nginx Security Headers + Rate Limiting

Phase 2 (2-4 Weeks, Stability)
├── 🔲 Configure Service Monitoring Alerts
├── 🔲 Automated SSL Certificate Renewal
├── 🔲 Docker Log Rotation
└── 🔲 Real Device Mobile Testing & Fixes

Phase 3 (1-2 Months, Performance & Experience)
├── 🔲 Nginx Caching + Gzip Optimization
├── 🔲 MinIO CDN Integration
├── 🔲 Web Push Notifications
└── 🔲 Registration Invitation Code Mechanism

Phase 4 (Long-term, Functional Expansion)
├── 🔲 AI Assistant Integration
├── 🔲 Video Calls (WebRTC)
└── 🔲 Data Analytics Dashboard
```

---

## Appendix: Current Known Issues List

| ID | Issue Description | Severity | Status |
|----|-------------------|----------|--------|
| #001 | Fixed SMS code `123456` can be abused for registration | High | Pending Fix |
| #002 | No automated database backups | High | Pending Fix |
| #003 | No alerts for SSL certificate expiration | Medium | Pending Fix |
| #004 | Mobile image/voice message experience needs optimization | Medium | Pending Test |
| #005 | No service monitoring alerts | Medium | Pending Config |
| #006 | Docker logs have no size limits | Low | Pending Config |
| #007 | Admin dashboard Adminer lacks extra authentication | Low | Restricted to Local Access |
