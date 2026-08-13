/**
 * server/fcm.ts - Firebase Cloud Messaging 推送服务
 *
 * 提供：
 * 1. POST /api/fcm/token  - 注册/更新用户的 FCM Token
 * 2. sendFCMPush()        - 向离线用户发送 FCM 推送（供其他模块调用）
 *
 * 参考: https://github.com/firebase/quickstart-android/tree/master/messaging
 */

import { Router, Request, Response } from 'express';
import prisma from './db.js';
import { userAuth } from './auth.js';

const router = Router();

// ============ Firebase Admin SDK 初始化 ============

let firebaseAdmin: any = null;
let messagingInstance: any = null;

async function getFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  try {
    const admin = await import('firebase-admin');
    // 使用环境变量中的 Service Account 或 Application Default Credentials
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      if (!admin.default.apps.length) {
        admin.default.initializeApp({
          credential: admin.default.credential.cert(serviceAccount),
        });
      }
    } else {
      // 尝试使用 Application Default Credentials（GCP 环境）
      if (!admin.default.apps.length) {
        admin.default.initializeApp();
      }
    }
    firebaseAdmin = admin.default;
    messagingInstance = admin.default.messaging();
    console.log('[FCM] Firebase Admin SDK 初始化成功');
    return firebaseAdmin;
  } catch (err) {
    console.error('[FCM] Firebase Admin SDK 初始化失败:', err);
    return null;
  }
}

// 启动时预初始化
getFirebaseAdmin().catch(() => {});

// ============ API 路由 ============

router.use(userAuth);

/**
 * POST /api/fcm/token
 * 注册或更新用户的 FCM Token
 * Body: { fcmToken: string, platform: 'android' | 'ios' }
 */
router.post('/token', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { fcmToken, platform } = req.body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      return res.status(400).json({ error: '缺少 fcmToken' });
    }

    // 检查用户当前是否已有个推 CID（避免 FCM Token 覆盖个推 CID）
    const existingUser = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { fcmToken: true },
    });
    if (existingUser?.fcmToken?.startsWith('getui-')) {
      console.log(`[FCM] 用户 ${currentUser.id} 已有个推 CID，跳过 FCM Token 注册`);
      return res.json({ success: true, skipped: true, reason: 'getui_cid_exists' });
    }

    // 更新用户的 FCM Token
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { fcmToken },
    });

    console.log(`[FCM] 用户 ${currentUser.id} 注册 FCM Token (${platform || 'unknown'})`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[FCM] Token 注册失败:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * DELETE /api/fcm/token
 * 用户登出时清除 FCM Token
 */
router.delete('/token', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { fcmToken: null },
    });
    console.log(`[FCM] 用户 ${currentUser.id} 清除 FCM Token`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[FCM] Token 清除失败:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * POST /api/voip/token (挂载在 fcm router 下，实际路径为 /api/fcm/voip-token)
 * 注册或更新用户的 iOS VoIP Push Token
 * Body: { voipToken: string }
 */
router.post('/voip-token', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { voipToken } = req.body;

    if (!voipToken || typeof voipToken !== 'string') {
      return res.status(400).json({ error: '缺少 voipToken' });
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: { voipToken },
    });

    console.log(`[VoIP] 用户 ${currentUser.id} 注册 VoIP Token`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[VoIP] Token 注册失败:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;

// ============ 推送发送工具函数 ============

export interface FCMPushPayload {
  /** 接收方用户 ID */
  toUserId: string;
  /** 通知标题 */
  title: string;
  /** 通知内容 */
  body: string;
  /** 附加数据（可选） */
  data?: Record<string, string>;
}

/**
 * 向指定用户发送 FCM 推送通知
 * 如果用户没有注册 FCM Token，则静默跳过
 * 支持 iOS mutable-content 以触发 Notification Service Extension 显示发送者头像
 */
export async function sendFCMPush(payload: FCMPushPayload): Promise<boolean> {
  try {
    // 查询用户的 FCM Token
    const user = await prisma.user.findUnique({
      where: { id: payload.toUserId },
      select: { fcmToken: true },
    });

    if (!user?.fcmToken) {
      // 用户没有注册 FCM Token（可能是 Web 用户或未授权通知）
      return false;
    }

    const admin = await getFirebaseAdmin();
    if (!admin || !messagingInstance) {
      console.warn('[FCM] Firebase Admin 未初始化，跳过推送');
      return false;
    }

    // 将 data 字段全部转为字符串（FCM 要求）
    const stringData: Record<string, string> = {};
    if (payload.data) {
      for (const [key, value] of Object.entries(payload.data)) {
        stringData[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }
    stringData.click_action = 'FLUTTER_NOTIFICATION_CLICK';

    // 判断是否为来电推送
    const isCallInvite = stringData.type === 'call_invite';

    const message: any = {
      token: user.fcmToken,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: stringData,
      android: {
        priority: 'high' as const,
        notification: {
          channelId: isCallInvite ? 'cqim_calls' : 'cqim_messages',
          priority: 'high' as const,
          defaultSound: !isCallInvite,
          defaultVibrateTimings: true,
          ...(isCallInvite ? {
            sound: 'ringtone',
            vibrateTimingsMillis: [0, 500, 200, 500, 200, 500, 200, 500],
          } : {}),
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          ...(isCallInvite ? { 'apns-push-type': 'alert' } : {}),
        },
        payload: {
          aps: {
            'mutable-content': 1,  // 触发 Notification Service Extension
            'sound': isCallInvite ? { critical: 1, name: 'default', volume: 1.0 } : 'default',
            'badge': 1,
            ...(isCallInvite ? { 'interruption-level': 'time-sensitive' } : {}),
          },
        },
      },
    };

    const response = await messagingInstance.send(message);
    console.log(`[FCM] 推送成功: userId=${payload.toUserId} messageId=${response}`);
    return true;
  } catch (err: any) {
    // Token 失效时清除
    if (err?.code === 'messaging/registration-token-not-registered' ||
        err?.code === 'messaging/invalid-registration-token') {
      console.warn(`[FCM] Token 失效，清除用户 ${payload.toUserId} 的 FCM Token`);
      await prisma.user.update({
        where: { id: payload.toUserId },
        data: { fcmToken: null },
      }).catch(() => {});
    } else {
      console.error('[FCM] 推送失败:', err?.message || err);
    }
    return false;
  }
}
