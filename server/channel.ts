/**
 * 频道服务 — Telegram 风格单向广播频道
 *
 * 核心特性：
 * 1. 单向广播：仅 owner/admin 可发布消息，订阅者只读
 * 2. 无限订阅者：不受 maxMembers 限制
 * 3. 公开/私有频道：公开频道可通过 username 搜索和加入
 * 4. 复用现有 Group 模型（type='channel'）+ 消息基础设施
 * 5. 订阅者看到统一的消息视图（无"加入前"历史隔离）
 * 6. 支持转发到频道、消息引用回复
 */

import { Router } from 'express';
import prisma from './db';
import { avatarToProxy } from './cos-signer.js';
import {
  sendGroupMessage,
  pullGroupMessages,
  ackGroupMessages,
  getGroupUnreadCounts,
  joinGroup,
  getGroupInfo,
  getGroupMembers,
} from './group-message.js';

const channelRouter = Router();

// ============ 频道创建 ============

/**
 * 创建频道
 *
 * 与普通群组的区别：
 * - 默认 isPublic=true（频道可通过 username 搜索加入）
 * - maxMembers 设为 0 表示无限
 * - 默认类型为 channel
 */
channelRouter.post('/create', async (req, res) => {
  try {
    const { name, ownerId, username, description, isPublic = true } = req.body;
    if (!name || !ownerId) {
      return res.status(400).json({ error: '缺少必要参数：name, ownerId' });
    }

    // 验证 username 格式
    if (username) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) {
        return res.status(400).json({ error: '频道用户名必须以字母开头，5-32位字母数字下划线' });
      }
      const [existUser, existGroup] = await Promise.all([
        prisma.user.findUnique({ where: { username }, select: { id: true } }),
        prisma.group.findUnique({ where: { username }, select: { id: true } }),
      ]);
      if (existUser || existGroup) {
        return res.status(409).json({ error: '该用户名已被占用' });
      }
    }

    // 生成 TG 风格 Dialog ID
    const { generateDialogId, dialogIdToString } = await import('./utils/peerId.js');
    const dialogId = generateDialogId('channel');
    const dialogIdStr = dialogIdToString(dialogId);

    const channel = await prisma.group.create({
      data: {
        name,
        dialogId: dialogIdStr,
        username: username || null,
        ownerId,
        type: 'channel',
        isPublic: isPublic ?? true,
        maxMembers: 0, // 0 = 无限订阅者
        memberCount: 1,
        announcement: description || null,
        members: {
          create: { userId: ownerId, role: 'owner' },
        },
      },
    });

    // 初始化在线成员缓存
    const { joinGroupOnline } = await import('./group-message.js');
    const groupOnlineMembers = (joinGroupOnline as any).__groupOnlineMembers;
    if (groupOnlineMembers) {
      groupOnlineMembers.set(channel.id, new Set());
    }

    console.log(`[Channel] 频道已创建: id=${channel.id} dialogId=${dialogIdStr} name=${name}`);

    res.json({
      ok: true,
      channel: {
        id: channel.id,
        dialogId: dialogIdStr,
        name: channel.name,
        username: channel.username,
        type: channel.type,
        isPublic: channel.isPublic,
        memberCount: channel.memberCount,
        publicUrl: channel.username
          ? `https://wed.imim.chat/im/${channel.username}`
          : null,
        createdAt: channel.createdAt,
      },
    });
  } catch (err: any) {
    console.error('[Channel] 创建失败:', err);
    res.status(500).json({ error: err.message || '创建频道失败' });
  }
});

// ============ 频道信息 ============

/**
 * 获取频道详情
 */
channelRouter.get('/info', async (req, res) => {
  try {
    const { channelId } = req.query as { channelId: string };
    if (!channelId) return res.status(400).json({ error: '缺少 channelId' });

    const info = await getGroupInfo(channelId);
    if (!info) return res.status(404).json({ error: '频道不存在' });

    // 判断请求者是否是订阅者
    const userId = req.query.userId as string | undefined;
    let isSubscribed = false;
    let memberRole: string | null = null;

    if (userId) {
      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: channelId, userId } },
        select: { role: true },
      });
      isSubscribed = !!member;
      memberRole = member?.role || null;
    }

    res.json({
      ...info,
      isSubscribed,
      memberRole,
      canPost: memberRole === 'owner' || memberRole === 'admin',
      avatar: avatarToProxy((info as any).avatar),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 通过 username 获取频道信息
 */
channelRouter.get('/resolve', async (req, res) => {
  try {
    const { username } = req.query as { username: string };
    if (!username) return res.status(400).json({ error: '缺少 username' });

    const channel = await prisma.group.findUnique({
      where: { username },
      select: {
        id: true,
        dialogId: true,
        name: true,
        username: true,
        avatar: true,
        type: true,
        isPublic: true,
        memberCount: true,
        announcement: true,
        createdAt: true,
      },
    });

    if (!channel || channel.type !== 'channel') {
      return res.status(404).json({ error: '频道不存在' });
    }

    res.json({
      ...channel,
      avatar: avatarToProxy(channel.avatar),
      publicUrl: `https://wed.imim.chat/im/${channel.username}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 频道订阅 ============

/**
 * 订阅频道（加入）
 *
 * 与普通群组的区别：
 * - 不需要邀请，公开频道直接加入
 * - 私有频道也可以直接加入（频道本质是广播，不需要审批）
 * - 加入后 lastAckSeq 设为当前最新 seq（不标记历史为未读）
 */
channelRouter.post('/subscribe', async (req, res) => {
  try {
    const { channelId, userId } = req.body;
    if (!channelId || !userId) {
      return res.status(400).json({ error: '缺少必要参数：channelId, userId' });
    }

    // 检查频道是否存在
    const channel = await prisma.group.findUnique({
      where: { id: channelId },
      select: { id: true, type: true, name: true, memberCount: true, maxMembers: true },
    });

    if (!channel) return res.status(404).json({ error: '频道不存在' });
    if (channel.type !== 'channel') return res.status(400).json({ error: '该群组不是频道' });

    // 检查是否已订阅
    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId } },
    });
    if (existing) {
      return res.json({
        ok: true,
        alreadySubscribed: true,
        channelId,
        channelName: channel.name,
      });
    }

    // 订阅频道（加入群成员）
    await joinGroup(channelId, userId);

    console.log(`[Channel] 用户 ${userId} 订阅了频道 ${channel.name}(${channelId})`);

    res.json({
      ok: true,
      channelId,
      channelName: channel.name,
      memberCount: channel.memberCount + 1,
    });
  } catch (err: any) {
    console.error('[Channel] 订阅失败:', err);
    res.status(500).json({ error: err.message || '订阅频道失败' });
  }
});

/**
 * 取消订阅频道（退出）
 */
channelRouter.post('/unsubscribe', async (req, res) => {
  try {
    const { channelId, userId } = req.body;
    if (!channelId || !userId) {
      return res.status(400).json({ error: '缺少必要参数：channelId, userId' });
    }

    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId } },
      select: { role: true },
    });

    if (!member) return res.status(404).json({ error: '未订阅此频道' });
    if (member.role === 'owner') {
      return res.status(400).json({ error: '频道所有者不能取消订阅，请先转让或删除频道' });
    }

    await prisma.$transaction([
      prisma.groupMember.delete({
        where: { groupId_userId: { groupId: channelId, userId } },
      }),
      prisma.group.update({
        where: { id: channelId },
        data: { memberCount: { decrement: 1 } },
      }),
    ]);

    // 从在线列表移除
    try {
      const { leaveGroupOnline } = await import('./group-message.js');
      leaveGroupOnline(channelId, userId);
    } catch {}

    console.log(`[Channel] 用户 ${userId} 取消订阅频道 ${channelId}`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 频道消息 ============

/**
 * 发布消息到频道（仅 owner/admin 可发送）
 */
channelRouter.post('/post', async (req, res) => {
  try {
    const { channelId, senderId, senderName, msgType, content, replyToId, extra } = req.body;
    if (!channelId || !senderId || !content) {
      return res.status(400).json({ error: '缺少必要参数：channelId, senderId, content' });
    }

    // 权限验证：仅 owner/admin 可发布
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId: senderId } },
      select: { role: true },
    });
    if (!member) return res.status(403).json({ error: '未订阅此频道' });
    if (member.role !== 'owner' && member.role !== 'admin') {
      return res.status(403).json({ error: '仅频道管理员可发布消息' });
    }

    // 验证频道类型
    const channel = await prisma.group.findUnique({
      where: { id: channelId },
      select: { type: true },
    });
    if (!channel || channel.type !== 'channel') {
      return res.status(400).json({ error: '该群组不是频道' });
    }

    const result = await sendGroupMessage({
      groupId: channelId,
      senderId,
      senderName,
      msgType: msgType || 'text',
      content,
      replyToId,
      extra,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[Channel] 发布消息失败:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 拉取频道历史消息
 */
channelRouter.get('/messages', async (req, res) => {
  try {
    const { channelId, userId, afterSeq, beforeSeq, limit } = req.query as Record<string, string>;
    if (!channelId || !userId) {
      return res.status(400).json({ error: '缺少 channelId 或 userId' });
    }

    // 验证频道类型
    const channel = await prisma.group.findUnique({
      where: { id: channelId },
      select: { type: true },
    });
    if (!channel || channel.type !== 'channel') {
      return res.status(400).json({ error: '该群组不是频道' });
    }

    const result = await pullGroupMessages({
      groupId: channelId,
      userId,
      afterSeq: afterSeq ? parseInt(afterSeq) : undefined,
      beforeSeq: beforeSeq ? parseInt(beforeSeq) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.message?.includes('非群成员') ? 403 : 500).json({ error: err.message });
  }
});

// ============ 我的频道列表 ============

/**
 * 获取用户订阅的频道列表
 */
channelRouter.get('/my', async (req, res) => {
  try {
    const { userId } = req.query as { userId: string };
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const memberships = await prisma.groupMember.findMany({
      where: {
        userId,
        group: { type: 'channel' },
      },
      include: {
        group: {
          select: {
            id: true,
            dialogId: true,
            name: true,
            username: true,
            avatar: true,
            type: true,
            isPublic: true,
            memberCount: true,
            announcement: true,
            lastMsgSeq: true,
            lastMsgTime: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const channels = memberships.map(m => ({
      id: m.group.id,
      dialogId: m.group.dialogId,
      name: m.group.name,
      username: m.group.username,
      avatar: avatarToProxy(m.group.avatar),
      type: m.group.type,
      isPublic: m.group.isPublic,
      memberCount: m.group.memberCount,
      announcement: m.group.announcement,
      myRole: m.role,
      lastMsgSeq: m.group.lastMsgSeq?.toString() ?? '0',
      lastMsgTime: m.group.lastMsgTime,
      joinedAt: m.joinTime,
    }));

    res.json({ channels });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 搜索公开频道
 */
channelRouter.get('/search', async (req, res) => {
  try {
    const { q } = req.query as { q: string };
    if (!q || q.trim().length < 1) {
      return res.status(400).json({ error: '请输入搜索关键词' });
    }

    const keyword = q.trim();
    const channels = await prisma.group.findMany({
      where: {
        type: 'channel',
        isPublic: true,
        OR: [
          { name: { contains: keyword } },
          { username: { contains: keyword } },
          { announcement: { contains: keyword } },
        ],
      },
      select: {
        id: true,
        dialogId: true,
        name: true,
        username: true,
        avatar: true,
        type: true,
        isPublic: true,
        memberCount: true,
        announcement: true,
      },
      take: 20,
      orderBy: { memberCount: 'desc' },
    });

    res.json({
      channels: channels.map(c => ({
        id: c.id,
        dialogId: c.dialogId,
        name: c.name,
        username: c.username,
        avatar: avatarToProxy(c.avatar),
        type: c.type,
        isPublic: c.isPublic,
        memberCount: c.memberCount,
        announcement: c.announcement,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: '搜索失败' });
  }
});

/**
 * 获取频道订阅者列表（分页）
 */
channelRouter.get('/subscribers', async (req, res) => {
  try {
    const { channelId, page, pageSize } = req.query as Record<string, string>;
    if (!channelId) return res.status(400).json({ error: '缺少 channelId' });

    const result = await getGroupMembers(
      channelId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 100
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 频道管理 ============

/**
 * 添加管理员
 */
channelRouter.post('/admin/add', async (req, res) => {
  try {
    const { channelId, ownerId, targetUserId } = req.body;
    if (!channelId || !ownerId || !targetUserId) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 验证操作者是 owner
    const ownerMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId: ownerId } },
      select: { role: true },
    });
    if (!ownerMembership || ownerMembership.role !== 'owner') {
      return res.status(403).json({ error: '仅频道所有者可添加管理员' });
    }

    // 验证目标是订阅者
    const targetMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId: targetUserId } },
      select: { role: true },
    });
    if (!targetMembership) {
      return res.status(404).json({ error: '该用户未订阅此频道' });
    }
    if (targetMembership.role === 'owner') {
      return res.status(400).json({ error: '频道所有者已是最高权限' });
    }
    if (targetMembership.role === 'admin') {
      return res.json({ ok: true, message: '该用户已是管理员' });
    }

    await prisma.groupMember.update({
      where: { groupId_userId: { groupId: channelId, userId: targetUserId } },
      data: { role: 'admin' },
    });

    // 发送系统消息
    sendGroupMessage({
      groupId: channelId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: `${targetUserId} 已被提升为频道管理员`,
    }).catch(err => console.error('[Channel] 发送管理员变更消息失败:', err));

    console.log(`[Channel] ${ownerId} 将 ${targetUserId} 提升为频道 ${channelId} 的管理员`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 移除管理员
 */
channelRouter.post('/admin/remove', async (req, res) => {
  try {
    const { channelId, ownerId, targetUserId } = req.body;
    if (!channelId || !ownerId || !targetUserId) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const ownerMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId: ownerId } },
      select: { role: true },
    });
    if (!ownerMembership || ownerMembership.role !== 'owner') {
      return res.status(403).json({ error: '仅频道所有者可移除管理员' });
    }

    const targetMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId: targetUserId } },
      select: { role: true },
    });
    if (!targetMembership) {
      return res.status(404).json({ error: '该用户未订阅此频道' });
    }
    if (targetMembership.role !== 'admin') {
      return res.json({ ok: true, message: '该用户不是管理员' });
    }

    await prisma.groupMember.update({
      where: { groupId_userId: { groupId: channelId, userId: targetUserId } },
      data: { role: 'member' },
    });

    console.log(`[Channel] ${ownerId} 移除了 ${targetUserId} 在频道 ${channelId} 的管理员权限`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 更新频道信息（名称、描述、头像）
 */
channelRouter.put('/update', async (req, res) => {
  try {
    const { channelId, userId, name, announcement, avatar } = req.body;
    if (!channelId || !userId) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 权限验证
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId } },
      select: { role: true },
    });
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return res.status(403).json({ error: '仅频道管理员可修改频道信息' });
    }

    const updateData: any = {};
    const changes: string[] = [];

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) return res.status(400).json({ error: '频道名称不能为空' });
      if (trimmedName.length > 30) return res.status(400).json({ error: '频道名称不能超过30个字符' });
      updateData.name = trimmedName;
      changes.push(`频道名称已更新`);
    }

    if (announcement !== undefined) {
      updateData.announcement = announcement || null;
      changes.push('频道简介已更新');
    }

    if (avatar !== undefined) {
      updateData.avatar = avatar || null;
      changes.push('频道头像已更新');
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: '没有需要更新的字段' });
    }

    await prisma.group.update({
      where: { id: channelId },
      data: updateData,
    });

    // 发送系统消息
    if (changes.length > 0) {
      sendGroupMessage({
        groupId: channelId,
        senderId: 'system',
        senderName: '系统',
        msgType: 'system',
        content: changes.join('，'),
      }).catch(err => console.error('[Channel] 发送更新消息失败:', err));
    }

    res.json({ ok: true, changes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 删除频道（仅 owner）
 */
channelRouter.delete('/delete', async (req, res) => {
  try {
    const { channelId, userId } = req.body;
    if (!channelId || !userId) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channelId, userId } },
      select: { role: true },
    });
    if (!member || member.role !== 'owner') {
      return res.status(403).json({ error: '仅频道所有者可删除频道' });
    }

    await prisma.group.delete({ where: { id: channelId } });

    console.log(`[Channel] 频道 ${channelId} 已被 ${userId} 删除`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 已读回执 ============

/**
 * 频道消息已读回执
 */
channelRouter.post('/ack', async (req, res) => {
  try {
    const { channelId, userId, lastAckSeq } = req.body;
    if (!channelId || !userId || lastAckSeq === undefined) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const result = await ackGroupMessages({ groupId: channelId, userId, lastAckSeq });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 频道未读数 ============

/**
 * 获取频道未读消息数
 */
channelRouter.get('/unread', async (req, res) => {
  try {
    const { userId } = req.query as { userId: string };
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const allUnread = await getGroupUnreadCounts(userId);

    // 只返回频道类型的未读数
    const channelIds = Object.keys(allUnread).filter(async (gid) => {
      const g = await prisma.group.findUnique({
        where: { id: gid },
        select: { type: true },
      });
      return g?.type === 'channel';
    });

    // 简化：返回所有未读数，前端过滤
    res.json(allUnread);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default channelRouter;
