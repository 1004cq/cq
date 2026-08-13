#!/bin/bash
# imimchat 数据库备份脚本（增强版）
# 用途：备份 MySQL 数据库，支持本地保留 + 可选远程同步
# 使用方法：
#   bash scripts/backup-db.sh              # 本地备份
#   bash scripts/backup-db.sh --remote      # 本地备份 + 远程同步
#
# 建议：配置 cron 定时执行
#   0 3 * * * /home/ubuntu/tsdd/scripts/backup-db.sh >> /var/log/imimchat-backup.log 2>&1

set -euo pipefail

# ===== 配置 =====
CONTAINER="tsdd-mysql-1"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/mysql}"
DB_NAME="im"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:?错误: 请设置 MYSQL_ROOT_PASSWORD 环境变量}"

# 远程同步配置（可选）
REMOTE_BACKUP_ENABLED="${REMOTE_BACKUP_ENABLED:-false}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_PATH="${RCLONE_PATH:-backups/imimchat/}"

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/im_backup_${DATE}.sql.gz"
LOG_TAG="[imimchat-backup]"

# ===== 函数 =====
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $LOG_TAG $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

# ===== 主流程 =====
log "========== 数据库备份开始 =========="

# 检查容器是否运行
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    error_exit "MySQL 容器 ${CONTAINER} 未运行"
fi

# 创建备份目录
mkdir -p "$BACKUP_DIR" || error_exit "无法创建备份目录 $BACKUP_DIR"

# 检查磁盘空间（至少需要 500MB）
available_kb=$(df "$BACKUP_DIR" | awk 'NR==2 {print $4}')
if [ "$available_kb" -lt 512000 ]; then
    error_exit "磁盘空间不足（可用: $((available_kb / 1024))MB，需要: 500MB）"
fi

# 执行备份
log "备份数据库 ${DB_NAME}..."
if ! docker exec "$CONTAINER" mysqldump \
    -u root -p"$MYSQL_ROOT_PASSWORD" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --hex-blob \
    --default-character-set=utf8mb4 \
    "$DB_NAME" 2>/tmp/mysqldump_error.log | gzip > "$BACKUP_FILE"; then
    error_msg=$(cat /tmp/mysqldump_error.log 2>/dev/null || echo "未知错误")
    error_exit "数据库备份失败: $error_msg"
fi

# 验证备份文件
backup_size=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo 0)
if [ "$backup_size" -lt 1024 ]; then
    error_exit "备份文件过小（${backup_size} 字节），可能备份失败"
fi

# 验证 gzip 完整性
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
    error_exit "备份文件 gzip 校验失败"
fi

log "备份完成: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

# 清理旧备份
log "清理 ${RETENTION_DAYS} 天前的旧备份..."
deleted_count=$(find "$BACKUP_DIR" -name "im_backup_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)
log "已清理 ${deleted_count} 个旧备份文件"

# 远程同步（可选）
if [ "${1:-}" = "--remote" ] || [ "$REMOTE_BACKUP_ENABLED" = "true" ]; then
    if [ -z "$RCLONE_REMOTE" ]; then
        log "WARNING: REMOTE_BACKUP_ENABLED=true 但 RCLONE_REMOTE 未设置，跳过远程同步"
    elif command -v rclone &>/dev/null; then
        log "同步到远程: ${RCLONE_REMOTE}:${RCLONE_PATH}"
        if rclone copy "$BACKUP_FILE" "${RCLONE_REMOTE}:${RCLONE_PATH}" --checksum; then
            log "远程同步完成"
        else
            log "WARNING: 远程同步失败，本地备份仍有效"
        fi
    else
        log "WARNING: rclone 未安装，跳过远程同步"
    fi
fi

# 汇总
total_backups=$(find "$BACKUP_DIR" -name "im_backup_*.sql.gz" | wc -l)
total_size=$(du -sh "$BACKUP_DIR" | cut -f1)
log "备份目录: $BACKUP_DIR，共 ${total_backups} 个备份，占用 ${total_size}"
log "========== 备份任务完成 =========="
