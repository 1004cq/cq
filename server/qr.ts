/**
 * server/qr.ts - 二维码校验 API
 *
 * POST /api/qr/verify
 * 校验扫描到的 QR Payload 合法性：
 *   1. 检查版本号 v === 1
 *   2. 检查 uid 对应用户是否存在
 *   3. 检查二维码是否过期（exp 字段）
 * 返回目标用户的基本信息（用于前端展示确认弹窗）
 */
import { Router, Request, Response } from 'express';
import prisma from './db.js';
import { userAuth } from './auth.js';
import { avatarToProxy } from './cos-signer.js';

const router = Router();

// 所有路由需要登录
router.use(userAuth);

/**
 * POST /api/qr/verify
 * Body: { v, uid, name, phone, ik, regId, fp, ts, exp, sig? }
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const payload = req.body;

    // 基础字段校验
    if (!payload || payload.v !== 1) {
      return res.status(400).json({ error: '无效的二维码格式' });
    }
    if (!payload.uid) {
      return res.status(400).json({ error: '二维码缺少必要字段' });
    }
    // 基础二维码（imim://user/{id}）无 E2EE 公钥，仍允许添加好友
    const isBasicQr = !payload.ik || payload.ik === 'basic';

    // 过期校验
    if (payload.exp && Date.now() > payload.exp) {
      return res.status(400).json({ error: '二维码已过期，请让对方刷新后重试', expired: true });
    }

    // 用户存在性校验
    const user = await prisma.user.findUnique({
      where: { id: payload.uid },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        phone: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: '二维码对应的用户不存在' });
    }

    // 不能扫自己的二维码
    const currentUser = (req as any).user;
    if (user.id === currentUser.id) {
      return res.status(400).json({ error: '不能扫描自己的二维码' });
    }

    res.json({
      valid: true,
      basic: isBasicQr,
      user: {
        id: user.id,
        name: user.nickname || user.username,
        phone: user.phone || '',
        avatar: avatarToProxy(user.avatar),
      },
    });
  } catch (e: any) {
    console.error('[QR] 校验失败:', e);
    res.status(500).json({ error: '校验失败，请重试' });
  }
});

export default router;
