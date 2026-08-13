/**
 * server/friend.ts - 好友关系 API
 * 提供发送好友申请、接受/拒绝申请、获取好友列表、删除好友等功能
 */
import { Router, Request, Response } from 'express';
import prisma from './db.js';
import { userAuth } from './auth.js';
import { isUserOnline, getUserDevices, getUserLastSeen } from './redis.js';
import { avatarToProxy } from './cos-signer.js';

const router = Router();

// ============ 所有路由需要登录 ============
router.use(userAuth);

// ============ 辅助函数 ============

/**
 * 规范化两个用户的顺序（字典序较小的为 A）
 * 确保同一对用户始终映射到同一个 Friendship 记录
 */
function normalizeUsers(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA];
}

/**
 * 检查两个用户是否已经是好友
 */
async function areFriends(userId1: string, userId2: string): Promise<boolean> {
  const [userA, userB] = normalizeUsers(userId1, userId2);
  const friendship = await prisma.friendship.findUnique({
    where: { userA_userB: { userA, userB } },
  });
  return !!friendship;
}

// ============ 好友申请 API ============

/**
 * POST /api/friend/request
 * 发送好友申请
 * Body: { toId: string, message?: string, searchMethod?: 'id' | 'phone' | 'email' }
 */
router.post('/request', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { toId, message = '', searchMethod = 'id' } = req.body;

    if (!toId) {
      return res.status(400).json({ error: '缺少目标用户 ID' });
    }

    if (toId === currentUser.id) {
      return res.status(400).json({ error: '不能向自己发送好友申请' });
    }

    // 验证目标用户存在
    const targetUser = await prisma.user.findUnique({
      where: { id: toId },
      select: { id: true, username: true, nickname: true, avatar: true },
    });
    if (!targetUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 检查是否已经是好友
    const alreadyFriends = await areFriends(currentUser.id, toId);
    if (alreadyFriends) {
      return res.status(400).json({ error: '已经是好友了' });
    }

    // 检查是否已有待处理的申请（双向检查）
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { fromId: currentUser.id, toId: toId },
          { fromId: toId, toId: currentUser.id },
        ],
        status: 'pending',
      },
    });

    if (existingRequest) {
      if (existingRequest.fromId === currentUser.id) {
        return res.status(400).json({ error: '已发送过好友申请，等待对方处理' });
      } else {
        // 对方已向我发送申请，直接接受
        const [userA, userB] = normalizeUsers(currentUser.id, toId);
        await prisma.$transaction([
          prisma.friendRequest.update({
            where: { id: existingRequest.id },
            data: { status: 'accepted' },
          }),
          prisma.friendship.upsert({
            where: { userA_userB: { userA, userB } },
            create: { userA, userB },
            update: {},
          }),
        ]);
        return res.json({ success: true, message: '对方已向你发送申请，已自动成为好友', autoAccepted: true });
      }
    }

    // 创建新申请（使用 upsert 避免重复）
    const request = await prisma.friendRequest.upsert({
      where: { fromId_toId: { fromId: currentUser.id, toId } },
      create: {
        fromId: currentUser.id,
        toId,
        message: message || '',
        searchMethod,
        status: 'pending',
      },
      update: {
        message: message || '',
        searchMethod,
        status: 'pending',
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      request: {
        id: request.id,
        fromId: request.fromId,
        toId: request.toId,
        message: request.message,
        status: request.status,
        searchMethod: request.searchMethod,
        createdAt: request.createdAt.getTime(),
      },
    });
  } catch (e: any) {
    console.error('[Friend] 发送好友申请失败:', e);
    res.status(500).json({ error: '发送失败，请重试' });
  }
});

/**
 * GET /api/friend/requests
 * 获取好友申请列表（收到的 + 发出的）
 * Query: ?type=received|sent|all (default: all)
 */
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { type = 'all' } = req.query as { type: string };

    const whereCondition: any = {};
    if (type === 'received') {
      whereCondition.toId = currentUser.id;
    } else if (type === 'sent') {
      whereCondition.fromId = currentUser.id;
    } else {
      whereCondition.OR = [
        { toId: currentUser.id },
        { fromId: currentUser.id },
      ];
    }

    const requests = await prisma.friendRequest.findMany({
      where: whereCondition,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // 批量获取相关用户信息
    const userIds = new Set<string>();
    requests.forEach(r => { userIds.add(r.fromId); userIds.add(r.toId); });
    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, username: true, nickname: true, avatar: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    res.json({
      requests: requests.map(r => {
        const fromUser = userMap.get(r.fromId);
        const toUser = userMap.get(r.toId);
        return {
          id: r.id,
          fromId: r.fromId,
          fromName: fromUser?.nickname || fromUser?.username || r.fromId,
          fromUniqueId: fromUser?.username || r.fromId,
          fromAvatar: avatarToProxy(fromUser?.avatar),
          toId: r.toId,
          toName: toUser?.nickname || toUser?.username || r.toId,
          toAvatar: avatarToProxy(toUser?.avatar),
          message: r.message || '',
          status: r.status,
          searchMethod: r.searchMethod,
          timestamp: r.createdAt.getTime(),
          isIncoming: r.toId === currentUser.id,
        };
      }),
    });
  } catch (e: any) {
    console.error('[Friend] 获取好友申请失败:', e);
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * POST /api/friend/accept/:requestId
 * 接受好友申请
 */
router.post('/accept/:requestId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { requestId } = req.params;

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({ error: '申请不存在' });
    }

    if (request.toId !== currentUser.id) {
      return res.status(403).json({ error: '无权操作此申请' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: `申请已${request.status === 'accepted' ? '接受' : '拒绝'}` });
    }

    const [userA, userB] = normalizeUsers(request.fromId, request.toId);

    await prisma.$transaction([
      prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: 'accepted' },
      }),
      prisma.friendship.upsert({
        where: { userA_userB: { userA, userB } },
        create: { userA, userB },
        update: {},
      }),
    ]);

    // 自动创建私聊会话（如果不存在）
    const [participantA, participantB] = normalizeUsers(request.fromId, request.toId);
    let chat = await prisma.chat.findUnique({
      where: { participantA_participantB: { participantA, participantB } },
    });
    if (!chat) {
      chat = await prisma.chat.create({
        data: { participantA, participantB },
      });
      console.log(`[Friend] 自动创建私聊会话: ${participantA} <-> ${participantB} chatId=${chat.id}`);
    }

    res.json({ success: true, message: '已接受好友申请', chatId: chat.id });
  } catch (e: any) {
    console.error('[Friend] 接受好友申请失败:', e);
    res.status(500).json({ error: '操作失败' });
  }
});

/**
 * POST /api/friend/reject/:requestId
 * 拒绝好友申请
 */
router.post('/reject/:requestId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { requestId } = req.params;

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({ error: '申请不存在' });
    }

    if (request.toId !== currentUser.id) {
      return res.status(403).json({ error: '无权操作此申请' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: `申请已${request.status === 'accepted' ? '接受' : '拒绝'}` });
    }

    await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: 'rejected' },
    });

    res.json({ success: true, message: '已拒绝好友申请' });
  } catch (e: any) {
    console.error('[Friend] 拒绝好友申请失败:', e);
    res.status(500).json({ error: '操作失败' });
  }
});

/**
 * GET /api/friend/list
 * 获取好友列表（含用户详情）
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;

    // 查询所有包含当前用户的好友关系
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { userA: currentUser.id },
          { userB: currentUser.id },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    // 提取好友 ID 列表
    const friendIds = friendships.map(f =>
      f.userA === currentUser.id ? f.userB : f.userA
    );

    if (friendIds.length === 0) {
      return res.json({ friends: [] });
    }

    // 批量获取好友用户信息
    const users = await prisma.user.findMany({
      where: { id: { in: friendIds }, isBanned: false },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        bio: true,
        phone: true,
        email: true,
      },
    });

    // 批量查询所有好友的在线状态（并发）
    const onlineResults = await Promise.allSettled(
      users.map(u => isUserOnline(u.id))
    );
    const onlineMap = new Map<string, boolean>();
    users.forEach((u, i) => {
      const result = onlineResults[i];
      onlineMap.set(u.id, result.status === 'fulfilled' ? result.value : false);
    });

    // 对在线用户批量查询设备信息
    const onlineUserIds = users.filter(u => onlineMap.get(u.id)).map(u => u.id);
    const devicesMap = new Map<string, any[]>();
    if (onlineUserIds.length > 0) {
      const deviceResults = await Promise.allSettled(
        onlineUserIds.map(uid => getUserDevices(uid))
      );
      onlineUserIds.forEach((uid, i) => {
        const result = deviceResults[i];
        devicesMap.set(uid, result.status === 'fulfilled' ? result.value : []);
      });
    }

    // 对离线用户批量查询最后在线时间
    const offlineUserIds = users.filter(u => !onlineMap.get(u.id)).map(u => u.id);
    const lastSeenMap = new Map<string, number | null>();
    if (offlineUserIds.length > 0) {
      const lastSeenResults = await Promise.allSettled(
        offlineUserIds.map(uid => getUserLastSeen(uid))
      );
      offlineUserIds.forEach((uid, i) => {
        const result = lastSeenResults[i];
        lastSeenMap.set(uid, result.status === 'fulfilled' ? result.value : null);
      });
    }

    // 按首字母排序
    const friends = users.map(u => {
      const name = u.nickname || u.username;
      const firstChar = name.charAt(0).toUpperCase();
      // 简单拼音首字母判断（仅 ASCII 字母）
      const letter = /[A-Z]/.test(firstChar) ? firstChar : '#';
      const online = onlineMap.get(u.id) ?? false;
      const devices = online ? (devicesMap.get(u.id) || []) : [];
      const lastSeen = online ? null : (lastSeenMap.get(u.id) ?? null);
      // 取主设备信息（第一个设备）
      const primaryDevice = devices[0];
      const deviceLabel = primaryDevice
        ? `${primaryDevice.os} · ${primaryDevice.browser}`
        : null;
      return {
        id: u.id,
        uniqueId: u.username,
        name: u.nickname || u.username,
        avatar: avatarToProxy(u.avatar),
        bio: u.bio || '',
        status: online ? 'online' as const : 'offline' as const,
        letter,
        online,
        devices,
        deviceLabel,
        lastSeen,
        // 隐私保护：手机号和邮箱脱敏
        phone: u.phone ? u.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : undefined,
        email: u.email ? u.email.replace(/(.{2}).*(@.*)/, '$1***$2') : undefined,
      };
    });

    // 按在线状态优先，再按首字母排序
    friends.sort((a, b) => {
      // 在线用户排在前面
      if (a.online && !b.online) return -1;
      if (!a.online && b.online) return 1;
      if (a.letter === '#' && b.letter !== '#') return 1;
      if (a.letter !== '#' && b.letter === '#') return -1;
      return a.letter.localeCompare(b.letter) || a.name.localeCompare(b.name);
    });

    res.json({ friends });
  } catch (e: any) {
    console.error('[Friend] 获取好友列表失败:', e);
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * DELETE /api/friend/:friendId
 * 删除好友
 */
router.delete('/:friendId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { friendId } = req.params;

    const [userA, userB] = normalizeUsers(currentUser.id, friendId);

    const friendship = await prisma.friendship.findUnique({
      where: { userA_userB: { userA, userB } },
    });

    if (!friendship) {
      return res.status(404).json({ error: '好友关系不存在' });
    }

    await prisma.friendship.delete({
      where: { userA_userB: { userA, userB } },
    });

    res.json({ success: true, message: '已删除好友' });
  } catch (e: any) {
    console.error('[Friend] 删除好友失败:', e);
    res.status(500).json({ error: '操作失败' });
  }
});

/**
 * GET /api/friend/check/:userId
 * 检查与指定用户是否是好友关系
 */
router.get('/check/:userId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { userId } = req.params;

    const isFriend = await areFriends(currentUser.id, userId);

    // 检查是否有待处理的申请
    const pendingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { fromId: currentUser.id, toId: userId, status: 'pending' },
          { fromId: userId, toId: currentUser.id, status: 'pending' },
        ],
      },
    });

    res.json({
      isFriend,
      hasPendingRequest: !!pendingRequest,
      requestDirection: pendingRequest
        ? (pendingRequest.fromId === currentUser.id ? 'sent' : 'received')
        : null,
    });
  } catch (e: any) {
    console.error('[Friend] 检查好友关系失败:', e);
    res.status(500).json({ error: '查询失败' });
  }
});

export default router;
