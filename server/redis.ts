/**
 * Redis 工具模块
 * 提供会话缓存、在线状态、消息 Pub/Sub 功能
 */
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// 主连接（读写）
export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  enableOfflineQueue: false,
});

// Pub/Sub 专用订阅连接
export const redisSub = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

// Pub/Sub 专用发布连接
export const redisPub = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('connect', () => console.log('[Redis] 主连接已建立'));
redis.on('error', (err) => console.error('[Redis] 主连接错误:', err.message));
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
    console.error('[Redis] 连接失败，将降级使用内存缓存:', err.message);
  }
}

// ============ 会话缓存 ============

const SESSION_PREFIX = 'session:';
const SESSION_TTL = 30; // 秒

export interface RedisCachedSession {
  user: any;
  expiresAt: string;
  cachedAt: number;
}

export async function setSessionCache(token: string, session: RedisCachedSession): Promise<void> {
  try {
    await redis.setex(SESSION_PREFIX + token, SESSION_TTL, JSON.stringify(session));
  } catch {}
}

export async function getSessionCache(token: string): Promise<RedisCachedSession | null> {
  try {
    const data = await redis.get(SESSION_PREFIX + token);
    if (!data) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function deleteSessionCache(token: string): Promise<void> {
  try {
    await redis.del(SESSION_PREFIX + token);
  } catch {}
}

export async function deleteUserSessionCache(userId: string): Promise<void> {
  try {
    const keys = await scanKeys(SESSION_PREFIX + '*');
    if (keys.length === 0) return;

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.get(key));
    const results = await pipeline.exec();

    const deletePipeline = redis.pipeline();
    keys.forEach((key, index) => {
      const raw = results?.[index]?.[1];
      if (typeof raw !== 'string') return;
      try {
        const session: RedisCachedSession = JSON.parse(raw);
        if (session.user?.id === userId) {
          deletePipeline.del(key);
        }
      } catch {
        // ignore malformed cached payloads
      }
    });
    await deletePipeline.exec();
  } catch {}
}

// ============ 在线状态 ============

const ONLINE_PREFIX = 'online:';
const ONLINE_TTL = 120; // 秒，心跳超时后自动过期

/** 设置用户在线，TTL 内未续期则自动过期 */
export async function setUserOnline(userId: string): Promise<void> {
  try {
    await redis.setex(ONLINE_PREFIX + userId, ONLINE_TTL, Date.now().toString());
  } catch {}
}

/** 刷新用户在线 TTL（心跳） */
export async function refreshUserOnline(userId: string): Promise<void> {
  try {
    await redis.expire(ONLINE_PREFIX + userId, ONLINE_TTL);
  } catch {}
}

/** 设置用户离线 */
export async function setUserOffline(userId: string): Promise<void> {
  try {
    await redis.del(ONLINE_PREFIX + userId);
  } catch {}
}

/** 查询用户是否在线 */
export async function isUserOnline(userId: string): Promise<boolean> {
  try {
    const result = await redis.exists(ONLINE_PREFIX + userId);
    return result === 1;
  } catch {
    return false;
  }
}

/** 获取所有在线用户 ID */
export async function getOnlineUsers(): Promise<string[]> {
  try {
    const keys = await scanKeys(ONLINE_PREFIX + '*');
    return keys.map(k => k.replace(ONLINE_PREFIX, ''));
  } catch {
    return [];
  }
}

// ============ 消息 Pub/Sub ============

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
        try {
          listener(message);
        } catch (err) {
          console.error('[Redis] 消息回调执行失败:', err);
        }
      }
    } catch {
      // ignore malformed messages
    }
  });
}

/** 发布消息到指定频道 */
export async function publishMessage(channel: string, message: object): Promise<void> {
  try {
    await redisPub.publish(MSG_CHANNEL_PREFIX + channel, JSON.stringify(message));
  } catch {}
}

/** 订阅频道，收到消息时回调 */
export function subscribeChannel(channel: string, callback: (message: object) => void): void {
  ensureSubDispatcher();

  const listeners = channelListeners.get(channel) ?? new Set<(message: object) => void>();
  const shouldSubscribe = listeners.size === 0;
  listeners.add(callback);
  channelListeners.set(channel, listeners);

  if (shouldSubscribe) {
    redisSub.subscribe(MSG_CHANNEL_PREFIX + channel, (err) => {
      if (err) console.error('[Redis] 订阅失败:', err.message);
    });
  }
}

/** 取消订阅频道 */
export function unsubscribeChannel(channel: string): void {
  channelListeners.delete(channel);
  redisSub.unsubscribe(MSG_CHANNEL_PREFIX + channel);
}

// ============ 设备信息 & 最后在线时间 ============

export interface DeviceInfo {
  deviceId: string;
  deviceType: 'mobile' | 'desktop' | 'tablet' | 'unknown';
  browser: string;
  os: string;
  ip: string;
  lastActive: number; // Unix ms
}

const DEVICE_PREFIX = 'device:';
const LAST_SEEN_PREFIX = 'last_seen:';
const USER_DEVICES_PREFIX = 'user_devices:';
const DEVICE_TTL = 300; // 5分钟

/** 解析 User-Agent 字符串，返回设备信息 */
export function parseUserAgent(ua: string, ip: string): Omit<DeviceInfo, 'deviceId' | 'lastActive'> {
  const lowerUA = ua.toLowerCase();

  // 检测浏览器（注意：内嵌浏览器必须优先于通用浏览器判断，因为它们的 UA 中包含 Chrome/Safari 字符串）
  let browser = 'Unknown';
  if (lowerUA.includes('micromessenger')) browser = '微信';        // 微信内置浏览器（含 Chrome）
  else if (lowerUA.includes('weibo')) browser = '微博';             // 微博内置浏览器
  else if (lowerUA.includes('alipayclient')) browser = '支付宝';   // 支付宝
  else if (lowerUA.includes('bytedancewebview') || lowerUA.includes('toutiao') || lowerUA.includes('aweme')) browser = '抖音/头条'; // 抖音/头条
  else if (lowerUA.includes('baiduboxapp')) browser = '百度App';   // 百度App
  else if (lowerUA.includes('qqbrowser')) browser = 'QQ浏览器';    // QQ浏览器（含 Chrome）
  else if (lowerUA.includes(' qq/')) browser = 'QQ';               // QQ内置浏览器
  else if (lowerUA.includes('ucbrowser') || lowerUA.includes('ucweb')) browser = 'UC浏览器';
  else if (lowerUA.includes('huaweibrowser')) browser = '华为浏览器';
  else if (lowerUA.includes('miuibrowser') || lowerUA.includes('xiaomi')) browser = '小米浏览器';
  else if (lowerUA.includes('vivobrowser')) browser = 'vivo浏览器';
  else if (lowerUA.includes('oppobrowser')) browser = 'OPPO浏览器';
  else if (lowerUA.includes('samsungbrowser')) browser = '三星浏览器'; // 三星浏览器（含 Chrome）
  else if (lowerUA.includes('edg/') || lowerUA.includes('edge/')) browser = 'Edge'; // Edge（含 Chrome）
  else if (lowerUA.includes('opr/') || lowerUA.includes('opera/')) browser = 'Opera'; // Opera（含 Chrome）
  else if (lowerUA.includes('crios/')) browser = 'Chrome (iOS)';   // iOS 上的 Chrome
  else if (lowerUA.includes('fxios/')) browser = 'Firefox (iOS)';  // iOS 上的 Firefox
  else if (lowerUA.includes('chrome/') && !lowerUA.includes('chromium/')) browser = 'Chrome';
  else if (lowerUA.includes('chromium/')) browser = 'Chromium';
  else if (lowerUA.includes('firefox/')) browser = 'Firefox';
  else if (lowerUA.includes('safari/') && lowerUA.includes('version/')) browser = 'Safari'; // 原生 Safari 含 Version/
  else if (lowerUA.includes('safari/')) browser = 'Safari';

  // 检测操作系统（HarmonyOS 必须优先于 Android，因为鸿蒙 UA 包含 Android 字符串）
  let os = 'Unknown';
  if (lowerUA.includes('harmonyos')) os = 'HarmonyOS';             // 鸿蒙（含 Android）
  else if (lowerUA.includes('iphone')) os = 'iPhone';
  else if (lowerUA.includes('ipad')) os = 'iPad';
  else if (lowerUA.includes('ipod')) os = 'iPod';
  else if (lowerUA.includes('android')) os = 'Android';
  else if (lowerUA.includes('windows nt 10')) os = 'Windows 10/11';
  else if (lowerUA.includes('windows nt 6.3')) os = 'Windows 8.1';
  else if (lowerUA.includes('windows nt')) os = 'Windows';
  else if (lowerUA.includes('mac os x')) os = 'macOS';
  else if (lowerUA.includes('linux')) os = 'Linux';
  else if (lowerUA.includes('cros')) os = 'ChromeOS';

  // 检测设备类型
  let deviceType: DeviceInfo['deviceType'] = 'desktop';
  if (lowerUA.includes('iphone') || lowerUA.includes('ipod') ||
      (lowerUA.includes('android') && lowerUA.includes('mobile'))) {
    deviceType = 'mobile';
  } else if (lowerUA.includes('ipad') ||
      (lowerUA.includes('android') && !lowerUA.includes('mobile'))) {
    deviceType = 'tablet';
  }

  return { browser, os, deviceType, ip };
}

/** 用户上线时记录设备信息 */
export async function setUserDevice(userId: string, deviceId: string, info: Omit<DeviceInfo, 'deviceId' | 'lastActive'>): Promise<void> {
  try {
    const deviceInfo: DeviceInfo = { deviceId, ...info, lastActive: Date.now() };
    const pipeline = redis.pipeline();
    // 存储设备详情
    pipeline.setex(DEVICE_PREFIX + deviceId, DEVICE_TTL, JSON.stringify(deviceInfo));
    // 将设备 ID 加入用户设备集合
    pipeline.sadd(USER_DEVICES_PREFIX + userId, deviceId);
    pipeline.expire(USER_DEVICES_PREFIX + userId, DEVICE_TTL);
    await pipeline.exec();
  } catch {}
}

/** 心跳续期设备 */
export async function refreshUserDevice(userId: string, deviceId: string): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.expire(DEVICE_PREFIX + deviceId, DEVICE_TTL);
    pipeline.expire(USER_DEVICES_PREFIX + userId, DEVICE_TTL);
    // 更新 lastActive
    const raw = await redis.get(DEVICE_PREFIX + deviceId);
    if (raw) {
      const info = JSON.parse(raw) as DeviceInfo;
      info.lastActive = Date.now();
      pipeline.setex(DEVICE_PREFIX + deviceId, DEVICE_TTL, JSON.stringify(info));
    }
    await pipeline.exec();
  } catch {}
}

/** 用户下线时移除设备，并记录最后在线时间 */
export async function removeUserDevice(userId: string, deviceId: string): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.del(DEVICE_PREFIX + deviceId);
    pipeline.srem(USER_DEVICES_PREFIX + userId, deviceId);
    // 记录最后在线时间（永久保存）
    pipeline.set(LAST_SEEN_PREFIX + userId, Date.now().toString());
    await pipeline.exec();
  } catch {}
}

/** 获取用户所有在线设备信息 */
export async function getUserDevices(userId: string): Promise<DeviceInfo[]> {
  try {
    const deviceIds = await redis.smembers(USER_DEVICES_PREFIX + userId);
    if (!deviceIds.length) return [];
    const pipeline = redis.pipeline();
    deviceIds.forEach(id => pipeline.get(DEVICE_PREFIX + id));
    const results = await pipeline.exec();
    const devices: DeviceInfo[] = [];
    results?.forEach(([err, raw]) => {
      if (!err && typeof raw === 'string') {
        try { devices.push(JSON.parse(raw)); } catch {}
      }
    });
    return devices;
  } catch {
    return [];
  }
}

/** 获取用户最后在线时间（Unix ms），在线时返回 null */
export async function getUserLastSeen(userId: string): Promise<number | null> {
  try {
    // 如果用户当前在线，返回 null
    const online = await redis.exists(ONLINE_PREFIX + userId);
    if (online) return null;
    const val = await redis.get(LAST_SEEN_PREFIX + userId);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
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
