/**
 * 虚拟消息列表优化组件
 * 支持高效渲染、预加载和骨架屏
 */

import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { messagePreloader } from '@/lib/messagePreloader';

export interface Message {
  id: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'sticker' | 'voice' | 'location';
  timestamp: number;
  imageUrl?: string;
  videoUrl?: string;
  stickerUrl?: string;
  voiceCiphertext?: string;
  [key: string]: any;
}

export interface VirtualMessageListProps {
  messages: Message[];
  containerHeight: number;
  itemHeight: number;
  renderMessage: (message: Message, index: number) => React.ReactNode;
  onScroll?: (scrollTop: number) => void;
  onLoadMore?: (direction: 'up' | 'down') => Promise<void>;
  isLoading?: boolean;
  showSkeleton?: boolean;
}

export interface MessageSkeleton {
  id: string;
  type: 'skeleton';
}

const BUFFER_SIZE = 10;
const SKELETON_COUNT = 5;

/**
 * 骨架屏加载组件
 */
const SkeletonMessage: React.FC = () => (
  <div className="flex gap-3 px-4 py-3 animate-pulse">
    <div className="h-10 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
    <div className="flex-1 space-y-2">
      <div className="h-4 w-24 rounded bg-gray-300 dark:bg-gray-600" />
      <div className="h-3 w-full rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-3 w-4/5 rounded bg-gray-200 dark:bg-gray-700" />
    </div>
  </div>
);

/**
 * 虚拟消息列表组件
 */
export const VirtualMessageListOptimized: React.FC<VirtualMessageListProps> = ({
  messages,
  containerHeight,
  itemHeight,
  renderMessage,
  onScroll,
  onLoadMore,
  isLoading = false,
  showSkeleton = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0, bufferStart: 0, bufferEnd: 0 });
  const [skeletons, setSkeletons] = useState<MessageSkeleton[]>([]);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();

  /**
   * 计算可见范围
   */
  const calculateVisibleRange = useCallback(() => {
    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleEnd = Math.ceil((scrollTop + containerHeight) / itemHeight);

    const bufferStart = Math.max(0, visibleStart - BUFFER_SIZE);
    const bufferEnd = Math.min(messages.length, visibleEnd + BUFFER_SIZE);

    return {
      start: visibleStart,
      end: visibleEnd,
      bufferStart,
      bufferEnd,
    };
  }, [scrollTop, containerHeight, itemHeight, messages.length]);

  /**
   * 处理滚动事件
   */
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const newScrollTop = target.scrollTop;

    setScrollTop(newScrollTop);
    onScroll?.(newScrollTop);

    // 清除之前的超时
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // 防抖处理预加载
    scrollTimeoutRef.current = setTimeout(() => {
      const range = calculateVisibleRange();
      const visibleIndices = Array.from(
        { length: range.end - range.start },
        (_, i) => range.start + i
      );

      // 预加载可见消息的多媒体资源
      const visibleMessages = visibleIndices
        .map(idx => messages[idx])
        .filter((msg): msg is Message => msg !== undefined);

      messagePreloader.preloadVisibleMessages(visibleMessages, visibleIndices);

      // 检测边界，触发加载更多
      if (newScrollTop < itemHeight * 5 && onLoadMore) {
        onLoadMore('up');
      } else if (newScrollTop > target.scrollHeight - containerHeight - itemHeight * 5 && onLoadMore) {
        onLoadMore('down');
      }
    }, 150);
  }, [calculateVisibleRange, containerHeight, itemHeight, messages, onLoadMore, onScroll]);

  /**
   * 更新可见范围
   */
  useEffect(() => {
    const range = calculateVisibleRange();
    setVisibleRange(range);

    // 生成骨架屏
    if (showSkeleton && isLoading) {
      const newSkeletons: MessageSkeleton[] = Array.from(
        { length: SKELETON_COUNT },
        (_, i) => ({
          id: `skeleton-${i}`,
          type: 'skeleton' as const,
        })
      );
      setSkeletons(newSkeletons);
    } else {
      setSkeletons([]);
    }
  }, [calculateVisibleRange, isLoading, showSkeleton]);

  /**
   * 计算总高度
   */
  const totalHeight = useMemo(() => {
    return messages.length * itemHeight + (isLoading ? SKELETON_COUNT * itemHeight : 0);
  }, [messages.length, itemHeight, isLoading]);

  /**
   * 渲染可见消息
   */
  const visibleMessages = useMemo(() => {
    const rendered: React.ReactNode[] = [];

    // 渲染缓冲区内的消息
    for (let i = visibleRange.bufferStart; i < visibleRange.bufferEnd; i++) {
      if (i < messages.length) {
        const message = messages[i];
        rendered.push(
          <div
            key={message.id}
            style={{
              position: 'absolute',
              top: i * itemHeight,
              left: 0,
              right: 0,
              height: itemHeight,
            }}
          >
            {renderMessage(message, i)}
          </div>
        );
      }
    }

    // 渲染骨架屏
    if (isLoading && skeletons.length > 0) {
      const skeletonStartIndex = messages.length;
      skeletons.forEach((skeleton, idx) => {
        rendered.push(
          <div
            key={skeleton.id}
            style={{
              position: 'absolute',
              top: (skeletonStartIndex + idx) * itemHeight,
              left: 0,
              right: 0,
              height: itemHeight,
            }}
          >
            <SkeletonMessage />
          </div>
        );
      });
    }

    return rendered;
  }, [visibleRange, messages, itemHeight, renderMessage, isLoading, skeletons]);

  /**
   * 清理超时
   */
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative overflow-y-auto"
      style={{
        height: containerHeight,
      }}
      onScroll={handleScroll}
    >
      {/* 虚拟滚动容器 */}
      <div
        style={{
          position: 'relative',
          height: totalHeight,
        }}
      >
        {visibleMessages}
      </div>

      {/* 加载指示器 */}
      {isLoading && (
        <div className="sticky bottom-0 left-0 right-0 flex items-center justify-center bg-white/50 py-2 dark:bg-slate-900/50">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">加载中...</span>
        </div>
      )}
    </div>
  );
};

export default VirtualMessageListOptimized;
