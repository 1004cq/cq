/**
 * server/cdn-preheat.ts
 *
 * 腾讯云 CDN 自动预热模块
 * - 调用 PushUrlsCache API 将资源 URL 推送至 CDN 边缘节点
 * - 支持批量预热（每次最多 500 条，每日限额 1000 条）
 * - 内置去重、限流、队列化，避免重复预热和超频
 * - 使用 TC3-HMAC-SHA256 签名（腾讯云 API 3.0 标准）
 *
 * 环境变量：
 *   TENCENT_SECRET_ID   — 腾讯云 API 密钥 ID
 *   TENCENT_SECRET_KEY  — 腾讯云 API 密钥 Key
 *   CDN_DOMAIN          — CDN 加速域名（如 cdn.yourdomain.com）
 *   CDN_PREHEAT_AREA    — 预热区域：mainland / overseas / global（默认 mainland）
 */
import crypto from 'crypto';

// ============ 配置 ============

const TENCENT_API_HOST = 'cdn.tencentcloudapi.com';
const API_VERSION = '2018-06-06';
const API_ACTION = 'PushUrlsCache';
const MAX_URLS_PER_REQUEST = 500;
const MAX_DAILY_QUOTA = 1000;
const REQUEST_INTERVAL_MS = 200; // 限流：最少间隔 200ms（≤5次/秒，远低于 20次/秒 限制）

// ============ 状态追踪 ============

interface PreheatRecord {
  taskId: string;
  urls: string[];
  area: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

/** 今日已预热 URL 计数（按日期重置） */
let dailyPreheatCount = 0;
let dailyResetDate = '';

/** 已预热 URL 去重集合（24 小时内不重复预热） */
const preheatedUrlSet = new Map<string, number>(); // url -> timestamp
const DEDUP_TTL_MS = 24 * 3600_000; // 24 小时

/** 预热历史记录（最近 100 条） */
const preheatHistory: PreheatRecord[] = [];
const MAX_HISTORY = 100;

/** 上次请求时间戳（限流用） */
let lastRequestTime = 0;

// ============ TC3-HMAC-SHA256 签名 ============

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getDateString(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

/**
 * 生成 TC3-HMAC-SHA256 签名
 * 参考：https://cloud.tencent.com/document/api/228/30977
 */
function signRequest(
  secretId: string,
  secretKey: string,
  payload: string,
  timestamp: number,
): { authorization: string; timestamp: number } {
  const service = 'cdn';
  const date = getDateString(timestamp);
  const algorithm = 'TC3-HMAC-SHA256';

  // Step 1: 拼接规范请求串
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_API_HOST}\nx-tc-action:${API_ACTION.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedPayload = sha256(payload);
  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  // Step 2: 拼接待签名字符串
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = sha256(canonicalRequest);
  const stringToSign = [algorithm, String(timestamp), credentialScope, hashedCanonicalRequest].join('\n');

  // Step 3: 计算签名
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  // Step 4: 拼接 Authorization
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, timestamp };
}

// ============ 核心预热函数 ============

/**
 * 检查并重置每日计数
 */
function checkDailyReset(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyResetDate !== today) {
    dailyPreheatCount = 0;
    dailyResetDate = today;
    // 清理过期的去重记录
    const now = Date.now();
    for (const [url, ts] of preheatedUrlSet) {
      if (now - ts > DEDUP_TTL_MS) {
        preheatedUrlSet.delete(url);
      }
    }
  }
}

/**
 * 过滤已预热的 URL（24 小时内去重）
 */
function filterNewUrls(urls: string[]): string[] {
  const now = Date.now();
  return urls.filter(url => {
    const lastTime = preheatedUrlSet.get(url);
    return !lastTime || (now - lastTime > DEDUP_TTL_MS);
  });
}

/**
 * 记录已预热的 URL
 */
function markAsPreheated(urls: string[]): void {
  const now = Date.now();
  urls.forEach(url => preheatedUrlSet.set(url, now));
}

/**
 * 添加预热历史记录
 */
function addHistory(record: PreheatRecord): void {
  preheatHistory.unshift(record);
  if (preheatHistory.length > MAX_HISTORY) {
    preheatHistory.length = MAX_HISTORY;
  }
}

/**
 * 限流等待
 */
async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * 调用腾讯云 CDN PushUrlsCache API
 */
async function callPushUrlsCache(urls: string[], area: string): Promise<{ taskId: string; requestId: string }> {
  const secretId = process.env.TENCENT_SECRET_ID || '';
  const secretKey = process.env.TENCENT_SECRET_KEY || '';

  if (!secretId || !secretKey) {
    throw new Error('缺少腾讯云 API 密钥配置（TENCENT_SECRET_ID / TENCENT_SECRET_KEY）');
  }

  const payload = JSON.stringify({
    Urls: urls,
    Area: area,
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const { authorization } = signRequest(secretId, secretKey, payload, timestamp);

  const response = await fetch(`https://${TENCENT_API_HOST}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Host: TENCENT_API_HOST,
      'X-TC-Action': API_ACTION,
      'X-TC-Version': API_VERSION,
      'X-TC-Timestamp': String(timestamp),
      Authorization: authorization,
    },
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json() as any;

  if (result.Response?.Error) {
    const err = result.Response.Error;
    throw new Error(`[${err.Code}] ${err.Message}`);
  }

  return {
    taskId: result.Response?.TaskId || '',
    requestId: result.Response?.RequestId || '',
  };
}

// ============ 公开 API ============

export interface PreheatOptions {
  /** 预热区域：mainland / overseas / global */
  area?: string;
  /** 是否跳过去重检查 */
  force?: boolean;
  /** 来源标识（用于日志） */
  source?: string;
}

export interface PreheatResult {
  success: boolean;
  /** 实际预热的 URL 数量 */
  preheatedCount: number;
  /** 跳过的 URL 数量（已预热/去重） */
  skippedCount: number;
  /** 各批次的 TaskId */
  taskIds: string[];
  /** 今日已用预热配额 */
  dailyUsed: number;
  /** 今日剩余预热配额 */
  dailyRemaining: number;
  /** 错误信息（部分失败时） */
  errors: string[];
}

/**
 * 预热指定 URL 列表到 CDN 节点
 *
 * 自动处理：
 * - 去重（24 小时内不重复预热同一 URL）
 * - 分批（每批最多 500 条）
 * - 限流（请求间隔 ≥ 200ms）
 * - 配额检查（每日最多 1000 条）
 */
export async function preheatUrls(urls: string[], options: PreheatOptions = {}): Promise<PreheatResult> {
  const area = options.area || process.env.CDN_PREHEAT_AREA || 'mainland';
  const source = options.source || 'manual';

  checkDailyReset();

  // 去重过滤
  const newUrls = options.force ? [...urls] : filterNewUrls(urls);
  const skippedCount = urls.length - newUrls.length;

  if (newUrls.length === 0) {
    console.log(`[CDN-Preheat] 所有 ${urls.length} 条 URL 已在 24 小时内预热过，跳过`);
    return {
      success: true,
      preheatedCount: 0,
      skippedCount,
      taskIds: [],
      dailyUsed: dailyPreheatCount,
      dailyRemaining: Math.max(0, MAX_DAILY_QUOTA - dailyPreheatCount),
      errors: [],
    };
  }

  // 配额检查
  const remaining = MAX_DAILY_QUOTA - dailyPreheatCount;
  if (remaining <= 0) {
    const msg = `今日预热配额已用完（${dailyPreheatCount}/${MAX_DAILY_QUOTA}）`;
    console.warn(`[CDN-Preheat] ${msg}`);
    return {
      success: false,
      preheatedCount: 0,
      skippedCount,
      taskIds: [],
      dailyUsed: dailyPreheatCount,
      dailyRemaining: 0,
      errors: [msg],
    };
  }

  // 截断到剩余配额
  const urlsToProcess = newUrls.slice(0, remaining);
  const taskIds: string[] = [];
  const errors: string[] = [];
  let totalPreheated = 0;

  // 分批处理
  for (let i = 0; i < urlsToProcess.length; i += MAX_URLS_PER_REQUEST) {
    const batch = urlsToProcess.slice(i, i + MAX_URLS_PER_REQUEST);

    try {
      await throttle();
      const { taskId } = await callPushUrlsCache(batch, area);
      taskIds.push(taskId);
      totalPreheated += batch.length;
      dailyPreheatCount += batch.length;
      markAsPreheated(batch);

      addHistory({
        taskId,
        urls: batch,
        area,
        timestamp: Date.now(),
        success: true,
      });

      console.log(
        `[CDN-Preheat] 批次 ${Math.floor(i / MAX_URLS_PER_REQUEST) + 1} 成功：` +
        `${batch.length} 条 URL，TaskId=${taskId}，来源=${source}，区域=${area}`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`批次 ${Math.floor(i / MAX_URLS_PER_REQUEST) + 1} 失败: ${errMsg}`);

      addHistory({
        taskId: '',
        urls: batch,
        area,
        timestamp: Date.now(),
        success: false,
        error: errMsg,
      });

      console.error(`[CDN-Preheat] 批次失败:`, errMsg);
    }
  }

  return {
    success: errors.length === 0,
    preheatedCount: totalPreheated,
    skippedCount: skippedCount + (newUrls.length - urlsToProcess.length),
    taskIds,
    dailyUsed: dailyPreheatCount,
    dailyRemaining: Math.max(0, MAX_DAILY_QUOTA - dailyPreheatCount),
    errors,
  };
}

/**
 * 从贴纸包数据中提取所有可预热的 CDN URL
 * 只提取指向 CDN 域名的 URL（忽略第三方如 lottiefiles.com）
 */
export function extractStickerUrls(
  stickers: Array<{ url?: string; thumbUrl?: string; file?: string }>,
  cdnDomain?: string,
): string[] {
  const domain = cdnDomain || process.env.CDN_DOMAIN || '';
  if (!domain) return [];

  const urls: string[] = [];

  for (const sticker of stickers) {
    const candidates = [sticker.url, sticker.thumbUrl].filter(Boolean) as string[];
    for (const url of candidates) {
      // 只预热 CDN 域名下的资源
      if (url.includes(domain)) {
        urls.push(url);
      }
    }
  }

  return [...new Set(urls)]; // 去重
}

/**
 * 预热贴纸包中的所有 CDN 资源
 * 在安装贴纸包时自动调用
 */
export async function preheatStickerPack(
  pack: { id: string; name: string; stickers: Array<{ url?: string; thumbUrl?: string; file?: string }> },
  options: PreheatOptions = {},
): Promise<PreheatResult> {
  const urls = extractStickerUrls(pack.stickers);

  if (urls.length === 0) {
    console.log(`[CDN-Preheat] 贴纸包 "${pack.name}" (${pack.id}) 无需预热的 CDN URL`);
    return {
      success: true,
      preheatedCount: 0,
      skippedCount: 0,
      taskIds: [],
      dailyUsed: dailyPreheatCount,
      dailyRemaining: Math.max(0, MAX_DAILY_QUOTA - dailyPreheatCount),
      errors: [],
    };
  }

  console.log(`[CDN-Preheat] 开始预热贴纸包 "${pack.name}" (${pack.id})，共 ${urls.length} 条 URL`);
  return preheatUrls(urls, {
    ...options,
    source: options.source || `sticker-pack:${pack.id}`,
  });
}

/**
 * 预热任意资源 URL 列表（通用入口）
 * 自动过滤非 CDN 域名的 URL
 */
export async function preheatCdnResources(
  rawUrls: string[],
  options: PreheatOptions = {},
): Promise<PreheatResult> {
  const domain = process.env.CDN_DOMAIN || '';

  // 如果配置了 CDN 域名，只预热该域名下的资源；否则预热所有 https URL
  const urls = domain
    ? rawUrls.filter(url => url.includes(domain))
    : rawUrls.filter(url => url.startsWith('https://') || url.startsWith('http://'));

  if (urls.length === 0) {
    return {
      success: true,
      preheatedCount: 0,
      skippedCount: rawUrls.length,
      taskIds: [],
      dailyUsed: dailyPreheatCount,
      dailyRemaining: Math.max(0, MAX_DAILY_QUOTA - dailyPreheatCount),
      errors: [],
    };
  }

  return preheatUrls(urls, options);
}

// ============ 状态查询 ============

export interface PreheatStatus {
  enabled: boolean;
  cdnDomain: string;
  area: string;
  dailyQuota: number;
  dailyUsed: number;
  dailyRemaining: number;
  cachedUrlCount: number;
  historyCount: number;
  recentHistory: PreheatRecord[];
}

/**
 * 获取预热模块状态
 */
export function getPreheatStatus(): PreheatStatus {
  checkDailyReset();

  const secretId = process.env.TENCENT_SECRET_ID || '';
  const secretKey = process.env.TENCENT_SECRET_KEY || '';
  const cdnDomain = process.env.CDN_DOMAIN || '';
  const area = process.env.CDN_PREHEAT_AREA || 'mainland';

  return {
    enabled: !!(secretId && secretKey),
    cdnDomain,
    area,
    dailyQuota: MAX_DAILY_QUOTA,
    dailyUsed: dailyPreheatCount,
    dailyRemaining: Math.max(0, MAX_DAILY_QUOTA - dailyPreheatCount),
    cachedUrlCount: preheatedUrlSet.size,
    historyCount: preheatHistory.length,
    recentHistory: preheatHistory.slice(0, 20),
  };
}

/**
 * 获取完整预热历史
 */
export function getPreheatHistory(limit = 50): PreheatRecord[] {
  return preheatHistory.slice(0, Math.min(limit, MAX_HISTORY));
}

/**
 * 检查预热功能是否可用
 */
export function isPreheatEnabled(): boolean {
  return !!(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY);
}
