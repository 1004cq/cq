import * as mysql from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';

const MYSQL_URL = process.env.MYSQL_URL || '';
const MYSQL_AUDIT_ENABLED = (process.env.MYSQL_AUDIT_ENABLED || 'true') !== 'false';

let pool: Pool | null = null;
let initPromise: Promise<Pool | null> | null = null;

interface CountRow extends RowDataPacket {
  total: number;
}

interface LoginLogRow extends RowDataPacket {
  id: number;
  user_id: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  ip: string | null;
  user_agent: string | null;
  success: number;
  fail_reason: string | null;
  login_type: string | null;
  created_at: Date;
}

interface AdminLogRow extends RowDataPacket {
  id: number;
  admin_id: string | null;
  admin_name: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  created_at: Date;
}

interface IllegalRequestRow extends RowDataPacket {
  id: number;
  ip: string | null;
  path: string | null;
  method: string | null;
  user_agent: string | null;
  reason: string | null;
  status_code: number | null;
  created_at: Date;
}

export function isMySQLAuditEnabled(): boolean {
  return Boolean(MYSQL_URL) && MYSQL_AUDIT_ENABLED;
}

async function createPoolIfNeeded(): Promise<Pool | null> {
  if (!isMySQLAuditEnabled()) return null;
  if (pool) return pool;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const created = mysql.createPool({
      uri: MYSQL_URL,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
      maxIdle: Number(process.env.MYSQL_MAX_IDLE || 10),
      idleTimeout: Number(process.env.MYSQL_IDLE_TIMEOUT_MS || 60000),
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      timezone: 'Z',
    });

    await ensureAuditTables(created);
    pool = created;
    return created;
  })().finally(() => {
    initPromise = null;
  });

  return initPromise;
}

async function ensureAuditTables(targetPool: Pool) {
  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      admin_id VARCHAR(64) NULL,
      admin_name VARCHAR(128) NULL,
      action VARCHAR(128) NOT NULL,
      target VARCHAR(255) NULL,
      detail TEXT NULL,
      ip VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_admin_logs_created_at (created_at),
      KEY idx_admin_logs_admin_id (admin_id),
      KEY idx_admin_logs_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id VARCHAR(64) NULL,
      username VARCHAR(128) NULL,
      email VARCHAR(255) NULL,
      phone VARCHAR(64) NULL,
      ip VARCHAR(64) NULL,
      user_agent TEXT NULL,
      success TINYINT(1) NOT NULL DEFAULT 0,
      fail_reason VARCHAR(255) NULL,
      login_type VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_login_logs_created_at (created_at),
      KEY idx_login_logs_success (success),
      KEY idx_login_logs_user_id (user_id),
      KEY idx_login_logs_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS illegal_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ip VARCHAR(64) NULL,
      path VARCHAR(512) NULL,
      method VARCHAR(16) NULL,
      user_agent TEXT NULL,
      reason TEXT NULL,
      status_code INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_illegal_requests_created_at (created_at),
      KEY idx_illegal_requests_ip (ip),
      KEY idx_illegal_requests_status_code (status_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

export async function connectMySQL(): Promise<boolean> {
  try {
    const currentPool = await createPoolIfNeeded();
    if (!currentPool) {
      console.log('[MySQL] 未启用审计存储，跳过连接');
      return false;
    }
    await currentPool.query('SELECT 1');
    console.log('[MySQL] 审计存储连接成功');
    return true;
  } catch (err) {
    console.error('[MySQL] 审计存储连接失败:', err);
    return false;
  }
}

export async function logAdminActionMySQL(data: {
  adminId?: string | null;
  adminName?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
  createdAt?: Date;
}) {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return;
  await currentPool.execute(
    `INSERT INTO admin_logs (admin_id, admin_name, action, target, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.adminId ?? null,
      data.adminName ?? null,
      data.action,
      data.target ?? null,
      data.detail ?? null,
      data.ip ?? null,
      data.createdAt ?? new Date(),
    ],
  );
}

export async function logLoginMySQL(data: {
  userId?: string | null;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  success: boolean;
  failReason?: string | null;
  loginType?: string | null;
  createdAt?: Date;
}) {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return;
  await currentPool.execute(
    `INSERT INTO login_logs (user_id, username, email, phone, ip, user_agent, success, fail_reason, login_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.userId ?? null,
      data.username ?? null,
      data.email ?? null,
      data.phone ?? null,
      data.ip ?? null,
      data.userAgent ?? null,
      data.success ? 1 : 0,
      data.failReason ?? null,
      data.loginType ?? null,
      data.createdAt ?? new Date(),
    ],
  );
}

export async function logIllegalRequestMySQL(data: {
  ip?: string | null;
  path?: string | null;
  method?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  statusCode?: number | null;
  createdAt?: Date;
}) {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return;
  await currentPool.execute(
    `INSERT INTO illegal_requests (ip, path, method, user_agent, reason, status_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.ip ?? null,
      data.path ?? null,
      data.method ?? null,
      data.userAgent ?? null,
      data.reason ?? null,
      data.statusCode ?? null,
      data.createdAt ?? new Date(),
    ],
  );
}

export async function getAdminLogsMySQL(page = 1, pageSize = 20) {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return null;
  const offset = Math.max(0, (page - 1) * pageSize);
  const [rows] = await currentPool.query<AdminLogRow[]>(
    `SELECT id, admin_id, admin_name, action, target, detail, ip, created_at
     FROM admin_logs
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset],
  );
  const [countRows] = await currentPool.query<CountRow[]>('SELECT COUNT(*) AS total FROM admin_logs');
  return {
    logs: rows.map((row) => ({
      id: String(row.id),
      adminId: row.admin_id,
      adminName: row.admin_name,
      action: row.action,
      target: row.target,
      detail: row.detail,
      ip: row.ip,
      createdAt: row.created_at,
    })),
    total: Number(countRows[0]?.total || 0),
  };
}

export async function getLoginLogsMySQL(page = 1, pageSize = 20, filter: 'all' | 'success' | 'fail' = 'all') {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return null;
  const offset = Math.max(0, (page - 1) * pageSize);
  const whereClause = filter === 'success' ? 'WHERE success = 1' : filter === 'fail' ? 'WHERE success = 0' : '';
  const [rows] = await currentPool.query<LoginLogRow[]>(
    `SELECT id, user_id, username, email, phone, ip, user_agent, success, fail_reason, login_type, created_at
     FROM login_logs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset],
  );
  const [countRows] = await currentPool.query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM login_logs ${whereClause}`,
  );
  return {
    list: rows.map((row) => ({
      id: String(row.id),
      userId: row.user_id,
      username: row.username,
      email: row.email,
      phone: row.phone,
      ip: row.ip,
      userAgent: row.user_agent,
      success: !!row.success,
      failReason: row.fail_reason,
      loginType: row.login_type,
      createdAt: row.created_at,
    })),
    total: Number(countRows[0]?.total || 0),
  };
}

export async function getIllegalRequestsMySQL(page = 1, pageSize = 20) {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return null;
  const offset = Math.max(0, (page - 1) * pageSize);
  const [rows] = await currentPool.query<IllegalRequestRow[]>(
    `SELECT id, ip, path, method, user_agent, reason, status_code, created_at
     FROM illegal_requests
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset],
  );
  const [countRows] = await currentPool.query<CountRow[]>('SELECT COUNT(*) AS total FROM illegal_requests');
  return {
    list: rows.map((row) => ({
      id: String(row.id),
      ip: row.ip,
      path: row.path,
      method: row.method,
      userAgent: row.user_agent,
      reason: row.reason,
      statusCode: row.status_code,
      createdAt: row.created_at,
    })),
    total: Number(countRows[0]?.total || 0),
  };
}

export async function getAuditCountsMySQL() {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return null;
  const [[loginRows], [illegalRows], [adminRows]] = await Promise.all([
    currentPool.query<CountRow[]>('SELECT COUNT(*) AS total FROM login_logs'),
    currentPool.query<CountRow[]>('SELECT COUNT(*) AS total FROM illegal_requests'),
    currentPool.query<CountRow[]>('SELECT COUNT(*) AS total FROM admin_logs'),
  ]);
  return {
    totalLoginLogs: Number(loginRows[0]?.total || 0),
    totalIllegalRequests: Number(illegalRows[0]?.total || 0),
    totalAdminLogs: Number(adminRows[0]?.total || 0),
  };
}

export async function clearLoginLogsMySQL() {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return false;
  await currentPool.query('TRUNCATE TABLE login_logs');
  return true;
}

export async function clearIllegalRequestsMySQL() {
  const currentPool = await createPoolIfNeeded();
  if (!currentPool) return false;
  await currentPool.query('TRUNCATE TABLE illegal_requests');
  return true;
}
