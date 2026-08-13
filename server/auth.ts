/**
 * server/auth.ts - 用户认证服务
 * 支持手机号/ID/邮箱登录注册，集成阿里云短信和号码认证服务
 */
import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import prisma, { hashPassword, verifyPassword, generateToken, isLegacyHash } from './db.js';
import { getAdminConfig, logLogin } from './admin.js';
import {
  loginRateLimit,
  codeRateLimit,
  resetLoginLimits,
  sanitizeInput,
  containsDangerousInput,
  getClientIP as secGetClientIP,
} from './security.js';
import {
  redis,
  setSessionCache as redisSetSession,
  getSessionCache as redisGetSession,
  deleteSessionCache as redisDeleteSession,
  deleteUserSessionCache as redisDeleteUserSession,
  hasRecentVerifyCodeSend,
  markRecentVerifyCodeSend,
  setVerifyCodeRecord,
  getVerifyCodeRecord,
  updateVerifyCodeRecord,
} from './redis.js';
import { avatarToProxy } from './cos-signer.js';

const router = Router();

async function ensureUserCosFolder(userId: string, username?: string): Promise<void> {
  const config = await getAdminConfig('cos') || {};
  const secretId = config.secretId || process.env.COS_SECRET_ID;
  const secretKey = config.secretKey || process.env.COS_SECRET_KEY;
  const bucket = config.bucket || process.env.COS_BUCKET;
  const region = config.region || process.env.COS_REGION || 'ap-guangzhou';
  const enabled = config.enabled !== false;
  if (!enabled || !secretId || !secretKey || !bucket || !region || !userId) return;

  try {
    const COSModule: any = await import('cos-nodejs-sdk-v5');
    const COS = COSModule.default || COSModule;
    const cos = new COS({ SecretId: secretId, SecretKey: secretKey });
    const userDir = username || userId;
    // 创建用户目录结构：ASCII 路径主使用（避免 EdgeOne 中文路径问题）
    const dirs = [
      `imimchat/moments/${userDir}/photos/.init`,
      `imimchat/moments/${userDir}/videos/.init`,
      `imimchat/avatars/${userDir}/.init`,
    ];
    await Promise.allSettled(dirs.map(key =>
      new Promise<void>((resolve, reject) => {
        cos.putObject({ Bucket: bucket, Region: region, Key: key, Body: '' }, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      })
    ));
  } catch (error) {
    console.error('[auth] 初始化 COS 用户目录失败:', error);
  }
}

// ============ 阿里云 SDK 动态导入 ============

async function getAliyunConfig() {
  const config = await getAdminConfig('aliyun') || {};
  return {
    accessKeyId: config.accessKeyId || '',
    accessKeySecret: config.accessKeySecret || '',
    smsSignName: config.smsSignName || '',
    smsSignNames: config.smsSignNames || [],
    smsTemplates: config.smsTemplates || {},
    smsEnabled: !!config.smsEnabled,
    phoneAuthEnabled: !!config.phoneAuthEnabled,
  };
}

/**
 * 根据业务场景获取对应的模板 Code
 * 场景映射：
 *   login/register -> smsTemplates.login
 *   reset         -> smsTemplates.reset
 *   bind          -> smsTemplates.bind
 *   change_phone  -> smsTemplates.changePhone
 *   verify_phone  -> smsTemplates.verifyPhone
 */
function getTemplateCodeForScene(config: any, scene: string): string {
  const templates = config.smsTemplates || {};
  const sceneMap: Record<string, string> = {
    login: 'login',
    register: 'login',       // 登录和注册共用一个模板
    reset: 'reset',
    bind: 'bind',
    change_phone: 'changePhone',
    verify_phone: 'verifyPhone',
  };
  const key = sceneMap[scene] || 'login';
  return templates[key]?.code || '';
}

/**
 * 通过阿里云号码认证服务（dypnsapi）发送短信验证码
 * 使用赠送模板，阿里云自动生成验证码，无需本地生成
 * @param phone 手机号
 * @param scene 业务场景（login/register/reset/bind/change_phone/verify_phone）
 */
async function sendAliyunSms(phone: string, _code: string, scene: string = 'login'): Promise<{ success: boolean; message: string }> {
  const config = await getAliyunConfig();
  if (!config.smsEnabled || !config.accessKeyId || !config.accessKeySecret) {
    return { success: false, message: '短信服务未配置' };
  }

  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    // 使用 dypnsapi（号码认证服务）的 SendSmsVerifyCode 接口
    // 该接口支持赠送模板（100001等），阿里云自动生成验证码
    const pnsModule = require('@alicloud/dypnsapi20170525');
    const { Config } = require('@alicloud/openapi-client');
    const { RuntimeOptions } = require('@alicloud/tea-util');

    const DypnsClient = pnsModule.default || pnsModule;
    const SendSmsVerifyCodeRequest = pnsModule.SendSmsVerifyCodeRequest;

    const apiConfig = new Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    });
    apiConfig.endpoint = 'dypnsapi.aliyuncs.com';

    const client = new DypnsClient(apiConfig);

    // 根据场景获取模板 Code（赠送模板：100001~100005）
    const templateCode = getTemplateCodeForScene(config, scene);
    const signName = config.smsSignName;

    const sendReq = new SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      signName: signName || undefined,
      templateCode: templateCode || undefined,
      // 使用 ##code## 占位符，阿里云自动替换为实际验证码
      templateParam: JSON.stringify({ code: '##code##', min: '5' }),
      codeLength: 6,
      validTime: 300, // 5分钟有效
    });

    const runtime = new RuntimeOptions({});
    const result = await client.sendSmsVerifyCodeWithOptions(sendReq, runtime);
    const body = result.body;

    if (body?.code === 'OK') {
      return { success: true, message: '短信发送成功' };
    } else {
      console.error('[Aliyun SMS] 发送失败:', body?.code, body?.message);
      return { success: false, message: body?.message || '短信发送失败' };
    }
  } catch (err: any) {
    console.error('[Aliyun SMS] 发送失败:', err.message);
    return { success: false, message: err.message || '短信服务异常' };
  }
}

/**
 * 通过阿里云号码认证服务（dypnsapi）校验短信验证码
 * 与 sendAliyunSms 配对使用，验证码由阿里云管理
 * @param phone 手机号
 * @param code 用户输入的验证码
 */
async function checkAliyunSmsCode(phone: string, code: string): Promise<{ valid: boolean; error?: string }> {
  const config = await getAliyunConfig();
  if (!config.smsEnabled || !config.accessKeyId || !config.accessKeySecret) {
    return { valid: false, error: '短信服务未配置' };
  }

  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const pnsModule = require('@alicloud/dypnsapi20170525');
    const { Config } = require('@alicloud/openapi-client');
    const { RuntimeOptions } = require('@alicloud/tea-util');

    const DypnsClient = pnsModule.default || pnsModule;
    const CheckSmsVerifyCodeRequest = pnsModule.CheckSmsVerifyCodeRequest;

    const apiConfig = new Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    });
    apiConfig.endpoint = 'dypnsapi.aliyuncs.com';

    const client = new DypnsClient(apiConfig);
    const checkReq = new CheckSmsVerifyCodeRequest({
      phoneNumber: phone,
      verifyCode: code,
    });

    const runtime = new RuntimeOptions({});
    const result = await client.checkSmsVerifyCodeWithOptions(checkReq, runtime);
    const body = result.body;

    if (body?.code === 'OK') {
      return { valid: true };
    } else {
      return { valid: false, error: body?.message || '验证码错误' };
    }
  } catch (err: any) {
    console.error('[Aliyun SMS Check] 校验失败:', err.message);
    return { valid: false, error: '验证码校验异常' };
  }
}

/** 阿里云号码认证：通过 token 获取手机号 */
async function getPhoneByToken(spToken: string): Promise<{ success: boolean; phone?: string; message?: string }> {
  const config = await getAliyunConfig();
  if (!config.phoneAuthEnabled || !config.accessKeyId || !config.accessKeySecret) {
    return { success: false, message: '号码认证服务未配置' };
  }

  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const pnsModule = require('@alicloud/dypnsapi20170525');
    const { Config } = require('@alicloud/openapi-client');
    const { RuntimeOptions } = require('@alicloud/tea-util');

    const DypnsClient = pnsModule.default || pnsModule;
    const GetPhoneWithTokenRequest = pnsModule.GetPhoneWithTokenRequest;

    const apiConfig = new Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    });
    apiConfig.endpoint = 'dypnsapi.aliyuncs.com';

    const client = new DypnsClient(apiConfig);
    const req = new GetPhoneWithTokenRequest({ spToken });
    const runtime = new RuntimeOptions({});
    const result = await client.getPhoneWithTokenWithOptions(req, runtime);
    const body = result.body;

    if (body?.code === 'OK' && body?.getPhoneInfo?.phoneNum) {
      return { success: true, phone: body.getPhoneInfo.phoneNum };
    } else {
      return { success: false, message: body?.message || '号码认证失败' };
    }
  } catch (err: any) {
    console.error('[Aliyun PhoneAuth] 认证失败:', err.message);
    return { success: false, message: err.message || '号码认证服务异常' };
  }
}

// ============ 工具函数 ============

function getClientIP(req: Request): string {
  return (
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-real-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/** 生成6位数字验证码（密码学安全随机） */
function generateVerifyCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/** 验证手机号格式 */
function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

/** 验证邮箱格式 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** 验证用户ID格式（1-20位字母数字下划线） */
function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{1,20}$/.test(username);
}

/** 创建用户会话 */
async function createSession(userId: string, req: Request): Promise<string> {
  const token = generateToken(48);
  const ua = req.headers['user-agent'] || '';
  const ip = getClientIP(req);

  // 解析设备信息
  let device = '未知设备';
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad/.test(ua)) device = 'iPad';
  else if (/Android/.test(ua)) device = 'Android';
  else if (/Windows/.test(ua)) device = 'Windows';
  else if (/Mac/.test(ua)) device = 'Mac';
  else if (/Linux/.test(ua)) device = 'Linux';

  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|MicroMessenger)\/([\d.]+)/);
  if (browserMatch) device += ` · ${browserMatch[1]} ${browserMatch[2].split('.')[0]}`;

  await prisma.userSession.create({
    data: {
      userId,
      token,
      device,
      ip,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天
    },
  });

  // 更新用户最后登录信息
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date(), lastLoginIp: ip },
  });

  return token;
}

// ============ Session 内存缓存（减少高频鉴权 DB 查询） ============

/**
 * 万人群场景下，每条消息的 HTTP API 或 WebSocket 信令都可能触发鉴权查询。
 * 10000 人群每秒 100 条消息 = 每秒 100 次 findUnique(session + user)。
 * 
 * 优化策略：
 * - 使用 Map 缓存 session + user 数据，TTL = 30 秒
 * - 缓存命中时跳过 DB 查询，延迟 <1ms
 * - 缓存未命中时查 DB 并写入缓存
 * - 登出/封禁时主动清除缓存
 */
interface CachedSession {
  user: any;
  expiresAt: Date;
  cachedAt: number;
}

// 内存缓存（一级，<1ms）
const SESSION_CACHE = new Map<string, CachedSession>();
const SESSION_CACHE_TTL = 30_000; // 30 秒
const SESSION_CACHE_MAX_SIZE = 10_000;

/** 定期清理过期内存缓存（每 60 秒） */
setInterval(() => {
  const now = Date.now();
  for (const [token, cached] of SESSION_CACHE) {
    if (now - cached.cachedAt > SESSION_CACHE_TTL) {
      SESSION_CACHE.delete(token);
    }
  }
}, 60_000);

/** 主动清除指定 token 的缓存（登出时调用） */
export function invalidateSessionCache(token: string) {
  SESSION_CACHE.delete(token);
  redisDeleteSession(token).catch(() => {});
}

/** 主动清除指定用户的所有缓存（封禁时调用） */
export function invalidateUserSessionCache(userId: string) {
  for (const [token, cached] of SESSION_CACHE) {
    if (cached.user?.id === userId) {
      SESSION_CACHE.delete(token);
    }
  }
  redisDeleteUserSession(userId).catch(() => {});
}

async function getCachedSession(token: string): Promise<CachedSession | null> {
  const now = Date.now();

  // 一级：内存缓存
  const memCached = SESSION_CACHE.get(token);
  if (memCached && now - memCached.cachedAt < SESSION_CACHE_TTL) {
    return memCached;
  }

  // 二级：Redis 缓存（服务重启后仍有效）
  const redisCached = await redisGetSession(token);
  if (redisCached && new Date(redisCached.expiresAt) > new Date()) {
    const session: CachedSession = {
      user: redisCached.user,
      expiresAt: new Date(redisCached.expiresAt),
      cachedAt: now,
    };
    SESSION_CACHE.set(token, session);
    return session;
  }

  // 三级：数据库查询
  const session = await prisma.userSession.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session) {
    SESSION_CACHE.delete(token);
    redisDeleteSession(token).catch(() => {});
    return null;
  }

  // 写入内存缓存
  if (SESSION_CACHE.size >= SESSION_CACHE_MAX_SIZE) {
    const entries = Array.from(SESSION_CACHE.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const deleteCount = Math.floor(SESSION_CACHE_MAX_SIZE * 0.2);
    for (let i = 0; i < deleteCount; i++) {
      SESSION_CACHE.delete(entries[i][0]);
    }
  }

  const cachedSession: CachedSession = {
    user: session.user,
    expiresAt: session.expiresAt,
    cachedAt: now,
  };
  SESSION_CACHE.set(token, cachedSession);

  // 写入 Redis 缓存
  redisSetSession(token, {
    user: session.user,
    expiresAt: session.expiresAt.toISOString(),
    cachedAt: now,
  }).catch(() => {});

  return cachedSession;
}

// ============ 用户认证中间件（带缓存） ============

export async function userAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });

  const session = await getCachedSession(token);

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      SESSION_CACHE.delete(token);
      await prisma.userSession.delete({ where: { token } }).catch(() => {});
    }
    return res.status(401).json({ error: '登录已过期' });
  }

  if (session.user.isBanned) {
    return res.status(403).json({ error: '账号已被封禁', reason: session.user.banReason });
  }

  (req as any).user = session.user;
  (req as any).sessionToken = token;
  next();
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    const session = await getCachedSession(token);
    if (session && session.expiresAt >= new Date() && !session.user.isBanned) {
      (req as any).user = session.user;
    }
  }
  next();
}

// ============ 强密码策略 ============

/**
 * 密码强度检查（参考 OWASP 密码策略）
 * 要求：长度 >= 8，包含大小写字母 + 数字 + 特殊字符
 */
function checkPasswordStrength(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: '密码长度不能少于 8 位' };
  }
  if (password.length > 128) {
    return { valid: false, error: '密码长度不能超过 128 位' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: '密码必须包含小写字母' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: '密码必须包含大写字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: '密码必须包含数字' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    return { valid: false, error: '密码必须包含特殊字符（如 !@#$%^&*）' };
  }
  // 常见弱密码黑名单
  const weakPasswords = ['password', '12345678', 'qwerty123', 'admin123', 'abc12345'];
  if (weakPasswords.some(w => password.toLowerCase().includes(w))) {
    return { valid: false, error: '密码过于简单，请使用更复杂的密码' };
  }
  return { valid: true };
}

// ============ 发送验证码 ============

/**
 * POST /api/auth/send-code
 * body: { target, type, channel }
 * target: 手机号或邮箱
 * type: register | login | bind | reset
 * channel: sms | email
 */
router.post('/send-code', codeRateLimit, async (req: Request, res: Response) => {
  const { target, type = 'login', channel = 'sms' } = req.body;

  if (!target) return res.status(400).json({ error: '请输入手机号或邮箱' });

  // 验证格式
  if (channel === 'sms' && !isValidPhone(target)) {
    return res.status(400).json({ error: '手机号格式不正确' });
  }
  if (channel === 'email' && !isValidEmail(target)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  // 频率限制：同一目标 60 秒内只能发一次，优先使用 Redis
  const recentCodeInRedis = await hasRecentVerifyCodeSend(target, channel);
  if (recentCodeInRedis) {
    return res.status(429).json({ error: '发送过于频繁，请稍后再试', retryAfter: 60 });
  }

  const recentCode = await prisma.verifyCode.findFirst({
    where: {
      target,
      channel,
      createdAt: { gte: new Date(Date.now() - 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recentCode) {
    await markRecentVerifyCodeSend(target, channel, 60);
    return res.status(429).json({ error: '发送过于频繁，请稍后再试', retryAfter: 60 });
  }

  // 注册时检查是否已存在
  if (type === 'register') {
    const existing = channel === 'sms'
      ? await prisma.user.findUnique({ where: { phone: target } })
      : await prisma.user.findUnique({ where: { email: target } });
    if (existing) {
      return res.status(409).json({ error: channel === 'sms' ? '该手机号已注册' : '该邮箱已注册' });
    }
  }

  // 登录时检查是否存在（手机号/邮箱登录必须已注册）
  if (type === 'login') {
    const existing = channel === 'sms'
      ? await prisma.user.findUnique({ where: { phone: target } })
      : await prisma.user.findUnique({ where: { email: target } });
    if (!existing) {
      return res.status(404).json({ error: channel === 'sms' ? '该手机号未注册' : '该邮箱未注册' });
    }
  }

  if (channel === 'sms') {
    // SMS 渠道：通过阿里云 dypnsapi 发送，验证码由阿里云管理，无需本地存储
    const result = await sendAliyunSms(target, '', type);
    if (!result.success) {
      console.log(`[Auth] 短信发送失败(${result.message}) -> ${target}`);
      // 降级：本地生成验证码存库，方便调试
      const fallbackCode = generateVerifyCode();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await prisma.verifyCode.create({
        data: { target, code: fallbackCode, type, channel, expiresAt },
      });
      await setVerifyCodeRecord({
        target,
        type,
        channel,
        code: fallbackCode,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        used: false,
        attempts: 0,
      });
      await markRecentVerifyCodeSend(target, channel, 60);
      return res.json({
        success: true,
        message: '验证码已发送',
        _dev: process.env.NODE_ENV !== 'production' ? fallbackCode : undefined,
        _smsError: process.env.NODE_ENV !== 'production' ? result.message : undefined,
      });
    }
    // 发送成功：在数据库中存储一条占位记录（code 为空），用于频率限制判断
    // 实际验证码由阿里云管理，校验时调用 checkAliyunSmsCode
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.verifyCode.create({
      data: { target, code: '__aliyun__', type, channel, expiresAt },
    });
    await setVerifyCodeRecord({
      target,
      type,
      channel,
      code: '__aliyun__',
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      used: false,
      attempts: 0,
    });
    await markRecentVerifyCodeSend(target, channel, 60);
  } else {
    // 邮箱验证码 - 本地生成并存储
    const code = generateVerifyCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.verifyCode.create({
      data: { target, code, type, channel, expiresAt },
    });
    await setVerifyCodeRecord({
      target,
      type,
      channel,
      code,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      used: false,
      attempts: 0,
    });
    await markRecentVerifyCodeSend(target, channel, 60);
    console.log(`[Auth] 邮箱验证码: ${code} -> ${target}`);
    const { sendEmail } = await import("./email.js");
    const { getAdminConfig } = await import("./admin.js");
    const siteConfig = await getAdminConfig('site') || {};
    const siteUrl = siteConfig.url || 'https://im.cqcq.chat';
    const logoUrl = `${siteUrl}/imim-email-logo.jpg`;
    const subject = "【imim】验证码";
    const html = `<div style="padding: 20px; background-color: #f5f5f5; font-family: sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1a237e 0%, #283593 100%); padding: 24px; text-align: center;">
          <img src="${logoUrl}" alt="imim" style="width: 64px; height: 64px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.3); object-fit: cover;" />
          <h1 style="color: #ffffff; margin: 12px 0 0; font-size: 20px; font-weight: 600;">imim</h1>
        </div>
        <div style="padding: 30px;">
          <h2 style="color: #333; margin-top: 0; font-size: 18px;">邮箱验证码</h2>
          <p style="color: #666; font-size: 15px; line-height: 1.6;">您好，您正在进行邮箱验证操作，验证码如下：</p>
          <div style="font-size: 36px; font-weight: bold; color: #1a237e; letter-spacing: 6px; margin: 24px 0; text-align: center; background: #f0f2ff; padding: 16px; border-radius: 8px;">${code}</div>
          <p style="color: #999; font-size: 13px; line-height: 1.5;">验证码有效期为 5 分钟，请勿泄露给他人。<br/>如非本人操作，请忽略此邮件。</p>
        </div>
        <div style="background: #f8f9fa; padding: 16px; text-align: center; border-top: 1px solid #eee;">
          <p style="color: #aaa; font-size: 12px; margin: 0;">此邮件由 imim 系统自动发送，请勿直接回复</p>
        </div>
      </div>
    </div>`;
    await sendEmail(target, subject, html);
  }

  res.json({
    success: true,
    message: channel === 'sms' ? '验证码已发送到手机' : '验证码已发送到邮箱',
  });
});

// ============ 验证码校验（内部函数） ============

async function verifyCode(target: string, code: string, type: string, channel: string): Promise<{ valid: boolean; error?: string }> {
  const redisRecord = await getVerifyCodeRecord(target, type, channel);
  if (redisRecord && !redisRecord.used && new Date(redisRecord.expiresAt) >= new Date()) {
    if (channel === 'sms' && redisRecord.code === '__aliyun__') {
      const checkResult = await checkAliyunSmsCode(target, code);
      if (!checkResult.valid) {
        return { valid: false, error: checkResult.error || '验证码错误' };
      }
      await updateVerifyCodeRecord(target, type, channel, (current) => ({ ...current, used: true }));
      await prisma.verifyCode.updateMany({ where: { target, type, channel, used: false }, data: { used: true } }).catch(() => {});
      return { valid: true };
    }

    const updatedRecord = await updateVerifyCodeRecord(target, type, channel, (current) => {
      const nextAttempts = current.attempts + 1;
      return {
        ...current,
        attempts: nextAttempts,
        used: nextAttempts >= 5 ? true : current.used,
      };
    });

    if (!updatedRecord) {
      return { valid: false, error: '验证码不存在或已过期' };
    }

    if (updatedRecord.used && updatedRecord.attempts >= 5 && redisRecord.code !== code) {
      await prisma.verifyCode.updateMany({ where: { target, type, channel, used: false }, data: { used: true } }).catch(() => {});
      return { valid: false, error: '验证码已失效，请重新获取' };
    }

    await prisma.verifyCode.updateMany({ where: { target, type, channel, used: false }, data: { attempts: { increment: 1 } } }).catch(() => {});

    if (redisRecord.code !== code) {
      return { valid: false, error: '验证码错误' };
    }

    await updateVerifyCodeRecord(target, type, channel, (current) => ({ ...current, used: true }));
    await prisma.verifyCode.updateMany({ where: { target, type, channel, used: false }, data: { used: true } }).catch(() => {});
    return { valid: true };
  }

  const record = await prisma.verifyCode.findFirst({
    where: {
      target,
      type,
      channel,
      used: false,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return { valid: false, error: '验证码不存在或已过期' };
  }

  if (channel === 'sms' && record.code === '__aliyun__') {
    const checkResult = await checkAliyunSmsCode(target, code);
    if (!checkResult.valid) {
      return { valid: false, error: checkResult.error || '验证码错误' };
    }
    await prisma.verifyCode.update({ where: { id: record.id }, data: { used: true } });
    return { valid: true };
  }

  await prisma.verifyCode.update({
    where: { id: record.id },
    data: { attempts: { increment: 1 } },
  });

  if (record.attempts >= 5) {
    await prisma.verifyCode.update({
      where: { id: record.id },
      data: { used: true },
    });
    return { valid: false, error: '验证码已失效，请重新获取' };
  }

  if (record.code !== code) {
    return { valid: false, error: '验证码错误' };
  }

  await prisma.verifyCode.update({
    where: { id: record.id },
    data: { used: true },
  });

  return { valid: true };
}

// ============ 注册 ============

/**
 * POST /api/auth/register
 * body: { username, password, phone?, email?, phoneCode?, emailCode?, nickname? }
 */
router.post('/register', async (req: Request, res: Response) => {
  const { username, password, phone, email, phoneCode, emailCode, nickname } = req.body;

  // 基本验证
  if (!username || !password) {
    return res.status(400).json({ error: '请填写用户ID和密码' });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: '用户ID格式不正确（1-20位字母数字下划线）' });
  }
  // ★ 强密码策略检查
  const pwCheck = checkPasswordStrength(password);
  if (!pwCheck.valid) {
    return res.status(400).json({ error: pwCheck.error });
  }

  // ★ 输入安全检查
  if (containsDangerousInput(username) || containsDangerousInput(nickname || '')) {
    return res.status(400).json({ error: '输入包含不允许的字符' });
  }

  // 检查用户名是否已存在
  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser) {
    return res.status(409).json({ error: '该用户ID已被使用' });
  }

  // 手机号验证
  let phoneVerified = false;
  if (phone) {
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }
    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) {
      return res.status(409).json({ error: '该手机号已注册' });
    }
    if (phoneCode) {
      const result = await verifyCode(phone, phoneCode, 'register', 'sms');
      if (!result.valid) return res.status(400).json({ error: result.error });
      phoneVerified = true;
    }
  }

  // 邮箱验证
  let emailVerified = false;
  if (email) {
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return res.status(409).json({ error: '该邮箱已注册' });
    }
    if (emailCode) {
      const result = await verifyCode(email, emailCode, 'register', 'email');
      if (!result.valid) return res.status(400).json({ error: result.error });
      emailVerified = true;
    }
  }

  // 创建用户（生成 TG 风格 Dialog ID）
  const { generateUserDialogId, dialogIdToString } = await import('./utils/peerId.js');
  const userDialogId = generateUserDialogId(false);
  const user = await prisma.user.create({
    data: {
      username,
      password: hashPassword(password),
      phone: phone || null,
      email: email || null,
      nickname: nickname || `用户${username}`,
      phoneVerified,
      emailVerified,
      dialogId: dialogIdToString(userDialogId),
      isBot: false,
    },
  });

  await ensureUserCosFolder(user.id, user.username);

  // 创建会话
  const token = await createSession(user.id, req);

  // 记录登录日志
  await logLogin({
    userId: user.id,
    username: user.username,
    phone: user.phone || undefined,
    email: user.email || undefined,
    ip: getClientIP(req),
    userAgent: req.headers['user-agent'],
    success: true,
  });

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      dialogId: user.dialogId || null,
      username: user.username,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: avatarToProxy(user.avatar),
      isBot: user.isBot || false,
      phoneVerified: user.phoneVerified,
      emailVerified: user.emailVerified,
    },
  });
});

// ============ 登录 ============

/**
 * POST /api/auth/login
 * body: { account, password?, code?, loginType }
 * loginType: password | sms | email
 * account: 用户ID / 手机号 / 邮箱
 */
router.post('/login', loginRateLimit, async (req: Request, res: Response) => {
  const { account, password, code, loginType = 'password' } = req.body;

  if (!account) {
    return res.status(400).json({ error: '请输入账号' });
  }

  const ip = getClientIP(req);
  const ua = req.headers['user-agent'] || '';

  try {
    let user;

    if (loginType === 'sms') {
      // 短信验证码登录
      if (!isValidPhone(account)) {
        return res.status(400).json({ error: '手机号格式不正确' });
      }
      if (!code) {
        return res.status(400).json({ error: '请输入验证码' });
      }

      const verifyResult = await verifyCode(account, code, 'login', 'sms');
      if (!verifyResult.valid) {
        await logLogin({ phone: account, ip, userAgent: ua, success: false, failReason: verifyResult.error });
        return res.status(400).json({ error: verifyResult.error });
      }

      user = await prisma.user.findUnique({ where: { phone: account } });
      if (!user) {
        return res.status(404).json({ error: '该手机号未注册' });
      }

    } else if (loginType === 'email') {
      // 邮箱验证码登录
      if (!isValidEmail(account)) {
        return res.status(400).json({ error: '邮箱格式不正确' });
      }
      if (!code) {
        return res.status(400).json({ error: '请输入验证码' });
      }

      const verifyResult = await verifyCode(account, code, 'login', 'email');
      if (!verifyResult.valid) {
        await logLogin({ email: account, ip, userAgent: ua, success: false, failReason: verifyResult.error });
        return res.status(400).json({ error: verifyResult.error });
      }

      user = await prisma.user.findUnique({ where: { email: account } });
      if (!user) {
        return res.status(404).json({ error: '该邮箱未注册' });
      }

    } else if (loginType === 'phone_auth') {
      // 阿里云号码认证（一键登录）
      const { spToken } = req.body;
      if (!spToken) {
        return res.status(400).json({ error: '缺少认证 token' });
      }

      const authResult = await getPhoneByToken(spToken);
      if (!authResult.success || !authResult.phone) {
        return res.status(400).json({ error: authResult.message || '号码认证失败' });
      }

      user = await prisma.user.findUnique({ where: { phone: authResult.phone } });
      if (!user) {
        // 号码认证自动注册（生成 TG 风格 Dialog ID）
        const { generateUserDialogId: genAutoDialogId, dialogIdToString: autoDialogStr } = await import('./utils/peerId.js');
        const autoDialogId = genAutoDialogId(false);
        const autoUsername = `user_${Date.now().toString(36)}`;
        user = await prisma.user.create({
          data: {
            username: autoUsername,
            password: hashPassword(generateToken(16)),
            phone: authResult.phone,
            nickname: `用户${autoUsername}`,
            phoneVerified: true,
            dialogId: autoDialogStr(autoDialogId),
            isBot: false,
          },
        });
      }

    } else {
      // 密码登录（支持用户ID/手机号/邮箱/系统ID/DialogID）
      if (!password) {
        return res.status(400).json({ error: '请输入密码' });
      }

      // 尝试多种方式查找用户（按优先级：phone > email > username > dialogId > id）
      if (isValidPhone(account)) {
        user = await prisma.user.findUnique({ where: { phone: account } });
      } else if (isValidEmail(account)) {
        user = await prisma.user.findUnique({ where: { email: account } });
      } else {
        // 先按 username 查找
        user = await prisma.user.findUnique({ where: { username: account } });
        // 如果没找到，尝试按 dialogId 查找（TG 风格数字ID）
        if (!user) {
          user = await prisma.user.findUnique({ where: { dialogId: account } });
        }
        // 如果还没找到，尝试按系统 id（cuid）查找
        if (!user) {
          user = await prisma.user.findUnique({ where: { id: account } });
        }
      }

      if (!user) {
        await logLogin({ username: account, ip, userAgent: ua, success: false, failReason: '账号不存在' });
        return res.status(401).json({ error: '账号或密码错误' });
      }

      if (!verifyPassword(password, user.password)) {
        await logLogin({ userId: user.id, username: user.username, ip, userAgent: ua, success: false, failReason: '密码错误' });
        return res.status(401).json({ error: '账号或密码错误' });
      }

      // ★ 密码哈希自动升级：SHA-256 → bcrypt
      if (isLegacyHash(user.password)) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { password: hashPassword(password) },
          });
          console.log(`[Auth] 用户 ${user.username} 密码哈希已升级为 bcrypt`);
        } catch {}
      }
    }

    if (!user) {
      return res.status(401).json({ error: '登录失败' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: '账号已被封禁', reason: user.banReason });
    }

    // ★ 登录成功，重置限流计数
    resetLoginLimits(ip, account);

    // 创建会话
    const token = await createSession(user.id, req);

    // 记录登录日志
    await logLogin({
      userId: user.id,
      username: user.username,
      phone: user.phone || undefined,
      email: user.email || undefined,
      ip,
      userAgent: ua,
      success: true,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        dialogId: user.dialogId || null,
        username: user.username,
        nickname: user.nickname,
        phone: user.phone,
        email: user.email,
        avatar: avatarToProxy(user.avatar),
        bio: user.bio,
        isBot: user.isBot || false,
        phoneVerified: user.phoneVerified,
        emailVerified: user.emailVerified,
      },
    });

  } catch (err: any) {
    console.error('[Auth] 登录错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ============ 获取当前用户信息 ============

router.get('/me', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  res.json({
    user: {
      id: user.id,
      dialogId: user.dialogId || null,
      username: user.username,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: avatarToProxy(user.avatar),
      bio: user.bio,
      gender: user.gender || '',
      region: user.region || '',
      birthday: user.birthday || '',
      isBot: user.isBot || false,
      phoneVerified: user.phoneVerified,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt ? new Date(user.updatedAt).getTime() : undefined,
    },
  });
});

// ============ 退出登录 ============

router.post('/logout', userAuth, async (req: Request, res: Response) => {
  const token = (req as any).sessionToken;
  await prisma.userSession.deleteMany({ where: { token } });
  res.json({ success: true });
});

// ============ 修改密码 ============

router.post('/change-password', userAuth, async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;
  const user = (req as any).user;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '请填写原密码和新密码' });
  }
  // ★ 强密码策略检查
  const pwCheck = checkPasswordStrength(newPassword);
  if (!pwCheck.valid) {
    return res.status(400).json({ error: pwCheck.error });
  }
  if (!verifyPassword(oldPassword, user.password)) {
    return res.status(400).json({ error: '原密码错误' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashPassword(newPassword) },
  });

  // 清除其他会话（可选）
  const currentToken = (req as any).sessionToken;
  await prisma.userSession.deleteMany({
    where: { userId: user.id, token: { not: currentToken } },
  });

  res.json({ success: true, message: '密码修改成功' });
});

// ============ 重置密码 ============

router.post('/reset-password', async (req: Request, res: Response) => {
  const { account, code, newPassword, channel = 'sms' } = req.body;

  if (!account || !code || !newPassword) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  // ★ 强密码策略检查
  const pwCheck = checkPasswordStrength(newPassword);
  if (!pwCheck.valid) {
    return res.status(400).json({ error: pwCheck.error });
  }

  // 验证验证码
  const verifyResult = await verifyCode(account, code, 'reset', channel);
  if (!verifyResult.valid) {
    return res.status(400).json({ error: verifyResult.error });
  }

  // 查找用户
  let user;
  if (channel === 'sms') {
    user = await prisma.user.findUnique({ where: { phone: account } });
  } else {
    user = await prisma.user.findUnique({ where: { email: account } });
  }

  if (!user) {
    return res.status(404).json({ error: '账号不存在' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashPassword(newPassword) },
  });

  // 清除所有会话
  await prisma.userSession.deleteMany({ where: { userId: user.id } });

  res.json({ success: true, message: '密码重置成功，请重新登录' });
});

// ============ 绑定手机号 ============

router.post('/bind-phone', userAuth, async (req: Request, res: Response) => {
  const { phone, code } = req.body;
  const user = (req as any).user;

  if (!phone || !code) {
    return res.status(400).json({ error: '请填写手机号和验证码' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: '手机号格式不正确' });
  }

  // 检查手机号是否已被使用
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing && existing.id !== user.id) {
    return res.status(409).json({ error: '该手机号已被其他账号绑定' });
  }

  // 验证验证码
  const verifyResult = await verifyCode(phone, code, 'bind', 'sms');
  if (!verifyResult.valid) {
    return res.status(400).json({ error: verifyResult.error });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { phone, phoneVerified: true },
  });

  res.json({ success: true, message: '手机号绑定成功' });
});

// ============ 绑定邮箱 ============

router.post('/bind-email', userAuth, async (req: Request, res: Response) => {
  const { email, code } = req.body;
  const user = (req as any).user;

  if (!email || !code) {
    return res.status(400).json({ error: '请填写邮箱和验证码' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== user.id) {
    return res.status(409).json({ error: '该邮箱已被其他账号绑定' });
  }

  const verifyResult = await verifyCode(email, code, 'bind', 'email');
  if (!verifyResult.valid) {
    return res.status(400).json({ error: verifyResult.error });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { email, emailVerified: true },
  });

  res.json({ success: true, message: '邮箱绑定成功' });
});

// ============ 更新个人资料 ============

router.put('/profile', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const token = (req as any).sessionToken;
  const { nickname, avatar, backgroundUrl, bio, username: newUsername, gender, region, birthday } = req.body;

  const data: any = {};
  if (nickname !== undefined) data.nickname = nickname;
  if (avatar !== undefined) data.avatar = avatar;
  if (backgroundUrl !== undefined) data.backgroundUrl = backgroundUrl || null;
  if (bio !== undefined) data.bio = bio;
  if (gender !== undefined) data.gender = gender || null;
  if (region !== undefined) data.region = region || null;
  if (birthday !== undefined) data.birthday = birthday || null;

  // 支持修改 username（账号ID），需校验唯一性
  if (newUsername !== undefined && newUsername !== user.username) {
    if (!/^[a-zA-Z0-9_]{1,20}$/.test(newUsername)) {
      return res.status(400).json({ error: '账号ID只能包含字母、数字和下划线，长度1-20位' });
    }
    const duplicate = await prisma.user.findUnique({ where: { username: newUsername } });
    if (duplicate && duplicate.id !== user.id) {
      return res.status(409).json({ error: '该账号ID已被使用' });
    }
    data.username = newUsername;
  }

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });
  } catch (e: any) {
    const msg = e?.code === 'P2002' ? '该账号ID已被使用' : '资料更新失败';
    return res.status(e?.code === 'P2002' ? 409 : 500).json({ error: msg });
  }

  // 资料更新后清除 session 缓存，确保 /me 等接口返回最新字段
  if (token) {
    invalidateSessionCache(token);
  }

  // ★ 实时同步：使用数据库 updatedAt 作为版本时间戳
  try {
    const { publishUserProfileUpdated } = await import('./user-profile-sync.js');
    await publishUserProfileUpdated(updated);
  } catch (pubErr) {
    console.error('[Auth] 发布用户资料更新事件失败:', pubErr);
    // 不影响主流程
  }

  res.json({
    success: true,
    user: {
      id: updated.id,
      username: updated.username,
      nickname: updated.nickname,
      phone: updated.phone,
      email: updated.email,
      avatar: avatarToProxy(updated.avatar),
      backgroundUrl: updated.backgroundUrl,
      bio: updated.bio,
      gender: updated.gender || '',
      region: updated.region || '',
      birthday: updated.birthday || '',
      phoneVerified: updated.phoneVerified,
      emailVerified: updated.emailVerified,
      updatedAt: updated.updatedAt.getTime(),
    },
    // 兼容 ProfileSettingsPage 的 profile 格式
    profile: {
      id: updated.id,
      username: updated.username,
      wechatId: updated.username,
      name: updated.nickname || updated.username,
      nickname: updated.nickname || updated.username,
      avatar: avatarToProxy(updated.avatar),
      backgroundUrl: updated.backgroundUrl || '',
      bio: updated.bio || '',
      phone: updated.phone || '',
      email: updated.email || '',
      gender: updated.gender || '',
      region: updated.region || '',
      birthday: updated.birthday || '',
      updatedAt: updated.updatedAt.getTime(),
    },
  });
});

// ============ 会话管理 ============

router.get('/sessions', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const currentToken = (req as any).sessionToken;

  const sessions = await prisma.userSession.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, device: true, ip: true, location: true, createdAt: true, token: true },
  });

  res.json({
    sessions: sessions.map(s => ({
      id: s.id,
      device: s.device,
      ip: s.ip,
      location: s.location,
      createdAt: s.createdAt,
      isCurrent: s.token === currentToken,
    })),
  });
});

router.delete('/sessions/:id', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  await prisma.userSession.deleteMany({
    where: { id: req.params.id, userId: user.id },
  });
  res.json({ success: true });
});

// ============ 检查账号是否存在 ============

router.post('/check-account', async (req: Request, res: Response) => {
  const { account, type } = req.body; // type: username | phone | email

  if (!account) return res.status(400).json({ error: '请输入账号' });

  let exists = false;
  if (type === 'phone') {
    exists = !!(await prisma.user.findUnique({ where: { phone: account } }));
  } else if (type === 'email') {
    exists = !!(await prisma.user.findUnique({ where: { email: account } }));
  } else {
    exists = !!(await prisma.user.findUnique({ where: { username: account } }));
  }

  res.json({ exists });
});

export default router;
