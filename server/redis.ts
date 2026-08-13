/**
 * Redis 工具模块（严格一致性与容错降级版）
 * 1. 未读数：Hash 结构 (unread:{userId})，HINCRBY/HSET 原子更新
 * 2. 会话列表：Cache-Aside (conv:list:{userId})，写时主动 DEL
 * 3. 在线状态：SET EX 90，心跳续期，断开 DEL
 * 4. 容错降级：Redis 异常时静默捕获，保证业务不中断
 */
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 50, 1000),
  enableOfflineQueue: false,
});

export const redisSub = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 50, 1000),
});

export const redisPub = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 50, 1000),
});

redis.on('connect', () => console.log('[Redis] 主连接已建立'));
redis.on('error', (err) => console.error('[Redis] 主连接错误（已降级）:', err.message));
redisSub.on('connect', () => console.log('[Redis] Sub连接已建立'));
redisSub.on('error', (err) => console.error('[Redis] Sub连接错误:', err.message));
redisPub.on('connect', () => console.log('[Redis] Pub连接已建立'));
redisPub.on('error', (err) => console.error('[Redis] Pub连接错误:', err.message));

async function scanKeys(pattern: string, count = 200): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

export async function connectRedis() {
  try {
    await redis.connect();
    await redisSub.connect();
    await redisPub.connect();
    console.log('[Redis] 所有连接已就绪');
  } catch (err: any) {
    console.error('[Redis] 连接失败，降级为直连数据库:', err.message);
  }
}

// ============ 1. 在线状态策略 (SET EX 90) ============

const ONLINE_PREFIX = 'online:';
const ONLINE_TTL = 90; // 90 秒过期，心跳续期

export async function setUserOnline(userId: string): Promise<void> {
  try {
    await redis.setex(ONLINE_PREFIX + userId, ONLINE_TTL, Date.now().toString());
  } catch {}
}

export async function refreshUserOnline(userId: string): Promise<void> {
  try {
    await redis.expire(ONLINE_PREFIX + userId, ONLINE_TTL);
  } catch {}
}

export async function setUserOffline(userId: string): Promise<void> {
  try {
    await redis.del(ONLINE_PREFIX + userId);
  } catch {}
}

export async function isUserOnline(userId: string): Promise<boolean> {
  try {
    const res = await redis.exists(ONLINE_PREFIX + userId);
    return res === 1;
  } catch {
    return false;
  }
}

// ============ 2. 未读数策略 (Hash unread:{userId}) ============

const UNREAD_PREFIX = 'unread:';

/** 获取用户总未读数或特定会话未读数 */
export async function getUnreadCount(userId: string, chatId?: string): Promise<number> {
  try {
    if (chatId) {
      const val = await redis.hget(UNREAD_PREFIX + userId, chatId);
      return val ? parseInt(val, 10) : 0;
    } else {
      const val = await redis.hget(UNREAD_PREFIX + userId, 'total');
      return val ? parseInt(val, 10) : 0;
    }
  } catch {
    return 0; // 降级返回 0，由数据库兜底
  }
}

/** 原子增加未读数（同时更新分会话与总未读） */
export async function incrUnreadCount(userId: string, chatId: string, delta = 1): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.hincrby(UNREAD_PREFIX + userId, chatId, delta);
    pipeline.hincrby(UNREAD_PREFIX + userId, 'total', delta);
    // 设置 Hash 整体过期时间 7 天，避免内存无限膨胀
    pipeline.expire(UNREAD_PREFIX + userId, 86400 * 7);
    await pipeline.exec();
  } catch {}
}

/** 进入会话清空未读数（原子归零） */
export async function clearUnreadCount(userId: string, chatId: string): Promise<number> {
  try {
    const currentChatUnread = await redis.hget(UNREAD_PREFIX + userId, chatId);
    const unreadNum = currentChatUnread ? parseInt(currentChatUnread, 10) : 0;
    if (unreadNum > 0) {
      const pipeline = redis.pipeline();
      pipeline.hset(UNREAD_PREFIX + userId, chatId, '0');
      pipeline.hincrby(UNREAD_PREFIX + userId, 'total', -unreadNum);
      await pipeline.exec();
    }
    return unreadNum;
  } catch {
    return 0;
  }
}

// ============ 3. 会话列表 Cache-Aside 策略 (conv:list:{userId}) ============

const CONV_LIST_PREFIX = 'conv:list:';
const CONV_LIST_TTL = 60; // 60 秒 TTL

export async function getCachedConversationList(userId: string): Promise<any[] | null> {
  try {
    const data = await redis.get(CONV_LIST_PREFIX + userId);
    if (!data) return null;
    return JSON.parse(data);
  } catch {
    return null; // 降级返回 null 触发查库
  }
}

export async function setCachedConversationList(userId: string, list: any[]): Promise<void> {
  try {
    await redis.setex(CONV_LIST_PREFIX + userId, CONV_LIST_TTL, JSON.stringify(list));
  } catch {}
}

export async function invalidateConversationList(userId: string): Promise<void> {
  try {
    await redis.del(CONV_LIST_PREFIX + userId);
  } catch {}
}

// ============ 4. 消息 Pub/Sub ============

const MSG_CHANNEL_PREFIX = 'msg:';
const channelListeners = new Map<string, Set<(message: object) => void>>();
let subDispatcherBound = false;

function ensureSubDispatcher() {
  if (subDispatcherBound) return;
  subDispatcherBound = true;

  redisSub.on('message', (rawChannel, data) => {
    const channel = rawChannel.startsWith(MSG_CHANNEL_PREFIX)
      ? rawChannel.slice(MSG_CHANNEL_PREFIX.length)
      : rawChannel;
    const listeners = channelListeners.get(channel);
    if (!listeners || listeners.size === 0) return;

    try {
      const message = JSON.parse(data) as object;
      for (const listener of listeners) {
        try { listener(message); } catch {}
      }
    } catch {}
  });
}

export async function publishMessage(channel: string, message: object): Promise<void> {
  try {
    await redisPub.publish(MSG_CHANNEL_PREFIX + channel, JSON.stringify(message));
  } catch {}
}

export function subscribeChannel(channel: string, callback: (message: object) => void): void {
  ensureSubDispatcher();
  const listeners = channelListeners.get(channel) ?? new Set();
  const shouldSubscribe = listeners.size === 0;
  listeners.add(callback);
  channelListeners.set(channel, listeners);

  if (shouldSubscribe) {
    redisSub.subscribe(MSG_CHANNEL_PREFIX + channel, (err) => {
      if (err) console.error('[Redis] 订阅失败:', err.message);
    });
  }
}

export function unsubscribeChannel(channel: string): void {
  channelListeners.delete(channel);
  redisSub.unsubscribe(MSG_CHANNEL_PREFIX + channel);
}

// ============ 验证码缓存 ============

const VERIFY_CODE_PREFIX = 'verify_code:';
const VERIFY_CODE_RECENT_PREFIX = 'verify_code_recent:';

export interface RedisVerifyCodeRecord {
  target: string;
  type: string;
  channel: string;
  code: string;
  expiresAt: string;
  createdAt: string;
  used: boolean;
  attempts: number;
}

function getVerifyCodeKey(target: string, type: string, channel: string) {
  return `${VERIFY_CODE_PREFIX}${channel}:${type}:${target}`;
}

function getVerifyCodeRecentKey(target: string, channel: string) {
  return `${VERIFY_CODE_RECENT_PREFIX}${channel}:${target}`;
}

export async function hasRecentVerifyCodeSend(target: string, channel: string): Promise<boolean> {
  try {
    const ttl = await redis.ttl(getVerifyCodeRecentKey(target, channel));
    return ttl > 0;
  } catch {
    return false;
  }
}

export async function markRecentVerifyCodeSend(target: string, channel: string, ttlSeconds = 60): Promise<void> {
  try {
    await redis.setex(getVerifyCodeRecentKey(target, channel), ttlSeconds, Date.now().toString());
  } catch {}
}

export async function setVerifyCodeRecord(record: RedisVerifyCodeRecord): Promise<void> {
  try {
    const ttlSeconds = Math.max(1, Math.ceil((new Date(record.expiresAt).getTime() - Date.now()) / 1000));
    await redis.setex(getVerifyCodeKey(record.target, record.type, record.channel), ttlSeconds, JSON.stringify(record));
  } catch {}
}

export async function getVerifyCodeRecord(target: string, type: string, channel: string): Promise<RedisVerifyCodeRecord | null> {
  try {
    const raw = await redis.get(getVerifyCodeKey(target, type, channel));
    if (!raw) return null;
    return JSON.parse(raw) as RedisVerifyCodeRecord;
  } catch {
    return null;
  }
}

export async function updateVerifyCodeRecord(target: string, type: string, channel: string, updater: (current: RedisVerifyCodeRecord) => RedisVerifyCodeRecord): Promise<RedisVerifyCodeRecord | null> {
  try {
    const current = await getVerifyCodeRecord(target, type, channel);
    if (!current) return null;
    const next = updater(current);
    await setVerifyCodeRecord(next);
    return next;
  } catch {
    return null;
  }
}

export async function deleteVerifyCodeRecord(target: string, type: string, channel: string): Promise<void> {
  try {
    await redis.del(getVerifyCodeKey(target, type, channel));
  } catch {}
}
