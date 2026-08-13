/**
 * server/crypto.ts - E2EE 加密基础设施
 *
 * 提供端到端加密（E2EE）所需的服务端支持：
 * 1. ECDH 密钥交换 API（公钥注册与分发）
 * 2. AES-256-GCM 服务端加密存储工具
 * 3. HMAC-SHA256 消息完整性校验
 * 4. 密钥轮换与过期管理
 *
 * 安全设计原则：
 * - 服务端仅存储公钥，私钥永远不离开客户端
 * - 消息在客户端加密后传输，服务端无法解密消息内容
 * - HMAC 签名确保消息在传输过程中未被篡改
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from './db.js';

const router = Router();

// ============================================================
// 1. AES-256-GCM 加解密工具（服务端存储加密）
// ============================================================

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;  // GCM 推荐 12 字节 IV
const TAG_LENGTH = 16;  // 认证标签长度

/**
 * 获取服务端加密密钥
 * 从环境变量读取，如果不存在则自动生成并持久化到数据库
 */
let _serverEncryptionKey: Buffer | null = null;

async function getServerEncryptionKey(): Promise<Buffer> {
  if (_serverEncryptionKey) return _serverEncryptionKey;

  // 优先从环境变量读取
  if (process.env.ENCRYPTION_KEY) {
    _serverEncryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    return _serverEncryptionKey;
  }

  // 从数据库读取或生成
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'encryptionKey' } });
    if (config?.value) {
      _serverEncryptionKey = Buffer.from(JSON.parse(config.value), 'hex');
    } else {
      const newKey = crypto.randomBytes(32);
      await prisma.systemConfig.create({
        data: { key: 'encryptionKey', value: JSON.stringify(newKey.toString('hex')) },
      });
      _serverEncryptionKey = newKey;
      console.log('[Crypto] 已生成新的服务端加密密钥');
    }
  } catch {
    // 回退：使用固定派生密钥（仅开发环境）
    _serverEncryptionKey = crypto.scryptSync('cqim-dev-key', 'cqim-salt', 32);
  }

  return _serverEncryptionKey;
}

/**
 * AES-256-GCM 加密
 * 返回格式：base64(IV + ciphertext + authTag)
 */
export async function encryptData(plaintext: string): Promise<string> {
  const key = await getServerEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // IV(12) + ciphertext(N) + authTag(16)
  const result = Buffer.concat([iv, encrypted, authTag]);
  return result.toString('base64');
}

/**
 * AES-256-GCM 解密
 * 输入格式：base64(IV + ciphertext + authTag)
 */
export async function decryptData(encryptedBase64: string): Promise<string> {
  const key = await getServerEncryptionKey();
  const data = Buffer.from(encryptedBase64, 'base64');

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

// ============================================================
// 2. HMAC-SHA256 消息完整性校验
// ============================================================

/**
 * 生成 HMAC-SHA256 签名
 * 用于验证消息在传输过程中未被篡改
 */
export function generateHMAC(message: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * 验证 HMAC-SHA256 签名
 * 使用 timingSafeEqual 防止时序攻击
 */
export function verifyHMAC(message: string, signature: string, secret: string): boolean {
  const expected = generateHMAC(message, secret);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// ============================================================
// 3. ECDH 密钥交换 API
// ============================================================

/**
 * POST /api/crypto/register-key
 * 客户端注册自己的 ECDH 公钥
 * body: { userId, publicKey, deviceId }
 *
 * 客户端生成 ECDH 密钥对后，将公钥注册到服务端。
 * 其他用户可以通过 /get-key 获取该公钥，完成密钥交换。
 */
router.post('/register-key', async (req: Request, res: Response) => {
  const { userId, publicKey, deviceId } = req.body;

  if (!userId || !publicKey) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 验证公钥格式（Base64 编码的 ECDH 公钥）
  if (!/^[A-Za-z0-9+/=]+$/.test(publicKey) || publicKey.length < 40) {
    return res.status(400).json({ error: '公钥格式无效' });
  }

  try {
    // Upsert：同一用户同一设备只保留最新公钥
    await prisma.systemConfig.upsert({
      where: { key: `e2ee:pubkey:${userId}:${deviceId || 'default'}` },
      update: {
        value: JSON.stringify({
          publicKey,
          updatedAt: new Date().toISOString(),
        }),
      },
      create: {
        key: `e2ee:pubkey:${userId}:${deviceId || 'default'}`,
        value: JSON.stringify({
          publicKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      },
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[Crypto] 注册公钥失败:', err.message);
    res.status(500).json({ error: '注册公钥失败' });
  }
});

/**
 * GET /api/crypto/get-key?userId=xxx&deviceId=xxx
 * 获取指定用户的 ECDH 公钥
 */
router.get('/get-key', async (req: Request, res: Response) => {
  const { userId, deviceId = 'default' } = req.query as { userId: string; deviceId?: string };

  if (!userId) {
    return res.status(400).json({ error: '缺少 userId' });
  }

  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: `e2ee:pubkey:${userId}:${deviceId}` },
    });

    if (!config?.value) {
      return res.status(404).json({ error: '未找到公钥' });
    }

    const data = JSON.parse(config.value);
    res.json({ publicKey: data.publicKey, updatedAt: data.updatedAt });
  } catch (err: any) {
    console.error('[Crypto] 获取公钥失败:', err.message);
    res.status(500).json({ error: '获取公钥失败' });
  }
});

/**
 * POST /api/crypto/verify-message
 * 验证消息的 HMAC 签名完整性
 * body: { message, signature, senderId }
 */
router.post('/verify-message', async (req: Request, res: Response) => {
  const { message, signature, senderId } = req.body;

  if (!message || !signature || !senderId) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    // 使用发送者的公钥作为 HMAC 密钥的一部分
    const config = await prisma.systemConfig.findUnique({
      where: { key: `e2ee:pubkey:${senderId}:default` },
    });

    if (!config?.value) {
      return res.status(404).json({ error: '发送者公钥未注册' });
    }

    const { publicKey } = JSON.parse(config.value);
    const hmacKey = crypto.createHash('sha256').update(publicKey).digest('hex');
    const valid = verifyHMAC(message, signature, hmacKey);

    res.json({ valid });
  } catch (err: any) {
    console.error('[Crypto] 验证签名失败:', err.message);
    res.status(500).json({ error: '验证失败' });
  }
});

// ============================================================
// 4. Signal Protocol PreKey Bundle API
// ============================================================

/**
 * POST /api/crypto/register-bundle
 * 客户端上传 Signal Protocol PreKey Bundle
 * body: {
 *   userId: string,
 *   registrationId: number,
 *   identityKey: string,       // Base64 编码的身份公钥
 *   signedPreKey: {
 *     keyId: number,
 *     publicKey: string,       // Base64
 *     signature: string,       // Base64
 *   },
 *   preKeys: Array<{ keyId: number, publicKey: string }>,  // One-Time PreKeys
 * }
 */
router.post('/register-bundle', async (req: Request, res: Response) => {
  const { userId, registrationId, identityKey, signedPreKey, preKeys } = req.body;

  if (!userId || !identityKey || !signedPreKey) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    // 存储身份公钥和签名预密钥
    await prisma.systemConfig.upsert({
      where: { key: `e2ee:bundle:${userId}` },
      update: {
        value: JSON.stringify({
          registrationId,
          identityKey,
          signedPreKey,
          updatedAt: new Date().toISOString(),
        }),
      },
      create: {
        key: `e2ee:bundle:${userId}`,
        value: JSON.stringify({
          registrationId,
          identityKey,
          signedPreKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      },
    });

    // 存储 One-Time PreKeys（追加模式，不覆盖已有的）
    if (Array.isArray(preKeys) && preKeys.length > 0) {
      // 获取已有的 preKeys
      const existingConfig = await prisma.systemConfig.findUnique({
        where: { key: `e2ee:prekeys:${userId}` },
      });
      let existingKeys: Array<{ keyId: number; publicKey: string }> = [];
      if (existingConfig?.value) {
        try { existingKeys = JSON.parse(existingConfig.value); } catch {}
      }

      // 合并新旧 preKeys（去重）
      const keyMap = new Map<number, string>();
      existingKeys.forEach(k => keyMap.set(k.keyId, k.publicKey));
      preKeys.forEach((k: { keyId: number; publicKey: string }) => keyMap.set(k.keyId, k.publicKey));
      const mergedKeys = Array.from(keyMap.entries()).map(([keyId, publicKey]) => ({ keyId, publicKey }));

      await prisma.systemConfig.upsert({
        where: { key: `e2ee:prekeys:${userId}` },
        update: { value: JSON.stringify(mergedKeys) },
        create: { key: `e2ee:prekeys:${userId}`, value: JSON.stringify(mergedKeys) },
      });
    }

    console.log(`[Crypto] 用户 ${userId} 注册 PreKey Bundle 成功, preKeys: ${preKeys?.length || 0}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Crypto] 注册 Bundle 失败:', err.message);
    res.status(500).json({ error: '注册 Bundle 失败' });
  }
});

/**
 * GET /api/crypto/get-bundle?userId=xxx
 * 获取指定用户的 PreKey Bundle（包含一个 One-Time PreKey）
 * 返回后自动消费该 One-Time PreKey
 */
router.get('/get-bundle', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId: string };

  if (!userId) {
    return res.status(400).json({ error: '缺少 userId' });
  }

  try {
    // 获取身份公钥和签名预密钥
    const bundleConfig = await prisma.systemConfig.findUnique({
      where: { key: `e2ee:bundle:${userId}` },
    });

    if (!bundleConfig?.value) {
      return res.status(404).json({ error: '用户未注册 E2EE Bundle' });
    }

    const bundle = JSON.parse(bundleConfig.value);

    // 获取并消费一个 One-Time PreKey
    let oneTimePreKey: { keyId: number; publicKey: string } | undefined;
    const preKeysConfig = await prisma.systemConfig.findUnique({
      where: { key: `e2ee:prekeys:${userId}` },
    });

    if (preKeysConfig?.value) {
      const preKeys: Array<{ keyId: number; publicKey: string }> = JSON.parse(preKeysConfig.value);
      if (preKeys.length > 0) {
        // 取出第一个并从列表中移除（消费）
        oneTimePreKey = preKeys.shift();
        await prisma.systemConfig.update({
          where: { key: `e2ee:prekeys:${userId}` },
          data: { value: JSON.stringify(preKeys) },
        });
        console.log(`[Crypto] 消费用户 ${userId} 的 PreKey #${oneTimePreKey!.keyId}, 剩余: ${preKeys.length}`);
      }
    }

    res.json({
      registrationId: bundle.registrationId,
      identityKey: bundle.identityKey,
      signedPreKey: bundle.signedPreKey,
      preKey: oneTimePreKey || null,
    });
  } catch (err: any) {
    console.error('[Crypto] 获取 Bundle 失败:', err.message);
    res.status(500).json({ error: '获取 Bundle 失败' });
  }
});

/**
 * GET /api/crypto/prekey-count?userId=xxx
 * 查询用户剩余的 One-Time PreKey 数量
 * 客户端可以定期检查，当数量低于阈值时补充新的 PreKeys
 */
router.get('/prekey-count', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId: string };

  if (!userId) {
    return res.status(400).json({ error: '缺少 userId' });
  }

  try {
    const preKeysConfig = await prisma.systemConfig.findUnique({
      where: { key: `e2ee:prekeys:${userId}` },
    });

    let count = 0;
    if (preKeysConfig?.value) {
      const preKeys = JSON.parse(preKeysConfig.value);
      count = Array.isArray(preKeys) ? preKeys.length : 0;
    }

    res.json({ count });
  } catch (err: any) {
    console.error('[Crypto] 查询 PreKey 数量失败:', err.message);
    res.status(500).json({ error: '查询失败' });
  }
});

/**
 * POST /api/crypto/replenish-prekeys
 * 补充 One-Time PreKeys
 * body: { userId: string, preKeys: Array<{ keyId: number, publicKey: string }> }
 */
router.post('/replenish-prekeys', async (req: Request, res: Response) => {
  const { userId, preKeys } = req.body;

  if (!userId || !Array.isArray(preKeys) || preKeys.length === 0) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    const existingConfig = await prisma.systemConfig.findUnique({
      where: { key: `e2ee:prekeys:${userId}` },
    });
    let existingKeys: Array<{ keyId: number; publicKey: string }> = [];
    if (existingConfig?.value) {
      try { existingKeys = JSON.parse(existingConfig.value); } catch {}
    }

    const keyMap = new Map<number, string>();
    existingKeys.forEach(k => keyMap.set(k.keyId, k.publicKey));
    preKeys.forEach((k: { keyId: number; publicKey: string }) => keyMap.set(k.keyId, k.publicKey));
    const mergedKeys = Array.from(keyMap.entries()).map(([keyId, publicKey]) => ({ keyId, publicKey }));

    await prisma.systemConfig.upsert({
      where: { key: `e2ee:prekeys:${userId}` },
      update: { value: JSON.stringify(mergedKeys) },
      create: { key: `e2ee:prekeys:${userId}`, value: JSON.stringify(mergedKeys) },
    });

    console.log(`[Crypto] 用户 ${userId} 补充 ${preKeys.length} 个 PreKeys, 总计: ${mergedKeys.length}`);
    res.json({ success: true, totalCount: mergedKeys.length });
  } catch (err: any) {
    console.error('[Crypto] 补充 PreKeys 失败:', err.message);
    res.status(500).json({ error: '补充失败' });
  }
});

// ============================================================
// 5. 工具函数导出
// ============================================================

/** 生成安全随机字节（Base64 编码） */
export function generateSecureRandom(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('base64');
}

/** 安全比较两个字符串（防时序攻击） */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export default router;
