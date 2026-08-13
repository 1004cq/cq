/**
 * server/home.ts - 首页聚合接口（P1 优化）
 * 一次性返回当前用户基本信息、未读数统计、会话列表及置顶公告，减少首屏 RTT
 */
import { Router, Request, Response } from 'express';
import prisma from './db.js';
import { userAuth } from './auth.js';
import { getUnreadCount, getCachedConversationList, setCachedConversationList } from './redis.js';
import { avatarToProxy } from './cos-signer.js';
import { getUserGroups } from './group-message.js';


const router = Router();

router.get('/sync', userAuth, async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const userId = currentUser.id;

    // 1. 并行拉取用户基本信息、系统公告、总未读数与会话列表
    const [user, announcement, totalUnread, cachedChats, groups] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar: true,
          bio: true,
          role: true,
          phone: true,
          createdAt: true,
        },
      }),
      prisma.announcement.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, content: true, type: true, createdAt: true },
      }),
      getUnreadCount(userId),
      getCachedConversationList(userId),
      getUserGroups(userId),
    ]);

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    let chats = cachedChats;
    if (!chats) {
      // 若缓存未命中，内部简要查询会话列表
      const dbChats = await prisma.chat.findMany({
        where: {
          OR: [{ participantA: userId }, { participantB: userId }],
        },
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        take: 30,
      });

      const peerIds = dbChats.map(c => c.participantA === userId ? c.participantB : c.participantA);
      const peers = await prisma.user.findMany({
        where: { id: { in: peerIds } },
        select: { id: true, username: true, nickname: true, avatar: true, bio: true },
      });
      const peerMap = new Map(peers.map(p => [p.id, p]));

      chats = await Promise.all(dbChats.map(async c => {
        const peerId = c.participantA === userId ? c.participantB : c.participantA;
        const peer = peerMap.get(peerId);
        const unread = await getUnreadCount(userId, c.id);
        return {
          id: c.id,
          participantA: c.participantA,
          participantB: c.participantB,
          lastMessage: c.lastMessage,
          lastMessageAt: c.lastMessageAt?.getTime() || null,
          createdAt: c.createdAt.getTime(),
          unreadCount: unread,
          peer: peer ? {
            id: peer.id,
            username: peer.username,
            nickname: peer.nickname || peer.username,
            avatar: avatarToProxy(peer.avatar),
            bio: peer.bio || '',
          } : { id: peerId, username: peerId, nickname: peerId, avatar: '', bio: '' },
        };
      }));

      await setCachedConversationList(userId, chats);
    }

    res.json({
      code: 200,
      data: {
        user: {
          ...user,
          avatar: avatarToProxy(user.avatar),
        },
        totalUnread,
        announcement: announcement || null,
        chats,
        groups,
      },
    });
  } catch (err) {
    console.error('[HomeSync] 首页聚合同步失败:', err);
    res.status(500).json({ error: '首页聚合同步失败' });
  }
});

export default router;
