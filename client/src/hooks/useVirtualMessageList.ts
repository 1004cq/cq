/**
 * 万人群虚拟列表消息渲染 Hook
 *
 * 核心优化：
 * 1. 虚拟滚动：只渲染可视区域 + 缓冲区的消息 DOM，万条消息也不卡
 * 2. 动态高度：支持不同消息类型的变高度渲染
 * 3. 锚点滚动：新消息到达时保持滚动位置不跳动
 * 4. 分页加载：上滑加载历史消息，无缝拼接
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

export interface VirtualItem {
  index: number;
  start: number;
  end: number;
  size: number;
}

interface UseVirtualMessageListOptions {
  /** 消息总数 */
  count: number;
  /** 容器高度 */
  containerHeight: number;
  /** 预估消息高度（用于初始化） */
  estimatedItemHeight?: number;
  /** 缓冲区大小（可视区域外额外渲染的条数） */
  overscan?: number;
  /** 是否锚定到底部（新消息自动滚动） */
  stickyBottom?: boolean;
  /** 触发加载更多的阈值（距离顶部的像素数） */
  loadMoreThreshold?: number;
  /** 加载更多回调 */
  onLoadMore?: () => void;
}

export function useVirtualMessageList(options: UseVirtualMessageListOptions) {
  const {
    count,
    containerHeight,
    estimatedItemHeight = 60,
    overscan = 8,
    stickyBottom = true,
    loadMoreThreshold = 200,
    onLoadMore,
  } = options;

  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const prevCountRef = useRef(count);

  // 动态高度缓存：index -> measured height
  const measuredHeights = useRef(new Map<number, number>());

  // 计算每个 item 的 offset
  const getItemOffset = useCallback((index: number): number => {
    let offset = 0;
    for (let i = 0; i < index; i++) {
      offset += measuredHeights.current.get(i) || estimatedItemHeight;
    }
    return offset;
  }, [estimatedItemHeight]);

  // 计算总高度
  const totalHeight = useMemo(() => {
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += measuredHeights.current.get(i) || estimatedItemHeight;
    }
    return total;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, estimatedItemHeight, measuredHeights.current.size]);

  // 计算可视范围
  const virtualItems = useMemo((): VirtualItem[] => {
    if (count === 0 || containerHeight === 0) return [];

    // 二分查找起始索引
    let startIndex = 0;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const height = measuredHeights.current.get(i) || estimatedItemHeight;
      if (offset + height > scrollTop) {
        startIndex = i;
        break;
      }
      offset += height;
      if (i === count - 1) startIndex = count - 1;
    }

    // 向上扩展 overscan
    startIndex = Math.max(0, startIndex - overscan);

    // 计算结束索引
    let endIndex = startIndex;
    let currentOffset = getItemOffset(startIndex);
    const viewEnd = scrollTop + containerHeight;

    for (let i = startIndex; i < count; i++) {
      const height = measuredHeights.current.get(i) || estimatedItemHeight;
      if (currentOffset > viewEnd + overscan * estimatedItemHeight) break;
      endIndex = i;
      currentOffset += height;
    }

    endIndex = Math.min(count - 1, endIndex + overscan);

    // 构建虚拟项列表
    const items: VirtualItem[] = [];
    let itemOffset = getItemOffset(startIndex);
    for (let i = startIndex; i <= endIndex; i++) {
      const size = measuredHeights.current.get(i) || estimatedItemHeight;
      items.push({
        index: i,
        start: itemOffset,
        end: itemOffset + size,
        size,
      });
      itemOffset += size;
    }

    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, containerHeight, scrollTop, estimatedItemHeight, overscan, getItemOffset]);

  // 测量实际高度
  const measureItem = useCallback((index: number, element: HTMLElement | null) => {
    if (!element) return;
    const height = element.getBoundingClientRect().height;
    if (height > 0 && measuredHeights.current.get(index) !== height) {
      measuredHeights.current.set(index, height);
    }
  }, []);

  // 滚动事件处理（使用 RAF 节流）
  const rafIdRef = useRef<number | null>(null);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      const target = e.target as HTMLDivElement;
      const newScrollTop = target.scrollTop;
      setScrollTop(newScrollTop);

      // 检测是否在底部
      const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      isAtBottomRef.current = distanceFromBottom < 50;

      // 检测是否需要加载更多（上滑到顶部附近）
      if (newScrollTop < loadMoreThreshold && !isLoadingMoreRef.current && onLoadMore) {
        isLoadingMoreRef.current = true;
        onLoadMore();
        // 500ms 后重置加载状态
        setTimeout(() => { isLoadingMoreRef.current = false; }, 500);
      }
    });
  }, [loadMoreThreshold, onLoadMore]);

  // 新消息到达时的锚点滚动
  useEffect(() => {
    if (count > prevCountRef.current) {
      const newCount = count - prevCountRef.current;
      if (stickyBottom && isAtBottomRef.current) {
        // 在底部：自动滚到新消息
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: newCount <= 3 ? 'smooth' : 'auto',
          });
        });
      }
    }
    prevCountRef.current = count;
  }, [count, stickyBottom]);

  // 滚动到底部
  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    });
  }, []);

  // 滚动到指定消息
  const scrollToIndex = useCallback((index: number, smooth = true) => {
    const offset = getItemOffset(index);
    scrollRef.current?.scrollTo({
      top: offset,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, [getItemOffset]);

  return {
    /** 绑定到滚动容器的 ref */
    scrollRef,
    /** 虚拟项列表（只渲染这些） */
    virtualItems,
    /** 总高度（用于撑开滚动区域） */
    totalHeight,
    /** 滚动事件处理器 */
    handleScroll,
    /** 测量 item 实际高度 */
    measureItem,
    /** 滚动到底部 */
    scrollToBottom,
    /** 滚动到指定索引 */
    scrollToIndex,
    /** 是否在底部 */
    isAtBottom: isAtBottomRef.current,
  };
}
