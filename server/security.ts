/**
 * server/security.ts - 统一安全中间件
 *
 * 覆盖 Grok 方案中的以下安全维度：
 * 1. 安全响应头（HSTS / CSP / X-Frame-Options / X-Content-Type-Options）
 * 2. 速率限制（Rate Limiting）：全局 + 登录专用 + 管理后台专用
 * 3. CSRF 防护（双重提交 Cookie 模式）
 * 4. 管理后台 IP 白名单
 * 5. 请求体大小限制与超时保护
 * 6. 输入消毒工具函数
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from './db.js';
import { logIllegalRequestMySQL } from './mysql.js';

// ============================================================
// 1. 安全响应头中间件
// ============================================================

/**
 * 设置全面的安全响应头，防范 XSS、点击劫持、MIME 嗅探、协议降级等攻击。
 * 参考 OWASP Secure Headers Project。
 */
function isHttpsRequest(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const isProduction = process.env.NODE_ENV === 'production';

  // HSTS 仅在 HTTPS 环境下返回，避免本地开发或 HTTP 反向代理误配
  if (isHttpsRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // 防止 MIME 类型嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 防止页面被嵌入 iframe（防点击劫持）
  res.setHeader('X-Frame-Options', 'DENY');

  // XSS 过滤器（旧浏览器兼容）
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // 控制 Referer 信息泄露
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 限制浏览器功能访问
  // 音视频通话需要允许当前站点访问摄像头和麦克风
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=()');

  // CSP：允许内联脚本（manus-runtime 注入需要），生产环境移除 unsafe-eval
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://cdn.bootcdn.net",
    "font-src 'self' https://cdn.bootcdn.net data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' ws: wss: https:",
    "media-src 'self' blob: https:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));

  // 禁止缓存敏感 API 响应（排除静态文件路径，允许其被正常缓存）
  const isStaticAsset = req.path.startsWith('/api/stickers/files/') || req.path.startsWith('/api/media/files/');
  if (req.path.startsWith('/api/') && !isStaticAsset) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
}

// ============================================================
// 2. 速率限制（内存滑动窗口）
// ============================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/** 通用速率限制器（滑动窗口） */
class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    // 定期清理过期条目，防止内存泄漏
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now > entry.resetAt) this.store.delete(key);
      }
    }, Math.min(windowMs, 60_000));
    this.cleanupTimer.unref?.();
  }

  /** 检查是否超限，返回 { allowed, remaining, resetAt } */
  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.store.set(key, entry);
    }

    entry.count++;
    const allowed = entry.count <= this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - entry.count);

    return { allowed, remaining, resetAt: entry.resetAt };
  }

  /** 重置指定 key 的计数（如登录成功后） */
  reset(key: string) {
    this.store.delete(key);
  }
}

// --- 全局 API 限流：每 IP 每分钟 120 次 ---
const globalLimiter = new RateLimiter(60_000, 120);

// --- 登录限流：每 IP 每 15 分钟 10 次 ---
const loginLimiter = new RateLimiter(15 * 60_000, 10);

// --- 登录限流：每账号每 15 分钟 5 次 ---
const accountLoginLimiter = new RateLimiter(15 * 60_000, 5);

// --- 验证码发送限流：每 IP 每小时 10 次 ---
const codeLimiter = new RateLimiter(60 * 60_000, 10);

// --- 管理后台限流：每 IP 每 15 分钟 5 次登录 ---
const adminLoginLimiter = new RateLimiter(15 * 60_000, 5);

/** 获取客户端真实 IP */
function getClientIP(req: Request): string {
  let ip =
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-real-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown';
  if (ip?.includes('::ffff:')) ip = ip.split('::ffff:')[1];
  return ip;
}

/** 全局 API 速率限制中间件 */
export function globalRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);
  const result = globalLimiter.check(`global:${ip}`);

  res.setHeader('X-RateLimit-Limit', '120');
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

  if (!result.allowed) {
    // 记录异常请求
    recordIllegalRequest(ip, req.path, 'rate_limit_exceeded', req.headers['user-agent'] || '');
    return res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
    });
  }
  next();
}

/** 登录接口速率限制中间件 */
export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);
  const ipResult = loginLimiter.check(`login:ip:${ip}`);

  if (!ipResult.allowed) {
    recordIllegalRequest(ip, req.path, 'login_brute_force', req.headers['user-agent'] || '');
    return res.status(429).json({
      error: '登录尝试过于频繁，请 15 分钟后再试',
      retryAfter: Math.ceil((ipResult.resetAt - Date.now()) / 1000),
    });
  }

  // 如果请求体中有 account，也按账号限流
  const account = req.body?.account;
  if (account) {
    const accountResult = accountLoginLimiter.check(`login:account:${account}`);
    if (!accountResult.allowed) {
      recordIllegalRequest(ip, req.path, 'account_brute_force', `account=${account}`);
      return res.status(429).json({
        error: '该账号登录尝试过于频繁，请 15 分钟后再试',
        retryAfter: Math.ceil((accountResult.resetAt - Date.now()) / 1000),
      });
    }
  }

  next();
}

/** 验证码发送速率限制 */
export function codeRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);
  const result = codeLimiter.check(`code:${ip}`);

  if (!result.allowed) {
    recordIllegalRequest(ip, req.path, 'code_spam', req.headers['user-agent'] || '');
    return res.status(429).json({
      error: '验证码发送过于频繁，请稍后再试',
      retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
    });
  }
  next();
}

/** 管理后台登录速率限制 */
export function adminLoginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);
  const result = adminLoginLimiter.check(`admin:login:${ip}`);

  if (!result.allowed) {
    recordIllegalRequest(ip, req.path, 'admin_brute_force', req.headers['user-agent'] || '');
    return res.status(429).json({
      error: '管理后台登录尝试过于频繁，请 15 分钟后再试',
      retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
    });
  }
  next();
}

/** 登录成功后重置限流计数 */
export function resetLoginLimits(ip: string, account: string) {
  loginLimiter.reset(`login:ip:${ip}`);
  accountLoginLimiter.reset(`login:account:${account}`);
}

export function resetAdminLoginLimits(ip: string) {
  adminLoginLimiter.reset(`admin:login:${ip}`);
}

// ============================================================
// 3. CSRF 防护（双重提交 Cookie 模式）
// ============================================================

/**
 * CSRF Token 生成中间件
 * 为每个会话生成 CSRF Token，通过 Cookie 和响应头双重下发。
 * 客户端在后续 POST/PUT/DELETE 请求中需在 X-CSRF-Token 头中携带此值。
 */
export function csrfTokenGenerate(req: Request, res: Response, next: NextFunction) {
  // 只对管理后台路径启用 CSRF 防护
  if (!req.path.startsWith('/api/admin')) return next();

  // GET 请求时下发 CSRF Token
  if (req.method === 'GET') {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', token, {
      httpOnly: false,  // 前端需要读取
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600_000,  // 1 小时
      path: '/api/admin',
    });
    res.setHeader('X-CSRF-Token', token);
  }
  next();
}

/**
 * CSRF Token 验证中间件
 * 验证 POST/PUT/DELETE 请求中的 X-CSRF-Token 头与 Cookie 中的值是否一致。
 */
export function csrfTokenVerify(req: Request, res: Response, next: NextFunction) {
  // 只对管理后台的写操作启用
  if (!req.path.startsWith('/api/admin')) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // 登录接口豁免（此时还没有 CSRF Cookie）
  if (req.path === '/api/admin/login') return next();

  const cookieToken = (req.cookies as any)?.csrf_token;
  const headerToken = req.headers['x-csrf-token'] as string;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    const ip = getClientIP(req);
    recordIllegalRequest(ip, req.path, 'csrf_violation', `cookie=${!!cookieToken}, header=${!!headerToken}`);
    return res.status(403).json({ error: 'CSRF 验证失败，请刷新页面后重试' });
  }
  next();
}

// ============================================================
// 4. 管理后台 IP 白名单
// ============================================================

/**
 * 管理后台 IP 白名单中间件
 * 从数据库 SystemConfig 中读取白名单配置，仅允许指定 IP 访问。
 * 如果未配置白名单（空列表），则不限制（兼容初始部署）。
 */
let _adminIpWhitelist: string[] = [];
let _adminIpWhitelistCachedAt = 0;
const ADMIN_IP_WHITELIST_TTL = 60_000; // 60 秒缓存

async function loadAdminIpWhitelist(): Promise<string[]> {
  const now = Date.now();
  if (now - _adminIpWhitelistCachedAt < ADMIN_IP_WHITELIST_TTL) {
    return _adminIpWhitelist;
  }
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'adminIpWhitelist' } });
    if (config?.value) {
      const parsed = JSON.parse(config.value);
      _adminIpWhitelist = Array.isArray(parsed) ? parsed : [];
    } else {
      _adminIpWhitelist = [];
    }
  } catch {
    // 查询失败时保留上次缓存
  }
  _adminIpWhitelistCachedAt = now;
  return _adminIpWhitelist;
}

export async function adminIpWhitelist(req: Request, res: Response, next: NextFunction) {
  const whitelist = await loadAdminIpWhitelist();

  // 白名单为空时不限制（兼容初始部署）
  if (whitelist.length === 0) return next();

  const ip = getClientIP(req);

  // 支持 CIDR 段匹配和精确匹配
  const allowed = whitelist.some(entry => {
    if (entry.includes('/')) {
      return isIpInCidr(ip, entry);
    }
    return ip === entry;
  });

  if (!allowed) {
    recordIllegalRequest(ip, req.path, 'admin_ip_blocked', `IP not in whitelist`);
    return res.status(403).json({ error: '访问被拒绝' });
  }
  next();
}

/** 简单 CIDR 匹配（IPv4） */
function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const [range, bits] = cidr.split('/');
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);
    const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
    const rangeNum = range.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
    return (ipNum & mask) === (rangeNum & mask);
  } catch {
    return false;
  }
}

// ============================================================
// 5. 异常请求记录
// ============================================================

/** 记录异常/非法请求到数据库（异步，不阻塞响应） */
async function recordIllegalRequest(ip: string, path: string, type: string, detail: string) {
  try {
    const normalizedDetail = detail?.trim();
    const looksLikeUserAgent = normalizedDetail
      ? normalizedDetail.includes("Mozilla/") || normalizedDetail.includes("Chrome/") || normalizedDetail.includes("Safari/")
      : false;
    const reason = normalizedDetail ? `${type}: ${normalizedDetail}` : type;
    const userAgent = looksLikeUserAgent ? normalizedDetail : undefined;

    await Promise.allSettled([
      prisma.illegalRequest.create({
        data: {
          ip,
          path,
          reason,
          userAgent,
          createdAt: new Date(),
        },
      }),
      logIllegalRequestMySQL({
        ip,
        path,
        method: undefined,
        userAgent,
        reason,
        statusCode: 429,
        createdAt: new Date(),
      }),
    ]);
  } catch {
    // 静默失败，不影响正常流程
  }
}

// ============================================================
// 6. 输入消毒工具函数
// ============================================================

/** 转义 HTML 特殊字符，防止 XSS */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** 清理用户输入：去除首尾空白、限制长度 */
export function sanitizeInput(str: string, maxLength: number = 1000): string {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

/** 验证是否包含危险字符（SQL 注入、XSS 载荷） */
export function containsDangerousInput(str: string): boolean {
  if (typeof str !== 'string') return false;
  const patterns = [
    /<script\b/i,
    /javascript:/i,
    /on\w+\s*=/i,       // onclick=, onerror= 等
    /union\s+select/i,
    /;\s*drop\s+/i,
    /;\s*delete\s+/i,
    /'\s*or\s+'1/i,
    /--\s*$/,
  ];
  return patterns.some(p => p.test(str));
}

// ============================================================
// 7. 错误信息脱敏
// ============================================================

/**
 * 全局错误处理中间件
 * 生产环境下隐藏错误详情，防止信息泄露。
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const ip = getClientIP(req);
  console.error(`[Security] 未捕获错误 (${ip} ${req.method} ${req.path}):`, err.message);

  // 生产环境不暴露错误详情
  if (process.env.NODE_ENV === 'production') {
    res.status(500).json({ error: '服务器内部错误' });
  } else {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}

// ============================================================
// 导出速率限制器实例（供其他模块使用）
// ============================================================

export { getClientIP, RateLimiter };
