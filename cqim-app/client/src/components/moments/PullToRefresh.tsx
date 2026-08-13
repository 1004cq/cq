import React, { useCallback, useRef, useState } from 'react';

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

export { PullToRefresh };
export default PullToRefresh;
