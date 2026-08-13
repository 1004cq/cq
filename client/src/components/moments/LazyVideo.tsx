import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { isWeChatBrowser } from '@/lib/momentsPreloader';

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

export { LazyVideo };
export default LazyVideo;
