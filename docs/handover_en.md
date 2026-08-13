# imimchat Project Handover Document

[**中文版**](./handover.md) | **English Version**

> Last Updated: 2026-04-05

## 1. Project Basic Information

| Item | Value |
|------|-------|
| Project Name | imimchat |
| Access URL | https://wed.imim.chat |
| Admin Dashboard | https://wed.imim.chat/admin |
| Server | 42.194.167.201 (Tencent Cloud) |
| Login User | ubuntu |
| Key File | Q(6).pem (Please keep safe) |
| GitHub Repository | https://github.com/1004cq/imimchat (Private) |

---

## 2. Server Login

```bash
# SSH login to the server
ssh -i Q\(6\).pem ubuntu@42.194.167.201

# Enter project directory
cd ~/tsdd
```

---

## 3. Service Management

### View All Container Status

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

### Start/Stop All Services

```bash
cd ~/tsdd
docker compose up -d    # Start
docker compose down     # Stop
docker compose restart  # Restart
```

### View Service Logs

```bash
# Business API Logs
docker logs -f --tail=100 tsdd-tangsengdaodaoserver-1

# WuKongIM Logs
docker logs -f --tail=100 tsdd-wukongim-1

# Web Frontend Logs
docker logs -f --tail=100 tsdd-tangsengdaodaoweb-1
```

---

## 4. Frontend Customization File Management

The frontend is a **pre-compiled React application** and source code cannot be modified. All customizations are implemented via injected files:

### File Locations (Inside Container)

```
/usr/share/nginx/html/
├── index.html                    ← Entry (script references injected)
├── static/
│   ├── js/
│   │   ├── main.imim2026v2.js    ← Main application (cannot be modified)
│   │   ├── imim_adaptive.js      ← Mobile adaptation script (modifiable) ★
│   │   └── imim_adaptive.js.bak  ← Backup
│   └── css/
│       ├── main.946ff072.css     ← Main styles (cannot be modified)
│       └── mobile.css            ← Mobile supplementary styles (modifiable)
```

### Modifying Frontend Customization Files

```bash
# 1. Modify files in the local Git repository
# frontend/static/js/imim_adaptive.js
# frontend/static/css/mobile.css

# 2. Upload to the server
scp -i Q\(6\).pem frontend/static/js/imim_adaptive.js ubuntu@42.194.167.201:/tmp/
scp -i Q\(6\).pem frontend/static/css/mobile.css ubuntu@42.194.167.201:/tmp/

# 3. Inject into the container
ssh -i Q\(6\).pem ubuntu@42.194.167.201 "
  docker cp /tmp/imim_adaptive.js tsdd-tangsengdaodaoweb-1:/usr/share/nginx/html/static/js/imim_adaptive.js
  docker cp /tmp/mobile.css tsdd-tangsengdaodaoweb-1:/usr/share/nginx/html/static/css/mobile.css
"

# 4. Commit to Git
git add frontend/
git commit -m "fix: update mobile adaptation script"
git push
```

> **Important:** After every restart or update of the Web container, custom files must be re-injected!

---

## 5. Database Management

### Connecting to Database

```bash
# Method 1: Via Docker exec
docker exec -it tsdd-mysql-1 mysql -u root -p im
# Password: See MYSQL_ROOT_PASSWORD in ~/tsdd/.env

# Method 2: Via Adminer Web Interface (requires SSH tunnel)
ssh -i Q\(6\).pem -L 8306:127.0.0.1:8306 ubuntu@42.194.167.201
# Then access http://localhost:8306 in browser
# Server: mysql, Username: root, Password: See .env
```

### Manual Database Backup

```bash
ssh -i Q\(6\).pem ubuntu@42.194.167.201 "
  docker exec tsdd-mysql-1 mysqldump -u root -p'password' im | gzip > /tmp/im_backup_\$(date +%Y%m%d).sql.gz
"
scp -i Q\(6\).pem ubuntu@42.194.167.201:/tmp/im_backup_*.sql.gz ./backups/
```

---

## 6. Nginx Configuration Management

```bash
# View configuration
sudo cat /etc/nginx/sites-enabled/tsdd

# Edit configuration
sudo nano /etc/nginx/sites-enabled/tsdd

# Test configuration
sudo nginx -t

# Reload configuration (without downtime)
sudo systemctl reload nginx

# View Nginx status
sudo systemctl status nginx
```

---

## 7. SSL Certificates

```bash
# Certificate locations
/etc/nginx/ssl/wed.imim.chat.crt
/etc/nginx/ssl/wed.imim.chat.key

# Check certificate expiration date
openssl x509 -enddate -noout -in /etc/nginx/ssl/wed.imim.chat.crt
```

> **Note:** Certificates must be manually renewed and Nginx reloaded before expiration!

---

## 8. Admin Dashboard

- **URL:** https://wed.imim.chat/admin
- **Username:** superAdmin
- **Password:** See `TS_ADMINPWD` in `~/tsdd/.env`

Admin Dashboard Features:
- User Management (Ban/Unban)
- Channel/Group Management
- Message Moderation
- System Configuration

---

## 9. Test Accounts

| Phone Number | Password | Description |
|--------------|----------|-------------|
| 13900000099 | Test123456 | Test Account 1 |

> Registering a new account: Use phone number + verification code `123456` (Fixed code, for testing)

---

## 10. Completed Customization Work

| Task | Completion Date | Description |
|------|-----------------|-------------|
| Brand Customization (Logo/Name/Theme) | 2026-04-03 | imimchat brand |
| Nginx HTTPS Configuration | 2026-04-03 | SSL certificates configured |
| Admin Dashboard Path Config | 2026-04-03 | /admin path |
| WebSocket Proxy Config | 2026-04-03 | /ws path |
| Adminer Security Limit | 2026-04-04 | Local access only |
| Mobile Adaptation Script v3 | 2026-04-04 | imim_adaptive.js |
| Login Username Fix | 2026-04-04 | XHR Interceptor |
| Bottom Navigation Bar | 2026-04-04 | WeChat-style TabBar |
| GitHub Repository Backup | 2026-04-05 | This repository |

---

## 11. Emergency Troubleshooting

### Website Inaccessible

```bash
# 1. Check Nginx
sudo systemctl status nginx
sudo nginx -t
sudo systemctl restart nginx

# 2. Check Containers
docker ps | grep tsdd

# 3. Restart all services
cd ~/tsdd && docker compose restart
```

### Frontend Interface Abnormal

```bash
# Rollback to backup version
docker exec tsdd-tangsengdaodaoweb-1 \
  cp /usr/share/nginx/html/static/js/imim_adaptive.js.bak \
     /usr/share/nginx/html/static/js/imim_adaptive.js
```

### Database Connection Failed

```bash
# Check MySQL container logs
docker logs tsdd-mysql-1 --tail=50

# Restart MySQL
docker restart tsdd-mysql-1

# Wait for health check to pass, then restart business service
sleep 30 && docker restart tsdd-tangsengdaodaoserver-1
```

---

## 12. Contact & Resources

| Resource | URL |
|----------|-----|
| WuKongIM Docs | https://githubim.com |
| WuKongIM GitHub | https://github.com/WuKongIM/WuKongIM |
| TangSengDaoDao Docs | https://tangsengdaodao.com |
| TangSengDaoDao GitHub | https://github.com/TangSengDaoDao/TangSengDaoDaoServer |
| This Project GitHub | https://github.com/1004cq/imimchat |
