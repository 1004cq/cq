/**
 * 万人群消息服务 — 高性能版
 *
 * 核心优化点：
 * 1. 批量落库：消息队列按批次 createMany + 单次 group.update，减少 DB round-trip
 * 2. 原子序列号：互斥锁保证 seq 递增无竞态
 * 3. 预序列化：同一条消息只 JSON.stringify 一次，万人推送零重复序列化
 * 4. 分片扇出：将在线成员分片，每片并行推送，总体 O(N/shardSize) 延迟
 * 5. 背压控制：检测 WebSocket bufferedAmount，丢弃慢消费者的积压消息
 * 6. 合并推送：高频消息在时间窗口内合并为 batch，减少 WebSocket 帧数
 * 7. 查询合并：pullGroupMessages 使用 $transaction 合并多次查询
 * 8. Session 缓存：减少认证中间件的 DB 查询
 */

import { WebSocket } from 'ws';
import prisma from './db';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { avatarToProxy } from './cos-signer.js';

// ESM 环境下兼容 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ 群头像存储助手（优先腾讯云 COS，失败兜底本地） ============
/**
 * 把群头像 buffer 持久化：优先上传到腾讯云 COS（imimchat/群头像/{groupId}/avatar_<ts>_<rand>.<ext>）,
 * 失败时回退到本地 data/media/。
 * 返回最终对外可访问的 URL（COS 直链或 /api/media/files/...）。
 */
async function persistGroupAvatar(groupId: string, buffer: Buffer, ext: string, mimeType: string): Promise<{ url: string; storage: 'cos' | 'local' }> {
  // 先尝试 COS
  try {
    const cfgRow = await prisma.systemConfig.findUnique({ where: { key: 'cos' } }).catch(() => null);
    const cosCfg: any = cfgRow?.value ? JSON.parse(cfgRow.value) : {};
    const secretId = cosCfg?.secretId || process.env.COS_SECRET_ID;
    const secretKey = cosCfg?.secretKey || process.env.COS_SECRET_KEY;
    const bucket = cosCfg?.bucket || process.env.COS_BUCKET;
    const region = cosCfg?.region || process.env.COS_REGION || 'ap-guangzhou';
    const enabled = cosCfg?.enabled !== false;
    if (enabled && secretId && secretKey && bucket && region) {
      const COSModule: any = await import('cos-nodejs-sdk-v5');
      const COS = COSModule.default || COSModule;
      const cos = new COS({ SecretId: secretId, SecretKey: secretKey });
      const cleanExt = String(ext || '.jpg').replace(/^\./, '').toLowerCase() || 'jpg';
      const fileName = `avatar_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${cleanExt}`;
      // 优先使用群 username（如设置了）作为目录名，否则回退 groupId
      let groupDir = groupId;
      try {
        const g = await prisma.group.findUnique({ where: { id: groupId }, select: { username: true } });
        if (g?.username) groupDir = g.username;
      } catch {}
      // ASCII 路径，避免中文 → EdgeOne raw UTF-8 → Node 400
      const cosKey = `imimchat/group-avatars/${groupDir}/${fileName}`;
      await new Promise<void>((resolve, reject) => {
        cos.putObject({ Bucket: bucket, Region: region, Key: cosKey, Body: buffer, ContentType: mimeType }, (err: any) => {
          if (err) reject(err); else resolve();
        });
      });
      const customDomain = cosCfg?.domain || process.env.COS_DOMAIN;
      const baseUrl = customDomain ? String(customDomain).replace(/\/$/, '') : `https://${bucket}.cos.${region}.myqcloud.com`;
      const url = `${baseUrl}/${cosKey}`;
      console.log(`[Group] 群头像已上传到 COS: ${cosKey} (${buffer.length} bytes)`);
      return { url, storage: 'cos' };
    }
  } catch (cosErr: any) {
    console.error('[Group] 群头像 COS 上传失败，回退本地:', cosErr?.message || cosErr);
  }
  // 兜底：本地
  const MEDIA_DIR = path.resolve(__dirname, '..', 'data', 'media');
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const localExt = String(ext || '.jpg').startsWith('.') ? String(ext).toLowerCase() : `.${String(ext).toLowerCase()}`;
  const fileName = `group_avatar_${groupId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${localExt}`;
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), buffer);
  console.log(`[Group] 群头像已写入本地: ${fileName} (${buffer.length} bytes)`);
  return { url: `/api/media/files/${fileName}`, storage: 'local' };
}

// ============ 类型定义 ============

export interface GroupMessagePayload {
  groupId: string;
  senderId: string;
  senderName?: string;
  senderAvatar?: string;
  msgType?: string;
  content: string;
  replyToId?: string;
  extra?: Record<string, any>;
}

export interface PushMessage {
  type: 'group_message';
  groupId: string;
  seq: number;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  msgType: string;
  content: string;
  replyToId?: string;
  extra?: Record<string, any>;
  timestamp: number;
}

export interface AckPayload {
  groupId: string;
  userId: string;
  lastAckSeq: number;
}

export interface PullPayload {
  groupId: string;
  userId: string;
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
}

// ============ 配置常量（可通过环境变量覆盖） ============

/** 万人群扇出并发上限（每个群同时推送的 Worker 数） */
const LARGE_GROUP_CONCURRENCY = parseInt(process.env.LARGE_GROUP_CONCURRENCY || '50');

/** 小群扇出并发上限 */
const SMALL_GROUP_CONCURRENCY = parseInt(process.env.SMALL_GROUP_CONCURRENCY || '200');

/** 大群阈值（成员数超过此值视为大群） */
const LARGE_GROUP_THRESHOLD = parseInt(process.env.LARGE_GROUP_THRESHOLD || '500');

/** 消息合并窗口（ms）：高频消息在此窗口内合并推送 */
const MERGE_WINDOW_MS = parseInt(process.env.MERGE_WINDOW_MS || '80');

/** 合并推送最大消息数 */
const MERGE_MAX_BATCH = parseInt(process.env.MERGE_MAX_BATCH || '20');

/** 异步队列最大积压 */
const QUEUE_MAX_SIZE = parseInt(process.env.QUEUE_MAX_SIZE || '100000');

/** 批量落库批次大小 */
const DB_BATCH_SIZE = parseInt(process.env.DB_BATCH_SIZE || '100');

/** 批量落库最大等待时间（ms）：即使未满批次也强制刷盘 */
const DB_FLUSH_INTERVAL_MS = parseInt(process.env.DB_FLUSH_INTERVAL_MS || '50');

/** WebSocket 背压阈值（字节）：超过此值跳过推送 */
const WS_BACKPRESSURE_THRESHOLD = parseInt(process.env.WS_BACKPRESSURE_THRESHOLD || '65536');

/** 扇出分片大小：每片包含的用户数 */
const FANOUT_SHARD_SIZE = parseInt(process.env.FANOUT_SHARD_SIZE || '200');

// ============ 序列号生成器（原子互斥） ============

const seqCounters = new Map<string, bigint>();
const seqLocks = new Map<string, Promise<void>>();

/**
 * 原子递增序列号生成器
 * 使用 Promise 链实现互斥锁，保证同一群内 seq 严格递增
 */
async function getNextSeq(groupId: string): Promise<bigint> {
  // 等待当前锁释放
  const currentLock = seqLocks.get(groupId);
  let releaseLock: () => void;
  const newLock = new Promise<void>(resolve => { releaseLock = resolve; });
  seqLocks.set(groupId, newLock);

  if (currentLock) await currentLock;

  try {
    let current = seqCounters.get(groupId);
    if (current === undefined) {
      // 冷启动：从数据库加载当前最大 seq（使用 select 最小化数据传输）
      const group = await prisma.group.findUnique({
        where: { id: groupId },
        select: { lastMsgSeq: true },
      });
      current = group?.lastMsgSeq ?? BigInt(0);
    }
    const next = current + BigInt(1);
    seqCounters.set(groupId, next);
    return next;
  } finally {
    releaseLock!();
  }
}

/**
 * 批量获取连续序列号（用于批量消息场景）
 */
async function getNextSeqBatch(groupId: string, count: number): Promise<bigint[]> {
  const currentLock = seqLocks.get(groupId);
  let releaseLock: () => void;
  const newLock = new Promise<void>(resolve => { releaseLock = resolve; });
  seqLocks.set(groupId, newLock);

  if (currentLock) await currentLock;

  try {
    let current = seqCounters.get(groupId);
    if (current === undefined) {
      const group = await prisma.group.findUnique({
        where: { id: groupId },
        select: { lastMsgSeq: true },
      });
      current = group?.lastMsgSeq ?? BigInt(0);
    }
    const seqs: bigint[] = [];
    for (let i = 0; i < count; i++) {
      current = current + BigInt(1);
      seqs.push(current);
    }
    seqCounters.set(groupId, current);
    return seqs;
  } finally {
    releaseLock!();
  }
}

// ============ 在线用户连接管理 ============

/** Gateway 本地连接池：userId -> WebSocket */
const onlineConnections = new Map<string, WebSocket>();

/** 群在线成员缓存：groupId -> Set<userId> */
const groupOnlineMembers = new Map<string, Set<string>>();

export function registerConnection(userId: string, ws: WebSocket) {
  onlineConnections.set(userId, ws);
}

export function unregisterConnection(userId: string) {
  onlineConnections.delete(userId);
  // 从所有群在线列表中移除
  for (const [, members] of groupOnlineMembers) {
    members.delete(userId);
  }
}

export function joinGroupOnline(groupId: string, userId: string) {
  if (!groupOnlineMembers.has(groupId)) {
    groupOnlineMembers.set(groupId, new Set());
  }
  groupOnlineMembers.get(groupId)!.add(userId);
}

export function leaveGroupOnline(groupId: string, userId: string) {
  groupOnlineMembers.get(groupId)?.delete(userId);
}

/** 获取群在线成员列表（用于 MLS 信令广播） */
export function getGroupOnlineMembers(groupId: string): Set<string> | undefined {
  return groupOnlineMembers.get(groupId);
}

// ============ 批量落库消息队列 ============

interface QueueItem {
  payload: GroupMessagePayload;
  seq: bigint;
  timestamp: number;
  resolve: (msg: PushMessage) => void;
  reject: (err: Error) => void;
}

/**
 * 高性能消息队列 - 批量落库版
 *
 * 核心改进：
 * - 按 groupId 分桶，同一群的消息使用 createMany 批量写入
 * - 定时器 + 容量双触发：满批次立即刷盘，未满批次定时刷盘
 * - 单次 group.update 更新 lastMsgSeq（取批次内最大 seq）
 */
class BatchMessageQueue {
  private buckets = new Map<string, QueueItem[]>();
  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private totalSize = 0;

  enqueue(item: QueueItem) {
    if (this.totalSize >= QUEUE_MAX_SIZE) {
      item.reject(new Error('消息队列已满，请稍后重试'));
      return;
    }

    const groupId = item.payload.groupId;
    if (!this.buckets.has(groupId)) {
      this.buckets.set(groupId, []);
    }
    this.buckets.get(groupId)!.push(item);
    this.totalSize++;

    // 满批次立即刷盘
    if (this.buckets.get(groupId)!.length >= DB_BATCH_SIZE) {
      this.flushGroup(groupId);
    } else if (!this.flushTimers.has(groupId)) {
      // 设置定时刷盘（保证低频消息也能及时落库）
      const timer = setTimeout(() => {
        void this.flushGroup(groupId);
      }, DB_FLUSH_INTERVAL_MS);
      timer.unref?.();
      this.flushTimers.set(groupId, timer);
    }
  }

  private async flushGroup(groupId: string) {
    // 清除定时器
    const timer = this.flushTimers.get(groupId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(groupId);
    }

    // 取出当前批次
    const batch = this.buckets.get(groupId) || [];
    if (batch.length === 0) return;
    this.buckets.set(groupId, []);
    this.totalSize -= batch.length;

    try {
      // 批量落库：使用 $transaction 保证原子性
      const maxSeq = batch[batch.length - 1].seq;
      const maxTimestamp = batch[batch.length - 1].timestamp;

      await prisma.$transaction([
        // 批量创建消息：强制 MLS 检查，拒绝明文业务消息
        prisma.groupMessage.createMany({
          data: batch.map(item => {
            const mType = item.payload.msgType || 'mls_encrypted';
            if (mType !== 'mls_encrypted' && mType !== 'system') {
              throw new Error('群聊强制要求 MLS 加密，拒绝写入明文业务消息');
            }
            return {
              groupId: item.payload.groupId,
              seq: item.seq,
              senderId: item.payload.senderId,
              senderName: item.payload.senderName || item.payload.senderId,
              msgType: mType,
              content: item.payload.content,
              replyToId: item.payload.replyToId,
              extra: item.payload.extra ? JSON.stringify(item.payload.extra) : null,
            };
          }),
        }),
        // 单次更新群最新序列号
        prisma.group.update({
          where: { id: groupId },
          data: { lastMsgSeq: maxSeq, lastMsgTime: new Date(maxTimestamp) },
        }),
      ]);

      // 全部成功，resolve 所有 Promise
      for (const item of batch) {
        const pushMsg: PushMessage = {
          type: 'group_message',
          groupId: item.payload.groupId,
          seq: Number(item.seq),
          senderId: item.payload.senderId,
          senderName: item.payload.senderName || item.payload.senderId,
          senderAvatar: item.payload.senderAvatar,
          msgType: item.payload.msgType || 'text',
          content: item.payload.content,
          replyToId: item.payload.replyToId,
          extra: item.payload.extra,
          timestamp: item.timestamp,
        };
        item.resolve(pushMsg);
      }
    } catch (err) {
      // 批量失败，逐条重试
      console.error(`[GroupMsg] 批量落库失败(${batch.length}条), groupId=${groupId}, 降级逐条重试`, err);
      for (const item of batch) {
        try {
          const mType = item.payload.msgType || 'mls_encrypted';
          if (mType !== 'mls_encrypted' && mType !== 'system') {
            throw new Error('群聊强制要求 MLS 加密，拒绝写入明文业务消息');
          }
          await prisma.groupMessage.create({
            data: {
              groupId: item.payload.groupId,
              seq: item.seq,
              senderId: item.payload.senderId,
              senderName: item.payload.senderName || item.payload.senderId,
              msgType: mType,
              content: item.payload.content,
              replyToId: item.payload.replyToId,
              extra: item.payload.extra ? JSON.stringify(item.payload.extra) : null,
            },
          });
          await prisma.group.update({
            where: { id: groupId },
            data: { lastMsgSeq: item.seq, lastMsgTime: new Date(item.timestamp) },
          });
          const pushMsg: PushMessage = {
            type: 'group_message',
            groupId: item.payload.groupId,
            seq: Number(item.seq),
            senderId: item.payload.senderId,
            senderName: item.payload.senderName || item.payload.senderId,
            senderAvatar: item.payload.senderAvatar,
            msgType: item.payload.msgType || 'text',
            content: item.payload.content,
            replyToId: item.payload.replyToId,
            extra: item.payload.extra,
            timestamp: item.timestamp,
          };
          item.resolve(pushMsg);
        } catch (retryErr) {
          item.reject(retryErr as Error);
        }
      }
    }
  }
}

const messageQueue = new BatchMessageQueue();

// ============ 并发控制扇出器 ============

interface FanoutTask {
  task: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

class FanoutWorker {
  private concurrency: number;
  private running = 0;
  private queue: FanoutTask[] = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  push(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const item: FanoutTask = { task, resolve, reject };
      if (this.running < this.concurrency) {
        void this.run(item);
      } else {
        this.queue.push(item);
      }
    });
  }

  private async run(item: FanoutTask) {
    this.running++;
    try {
      await item.task();
      item.resolve();
    } catch (error) {
      item.reject(error);
    } finally {
      this.running--;
      this.drain();
    }
  }

  private drain() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      void this.run(item);
    }
  }
}

/** 群维度扇出 Worker 池 */
const groupFanoutWorkers = new Map<string, FanoutWorker>();

function getFanoutWorker(groupId: string, memberCount: number): FanoutWorker {
  if (!groupFanoutWorkers.has(groupId)) {
    const concurrency = memberCount > LARGE_GROUP_THRESHOLD
      ? LARGE_GROUP_CONCURRENCY
      : SMALL_GROUP_CONCURRENCY;
    groupFanoutWorkers.set(groupId, new FanoutWorker(concurrency));
  }
  return groupFanoutWorkers.get(groupId)!;
}

// ============ 高频消息合并推送（带背压控制） ============

interface MergeBuffer {
  messages: PushMessage[];
  serialized: string[];  // 预序列化缓存
  timer: ReturnType<typeof setTimeout> | null;
}

const mergeBuffers = new Map<string, MergeBuffer>(); // key: `${groupId}:${userId}`

/**
 * 推送消息给单个用户（带背压检测 + 合并窗口）
 * @param userId 目标用户
 * @param msg 推送消息对象
 * @param serializedMsg 预序列化的 JSON 字符串（避免重复 stringify）
 */
function pushToUser(userId: string, msg: PushMessage, serializedMsg: string) {
  const ws = onlineConnections.get(userId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // 背压检测：如果 WebSocket 发送缓冲区积压过多，跳过推送
  // 客户端可通过 pull 机制补偿丢失的消息
  if (ws.bufferedAmount > WS_BACKPRESSURE_THRESHOLD) {
    return;
  }

  const bufferKey = `${msg.groupId}:${userId}`;
  let buffer = mergeBuffers.get(bufferKey);

  if (!buffer) {
    buffer = { messages: [], serialized: [], timer: null };
    mergeBuffers.set(bufferKey, buffer);
  }

  buffer.messages.push(msg);
  buffer.serialized.push(serializedMsg);

  // 达到合并上限，立即发送
  if (buffer.messages.length >= MERGE_MAX_BATCH) {
    flushMergeBuffer(userId, bufferKey, buffer);
    return;
  }

  // 设置合并窗口定时器
  if (!buffer.timer) {
    buffer.timer = setTimeout(() => {
      flushMergeBuffer(userId, bufferKey, buffer!);
    }, MERGE_WINDOW_MS);
    buffer.timer.unref?.();
  }
}

function flushMergeBuffer(userId: string, bufferKey: string, buffer: MergeBuffer) {
  if (buffer.timer) {
    clearTimeout(buffer.timer);
    buffer.timer = null;
  }

  const ws = onlineConnections.get(userId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    buffer.messages = [];
    buffer.serialized = [];
    mergeBuffers.delete(bufferKey);
    return;
  }

  // 背压二次检测
  if (ws.bufferedAmount > WS_BACKPRESSURE_THRESHOLD) {
    buffer.messages = [];
    buffer.serialized = [];
    mergeBuffers.delete(bufferKey);
    return;
  }

  if (buffer.messages.length === 1) {
    // 单条直接发送（使用预序列化字符串）
    ws.send(buffer.serialized[0]);
  } else if (buffer.messages.length > 1) {
    // 批量合并发送
    ws.send(JSON.stringify({
      type: 'group_message_batch',
      groupId: buffer.messages[0].groupId,
      messages: buffer.messages,
      count: buffer.messages.length,
    }));
  }

  buffer.messages = [];
  buffer.serialized = [];
  mergeBuffers.delete(bufferKey);
}

// ============ 核心 API ============

/**
 * 发送群消息（快速路径）
 * 1. 生成 seq → 2. 写入异步队列 → 3. 立即返回 ACK → 4. 异步落库 + 推送
 *
 * 优化：发送方 <50ms 内收到 ACK，消息落库和扇出完全异步
 */
export async function sendGroupMessage(payload: GroupMessagePayload): Promise<{
  seq: number;
  timestamp: number;
  messageId?: string;
}> {
  const seq = await getNextSeq(payload.groupId);
  const timestamp = Date.now();

  // 异步落库 + 推送（不阻塞发送方）
  const pushPromise = new Promise<PushMessage>((resolve, reject) => {
    messageQueue.enqueue({ payload, seq, timestamp, resolve, reject });
  });

  // 异步扇出推送（不等待完成）
  pushPromise.then(async (pushMsg) => {
    await fanoutToGroup(payload.groupId, pushMsg, payload.senderId);
  }).catch(err => {
    console.error(`[GroupMsg] 异步落库/推送失败: groupId=${payload.groupId} seq=${seq}`, err);
  });

  // 立即返回 ACK（快速路径，<50ms）
  return { seq: Number(seq), timestamp };
}

/**
 * 分片扇出：推送消息给群在线成员
 *
 * 优化点：
 * 1. 预序列化：消息只 JSON.stringify 一次，万人群节省 ~9999 次序列化
 * 2. 分片并行：将在线成员按 FANOUT_SHARD_SIZE 分片，每片内并行推送
 * 3. 背压控制：pushToUser 内部检测 bufferedAmount
 */
async function fanoutToGroup(groupId: string, msg: PushMessage, excludeUserId?: string) {
  const onlineMembers = groupOnlineMembers.get(groupId);
  if (!onlineMembers || onlineMembers.size === 0) return;

  const memberCount = onlineMembers.size;
  const worker = getFanoutWorker(groupId, memberCount);

  // ★ 预序列化：同一条消息只 stringify 一次
  const serializedMsg = JSON.stringify(msg);

  // 将在线成员转为数组并过滤发送者
  const targetMembers = Array.from(onlineMembers).filter(uid => uid !== excludeUserId);

  if (targetMembers.length === 0) return;

  // ★ 分片推送：将成员列表按 FANOUT_SHARD_SIZE 分片
  const shards: string[][] = [];
  for (let i = 0; i < targetMembers.length; i += FANOUT_SHARD_SIZE) {
    shards.push(targetMembers.slice(i, i + FANOUT_SHARD_SIZE));
  }

  // 每个分片作为一个任务提交给 FanoutWorker
  await Promise.all(
    shards.map(shard => worker.push(async () => {
      for (const userId of shard) {
        pushToUser(userId, msg, serializedMsg);
      }
    }))
  );

  if (memberCount > 100) {
    console.log(`[GroupMsg] 扇出完成: groupId=${groupId} online=${memberCount} pushed=${targetMembers.length} shards=${shards.length}`);
  }
}

/**
 * 拉取群历史消息（读扩散核心）
 *
 * 优化点：
 * 1. 使用 $transaction 合并 member 校验 + 消息查询 + 群信息查询为单次 DB 调用
 * 2. 利用覆盖索引 [groupId, seq, createdAt] 加速范围查询
 */
export async function pullGroupMessages(params: PullPayload): Promise<{
  messages: Array<{
    id: string;
    seq: number;
    senderId: string;
    senderName: string;
    msgType: string;
    content: string;
    replyToId?: string;
    extra?: any;
    createdAt: string;
    isRevoked: boolean;
  }>;
  hasMore: boolean;
  latestSeq: number;
}> {
  const { groupId, userId, afterSeq, beforeSeq, limit = 50 } = params;
  const mode = beforeSeq !== undefined
    ? 'before'
    : afterSeq !== undefined
      ? 'after'
      : 'latest';

  const { member, messages, latestSeq } = await prisma.$transaction(async tx => {
    const [member, group] = await Promise.all([
      tx.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { joinTime: true, lastAckSeq: true },
      }),
      tx.group.findUnique({
        where: { id: groupId },
        select: { lastMsgSeq: true },
      }),
    ]);

    if (!member) {
      throw new Error('非群成员，无权拉取消息');
    }

    const where: {
      groupId: string;
      seq?: { gt?: bigint; lt?: bigint };
    } = { groupId };

    let orderBy: { seq: 'asc' | 'desc' } = { seq: 'asc' };

    if (mode === 'before' && beforeSeq !== undefined) {
      where.seq = { lt: BigInt(beforeSeq) };
      orderBy = { seq: 'desc' };
    } else if (mode === 'after') {
      where.seq = { gt: BigInt(afterSeq ?? 0) };
    } else {
      orderBy = { seq: 'desc' };
    }

    const messages = await tx.groupMessage.findMany({
      where,
      orderBy,
      take: limit + 1,
    });

    return {
      member,
      messages,
      latestSeq: Number(group?.lastMsgSeq ?? 0),
    };
  });

  // 在应用层过滤加入时间之前的消息，避免新成员读到入群前历史
  const filteredMessages = messages.filter(m => m.createdAt >= member.joinTime);
  const hasMore = filteredMessages.length > limit;
  let result = filteredMessages.slice(0, limit);

  if (mode === 'before' || mode === 'latest') {
    result = [...result].reverse();
  }

  // 批量查询发送者的头像和昵称
  const senderIds = [...new Set(result.map(m => m.senderId))];
  const senderUsers = await prisma.user.findMany({
    where: { id: { in: senderIds } },
    select: { id: true, nickname: true, username: true, avatar: true },
  });
  const senderMap = new Map(senderUsers.map(u => [u.id, u]));

  return {
    messages: result.map(m => {
      const sender = senderMap.get(m.senderId);
      return {
        id: m.id,
        seq: Number(m.seq),
        senderId: m.senderId,
        senderName: m.senderName || sender?.nickname || sender?.username || m.senderId,
        senderAvatar: avatarToProxy(sender?.avatar),
        msgType: m.msgType,
        content: m.content,
        replyToId: m.replyToId || undefined,
        extra: m.extra ? JSON.parse(m.extra) : undefined,
        createdAt: m.createdAt.toISOString(),
        isRevoked: m.isRevoked,
      };
    }),
    hasMore,
    latestSeq,
  };
}

/**
 * 确认已读（更新游标）
 *
 * 优化点：
 * 1. 使用 $transaction 合并 update + findUnique 为单次 DB 调用
 * 2. 基于 seq 差值计算未读数，无需额外 count 查询
 */
export async function ackGroupMessages(params: AckPayload): Promise<{ unread: number }> {
  const { groupId, userId, lastAckSeq } = params;

  // ★ 合并查询：update + 获取群最新 seq
  const [, group] = await prisma.$transaction([
    prisma.groupMember.updateMany({
      where: { groupId, userId },
      data: { lastAckSeq: BigInt(lastAckSeq) },
    }),
    prisma.group.findUnique({
      where: { id: groupId },
      select: { lastMsgSeq: true },
    }),
  ]);

  const unread = Math.max(0, Number((group?.lastMsgSeq ?? BigInt(0)) - BigInt(lastAckSeq)));
  return { unread };
}

/**
 * 获取群未读数（批量）
 *
 * 优化点：使用单次查询 + include 获取所有群的 lastMsgSeq
 */
export async function getGroupUnreadCounts(userId: string): Promise<Record<string, number>> {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true, lastAckSeq: true, group: { select: { lastMsgSeq: true } } },
  });

  const result: Record<string, number> = {};
  for (const m of memberships) {
    const unread = Number(m.group.lastMsgSeq - m.lastAckSeq);
    if (unread > 0) {
      result[m.groupId] = unread;
    }
  }
  return result;
}

/**
 * 获取用户加入的群聊列表
 */
export async function getUserGroups(userId: string) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: {
      group: {
        select: {
          id: true,
          dialogId: true,
          name: true,
          username: true,
          avatar: true,
          ownerId: true,
          type: true,
          isPublic: true,
          memberCount: true,
          lastMsgSeq: true,
          updatedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return memberships.map((membership) => {
    const unread = Math.max(0, Number(membership.group.lastMsgSeq - membership.lastAckSeq));
    return {
      id: membership.group.id,
      groupId: membership.group.id,
      dialogId: membership.group.dialogId || null,
      name: membership.group.name,
      username: membership.group.username || null,
      avatar: avatarToProxy(membership.group.avatar),
      ownerId: membership.group.ownerId,
      type: membership.group.type,
      isPublic: membership.group.isPublic || false,
      memberCount: membership.group.memberCount,
      lastMessage: '🔒 [加密消息]',
      unreadCount: unread,
      createdAt: membership.group.createdAt.getTime(),
      updatedAt: membership.group.updatedAt.getTime(),
    };
  });
}

// ============ 群管理 API ============

/**
 * 创建群组（生成 TG 风格 Dialog ID）
 */
export async function createGroup(params: {
  name: string;
  ownerId: string;
  memberIds: string[];
  type?: string;
  maxMembers?: number;
  username?: string;
  isPublic?: boolean;
}): Promise<{ groupId: string; dialogId: string }> {
  const { name, ownerId, memberIds, type = 'normal', maxMembers = 500, username, isPublic = false } = params;

  // 生成 TG 风格 Dialog ID
  const { generateGroupDialogId, dialogIdToString } = await import('./utils/peerId.js');
  const isSupergroup = type === 'super' || type === 'channel' || maxMembers > 200;
  const groupDialogId = generateGroupDialogId(isSupergroup);
  const dialogIdStr = dialogIdToString(groupDialogId);

  // Channel 保留 channel 类型，不转为 super；supergroup 仍转为 super
  const resolvedType = type === 'channel' ? 'channel' : (isSupergroup ? 'super' : type);
  const resolvedMaxMembers = type === 'channel' ? 0 : maxMembers;

  const group = await prisma.group.create({
    data: {
      name,
      dialogId: dialogIdStr,
      username: username || null,
      ownerId,
      type: resolvedType,
      isPublic,
      maxMembers: resolvedMaxMembers,
      memberCount: memberIds.length + 1,
      members: {
        create: [
          { userId: ownerId, role: 'owner' },
          ...memberIds.filter(id => id !== ownerId).map(userId => ({
            userId,
            role: 'member' as const,
          })),
        ],
      },
    },
  });

  // 初始化在线成员缓存
  groupOnlineMembers.set(group.id, new Set());

  console.log(`[GroupMsg] 群组已创建: id=${group.id} dialogId=${dialogIdStr} name=${name} type=${isSupergroup ? 'super' : type} members=${memberIds.length + 1}`);
  return { groupId: group.id, dialogId: dialogIdStr };
}

/**
 * 加入群组
 */
export async function joinGroup(groupId: string, userId: string, nickname?: string): Promise<void> {
  // 入群时将 lastAckSeq 初始化为当前群最新 seq，避免新成员把历史消息全部算作未读
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { lastMsgSeq: true, type: true },
  });

  if (!group) {
    throw new Error('群组不存在');
  }

  const isChannel = group.type === 'channel';

  await prisma.$transaction(async tx => {
    await tx.groupMember.create({
      data: {
        groupId,
        userId,
        nickname,
        lastAckSeq: group.lastMsgSeq,
      },
    });

    await tx.group.update({
      where: { id: groupId },
      data: { memberCount: { increment: 1 } },
    });
  });

  // 发送系统消息（异步，不阻塞加入流程）
  // 频道不发送"加入了群聊"消息，保持频道消息流干净
  if (!isChannel) {
    sendGroupMessage({
      groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: `${nickname || userId} 加入了群聊`,
    }).catch(err => {
      console.error(`[GroupMsg] 发送入群系统消息失败:`, err);
    });
  }
}

/**
 * 获取群信息
 * 注意：将 BigInt 字段转换为字符串，避免 JSON.stringify 报错
 */
export async function getGroupInfo(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      _count: { select: { members: true } },
    },
  });
  if (!group) return null;
  // 将 BigInt 字段转为字符串，避免 JSON 序列化失败
  return {
    ...group,
    lastMsgSeq: group.lastMsgSeq?.toString() ?? '0',
    memberCount: group._count?.members ?? group.memberCount,
  };
}

/**
 * 获取群成员列表（分页）
 */
export async function getGroupMembers(groupId: string, page = 1, pageSize = 100) {
  const [rawMembers, total] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId },
      orderBy: [{ role: 'asc' }, { joinTime: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.groupMember.count({ where: { groupId } }),
  ]);

  // 批量查询用户信息（昵称、头像）
  const userIds = rawMembers.map(m => m.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, nickname: true, username: true, avatar: true },
  });
  const userMap = new Map(users.map(u => [u.id, u]));

  const members = rawMembers.map(m => {
    const user = userMap.get(m.userId);
    return {
      ...m,
      // BigInt 字段转字符串，避免 JSON 序列化失败
      lastAckSeq: m.lastAckSeq?.toString() ?? '0',
      name: m.nickname || user?.nickname || user?.username || m.userId,
      avatar: avatarToProxy(user?.avatar),
    };
  });

  return { members, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

// ============ Express 路由注册 ============

import { Router } from 'express';

const groupRouter = Router();

// 发送群消息
groupRouter.post('/send', async (req, res) => {
  try {
    const { groupId, senderId, senderName, msgType, content, replyToId, extra } = req.body;
    if (!groupId || !senderId || !content) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const result = await sendGroupMessage({ groupId, senderId, senderName, msgType, content, replyToId, extra });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 拉取群历史消息
groupRouter.get('/messages', async (req, res) => {
  try {
    const { groupId, userId, afterSeq, beforeSeq, limit } = req.query as Record<string, string>;
    if (!groupId || !userId) {
      return res.status(400).json({ error: '缺少 groupId 或 userId' });
    }
    const result = await pullGroupMessages({
      groupId,
      userId,
      afterSeq: afterSeq ? parseInt(afterSeq) : undefined,
      beforeSeq: beforeSeq ? parseInt(beforeSeq) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.message.includes('非群成员') ? 403 : 500).json({ error: err.message });
  }
});

// 确认已读
groupRouter.post('/ack', async (req, res) => {
  try {
    const { groupId, userId, lastAckSeq } = req.body;
    if (!groupId || !userId || lastAckSeq === undefined) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const result = await ackGroupMessages({ groupId, userId, lastAckSeq });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 获取未读数
groupRouter.get('/unread', async (req, res) => {
  try {
    const { userId } = req.query as { userId: string };
    if (!userId) return res.status(400).json({ error: '缺少 userId' });
    const result = await getGroupUnreadCounts(userId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 创建群组（支持 TG 风格参数）
groupRouter.post('/create', async (req, res) => {
  try {
    const { name, ownerId, memberIds, type, maxMembers, username, isPublic } = req.body;
    if (!name || !ownerId) return res.status(400).json({ error: '缺少必要参数' });
    // 验证 username 格式（类似 TG @username 规则）
    if (username) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) {
        return res.status(400).json({ error: '群组用户名必须以字母开头，5-32位字母数字下划线' });
      }
      // 检查 username 是否已被占用（用户或群组）
      const [existUser, existGroup] = await Promise.all([
        prisma.user.findUnique({ where: { username }, select: { id: true } }),
        prisma.group.findUnique({ where: { username }, select: { id: true } }),
      ]);
      if (existUser || existGroup) {
        return res.status(409).json({ error: '该用户名已被占用' });
      }
    }
    const result = await createGroup({ name, ownerId, memberIds: memberIds || [], type, maxMembers, username, isPublic });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 获取我的群聊列表
groupRouter.get('/list', async (req, res) => {
  try {
    const { userId } = req.query as { userId: string };
    if (!userId) return res.status(400).json({ error: '缺少 userId' });
    const groups = await getUserGroups(userId);
    res.json({ groups });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 获取群信息
groupRouter.get('/info', async (req, res) => {
  try {
    const { groupId } = req.query as { groupId: string };
    if (!groupId) return res.status(400).json({ error: '缺少 groupId' });
    const info = await getGroupInfo(groupId);
    if (!info) return res.status(404).json({ error: '群组不存在' });
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 获取群成员列表
groupRouter.get('/members', async (req, res) => {
  try {
    const { groupId, page, pageSize } = req.query as Record<string, string>;
    if (!groupId) return res.status(400).json({ error: '缺少 groupId' });
    const result = await getGroupMembers(groupId, page ? parseInt(page) : 1, pageSize ? parseInt(pageSize) : 100);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 加入群组
groupRouter.post('/join', async (req, res) => {
  try {
    const { groupId, userId, nickname } = req.body;
    if (!groupId || !userId) return res.status(400).json({ error: '缺少必要参数' });
    await joinGroup(groupId, userId, nickname);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 搜索群组（支持 dialogId、username、名称搜索）
groupRouter.get('/search', async (req, res) => {
  try {
    const { q } = req.query as { q: string };
    if (!q || q.trim().length < 1) return res.status(400).json({ error: '请输入至少1个字符' });
    const keyword = q.trim();
    const groups = await prisma.group.findMany({
      where: {
        OR: [
          { id: keyword },
          { dialogId: keyword },
          { username: keyword },
          { name: { contains: keyword } },
        ],
      },
      select: { id: true, dialogId: true, username: true, name: true, avatar: true, memberCount: true, type: true, isPublic: true },
      take: 10,
    });
    res.json({
      groups: groups.map(g => ({
        id: g.id,
        dialogId: g.dialogId || null,
        username: g.username || null,
        name: g.name,
        avatar: avatarToProxy(g.avatar),
        memberCount: g.memberCount,
        type: g.type,
        isPublic: g.isPublic || false,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: '搜索失败' });
  }
});

// ============ TG 风格邀请链接 API ============

// 创建邀请链接
groupRouter.post('/invite/create', async (req, res) => {
  try {
    const { groupId, creatorId, name, expireHours, expireAt, maxUses } = req.body;
    if (!groupId || !creatorId) return res.status(400).json({ error: '缺少必要参数' });

    // 验证创建者是群成员且有权限
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: creatorId } },
      select: { role: true },
    });
    if (!member) return res.status(403).json({ error: '非群成员' });
    if (member.role === 'member') return res.status(403).json({ error: '仅管理员和群主可创建邀请链接' });

    const normalizedMaxUses = Number(maxUses || 0);
    if (!Number.isFinite(normalizedMaxUses) || normalizedMaxUses < 0) {
      return res.status(400).json({ error: '使用次数限制无效' });
    }

    let resolvedExpireAt: Date | null = null;
    if (expireAt) {
      resolvedExpireAt = new Date(expireAt);
      if (Number.isNaN(resolvedExpireAt.getTime())) {
        return res.status(400).json({ error: '失效时间无效' });
      }
    } else if (expireHours) {
      const hours = Number(expireHours);
      if (!Number.isFinite(hours) || hours <= 0) {
        return res.status(400).json({ error: '有效时长无效' });
      }
      resolvedExpireAt = new Date(Date.now() + hours * 3600 * 1000);
    }

    if (resolvedExpireAt && resolvedExpireAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: '失效时间必须晚于当前时间' });
    }

    const { generateInviteHash } = await import('./utils/peerId.js');
    const hash = generateInviteHash();

    const link = await prisma.inviteLink.create({
      data: {
        hash,
        groupId,
        creatorId,
        name: name || null,
        expireAt: resolvedExpireAt,
        maxUses: normalizedMaxUses,
      },
    });

    res.json({
      ok: true,
      inviteLink: {
        id: link.id,
        hash: link.hash,
        url: `/im/+${link.hash}`,
        fullUrl: `https://wed.imim.chat/im/+${link.hash}`,
        name: link.name,
        expireAt: link.expireAt?.toISOString() || null,
        maxUses: link.maxUses,
        usedCount: link.usedCount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 获取群的邀请链接列表
groupRouter.get('/invite/list', async (req, res) => {
  try {
    const { groupId } = req.query as { groupId: string };
    if (!groupId) return res.status(400).json({ error: '缺少 groupId' });

    const links = await prisma.inviteLink.findMany({
      where: { groupId, isRevoked: false },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      links: links.map(l => {
        const expiredByTime = l.expireAt ? new Date() > l.expireAt : false;
        const expiredByUses = l.maxUses > 0 && l.usedCount >= l.maxUses;
        return {
          id: l.id,
          hash: l.hash,
          url: `/im/+${l.hash}`,
          fullUrl: `https://wed.imim.chat/im/+${l.hash}`,
          name: l.name,
          creatorId: l.creatorId,
          expireAt: l.expireAt?.toISOString() || null,
          maxUses: l.maxUses,
          usedCount: l.usedCount,
          remainingUses: l.maxUses > 0 ? Math.max(0, l.maxUses - l.usedCount) : null,
          isExpired: expiredByTime || expiredByUses,
          createdAt: l.createdAt.toISOString(),
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 撤销邀请链接
groupRouter.post('/invite/revoke', async (req, res) => {
  try {
    const { hash, creatorId } = req.body;
    if (!hash || !creatorId) return res.status(400).json({ error: '缺少必要参数' });

    const link = await prisma.inviteLink.findUnique({ where: { hash } });
    if (!link) return res.status(404).json({ error: '邀请链接不存在' });
    if (link.creatorId !== creatorId) {
      // 检查是否为群主
      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: link.groupId, userId: creatorId } },
        select: { role: true },
      });
      if (!member || member.role !== 'owner') {
        return res.status(403).json({ error: '无权撤销此链接' });
      }
    }

    await prisma.inviteLink.update({
      where: { hash },
      data: { isRevoked: true },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 通过邀请链接加入群组
groupRouter.post('/invite/join', async (req, res) => {
  try {
    const { hash, userId, nickname } = req.body;
    if (!hash || !userId) return res.status(400).json({ error: '缺少必要参数' });

    const link = await prisma.inviteLink.findUnique({
      where: { hash },
      include: { group: { select: { id: true, name: true, memberCount: true, maxMembers: true } } },
    });
    if (!link) return res.status(404).json({ error: '邀请链接不存在' });
    if (link.isRevoked) return res.status(410).json({ error: '邀请链接已被撤销' });
    if (link.expireAt && new Date() > link.expireAt) return res.status(410).json({ error: '邀请链接已过期' });
    if (link.maxUses > 0 && link.usedCount >= link.maxUses) return res.status(410).json({ error: '邀请链接已达到最大使用次数' });

    // 检查是否已是群成员
    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: link.groupId, userId } },
    });
    if (existing) return res.json({ ok: true, alreadyMember: true, groupId: link.groupId });

    // 检查群人数上限
    if (link.group.memberCount >= link.group.maxMembers) {
      return res.status(403).json({ error: '群组已满员' });
    }

    // 加入群组
    await joinGroup(link.groupId, userId, nickname);

    // 更新链接使用次数
    await prisma.inviteLink.update({
      where: { hash },
      data: { usedCount: { increment: 1 } },
    });

    res.json({ ok: true, groupId: link.groupId, groupName: link.group.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ TG 风格 ID 查询 API ============

// 通过 dialogId 查询 Peer 信息
groupRouter.get('/peer/resolve', async (req, res) => {
  try {
    const { dialogId } = req.query as { dialogId: string };
    if (!dialogId) return res.status(400).json({ error: '缺少 dialogId' });

    const { getPeerType } = await import('./utils/peerId.js');
    const peerInfo = getPeerType(dialogId);

    if (peerInfo.type === 'user') {
      // 查询用户
      const user = await prisma.user.findUnique({
        where: { dialogId },
        select: { id: true, dialogId: true, username: true, nickname: true, avatar: true, bio: true, isBot: true },
      });
      if (!user) return res.status(404).json({ error: '用户不存在' });
      return res.json({
        peerType: user.isBot ? 'bot' : 'user',
        data: user,
      });
    } else {
      // 查询群组
      const group = await prisma.group.findUnique({
        where: { dialogId },
        select: { id: true, dialogId: true, username: true, name: true, avatar: true, type: true, isPublic: true, memberCount: true },
      });
      if (!group) return res.status(404).json({ error: '群组不存在' });
      return res.json({
        peerType: group.type === 'channel' ? 'channel' : (peerInfo.type === 'supergroup' ? 'supergroup' : 'group'),
        data: group,
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 设置群组公开用户名
groupRouter.post('/username/set', async (req, res) => {
  try {
    const { groupId, userId, username } = req.body;
    if (!groupId || !userId) return res.status(400).json({ error: '缺少必要参数' });

    // 验证是群主或管理员
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return res.status(403).json({ error: '仅群主和管理员可设置用户名' });
    }

    if (username) {
      // 设置用户名
      if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) {
        return res.status(400).json({ error: '用户名必须以字母开头，5-32位字母数字下划线' });
      }
      const [existUser, existGroup] = await Promise.all([
        prisma.user.findUnique({ where: { username }, select: { id: true } }),
        prisma.group.findFirst({ where: { username, id: { not: groupId } }, select: { id: true } }),
      ]);
      if (existUser || existGroup) {
        return res.status(409).json({ error: '该用户名已被占用' });
      }
    }

    await prisma.group.update({
      where: { id: groupId },
      data: {
        username: username || null,
        isPublic: !!username,
      },
    });

    const publicUrl = username ? `https://wed.imim.chat/im/${username}` : null;
    res.json({ ok: true, username: username || null, publicUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 群信息修改 API ============

// 修改群名称
groupRouter.put('/update/name', async (req, res) => {
  try {
    const { groupId, userId, name } = req.body;
    if (!groupId || !userId || !name?.trim()) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    // 验证权限：群主或管理员
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return res.status(403).json({ error: '仅群主和管理员可修改群名称' });
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 30) {
      return res.status(400).json({ error: '群名称不能超过30个字符' });
    }
    await prisma.group.update({
      where: { id: groupId },
      data: { name: trimmedName },
    });
    // 发送系统消息通知
    sendGroupMessage({
      groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: `群名称已修改为「${trimmedName}」`,
    }).catch(err => console.error('[GroupMsg] 发送群名修改系统消息失败:', err));
    res.json({ ok: true, name: trimmedName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 修改群头像
groupRouter.put('/update/avatar', async (req, res) => {
  try {
    const { groupId, userId, dataBase64, mimeType } = req.body;
    if (!groupId || !userId) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    // 验证权限：群主或管理员
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return res.status(403).json({ error: '仅群主和管理员可修改群头像' });
    }
    if (!dataBase64) {
      return res.status(400).json({ error: '缺少头像数据' });
    }
    // MIME 类型白名单
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
    };
    const ext = extMap[mimeType || 'image/jpeg'] || '.jpg';
    const buffer = Buffer.from(dataBase64, 'base64');
    // 限制 5MB
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: '头像文件过大，最大 5MB' });
    }
    // 优先腾讯云 COS：imimchat/群头像/{groupId}/avatar_<ts>_<rand>.<ext>，失败兜底本地
    const { url: avatarUrl, storage } = await persistGroupAvatar(groupId, buffer, ext, mimeType || 'image/jpeg');
    await prisma.group.update({
      where: { id: groupId },
      data: { avatar: avatarUrl },
    });
    console.log(`[Group] 群头像已更新: groupId=${groupId} storage=${storage}`);
    res.json({ ok: true, avatar: avatarUrl, storage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 修改群 ID（公开用户名 username）
groupRouter.put('/update/username', async (req, res) => {
  try {
    const { groupId, userId, username } = req.body;
    if (!groupId || !userId) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    // 验证权限：仅群主
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!member || member.role !== 'owner') {
      return res.status(403).json({ error: '仅群主可修改群 ID' });
    }
    if (username) {
      // 验证格式
      if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) {
        return res.status(400).json({ error: '群 ID 必须以字母开头，5-32位字母数字下划线' });
      }
      // 检查是否被占用
      const [existUser, existGroup] = await Promise.all([
        prisma.user.findUnique({ where: { username }, select: { id: true } }),
        prisma.group.findFirst({ where: { username, id: { not: groupId } }, select: { id: true } }),
      ]);
      if (existUser || existGroup) {
        return res.status(409).json({ error: '该 ID 已被占用' });
      }
    }
    await prisma.group.update({
      where: { id: groupId },
      data: {
        username: username || null,
        isPublic: !!username,
      },
    });
    const publicUrl = username ? `https://wed.imim.chat/im/${username}` : null;
    res.json({ ok: true, username: username || null, publicUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 批量修改群信息（名称 + 头像 + username 一起改）
groupRouter.put('/update', async (req, res) => {
  try {
    const { groupId, userId, name, username, avatarBase64, avatarMimeType } = req.body;
    if (!groupId || !userId) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    // 验证权限
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return res.status(403).json({ error: '仅群主和管理员可修改群信息' });
    }
    const updateData: any = {};
    const changes: string[] = [];
    // 修改群名称
    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) return res.status(400).json({ error: '群名称不能为空' });
      if (trimmedName.length > 30) return res.status(400).json({ error: '群名称不能超过30个字符' });
      updateData.name = trimmedName;
      changes.push(`群名称修改为「${trimmedName}」`);
    }
    // 修改 username（仅群主）
    if (username !== undefined) {
      if (member.role !== 'owner') {
        return res.status(403).json({ error: '仅群主可修改群 ID' });
      }
      if (username) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) {
          return res.status(400).json({ error: '群 ID 必须以字母开头，5-32位字母数字下划线' });
        }
        const [existUser, existGroup] = await Promise.all([
          prisma.user.findUnique({ where: { username }, select: { id: true } }),
          prisma.group.findFirst({ where: { username, id: { not: groupId } }, select: { id: true } }),
        ]);
        if (existUser || existGroup) {
          return res.status(409).json({ error: '该 ID 已被占用' });
        }
      }
      updateData.username = username || null;
      updateData.isPublic = !!username;
      changes.push(username ? `群 ID 设置为 @${username}` : '群 ID 已清除');
    }
    // 修改群头像（优先腾讯云 COS）
    if (avatarBase64) {
      const extMap: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
        'image/gif': '.gif', 'image/webp': '.webp',
      };
      const ext = extMap[avatarMimeType || 'image/jpeg'] || '.jpg';
      const buffer = Buffer.from(avatarBase64, 'base64');
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: '头像文件过大，最大 5MB' });
      }
      const { url: avatarUrl } = await persistGroupAvatar(groupId, buffer, ext, avatarMimeType || 'image/jpeg');
      updateData.avatar = avatarUrl;
      changes.push('群头像已更新');
    }
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: '没有需要修改的内容' });
    }
    const updated = await prisma.group.update({
      where: { id: groupId },
      data: updateData,
    });
    // 发送系统消息
    if (changes.length > 0) {
      sendGroupMessage({
        groupId,
        senderId: 'system',
        senderName: '系统',
        msgType: 'system',
        content: changes.join('，'),
      }).catch(err => console.error('[GroupMsg] 发送群信息修改系统消息失败:', err));
    }
    res.json({
      ok: true,
      group: {
        id: updated.id,
        name: updated.name,
        avatar: avatarToProxy(updated.avatar),
        username: updated.username,
        isPublic: updated.isPublic,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 群管理增强 API ============

// 退出群聊
groupRouter.post('/leave', async (req, res) => {
  try {
    const { groupId, userId } = req.body;
    if (!groupId || !userId) return res.status(400).json({ error: '缺少必要参数' });

    // 检查是否是群成员
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!member) return res.status(404).json({ error: '你不是该群成员' });

    // 群主不能直接退出，必须先转让
    if (member.role === 'owner') {
      return res.status(403).json({ error: '群主不能直接退出群聊，请先转让群主' });
    }

    await prisma.$transaction([
      prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId } },
      }),
      prisma.group.update({
        where: { id: groupId },
        data: { memberCount: { decrement: 1 } },
      }),
    ]);

    // 发送系统消息
    sendGroupMessage({
      groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: `${userId} 已退出群聊`,
    }).catch(err => console.error('[GroupMsg] 发送退群系统消息失败:', err));

    // 移除在线状态
    leaveGroupOnline(groupId, userId);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 踢出成员
groupRouter.post('/kick', async (req, res) => {
  try {
    const { groupId, operatorId, targetUserId } = req.body;
    if (!groupId || !operatorId || !targetUserId) return res.status(400).json({ error: '缺少必要参数' });

    // 验证操作者权限
    const operator = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: operatorId } },
      select: { role: true },
    });
    if (!operator || (operator.role !== 'owner' && operator.role !== 'admin')) {
      return res.status(403).json({ error: '仅群主和管理员可以踢出成员' });
    }

    // 检查目标用户
    const target = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      select: { role: true },
    });
    if (!target) return res.status(404).json({ error: '目标用户不是群成员' });
    if (target.role === 'owner') return res.status(403).json({ error: '不能踢出群主' });
    if (target.role === 'admin' && operator.role !== 'owner') {
      return res.status(403).json({ error: '仅群主可以踢出管理员' });
    }

    await prisma.$transaction([
      prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId: targetUserId } },
      }),
      prisma.group.update({
        where: { id: groupId },
        data: { memberCount: { decrement: 1 } },
      }),
    ]);

    sendGroupMessage({
      groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: `${targetUserId} 已被移出群聊`,
    }).catch(err => console.error('[GroupMsg] 发送踢人系统消息失败:', err));

    leaveGroupOnline(groupId, targetUserId);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 转让群主
groupRouter.post('/transfer', async (req, res) => {
  try {
    const { groupId, ownerId, newOwnerId } = req.body;
    if (!groupId || !ownerId || !newOwnerId) return res.status(400).json({ error: '缺少必要参数' });

    // 验证当前群主
    const owner = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: ownerId } },
      select: { role: true },
    });
    if (!owner || owner.role !== 'owner') {
      return res.status(403).json({ error: '仅群主可以转让' });
    }

    // 检查新群主是否是群成员
    const newOwner = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: newOwnerId } },
    });
    if (!newOwner) return res.status(404).json({ error: '目标用户不是群成员' });

    await prisma.$transaction([
      prisma.groupMember.update({
        where: { groupId_userId: { groupId, userId: ownerId } },
        data: { role: 'admin' },
      }),
      prisma.groupMember.update({
        where: { groupId_userId: { groupId, userId: newOwnerId } },
        data: { role: 'owner' },
      }),
      prisma.group.update({
        where: { id: groupId },
        data: { ownerId: newOwnerId },
      }),
    ]);

    sendGroupMessage({
      groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: `群主已转让给 ${newOwnerId}`,
    }).catch(err => console.error('[GroupMsg] 发送转让系统消息失败:', err));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 设置/取消管理员
groupRouter.post('/admin/set', async (req, res) => {
  try {
    const { groupId, ownerId, targetUserId, isAdmin } = req.body;
    if (!groupId || !ownerId || !targetUserId) return res.status(400).json({ error: '缺少必要参数' });

    const owner = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: ownerId } },
      select: { role: true },
    });
    if (!owner || owner.role !== 'owner') {
      return res.status(403).json({ error: '仅群主可以设置管理员' });
    }

    const target = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      select: { role: true },
    });
    if (!target) return res.status(404).json({ error: '目标用户不是群成员' });
    if (target.role === 'owner') return res.status(403).json({ error: '不能修改群主角色' });

    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { role: isAdmin ? 'admin' : 'member' },
    });

    sendGroupMessage({
      groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: isAdmin ? `${targetUserId} 已被设为管理员` : `${targetUserId} 已被取消管理员`,
    }).catch(err => console.error('[GroupMsg] 发送管理员设置系统消息失败:', err));

    res.json({ ok: true, role: isAdmin ? 'admin' : 'member' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 设置群公告
groupRouter.put('/announcement', async (req, res) => {
  try {
    const { groupId, userId, announcement } = req.body;
    if (!groupId || !userId) return res.status(400).json({ error: '缺少必要参数' });

    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return res.status(403).json({ error: '仅群主和管理员可以设置群公告' });
    }

    await prisma.group.update({
      where: { id: groupId },
      data: { announcement: announcement || null },
    });

    if (announcement) {
      sendGroupMessage({
        groupId,
        senderId: 'system',
        senderName: '系统',
        msgType: 'system',
        content: `群公告已更新：${announcement}`,
      }).catch(err => console.error('[GroupMsg] 发送群公告系统消息失败:', err));
    }

    res.json({ ok: true, announcement: announcement || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 更新我在本群的昵称
groupRouter.put('/member/nickname', async (req, res) => {
  try {
    const { groupId, userId, nickname } = req.body;
    if (!groupId || !userId) return res.status(400).json({ error: '缺少必要参数' });

    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { id: true },
    });
    if (!member) return res.status(404).json({ error: '你不在该群中' });

    const trimmed = (nickname || '').trim();
    if (trimmed.length > 20) return res.status(400).json({ error: '昵称不能超过20个字符' });

    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { nickname: trimmed || null },
    });

    res.json({ ok: true, nickname: trimmed || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 禁言/解除禁言
groupRouter.post('/mute', async (req, res) => {
  try {
    const { groupId, operatorId, targetUserId, duration } = req.body;
    if (!groupId || !operatorId || !targetUserId) return res.status(400).json({ error: '缺少必要参数' });

    const operator = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: operatorId } },
      select: { role: true },
    });
    if (!operator || (operator.role !== 'owner' && operator.role !== 'admin')) {
      return res.status(403).json({ error: '仅群主和管理员可以禁言' });
    }

    const target = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      select: { role: true },
    });
    if (!target) return res.status(404).json({ error: '目标用户不是群成员' });
    if (target.role === 'owner') return res.status(403).json({ error: '不能禁言群主' });
    if (target.role === 'admin' && operator.role !== 'owner') {
      return res.status(403).json({ error: '仅群主可以禁言管理员' });
    }

    // duration 为 0 表示解除禁言，否则为禁言秒数
    const muteUntil = duration && duration > 0 ? new Date(Date.now() + duration * 1000) : null;

    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { muteUntil },
    });

    const durationText = !muteUntil ? '已解除禁言' :
      duration! >= 86400 ? `已被禁言 ${Math.floor(duration! / 86400)} 天` :
      duration! >= 3600 ? `已被禁言 ${Math.floor(duration! / 3600)} 小时` :
      `已被禁言 ${Math.floor(duration! / 60)} 分钟`;

    sendGroupMessage({
      groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: `${targetUserId} ${durationText}`,
    }).catch(err => console.error('[GroupMsg] 发送禁言系统消息失败:', err));

    res.json({ ok: true, muteUntil: muteUntil?.toISOString() || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 解散群聊（仅群主）
groupRouter.post('/dissolve', async (req, res) => {
  try {
    const { groupId, ownerId } = req.body;
    if (!groupId || !ownerId) return res.status(400).json({ error: '缺少必要参数' });

    const owner = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: ownerId } },
      select: { role: true },
    });
    if (!owner || owner.role !== 'owner') {
      return res.status(403).json({ error: '仅群主可以解散群聊' });
    }

    // 先发送解散通知
    await sendGroupMessage({
      groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: '该群已被群主解散',
    }).catch(() => {});

    // 删除群组（级联删除成员和消息）
    await prisma.group.delete({
      where: { id: groupId },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 群二维码 API ============
// 群二维码：允许所有群成员生成/获取默认群邀请二维码链接（长期有效，除非主动撤销）
groupRouter.post('/qrcode', async (req, res) => {
  try {
    const { groupId, userId } = req.body;
    if (!groupId || !userId) return res.status(400).json({ error: '缺少必要参数' });

    // 验证是群成员
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!member) return res.status(403).json({ error: '非群成员' });

    // 查找现有默认群二维码链接；如果是旧版 7 天二维码，则自动迁移为长期有效
    const existing = await prisma.inviteLink.findFirst({
      where: {
        groupId,
        name: 'group_qrcode',
        isRevoked: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const normalized = (existing.expireAt !== null || existing.maxUses !== 0)
        ? await prisma.inviteLink.update({
            where: { id: existing.id },
            data: { expireAt: null, maxUses: 0 },
          })
        : existing;

      return res.json({
        ok: true,
        inviteLink: {
          hash: normalized.hash,
          url: `/im/+${normalized.hash}`,
          fullUrl: `https://wed.imim.chat/im/+${normalized.hash}`,
          expireAt: normalized.expireAt?.toISOString() || null,
        },
      });
    }

    // 创建新的默认群二维码链接（长期有效）
    const { generateInviteHash } = await import('./utils/peerId.js');
    const hash = generateInviteHash();
    const link = await prisma.inviteLink.create({
      data: {
        hash,
        groupId,
        creatorId: userId,
        name: 'group_qrcode',
        expireAt: null,
        maxUses: 0,
      },
    });

    res.json({
      ok: true,
      inviteLink: {
        hash: link.hash,
        url: `/im/+${link.hash}`,
        fullUrl: `https://wed.imim.chat/im/+${link.hash}`,
        expireAt: link.expireAt?.toISOString() || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 批量邀请好友入群 API（发送邀请请求，需被邀请人同意） ============

/**
 * POST /api/group/invite-members
 * 批量邀请好友加入群聊（发送邀请请求，需要被邀请人同意/拒绝）
 * Body: { groupId, inviterId, memberIds: string[] }
 */
groupRouter.post('/invite-members', async (req, res) => {
  try {
    const { groupId, inviterId, memberIds } = req.body;
    if (!groupId || !inviterId || !Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    if (memberIds.length > 50) {
      return res.status(400).json({ error: '单次最多邀请50人' });
    }

    // 验证邀请者是群成员
    const inviter = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: inviterId } },
      select: { role: true },
    });
    if (!inviter) return res.status(403).json({ error: '非群成员，无权邀请' });

    // 获取群信息
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { lastMsgSeq: true, memberCount: true, maxMembers: true, name: true },
    });
    if (!group) return res.status(404).json({ error: '群组不存在' });

    // 过滤已是群成员的用户
    const existingMembers = await prisma.groupMember.findMany({
      where: { groupId, userId: { in: memberIds } },
      select: { userId: true },
    });
    const existingSet = new Set(existingMembers.map(m => m.userId));
    const newMemberIds = memberIds.filter(id => !existingSet.has(id));

    if (newMemberIds.length === 0) {
      return res.json({ ok: true, invited: 0, alreadyMembers: memberIds.length, message: '所选好友已全部在群中' });
    }

    // 验证用户存在
    const validUsers = await prisma.user.findMany({
      where: { id: { in: newMemberIds } },
      select: { id: true, nickname: true, username: true },
    });
    const validUserIds = validUsers.map(u => u.id);

    if (validUserIds.length === 0) {
      return res.status(400).json({ error: '没有有效的用户可邀请' });
    }

    // 过滤已有待处理邀请的用户
    const existingInvites = await prisma.groupInvite.findMany({
      where: { groupId, inviteeId: { in: validUserIds }, status: 'pending' },
      select: { inviteeId: true },
    });
    const pendingSet = new Set(existingInvites.map(i => i.inviteeId));
    const toInviteIds = validUserIds.filter(id => !pendingSet.has(id));

    // 批量创建邀请请求
    if (toInviteIds.length > 0) {
      await prisma.groupInvite.createMany({
        data: toInviteIds.map(userId => ({
          groupId,
          inviterId,
          inviteeId: userId,
          message: `邀请你加入群聊「${group.name}」`,
          status: 'pending',
        })),
        skipDuplicates: true,
      });
    }

    console.log(`[GroupMsg] 批量发送入群邀请: groupId=${groupId} inviter=${inviterId} invited=${toInviteIds.length} alreadyPending=${pendingSet.size}`);

    res.json({
      ok: true,
      invited: toInviteIds.length,
      alreadyPending: pendingSet.size,
      alreadyMembers: existingSet.size,
      groupName: group.name,
    });
  } catch (err: any) {
    console.error('[GroupMsg] 批量发送入群邀请失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ 群邀请请求管理 API ============

/**
 * GET /api/group/invites
 * 获取当前用户收到的群邀请列表
 * Query: ?type=received|sent|all (default: all)
 */
groupRouter.get('/invites', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || '';
    if (!userId) return res.status(400).json({ error: '缺少 userId' });
    const { type = 'all' } = req.query as { type?: string };

    const whereCondition: any = {};
    if (type === 'received') {
      whereCondition.inviteeId = userId;
    } else if (type === 'sent') {
      whereCondition.inviterId = userId;
    } else {
      whereCondition.OR = [
        { inviteeId: userId },
        { inviterId: userId },
      ];
    }

    const invites = await prisma.groupInvite.findMany({
      where: whereCondition,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        group: {
          select: { id: true, name: true, avatar: true, memberCount: true },
        },
      },
    });

    // 批量获取相关用户信息
    const userIds = new Set<string>();
    invites.forEach(inv => { userIds.add(inv.inviterId); userIds.add(inv.inviteeId); });
    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, username: true, nickname: true, avatar: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    res.json({
      invites: invites.map(inv => {
        const inviter = userMap.get(inv.inviterId);
        const invitee = userMap.get(inv.inviteeId);
        return {
          id: inv.id,
          groupId: inv.groupId,
          groupName: inv.group.name,
          groupAvatar: avatarToProxy(inv.group.avatar),
          groupMemberCount: inv.group.memberCount,
          inviterId: inv.inviterId,
          inviterName: inviter?.nickname || inviter?.username || inv.inviterId,
          inviterAvatar: avatarToProxy(inviter?.avatar),
          inviteeId: inv.inviteeId,
          inviteeName: invitee?.nickname || invitee?.username || inv.inviteeId,
          inviteeAvatar: avatarToProxy(invitee?.avatar),
          message: inv.message || '',
          status: inv.status,
          timestamp: inv.createdAt.getTime(),
          isIncoming: inv.inviteeId === userId,
        };
      }),
    });
  } catch (err: any) {
    console.error('[GroupMsg] 获取群邀请列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * POST /api/group/invite-accept/:inviteId
 * 同意群邀请，加入群聊
 */
groupRouter.post('/invite-accept/:inviteId', async (req, res) => {
  try {
    const { inviteId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const invite = await prisma.groupInvite.findUnique({
      where: { id: inviteId },
      include: {
        group: { select: { id: true, name: true, lastMsgSeq: true, memberCount: true, maxMembers: true, avatar: true } },
      },
    });

    if (!invite) return res.status(404).json({ error: '邀请不存在' });
    if (invite.inviteeId !== userId) return res.status(403).json({ error: '无权操作此邀请' });
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: `邀请已${invite.status === 'accepted' ? '接受' : '拒绝'}` });
    }

    // 检查是否已是群成员
    const existingMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: invite.groupId, userId } },
    });
    if (existingMember) {
      await prisma.groupInvite.update({ where: { id: inviteId }, data: { status: 'accepted' } });
      return res.json({ ok: true, message: '你已经是群成员了', groupId: invite.groupId, groupName: invite.group.name });
    }

    // 检查群人数上限
    if (invite.group.memberCount >= invite.group.maxMembers) {
      return res.status(403).json({ error: '群组已满员' });
    }

    // 加入群组
    await prisma.$transaction([
      prisma.groupInvite.update({ where: { id: inviteId }, data: { status: 'accepted' } }),
      prisma.groupMember.create({
        data: {
          groupId: invite.groupId,
          userId,
          role: 'member',
          lastAckSeq: invite.group.lastMsgSeq,
        },
      }),
      prisma.group.update({
        where: { id: invite.groupId },
        data: { memberCount: { increment: 1 } },
      }),
    ]);

    // 获取用户信息发送系统消息
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, username: true },
    });
    const userName = user?.nickname || user?.username || userId;

    sendGroupMessage({
      groupId: invite.groupId,
      senderId: 'system',
      senderName: '系统',
      msgType: 'system',
      content: `${userName} 通过邀请加入了群聊`,
    }).catch(err => {
      console.error('[GroupMsg] 发送入群系统消息失败:', err);
    });

    console.log(`[GroupMsg] 用户接受群邀请: inviteId=${inviteId} userId=${userId} groupId=${invite.groupId}`);

    res.json({
      ok: true,
      message: '已加入群聊',
      groupId: invite.groupId,
      groupName: invite.group.name,
      groupAvatar: avatarToProxy(invite.group.avatar),
    });
  } catch (err: any) {
    console.error('[GroupMsg] 接受群邀请失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

/**
 * POST /api/group/invite-reject/:inviteId
 * 拒绝群邀请
 */
groupRouter.post('/invite-reject/:inviteId', async (req, res) => {
  try {
    const { inviteId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const invite = await prisma.groupInvite.findUnique({
      where: { id: inviteId },
    });

    if (!invite) return res.status(404).json({ error: '邀请不存在' });
    if (invite.inviteeId !== userId) return res.status(403).json({ error: '无权操作此邀请' });
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: `邀请已${invite.status === 'accepted' ? '接受' : '拒绝'}` });
    }

    await prisma.groupInvite.update({
      where: { id: inviteId },
      data: { status: 'rejected' },
    });

    console.log(`[GroupMsg] 用户拒绝群邀请: inviteId=${inviteId} userId=${userId}`);

    res.json({ ok: true, message: '已拒绝群邀请' });
  } catch (err: any) {
    console.error('[GroupMsg] 拒绝群邀请失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

export default groupRouter;
