/**
 * server/getui.ts - 个推服务端推送服务
 *
 * 提供：
 * 1. POST /api/getui/cid  - 注册/更新用户的个推 CID（区分 iOS/Android）
 * 2. sendGetuiPush()      - 向离线用户发送个推推送（供其他模块调用）
 *
 * CID 存储格式（复用 fcmToken 字段）：
 * - Android: "getui-android:CID值"
 * - iOS:    "getui-ios:CID值"
 * - 旧格式:  "getui:CID值"（兼容，视为 Android）
 *
 * 参考: https://docs.getui.com/getui/server/rest_v2/push/
 * 配置环境变量: GETUI_APP_ID, GETUI_APP_KEY, GETUI_MASTER_SECRET
 */
import { Router, Request, Response } from 'express';
import prisma from './db.js';
import { userAuth } from './auth.js';
import crypto from 'crypto';

const router = Router();

// 个推 REST API V2 配置（必须通过环境变量配置）
const GETUI_APP_ID = process.env.GETUI_APP_ID || '';
const GETUI_APP_KEY = process.env.GETUI_APP_KEY || '';
const GETUI_MASTER_SECRET = process.env.GETUI_MASTER_SECRET || '';
const isGetuiConfigured = !!(GETUI_APP_ID && GETUI_APP_KEY && GETUI_MASTER_SECRET);
const GETUI_BASE_URL = isGetuiConfigured ? `https://restapi.getui.com/v2/${GETUI_APP_ID}` : '';

// Token 缓存（个推 Token 有效期 1 天）
let getuiToken: string | null = null;
let getuiTokenExpiry: number = 0;

/**
 * 解析 fcmToken 字段中的个推 CID 和平台信息
 * 返回 { cid, platform } 或 null
 */
export function parseGetuiToken(fcmToken: string | null | undefined): { cid: string; platform: 'ios' | 'android' } | null {
  if (!fcmToken) return null;
  if (fcmToken.startsWith('getui-ios:')) {
    return { cid: fcmToken.replace('getui-ios:', ''), platform: 'ios' };
  }
  if (fcmToken.startsWith('getui-android:')) {
    return { cid: fcmToken.replace('getui-android:', ''), platform: 'android' };
  }
  // 兼容旧格式
  if (fcmToken.startsWith('getui:')) {
    return { cid: fcmToken.replace('getui:', ''), platform: 'android' };
  }
  return null;
}

/**
 * 获取个推鉴权 Token（有缓存，自动刷新）
 */
async function getGetuiToken(): Promise<string | null> {
  // 如果 Token 还有效（提前 5 分钟刷新）
  if (getuiToken && Date.now() < getuiTokenExpiry - 5 * 60 * 1000) {
    return getuiToken;
  }

  try {
    const timestamp = Date.now().toString();
    // 签名: SHA256(AppKey + timestamp + MasterSecret)
    const sign = crypto
      .createHash('sha256')
      .update(GETUI_APP_KEY + timestamp + GETUI_MASTER_SECRET)
      .digest('hex');

    const response = await fetch(`${GETUI_BASE_URL}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sign,
        timestamp,
        appkey: GETUI_APP_KEY,
      }),
    });

    const result = await response.json() as any;
    if (result.code === 0 && result.data?.token) {
      getuiToken = result.data.token;
      // expire_time 是毫秒时间戳
      getuiTokenExpiry = result.data.expire_time || (Date.now() + 24 * 60 * 60 * 1000);
      console.log('[个推] 鉴权成功，Token 已更新');
      return getuiToken;
    } else {
      console.error('[个推] 鉴权失败:', result);
      return null;
    }
  } catch (err) {
    console.error('[个推] 鉴权请求失败:', err);
    return null;
  }
}

// ============ API 路由 ============
router.use(userAuth);

/**
 * POST /api/getui/cid
 * 注册或更新用户的个推 CID
 * Body: { cid: string, platform?: 'ios' | 'android' }
 */
router.post('/cid', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { cid, platform } = req.body;

    if (!cid || typeof cid !== 'string') {
      return res.status(400).json({ error: '缺少 cid' });
    }

    // 根据 platform 区分存储前缀
    const prefix = platform === 'ios' ? 'getui-ios' : 'getui-android';

    // 将 CID 存入 fcmToken 字段（复用，避免新增字段）
    // 格式: "getui-ios:CID值" 或 "getui-android:CID值"
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { fcmToken: `${prefix}:${cid}` },
    });

    console.log(`[个推] 用户 ${currentUser.id} 注册 CID (${platform || 'android'}): ${cid}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[个推] CID 注册失败:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * DELETE /api/getui/cid
 * 用户登出时清除 CID
 */
router.delete('/cid', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { fcmToken: null },
    });
    console.log(`[个推] 用户 ${currentUser.id} 清除 CID`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[个推] CID 清除失败:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;

// ============ 推送发送工具函数 ============
export interface GetuiPushPayload {
  /** 接收方用户 ID */
  toUserId: string;
  /** 通知标题 */
  title: string;
  /** 通知内容 */
  body: string;
  /** 发送者头像 URL（可选，用于 iOS 富通知显示） */
  senderAvatar?: string;
  /** 附加透传数据（可选） */
  payload?: string;
}

/**
 * 向指定用户发送个推推送通知
 * 如果用户没有注册 CID，则静默跳过
 * 自动根据 platform 区分 iOS/Android 推送通道配置
 */
export async function sendGetuiPush(payload: GetuiPushPayload): Promise<boolean> {
  if (!isGetuiConfigured) {
    return false; // 未配置个推，静默跳过
  }
  try {
    // 查询用户的推送 Token
    const user = await prisma.user.findUnique({
      where: { id: payload.toUserId },
      select: { fcmToken: true },
    });

    // 解析个推 CID 和平台
    const getuiInfo = parseGetuiToken(user?.fcmToken);
    if (!getuiInfo) {
      return false;
    }

    const { cid, platform } = getuiInfo;
    const token = await getGetuiToken();
    if (!token) {
      console.warn('[个推] 无法获取鉴权 Token，跳过推送');
      return false;
    }

    // 构建推送消息（REST API V2 格式）
    const message: any = {
      request_id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      audience: {
        cid: [cid],
      },
      push_message: {
        // 透传消息（App 在前台时接收），包含发送者头像 URL
        transmission: payload.payload || JSON.stringify({
          title: payload.title,
          body: payload.body,
          sender_avatar: payload.senderAvatar || '',
        }),
      },
    };

    if (platform === 'ios') {
      // iOS: 走 APNs 通道（个推代发），不需要 notification 字段
      // 解析透传消息中的业务数据，确保关键字段传递到 APNs payload
      let extraPayloadData: Record<string, any> = {};
      try {
        if (payload.payload) {
          extraPayloadData = JSON.parse(payload.payload);
        }
      } catch {}
      message.push_channel = {
        ios: {
          type: 'notify',
          aps: {
            alert: {
              title: payload.title,
              body: payload.body,
            },
            'mutable-content': 1,  // 触发 iOS Notification Service Extension
            sound: 'default',
            badge: 1,
          },
          // 将业务数据（chatId, senderId, sender_avatar 等）全部传入 payload
          payload: JSON.stringify({
            sender_avatar: payload.senderAvatar || '',
            ...extraPayloadData,
          }),
        },
      };
    } else {
      // Android: 走个推自有通道 + 厂商通道
      message.push_message.notification = {
        title: payload.title,
        body: payload.body,
        click_type: 'startapp',
        channel_id: 'cqim_messages',
        channel_name: '灵鸽IM消息',
        channel_level: 4,
      };
      message.push_channel = {
        android: {
          ups: {
            notification: {
              title: payload.title,
              body: payload.body,
              click_type: 'startapp',
              channel_id: 'cqim_messages',
              channel_name: '灵鸽IM消息',
            },
          },
        },
      };
    }

    const response = await fetch(`${GETUI_BASE_URL}/push/single/cid`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': token,
      },
      body: JSON.stringify(message),
    });

    const result = await response.json() as any;
    if (result.code === 0) {
      console.log(`[个推] 推送成功 (${platform}): userId=${payload.toUserId} cid=${cid}`);
      return true;
    } else {
      console.error(`[个推] 推送失败: code=${result.code} msg=${result.msg}`);
      // CID 无效时清除
      if (result.code === 10001 || result.code === 10002) {
        await prisma.user.update({
          where: { id: payload.toUserId },
          data: { fcmToken: null },
        }).catch(() => {});
      }
      return false;
    }
  } catch (err) {
    console.error('[个推] 推送请求失败:', err);
    return false;
  }
}
