/**
 * Browser Web Push registration and encrypted-message wake-up.
 *
 * The server never receives plaintext message content here. Push payloads only
 * carry routing metadata so the client can wake up and fetch ciphertext.
 */
import { Router, type Request, type Response } from 'express';
import webpush from 'web-push';
import prisma from './db.js';
import { userAuth } from './auth.js';

const router = Router();

const vapidPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:security@imim.chat';

const webPushEnabled = Boolean(vapidPublicKey && vapidPrivateKey);
if (webPushEnabled) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

function getSubscription(value: unknown): webpush.PushSubscription | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const endpoint = candidate.endpoint;
  const keys = candidate.keys;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return null;
  if (!keys || typeof keys !== 'object') return null;
  const keyRecord = keys as Record<string, unknown>;
  if (typeof keyRecord.p256dh !== 'string' || typeof keyRecord.auth !== 'string') return null;
  return {
    endpoint,
    expirationTime: typeof candidate.expirationTime === 'number' ? candidate.expirationTime : null,
    keys: { p256dh: keyRecord.p256dh, auth: keyRecord.auth },
  };
}

/** Public because the browser needs this before creating a PushSubscription. */
router.get('/public-key', (_req: Request, res: Response) => {
  if (!webPushEnabled) return res.status(503).json({ enabled: false });
  return res.json({ enabled: true, publicKey: vapidPublicKey });
});

router.use(userAuth);

router.post('/subscription', async (req: Request, res: Response) => {
  if (!webPushEnabled) return res.status(503).json({ error: 'Web Push 未配置' });
  const subscription = getSubscription(req.body?.subscription);
  if (!subscription) return res.status(400).json({ error: '无效的 PushSubscription' });

  try {
    await prisma.user.update({
      where: { id: (req as any).user.id },
      data: { webPushSubscription: JSON.stringify(subscription) },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('[WebPush] 订阅保存失败:', error);
    return res.status(500).json({ error: '订阅保存失败' });
  }
});

router.delete('/subscription', async (req: Request, res: Response) => {
  try {
    await prisma.user.update({
      where: { id: (req as any).user.id },
      data: { webPushSubscription: null },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('[WebPush] 订阅清理失败:', error);
    return res.status(500).json({ error: '订阅清理失败' });
  }
});

export default router;

export interface WebPushMessageParams {
  toUserId: string;
  chatId: string;
  messageId?: string;
  senderId?: string;
}

/**
 * Sends only a generic encrypted-message wake-up. No preview/content is accepted
 * in this API to make accidental plaintext push leakage impossible.
 */
export async function sendWebPush(params: WebPushMessageParams): Promise<boolean> {
  if (!webPushEnabled) return false;

  const user = await prisma.user.findUnique({
    where: { id: params.toUserId },
    select: { webPushSubscription: true },
  });
  if (!user?.webPushSubscription) return false;

  let subscription: webpush.PushSubscription;
  try {
    subscription = JSON.parse(user.webPushSubscription) as webpush.PushSubscription;
  } catch {
    return false;
  }

  const payload = JSON.stringify({
    type: 'encrypted_message',
    chatId: params.chatId,
    messageId: params.messageId || '',
    senderId: params.senderId || '',
    encrypted: true,
  });

  try {
    await webpush.sendNotification(subscription, payload, { TTL: 90, urgency: 'high' });
    return true;
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      await prisma.user.update({
        where: { id: params.toUserId },
        data: { webPushSubscription: null },
      }).catch(() => {});
    } else {
      console.error('[WebPush] 推送失败:', error?.message || error);
    }
    return false;
  }
}
