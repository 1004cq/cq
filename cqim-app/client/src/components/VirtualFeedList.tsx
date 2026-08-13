import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface VirtualFeedListProps<T extends { id: string; createdAt: number }> {
  items: readonly T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** 传入页面的唯一滚动容器；不传时回退到 window。 */
  scrollParentRef?: React.RefObject<HTMLElement | null>;
  estimatedRowHeight?: number;
  overscanPx?: number;
  className?: string;
}

const DEFAULT_ESTIMATED_ROW_HEIGHT = 280;
const DEFAULT_OVERSCAN_PX = 720;
const LOAD_MORE_THRESHOLD = 520;

/**
 * 朋友圈专用窗口化列表。
 *
 * 与聊天列表不同，朋友圈卡片高度会随文字、九宫格、评论和视频动态变化，
 * 因此这里采用 ResizeObserver + prefix offsets，不创建独立的 overflow 容器。
 * 这样整个 MomentsPage 只有一个滚动源，移动端下拉刷新和顶部导航不会互相抢滚动事件。
 */
export function VirtualFeedList<T extends { id: string; createdAt: number }>({
  items,
  renderItem,
  loading = false,
  hasMore = false,
  onLoadMore,
  scrollParentRef,
  estimatedRowHeight = DEFAULT_ESTIMATED_ROW_HEIGHT,
  overscanPx = DEFAULT_OVERSCAN_PX,
  className = '',
}: VirtualFeedListProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const rowHeightsRef = useRef(new Map<string, number>());
  const rowObserversRef = useRef(new Map<string, ResizeObserver>());
  const loadingMoreRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [listTop, setListTop] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const getKey = useCallback((item: T, index: number) => `feed-${item.id}-${index}`, []);

  const { offsets, totalHeight } = useMemo(() => {
    const nextOffsets: number[] = [];
    let total = 0;
    items.forEach((item, index) => {
      nextOffsets.push(total);
      total += rowHeightsRef.current.get(getKey(item, index)) || estimatedRowHeight;
    });
    return { offsets: nextOffsets, totalHeight: total };
  }, [items, estimatedRowHeight, getKey, layoutVersion]);

  const measureViewport = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const parent = scrollParentRef?.current;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      setScrollTop(parent.scrollTop);
      setViewportHeight(parent.clientHeight);
      setListTop(listRect.top - parentRect.top + parent.scrollTop);
      return;
    }
    const listRect = list.getBoundingClientRect();
    setScrollTop(window.scrollY);
    setViewportHeight(window.innerHeight);
    setListTop(listRect.top + window.scrollY);
  }, [scrollParentRef]);

  useLayoutEffect(() => {
    measureViewport();
    const parent = scrollParentRef?.current;
    const target = parent || window;
    const handleScroll = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measureViewport);
    };
    target.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', measureViewport, { passive: true });
    return () => {
      target.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', measureViewport);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [measureViewport, scrollParentRef]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measureViewport();
      setLayoutVersion(version => version + 1);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [measureViewport]);

  useEffect(() => {
    return () => {
      rowObserversRef.current.forEach(observer => observer.disconnect());
      rowObserversRef.current.clear();
    };
  }, []);

  const measureRow = useCallback((key: string, node: HTMLDivElement | null) => {
    rowObserversRef.current.get(key)?.disconnect();
    rowObserversRef.current.delete(key);
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height || 0;
      const previous = rowHeightsRef.current.get(key) || 0;
      if (height > 0 && Math.abs(previous - height) > 1) {
        rowHeightsRef.current.set(key, height);
        setLayoutVersion(version => version + 1);
      }
    });
    rowObserversRef.current.set(key, observer);
    observer.observe(node);
  }, []);

  const relativeScrollTop = Math.max(0, scrollTop - listTop);
  const visibleStart = Math.max(0, relativeScrollTop - overscanPx);
  const visibleEnd = relativeScrollTop + viewportHeight + overscanPx;
  let start = 0;
  while (start < items.length && offsets[start] + (rowHeightsRef.current.get(getKey(items[start], start)) || estimatedRowHeight) < visibleStart) start += 1;
  let end = start;
  while (end < items.length && offsets[end] < visibleEnd) end += 1;

  useEffect(() => {
    if (!onLoadMore || !hasMore || loading || loadingMoreRef.current || items.length === 0) return;
    const remaining = listTop + totalHeight - (scrollTop + viewportHeight);
    if (remaining > LOAD_MORE_THRESHOLD) return;
    loadingMoreRef.current = true;
    onLoadMore();
    const timer = window.setTimeout(() => { loadingMoreRef.current = false; }, 700);
    return () => window.clearTimeout(timer);
  }, [hasMore, items.length, listTop, loading, onLoadMore, scrollTop, totalHeight, viewportHeight]);

  return (
    <div ref={listRef} className={`relative w-full ${className}`}>
      {loading && items.length === 0 && (
        <div className="space-y-3 px-4 py-3" aria-label="正在加载朋友圈">
          {[0, 1, 2].map(index => (
            <div key={index} className="h-56 rounded-xl bg-dove-mist/50 animate-pulse" />
          ))}
        </div>
      )}
      {loading && items.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-[-24px] z-10 flex justify-center" aria-label="正在加载更多朋友圈">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-dove-green/30 border-t-dove-green" />
        </div>
      )}
      <div style={{ position: 'relative', height: totalHeight }}>
        {items.slice(start, end).map((item, visibleIndex) => {
          const index = start + visibleIndex;
          const key = getKey(item, index);
          return (
            <div
              key={key}
              ref={node => measureRow(key, node)}
              style={{
                position: 'absolute',
                top: offsets[index] || 0,
                left: 0,
                right: 0,
                contain: 'layout paint style',
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
      {!loading && !hasMore && items.length > 0 && (
        <div className="px-4 py-8 text-center text-xs text-dove-ink/30">— 已经到底了 —</div>
      )}
    </div>
  );
}

export default VirtualFeedList;
