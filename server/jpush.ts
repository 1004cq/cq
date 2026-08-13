/**
 * server/jpush.ts - 极光推送（JPush）注册与下发
 *
 * registrationId 存入 User.fcmToken，格式：
 *   jpush-ios:{registrationId}
 *   jpush-android:{registrationId}
 */
import { Router, Request, Response } from 'express';
import prisma from './db.js';
import { userAuth } from './auth.js';

const router = Router();

const JPUSH_APP_KEY = process.env.JPUSH_APP_KEY || '2f496988f16573ad08321835';
const JPUSH_MASTER_SECRET = process.env.JPUSH_MASTER_SECRET || '';
const JPUSH_API_BASE = process.env.JPUSH_API_BASE || 'https://api.jpush.cn';

export function parseJPushToken(
  fcmToken: string | null | undefined,
): { registrationId: string; platform: 'ios' | 'android' } | null {
  if (!fcmToken) return null;
  if (fcmToken.startsWith('jpush-ios:')) {
    return { registrationId: fcmToken.slice('jpush-ios:'.length), platform: 'ios' };
  }
  if (fcmToken.startsWith('jpush-android:')) {
    return { registrationId: fcmToken.slice('jpush-android:'.length), platform: 'android' };
  }
  if (fcmToken.startsWith('jpush:')) {
    return { registrationId: fcmToken.slice('jpush:'.length), platform: 'android' };
  }
  return null;
}

function buildAuthHeader(): string | null {
  if (!JPUSH_APP_KEY || !JPUSH_MASTER_SECRET) return null;
  return `Basic ${Buffer.from(`${JPUSH_APP_KEY}:${JPUSH_MASTER_SECRET}`).toString('base64')}`;
}

router.use(userAuth);

/**
 * POST /api/jpush/registration
 * Body: { registrationId: string, platform?: 'ios' | 'android' }
 */
router.post('/registration', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { registrationId, platform = 'ios' } = req.body || {};

    if (!registrationId || typeof registrationId !== 'string') {
      return res.status(400).json({ error: '缺少 registrationId' });
    }

    const prefix = platform === 'ios' ? 'jpush-ios' : 'jpush-android';
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { fcmToken: `${prefix}:${registrationId}` },
    });

    console.log(`[JPush] 用户 ${currentUser.id} 注册 ${platform} registrationId=${registrationId.slice(0, 12)}...`);
    res.json({ success: true });
  } catch (e: any) {
    console.error('[JPush] registration 失败:', e);
    res.status(500).json({ error: '注册失败' });
  }
});

/**
 * DELETE /api/jpush/registration
 */
router.delete('/registration', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { fcmToken: true },
    });
    if (parseJPushToken(user?.fcmToken)) {
      await prisma.user.update({
        where: { id: currentUser.id },
        data: { fcmToken: null },
      });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: '清除失败' });
  }
});

export interface JPushSendParams {
  toUserId: string;
  title: string;
  body: string;
  extras?: Record<string, string>;
}

/** 通过极光 REST API 向指定用户推送 */
export async function sendJPushPush(params: JPushSendParams): Promise<{ success: boolean; reason?: string }> {
  const auth = buildAuthHeader();
  if (!auth) {
    return { success: false, reason: 'jpush_not_configured' };
  }

  const user = await prisma.user.findUnique({
    where: { id: params.toUserId },
    select: { fcmToken: true },
  });
  const jpush = parseJPushToken(user?.fcmToken);
  if (!jpush?.registrationId) {
    return { success: false, reason: 'no_registration_id' };
  }

  const payload = {
    platform: jpush.platform,
    audience: { registration_id: [jpush.registrationId] },
    notification: {
      alert: params.body,
      android: {
        alert: params.body,
        title: params.title,
        extras: params.extras || {},
      },
      ios: {
        alert: {
          title: params.title,
          body: params.body,
        },
        sound: 'default',
        badge: '+1',
        extras: params.extras || {},
      },
    },
    options: {
      apns_production: process.env.NODE_ENV === 'production',
    },
  };

  try {
    const res = await fetch(`${JPUSH_API_BASE}/v3/push`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[JPush] 推送失败:', data);
      return { success: false, reason: data?.error?.message || `http_${res.status}` };
    }
    return { success: true };
  } catch (e: any) {
    console.error('[JPush] 推送异常:', e);
    return { success: false, reason: e?.message || 'network_error' };
  }
}

export default router;
