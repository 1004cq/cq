/**
 * server/private-chat.ts - 私聊会话与消息 API
 * 提供创建/获取会话、发送/拉取消息、标记已读、撤回等功能
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from './db.js';
import {
  getCachedConversationList,
  setCachedConversationList,
  invalidateConversationList,
  getUnreadCount,
  incrUnreadCount,
  clearUnreadCount,
} from './redis.js';
import { userAuth } from './auth.js';
import { avatarToProxy } from './cos-signer.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHAT_MEDIA_DIR = path.resolve(__dirname, '..', 'data', 'media');
if (!fs.existsSync(CHAT_MEDIA_DIR)) {
  fs.mkdirSync(CHAT_MEDIA_DIR, { recursive: true });
}

// ============ 辅助函数 ============

/**
 * 规范化两个参与者的顺序（字典序较小的为 A）
 * 确保同一对用户始终映射到同一个 Chat 记录
 */
function normalizeParticipants(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA];
}

/**
 * 解析 extra JSON 字段，安全返回对象
 */
function parseExtra(extra: string | null): Record<string, any> | undefined {
  if (!extra) return undefined;
  try {
    return JSON.parse(extra);
  } catch {
    return undefined;
  }
}

function messagePreview(msgType: string, content: string): string {
  if (msgType === 'text') return content.slice(0, 100);
  if (msgType === 'image') return '[图片]';
  if (msgType === 'voice') return '[语音消息]';
  if (msgType === 'video') return '[视频]';
  if (msgType === 'file') return '[文件]';
  if (msgType === 'sticker') return '[贴纸]';
  if (msgType === 'location') return '[位置]';
  if (msgType === 'location_share') return '[位置共享]';
  if (msgType === 'call') return '[通话]';
  return content.slice(0, 100);
}

function safeChatFileName(type: string, originalName: string, mimeType: string): string {
  const extFromName = path.extname(originalName || '').toLowerCase();
  const extFromMime: Record<string, string> = {
    'audio/mp4': '.m4a',
    'audio/m4a': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/zip': '.zip',
  };
  const ext = extFromName || extFromMime[mimeType] || '';
  return `chat_${type}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}${ext}`;
}

async function createPrivateMessageAndNotify(
  req: Request,
  res: Response,
  chatId: string,
  msgType: string,
  content: string,
  replyToId?: string | null,
  extra?: Record<string, any>,
) {
  const currentUser = (req as any).user;
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) {
    return res.status(404).json({ error: '会话不存在' });
  }
  if (chat.participantA !== currentUser.id && chat.participantB !== currentUser.id) {
    return res.status(403).json({ error: '无权发送消息' });
  }

  const message = await prisma.privateMessage.create({
    data: {
      chatId,
      senderId: currentUser.id,
      msgType,
      content,
      replyToId: replyToId || null,
      extra: extra ? JSON.stringify(extra) : null,
      status: 'sent',
    },
  });

  await prisma.chat.update({
    where: { id: chatId },
    data: {
      lastMessage: messagePreview(msgType, content),
      lastMessageAt: message.createdAt,
    },
  });

  const result: any = {
    id: message.id,
    chatId: message.chatId,
    senderId: message.senderId,
    msgType: message.msgType,
    content: message.content,
    replyToId: message.replyToId,
    isRevoked: message.isRevoked,
    status: message.status,
    extra: parseExtra(message.extra),
    createdAt: message.createdAt.getTime(),
  };

  const peerId = chat.participantA === currentUser.id ? chat.participantB : chat.participantA;
  const sendTo = req.app.locals.sendTo as undefined | ((userId: string, msg: Record<string, any>) => void);
  if (sendTo) {
    sendTo(peerId, {
      type: 'private_message',
      payload: result,
    });
  }

  return res.json({ message: result });
}

// ============ 所有路由需要登录 ============
router.use(userAuth);

// ============ 会话 API ============

/**
 * POST /api/chat/create
 * 创建或获取与目标用户的私聊会话
 * Body: { targetUserId: string }
 * Returns: { chat: ChatObject }
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { targetUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: '缺少 targetUserId' });
    }

    if (targetUserId === currentUser.id) {
      return res.status(400).json({ error: '不能和自己创建会话' });
    }

    // 验证目标用户存在
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true, nickname: true, avatar: true, bio: true },
    });
    if (!targetUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const [participantA, participantB] = normalizeParticipants(currentUser.id, targetUserId);

    // 查找已有会话或创建新会话
    let chat = await prisma.chat.findUnique({
      where: { participantA_participantB: { participantA, participantB } },
    });

    if (!chat) {
      chat = await prisma.chat.create({
        data: { participantA, participantB },
      });
    }

    await prisma.chatHidden.deleteMany({
      where: {
        chatId: chat.id,
        userId: currentUser.id,
      },
    });

    // 返回会话信息（附带对方用户信息）
    res.json({
      chat: {
        id: chat.id,
        participantA: chat.participantA,
        participantB: chat.participantB,
        lastMessage: chat.lastMessage,
        lastMessageAt: chat.lastMessageAt?.getTime() || null,
        createdAt: chat.createdAt.getTime(),
        peer: {
          id: targetUser.id,
          username: targetUser.username,
          nickname: targetUser.nickname || targetUser.username,
          avatar: avatarToProxy(targetUser.avatar),
          bio: targetUser.bio || '',
        },
      },
    });
  } catch (err) {
    console.error('[PrivateChat] 创建会话失败:', err);
    res.status(500).json({ error: '创建会话失败' });
  }
});

/**
 * POST /api/chat/send
 * iOS/移动端统一发送入口，支持文本、语音、图片、视频、文件 multipart/form-data
 * FormData: chatId, type, content?, file?, duration?, replyTo?
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    const contentType = String(req.headers['content-type'] || '');

    if (!contentType.includes('multipart/form-data')) {
      const { chatId, msgType, content = '', replyTo } = req.body || {};
      if (!chatId) return res.status(400).json({ error: '缺少 chatId' });
      if (msgType !== 'encrypted') {
        return res.status(400).json({ error: '私聊强制要求端到端加密，请发送加密消息 (msgType=encrypted)' });
      }
      if (!String(content).trim()) {
        return res.status(400).json({ error: '加密信封内容不能为空' });
      }
      return await createPrivateMessageAndNotify(req, res, chatId, 'encrypted', String(content), replyTo || null);
    }

    const busboy = (await import('busboy')).default;
    const bb = busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let originalName = '';
    let mimeType = '';
    let truncated = false;

    bb.on('field', (name: string, value: string) => {
      fields[name] = value;
    });

    bb.on('file', (name: string, stream: any, info: any) => {
      if (name !== 'file') {
        stream.resume();
        return;
      }
      originalName = info.filename || 'upload';
      mimeType = info.mimeType || 'application/octet-stream';
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on('finish', async () => {
      try {
        if (truncated) return res.status(400).json({ error: '文件过大，最大 200MB' });
        const chatId = fields.chatId;
        const msgType = fields.type || fields.msgType || 'text';
        const replyToId = fields.replyTo || fields.replyToId || null;
        if (!chatId) return res.status(400).json({ error: '缺少 chatId' });

        if (msgType !== 'encrypted') {
          return res.status(400).json({ error: '私聊强制要求端到端加密，请发送加密消息 (msgType=encrypted)' });
        }

        let content = fields.content || messagePreview(msgType, '');
        const extra: Record<string, any> = {};

        if (fileBuffer && fileBuffer.length > 0) {
          const allowedPrefixes = ['image/', 'video/', 'audio/'];
          const allowedExact = ['application/pdf', 'text/plain', 'application/zip', 'application/octet-stream'];
          if (!allowedPrefixes.some(prefix => mimeType.startsWith(prefix)) && !allowedExact.includes(mimeType)) {
            return res.status(400).json({ error: `不支持的文件类型: ${mimeType}` });
          }

          const safeName = safeChatFileName(msgType, originalName, mimeType);
          const localPath = path.join(CHAT_MEDIA_DIR, safeName);
          if (!localPath.startsWith(CHAT_MEDIA_DIR)) {
            return res.status(400).json({ error: '无效的文件路径' });
          }
          fs.writeFileSync(localPath, fileBuffer);
          const mediaUrl = `/api/media/files/${safeName}`;
          extra.mediaUrl = mediaUrl;
          extra.fileName = originalName;
          extra.fileSize = fileBuffer.length;
          extra.mimeType = mimeType;

          if (msgType === 'voice') {
            extra.voiceUrl = mediaUrl;
            extra.duration = Number(fields.duration || 0);
            if (fields.waveform) {
              try { extra.waveform = JSON.parse(fields.waveform); } catch { /* ignore invalid waveform */ }
            }
            extra.audioMimeType = mimeType;
            content = '[语音消息]';
          } else if (msgType === 'image') {
            content = '[图片]';
          } else if (msgType === 'video') {
            content = '[视频]';
          } else if (msgType === 'file') {
            content = originalName || '[文件]';
          }
        } else if (msgType !== 'text') {
          return res.status(400).json({ error: '缺少文件' });
        }

        return await createPrivateMessageAndNotify(req, res, chatId, msgType, content, replyToId, Object.keys(extra).length ? extra : undefined);
      } catch (err) {
        console.error('[PrivateChat] 统一发送失败:', err);
        return res.status(500).json({ error: '发送消息失败' });
      }
    });

    req.pipe(bb);
  } catch (err) {
    console.error('[PrivateChat] 解析上传失败:', err);
    res.status(500).json({ error: '发送消息失败' });
  }
});

/**
 * GET /api/chat/list
 * 获取当前用户的所有私聊会话列表
 * Returns: { chats: ChatObject[] }
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const userId = currentUser.id;

    const chats = await prisma.chat.findMany({
      where: {
        OR: [
          { participantA: userId },
          { participantB: userId },
        ],
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    const hiddenChats = await prisma.chatHidden.findMany({
      where: {
        userId,
        chatId: { in: chats.map(c => c.id) },
      },
      select: { chatId: true, hiddenAt: true },
    });
    const hiddenMap = new Map(hiddenChats.map(item => [item.chatId, item.hiddenAt]));

    const visibleChats = chats.filter((chat) => {
      const hiddenAt = hiddenMap.get(chat.id);
      if (!hiddenAt) return true;
      const latestActivityAt = chat.lastMessageAt || chat.createdAt;
      return hiddenAt < latestActivityAt;
    });

    // 收集所有对方用户 ID
    const peerIds = visibleChats.map(c => c.participantA === userId ? c.participantB : c.participantA);
    const uniquePeerIds = [...new Set(peerIds)];

    // Cache-Aside 模式：先查 Redis 缓存
    const cachedList = await getCachedConversationList(userId);
    if (cachedList) {
      return res.json({ chats: cachedList });
    }

    // 批量查询对方用户信息
    const peers = await prisma.user.findMany({
      where: { id: { in: uniquePeerIds } },
      select: { id: true, username: true, nickname: true, avatar: true, bio: true },
    });
    const peerMap = new Map(peers.map(p => [p.id, p]));

    // 查询每个会话的未读消息数（优先从 Redis Hash 获取，miss 时查 DB 并回填）
    const unreadCounts = await Promise.all(
      visibleChats.map(async c => {
        let unread = await getUnreadCount(userId, c.id);
        if (unread === 0) {
          unread = await prisma.privateMessage.count({
            where: {
              chatId: c.id,
              senderId: { not: userId },
              status: { not: 'read' },
              isRevoked: false,
            },
          });
        }
        return unread;
      })
    );

    const result = visibleChats.map((c, i) => {
      const peerId = c.participantA === userId ? c.participantB : c.participantA;
      const peer = peerMap.get(peerId);
      return {
        id: c.id,
        participantA: c.participantA,
        participantB: c.participantB,
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt?.getTime() || null,
        createdAt: c.createdAt.getTime(),
        unreadCount: unreadCounts[i],
        peer: peer ? {
          id: peer.id,
          username: peer.username,
          nickname: peer.nickname || peer.username,
          avatar: avatarToProxy(peer.avatar),
          bio: peer.bio || '',
        } : {
          id: peerId,
          username: peerId,
          nickname: peerId,
          avatar: '',
          bio: '',
        },
      };
    });

    // 缓存会话列表 60s
    await setCachedConversationList(userId, result);
    res.json({ chats: result });
  } catch (err) {
    console.error('[PrivateChat] 获取会话列表失败:', err);
    res.status(500).json({ error: '获取会话列表失败' });
  }
});

/**
 * DELETE /api/chat/:chatId
 * 对当前用户隐藏一个私聊会话；若后续有新消息，会话会重新出现
 */
router.delete('/:chatId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { chatId } = req.params;

    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) {
      return res.status(404).json({ error: '会话不存在' });
    }

    if (chat.participantA !== currentUser.id && chat.participantB !== currentUser.id) {
      return res.status(403).json({ error: '无权删除此会话' });
    }

    await prisma.chatHidden.upsert({
      where: { chatId_userId: { chatId, userId: currentUser.id } },
      update: { hiddenAt: new Date() },
      create: { chatId, userId: currentUser.id },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[PrivateChat] 隐藏会话失败:', err);
    return res.status(500).json({ error: '隐藏会话失败' });
  }
});

/**
 * GET /api/chat/:chatId
 * 获取单个会话详情
 */
router.get('/:chatId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { chatId } = req.params;

    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // 验证当前用户是会话参与者
    if (chat.participantA !== currentUser.id && chat.participantB !== currentUser.id) {
      return res.status(403).json({ error: '无权访问此会话' });
    }

    const peerId = chat.participantA === currentUser.id ? chat.participantB : chat.participantA;
    const peer = await prisma.user.findUnique({
      where: { id: peerId },
      select: { id: true, username: true, nickname: true, avatar: true, bio: true },
    });

    const unreadCount = await prisma.privateMessage.count({
      where: {
        chatId: chat.id,
        senderId: { not: currentUser.id },
        status: { not: 'read' },
        isRevoked: false,
      },
    });

    res.json({
      chat: {
        id: chat.id,
        participantA: chat.participantA,
        participantB: chat.participantB,
        lastMessage: chat.lastMessage,
        lastMessageAt: chat.lastMessageAt?.getTime() || null,
        createdAt: chat.createdAt.getTime(),
        unreadCount,
        peer: peer ? {
          id: peer.id,
          username: peer.username,
          nickname: peer.nickname || peer.username,
          avatar: avatarToProxy(peer.avatar),
          bio: peer.bio || '',
        } : null,
      },
    });
  } catch (err) {
    console.error('[PrivateChat] 获取会话详情失败:', err);
    res.status(500).json({ error: '获取会话详情失败' });
  }
});

// ============ 消息 API ============

/**
 * POST /api/chat/:chatId/messages
 * 发送私聊消息
 * Body: { content: string, msgType?: string, replyToId?: string, extra?: object }
 * Returns: { message: MessageObject }
 */
router.post('/:chatId/messages', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { chatId } = req.params;
    const { content, msgType, replyToId, extra: rawExtra, burnAfterRead, hmac } = req.body;

    // 强制 P0：私聊必须加密，禁止明文发送
    if (msgType !== 'encrypted') {
      return res.status(400).json({ error: '私聊强制要求端到端加密，请发送加密消息' });
    }

    // 安全处理 extra：如果客户端传入了字符串，尝试解析为对象
    let extra = rawExtra;
    if (typeof rawExtra === 'string') {
      try { extra = JSON.parse(rawExtra); } catch { extra = undefined; }
    }
    if (!content) {
      return res.status(400).json({ error: '加密信封不能为空' });
    }

    // 验证会话存在且用户有权限
    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) {
      return res.status(404).json({ error: '会话不存在' });
    }
    if (chat.participantA !== currentUser.id && chat.participantB !== currentUser.id) {
      return res.status(403).json({ error: '无权发送消息' });
    }

    // 解析阅后即焚参数
    const validBurnTimers = [5, 10, 30, 60, 300, 3600, 86400, 604800];
    const burnSeconds = (typeof burnAfterRead === 'number' && validBurnTimers.includes(burnAfterRead)) ? burnAfterRead : null;

    // 创建消息
    const message = await prisma.privateMessage.create({
      data: {
        chatId,
        senderId: currentUser.id,
        msgType: 'encrypted',
        content: content || '', // 此时 content 存储的是加密信封 JSON
        replyToId: replyToId || null,
        extra: extra ? JSON.stringify(extra) : null,
        status: 'sent',
        burnAfterRead: burnSeconds,
        hmac: (typeof hmac === 'string' && /^[a-f0-9]{64}$/i.test(hmac)) ? hmac : null,
      },
    });

    await prisma.chat.update({
      where: { id: chatId },
      data: {
        lastMessage: '🔒 [加密消息]', // 强制脱敏预览
        lastMessageAt: message.createdAt,
      },
    });

    const result: any = {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      msgType: message.msgType,
      content: message.content,
      replyToId: message.replyToId,
      isRevoked: message.isRevoked,
      status: message.status,
      extra: parseExtra(message.extra),
      createdAt: message.createdAt.getTime(),
      ...(burnSeconds ? { burnAfterRead: burnSeconds } : {}),
      ...(message.hmac ? { hmac: message.hmac } : {}),
    };

    const peerId = chat.participantA === currentUser.id ? chat.participantB : chat.participantA;

    // 严格一致性策略：更新 Redis 未读并删除会话列表缓存，最后推送
    await incrUnreadCount(peerId, chatId, 1);
    await invalidateConversationList(currentUser.id);
    await invalidateConversationList(peerId);

    const sendTo = req.app.locals.sendTo as undefined | ((userId: string, msg: Record<string, any>) => void);
    if (sendTo) {
      sendTo(peerId, {
        type: 'private_message',
        payload: result,
      });
    }

    res.json({ message: result });
  } catch (err) {
    console.error('[PrivateChat] 发送消息失败:', err);
    res.status(500).json({ error: '发送消息失败' });
  }
});

/**
 * GET /api/chat/:chatId/messages
 * 拉取私聊消息（分页，支持游标）
 * Query: { before?: string (messageId), limit?: number (default 50) }
 * Returns: { messages: MessageObject[], hasMore: boolean }
 */
router.get('/:chatId/messages', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { chatId } = req.params;
    const { before, limit: limitStr } = req.query as { before?: string; limit?: string };
    const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 100);

    // 验证会话存在且用户有权限
    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) {
      return res.status(404).json({ error: '会话不存在' });
    }
    if (chat.participantA !== currentUser.id && chat.participantB !== currentUser.id) {
      return res.status(403).json({ error: '无权访问此会话' });
    }

    // 构建查询条件
    const where: any = { chatId };
    if (before) {
      const cursorMsg = await prisma.privateMessage.findUnique({ where: { id: before } });
      if (cursorMsg) {
        where.createdAt = { lt: cursorMsg.createdAt };
      }
    }

    const messages = await prisma.privateMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const result = messages.slice(0, limit).reverse().map(m => ({
      id: m.id,
      chatId: m.chatId,
      senderId: m.senderId,
      msgType: m.msgType,
      content: m.isRevoked ? '消息已撤回' : m.content,
      replyToId: m.replyToId,
      isRevoked: m.isRevoked,
      status: m.status,
      extra: m.isRevoked ? undefined : parseExtra(m.extra),
      createdAt: m.createdAt.getTime(),
      // 阅后即焚字段
      ...(m.burnAfterRead ? {
        burnAfterRead: m.burnAfterRead,
        burnReadAt: m.burnReadAt?.getTime() || null,
      } : {}),
      // 消息防篡改 HMAC 签名
      ...(m.hmac ? { hmac: m.hmac } : {}),
    }));

    res.json({ messages: result, hasMore });
  } catch (err) {
    console.error('[PrivateChat] 拉取消息失败:', err);
    res.status(500).json({ error: '拉取消息失败' });
  }
});

/**
	 * POST /api/chat/:chatId/read
	 * 标记会话中对方发送的消息为已读
	 * Body: { messageIds?: string[] } (可选，不传则标记所有未读)
	 * Returns: { updated: number }
	 */
	router.post('/:chatId/read', async (req: Request, res: Response) => {
	  try {
	    const currentUser = (req as any).user;
	    const { chatId } = req.params;
	    const { messageIds } = req.body;

    // 严格一致性策略：进入会话置 0 未读并删除会话列表缓存
    await clearUnreadCount(currentUser.id, chatId);
    await invalidateConversationList(currentUser.id);

	    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) {
      return res.status(404).json({ error: '会话不存在' });
    }
    if (chat.participantA !== currentUser.id && chat.participantB !== currentUser.id) {
      return res.status(403).json({ error: '无权操作' });
    }

    const where: any = {
      chatId,
      senderId: { not: currentUser.id },
      status: { not: 'read' },
    };
    if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
      where.id = { in: messageIds };
    }

    const result = await prisma.privateMessage.updateMany({
      where,
      data: { status: 'read' },
    });

    res.json({ updated: result.count });
  } catch (err) {
    console.error('[PrivateChat] 标记已读失败:', err);
    res.status(500).json({ error: '标记已读失败' });
  }
});

/**
 * POST /api/chat/:chatId/recall/:messageId
 * 撤回消息（仅发送者可撤回，2分钟内）
 * Returns: { ok: true }
 */
router.post('/:chatId/recall/:messageId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    const { chatId, messageId } = req.params;

    const message = await prisma.privateMessage.findUnique({ where: { id: messageId } });
    if (!message || message.chatId !== chatId) {
      return res.status(404).json({ error: '消息不存在' });
    }
    if (message.senderId !== currentUser.id) {
      return res.status(403).json({ error: '只能撤回自己的消息' });
    }

    // 2分钟内可撤回
    const twoMinutes = 2 * 60 * 1000;
    if (Date.now() - message.createdAt.getTime() > twoMinutes) {
      return res.status(400).json({ error: '超过2分钟无法撤回' });
    }

    await prisma.privateMessage.update({
      where: { id: messageId },
      data: { isRevoked: true },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[PrivateChat] 撤回消息失败:', err);
    res.status(500).json({ error: '撤回消息失败' });
  }
});

export default router;
