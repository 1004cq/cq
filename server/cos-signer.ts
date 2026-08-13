/**
 * server/cos-signer.ts
 *
 * COS 签名 URL 工具（性能优化模块 v1）
 * - 单例 COS SDK 实例（避免每次 require + new COS()）
 * - 系统配置短期内存缓存（避免每张图都查一次 Prisma）
 * - 签名 URL 缓存（同 key + 处理参数 50 分钟内复用）
 *
 * 设计目标：
 *   朋友圈列表页一屏 9 张图 × 10 条 = 90 张图，原本每张图都要：
 *     1) Prisma 查 SystemConfig
 *     2) 加载 cos-nodejs-sdk-v5 + new COS()
 *     3) 同步签名 URL
 *     4) 浏览器接 302 后再发一次请求到 COS
 *   优化后：
 *     1) 系统配置缓存 5 分钟
 *     2) SDK 单例 + 复用
 *     3) 签名 URL 缓存（命中即 0 计算）
 *     4) 列表接口直接返回签名 URL，前端 <img src=> 一步直达 COS
 */
import prisma from './db.js';

// ---------- 系统配置缓存 ----------
let cosConfigCache: { value: any; expireAt: number } | null = null;
const COS_CONFIG_TTL_MS = 5 * 60_000; // 5 分钟

export async function getCosConfig(): Promise<any | null> {
  if (cosConfigCache && Date.now() < cosConfigCache.expireAt) {
    return cosConfigCache.value;
  }
  const cfg = await prisma.systemConfig.findUnique({ where: { key: 'cos' } }).catch(() => null);
  let value: any = null;
  if (cfg?.value) {
    try { value = JSON.parse(cfg.value); } catch { value = null; }
  }
  cosConfigCache = { value, expireAt: Date.now() + COS_CONFIG_TTL_MS };
  return value;
}

/** 管理后台修改 COS 配置后调用，立即清缓存 */
export function invalidateCosConfigCache(): void {
  cosConfigCache = null;
  signedUrlCache.clear();
  cosClient = null;
  cosClientCreds = '';
}

// ---------- COS SDK 单例 ----------
let cosClient: any = null;
let cosClientCreds = '';

async function getCosClient(secretId: string, secretKey: string): Promise<any> {
  const credKey = `${secretId}:${secretKey}`;
  if (cosClient && cosClientCreds === credKey) return cosClient;
  const COSModule: any = await import('cos-nodejs-sdk-v5');
  const COS = COSModule.default || COSModule;
  cosClient = new COS({ SecretId: secretId, SecretKey: secretKey, FileParallelLimit: 8 });
  cosClientCreds = credKey;
  return cosClient;
}

// ---------- 签名 URL 缓存 ----------
interface SignedUrlEntry { url: string; expireAt: number; }
const signedUrlCache = new Map<string, SignedUrlEntry>();
const SIGNED_URL_VALID_SECONDS = 3600;          // 签发 1 小时（图片用）
const SIGNED_URL_CACHE_TTL_MS = 50 * 60_000;    // 缓存 50 分钟（留 10 分钟余量）
const SIGNED_URL_LONG_VALID_SECONDS = 6 * 24 * 3600;   // 签发 6 天（视频用，COS 上限 7 天）
const SIGNED_URL_LONG_CACHE_TTL_MS = 5 * 24 * 3600_000; // 缓存 5 天
const MAX_CACHE_ENTRIES = 5000;

/** 检查是否是 COS URL */
export function isCosUrl(url: string): boolean {
  if (!url || !url.startsWith('https://')) return false;
  // 增加对自定义域名 imim.chat 的支持，确保朋友圈视频能正确识别并签名
  return url.includes('.cos.') || url.includes('.myqcloud.com') || url.includes('imim.chat');
}

/**
 * COS Key 中文路径段 ↔ ASCII 别名 双向映射
 *
 * 历史 Key 形如 `imimchat/头像/{uid}/...`、`imimchat/群头像/{gid}/...`、
 * `imimchat/朋友圈/{uid}/照片|视频/...`，URL 走 EdgeOne CDN 时其百分号编码会在
 * 回源时被解码成 raw UTF-8 字节，触发 Node.js HTTP parser 直接返回 400。
 *
 * 解决方法：对外（前端 / CDN）一律使用纯 ASCII 别名 URL，对内（COS 签名）仍使用
 * 原始中文 Key，不需要迁移历史对象。
 */
const ZH_TO_ASCII_SEG: Record<string, string> = {
  '头像': 'avatars',
  '群头像': 'group-avatars',
  '朋友圈': 'moments',
  '照片': 'photos',
  '视频': 'videos',
};
const ASCII_TO_ZH_SEG: Record<string, string> = Object.fromEntries(
  Object.entries(ZH_TO_ASCII_SEG).map(([zh, en]) => [en, zh]),
);

/** cosKey 中文段 → ASCII 别名（仅用于生成对外可见的 URL） */
export function cosKeyToAlias(cosKey: string): string {
  if (!cosKey) return cosKey;
  return cosKey.split('/').map(seg => ZH_TO_ASCII_SEG[seg] || seg).join('/');
}

/** ASCII 别名 → 真实 COS Key（用于上行签名 / 拉取） */
export function aliasToCosKey(alias: string): string {
  if (!alias) return alias;
  return alias.split('/').map(seg => ASCII_TO_ZH_SEG[seg] || seg).join('/');
}

/**
 * 把 COS 直链转换为站内代理 URL（无过期、可被 Nginx/CDN 缓存）
 * 例：https://bucket.cos.ap-hongkong.myqcloud.com/imimchat/朋友圈/uid/视频/x.mp4
 *  →  /api/cos/proxy/imimchat/moments/uid/videos/x.mp4
 * 处理参数（imageMogr2 / ci-process 等）原样保留
 *
 * 注意：返回的 URL 路径段全部是 ASCII，不再出现中文 → 不会触发 EdgeOne
 * 回源时 raw UTF-8 字节导致 Node 400 的问题。
 */
export function cosUrlToProxy(rawUrl: string): string {
  if (!isCosUrl(rawUrl)) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const cosKey = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const aliasKey = cosKeyToAlias(cosKey);
    const query = u.search || '';
    // path 段中只有 ASCII 字符，仍然走 encodeURI 以转义保留字符
    const safePath = aliasKey.split('/').map(encodeURIComponent).join('/');
    return `/api/cos/proxy/${safePath}${query}`;
  } catch {
    return rawUrl;
  }
}

function pruneCache() {
  if (signedUrlCache.size < MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  let removed = 0;
  for (const [k, v] of signedUrlCache) {
    if (now > v.expireAt) {
      signedUrlCache.delete(k);
      removed++;
    }
  }
  // 仍超大则按插入顺序清掉一半
  if (signedUrlCache.size >= MAX_CACHE_ENTRIES) {
    const target = Math.floor(MAX_CACHE_ENTRIES / 2);
    let toRemove = signedUrlCache.size - target;
    for (const k of signedUrlCache.keys()) {
      if (toRemove-- <= 0) break;
      signedUrlCache.delete(k);
    }
  }
  if (removed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[cos-signer] 已清理 ${removed} 条过期签名缓存`);
  }
}

/**
 * 为 COS Key 生成签名 URL（带缓存），可附加图片处理参数（imageMogr2 / ci-process 等）
 * @param cosKey 已 decode 的对象 Key（如 "朋友圈/uid/照片/x.jpg"）。
 *               接受 ASCII 别名路径（如 imimchat/avatars/uid/...），会自动还原为真实 Key。
 * @param processQuery 可选的处理参数（不带 '?'）
 * @param longLived 是否使用长效签名（视频/分享外链场景，签发 6 天）
 */
export async function getSignedUrl(cosKey: string, processQuery = '', longLived = false): Promise<string | null> {
  if (!cosKey) return null;
  // 允许调用者传 ASCII 别名，内部还原为真实 Key 后再签名
  cosKey = aliasToCosKey(cosKey);
  const cfg = await getCosConfig();
  const secretId = cfg?.secretId || process.env.COS_SECRET_ID;
  const secretKey = cfg?.secretKey || process.env.COS_SECRET_KEY;
  const bucket = cfg?.bucket || process.env.COS_BUCKET;
  const region = cfg?.region || process.env.COS_REGION || 'ap-guangzhou';
  if (!secretId || !secretKey || !bucket || !region) return null;

  const expires = longLived ? SIGNED_URL_LONG_VALID_SECONDS : SIGNED_URL_VALID_SECONDS;
  const ttl = longLived ? SIGNED_URL_LONG_CACHE_TTL_MS : SIGNED_URL_CACHE_TTL_MS;

  const cacheKey = `${longLived ? 'L:' : ''}${bucket}/${region}/${cosKey}?${processQuery}`;
  const hit = signedUrlCache.get(cacheKey);
  if (hit && Date.now() < hit.expireAt) return hit.url;

  const client = await getCosClient(secretId, secretKey);
  const baseUrl: string = await new Promise((resolve, reject) => {
    client.getObjectUrl(
      { Bucket: bucket, Region: region, Key: cosKey, Sign: true, Expires: expires },
      (err: any, data: any) => err ? reject(err) : resolve(data.Url),
    );
  });

  let finalUrl = baseUrl;
  if (processQuery) {
    finalUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + processQuery;
  }

  signedUrlCache.set(cacheKey, { url: finalUrl, expireAt: Date.now() + ttl });
  pruneCache();
  return finalUrl;
}

/** 视频 / 分享外链等需要长效访问的资源（6 天有效期，COS 上限 7 天） */
export async function getSignedUrlLong(cosKey: string, processQuery = ''): Promise<string | null> {
  return getSignedUrl(cosKey, processQuery, true);
}

/**
 * 把任意 COS 直链 URL 转换为签名 URL（保留 imageMogr2/ci-process 处理参数）
 * 本地 / 非 COS URL 原样返回
 * @param longLived 视频 / 分享外链场景使用 6 天有效期，避免页面停留过久后视频 403
 */
export async function cosUrlToSigned(rawUrl: string, longLived = false): Promise<string> {
  if (!rawUrl) return rawUrl;
  if (!rawUrl.startsWith('https://')) return rawUrl;
  if (!(rawUrl.includes('.cos.') || rawUrl.includes('.myqcloud.com'))) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const cosKey = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const processQuery = u.search.replace(/^\?/, '');
    const signed = await getSignedUrl(cosKey, processQuery, longLived);
    return signed || rawUrl;
  } catch {
    return rawUrl;
  }
}

/** 视频 / 分享外链等需要长效访问的资源（6 天有效期，COS 上限 7 天） */
export async function cosUrlToSignedLong(rawUrl: string): Promise<string> {
  return cosUrlToSigned(rawUrl, true);
}

/** 批量转换，使用并发但内部命中缓存时几乎瞬时 */
export async function cosUrlsToSigned(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map((u) => cosUrlToSigned(u)));
}

/**
 * 将头像 COS 直链转换为代理 URL（附带缩略图处理参数）
 * 非 COS URL 原样返回
 * 用于所有返回 avatar 字段的 API 接口，统一解决私有存储桶 403 问题
 */
export function avatarToProxy(rawUrl: string | null | undefined): string {
  if (!rawUrl) return '';
  if (!isCosUrl(rawUrl)) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const cosKey = decodeURIComponent(u.pathname.replace(/^\//, ''));
    // 对外一律使用 ASCII 别名，避免 EdgeOne 回源时 raw UTF-8 字节触发 Node 400
    const aliasKey = cosKeyToAlias(cosKey);
    const safePath = aliasKey.split('/').map(encodeURIComponent).join('/');
    // 头像统一压缩到 200x200 webp 以加速加载
    const processQuery = 'imageMogr2/thumbnail/200x200/format/webp/quality/80';
    return `/api/cos/proxy/${safePath}?${processQuery}`;
  } catch {
    return rawUrl;
  }
}

/**
 * 从任意 COS 直链 URL 提取已 decode 的 cosKey 与处理参数（imageMogr2/ci-process 等）
 * 用于 /api/cos/refresh-sign 这类需要"原 URL → 重新签名"的场景。
 */
export function parseCosUrl(rawUrl: string): { cosKey: string; processQuery: string } | null {
  if (!isCosUrl(rawUrl)) return null;
  try {
    const u = new URL(rawUrl);
    const cosKey = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const processQuery = u.search.replace(/^\?/, '');
    return { cosKey, processQuery };
  } catch {
    return null;
  }
}
