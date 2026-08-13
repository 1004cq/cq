/**
 * imim 朋友圈（发现）页面 — 微信朋友圈风格
 * 性能优化版：图片懒加载、React.memo、骨架屏、滚动节流
 */
import React, { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import { useCurrentUserState, useAppActions } from '@/contexts/AppContext';
import { useTheme } from '@/contexts/ThemeContext';
import { DoveAvatar } from '@/components/DoveAvatar';
import VirtualFeedList from '@/components/VirtualFeedList';
import { formatTime, CURRENT_USER, type MomentPost } from '@/lib/store';
import { AnimatePresence } from 'framer-motion';
import { authApi, authFetch } from '@/lib/authFetch';
import { toast } from 'sonner';
import {
  preloadMomentsMedia,
  setupWeChatVideoAutoPlayHack,
  isWeChatBrowser,
} from '@/lib/momentsPreloader';

const MOMENTS_COVER_STORAGE_KEY = 'cqim_moments_cover_image';
const FEED_CACHE_KEY = 'cqim_moments_feed_cache';
const FEED_CACHE_VERSION = 'v2';
const FEED_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 分钟

// ============ 弱网检测：2g/3g/save-data 环境下使用更低质量图 ============
function isSlowNetwork(): boolean {
  try {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const t = conn.effectiveType || '';
    return t === 'slow-2g' || t === '2g' || t === '3g';
  } catch { return false; }
}

// 为图片 URL 追加弱网限流参数（COS imageMogr2 走开问/追加，本地 URL 原样返回）
function maybeApplyLowQuality(url: string): string {
  if (!url || !url.startsWith('https://')) return url;
  if (!isSlowNetwork()) return url;
  if (url.includes('imageMogr2')) {
    // 已含处理参数 → 追加 quality/55 覆盖
    return url.includes('quality/') ? url.replace(/quality\/\d+/, 'quality/55') : url + '/quality/55';
  }
  return url;
}

// ============ Feed 本地缓存工具 ============
function saveFeedToCache(moments: any[]) {
  try {
    const data = { version: FEED_CACHE_VERSION, ts: Date.now(), moments: moments.slice(0, 20) };
    window.localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(data));
  } catch { /* 存储满时静默失败 */ }
}

function loadFeedFromCache(): any[] | null {
  try {
    const raw = window.localStorage.getItem(FEED_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== FEED_CACHE_VERSION) return null;
    if (Date.now() - data.ts > FEED_CACHE_MAX_AGE) return null;
    return data.moments || null;
  } catch { return null; }
}

function clearFeedCache() {
  try { window.localStorage.removeItem(FEED_CACHE_KEY); } catch {}
}

// ============ 上传进度回调类型 ============
type UploadProgressCallback = (progress: number) => void;

// ============ 文件上传（优先 COS，回退本地） ============
async function uploadFileToLocal(file: File, onProgress?: UploadProgressCallback): Promise<string> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mediaType', file.type.startsWith('video/') ? 'video' : 'image');
    formData.append('source', 'moments');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload-form');

    // 添加认证头
    const token = localStorage.getItem('user_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    // 上传进度监听
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
          resolve(data.url);
        } else {
          reject(new Error(data.error || '上传失败'));
        }
      } catch {
        reject(new Error('上传响应解析失败'));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.ontimeout = () => reject(new Error('上传超时，请检查网络后重试'));
    xhr.timeout = 300000; // 5 分钟超时

    xhr.send(formData);
  });
}

async function uploadFileToCos(file: File, prefix: string, onProgress?: UploadProgressCallback): Promise<string> {
  try {
    const stsData = await authApi('/api/cos/sts', undefined, 'GET');
    const { credentials, bucket, region, baseUrl, momentsFolder, expiredTime } = stsData || {};
    if (credentials?.tmpSecretId && credentials?.tmpSecretKey && credentials?.sessionToken && bucket && region && baseUrl && momentsFolder) {
      const COS = (await import('cos-js-sdk-v5')).default;
      const cos = new COS({
        getAuthorization: (_options: any, callback: any) => {
          callback({
            TmpSecretId: credentials.tmpSecretId,
            TmpSecretKey: credentials.tmpSecretKey,
            SecurityToken: credentials.sessionToken,
            ExpiredTime: expiredTime,
          });
        },
      });
      const rawExt = file.name.split('.').pop() || file.type.split('/').pop() || 'jpg';
      const safeExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const isVideo = file.type.startsWith('video/');
      // 统一使用 ASCII 路径（videos/photos），避免中文路径在 CDN 回源或不同平台下出现编码问题导致加载失败
      const subDir = isVideo ? 'videos' : 'photos';
      const key = `${momentsFolder}/${subDir}/${prefix}_${Date.now()}.${safeExt}`;
      return await new Promise<string>((resolve, reject) => {
        cos.uploadFile(
          {
            Bucket: bucket,
            Region: region,
            Key: key,
            Body: file,
            SliceSize: 1024 * 1024 * 5, // 大于 5MB 使用分片上传
            onProgress: (progressData: any) => {
              if (onProgress) {
                onProgress(Math.round((progressData.percent || 0) * 100));
              }
            },
          },
          (err: any) => {
            if (err) reject(new Error(err.message || 'COS上传失败'));
            else resolve(`${String(baseUrl).replace(/\/$/, '')}/${key}`);
          }
        );
      });
    }
  } catch (cosErr) {
    console.warn('[moments] COS 上传不可用，回退本地上传:', cosErr);
  }
  return uploadFileToLocal(file, onProgress);
}

// ============ 类型定义 ============
interface MomentMedia { type: 'image' | 'video'; url: string; thumbUrl?: string; mediumUrl?: string; }
interface MomentComment {
  id: string; momentId: string; userId: string; userName: string;
  content: string; parentId?: string; replyToUserId?: string;
  replyToUserName?: string; createdAt: number; isDeleted: boolean;
}
interface MomentLike { userId: string; userName: string; createdAt: number; }
type VisibilityType = 'public' | 'friends' | 'private';
interface MomentItem {
  id: string; authorId: string; authorName: string; authorAvatar?: string;
  content: string; media: MomentMedia[]; topics: string[];
  location?: string; permission: { type: VisibilityType };
  likes: MomentLike[]; comments: MomentComment[];
  likeCount: number; commentCount: number;
  isPinned: boolean; pinnedAt?: number; createdAt: number; isLiked: boolean;
}

// ============ 工具函数 ============
function extractTopics(content: string): string[] {
  const matches = content.match(/#([^#\s]+)#/g) || [];
  return [...new Set(matches.map(m => m.replace(/#/g, '')))];
}

function formatDateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const postDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (postDay.getTime() === today.getTime()) return "今天";
  if (postDay.getTime() === yesterday.getTime()) return "昨天";
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return `${String(day).padStart(2, "0")} ${month}月`;
}

// ============ 懒加载图片组件 ============
const LazyImage = memo(({ src, alt = '', style, className, onClick }: {
  src: string; alt?: string; style?: React.CSSProperties; className?: string; onClick?: () => void;
}) => {
  const imgRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }  // 增大预加载距离
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleError = useCallback(() => {
    if (retryCount < 2) {
      // 自动重试（最多 2 次）
      setTimeout(() => {
        setRetryCount(prev => prev + 1);
        setError(false);
      }, 1000 * (retryCount + 1));
    } else {
      setError(true);
    }
  }, [retryCount]);

  // 图片 URL 加上重试参数以绕过浏览器缓存。弱网下迫临时调低质量避免卡顿
  const tunedSrc = maybeApplyLowQuality(src);
  const imgSrc = retryCount > 0 ? `${tunedSrc}${tunedSrc.includes('?') ? '&' : '?'}_r=${retryCount}` : tunedSrc;

  return (
    <div ref={imgRef} style={{ ...style, position: 'relative' }} className={className} onClick={onClick}>
      {/* 占位背景 */}
      {!loaded && !error && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
          backgroundSize: '200% 200%',
          animation: 'shimmer 1.5s ease-in-out infinite',
        }} />
      )}
      {/* 加载失败占位 */}
      {error && (
        <div style={{
          position: 'absolute', inset: 0,
          background: '#f5f5f5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}
      {inView && !error && (
        <img
          src={imgSrc}
          alt={alt}
          style={{ ...style, opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
          onLoad={() => setLoaded(true)}
          onError={handleError}
          loading="lazy"
          decoding="async"
        />
      )}
    </div>
  );
});

// ============ 骨架屏组件 ============
const MomentSkeleton = memo(() => (
  <div style={{ padding: "12px 16px", borderBottom: "0.5px solid #f0f0f0" }}>
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      <div style={{ width: 48, flexShrink: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 4, background: "#f0f0f0", animation: "shimmer 1.5s ease-in-out infinite" }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ width: 80, height: 14, borderRadius: 2, background: "#f0f0f0", marginBottom: 8, animation: "shimmer 1.5s ease-in-out infinite" }} />
        <div style={{ width: "90%", height: 14, borderRadius: 2, background: "#f0f0f0", marginBottom: 6, animation: "shimmer 1.5s ease-in-out infinite" }} />
        <div style={{ width: "60%", height: 14, borderRadius: 2, background: "#f0f0f0", marginBottom: 8, animation: "shimmer 1.5s ease-in-out infinite" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, maxWidth: 243 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ aspectRatio: "1/1", borderRadius: 2, background: "#f0f0f0", animation: "shimmer 1.5s ease-in-out infinite" }} />
          ))}
        </div>
        <div style={{ width: 60, height: 12, borderRadius: 2, background: "#f0f0f0", marginTop: 8, animation: "shimmer 1.5s ease-in-out infinite" }} />
      </div>
    </div>
  </div>
));

// ============ 图片灯箱 ============
function ImageLightbox({ images, initialIndex, onClose }: { images: string[]; initialIndex: number; onClose: () => void }) {
  const [current, setCurrent] = useState(initialIndex);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setCurrent(c => (c > 0 ? c - 1 : c));
      if (e.key === "ArrowRight") setCurrent(c => (c < images.length - 1 ? c + 1 : c));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [images.length, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onTouchStart={e => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
      }}
      onTouchEnd={e => {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = e.changedTouches[0].clientY - touchStartY.current;
        if (dy > 100 && Math.abs(dx) < 80) { onClose(); return; }
        if (Math.abs(dx) > 50 && Math.abs(dy) < 80) {
          if (dx < 0) setCurrent(c => Math.min(images.length - 1, c + 1));
          else setCurrent(c => Math.max(0, c - 1));
        }
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button onClick={onClose} className="text-white/80 hover:text-white">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <span className="text-white/70 text-sm">{current + 1} / {images.length}</span>
        <div className="w-6" />
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        <img src={images[current]} alt="" className="max-w-full max-h-full object-contain select-none" />
        {current > 0 && (
          <button onClick={() => setCurrent(c => c - 1)} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/40 rounded-full hidden sm:flex items-center justify-center text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        {current < images.length - 1 && (
          <button onClick={() => setCurrent(c => c + 1)} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/40 rounded-full hidden sm:flex items-center justify-center text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex-shrink-0 flex items-center justify-center gap-1.5 py-3 px-4">
          {images.map((img, i) => (
            <button key={i} onClick={() => setCurrent(i)}
              className={`w-10 h-10 rounded overflow-hidden flex-shrink-0 transition-all ${i === current ? "ring-2 ring-white opacity-100" : "opacity-50"}`}>
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 双击点赞区域：单击不阻止，双击触发 onDoubleTap 并弹出飞心动画 ============
const DoubleTapZone: React.FC<{ onDoubleTap: () => void; children: React.ReactNode; style?: React.CSSProperties }> = memo(({ onDoubleTap, children, style }) => {
  const lastTapRef = useRef(0);
  const [hearts, setHearts] = useState<number[]>([]);
  const handleClick = useCallback(() => {
    const now = Date.now();
    // 双击间隔 < 300ms 视为双击
    if (now - lastTapRef.current < 300) {
      onDoubleTap();
      const id = now;
      setHearts(prev => [...prev, id]);
      // 600ms 后移除该红心节点，避免内存堆积
      window.setTimeout(() => setHearts(prev => prev.filter(h => h !== id)), 700);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [onDoubleTap]);
  return (
    <div onClickCapture={handleClick} style={{ position: 'relative', touchAction: 'pan-y', ...style }}>
      {children}
      {hearts.map(id => (
        <div key={id} className="double-tap-heart" aria-hidden="true">❤</div>
      ))}
    </div>
  );
});

// ============ 微信风格图片网格（懒加载版）============
const WechatImageGrid = memo(({ images, onImageClick }: { images: string[]; onImageClick: (images: string[], index: number) => void }) => {
  const count = images.length;
  if (count === 0) return null;

  const cellStyle: React.CSSProperties = { aspectRatio: "1/1", overflow: "hidden", borderRadius: 4, cursor: "pointer", position: "relative" };
  const imgStyle: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  const gap = 4;

  const renderImg = (src: string, i: number) => (
    <div key={i} style={cellStyle} onClick={() => onImageClick(images, i)}>
      <LazyImage src={src} style={imgStyle} />
    </div>
  );

  if (count === 1) {
    return (
      <div style={{ maxWidth: 240, overflow: "hidden", borderRadius: 6, cursor: "pointer" }} onClick={() => onImageClick(images, 0)}>
        <LazyImage src={images[0]} style={{ width: "100%", height: "auto", display: "block", objectFit: "contain" }} />
      </div>
    );
  }
  if (count === 2) {
    return (
      <div style={{ maxWidth: 220, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap }}>
        {images.map((src, i) => renderImg(src, i))}
      </div>
    );
  }
  if (count === 3) {
    return (
      <div style={{ maxWidth: 300, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
        {images.map((src, i) => renderImg(src, i))}
      </div>
    );
  }
  if (count === 4) {
    return (
      <div style={{ maxWidth: 220, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap }}>
        {images.map((src, i) => renderImg(src, i))}
      </div>
    );
  }
  if (count === 5) {
    return (
      <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", gap }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap }}>
          {images.slice(0, 2).map((src, i) => renderImg(src, i))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(2, 5).map((src, i) => renderImg(src, i + 2))}
        </div>
      </div>
    );
  }
  if (count === 6) {
    return (
      <div style={{ maxWidth: 300, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
        {images.map((src, i) => renderImg(src, i))}
      </div>
    );
  }
  if (count === 7) {
    return (
      <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", gap }}>
        <div style={{ aspectRatio: "3/1", overflow: "hidden", borderRadius: 2, cursor: "pointer" }} onClick={() => onImageClick(images, 0)}>
          <LazyImage src={images[0]} style={imgStyle} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(1, 4).map((src, i) => renderImg(src, i + 1))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(4, 7).map((src, i) => renderImg(src, i + 4))}
        </div>
      </div>
    );
  }
  if (count === 8) {
    return (
      <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", gap }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap }}>
          {images.slice(0, 2).map((src, i) => renderImg(src, i))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(2, 5).map((src, i) => renderImg(src, i + 2))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(5, 8).map((src, i) => renderImg(src, i + 5))}
        </div>
      </div>
    );
  }
  // 9张
  return (
    <div style={{ maxWidth: 300, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
      {images.slice(0, 9).map((src, i) => renderImg(src, i))}
    </div>
  );
});

// ============ 全局视频播放管理器：保证同一时刻只有一个朋友圈视频在播放 ============
const momentsVideoRegistry = new Set<HTMLVideoElement>();
function pauseOtherMomentsVideos(except: HTMLVideoElement | null): void {
  momentsVideoRegistry.forEach(v => {
    if (v !== except) {
      try { if (!v.paused) v.pause(); } catch { /* ignore */ }
    }
  });
}

// ============ 懒加载视频组件 ============
// 优化点（基于 Grok 优化方案）：
//   1. 默认渲染封面 + 播放按钮，避免列表页一次创建过多 video 元素
//   2. 当 autoPlay=true 时，视频进入可视区即静音自动播放，离开自动暂停
//   3. 一次只允许一个朋友圈视频在播放（避免内存爆炸 / 流量浪费）
//   4. 微信 X5 内核兼容属性（x5-video-player-type、x5-playsinline、webkit-playsinline）
//   5. preload="metadata" 仅加载头部信息，加快首屏
//   6. 自动播放被浏览器拒绝时，回退为"点击播放"覆盖层
const LazyVideo = memo(({ src, poster, style, autoPlay = false }: {
  src: string;
  poster?: string;
  style?: React.CSSProperties;
  autoPlay?: boolean;
}) => {
  const [activated, setActivated] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayHint, setShowPlayHint] = useState(false); // 自动播放被拒绝时显示
  const [resolvedSrc, setResolvedSrc] = useState(src);
  // 兑底封面：当服务端 poster 为空或加载失败时，尝试从视频首帧生成 dataURL
  const [fallbackPoster, setFallbackPoster] = useState<string>('');
  // 视频真实宽/高比，默认 3/4（微信朋友圈竖视频卡默认比例），拿到真实尺寸后覆盖
  const [aspect, setAspect] = useState<number>(3 / 4);
  const refreshTriedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // src 变动时重置
  useEffect(() => { setResolvedSrc(src); refreshTriedRef.current = false; setVideoError(false); setFallbackPoster(''); setAspect(3 / 4); }, [src]);

  // 当 poster 缺失 / 失败时，拉一个隐藏 <video> 抽首帧作为兑底封面。
  // 参考 pyq 项目 VideoThumbnail 思路，避免 “发布后一直转圈” 的观感。
  useEffect(() => {
    const needFallback = !poster || posterError;
    if (!needFallback || fallbackPoster) return;
    if (!resolvedSrc) return;
    let cancelled = false;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    (v as any).playsInline = true;
    v.preload = 'metadata';
    v.src = resolvedSrc;
    const cleanup = () => { try { v.removeAttribute('src'); v.load(); } catch {} };
    const captureFrame = () => {
      try {
        const w = v.videoWidth || 480;
        const h = v.videoHeight || 270;
        if (w && h && !cancelled) {
          // 拿到真实宽高：同步设置容器比例，避免竖视频被画成黑色横套
          setAspect(w / h);
        }
        if (!w || !h) { cleanup(); return; }
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1, 480 / w);
        canvas.width = Math.floor(w * ratio);
        canvas.height = Math.floor(h * ratio);
        const ctx = canvas.getContext('2d');
        if (!ctx) { cleanup(); return; }
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', 0.7);
        if (!cancelled && url && url.length > 100) {
          setFallbackPoster(url);
          setPosterError(false);
        }
      } catch (e) {
        // 跨域 / 接取失败时静默志失败（CORS）
      } finally {
        cleanup();
      }
    };
    const onLoaded = () => {
      try {
        // 安全跳到 0.1s，避免部分视频首帧是黑场
        v.currentTime = Math.min(0.1, (v.duration || 1) / 10);
      } catch { captureFrame(); }
    };
    const onSeeked = () => captureFrame();
    v.addEventListener('loadedmetadata', onLoaded, { once: true });
    v.addEventListener('seeked', onSeeked, { once: true });
    v.addEventListener('error', () => { cleanup(); }, { once: true });
    // 6 秒兑底，避免资源镶住
    const timer = setTimeout(() => { try { onLoaded(); } catch {} cleanup(); }, 6000);
    return () => { cancelled = true; clearTimeout(timer); cleanup(); };
  }, [poster, posterError, resolvedSrc, fallbackPoster]);

  // 实际使用的封面：优先服务端 poster，其次 fallback
  const effectivePoster = (poster && !posterError) ? poster : fallbackPoster;
  // 视频加载失败时兑底：调用 /api/cos/refresh-sign 拿一个新 URL 重试一次
  const handleVideoError = useCallback(async () => {
    if (refreshTriedRef.current) { setVideoError(true); return; }
    refreshTriedRef.current = true;
    try {
      const r = await fetch(`/api/cos/refresh-sign?url=${encodeURIComponent(src)}`);
      if (!r.ok) throw new Error('refresh failed');
      const data = await r.json();
      if (data?.url) {
        setResolvedSrc(data.url);
        setVideoError(false);
        // 重加载 <video>
        const v = videoRef.current;
        if (v) { try { v.src = data.url; v.load(); } catch { /* ignore */ } }
        return;
      }
    } catch { /* ignore */ }
    setVideoError(true);
  }, [src]);
  // 对齐微信朋友圈视频卡尺寸：宽 240px，默认 3:4（拿到真实比例后覆盖），避免加载期被默认 16:9 拉成横黑条
  const W = 240;
  const computedHeight = Math.min(320, Math.max(160, Math.round(W / Math.max(0.4, aspect))));
  const wrapStyle: React.CSSProperties = { position: 'relative', width: W, maxWidth: '100%', height: computedHeight, background: '#000', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', ...style };

  // 微信浏览器需要 X5 内核相关属性，避免视频被强制全屏接管
  const x5Props: Record<string, string> = isWeChatBrowser()
    ? {
        'x5-video-player-type': 'h5',
        'x5-playsinline': 'true',
        'x5-video-player-fullscreen': 'true',
        'webkit-playsinline': 'true',
      }
    : { 'webkit-playsinline': 'true' };

  // 注册到全局视频集合（用于互斥播放）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    momentsVideoRegistry.add(v);
    return () => { momentsVideoRegistry.delete(v); };
  }, [activated]);

  // 自动播放模式下：进入可视区 -> activated=true，并尝试静音播放
  useEffect(() => {
    if (!autoPlay) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActivated(true);
          // 视频已就绪 -> 立即播放（互斥其他视频）
          const v = videoRef.current;
          if (v && videoReady) {
            try {
              v.muted = true;
              (v as any).playsInline = true;
              pauseOtherMomentsVideos(v);
              const p = v.play();
              if (p && typeof p.then === 'function') {
                p.then(() => { setIsPlaying(true); setShowPlayHint(false); })
                 .catch(() => { setShowPlayHint(true); });
              }
            } catch { setShowPlayHint(true); }
          }
        } else {
          // 离开可视区 -> 暂停
          const v = videoRef.current;
          if (v && !v.paused) {
            try { v.pause(); setIsPlaying(false); } catch { /* ignore */ }
          }
        }
      },
      { threshold: 0.55, rootMargin: '120px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoPlay, videoReady]);

  // 点击激活后（非自动播放模式）也立即尝试播放
  useEffect(() => {
    if (autoPlay) return;
    if (activated && videoRef.current && videoReady) {
      const v = videoRef.current;
      try {
        pauseOtherMomentsVideos(v);
        const p = v.play();
        if (p && typeof p.then === 'function') {
          p.then(() => setIsPlaying(true)).catch(() => { /* ignore */ });
        }
      } catch { /* ignore */ }
    }
  }, [activated, videoReady, autoPlay]);

  // 参照pyq的togglePlay：点击视频区域切换播放/暂停，但不拦截浏览器原生controls
  const handleTogglePlay = useCallback((e: React.MouseEvent) => {
    const v = videoRef.current;
    if (!v) { setActivated(true); return; }
    // 如果点击的是视频元素本身（有controls时浏览器会自行处理），不拦截
    if (e.target === v) return;
    // 点击覆盖层时切换播放/暂停
    if (v.paused) {
      pauseOtherMomentsVideos(v);
      v.play().then(() => { setIsPlaying(true); setShowPlayHint(false); }).catch(() => { /* ignore */ });
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, []);

  if (activated) {
    return (
      <div ref={wrapRef} style={wrapStyle} onClick={handleTogglePlay}>
        {/* 加载中显示封面 + loading 动画 */}
        {!videoReady && !videoError && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
            {effectivePoster && <img src={effectivePoster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }} onError={() => setPosterError(true)} />}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            </div>
          </div>
        )}
        {videoError && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 14 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M15 9l-6 6M9 9l6 6" />
            </svg>
            <span style={{ marginTop: 8 }}>视频加载失败</span>
          </div>
        )}
        {/* 自动播放被拒绝时显示"点击播放"提示 */}
        {showPlayHint && !isPlaying && !videoError && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            </div>
          </div>
        )}
        <video
          ref={videoRef}
          src={resolvedSrc}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block', opacity: videoReady ? 1 : 0, transition: 'opacity 0.3s', background: '#000' }}
          onLoadedMetadata={(e) => { const t = e.currentTarget; if (t.videoWidth && t.videoHeight) setAspect(t.videoWidth / t.videoHeight); }}
          controls
          muted={autoPlay}
          loop={autoPlay}
          playsInline
          preload="auto"
          autoPlay
          {...x5Props}
          onLoadedData={() => setVideoReady(true)}
          onCanPlay={() => {
            setVideoReady(true);
            const v = videoRef.current;
            if (v && v.paused) {
              try { pauseOtherMomentsVideos(v); v.play().then(() => setIsPlaying(true)).catch(() => { /* ignore */ }); } catch { /* ignore */ }
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={handleVideoError}
        />
      </div>
    );
  }

  // 未激活态：仅展示封面 + 播放图标
  // - autoPlay=true 时仍会先渲染封面，进入可视区时由 IntersectionObserver 激活
  return (
    <div ref={wrapRef} style={wrapStyle} onClick={() => setActivated(true)}>
      {effectivePoster ? (
        <>
          {/* 封面加载前显示骨架屏 */}
          {!posterLoaded && (
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)', animation: 'shimmer 1.5s ease-in-out infinite' }} />
          )}
          <img
            src={effectivePoster}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block', opacity: posterLoaded ? 0.85 : 0, transition: 'opacity 0.3s ease' }}
            loading="lazy"
            decoding="async"
            onLoad={(e) => { setPosterLoaded(true); const t = e.currentTarget as HTMLImageElement; if (t.naturalWidth && t.naturalHeight) setAspect(t.naturalWidth / t.naturalHeight); }}
            onError={() => setPosterError(true)}
          />
        </>
      ) : (
        // 连首帧都还没抓到时，直接用 <video preload=metadata> 静态展示首帧（不走 controls）
        // 这样哪怕跨域 captureFrame 失败，用户也能看到画面而不是黑圈+转圈
        <video
          src={resolvedSrc}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block', background: '#000', pointerEvents: 'none' }}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => { const t = e.currentTarget; if (t.videoWidth && t.videoHeight) setAspect(t.videoWidth / t.videoHeight); }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        </div>
      </div>
    </div>
  );
});

// ============ 微信风格动态卡片（React.memo 优化）============
const MomentCard = memo<{
  post: MomentItem;
  currentUserId: string;
  currentUserName: string;
  autoPlayVideo?: boolean;
  onLike: (id: string) => void;
  onComment: (id: string, content: string, parentId?: string, replyToUserName?: string) => void;
  onDeleteComment: (momentId: string, commentId: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onPreviewImages: (images: string[], index: number) => void;
}>(({ post, currentUserId, currentUserName, autoPlayVideo = false, onLike, onComment, onDeleteComment, onDelete, onPin, onPreviewImages }) => {
  const [expanded, setExpanded] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const isAuthor = post.authorId === currentUserId;

  const content = post.content || '';
  const MAX_LEN = 140;
  const isLong = content.length > MAX_LEN;
  const displayContent = isLong && !expanded ? content.slice(0, MAX_LEN) : content;
  const imageMedia = useMemo(() => post.media.filter(m => m.type === 'image'), [post.media]);
  const imageUrls = useMemo(() => imageMedia.map(m => m.url), [imageMedia]);
  const imageThumbUrls = useMemo(() => imageMedia.map(m => m.mediumUrl || m.url), [imageMedia]);
  const videoItems = useMemo(() => post.media.filter(m => m.type === 'video'), [post.media]);
  const visibleComments = useMemo(() => post.comments.filter(c => !c.isDeleted), [post.comments]);

  // 点击外部关闭操作菜单
  useEffect(() => {
    if (!showActions) return;
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [showActions]);

  const handleSubmitComment = () => {
    if (!commentText.trim()) return;
    onComment(post.id, commentText.trim(), replyTo?.id, replyTo?.name);
    setCommentText('');
    setReplyTo(null);
    setShowCommentInput(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      {/* 左侧头像 */}
      <div style={{ width: 48, flexShrink: 0, paddingTop: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 4, overflow: "hidden", background: "#e5e7eb" }}>
          {post.authorAvatar ? (
            <img src={post.authorAvatar} alt={post.authorName} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
          ) : (
            <DoveAvatar name={post.authorName} id={post.authorId} size={40} />
          )}
        </div>
      </div>

      {/* 右侧内容 */}
      <div style={{ flex: 1, paddingRight: 0 }}>
        {/* 用户名 */}
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#576b95", fontSize: 15, fontWeight: 500, cursor: "default" }}>{post.authorName}</span>
        </div>

        {/* 文字内容 */}
        {content && (
          <div style={{ marginBottom: 8, fontSize: 14, color: "#282828", lineHeight: 1.6, wordBreak: "break-all" }}>
            {displayContent}
            {isLong && !expanded && (
              <>
                <span style={{ color: "#888" }}>...</span>
                <span onClick={() => setExpanded(true)} style={{ color: "#576b95", cursor: "pointer", marginLeft: 4, fontSize: 14 }}>全文</span>
              </>
            )}
            {isLong && expanded && (
              <span onClick={() => setExpanded(false)} style={{ color: "#576b95", cursor: "pointer", marginLeft: 4, fontSize: 14 }}>收起</span>
            )}
          </div>
        )}

        {/* 图片网格（列表页使用缩略图，点击查看原图，双击点赞） */}
        {imageUrls.length > 0 && (
          <DoubleTapZone onDoubleTap={() => onLike(post.id)} style={{ marginBottom: 8 }}>
            <WechatImageGrid images={imageThumbUrls} onImageClick={(_, index) => onPreviewImages(imageUrls, index)} />
          </DoubleTapZone>
        )}

        {/* 视频（参照pyq：不使用DoubleTapZone包裹，避免爱心动画侵入视频播放器） */}
        {videoItems.length > 0 && (
          <div style={{ marginBottom: 8, maxWidth: 240, overflow: 'hidden', borderRadius: 6 }}>
            {videoItems.map((v, i) => (
              <LazyVideo
                key={i}
                src={v.url}
                poster={v.thumbUrl || v.mediumUrl}
                autoPlay={autoPlayVideo}
              />
            ))}
          </div>
        )}

        {/* 位置 */}
        {post.location && (
          <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 3, fontSize: 12, color: "#576b95" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#576b95" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
            </svg>
            <span>{post.location}</span>
          </div>
        )}

        {/* 时间 + 操作按钮行 */}
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: "#b2b2b2", fontSize: 12 }}>{formatTime(post.createdAt)}</span>
          <div style={{ position: "relative" }} ref={actionsRef}>
            <div
              onClick={() => setShowActions(!showActions)}
              style={{ width: 30, height: 20, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 3, cursor: "pointer" }}
            >
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
            </div>
            {showActions && (
              <div style={{ position: "absolute", right: 40, top: -10, zIndex: 10, animation: "slideIn 0.15s ease-out" }}>
                <div style={{ background: "#4c4c4c", color: "#fff", paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderRadius: 4, display: "flex", flexDirection: "row", alignItems: "center", gap: 0 }}>
                  <button
                    onClick={() => { onLike(post.id); setShowActions(false); }}
                    style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, paddingRight: 12, borderRight: "1px solid rgba(255,255,255,0.2)" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={post.isLiked ? "#ff6b6b" : "none"} stroke={post.isLiked ? "#ff6b6b" : "#fff"} strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    {post.isLiked ? "取消" : "赞"}
                  </button>
                  <button
                    onClick={() => {
                      setShowCommentInput(!showCommentInput);
                      setReplyTo(null);
                      setShowActions(false);
                      setTimeout(() => commentInputRef.current?.focus(), 100);
                    }}
                    style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, paddingLeft: 12, paddingRight: isAuthor ? 12 : 0, borderRight: isAuthor ? "1px solid rgba(255,255,255,0.2)" : "none" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    评论
                  </button>
                  {isAuthor && (
                    <>
                      <button
                        onClick={() => { onPin(post.id); setShowActions(false); }}
                        style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, paddingLeft: 12, paddingRight: 12, borderRight: "1px solid rgba(255,255,255,0.2)" }}
                      >
                        {post.isPinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        onClick={() => { onDelete(post.id); setShowActions(false); }}
                        style={{ background: "none", border: "none", color: "#ff6b6b", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, paddingLeft: 12 }}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 点赞 + 评论区域 */}
        {(post.likes.length > 0 || visibleComments.length > 0) && (
          <div style={{ background: "#f7f7f7", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
            {post.likes.length > 0 && (
              <div style={{ padding: "6px 8px", display: "flex", alignItems: "flex-start", gap: 4, borderBottom: visibleComments.length > 0 ? "0.5px solid #e8e8e8" : "none" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#ff6b6b" stroke="#ff6b6b" strokeWidth={1} style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                <span style={{ fontSize: 13, color: "#576b95", lineHeight: 1.5 }}>
                  {post.likes.map(l => l.userName).join('，')}
                </span>
              </div>
            )}
            {visibleComments.length > 0 && (
              <div style={{ padding: "6px 8px" }}>
                {visibleComments.filter(c => !c.parentId).map(comment => {
                  const replies = visibleComments.filter(c => c.parentId === comment.id);
                  const canDelete = comment.userId === currentUserId || post.authorId === currentUserId;
                  return (
                    <div key={comment.id} style={{ marginBottom: 3 }}>
                      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                        <span style={{ color: "#576b95", cursor: "pointer" }} onClick={() => {
                          setReplyTo({ id: comment.id, name: comment.userName });
                          setShowCommentInput(true);
                          setTimeout(() => commentInputRef.current?.focus(), 100);
                        }}>{comment.userName}</span>
                        <span style={{ color: "#282828" }}>：{comment.content}</span>
                        {canDelete && (
                          <span
                            onClick={() => onDeleteComment(post.id, comment.id)}
                            style={{ color: "#999", cursor: "pointer", marginLeft: 6, fontSize: 11 }}
                          >删除</span>
                        )}
                      </div>
                      {replies.map(reply => {
                        const canDeleteReply = reply.userId === currentUserId || post.authorId === currentUserId;
                        return (
                          <div key={reply.id} style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 12 }}>
                            <span style={{ color: "#576b95" }}>{reply.userName}</span>
                            {reply.replyToUserName && (
                              <>
                                <span style={{ color: "#888" }}> 回复 </span>
                                <span style={{ color: "#576b95" }}>{reply.replyToUserName}</span>
                              </>
                            )}
                            <span style={{ color: "#282828" }}>：{reply.content}</span>
                            {canDeleteReply && (
                              <span
                                onClick={() => onDeleteComment(post.id, reply.id)}
                                style={{ color: "#999", cursor: "pointer", marginLeft: 6, fontSize: 11 }}
                              >删除</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 评论输入框 */}
        {showCommentInput && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 4 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, background: "#f7f7f7", borderRadius: 4, padding: "6px 8px" }}>
              {replyTo && <span style={{ fontSize: 12, color: "#999", flexShrink: 0 }}>回复 {replyTo.name}:</span>}
              <input
                ref={commentInputRef}
                type="text"
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmitComment()}
                placeholder={replyTo ? `回复 ${replyTo.name}...` : '写评论...'}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 14, color: "#282828" }}
              />
            </div>
            <button onClick={handleSubmitComment} disabled={!commentText.trim()}
              style={{ background: "none", border: "none", color: "#576b95", fontSize: 14, cursor: "pointer", opacity: commentText.trim() ? 1 : 0.4 }}>发送</button>
            <button onClick={() => { setShowCommentInput(false); setReplyTo(null); setCommentText(''); }}
              style={{ background: "none", border: "none", color: "#999", fontSize: 14, cursor: "pointer" }}>取消</button>
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较：只在关键数据变化时重新渲染
  return prevProps.post === nextProps.post
    && prevProps.currentUserId === nextProps.currentUserId
    && prevProps.onLike === nextProps.onLike
    && prevProps.onComment === nextProps.onComment;
});


// ============ 发布动态组件 ============
const PostComposer: React.FC<{
  onClose: () => void;
  onPost: (content: string, images: string[], location: string, visibility: VisibilityType) => Promise<void> | void;
  initialMode?: 'photo' | 'camera' | 'video' | 'text';
}> = ({ onClose, onPost, initialMode = 'photo' }) => {
  const [text, setText] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [location, setLocation] = useState('');
  const [visibility, setVisibility] = useState<VisibilityType>('friends');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100 上传进度
  const [uploadStatusText, setUploadStatusText] = useState(''); // 上传状态文字
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const remaining = 9 - selectedImages.length;
    const toProcess = files.slice(0, remaining);
    toProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          setSelectedImages(prev => prev.length < 9 ? [...prev, dataUrl] : prev);
          setSelectedFiles(prev => prev.length < 9 ? [...prev, file] : prev);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 释放上一个预览 URL（避免频繁选视频造成内存泄露）
    if (videoPreviewUrl) { try { URL.revokeObjectURL(videoPreviewUrl); } catch {} }
    setSelectedVideo(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    setSelectedImages([]);
    setSelectedFiles([]);
    e.target.value = '';
  };

  // 发布页卸载时释放预览 URL
  useEffect(() => () => { if (videoPreviewUrl) { try { URL.revokeObjectURL(videoPreviewUrl); } catch {} } }, [videoPreviewUrl]);

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) {
        setSelectedImages(prev => prev.length < 9 ? [...prev, dataUrl] : prev);
        setSelectedFiles(prev => prev.length < 9 ? [...prev, file] : prev);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const hasTriggered = useRef(false);
  useEffect(() => {
    if (hasTriggered.current) return;
    hasTriggered.current = true;
    setTimeout(() => {
      if (initialMode === 'photo') fileInputRef.current?.click();
      else if (initialMode === 'camera') cameraInputRef.current?.click();
      else if (initialMode === 'video') videoInputRef.current?.click();
    }, 100);
  }, [initialMode]);

  const isTextOnly = initialMode === 'text';
  const canPost = !uploading && (text.trim().length > 0 || selectedImages.length > 0 || selectedVideo !== null);

  const handlePublish = async () => {
    if (!canPost) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadStatusText('准备上传...');
    // 用一个统一的 loading toast 跟踪整个流程，避免界面被多个 toast 挤满
    const loadingToastId = toast.loading('准备上传...');
    // 节流：仅在进度崑超 5% 或 距上次 ≥1s 才更新一次 toast / state，
    // 避免 cos-js-sdk 分片上传 onProgress 高频回调导致渲染风暴，以及看上去“一直在加载”
    let lastShownPercent = -1;
    let lastShownAt = 0;
    const shouldShow = (p: number) => {
      const now = Date.now();
      if (p >= 100) return true;
      if (p - lastShownPercent >= 5 || now - lastShownAt >= 800) {
        lastShownPercent = p;
        lastShownAt = now;
        return true;
      }
      return false;
    };
    try {
      let uploadedMedia: string[] = [];
      if (selectedVideo) {
        const fileSizeMB = (selectedVideo.size / 1024 / 1024).toFixed(1);
        setUploadStatusText(`正在上传视频 (${fileSizeMB}MB)...`);
        toast.loading(`正在上传视频 (${fileSizeMB}MB)...`, { id: loadingToastId });
        const videoUrl = await uploadFileToCos(selectedVideo, 'moment_video', (p) => {
          if (!shouldShow(p)) return;
          setUploadProgress(p);
          setUploadStatusText(`正在上传视频 ${p}%`);
          toast.loading(`正在上传视频 ${p}%`, { id: loadingToastId });
        });
        uploadedMedia = [videoUrl];
        toast.success('视频上传成功，正在发布…', { id: loadingToastId });
      } else if (selectedFiles.length > 0) {
        const totalFiles = selectedFiles.length;
        let completedFiles = 0;
        setUploadStatusText(`正在上传图片 0/${totalFiles}`);
        toast.loading(`正在上传图片 0/${totalFiles}`, { id: loadingToastId });
        uploadedMedia = [];
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          // 每张图片重置节流
          lastShownPercent = -1;
          lastShownAt = 0;
          const url = await uploadFileToCos(file, `moment_${i + 1}`, (p) => {
            if (!shouldShow(p)) return;
            const overallProgress = Math.round(((completedFiles + p / 100) / totalFiles) * 100);
            setUploadProgress(overallProgress);
            setUploadStatusText(`正在上传图片 ${completedFiles + 1}/${totalFiles} (${p}%)`);
            toast.loading(`正在上传图片 ${completedFiles + 1}/${totalFiles} (${p}%)`, { id: loadingToastId });
          });
          uploadedMedia.push(url);
          completedFiles++;
          setUploadProgress(Math.round((completedFiles / totalFiles) * 100));
          toast.success(`第 ${completedFiles}/${totalFiles} 张图片上传成功`, { duration: 1200 });
        }
        toast.loading(`图片上传完成（${totalFiles} 张），正在发布…`, { id: loadingToastId });
      } else {
        toast.loading('正在发布…', { id: loadingToastId });
      }
      setUploadStatusText('正在发布…');
      setUploadProgress(100);
      await onPost(text.trim(), uploadedMedia, location, visibility);
      toast.success('动态发布成功', { id: loadingToastId, duration: 2000 });
      // 先关弹窗，避免被 loading toast 看起来“一直在加载”的观感
      onClose();
    } catch (error: any) {
      console.error('[moments] 动态上传失败:', error);
      setUploadStatusText('');
      setUploadProgress(0);
      toast.error(error?.message || '上传失败，请重试', { id: loadingToastId, duration: 3000 });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatusText('');
      // 兌底：如果上面某条 toast 没有 settle，这里强制 dismiss，避免页面右上角残留 loading
      setTimeout(() => { try { toast.dismiss(loadingToastId); } catch {} }, 2200);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 480, background: "#fff", borderRadius: "16px 16px 0 0", maxHeight: "90vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ borderBottom: "0.5px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
            <button onClick={uploading ? undefined : onClose} style={{ background: "none", border: "none", fontSize: 14, color: uploading ? "#ccc" : "#888", cursor: uploading ? "default" : "pointer" }}>取消</button>
            <span style={{ fontSize: 15, fontWeight: 500, color: "#282828" }}>发布动态</span>
            <button
              onClick={() => { void handlePublish(); }}
              disabled={!canPost}
              style={{
                background: canPost ? "#07C160" : "#f0f0f0",
                color: canPost ? "#fff" : "#999",
                border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 14, cursor: canPost ? "pointer" : "default"
              }}
            >
              {uploading ? `${uploadProgress}%` : '发表'}
            </button>
          </div>
          {/* 上传进度条 */}
          {uploading && (
            <div style={{ padding: "0 16px 8px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: "#f0f0f0", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${uploadProgress}%`,
                      borderRadius: 2,
                      background: "linear-gradient(90deg, #07C160, #06AD56)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, color: "#999", whiteSpace: "nowrap", minWidth: 32 }}>{uploadProgress}%</span>
              </div>
              {uploadStatusText && (
                <div style={{ fontSize: 11, color: "#999", textAlign: "center" }}>{uploadStatusText}</div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="这一刻的想法..."
            style={{ width: "100%", height: isTextOnly ? 180 : 112, background: "transparent", border: "none", outline: "none", fontSize: 15, resize: "none", color: "#282828", lineHeight: 1.6 }}
            autoFocus={isTextOnly}
          />

          {selectedVideo && videoPreviewUrl && (
            <div style={{ marginTop: 8, position: "relative", borderRadius: 8, overflow: "hidden", maxHeight: 240 }}>
              <video src={videoPreviewUrl} style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 8 }} controls playsInline />
              <button
                onClick={() => { setSelectedVideo(null); setVideoPreviewUrl(''); }}
                style={{ position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}

          {!isTextOnly && !selectedVideo && selectedImages.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginTop: 8 }}>
              {selectedImages.map((img, i) => (
                <div key={i} style={{ aspectRatio: "1/1", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                  <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button
                    onClick={() => {
                      setSelectedImages(prev => prev.filter((_, idx) => idx !== i));
                      setSelectedFiles(prev => prev.filter((_, idx) => idx !== i));
                    }}
                    style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {selectedImages.length < 9 && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{ aspectRatio: "1/1", borderRadius: 4, border: "1px dashed #ddd", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#ccc" }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                </div>
              )}
            </div>
          )}
          {!isTextOnly && !selectedVideo && selectedImages.length === 0 && initialMode !== 'video' && (
            <div
              onClick={() => initialMode === 'camera' ? cameraInputRef.current?.click() : fileInputRef.current?.click()}
              style={{ marginTop: 8, width: "100%", height: 80, borderRadius: 8, border: "1px dashed #ddd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: "#ccc" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span style={{ fontSize: 12 }}>{initialMode === 'camera' ? '拍照' : '添加图片'}</span>
            </div>
          )}
          {!isTextOnly && !selectedVideo && selectedImages.length === 0 && initialMode === 'video' && (
            <div
              onClick={() => videoInputRef.current?.click()}
              style={{ marginTop: 8, width: "100%", height: 80, borderRadius: 8, border: "1px dashed #ddd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: "#ccc" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <rect x="2" y="4" width="15" height="16" rx="2" ry="2" />
                <polygon points="22 6 17 12 22 18 22 6" />
              </svg>
              <span style={{ fontSize: 12 }}>添加视频</span>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleCameraChange} />
          <input ref={videoInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleVideoChange} />
        </div>

        <div style={{ padding: "8px 16px", borderTop: "0.5px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#888" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
            </svg>
            <input
              type="text" value={location} onChange={e => setLocation(e.target.value)}
              placeholder="所在位置"
              style={{ background: "transparent", border: "none", outline: "none", fontSize: 13, color: "#576b95", width: 80, cursor: "pointer" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#888" }}>
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value as VisibilityType)}
              style={{ background: "transparent", border: "none", outline: "none", fontSize: 13, color: "#576b95", cursor: "pointer" }}
            >
              <option value="public">公开</option>
              <option value="friends">好友可见</option>
              <option value="private">仅自己</option>
            </select>
          </div>
        </div>
        <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
      </div>
    </div>
  );
};

// ============ 发布底部菜单（四个选项） ============
const PublishActionSheet: React.FC<{
  onClose: () => void;
  onSelect: (mode: 'photo' | 'camera' | 'video' | 'text') => void;
}> = ({ onClose, onSelect }) => {
  const items: { mode: 'photo' | 'camera' | 'video' | 'text'; label: string; bgColor: string; icon: React.ReactNode }[] = [
    {
      mode: 'photo', label: '从相册选图片', bgColor: '#07C160',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><polyline points="8 14 11 10 14 14" /><polyline points="14 12 16 10 19 14" /><circle cx="8" cy="8" r="1.5" fill="#fff" stroke="none" /></svg>,
    },
    {
      mode: 'camera', label: '拍一张照片', bgColor: '#2196F3',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>,
    },
    {
      mode: 'video', label: '选择视频', bgColor: '#F44336',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><rect x="2" y="4" width="15" height="16" rx="2" ry="2" /><polygon points="22 6 17 12 22 18 22 6" fill="#fff" stroke="none" /></svg>,
    },
    {
      mode: 'text', label: '仅文字', bgColor: '#FF9800',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
    },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 480, background: "#fff", borderRadius: "16px 16px 0 0", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "8px 0" }}>
          {items.map((item, idx) => (
            <button
              key={item.mode}
              onClick={() => onSelect(item.mode)}
              style={{
                width: "100%", padding: "16px 20px", background: "none", border: "none",
                borderBottom: idx < items.length - 1 ? "0.5px solid #f0f0f0" : "none",
                fontSize: 16, color: "#282828", cursor: "pointer", display: "flex", alignItems: "center", gap: 16,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 10, background: item.bgColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {item.icon}
              </div>
              <span style={{ flex: 1, textAlign: "left", fontSize: 16, fontWeight: 400 }}>{item.label}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          ))}
        </div>
        <div style={{ height: 8, background: "#f5f5f5" }} />
        <button onClick={onClose} style={{ width: "100%", padding: "16px", background: "none", border: "none", fontSize: 16, color: "#888", cursor: "pointer" }}>取消</button>
        <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
      </div>
    </div>
  );
};

// ============ 设置底部菜单 ============
const SettingsActionSheet: React.FC<{
  onClose: () => void;
  onSortMoments: () => void;
  userId: string;
}> = ({ onClose, onSortMoments }) => {
  const handleProfileSettings = () => {
    onClose();
    window.location.hash = '#/profile/settings';
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 480, background: "#fff", borderRadius: "16px 16px 0 0", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "8px 0" }}>
          <button
            onClick={onSortMoments}
            style={{ width: "100%", padding: "16px", background: "none", border: "none", borderBottom: "0.5px solid #f0f0f0", fontSize: 16, color: "#282828", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#576b95" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            排序动态
          </button>
          <button
            onClick={handleProfileSettings}
            style={{ width: "100%", padding: "16px", background: "none", border: "none", borderBottom: "0.5px solid #f0f0f0", fontSize: 16, color: "#282828", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#576b95" strokeWidth={2}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
            个人设置
          </button>
        </div>
        <div style={{ height: 8, background: "#f5f5f5" }} />
        <button onClick={onClose} style={{ width: "100%", padding: "16px", background: "none", border: "none", fontSize: 16, color: "#888", cursor: "pointer" }}>取消</button>
        <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
      </div>
    </div>
  );
};

// ============ 动态管理页面（拖拽排序、删除、编辑） ============
interface MyMoment {
  id: string; content: string; visibility: string; location?: string;
  isPinned: boolean; sortOrder: number; createdAt: number;
  media: { type: string; url: string }[];
  likeCount: number; commentCount: number;
}

const MomentsManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [moments, setMoments] = useState<MyMoment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editVisibility, setEditVisibility] = useState('public');
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const touchStartY = useRef(0);
  const touchItemIdx = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchMyMoments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authApi('/api/moments/my', undefined, 'GET');
      setMoments(data?.moments || []);
    } catch (err) {
      console.error('[moments-manager] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMyMoments(); }, [fetchMyMoments]);

  const handleDragStart = (idx: number) => { dragItem.current = idx; setDragIdx(idx); };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; };
  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      const items = [...moments];
      const [removed] = items.splice(dragItem.current, 1);
      items.splice(dragOverItem.current, 0, removed);
      setMoments(items);
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDragIdx(null);
  };

  const handleTouchStart = (idx: number, e: React.TouchEvent) => {
    touchItemIdx.current = idx;
    touchStartY.current = e.touches[0].clientY;
    setDragIdx(idx);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchItemIdx.current === null || !listRef.current) return;
    const currentY = e.touches[0].clientY;
    const items = listRef.current.querySelectorAll('[data-drag-item]');
    let targetIdx = touchItemIdx.current;
    items.forEach((item, idx) => {
      const rect = item.getBoundingClientRect();
      if (currentY > rect.top && currentY < rect.bottom) targetIdx = idx;
    });
    if (targetIdx !== touchItemIdx.current) {
      const arr = [...moments];
      const [removed] = arr.splice(touchItemIdx.current, 1);
      arr.splice(targetIdx, 0, removed);
      setMoments(arr);
      touchItemIdx.current = targetIdx;
    }
  };
  const handleTouchEnd = () => { touchItemIdx.current = null; setDragIdx(null); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await authApi('/api/moments/reorder', { ids: moments.map(m => m.id) }, 'PUT');
      onClose();
    } catch (err) {
      console.error('[moments-manager] 保存排序失败:', err);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条动态吗？')) return;
    try {
      await authApi(`/api/moments/${id}`, undefined, 'DELETE');
      setMoments(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      console.error('[moments-manager] 删除失败:', err);
      alert('删除失败');
    }
  };

  const startEdit = (m: MyMoment) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditVisibility(m.visibility);
  };
  const handleEditSave = async () => {
    if (!editingId) return;
    try {
      await authApi(`/api/moments/${editingId}`, { content: editContent, visibility: editVisibility }, 'PUT');
      setMoments(prev => prev.map(m => m.id === editingId ? { ...m, content: editContent, visibility: editVisibility } : m));
      setEditingId(null);
    } catch (err) {
      console.error('[moments-manager] 编辑失败:', err);
      alert('编辑失败');
    }
  };

  const getThumb = (m: MyMoment) => {
    if (m.media.length === 0) return null;
    return m.media[0];
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "#f5f5f5", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 56, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: "0.5px solid #e8e8e8", flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 14, color: "#888", cursor: "pointer" }}>取消</button>
        <span style={{ fontSize: 17, fontWeight: 600, color: "#282828" }}>拖拽排序</span>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{ background: "#07C160", color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 14, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>加载中...</div>
        ) : moments.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>暂无动态</div>
        ) : (
          moments.map((m, idx) => (
            <div
              key={m.id}
              data-drag-item
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={e => e.preventDefault()}
              style={{
                background: dragIdx === idx ? "#e8f4fd" : "#fff",
                margin: "0 12px 8px", borderRadius: 8, padding: "12px",
                display: "flex", alignItems: "center", gap: 12,
                boxShadow: dragIdx === idx ? "0 4px 12px rgba(0,0,0,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
                transition: "box-shadow 0.2s, background 0.2s", cursor: "grab", userSelect: "none",
              }}
            >
              <div
                onTouchStart={e => handleTouchStart(idx, e)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{ flexShrink: 0, cursor: "grab", padding: "4px 0", touchAction: "none" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth={2}>
                  <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </div>

              <div style={{ width: 56, height: 56, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {getThumb(m) ? (
                  getThumb(m)!.type === 'video' ? (
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                      <video src={getThumb(m)!.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline preload="metadata" />
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      </div>
                    </div>
                  ) : (
                    <img src={getThumb(m)!.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={1.5}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "#282828", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.content || '[图片/视频]'}
                </div>
                <div style={{ fontSize: 12, color: "#999", marginTop: 4, display: "flex", gap: 8 }}>
                  <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                  <span style={{ color: m.visibility === 'public' ? '#07C160' : m.visibility === 'friends' ? '#576b95' : '#999' }}>
                    {m.visibility === 'public' ? '公开' : m.visibility === 'friends' ? '好友' : '私密'}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={e => { e.stopPropagation(); startEdit(m); }}
                  style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "4px 10px", fontSize: 12, color: "#576b95", cursor: "pointer" }}
                >编辑</button>
                <button
                  onClick={e => { e.stopPropagation(); void handleDelete(m.id); }}
                  style={{ background: "none", border: "1px solid #fdd", borderRadius: 4, padding: "4px 10px", fontSize: 12, color: "#ff4d4f", cursor: "pointer" }}
                >删除</button>
              </div>
            </div>
          ))
        )}
      </div>

      {editingId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setEditingId(null)}>
          <div style={{ width: "90%", maxWidth: 400, background: "#fff", borderRadius: 12, padding: 20 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600, color: "#282828" }}>编辑动态</h3>
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{ width: "100%", height: 120, border: "1px solid #ddd", borderRadius: 8, padding: 12, fontSize: 14, resize: "none", outline: "none", boxSizing: "border-box" }}
              autoFocus
            />
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "#888" }}>可见性：</span>
              <select
                value={editVisibility}
                onChange={e => setEditVisibility(e.target.value)}
                style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 8px", fontSize: 13, outline: "none" }}
              >
                <option value="public">公开</option>
                <option value="friends">好友可见</option>
                <option value="private">仅自己</option>
              </select>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button onClick={() => setEditingId(null)} style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "8px 20px", fontSize: 14, color: "#888", cursor: "pointer" }}>取消</button>
              <button onClick={() => void handleEditSave()} style={{ background: "#07C160", color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontSize: 14, cursor: "pointer" }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ 将 API 返回的动态数据转换为本地 MomentItem ============
function convertApiMoment(m: any): MomentItem {
  return {
    id: m.id,
    authorId: m.authorId,
    authorName: m.authorName || '',
    authorAvatar: m.authorAvatar || '',
    content: m.content || '',
    media: (m.media || []).map((item: any) => ({
      type: (item.type === 'video' ? 'video' : 'image') as 'image' | 'video',
      url: item.url || '',
      thumbUrl: item.thumbUrl || undefined,
      mediumUrl: item.mediumUrl || undefined,
    })),
    topics: m.topics || [],
    location: m.location || undefined,
    permission: { type: (m.visibility || 'public') as VisibilityType },
    likes: (m.likes || []).map((l: any) => ({
      userId: l.userId,
      userName: l.userName || '',
      createdAt: l.createdAt || 0,
    })),
    comments: (m.comments || []).map((c: any) => ({
      id: c.id,
      momentId: m.id,
      userId: c.userId,
      userName: c.userName || '',
      content: c.content || '',
      parentId: c.parentId || undefined,
      replyToUserId: c.replyToUserId || undefined,
      replyToUserName: c.replyToUserName || undefined,
      createdAt: c.createdAt || 0,
      isDeleted: c.isDeleted || false,
    })),
    likeCount: m.likeCount ?? (m.likes?.length || 0),
    commentCount: m.commentCount ?? (m.comments?.length || 0),
    isPinned: m.isPinned || false,
    pinnedAt: m.pinnedAt || undefined,
    createdAt: m.createdAt || 0,
    isLiked: m.isLiked || false,
  };
}

// 兼容：将 AppContext MomentPost 转换为本地 MomentItem
function convertPost(post: MomentPost, currentUserId: string): MomentItem {
  return {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName,
    authorAvatar: post.authorAvatar,
    content: post.content,
    media: post.images.map(url => ({ type: 'image' as const, url })),
    topics: extractTopics(post.content),
    location: undefined,
    permission: { type: post.visibility === 'public' ? 'public' : post.visibility === 'private' ? 'private' : 'friends' },
    likes: post.likes.map(l => ({ userId: l.userId, userName: l.userName, createdAt: post.timestamp })),
    comments: post.comments.map(c => ({
      id: c.id, momentId: post.id, userId: c.userId, userName: c.userName,
      content: c.content, parentId: undefined, replyToUserId: undefined,
      replyToUserName: c.replyTo, createdAt: c.timestamp, isDeleted: false,
    })),
    likeCount: post.likes.length,
    commentCount: post.comments.length,
    isPinned: false,
    createdAt: post.timestamp,
    isLiked: post.likes.some(l => l.userId === currentUserId),
  };
}

// ============ 下拉刷新组件 ============
const PullToRefresh: React.FC<{
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement>;
}> = ({ onRefresh, children, scrollRef }) => {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const isPulling = useRef(false);
  const threshold = 60;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, [scrollRef]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || refreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    if (diff > 0 && scrollRef.current && scrollRef.current.scrollTop <= 0) {
      const distance = Math.min(diff * 0.5, 120);
      setPullDistance(distance);
      setPulling(true);
    }
  }, [refreshing, scrollRef]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance >= threshold && !refreshing) {
      setRefreshing(true);
      setPullDistance(threshold);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
        setPulling(false);
      }
    } else {
      setPullDistance(0);
      setPulling(false);
    }
  }, [pullDistance, refreshing, onRefresh, threshold]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ position: 'relative' }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: pullDistance,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        transition: pulling && !refreshing ? 'none' : 'height 0.3s ease', zIndex: 5,
      }}>
        {pullDistance > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#999', fontSize: 13 }}>
            {refreshing ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                <span>刷新中...</span>
              </>
            ) : pullDistance >= threshold ? (
              <span>松开刷新</span>
            ) : (
              <span>下拉刷新</span>
            )}
          </div>
        )}
      </div>
      <div style={{
        transform: `translateY(${pullDistance}px)`,
        transition: pulling && !refreshing ? 'none' : 'transform 0.3s ease',
      }}>
        {children}
      </div>
    </div>
  );
};

// ============ 主页面组件 ============
export default function MomentsPage() {
  const currentUserState = useCurrentUserState();
  const { likeMoment, addComment, addMoment } = useAppActions();
  const { mode, toggleTheme } = useTheme();
  const currentUser = currentUserState || {
    id: CURRENT_USER.id,
    username: CURRENT_USER.id,
    nickname: CURRENT_USER.name,
    avatar: CURRENT_USER.avatar,
    bio: '',
  };
  const currentUserId = currentUser.id;
  const currentUserName = currentUser.nickname || currentUser.username || CURRENT_USER.name;
  const currentUserAvatar = currentUser.avatar || CURRENT_USER.avatar;
  const [showComposer, setShowComposer] = useState(false);
  const [composerMode, setComposerMode] = useState<'photo' | 'camera' | 'video' | 'text'>('photo');
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showMomentsManager, setShowMomentsManager] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverImage, setCoverImage] = useState('');
  const [topBgOpacity, setTopBgOpacity] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [localMoments, setLocalMoments] = useState<MomentItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // 朋友圈视频自动播放开关（读取后端 site 配置）
  const [autoPlayVideo, setAutoPlayVideo] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/site-config-public')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setAutoPlayVideo(!!d.autoPlayVideo); })
      .catch(() => {});
    // 微信内置浏览器播放权限激活 Hack（首次进入页面就注册）
    setupWeChatVideoAutoPlayHack();
    return () => { cancelled = true; };
  }, []);

  // 滚动监听（固定导航栏背景渐变）- 使用节流优化
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setTopBgOpacity(Math.min(container.scrollTop / 80, 1));
          ticking = false;
        });
        ticking = true;
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedCover = window.localStorage.getItem(MOMENTS_COVER_STORAGE_KEY) || '';
    setCoverImage(savedCover);
    authApi('/api/profile')
      .then((data: any) => {
        const remoteCover = data?.profile?.backgroundUrl || '';
        if (remoteCover) {
          setCoverImage(remoteCover);
          window.localStorage.setItem(MOMENTS_COVER_STORAGE_KEY, remoteCover);
        }
      })
      .catch(() => {});
  }, []);

  // 从后端 API 加载好友朋友圈 Feed（优化：带 AbortController 防重复请求）
  const fetchControllerRef = useRef<AbortController | null>(null);
  const fetchFeed = useCallback(async (cursor?: string, opts?: { force?: boolean }) => {
    // 取消之前未完成的请求
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    const force = !!opts?.force;

    // 首次加载时尝试从本地缓存快速展示（force 时跳过本地缓存，避免发布后友看到旧数据）
    if (!cursor && initialLoading && !force) {
      const cached = loadFeedFromCache();
      if (cached && cached.length > 0) {
        const cachedItems: MomentItem[] = cached.map(convertApiMoment);
        setLocalMoments(cachedItems);
        setInitialLoading(false); // 立即展示缓存数据，消除白屏
      }
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (cursor) params.set('cursor', cursor);
      if (force) params.set('force', '1');
      // 同时加上随机参数避免代理/浏览器中间缓存返回 304
      if (force) params.set('_t', String(Date.now()));
      const data = await authApi(`/api/moments/feed?${params.toString()}`, undefined, 'GET');

      // 检查是否已被取消
      if (controller.signal.aborted) return;

      const items: MomentItem[] = (data?.moments || []).map(convertApiMoment);
      if (cursor) {
        setLocalMoments(prev => {
          // 去重：避免重复加载
          const existingIds = new Set(prev.map(m => m.id));
          const newItems = items.filter(item => !existingIds.has(item.id));
          return [...prev, ...newItems];
        });
      } else {
        setLocalMoments(items);
        // 缓存首页 Feed 到本地
        saveFeedToCache(data?.moments || []);
      }
      setHasMore(data?.hasMore ?? false);
      setNextCursor(data?.nextCursor ?? null);
      // 下一屏媒体提前预加载（仅缩略图 + 视频头部，避免浪费流量）
      try {
        const newPosts = items.slice(0, 6).map(p => ({ media: p.media as any[] }));
        preloadMomentsMedia(newPosts, { maxImages: 18, maxVideos: 3 });
      } catch { /* ignore */ }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('[moments] 加载好友动态失败:', err);
      // 弱网降级：网络失败时展示本地缓存
      if (!cursor && localMoments.length === 0) {
        const cached = loadFeedFromCache();
        if (cached && cached.length > 0) {
          const cachedItems: MomentItem[] = cached.map(convertApiMoment);
          setLocalMoments(cachedItems);
          console.warn('[moments] 网络异常，已降级展示本地缓存');
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [initialLoading, localMoments.length]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    fetchFeed();
  }, [fetchFeed]);

  // handleLoadMore 加 300ms 节流，避免哨兵 IntersectionObserver 在运行动画过程中反复触发
  const loadMoreCooldown = useRef(0);
  const handleLoadMore = useCallback(() => {
    if (loading || !hasMore || !nextCursor) return;
    const now = Date.now();
    if (now - loadMoreCooldown.current < 300) return;
    loadMoreCooldown.current = now;
    fetchFeed(nextCursor);
  }, [loading, hasMore, nextCursor, fetchFeed]);

  // 下拉刷新：强制 force，跳过一切缓存
  const handleRefresh = useCallback(async () => {
    setNextCursor(null);
    try { clearFeedCache(); } catch {}
    await fetchFeed(undefined, { force: true });
  }, [fetchFeed]);

  // ★ 朋友圈实时事件监听：接收 WebSocket 推送的点赞/评论通知，实时更新 Feed
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, payload } = (e as CustomEvent).detail || {};
      if (type === 'moment_like_notify' && payload?.momentId) {
        setLocalMoments(prev => prev.map(m => {
          if (m.id !== payload.momentId) return m;
          return {
            ...m,
            likeCount: payload.likeCount ?? m.likeCount + 1,
            isLiked: m.isLiked, // 保持当前用户的点赞状态不变
            likes: payload.liked
              ? [...m.likes.filter(l => l.userId !== payload.userId), { userId: payload.userId, userName: payload.userName, createdAt: Date.now() }]
              : m.likes.filter(l => l.userId !== payload.userId),
          };
        }));
      }
      if (type === 'moment_comment_notify' && payload?.momentId) {
        // 收到评论推送时，刷新该动态的评论列表
        setLocalMoments(prev => prev.map(m => {
          if (m.id !== payload.momentId) return m;
          const newComment: MomentComment = {
            id: payload.commentId || `rt-${Date.now()}`,
            momentId: payload.momentId,
            userId: payload.userId,
            userName: payload.userName,
            content: payload.content,
            parentId: payload.replyToId || undefined,
            createdAt: Date.now(),
            isDeleted: false,
          };
          // 避免重复添加
          if (m.comments.some(c => c.id === newComment.id)) return m;
          return { ...m, comments: [...m.comments, newComment], commentCount: m.commentCount + 1 };
        }));
      }
    };
    window.addEventListener('moment_realtime_event', handler);
    return () => window.removeEventListener('moment_realtime_event', handler);
  }, []);

  // IntersectionObserver 加载更多（带预加载：提前 400px 触发）
  useEffect(() => {
    if (!hasMore || loading) return;
    const sentinel = loadMoreRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) handleLoadMore(); },
      { root: container, rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, handleLoadMore]);

  // 点赞（调用后端API + 本地乐观更新）
  const handleLike = useCallback(async (postId: string) => {
    setLocalMoments(prev => prev.map(m => {
      if (m.id !== postId) return m;
      const alreadyLiked = m.isLiked;
      return {
        ...m, isLiked: !alreadyLiked,
        likeCount: alreadyLiked ? m.likeCount - 1 : m.likeCount + 1,
        likes: alreadyLiked
          ? m.likes.filter(l => l.userId !== currentUserId)
          : [...m.likes, { userId: currentUserId, userName: currentUserName, createdAt: Date.now() }],
      };
    }));
    likeMoment(postId);
    try {
      await authApi(`/api/moments/${postId}/like`, {}, 'POST');
    } catch (err) {
      console.error('[moments] 点赞失败:', err);
      setLocalMoments(prev => prev.map(m => {
        if (m.id !== postId) return m;
        const wasLiked = m.isLiked;
        return {
          ...m, isLiked: !wasLiked,
          likeCount: wasLiked ? m.likeCount - 1 : m.likeCount + 1,
          likes: wasLiked
            ? m.likes.filter(l => l.userId !== currentUserId)
            : [...m.likes, { userId: currentUserId, userName: currentUserName, createdAt: Date.now() }],
        };
      }));
    }
  }, [likeMoment, currentUserId, currentUserName]);

  // 评论（调用后端API + 本地乐观更新）
  const handleComment = useCallback(async (postId: string, content: string, parentId?: string, replyToUserName?: string) => {
    const tempId = `cm-${Date.now()}`;
    const localComment: MomentComment = {
      id: tempId, momentId: postId, userId: currentUserId, userName: currentUserName,
      content, parentId, replyToUserName, createdAt: Date.now(), isDeleted: false,
    };
    setLocalMoments(prev => prev.map(m => {
      if (m.id !== postId) return m;
      return { ...m, comments: [...m.comments, localComment], commentCount: m.commentCount + 1 };
    }));
    const newComment = { id: tempId, userId: currentUserId, userName: currentUserName, content, timestamp: Date.now(), replyTo: replyToUserName };
    addComment(postId, newComment);
    try {
      const data = await authApi(`/api/moments/${postId}/comments`, { content, replyToId: parentId }, 'POST');
      if (data?.comment?.id) {
        setLocalMoments(prev => prev.map(m => {
          if (m.id !== postId) return m;
          return { ...m, comments: m.comments.map(c => c.id === tempId ? { ...c, id: data.comment.id } : c) };
        }));
      }
    } catch (err) {
      console.error('[moments] 评论失败:', err);
      setLocalMoments(prev => prev.map(m => {
        if (m.id !== postId) return m;
        return { ...m, comments: m.comments.filter(c => c.id !== tempId), commentCount: Math.max(0, m.commentCount - 1) };
      }));
    }
  }, [addComment, currentUserId, currentUserName]);

  // 删除评论
  const handleDeleteComment = useCallback(async (momentId: string, commentId: string) => {
    setLocalMoments(prev => prev.map(m => {
      if (m.id !== momentId) return m;
      return { ...m, comments: m.comments.map(c => c.id === commentId ? { ...c, isDeleted: true } : c), commentCount: Math.max(0, m.commentCount - 1) };
    }));
    try {
      await authApi(`/api/moments/${momentId}/comments/${commentId}`, undefined, 'DELETE');
    } catch (err) {
      console.error('[moments] 删除评论失败:', err);
      setLocalMoments(prev => prev.map(m => {
        if (m.id !== momentId) return m;
        return { ...m, comments: m.comments.map(c => c.id === commentId ? { ...c, isDeleted: false } : c), commentCount: m.commentCount + 1 };
      }));
    }
  }, []);

  // 删除动态
  const handleDelete = useCallback(async (postId: string) => {
    const backup = localMoments.find(m => m.id === postId);
    setLocalMoments(prev => prev.filter(m => m.id !== postId));
    try {
      await authApi(`/api/moments/${postId}`, undefined, 'DELETE');
    } catch (err) {
      console.error('[moments] 删除动态失败:', err);
      if (backup) {
        setLocalMoments(prev => [...prev, backup].sort((a, b) => b.createdAt - a.createdAt));
      }
    }
  }, [localMoments]);

  // 置顶
  const handlePin = useCallback(async (postId: string) => {
    const target = localMoments.find(m => m.id === postId);
    if (!target) return;
    const willPin = !target.isPinned;
    setLocalMoments(prev => {
      let updated = prev.map(m => {
        if (m.id === postId) return { ...m, isPinned: willPin, pinnedAt: willPin ? Date.now() : undefined };
        if (willPin && m.isPinned && m.authorId === currentUserId) return { ...m, isPinned: false, pinnedAt: undefined };
        return m;
      });
      updated.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.isPinned && b.isPinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        return b.createdAt - a.createdAt;
      });
      return updated;
    });
    try {
      await authApi(`/api/moments/${postId}/pin`, { pin: willPin }, 'POST');
    } catch (err) {
      console.error('[moments] 置顶失败:', err);
      fetchFeed(undefined, { force: true });
    }
  }, [localMoments, currentUserId, fetchFeed]);

  const handlePost = useCallback(async (content: string, images: string[], location: string, visibility: VisibilityType) => {
    let createdMoment: any = null;
    try {
      const payloadMedia = images.map(url => {
        const isVideo = /\.(mp4|mov|avi|webm|mkv|m4v)$/i.test(url) || url.includes('video');
        return { type: isVideo ? 'video' : 'image', url };
      });
      const data = await authApi('/api/moments', { content, visibility, location, media: payloadMedia }, 'POST');
      createdMoment = data?.moment || null;
    } catch (error) {
      console.error('[moments] 服务端发布失败，回退为本地动态:', error);
      // 向上抛出，让 PostComposer 能 toast.error
      throw error;
    }

    // 优先使用服务端返回的 media（已带 thumbUrl/posterUrl/签名直链）进行乐观插入，
    // 避免刚发布完因为 fetchFeed 还是旧 Redis 缓存而看不到。
    if (createdMoment) {
      const newItem = convertApiMoment({
        id: createdMoment.id,
        authorId: createdMoment.user?.id || currentUserId,
        authorName: createdMoment.user?.nickname || createdMoment.user?.username || currentUserName,
        authorAvatar: createdMoment.user?.avatar || '',
        content: createdMoment.content || content,
        media: createdMoment.media || [],
        topics: createdMoment.topics || [],
        location: createdMoment.location || location,
        visibility: createdMoment.visibility || visibility,
        likes: [], comments: [],
        likeCount: 0, commentCount: 0,
        isPinned: false,
        createdAt: createdMoment.createdAt ? new Date(createdMoment.createdAt).getTime() : Date.now(),
        isLiked: false,
      });
      setLocalMoments(prev => {
        const pinnedItems = prev.filter(m => m.isPinned);
        const normalItems = prev.filter(m => !m.isPinned && m.id !== newItem.id);
        return [...pinnedItems, newItem, ...normalItems];
      });
      // 同步到 AppContext，保证其他页面也能看到
      const newPost: MomentPost = {
        id: newItem.id,
        authorId: newItem.authorId,
        authorName: newItem.authorName,
        authorAvatar: newItem.authorAvatar,
        content: newItem.content,
        images: newItem.media.filter(m => m.type === 'image').map(m => m.url),
        timestamp: newItem.createdAt,
        likes: [], comments: [],
        visibility: newItem.permission.type,
      };
      addMoment(newPost);
    } else {
      // 服务端未返回时的本地占位（理论上不会到达）
      const newPost: MomentPost = {
        id: `p-${Date.now()}`,
        authorId: currentUserId,
        authorName: currentUserName,
        authorAvatar: '',
        content,
        images,
        timestamp: Date.now(),
        likes: [], comments: [],
        visibility,
      };
      addMoment(newPost);
      const newItem = convertPost(newPost, currentUserId);
      setLocalMoments(prev => {
        const pinnedItems = prev.filter(m => m.isPinned);
        const normalItems = prev.filter(m => !m.isPinned);
        return [...pinnedItems, newItem, ...normalItems];
      });
    }

    // 发布后立即清本地 Feed 缓存，避免下次进页看到旧数据
    try { clearFeedCache(); } catch {}
    // 稍延后 force 拉取一次服务端最新 feed，绕过 Redis 缓存与 ETag
    setTimeout(() => fetchFeed(undefined, { force: true }), 600);
    setTimeout(() => fetchFeed(undefined, { force: true }), 3000); // 二次保险，等 COS snapshot 就绪
  }, [addMoment, currentUserId, currentUserName, fetchFeed]);

  const handleCoverChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const objectUrl = URL.createObjectURL(file);
      setCoverImage(objectUrl);
      const uploadedUrl = await uploadFileToCos(file, 'background');
      setCoverImage(uploadedUrl);
      if (typeof window !== 'undefined') window.localStorage.setItem(MOMENTS_COVER_STORAGE_KEY, uploadedUrl);
      await authApi('/api/profile', { userId: 'me', backgroundUrl: uploadedUrl }, 'PUT');
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('[moments] 背景图上传失败:', err);
    }
    e.target.value = '';
  }, []);

  const openLightbox = useCallback((images: string[], index: number) => {
    setLightboxImages(images);
    setLightboxIndex(index);
  }, []);

  const pinnedPosts = useMemo(() => localMoments.filter(m => m.isPinned), [localMoments]);
  const normalPosts = useMemo(() => localMoments.filter(m => !m.isPinned), [localMoments]);

  const navBg = `rgba(255,255,255,${topBgOpacity})`;
  const iconColor = topBgOpacity > 0.5 ? "#333" : "#fff";
  const iconShadow = topBgOpacity < 0.5 ? "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" : "none";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff", color: "#282828" }}>
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        /* 双击点赞飞心动画（GPU 加速：仅 transform/opacity） */
        @keyframes doubleTapPop {
          0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          15%  { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
          50%  { transform: translate(-50%, -52%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -85%) scale(0.7); opacity: 0; }
        }
        .double-tap-heart {
          position: absolute; top: 50%; left: 50%;
          font-size: 64px; color: #ff3b30;
          pointer-events: none; user-select: none;
          transform: translate(-50%, -50%) scale(0.3); opacity: 0;
          animation: doubleTapPop 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
          will-change: transform, opacity;
          text-shadow: 0 4px 12px rgba(0,0,0,0.35);
          z-index: 5;
        }
      `}</style>

      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: "auto", background: "#fff" }}>
        <PullToRefresh onRefresh={handleRefresh} scrollRef={scrollContainerRef as React.RefObject<HTMLDivElement>}>
        <div style={{ maxWidth: 567, margin: "0 auto", background: "#fff", position: "relative" }}>

          {/* ===== 封面区域（微信风格）===== */}
          <header
            style={{
              height: "19.25rem",
              backgroundImage: coverImage ? `url('${coverImage}')` : "none",
              backgroundColor: coverImage ? undefined : "#333",
              backgroundSize: "cover",
              backgroundPosition: "center",
              position: "relative",
              marginBottom: "2.5rem",
              cursor: "pointer",
            }}
            onClick={() => coverInputRef.current?.click()}
          >
            {/* 固定顶部导航栏 */}
            <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: 56, zIndex: 20 }}>
              <div style={{ maxWidth: 567, margin: "0 auto", height: "100%", background: navBg, transition: "background 0.3s", display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 16 }}>
                <button onClick={e => { e.stopPropagation(); if (window.history.length > 1) window.history.back(); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2.5} style={{ filter: iconShadow }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                {topBgOpacity > 0.5 && <span style={{ fontSize: 17, fontWeight: 600, color: "#333" }}>朋友圈</span>}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={e => { e.stopPropagation(); setShowPublishMenu(true); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2.5} style={{ filter: iconShadow }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  <button onClick={e => { e.stopPropagation(); setShowSettingsMenu(true); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} style={{ filter: iconShadow }}>
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* 右下角：昵称 + 头像 */}
            <div style={{ position: "absolute", right: 16, bottom: -28, display: "flex", flexDirection: "row", alignItems: "flex-end" }}>
              <span style={{ color: "#fff", marginRight: 12, marginBottom: 16, fontSize: 16, fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,0.5)", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                {currentUserName}
              </span>
              <div style={{ width: 64, height: 64, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "#e5e7eb", border: "2px solid #fff" }}>
                {currentUserAvatar ? (
                  <img src={currentUserAvatar} alt={currentUserName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <DoveAvatar name={currentUserName} id={currentUserId} avatar={currentUserAvatar} size="lg" />
                )}
              </div>
            </div>

            <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
          </header>

          {/* ===== 动态列表区域 ===== */}
          <div style={{ paddingTop: 8 }}>

            {/* 首次加载骨架屏 */}
            {initialLoading && (
              <>
                <MomentSkeleton />
                <MomentSkeleton />
                <MomentSkeleton />
              </>
            )}

            {/* 置顶动态 */}
            {!initialLoading && pinnedPosts.map(post => (
              <div key={post.id} style={{ borderBottom: "0.5px solid #f0f0f0", padding: "12px 16px", position: "relative" }}>
                <div style={{ position: "absolute", top: 12, right: 16, background: "#576b95", color: "#fff", fontSize: 10, padding: "1px 6px", borderRadius: 2 }}>置顶</div>
                <MomentCard
                  post={post}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  autoPlayVideo={autoPlayVideo}
                  onLike={handleLike}
                  onComment={handleComment}
                  onDeleteComment={handleDeleteComment}
                  onDelete={handleDelete}
                  onPin={handlePin}
                  onPreviewImages={openLightbox}
                />
              </div>
            ))}

            {/* 普通动态列表 */}
            {!initialLoading && localMoments.length === 0 ? (
              <div style={{ padding: "64px 0", textAlign: "center" }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth={1} style={{ margin: "0 auto 12px", display: "block" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p style={{ color: "#9ca3af", fontSize: 14 }}>暂无动态，去添加好友或发布第一条动态吧</p>
                <button
                  onClick={() => setShowPublishMenu(true)}
                  style={{ marginTop: 16, background: "#07C160", color: "#fff", border: "none", borderRadius: 4, padding: "8px 24px", fontSize: 14, cursor: "pointer" }}
                >
                  发布第一条动态
                </button>
              </div>
            ) : !initialLoading && (
              <>
                <VirtualFeedList
                  items={normalPosts}
                  loading={loading}
                  hasMore={hasMore}
                  onLoadMore={handleLoadMore}
                  className="!overflow-visible"
                  renderItem={(post) => (
                    <div style={{ borderBottom: "0.5px solid #f0f0f0", padding: "12px 16px" }}>
                      <MomentCard
                        post={post}
                        currentUserId={currentUserId}
                        currentUserName={currentUserName}
                        autoPlayVideo={autoPlayVideo}
                        onLike={handleLike}
                        onComment={handleComment}
                        onDeleteComment={handleDeleteComment}
                        onDelete={handleDelete}
                        onPin={handlePin}
                        onPreviewImages={openLightbox}
                      />
                    </div>
                  )}
                />
                {loading && (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <MomentSkeleton />
                  </div>
                )}
                {!hasMore && normalPosts.length > 0 && (
                  <div style={{ textAlign: "center", padding: "24px 0 40px", color: "#ccc", fontSize: 12 }}>— 已经到底了 —</div>
                )}
              </>
            )}
          </div>
        </div>
        </PullToRefresh>
      </div>

      {/* 发布菜单 */}
      {showPublishMenu && (
        <PublishActionSheet
          onClose={() => setShowPublishMenu(false)}
          onSelect={(mode) => {
            setShowPublishMenu(false);
            setComposerMode(mode);
            setShowComposer(true);
          }}
        />
      )}

      {/* 发布弹窗 */}
      {showComposer && (
        <PostComposer onClose={() => setShowComposer(false)} onPost={handlePost} initialMode={composerMode} />
      )}

      {/* 图片灯箱 */}
      {lightboxImages.length > 0 && (
        <ImageLightbox images={lightboxImages} initialIndex={lightboxIndex} onClose={() => setLightboxImages([])} />
      )}

      {/* 设置底部菜单 */}
      {showSettingsMenu && (
        <SettingsActionSheet
          onClose={() => setShowSettingsMenu(false)}
          onSortMoments={() => { setShowSettingsMenu(false); setShowMomentsManager(true); }}
          userId={currentUserId}
        />
      )}

      {/* 动态管理页面 */}
      {showMomentsManager && (
        <MomentsManager
          onClose={() => { setShowMomentsManager(false); try { clearFeedCache(); } catch {}; fetchFeed(undefined, { force: true }); }}
        />
      )}
    </div>
  );
}
