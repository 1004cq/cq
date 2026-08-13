#!/bin/bash
# imimchat 服务管理脚本（增强版 - 支持双系统）
# 用途：快速管理所有 Docker 容器服务
# 使用方法：bash scripts/manage.sh [start|stop|restart|status|logs|health]

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "$0")/../docker" && pwd)"
COMPOSE_PROJECT="$(basename "$COMPOSE_DIR")"

case "$1" in
  start)
    echo "启动所有服务..."
    cd "$COMPOSE_DIR" && docker compose up -d
    echo "等待服务健康检查..."
    sleep 5
    bash "$0" health
    ;;
  stop)
    echo "停止所有服务..."
    cd "$COMPOSE_DIR" && docker compose down
    ;;
  restart)
    echo "重启所有服务..."
    cd "$COMPOSE_DIR" && docker compose down && docker compose up -d
    echo "等待服务健康检查..."
    sleep 5
    bash "$0" health
    ;;
  restart-web)
    echo "重启 Web 前端服务..."
    docker restart "${COMPOSE_PROJECT}-tangsengdaodaoweb-1" 2>/dev/null || docker restart "docker-tangsengdaodaoweb-1"
    ;;
  restart-api)
    echo "重启 API 服务..."
    docker restart "${COMPOSE_PROJECT}-tangsengdaodaoserver-1" 2>/dev/null || docker restart "docker-tangsengdaodaoserver-1"
    ;;
  restart-register)
    echo "重启注册中间件服务..."
    docker restart imimchat-register
    ;;
  restart-cqim)
    echo "重启 CQIM 应用..."
    docker restart cqim-app
    docker restart cqim-gateway
    ;;
  restart-db)
    echo "重启 MySQL 服务..."
    docker restart "${COMPOSE_PROJECT}-mysql-1" 2>/dev/null || docker restart "docker-mysql-1"
    echo "等待 MySQL 就绪后重启依赖服务..."
    sleep 10
    docker restart "${COMPOSE_PROJECT}-tangsengdaodaoserver-1" 2>/dev/null || docker restart "docker-tangsengdaodaoserver-1"
    docker restart imimchat-register
    docker restart cqim-app
    ;;
  status)
    echo "========== Docker 服务状态 =========="
    cd "$COMPOSE_DIR" && docker compose ps
    echo ""
    echo "========== 资源使用 =========="
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" \
      $(docker ps --format '{{.Names}}' | grep -E "tsdd|register|cqim|mongo|docker-") 2>/dev/null || true
    echo ""
    echo "========== Nginx 状态 =========="
    systemctl status nginx --no-pager -l 2>/dev/null | head -10 || echo "Nginx 状态不可用（非 root 或不在服务器上）"
    echo ""
    echo "========== 磁盘使用 =========="
    df -h /home/ubuntu/backups/mysql 2>/dev/null | tail -1 || echo "备份目录不存在"
    ;;
  health)
    echo "========== 服务健康检查 =========="
    check_url() {
        local name="$1" url="$2"
        if curl -sf -o /dev/null --max-time 5 "$url" 2>/dev/null; then
            echo "  ✅ $name: $url"
        else
            echo "  ❌ $name: $url (不可达)"
        fi
    }
    check_url "API服务"    "http://localhost:8090/v1/ping"
    check_url "Web前端"    "http://localhost:82"
    check_url "管理后台"   "http://localhost:83"
    check_url "注册服务"   "http://localhost:9091/register/health"
    check_url "MinIO"      "http://localhost:9000/minio/health/live"
    check_url "CQIM应用"   "http://localhost:3000/api/health"
    check_url "CQIM网关"   "http://localhost:8081/health"
    echo ""
    echo "========== 数据库连接测试 =========="
    MYSQL_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'mysql' | head -1)
    REDIS_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'redis' | head -1)
    MONGO_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'mongo' | head -1)
    if [ -n "$MYSQL_CONTAINER" ] && docker exec "$MYSQL_CONTAINER" mysqladmin ping -h localhost --silent 2>/dev/null; then
        echo "  ✅ MySQL: 连接正常"
    else
        echo "  ❌ MySQL: 连接失败"
    fi
    if [ -n "$REDIS_CONTAINER" ] && docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG; then
        echo "  ✅ Redis: 连接正常"
    else
        echo "  ❌ Redis: 连接失败"
    fi
    if [ -n "$MONGO_CONTAINER" ] && docker exec "$MONGO_CONTAINER" mongosh --quiet --eval "db.runCommand({ping:1}).ok" 2>/dev/null | grep -q 1; then
        echo "  ✅ MongoDB: 连接正常"
    else
        echo "  ❌ MongoDB: 连接失败"
    fi
    ;;
  logs)
    SERVICE="${2:-tangsengdaodaoserver}"
    case "$SERVICE" in
      register)
        echo "查看 imimchat-register 日志（最近 100 行）..."
        docker logs --tail=100 -f imimchat-register
        ;;
      cqim)
        echo "查看 CQIM 应用日志（最近 100 行）..."
        docker logs --tail=100 -f cqim-app
        ;;
      cqim-gateway|gateway)
        echo "查看 CQIM 网关日志（最近 100 行）..."
        docker logs --tail=100 -f cqim-gateway
        ;;
      mongo)
        echo "查看 MongoDB 日志（最近 100 行）..."
        docker logs --tail=100 -f cqim-mongo
        ;;
      mysql|redis|minio|wukongim|tangsengdaodaoweb|tangsengdaodaomanager)
        echo "查看 $SERVICE 日志（最近 100 行）..."
        docker logs --tail=100 -f "docker-${SERVICE}-1" 2>/dev/null || docker logs --tail=100 -f "${COMPOSE_PROJECT}-${SERVICE}-1"
        ;;
      tangsengdaodaoserver)
        echo "查看 API 服务日志（最近 100 行）..."
        docker logs --tail=100 -f "docker-tangsengdaodaoserver-1" 2>/dev/null || docker logs --tail=100 -f "${COMPOSE_PROJECT}-tangsengdaodaoserver-1"
        ;;
      *)
        echo "未知服务: $SERVICE"
        echo "可用服务: register, cqim, gateway, mongo, mysql, redis, minio, wukongim, tangsengdaodaoserver, tangsengdaodaoweb, tangsengdaodaomanager"
        exit 1
        ;;
    esac
    ;;
  update-web)
    echo "更新 Web 前端镜像..."
    cd "$COMPOSE_DIR"
    docker compose pull tangsengdaodaoweb
    docker compose up -d tangsengdaodaoweb
    echo "注意：更新后需要重新注入自定义文件！"
    echo "执行：bash scripts/deploy-frontend.sh"
    ;;
  rebuild-register)
    echo "重新构建并启动注册中间件..."
    cd "$COMPOSE_DIR"
    docker compose build register
    docker compose up -d register
    echo "注册中间件已更新"
    bash "$0" health
    ;;
  rebuild-cqim)
    echo "重新构建并启动 CQIM 应用..."
    cd "$COMPOSE_DIR"
    docker compose build cqim cqim-gateway
    docker compose up -d cqim cqim-gateway
    echo "CQIM 应用已更新"
    bash "$0" health
    ;;
  backup)
    echo "执行数据库备份..."
    bash "$(dirname "$0")/backup-db.sh"
    ;;
  *)
    echo "用法: $0 {start|stop|restart|restart-web|restart-api|restart-register|restart-cqim|restart-db|status|health|logs [svc]|update-web|rebuild-register|rebuild-cqim|backup}"
    echo ""
    echo "命令说明："
    echo "  start              启动所有服务并检查健康状态"
    echo "  stop               停止所有服务"
    echo "  restart            重启所有服务并检查健康状态"
    echo "  restart-web        仅重启 Web 前端"
    echo "  restart-api        仅重启 API 服务"
    echo "  restart-register   仅重启注册中间件"
    echo "  restart-cqim       仅重启 CQIM 应用和网关"
    echo "  restart-db         重启 MySQL（自动重启依赖服务）"
    echo "  status             查看服务状态和资源使用"
    echo "  health             执行全面健康检查"
    echo "  logs [svc]         查看服务日志（支持: register, cqim, gateway, mongo 等）"
    echo "  update-web         更新 Web 前端镜像"
    echo "  rebuild-register   重新构建并启动注册中间件"
    echo "  rebuild-cqim       重新构建并启动 CQIM 应用"
    echo "  backup             执行数据库备份"
    exit 1
    ;;
esac
