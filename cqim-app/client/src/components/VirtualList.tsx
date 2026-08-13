import React, { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getVisibleRange, rafThrottle } from '@/lib/performance';

export interface FixedVirtualListProps<T> {
  items: readonly T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey?: (item: T, index: number) => React.Key;
  className?: string;
  threshold?: number;
  overscan?: number;
  emptyState?: React.ReactNode;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

function FixedVirtualListInner<T>(
  {
    items,
    itemHeight,
    renderItem,
    getKey,
    className = '',
    threshold = 24,
    overscan = 6,
    emptyState = null,
    onScroll,
  }: FixedVirtualListProps<T>,
  forwardedRef: React.ForwardedRef<HTMLDivElement>,
) {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    internalRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const shouldVirtualize = items.length > threshold;
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, threshold + overscan * 2) });

  const updateRange = useMemo(() => rafThrottle(() => {
    const node = internalRef.current;
    if (!node || !shouldVirtualize) return;
    const next = getVisibleRange(
      node.scrollTop,
      node.clientHeight || itemHeight * threshold,
      itemHeight,
      items.length,
      overscan,
    );
    setRange(previous => previous.start === next.start && previous.end === next.end ? previous : next);
  }), [shouldVirtualize, itemHeight, threshold, items.length, overscan]);

  useLayoutEffect(() => {
    if (!shouldVirtualize) {
      setRange({ start: 0, end: items.length });
      return;
    }
    updateRange();
  }, [shouldVirtualize, items.length, updateRange]);

  const visibleItems = shouldVirtualize ? items.slice(range.start, range.end) : items;
  const topSpacer = shouldVirtualize ? range.start * itemHeight : 0;
  const bottomSpacer = shouldVirtualize ? Math.max(0, (items.length - range.end) * itemHeight) : 0;

  if (items.length === 0 && emptyState) {
    return <div ref={setRef} className={className}>{emptyState}</div>;
  }

  return (
    <div
      ref={setRef}
      className={className}
      onScroll={(event) => {
        updateRange();
        onScroll?.(event);
      }}
    >
      {topSpacer > 0 && <div style={{ height: topSpacer }} aria-hidden="true" />}
      {visibleItems.map((item, index) => {
        const absoluteIndex = shouldVirtualize ? range.start + index : index;
        return (
          <React.Fragment key={getKey?.(item, absoluteIndex) ?? absoluteIndex}>
            {renderItem(item, absoluteIndex)}
          </React.Fragment>
        );
      })}
      {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden="true" />}
    </div>
  );
}

export const FixedVirtualList = forwardRef(FixedVirtualListInner) as <T>(
  props: FixedVirtualListProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> },
) => React.ReactElement;

export default FixedVirtualList;
