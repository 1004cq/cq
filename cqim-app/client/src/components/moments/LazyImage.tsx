import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

function isSlowNetwork(): boolean {
  try {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const t = conn.effectiveType || '';
    return t === 'slow-2g' || t === '2g' || t === '3g';
  } catch { return false; }
}

function maybeApplyLowQuality(url: string): string {
  if (!url || !url.startsWith('https://')) return url;
  if (!isSlowNetwork()) return url;
  if (url.includes('imageMogr2')) {
    return url.includes('quality/') ? url.replace(/quality\/\d+/, 'quality/55') : url + '/quality/55';
  }
  return url;
}

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

export { LazyImage };
export default LazyImage;
