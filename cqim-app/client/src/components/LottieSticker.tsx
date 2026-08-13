/**
 * LottieSticker — TG 风格 Lottie 动画贴纸播放器
 * 支持 .json (Lottie) 和 .tgs (GZIP 压缩的 Lottie JSON)
 * 可见性感知：仅在视口可见时播放，滚出视口自动暂停
 * 内存缓存：LottieComposition 缓存避免重复解析
 */
import React, { useRef, useEffect, useState } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';
import { getStickerFromDisk, saveStickerToDisk } from './sticker/stickerDiskCache';
import { stickerPrefetcher } from './sticker/stickerPrefetch';

interface LottieStickerProps {
  /** Lottie JSON 文件 URL (.json / .tgs) 或内联 JSON 对象 */
  src: string | object;
  /** 宽度（px），默认 160 */
  width?: number;
  /** 高度（px），默认 160 */
  height?: number;
  /** 是否循环播放，默认 true */
  loop?: boolean;
  /** 是否自动播放，默认 true */
  autoplay?: boolean;
  /** 点击回调 */
  onClick?: () => void;
  /** 额外 className */
  className?: string;
  /** 加载失败时的降级 emoji 显示 */
  fallbackEmoji?: string;
  /** 可选静态缩略图，优先作为动画失败回退 */
  fallbackSrc?: string;
}

// ===== 全局 Lottie 动画数据缓存（内存 LRU + 磁盘 Cache API） =====
const animationDataCache = new Map<string, object>();
const MAX_MEMORY_CACHE = 40;
const pendingFetches = new Map<string, Promise<object | null>>();

function addToMemoryCache(url: string, data: object) {
  if (animationDataCache.size >= MAX_MEMORY_CACHE) {
    const firstKey = animationDataCache.keys().next().value;
    if (firstKey) animationDataCache.delete(firstKey);
  }
  animationDataCache.set(url, data);
}

/**
 * 获取 Lottie 动画数据（支持 .json 和 .tgs 格式）
 * 带内存缓存、去重请求和重试机制
 */
const failedUrls = new Set<string>();
const activeAnimations = new Map<AnimationItem, number>();
const MAX_ACTIVE_ANIMATIONS = 4;

function playWithConcurrencyLimit(animation: AnimationItem) {
  const now = Date.now();
  if (!activeAnimations.has(animation) && activeAnimations.size >= MAX_ACTIVE_ANIMATIONS) {
    const oldest = Array.from(activeAnimations.entries()).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (oldest) {
      oldest.pause();
      activeAnimations.delete(oldest);
    }
  }
  activeAnimations.set(animation, now);
  animation.play();
}

function releaseAnimation(animation: AnimationItem) {
  animation.pause();
  activeAnimations.delete(animation);
}

async function fetchAnimationData(url: string, retryCount = 0): Promise<object | null> {
  // 1. 内存缓存 L0
  if (animationDataCache.has(url)) {
    return animationDataCache.get(url)!;
  }

  // 2. 磁盘缓存 L1
  const diskData = await getStickerFromDisk(url);
  if (diskData) {
    try {
      let json: object;
      if (url.endsWith('.tgs') || /\.tgs(\?.*)?$/i.test(url)) {
        const { default: pako } = await import('pako');
        const inflated = pako.inflate(new Uint8Array(diskData));
        json = JSON.parse(new TextDecoder().decode(inflated));
      } else {
        json = JSON.parse(new TextDecoder().decode(diskData));
      }
      addToMemoryCache(url, json);
      return json;
    } catch (e) {
      console.warn('[LottieSticker] Disk cache parse failed:', url);
    }
  }

  // 去重：如果同一 URL 正在请求中，复用 Promise
  if (pendingFetches.has(url)) {
    return pendingFetches.get(url)!;
  }

  // 如果之前失败过且不是重试，跳过
  if (failedUrls.has(url) && retryCount === 0) {
    return null;
  }

  const fetchPromise = (async () => {
    try {
      const isTgs = /\.tgs(\?.*)?$/i.test(url);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        console.warn(`[LottieSticker] 加载失败 ${resp.status}: ${url}`);
        failedUrls.add(url);
        return null;
      }

      if (isTgs) {
        const buffer = await resp.arrayBuffer();
        if (typeof DecompressionStream !== 'undefined') {
          try {
            const ds = new DecompressionStream('gzip');
            const decompressed = new Response(
              new Blob([buffer]).stream().pipeThrough(ds)
            );
            const json = await decompressed.json();
            void saveStickerToDisk(url, buffer);
            addToMemoryCache(url, json);
            failedUrls.delete(url);
            return json;
          } catch (decompErr) {
            console.warn(`[LottieSticker] DecompressionStream 解压失败，尝试 pako 回退: ${url}`, decompErr);
          }
        }
        try {
          const { default: pako } = await import('pako');
          const uint8 = new Uint8Array(buffer);
          const inflated = pako.inflate(uint8);
          const text = new TextDecoder('utf-8').decode(inflated);
          const json = JSON.parse(text);
          void saveStickerToDisk(url, buffer);
          addToMemoryCache(url, json);
          failedUrls.delete(url);
          return json;
        } catch (pakoErr) {
          console.error(`[LottieSticker] TGS 解压全部失败: ${url}`, pakoErr);
          failedUrls.add(url);
          return null;
        }
      } else {
        try {
          const responseClone = resp.clone();
          const json = await resp.json();
          const buffer = await responseClone.arrayBuffer();
          void saveStickerToDisk(url, buffer);
          addToMemoryCache(url, json);
          failedUrls.delete(url);
          return json;
        } catch (jsonErr) {
          console.error(`[LottieSticker] JSON 解析失败: ${url}`, jsonErr);
          failedUrls.add(url);
          return null;
        }
      }
    } catch (err) {
      if (retryCount < 2) {
        pendingFetches.delete(url);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return fetchAnimationData(url, retryCount + 1);
      }
      console.error(`[LottieSticker] 请求异常 (重试${retryCount}次后): ${url}`, err);
      failedUrls.add(url);
      return null;
    } finally {
      pendingFetches.delete(url);
    }
  })();

  pendingFetches.set(url, fetchPromise);
  return fetchPromise;
}

/**
 * 预加载贴纸动画数据（可在贴纸面板打开时调用）
 */
export function preloadStickers(urls: string[]) {
  urls.forEach(url => {
    if (!animationDataCache.has(url) && !pendingFetches.has(url)) {
      fetchAnimationData(url);
    }
  });
}

const isIosWebKitRuntime = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isiOSDevice = /iP(hone|ad|od)/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isiOSDevice && /WebKit/i.test(ua);
};

const isTgsSource = (src: string | object) => typeof src === 'string' && /\.tgs(\?.*)?$/i.test(src);

const LottieSticker: React.FC<LottieStickerProps> = ({
  src,
  width = 160,
  height = 160,
  loop = true,
  autoplay = true,
  onClick,
  className = '',
  fallbackEmoji,
  fallbackSrc,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const shouldUseStaticFallback = isTgsSource(src) && isIosWebKitRuntime();

  // 初始化 Lottie 动画
  useEffect(() => {
    if (shouldUseStaticFallback) {
      setIsLoaded(false);
      setHasError(true);
      if (animRef.current) {
        releaseAnimation(animRef.current);
        animRef.current.destroy();
        animRef.current = null;
      }
      return;
    }

    if (!containerRef.current) return;
    let cancelled = false;

    // 清理旧动画
    if (animRef.current) {
      animRef.current.destroy();
      animRef.current = null;
    }

    setIsLoaded(false);
    setHasError(false);

    const initAnimation = async () => {
      if (!containerRef.current || cancelled) return;

      try {
        let animationData: object | null = null;

        if (typeof src === 'string') {
          // 先尝试从缓存获取，否则 fetch
          animationData = await fetchAnimationData(src);
          if (!animationData || cancelled) {
            if (!cancelled) setHasError(true);
            return;
          }
        } else {
          animationData = src;
        }

        if (cancelled || !containerRef.current) return;

        const anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop,
          autoplay: false, // 先不自动播放，等可见性检测
          animationData,
          rendererSettings: {
            preserveAspectRatio: 'xMidYMid meet',
            progressiveLoad: true,
            // 性能优化：减少 SVG 复杂度
            hideOnTransparent: true,
          },
        });

        animRef.current = anim;

        anim.addEventListener('DOMLoaded', () => {
          if (!cancelled) setIsLoaded(true);
        });

        anim.addEventListener('data_failed', () => {
          if (!cancelled) setHasError(true);
        });

        anim.addEventListener('error', () => {
          if (!cancelled) setHasError(true);
        });
      } catch {
        if (!cancelled) setHasError(true);
      }
    };

    initAnimation();

    return () => {
      cancelled = true;
      if (animRef.current) {
        releaseAnimation(animRef.current);
        animRef.current.destroy();
        animRef.current = null;
      }
    };
  }, [src, loop, shouldUseStaticFallback]);

  // 可见性感知：IntersectionObserver 控制播放/暂停
  useEffect(() => {
    if (shouldUseStaticFallback || !containerRef.current || !autoplay) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (animRef.current) {
            if (entry.isIntersecting) {
              playWithConcurrencyLimit(animRef.current);
            } else {
              releaseAnimation(animRef.current);
            }
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [autoplay, isLoaded, shouldUseStaticFallback]);

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width, height }}
      onClick={onClick}
    >
      {/* 骨架屏 / 缩略图占位 */}
      {!shouldUseStaticFallback && !isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl">
          {fallbackSrc ? (
            <img src={fallbackSrc} alt={fallbackEmoji || '贴纸'} width={width} height={height} className="h-full w-full object-contain opacity-50" loading="eager" decoding="async" />
          ) : (
            <div
              className="h-full w-full animate-pulse"
              style={{
                background: 'linear-gradient(135deg, rgba(200,200,200,0.15), rgba(200,200,200,0.08))',
              }}
            />
          )}
        </div>
      )}

      {/* 错误态：优先显示 fallbackEmoji，否则显示占位图标 */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center">
          {fallbackSrc ? (
            <img src={fallbackSrc} alt={fallbackEmoji || '贴纸'} width={width} height={height} className="h-full w-full rounded-2xl object-contain" loading="lazy" decoding="async" />
          ) : fallbackEmoji ? (
            <span style={{ fontSize: Math.round(width * 0.55) }}>{fallbackEmoji}</span>
          ) : (
            <div className="text-muted-foreground/40">
              <svg width={Math.min(width * 0.5, 32)} height={Math.min(height * 0.5, 32)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 15h8M9 9h.01M15 9h.01" />
              </svg>
            </div>
          )}
        </div>
      )}

      {/* Lottie 容器 */}
      {!shouldUseStaticFallback && (
        <div
          ref={containerRef}
          style={{
            width,
            height,
            opacity: isLoaded ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
        />
      )}
    </div>
  );
};

export default LottieSticker;
