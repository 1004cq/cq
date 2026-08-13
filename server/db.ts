/**
 * server/db.ts
 * 统一数据库访问层 - Prisma Client 单例 + 数据库初始化
 * 兼容 SQLite / MongoDB 双 provider
 */
import { PrismaClient } from '@prisma/client';
import { execFile } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { promisify } from 'util';
import bcrypt from 'bcryptjs';

const execFileAsync = promisify(execFile);

/** 检测当前 DATABASE_URL 使用的 provider 类型 */
function detectProvider(): 'sqlite' | 'mongodb' | 'mysql' | 'postgresql' {
  const url = process.env.DATABASE_URL || '';
  if (url.startsWith('file:') || url.endsWith('.db')) return 'sqlite';
  if (url.startsWith('mongodb')) return 'mongodb';
  if (url.startsWith('mysql')) return 'mysql';
  if (url.startsWith('postgresql') || url.startsWith('postgres')) return 'postgresql';
  return 'sqlite'; // 默认 fallback
}

async function ensureDatabaseSchema() {
  try {
    await execFileAsync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: process.cwd(),
      env: process.env,
    });
  } catch (err) {
    console.warn('[DB] prisma db push 失败，尝试继续启动:', (err as Error).message);
  }
}

// 全局单例，避免热重载时重复创建连接
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * 数据库健康检查 - 自动适配 SQLite / MongoDB / 关系型数据库
 */
export async function checkDatabaseHealth() {
  await prisma.$connect();
  const provider = detectProvider();

  if (provider === 'mongodb' && typeof (prisma as any).$runCommandRaw === 'function') {
    // MongoDB: 使用原生 ping 命令
    await (prisma as any).$runCommandRaw({ ping: 1 });
    return;
  }

  // SQLite / MySQL / PostgreSQL: 执行一次轻量查询验证连接
  try {
    await prisma.user.count();
  } catch {
    // 表可能还不存在（首次启动），尝试 $queryRawUnsafe
    try {
      await (prisma as any).$queryRawUnsafe('SELECT 1');
    } catch {
      // 连接本身可能有问题，抛出让上层处理
      throw new Error(`[DB] 健康检查失败 (provider=${provider})`);
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 密码哈希：使用 bcrypt（cost=12）
 * bcrypt 内置随机盐，抗彩虹表和暴力破解，是 OWASP 推荐的密码存储方案。
 */
const BCRYPT_ROUNDS = 12;

/** 旧版 SHA-256 哈希（仅用于向后兼容验证） */
function legacyHashPassword(password: string): string {
  return createHash('sha256').update(password + 'cqim_salt_2024').digest('hex');
}

/** 生成 bcrypt 密码哈希 */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/**
 * 验证密码：同时兼容 bcrypt 和旧版 SHA-256 哈希。
 * 如果检测到旧版哈希格式（64 位十六进制），先用旧方式验证，
 * 验证成功后返回 true，调用方应随后将密码升级为 bcrypt。
 */
export function verifyPassword(password: string, hash: string): boolean {
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
    return bcrypt.compareSync(password, hash);
  }
  if (/^[a-f0-9]{64}$/.test(hash)) {
    return legacyHashPassword(password) === hash;
  }
  return false;
}

/** 检查哈希是否为旧版格式，需要升级 */
export function isLegacyHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

/** 生成随机 token */
export function generateToken(length = 32): string {
  let token = '';
  while (token.length < length) {
    token += randomBytes(Math.ceil(length * 0.75)).toString('base64url');
  }
  return token.slice(0, length);
}

/** 初始化数据库默认数据 */
export async function initDatabase() {
  try {
    await ensureDatabaseSchema();
    await checkDatabaseHealth();

    const adminCount = await prisma.adminAccount.count();
    if (adminCount === 0) {
      await prisma.adminAccount.create({
        data: {
          username: 'admin',
          password: hashPassword('admin123'),
          role: 'superadmin',
        },
      });
      console.log('[DB] 已创建默认管理员账号: admin / admin123');
    }

    const configKeys = [
      { key: 'smtp', value: JSON.stringify({ host: '', port: 465, secure: true, user: '', pass: '', fromName: 'CQIM', fromEmail: '', enabled: false }) },
      { key: 'cos', value: JSON.stringify({ secretId: '', secretKey: '', bucket: '', region: 'ap-guangzhou', domain: '', pathPrefix: 'imimchat', enabled: false }) },
      { key: 'site', value: JSON.stringify({ name: 'CQIM', description: '即时通讯系统', url: '', logo: '', icp: '', policeIcp: '', copyright: '', allowRegister: true, requireApproval: false, autoPlayVideo: false }) },
      { key: 'onebot', value: JSON.stringify({ botId: 'imim_bot', botName: 'imim AI', accessToken: '', heartbeatInterval: 30, wsEnabled: true, httpEnabled: true, logEnabled: false }) },
      { key: 'ai', value: JSON.stringify({ model: 'gpt-4o-mini', triggerPrefix: '@AI', temperature: 0.7, maxTokens: 1000, systemPrompt: '你是一个友好的AI助手。', enabled: false }) },
      { key: 'aliyun', value: JSON.stringify({
        accessKeyId: '', accessKeySecret: '',
        smsSignName: '',
        smsSignNames: [
          { name: '云渚科技验证平台', status: 'approved' },
          { name: '云渚科技验证服务', status: 'approved' },
          { name: '速通互联验证码', status: 'approved' },
          { name: '速通互联验证平台', status: 'approved' },
          { name: '速通互联验证服务', status: 'pending' },
        ],
        smsTemplates: {
          login: { name: '登录/注册模板', code: '100001', content: '您的验证码为${code}。尊敬的客户，以上验证码${min}分钟内有效，请注意保密，切勿告知他人。' },
          changePhone: { name: '修改绑定手机号模板', code: '100002', content: '尊敬的客户，您正在进行修改手机号操作，您的验证码为${code}。以上验证码${min}分钟内有效，请注意保密，切勿告知他人。' },
          reset: { name: '重置密码模板', code: '100003', content: '尊敬的客户，您正在进行重置密码操作，您的验证码为${code}。以上验证码${min}分钟内有效，请注意保密，切勿告知他人。' },
          bind: { name: '绑定新手机号模板', code: '100004', content: '尊敬的客户，您正在进行绑定手机号操作，您的验证码为${code}。以上验证码${min}分钟内有效，请注意保密，切勿告知他人。' },
          verifyPhone: { name: '验证绑定手机号模板', code: '100005', content: '尊敬的客户，您正在验证绑定手机号操作，您的验证码为${code}。以上验证码${min}分钟内有效，请注意保密，切勿告知他人。' },
        },
        smsEnabled: false, phoneAuthEnabled: false,
      }) },
      { key: 'emailTemplates', value: JSON.stringify({
        verifyCode: { subject: '【CQIM】您的验证码', body: '<p>您的验证码是：<strong>{{code}}</strong>，{{expire}}分钟内有效。</p>', expireMinutes: 5 },
        welcome: { subject: '欢迎加入 CQIM', body: '<p>您好 {{username}}，欢迎注册 CQIM！</p>', enabled: true },
        resetPassword: { subject: '【CQIM】重置密码', body: '<p>点击以下链接重置密码：<a href="{{link}}">重置密码</a>，链接{{expire}}分钟内有效。</p>', expireMinutes: 30 },
        loginAlert: { subject: '【CQIM】异地登录通知', body: '<p>检测到您的账号在新设备登录，请确认是否为本人操作。</p>', enabled: true },
      }) },
    ];

    for (const cfg of configKeys) {
      await prisma.systemConfig.upsert({
        where: { key: cfg.key },
        update: {},
        create: { key: cfg.key, value: cfg.value },
      });
    }

    const announcementCount = await prisma.announcement.count();
    if (announcementCount === 0) {
      await prisma.announcement.createMany({
        data: [
          { title: 'CQIM v2.0 正式发布', content: '全新版本已上线，整合朋友圈外链功能，欢迎体验！', type: 'update', isActive: true, createdBy: 'admin' },
          { title: '系统维护通知', content: '系统将于本周日凌晨2点进行例行维护，预计持续30分钟。', type: 'maintenance', isActive: true, createdBy: 'admin' },
        ],
      });
    }

    const wordCount = await prisma.sensitiveWord.count();
    if (wordCount === 0) {
      await prisma.sensitiveWord.createMany({
        data: [
          { word: '违禁词1', category: '政治', isActive: true },
          { word: '违禁词2', category: '色情', isActive: true },
          { word: '违禁词3', category: '广告', isActive: false },
        ],
      });
    }

    const provider = detectProvider();
    console.log(`[DB] 数据库初始化完成 (provider=${provider})`);
  } catch (err) {
    console.error('[DB] 初始化失败:', err);
  }
}

export default prisma;
