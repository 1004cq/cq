/**
 * server/moments.ts - 朋友圈 API（Prisma SQLite 版）
 * 性能优化版 v2：Redis 多级缓存、COS 缩略图 URL、朋友圈专用限流、
 * 内存缓存、精简查询、并行查询、ETag 支持
 * v3：COS 预签名 URL 支持（私有存储桶兼容）
 * v4：COS 服务端代理方案（绕过防盗链）
 */
import { Router, Request, Response } from 'express';
import prisma from './db.js';
import { redis, publishMessage } from './redis.js';
import { cosUrlToSigned, cosUrlToSignedLong, cosUrlToProxy, avatarToProxy } from './cos-signer.js';

const router = Router();

// ============ 内存缓存层（L1 缓存） ============
interface CacheEntry<T> { data: T; expireAt: number; }
const cache = new Map<string, CacheEntry<any>>();

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expireAt) { cache.delete(key); return null; }
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expireAt: Date.now() + ttlMs });
}

function cacheInvalidate(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// 定期清理过期缓存（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expireAt) cache.delete(key);
  }
}, 300_000);

// ============ Redis 缓存层（L2 缓存） ============
const REDIS_FEED_TTL = 30; // Feed 缓存 30 秒
const REDIS_MOMENT_TTL = 120; // 单条动态缓存 2 分钟

async function redisCacheGet<T>(key: string): Promise<T | null> {
  try {
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function redisCacheSet(key: string, data: any, ttlSeconds: number): Promise<void> {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch {
    // Redis 不可用时静默降级
  }
}

async function redisCacheInvalidate(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // 静默降级
  }
}

// ============ 朋友圈专用限流器 ============
class MomentsRateLimiter {
  private store = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private windowMs: number, private maxRequests: number) {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now > entry.resetAt) this.store.delete(key);
      }
    }, Math.min(windowMs, 60_000));
    this.cleanupTimer.unref?.();
  }

  check(key: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    let entry = this.store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.store.set(key, entry);
    }
    entry.count++;
    return {
      allowed: entry.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.count),
    };
  }
}

// 发布限流：每用户每分钟最多 5 条动态
const publishLimiter = new MomentsRateLimiter(60_000, 5);
// 点赞限流：每用户每分钟最多 30 次
const likeLimiter = new MomentsRateLimiter(60_000, 30);
// 评论限流：每用户每分钟最多 20 条
const commentLimiter = new MomentsRateLimiter(60_000, 20);

// ============ COS 缩略图 URL 处理 ============
/**
 * 为 COS 图片 URL 追加数据万象处理参数，生成缩略图
 * 支持腾讯云 COS 的 imageMogr2 接口
 * 本地上传的图片（以 / 开头）不处理
 */
function isCosImageUrl(url: string): boolean {
  if (!url || !url.startsWith('https://')) return false;
  if (!(url.includes('.cos.') || url.includes('.myqcloud.com'))) return false;
  if (/\.(mp4|mov|avi|webm|mkv|m4v|3gp)$/i.test(url)) return false;
  return true;
}

function getCosThumbUrl(url: string, size: 'small' | 'medium' | 'large' | 'tiny' = 'medium'): string {
  if (!isCosImageUrl(url)) return url;
  // 已经有处理参数的不重复添加
  if (url.includes('imageMogr2') || url.includes('imageView2')) return url;

  // GIF 动图特别处理：降帧到 15fps + WebP，列表页资源体积可压缩 50%+
  const isGif = /\.gif(\?|$)/i.test(url);
  if (isGif && (size === 'small' || size === 'tiny')) {
    return url + '?imageMogr2/cgif/15/thumbnail/300x300/format/webp/quality/70';
  }

  const params: Record<string, string> = {
    tiny:   '?imageMogr2/thumbnail/200x200/format/webp/quality/60',  // 弱网 / 预览默认图
    small:  '?imageMogr2/thumbnail/300x300/format/webp/quality/75',
    medium: '?imageMogr2/thumbnail/800x800/format/webp/quality/85',
    large:  '?imageMogr2/thumbnail/1200x1200/format/webp/quality/85',
  };
  return url + (params[size] || params.medium);
}

/**
 * 为 COS 上的视频生成封面缩略图（数据万象 ci-process snapshot）
 * - 列表页只要一张封面，避免加载原始视频香老流量
 */
function getCosVideoPoster(url: string): string | undefined {
  if (!url || !url.startsWith('https://')) return undefined;
  if (!(url.includes('.cos.') || url.includes('.myqcloud.com'))) return undefined;
  if (!/\.(mp4|mov|m4v|webm|mkv)$/i.test(url)) return undefined;
  return url + '?ci-process=snapshot&time=0.5&format=jpg&width=480';
}

/**
 * 为媒体列表添加缩略图 URL
 * - 图片：thumbUrl(300) / mediumUrl(600) / lowQualityUrl(弱网专用 200/quality60)
 * - 视频：thumbUrl = COS snapshot 封面 供列表页 LazyVideo 用
 */
function addThumbUrls(media: any[]): any[] {
  return media.map((item: any) => {
    if (item.type === 'image' && item.url) {
      return {
        ...item,
        thumbUrl: getCosThumbUrl(item.url, 'small'),
        mediumUrl: getCosThumbUrl(item.url, 'medium'),
        lowQualityUrl: getCosThumbUrl(item.url, 'tiny'),
      };
    }
    if (item.type === 'video' && item.url) {
      const poster = getCosVideoPoster(item.url);
      return poster ? { ...item, thumbUrl: poster, posterUrl: poster } : item;
    }
    return item;
  });
}

// ============ COS 服务端代理 URL 方案（绕过防盗链） ============
// 提示：原本处本文件内部定义了同名的 cosUrlToProxy 函数，
// 已迁移到 cos-signer.ts 中（同时增加中文 ↔ ASCII 别名转换逻辑，
// 避免 EdgeOne 回源时中文路径 → raw UTF-8 字节 → Node 400 问题）。
// 并以 import 方式复用，避免重复定义。

/**
 * 为媒体列表添加缩略图 URL 并转换为代理 URL
 * - 图片：thumbUrl(300) / mediumUrl(600) / lowQualityUrl(弱网专用 200/quality60)
 * - 视频：thumbUrl = COS snapshot 封面 供列表页 LazyVideo 用
 * - 所有 COS URL 都会被转换为 /api/cos/proxy/ 代理 URL，绕过防盗链
 */
function addThumbUrlsProxy(media: any[]): any[] {
  return media.map((item: any) => {
    if (item.type === 'image' && item.url) {
      return {
        ...item,
        url: cosUrlToProxy(item.url),
        thumbUrl: cosUrlToProxy(getCosThumbUrl(item.url, 'small')),
        mediumUrl: cosUrlToProxy(getCosThumbUrl(item.url, 'medium')),
        lowQualityUrl: cosUrlToProxy(getCosThumbUrl(item.url, 'tiny')),
      };
    }
    if (item.type === 'video' && item.url) {
      const poster = getCosVideoPoster(item.url);
      return {
        ...item,
        url: cosUrlToProxy(item.url),
        thumbUrl: poster ? cosUrlToProxy(poster) : undefined,
        posterUrl: poster ? cosUrlToProxy(poster) : undefined,
      };
    }
    return item;
  });
}

/**
 * 性能优化版 v5：把媒体 URL 直接预签名，前端 <img src=> 一步到 COS（无 Node 302 跳转）
 * - 图片：thumb / medium / lowQuality 各档位都生成签名 URL
 * - 视频：poster 用签名缩略图，原视频 url 保留为签名直链
 * - 命中签名缓存时几乎 0ms，未命中时单次签名计算 < 1ms
 */
async function addThumbUrlsSigned(media: any[]): Promise<any[]> {
  if (!Array.isArray(media) || media.length === 0) return media || [];
  return Promise.all(media.map(async (item: any) => {
    if (item?.type === 'image' && item.url) {
      const [url, thumbUrl, mediumUrl, lowQualityUrl] = await Promise.all([
        cosUrlToSigned(item.url),
        cosUrlToSigned(getCosThumbUrl(item.url, 'small')),
        cosUrlToSigned(getCosThumbUrl(item.url, 'medium')),
        cosUrlToSigned(getCosThumbUrl(item.url, 'tiny')),
      ]);
      return { ...item, url, thumbUrl, mediumUrl, lowQualityUrl };
    }
    if (item?.type === 'video' && item.url) {
      const poster = getCosVideoPoster(item.url);
      // 视频走长效签名直链（6 天有效期），让客户端直连 COS 下载，
      // 避免通过服务器代理中转导致的带宽瓶颈（服务器出口带宽有限）。
      // 前端 onError 时可通过 /api/cos/refresh-sign 刷新签名。
      const signedUrl = await cosUrlToSignedLong(item.url);
      const posterSigned = poster ? await cosUrlToSignedLong(poster) : undefined;
      return {
        ...item,
        url: signedUrl,
        thumbUrl: posterSigned,
        posterUrl: posterSigned,
      };
    }
    return item;
  }));
}

/** 头像/封面也走签名 URL，单值便捷封装 */
async function avatarToSigned(url?: string | null): Promise<string | null | undefined> {
  if (!url) return url;
  if (!url.startsWith('https://')) return url;
  if (!(url.includes('.cos.') || url.includes('.myqcloud.com'))) return url;
  // 头像统一压缩到 200x200 webp
  const withProcess = url.includes('?') ? url : url + '?imageMogr2/thumbnail/200x200/format/webp/quality/80';
  return cosUrlToSigned(withProcess);
}

// ============ Session 缓存认证中间件 ============
const SESSION_CACHE_TTL = 60_000; // 1 分钟

async function userAuth(req: Request, res: Response, next: Function) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });

  // L1: 内存缓存
  const cacheKey = `session:${token}`;
  let user = cacheGet<any>(cacheKey);
  if (user) {
    (req as any).user = user;
    return next();
  }

  const session = await prisma.userSession.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.userSession.delete({ where: { token } });
    return res.status(401).json({ error: '登录已过期' });
  }
  (req as any).user = session.user;
  cacheSet(cacheKey, session.user, SESSION_CACHE_TTL);
  next();
}

async function optionalAuth(req: Request, _res: Response, next: Function) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    const cacheKey = `session:${token}`;
    let user = cacheGet<any>(cacheKey);
    if (user) {
      (req as any).user = user;
    } else {
      const session = await prisma.userSession.findUnique({ where: { token }, include: { user: true } });
      if (session && session.expiresAt >= new Date()) {
        (req as any).user = session.user;
        cacheSet(cacheKey, session.user, SESSION_CACHE_TTL);
      }
    }
  }
  next();
}

// ============ 好友列表缓存（L1 + L2） ============
const FRIENDS_CACHE_TTL = 30_000; // 30 秒

async function getFriendIds(userId: string): Promise<string[]> {
  // L1: 内存缓存
  const memKey = `friends:${userId}`;
  let ids = cacheGet<string[]>(memKey);
  if (ids) return ids;

  // L2: Redis 缓存
  const redisKey = `moments:friends:${userId}`;
  ids = await redisCacheGet<string[]>(redisKey);
  if (ids) {
    cacheSet(memKey, ids, FRIENDS_CACHE_TTL);
    return ids;
  }

  // DB 查询
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ userA: userId }, { userB: userId }] },
    select: { userA: true, userB: true },
  });
  ids = friendships.map(f => f.userA === userId ? f.userB : f.userA);
  cacheSet(memKey, ids, FRIENDS_CACHE_TTL);
  await redisCacheSet(redisKey, ids, 60); // Redis 缓存 60 秒
  return ids;
}

// ===== 统一格式化动态数据（供外链页面使用） =====
// 性能优化：改为 async，媒体/头像全部走预签名 URL，避免服务端代理 302 跳转
async function formatMomentForShare(m: any, likedIds: Set<string> = new Set()) {
  const user = m.user || {};

  // 递归格式化评论（支持嵌套回复）
  function formatComment(c: any): any {
    const replyToUser = c.replyTo?.user;
    return {
      id: c.id,
      userId: c.userId,
      userName: c.user ? (c.user.nickname || c.user.username) : '',
      userAvatar: c.user ? avatarToProxy(c.user.avatar) : '',
      content: c.content,
      parentId: c.replyToId || null,
      replyToUserId: replyToUser?.id || null,
      replyToUserName: replyToUser ? (replyToUser.nickname || replyToUser.username) : null,
      createdAt: c.createdAt ? c.createdAt.getTime() : 0,
      isDeleted: false,
    };
  }

  // 展平评论：顶层评论 + 嵌套回复
  const allComments: any[] = [];
  (m.comments || []).slice(0, 50).forEach((c: any) => {
    allComments.push(formatComment(c));
    if (c.replies && c.replies.length > 0) {
      c.replies.forEach((r: any) => allComments.push(formatComment(r)));
    }
  });

  // 媒体 URL 转为预签名 URL（前端一步直达 COS，无 Node 302）
  const proxyMedia = await addThumbUrlsSigned((m.media || []).map((item: any) => ({
    type: item.type,
    url: item.url,
    width: item.width,
    height: item.height,
    duration: item.duration,
    cover: item.cover || null,
  })));

  // 头像 URL 转为预签名 URL（同时压缩到 200x200 webp）
  const proxyAvatar = user.avatar ? (await avatarToSigned(user.avatar)) : '';

  // 向后兼容：老分享页（MomentsSharePage）期望 images / videos / coverUrl 字段。
  // 同时保留 media 供新页面使用。
  const sharedImages: string[] = [];
  const sharedVideos: string[] = [];
  let sharedCoverUrl: string | null = null;
  for (const item of proxyMedia) {
    if (!item || !item.url) continue;
    if (item.type === 'image') {
      // 列表页优先中等质量缩略图，点击可加载原图
      sharedImages.push(item.mediumUrl || item.url);
    } else if (item.type === 'video') {
      sharedVideos.push(item.url);
      if (!sharedCoverUrl) sharedCoverUrl = item.posterUrl || item.thumbUrl || null;
    }
  }

  return {
    id: m.id,
    authorId: user.id || m.userId,
    authorName: user.nickname || user.username || '',
    authorAvatar: proxyAvatar,
    content: m.content,
    media: proxyMedia,
    // 老分享页兼容字段
    images: sharedImages,
    videos: sharedVideos,
    coverUrl: sharedCoverUrl,
    topics: m.topics ? m.topics.split(',').filter(Boolean) : [],
    location: m.location || null,
    visibility: m.visibility,
    isPinned: m.isPinned,
    pinnedAt: m.pinnedAt ? m.pinnedAt.getTime() : null,
    sortOrder: m.sortOrder || 0,
    createdAt: m.createdAt.getTime(),
    updatedAt: m.updatedAt ? m.updatedAt.getTime() : null,
    likeCount: m._count ? m._count.likes : (m.likeCount || 0),
    commentCount: m._count ? m._count.comments : (m.commentCount || 0),
    isLiked: likedIds.has(m.id),
    // 点赞用户列表（最多 20 条）
    likes: (m.likes || []).slice(0, 20).map((l: any) => ({
      userId: l.userId,
      userName: l.user ? (l.user.nickname || l.user.username) : '',
      userAvatar: l.user ? avatarToProxy(l.user.avatar) : '',
      createdAt: l.createdAt ? l.createdAt.getTime() : 0,
    })),
    // 评论列表（展平后包含回复）
    comments: allComments,
  };
}

// ============ 精简的 Feed include（首屏优化：限制评论和点赞数量） ============
const feedIncludeLite = {
  user: { select: { id: true, username: true, nickname: true, avatar: true } },
  media: { orderBy: { sortOrder: 'asc' } as const },
  _count: { select: { comments: true, likes: true } },
  likes: {
    include: { user: { select: { id: true, username: true, nickname: true, avatar: true } } },
    orderBy: { createdAt: 'asc' as const },
    take: 10,
  },
  comments: {
    where: { replyToId: null },
    include: {
      user: { select: { id: true, username: true, nickname: true, avatar: true } },
      replies: {
        include: {
          user: { select: { id: true, username: true, nickname: true, avatar: true } },
          replyTo: { include: { user: { select: { id: true, username: true, nickname: true } } } },
        },
        orderBy: { createdAt: 'asc' as const },
        take: 5,
      },
    },
    orderBy: { createdAt: 'asc' as const },
    take: 10,
  },
};

// ===== 好友朋友圈 Feed（包含自己 + 好友的动态）— 优化版 + Redis 缓存 =====
router.get('/feed', userAuth, async (req: Request, res: Response) => {
  const cursor = req.query.cursor as string;
  const limit = Math.min(20, parseInt(req.query.limit as string) || 10);
  const currentUser = (req as any).user;
  // 发布、删除、置顶等操作后主动刷新时会携带 ?force=1，则跳过一切缓存与 ETag
  const force = req.query.force === '1' || req.query.force === 'true';

  // Redis 缓存 Feed（仅首页，非翻页，且非 force）
  const feedCacheKey = `moments:feed:${currentUser.id}:${cursor || 'first'}:${limit}`;
  if (!cursor && !force) {
    const cachedFeed = await redisCacheGet<any>(feedCacheKey);
    if (cachedFeed) {
      // ETag 支持：如果客户端缓存未变化，返回 304
      const etag = `"feed-${currentUser.id}-${cachedFeed._ts || 0}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=10');
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
      return res.json(cachedFeed);
    }
  } else if (force) {
    // force 刷新时同时清掉这条 key，以免後续请求又读到同一份旧数据
    try { await redis.del(feedCacheKey); } catch {}
    res.setHeader('Cache-Control', 'no-store');
  }

  // 1. 使用缓存获取好友列表
  const friendIds = await getFriendIds(currentUser.id);

  // 2. 查询条件
  const where: any = {
    OR: [
      { userId: currentUser.id },
      {
        userId: { in: friendIds },
        visibility: { in: ['public', 'friends'] },
      },
    ],
  };

  // 3. 并行查询：置顶动态 + 普通动态
  const pinnedPromise = !cursor ? prisma.moment.findMany({
    where: { userId: currentUser.id, isPinned: true },
    include: feedIncludeLite as any,
    orderBy: { pinnedAt: 'desc' },
  }) : Promise.resolve([]);

  const normalWhere: any = { ...where };
  if (cursor) normalWhere.createdAt = { lt: new Date(cursor) };

  const normalPromise = prisma.moment.findMany({
    where: normalWhere,
    include: feedIncludeLite as any,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  // 并行执行两个查询
  const [pinnedMoments, moments] = await Promise.all([pinnedPromise, normalPromise]);

  // 排除置顶动态的重复
  const pinnedIds = new Set(pinnedMoments.map((m: any) => m.id));
  const filteredMoments = moments.filter((m: any) => !pinnedIds.has(m.id));

  const hasMore = filteredMoments.length > limit;
  const normalList = filteredMoments.slice(0, limit);
  const nextCursor = hasMore ? normalList[normalList.length - 1].createdAt.toISOString() : null;

  // 4. 并行查询点赞状态
  const allIds = [...pinnedMoments, ...normalList].map((m: any) => m.id);
  const likedRecords = allIds.length > 0
    ? await prisma.momentLike.findMany({ where: { userId: currentUser.id, momentId: { in: allIds } } })
    : [];
  const likedIds = new Set(likedRecords.map(l => l.momentId));

  const formatMoment = (m: any) => formatMomentForShare(m, likedIds);

  const allMoments = cursor
    ? await Promise.all(normalList.map(formatMoment))
    : await Promise.all([...pinnedMoments.map(formatMoment), ...normalList.map(formatMoment)]);

  const result: any = {
    moments: allMoments,
    hasMore,
    nextCursor,
    _ts: Date.now(),
  };

  // 缓存首页 Feed 到 Redis
  if (!cursor) {
    await redisCacheSet(feedCacheKey, result, REDIS_FEED_TTL);
  }

  // ETag 支持
  const etag = `"feed-${currentUser.id}-${result._ts}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, max-age=10');

  res.json(result);
});

// ===== 获取动态列表（游标分页，置顶优先） =====
router.get('/', optionalAuth, async (req: Request, res: Response) => {
  const cursor = req.query.cursor as string;
  const limit = Math.min(20, parseInt(req.query.limit as string) || 10);
  const userId = req.query.userId as string;
  const currentUser = (req as any).user;
  const isShareMode = !!userId;

  // 分享外链页（未登录访问同一用户公开页）首屏走 Redis 缓存
  // 仅首页（无 cursor）且未登录状态下才走公共缓存，避免不同用户 isLiked 脱靠
  const shareCacheKey = isShareMode && !cursor && !currentUser
    ? `moments:share:${userId}:${limit}`
    : null;
  if (shareCacheKey) {
    const cached = await redisCacheGet<any>(shareCacheKey);
    if (cached) {
      const etag = `"share-${userId}-${cached._ts || 0}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=15');
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      return res.json(cached);
    }
  }

  const where: any = {};
  if (userId) {
    where.userId = userId;
    // 如果已登录用户是该用户的好友，则也显示 friends 可见的动态
    if (currentUser && currentUser.id !== userId) {
      const friendIds = await getFriendIds(currentUser.id);
      if (friendIds.includes(userId)) {
        where.visibility = { in: ['public', 'friends'] };
      } else {
        where.visibility = 'public';
      }
    } else if (currentUser && currentUser.id === userId) {
      // 查看自己的朋友圈，显示所有
      // 不设置 visibility 过滤
    } else {
      where.visibility = 'public';
    }
  } else {
    where.visibility = { in: ['public'] };
  }

  const includeBase = {
    user: { select: { id: true, username: true, nickname: true, avatar: true, backgroundUrl: true, bio: true } },
    media: { orderBy: { sortOrder: 'asc' } as const },
    _count: { select: { comments: true, likes: true } },
    ...(isShareMode ? {
      likes: {
        include: { user: { select: { id: true, username: true, nickname: true, avatar: true } } },
        orderBy: { createdAt: 'asc' as const },
        take: 20,
      },
      comments: {
        where: { replyToId: null },
        include: { user: { select: { id: true, username: true, nickname: true, avatar: true } } },
        orderBy: { createdAt: 'asc' as const },
        take: 50,
      },
    } : {}),
  };

  // 并行查询置顶 + 普通动态
  const pinnedPromise = !cursor ? prisma.moment.findMany({
    where: { ...where, isPinned: true },
    include: includeBase as any,
    orderBy: { pinnedAt: 'desc' },
  }) : Promise.resolve([]);

  const normalWhere: any = { ...where, isPinned: false };
  if (cursor) normalWhere.createdAt = { lt: new Date(cursor) };

  const normalPromise = prisma.moment.findMany({
    where: normalWhere,
    include: includeBase as any,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  const [pinnedMoments, moments] = await Promise.all([pinnedPromise, normalPromise]);

  const hasMore = moments.length > limit;
  const normalList = moments.slice(0, limit);
  const nextCursor = hasMore ? normalList[normalList.length - 1].createdAt.toISOString() : null;

  // 如果有登录用户，查询点赞状态
  let likedIds = new Set<string>();
  if (currentUser) {
    const allIds = [...pinnedMoments, ...normalList].map((m: any) => m.id);
    if (allIds.length > 0) {
      const likes = await prisma.momentLike.findMany({ where: { userId: currentUser.id, momentId: { in: allIds } } });
      likedIds = new Set(likes.map(l => l.momentId));
    }
  }

  const formatMoment = isShareMode
    ? (m: any) => formatMomentForShare(m, likedIds)
    : async (m: any) => ({
        ...m,
        likeCount: m._count.likes,
        commentCount: m._count.comments,
        isLiked: likedIds.has(m.id),
        topics: m.topics ? m.topics.split(',').filter(Boolean) : [],
        // 性能优化：从 /api/cos/proxy 跳转改为预签名直链，减少 90 次往返
        media: await addThumbUrlsSigned(m.media || []),
      });

  const allMoments = cursor
    ? await Promise.all(normalList.map(formatMoment))
    : await Promise.all([...pinnedMoments.map(formatMoment), ...normalList.map(formatMoment)]);

  // 外链模式额外返回用户资料与总动态数
  let total: number | undefined;
  let shareUser: { id: string; username: string; nickname: string | null; avatar: string | null; backgroundUrl: string | null; bio: string | null } | undefined;
  if (isShareMode && !cursor) {
    const [count, user] = await Promise.all([
      prisma.moment.count({ where: { userId, visibility: 'public' } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, nickname: true, avatar: true, backgroundUrl: true, bio: true },
      }),
    ]);
    total = count;
    shareUser = user || undefined;
  }

  const result: any = {
    moments: allMoments,
    hasMore,
    nextCursor,
    ...(total !== undefined ? { total } : {}),
    ...(shareUser ? { user: shareUser, bio: shareUser.bio, backgroundUrl: shareUser.backgroundUrl } : {}),
    _ts: Date.now(),
  };

  // 外链页首屏缓存 30 秒（未登录状态下可公享）
  if (shareCacheKey) {
    await redisCacheSet(shareCacheKey, result, 30);
    const etag = `"share-${userId}-${result._ts}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=15');
  }

  res.json(result);
});

// ===== 发布动态（安全加固 + 限流） =====
router.post('/', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;

  // 发布限流
  const limitResult = publishLimiter.check(`publish:${user.id}`);
  if (!limitResult.allowed) {
    return res.status(429).json({ error: '发布过于频繁，请稍后再试' });
  }

  const { content, visibility = 'public', location, topics, media = [] } = req.body;
  const normalizedContent = typeof content === 'string' ? content.trim() : '';

  if (normalizedContent.length > 5000) return res.status(400).json({ error: '内容超出长度限制（5000 字）' });
  if (Array.isArray(media) && media.length > 9) return res.status(400).json({ error: '最多上传 9 张图片/视频' });

  const videoCount = Array.isArray(media) ? media.filter((item: any) => item?.type === 'video').length : 0;
  if (videoCount > 1) return res.status(400).json({ error: '最多上传 1 个视频' });

  if (!normalizedContent && (!Array.isArray(media) || media.length === 0)) {
    return res.status(400).json({ error: '请输入内容或上传图片/视频' });
  }

  const allowedMediaTypes = ['image', 'video'];
  if (Array.isArray(media)) {
    for (const m of media) {
      if (m.type && !allowedMediaTypes.includes(m.type)) {
        return res.status(400).json({ error: `不支持的媒体类型: ${m.type}` });
      }
      if (m.url && typeof m.url === 'string') {
        if (!m.url.startsWith('https://') && !m.url.startsWith('/')) {
          return res.status(400).json({ error: '媒体 URL 格式无效' });
        }
        if (/^(javascript|data|vbscript):/i.test(m.url)) {
          return res.status(400).json({ error: '媒体 URL 包含不允许的协议' });
        }
      }
    }
  }

  const moment = await prisma.moment.create({
    data: {
      userId: user.id,
      content: normalizedContent.slice(0, 5000),
      visibility,
      location: typeof location === 'string' ? location.slice(0, 200) : location,
      topics: Array.isArray(topics) ? topics.slice(0, 10).join(',') : (typeof topics === 'string' ? topics.slice(0, 200) : topics),
      media: {
        create: (Array.isArray(media) ? media.slice(0, 9) : []).map((m: any, i: number) => ({
          type: allowedMediaTypes.includes(m.type) ? m.type : 'image',
          url: m.url,
          width: m.width,
          height: m.height,
          duration: m.duration,
          sortOrder: i,
        })),
      },
    },
    include: { user: { select: { id: true, username: true, nickname: true, avatar: true } }, media: true, _count: { select: { comments: true, likes: true } } },
  });

  // 发布后清除相关缓存（L1 + L2 全部打掉，避免友看到旧 feed）
  cacheInvalidate('friends:');
  cacheInvalidate('feed:');
  await redisCacheInvalidate(`moments:feed:*`);
  await redisCacheInvalidate(`moments:share:${user.id}:*`);
  await redisCacheInvalidate(`moments:detail:*`);

  const proxyMedia = await addThumbUrlsSigned(moment.media || []);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, moment: { ...moment, likeCount: 0, commentCount: 0, isLiked: false, topics: moment.topics ? moment.topics.split(',').filter(Boolean) : [], media: proxyMedia } });
});

// ===== 获取我的动态列表（用于管理页面） =====
router.get('/my', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const moments = await prisma.moment.findMany({
    where: { userId: user.id },
    include: {
      user: { select: { id: true, username: true, nickname: true, avatar: true } },
      media: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { comments: true, likes: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  });
  const formattedMoments = await Promise.all(moments.map(async m => ({
    id: m.id,
    content: m.content,
    visibility: m.visibility,
    location: m.location,
    isPinned: m.isPinned,
    sortOrder: m.sortOrder,
    createdAt: m.createdAt.getTime(),
    media: await addThumbUrlsSigned((m.media || []).map(item => ({ type: item.type, url: item.url }))),
    likeCount: m._count.likes,
    commentCount: m._count.comments,
  })));
  res.json({ moments: formattedMoments });
});

// ===== 获取单条动态 =====
router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  const currentUser = (req as any).user;

  // Redis 缓存单条动态
  const momentCacheKey = `moments:detail:${req.params.id}`;
  const cachedMoment = await redisCacheGet<any>(momentCacheKey);
  if (cachedMoment && !currentUser) {
    return res.json(cachedMoment);
  }

  const moment = await prisma.moment.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, username: true, nickname: true, avatar: true, backgroundUrl: true, bio: true } },
      media: { orderBy: { sortOrder: 'asc' } },
      comments: { include: { user: { select: { id: true, username: true, nickname: true, avatar: true } }, replies: { include: { user: { select: { id: true, username: true, nickname: true, avatar: true } } } } }, where: { replyToId: null }, orderBy: { createdAt: 'asc' } },
      likes: { include: { user: { select: { id: true, username: true, nickname: true, avatar: true } } } },
      _count: { select: { comments: true, likes: true } },
    },
  });

  if (!moment) return res.status(404).json({ error: '动态不存在' });

  const isLiked = currentUser ? moment.likes.some(l => l.userId === currentUser.id) : false;
  const proxyMedia = await addThumbUrlsSigned(moment.media || []);
  const result = {
    ...moment,
    likeCount: moment._count.likes,
    commentCount: moment._count.comments,
    isLiked,
    topics: moment.topics ? moment.topics.split(',').filter(Boolean) : [],
    media: proxyMedia,
  };

  // 缓存到 Redis（仅未登录用户的结果）
  if (!currentUser) {
    await redisCacheSet(momentCacheKey, result, REDIS_MOMENT_TTL);
  }

  res.json(result);
});

// ===== 删除动态 =====
router.delete('/:id', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const moment = await prisma.moment.findUnique({ where: { id: req.params.id } });
  if (!moment) return res.status(404).json({ error: '动态不存在' });
  if (moment.userId !== user.id && user.role !== 'admin') return res.status(403).json({ error: '无权删除' });
  await prisma.moment.delete({ where: { id: req.params.id } });

  // 清除相关缓存
  await redisCacheInvalidate(`moments:feed:*`);
  await redisCacheInvalidate(`moments:detail:${req.params.id}`);
  // 同时清除该作者的外链页缓存
  if (moment?.userId) await redisCacheInvalidate(`moments:share:${moment.userId}:*`);

  res.json({ success: true });
});

// ===== 点赞/取消点赞（带限流） =====
router.post('/:id/like', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const momentId = req.params.id;

  // 点赞限流
  const limitResult = likeLimiter.check(`like:${user.id}`);
  if (!limitResult.allowed) {
    return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
  }

  const existing = await prisma.momentLike.findUnique({ where: { momentId_userId: { momentId, userId: user.id } } });
  if (existing) {
    await prisma.momentLike.delete({ where: { momentId_userId: { momentId, userId: user.id } } });
    const count = await prisma.momentLike.count({ where: { momentId } });
    // 清除 Feed 缓存
    await redisCacheInvalidate(`moments:feed:${user.id}:*`);
    return res.json({ liked: false, likeCount: count });
  } else {
    await prisma.momentLike.create({ data: { momentId, userId: user.id } });
    const count = await prisma.momentLike.count({ where: { momentId } });
    // 清除 Feed 缓存
    await redisCacheInvalidate(`moments:feed:${user.id}:*`);
    // ★ 实时推送点赞通知给动态作者
    const likedMoment = await prisma.moment.findUnique({ where: { id: momentId }, select: { userId: true } });
    if (likedMoment && likedMoment.userId !== user.id) {
      publishMessage('moment_events', {
        type: 'moment_like_notify',
        targetUserId: likedMoment.userId,
        payload: {
          momentId,
          userId: user.id,
          userName: user.nickname || user.username,
          userAvatar: avatarToProxy(user.avatar),
          liked: true,
          likeCount: count,
        },
      }).catch(() => {});
    }
    return res.json({ liked: true, likeCount: count });
  }
});

// ===== 评论（安全加固 + 限流） =====
router.post('/:id/comments', userAuth, async (req: Request, res: Response) => {
  const { content, replyToId } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '评论内容不能为空' });

  if (content.length > 1000) return res.status(400).json({ error: '评论内容超出长度限制（1000 字）' });

  const user = (req as any).user;

  // 评论限流
  const limitResult = commentLimiter.check(`comment:${user.id}`);
  if (!limitResult.allowed) {
    return res.status(429).json({ error: '评论过于频繁，请稍后再试' });
  }

   const comment = await prisma.momentComment.create({
    data: { momentId: req.params.id, userId: user.id, content: content.trim().slice(0, 1000), replyToId },
    include: { user: { select: { id: true, username: true, nickname: true, avatar: true } } },
  });
  // 清除 Feed 缓存
  await redisCacheInvalidate(`moments:feed:*`);
  // ★ 实时推送评论通知给动态作者
  const commentedMoment = await prisma.moment.findUnique({ where: { id: req.params.id }, select: { userId: true } });
  if (commentedMoment && commentedMoment.userId !== user.id) {
    publishMessage('moment_events', {
      type: 'moment_comment_notify',
      targetUserId: commentedMoment.userId,
      payload: {
        momentId: req.params.id,
        commentId: comment.id,
        userId: user.id,
        userName: user.nickname || user.username,
        userAvatar: avatarToProxy(user.avatar),
        content: content.trim().slice(0, 100),
        replyToId: replyToId || null,
      },
    }).catch(() => {});
  }
  // 如果是回复评论，也通知被回复者
  if (replyToId) {
    const parentComment = await prisma.momentComment.findUnique({ where: { id: replyToId }, select: { userId: true } });
    if (parentComment && parentComment.userId !== user.id && parentComment.userId !== commentedMoment?.userId) {
      publishMessage('moment_events', {
        type: 'moment_comment_notify',
        targetUserId: parentComment.userId,
        payload: {
          momentId: req.params.id,
          commentId: comment.id,
          userId: user.id,
          userName: user.nickname || user.username,
          userAvatar: avatarToProxy(user.avatar),
          content: content.trim().slice(0, 100),
          replyToId,
          isReply: true,
        },
      }).catch(() => {});
    }
  }
  res.json({ success: true, comment });
});

router.delete('/:momentId/comments/:commentId', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const comment = await prisma.momentComment.findUnique({ where: { id: req.params.commentId }, include: { moment: true } });
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  if (comment.userId !== user.id && comment.moment.userId !== user.id) return res.status(403).json({ error: '无权删除' });
  await prisma.momentComment.delete({ where: { id: req.params.commentId } });

  // 清除缓存
  await redisCacheInvalidate(`moments:feed:*`);

  res.json({ success: true });
});

// ===== 置顶/取消置顶（仅作者） =====
router.post('/:id/pin', userAuth, async (req: Request, res: Response) => {
  const { pin } = req.body;
  const user = (req as any).user;
  const moment = await prisma.moment.findUnique({ where: { id: req.params.id } });
  if (!moment) return res.status(404).json({ error: '动态不存在' });
  if (moment.userId !== user.id) return res.status(403).json({ error: '只有作者可以置顶' });

  if (pin) {
    await prisma.moment.updateMany({ where: { userId: user.id, isPinned: true }, data: { isPinned: false, pinnedAt: null } });
  }

  const updated = await prisma.moment.update({ where: { id: req.params.id }, data: { isPinned: !!pin, pinnedAt: pin ? new Date() : null } });

  // 清除 Feed 缓存
  await redisCacheInvalidate(`moments:feed:${user.id}:*`);
  // 置顶变动会影响外链页顺序，同步清理
  await redisCacheInvalidate(`moments:share:${user.id}:*`);

  res.json({ success: true, moment: updated });
});

// ===== 批量排序动态（仅作者） =====
router.put('/reorder', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请提供排序列表' });

  const moments = await prisma.moment.findMany({ where: { id: { in: ids }, userId: user.id }, select: { id: true } });
  const validIds = new Set(moments.map(m => m.id));

  const updates = ids.filter(id => validIds.has(id)).map((id, index) =>
    prisma.moment.update({ where: { id }, data: { sortOrder: index + 1 } })
  );
  await prisma.$transaction(updates);
  res.json({ success: true });
});

// ===== 编辑动态（仅作者） =====
router.put('/:id', userAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const moment = await prisma.moment.findUnique({ where: { id: req.params.id } });
  if (!moment) return res.status(404).json({ error: '动态不存在' });
  if (moment.userId !== user.id) return res.status(403).json({ error: '只有作者可以编辑' });

  const { content, visibility, location } = req.body;
  const data: any = {};
  if (typeof content === 'string') data.content = content.trim().slice(0, 5000);
  if (visibility && ['public', 'friends', 'private'].includes(visibility)) data.visibility = visibility;
  if (typeof location === 'string') data.location = location.slice(0, 200);

  const updated = await prisma.moment.update({ where: { id: req.params.id }, data });

  // 清除缓存
  await redisCacheInvalidate(`moments:feed:*`);
  await redisCacheInvalidate(`moments:detail:${req.params.id}`);
  // 同时清除该作者的外链页缓存
  await redisCacheInvalidate(`moments:share:${moment.userId}:*`);

  res.json({ success: true, moment: updated });
});

// ===== 热门话题（带缓存） =====
router.get('/topics/hot', async (_req: Request, res: Response) => {
  const cacheKey = 'topics:hot';
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  // L2: Redis 缓存
  const redisCached = await redisCacheGet<any>('moments:topics:hot');
  if (redisCached) {
    cacheSet(cacheKey, redisCached, 120_000);
    return res.json(redisCached);
  }

  const moments = await prisma.moment.findMany({ where: { topics: { not: null } }, select: { topics: true }, take: 500 });
  const topicCount = new Map<string, number>();
  moments.forEach(m => {
    if (m.topics) {
      m.topics.split(',').filter(Boolean).forEach(t => {
        topicCount.set(t, (topicCount.get(t) || 0) + 1);
      });
    }
  });
  const hot = Array.from(topicCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));
  const result = { topics: hot };
  cacheSet(cacheKey, result, 120_000); // L1 缓存 2 分钟
  await redisCacheSet('moments:topics:hot', result, 300); // L2 缓存 5 分钟
  res.json(result);
});

export default router;
