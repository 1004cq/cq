/**
 * 朋友圈媒体预加载工具
 * - 图片：通过 new Image() 提前触发 CDN 预热
 * - 视频：通过隐藏 <video preload="metadata"> 拉取头部元数据
 * - 微信内置浏览器（X5 内核）的播放权限激活 Hack（WeixinJSBridgeReady）
 *
 * 设计要点：
 * 1. 全部走幂等去重（已加载的 URL 不重复请求）
 * 2. 弱网（2g / save-data）自动跳过预加载，避免吃流量
 * 3. SSR 安全：在没有 window 时直接 no-op
 */
const preloadedUrls = new Set<string>();

/**
 * 弱网检测，与 MomentsPage 的实现保持一致
 */
function isSlowNetwork(): boolean {
  if (typeof navigator === 'undefined') return false;
  try {
    const conn =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const t = conn.effectiveType || '';
    return t === 'slow-2g' || t === '2g' || t === '3g';
  } catch {
    return false;
  }
}

/**
 * 微信内置浏览器（X5）检测
 */
export function isWeChatBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent || '');
}

/**
 * 微信 X5 内核检测（移动端微信浏览器）
 */
export function isAndroidWeChat(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /MicroMessenger/i.test(ua) && /Android/i.test(ua);
}

/**
 * 预加载单张图片
 * 浏览器会自动缓存，后续 <img> 标签使用相同 URL 时几乎无延迟
 */
export function preloadImage(url: string): void {
  if (!url || typeof window === 'undefined') return;
  if (preloadedUrls.has(url)) return;
  if (isSlowNetwork()) return;
  preloadedUrls.add(url);
  try {
    const img = new Image();
    // decoding=async 不阻塞主线程
    (img as any).decoding = 'async';
    img.src = url;
  } catch {
    // ignore
  }
}

/**
 * 批量预加载图片
 */
export function preloadImages(urls: string[]): void {
  if (!Array.isArray(urls)) return;
  for (const u of urls) preloadImage(u);
}

/**
 * 预加载视频（仅头部元数据 + 封面图）
 * - 不会下载视频本体，只加载 moov box 等头部信息
 * - 加快后续点击 / 进入可视区时的播放速度
 */
export function preloadVideo(videoUrl: string, posterUrl?: string): void {
  if (!videoUrl || typeof window === 'undefined') return;
  if (preloadedUrls.has(videoUrl)) return;
  if (isSlowNetwork()) return;
  preloadedUrls.add(videoUrl);

  // 1. 预加载封面（如果有）
  if (posterUrl) preloadImage(posterUrl);

  // 2. 预加载视频元数据
  try {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    (v as any).playsInline = true;
    v.src = videoUrl;
    // 显式触发加载头部信息
    try { v.load(); } catch { /* ignore */ }
  } catch {
    // ignore
  }
}

/**
 * 批量预加载视频（封面 + 元数据）
 */
export function preloadVideos(items: Array<{ videoUrl: string; posterUrl?: string }>): void {
  if (!Array.isArray(items)) return;
  for (const it of items) preloadVideo(it.videoUrl, it.posterUrl);
}

/**
 * 给定一组朋友圈动态，提前预加载它们的媒体（仅缩略图 + 视频封面 + 视频元数据）
 * - 调用方一般只把"下方一两屏"的动态传进来，避免一次性加载全部
 */
export function preloadMomentsMedia(
  posts: Array<{ media: Array<{ type: 'image' | 'video'; url: string; thumbUrl?: string; mediumUrl?: string; posterUrl?: string }> }>,
  options: { maxImages?: number; maxVideos?: number } = {}
): void {
  if (!Array.isArray(posts) || posts.length === 0) return;
  if (isSlowNetwork()) return;
  const maxImages = options.maxImages ?? 24;
  const maxVideos = options.maxVideos ?? 4;
  let imgCnt = 0;
  let vidCnt = 0;
  for (const p of posts) {
    if (!p?.media) continue;
    for (const m of p.media) {
      if (m.type === 'image' && imgCnt < maxImages) {
        const u = m.thumbUrl || m.mediumUrl || m.url;
        if (u) {
          preloadImage(u);
          imgCnt++;
        }
      } else if (m.type === 'video' && vidCnt < maxVideos) {
        if (m.url) {
          preloadVideo(m.url, m.posterUrl || m.thumbUrl);
          vidCnt++;
        }
      }
      if (imgCnt >= maxImages && vidCnt >= maxVideos) return;
    }
  }
}

/**
 * 微信内置浏览器播放权限激活 Hack
 *
 * 在 iOS 微信中，必须等 WeixinJSBridge ready 后调用一次 play()，
 * 才能正常自动播放（即便 muted）。
 *
 * 使用：组件挂载时调用一次即可，全局只生效一次。
 */
let weixinHackBound = false;
export function setupWeChatVideoAutoPlayHack(): void {
  if (typeof window === 'undefined') return;
  if (!isWeChatBrowser()) return;
  if (weixinHackBound) return;
  weixinHackBound = true;

  const trigger = () => {
    try {
      const videos = document.querySelectorAll('video');
      videos.forEach((v) => {
        try {
          const vh = v as HTMLVideoElement;
          vh.muted = true;
          (vh as any).playsInline = true;
          const p = vh.play();
          if (p && typeof p.then === 'function') {
            p.then(() => vh.pause()).catch(() => { /* ignore */ });
          }
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  };

  if ((window as any).WeixinJSBridge) {
    trigger();
  } else {
    document.addEventListener('WeixinJSBridgeReady', trigger, false);
  }
}

/**
 * 重置预加载缓存（一般用于路由切换 / 内存紧张时）
 */
export function resetPreloadCache(): void {
  preloadedUrls.clear();
}
