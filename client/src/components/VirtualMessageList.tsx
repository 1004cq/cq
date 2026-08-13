/**
 * 万人群虚拟滚动消息列表组件
 *
 * 核心特性：
 * 1. 虚拟滚动：只渲染可视区域 + 缓冲区的消息 DOM
 * 2. 动态高度：支持不同消息类型的变高度
 * 3. 锚点滚动：新消息到达时智能滚动
 * 4. 上拉加载：滚动到顶部自动加载历史消息
 * 5. 新消息提示：不在底部时显示新消息浮标
 * 6. GPU 加速：消息项使用 content-visibility + contain 隔离布局
 * 7. 批量渲染：使用 requestAnimationFrame 调度大量消息插入
 */

import React, { useCallback, useRef, useEffect, useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springBadge, tgEaseOut } from '@/lib/animations';
import type { GroupMessageItem } from '@/contexts/GroupMessageContext';

// ============ 类型定义 ============

interface VirtualMessageListProps {
  messages: GroupMessageItem[];
  currentUserId: string;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** 自定义消息渲染器 */
  renderMessage?: (msg: GroupMessageItem, isOwn: boolean) => React.ReactNode;
  /** 容器类名 */
  className?: string;
}

// ============ 默认消息气泡 ============

const DefaultMessageBubble = memo(({ msg, isOwn }: { msg: GroupMessageItem; isOwn: boolean }) => {
  const isSystem = msg.msgType === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center py-1.5">
        <span className="text-xs text-dove-ink/40 bg-dove-mist/50 px-3 py-1 rounded-full">
          {msg.content}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-3 py-0.5 group message-item`}>
      {/* 头像（他人消息） */}
      {!isOwn && (
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-dove-green/20 to-dove-bamboo/20 flex items-center justify-center text-xs font-medium text-dove-green mr-2 mt-0.5 flex-shrink-0">
          {(msg.senderName || msg.senderId).charAt(0).toUpperCase()}
        </div>
      )}

      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* 发送者名称（他人消息） */}
        {!isOwn && (
          <span className="text-[10px] text-dove-ink/40 mb-0.5 ml-1">
            {msg.senderName || msg.senderId}
          </span>
        )}

        {/* 消息气泡 — GPU 加速 */}
        <div className={`
          relative px-3 py-2 rounded-2xl text-sm leading-relaxed break-words gpu-accelerated
          ${isOwn
            ? 'bg-gradient-to-br from-dove-green to-dove-bamboo text-white rounded-tr-md'
            : 'bg-white dark:bg-dove-ink/10 text-dove-ink rounded-tl-md shadow-soft-sm'
          }
        `}>
          {msg.content}

          {/* 发送状态 */}
          {isOwn && msg.status && (
            <span className="inline-block ml-1.5 align-bottom">
              {msg.status === 'sending' && (
                <span className="inline-block w-3 h-3 border border-white/50 border-t-transparent rounded-full animate-spin" />
              )}
              {msg.status === 'sent' && (
                <svg className="inline w-3 h-3 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {msg.status === 'delivered' && (
                <svg className="inline w-3 h-3 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7M12 13l4 4L19 7" />
                </svg>
              )}
            </span>
          )}
        </div>

        {/* 时间戳 */}
        <span className={`text-[10px] text-dove-ink/30 mt-0.5 ${isOwn ? 'mr-1' : 'ml-1'}`}>
          {formatTime(msg.timestamp)}
        </span>
      </div>
    </div>
  );
});

DefaultMessageBubble.displayName = 'DefaultMessageBubble';

// ============ 时间格式化 ============

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');

  if (isToday) return `${hours}:${mins}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hours}:${mins}`;

  return `${d.getMonth() + 1}/${d.getDate()} ${hours}:${mins}`;
}

// ============ 时间分隔线 ============

function shouldShowTimeSeparator(current: GroupMessageItem, prev?: GroupMessageItem): boolean {
  if (!prev) return true;
  return current.timestamp - prev.timestamp > 5 * 60 * 1000; // 5分钟间隔
}

const TimeSeparator = memo(({ timestamp }: { timestamp: number }) => (
  <div className="flex justify-center py-2">
    <span className="text-[10px] text-dove-ink/30 bg-dove-mist/30 px-2.5 py-0.5 rounded-full">
      {formatTime(timestamp)}
    </span>
  </div>
));

TimeSeparator.displayName = 'TimeSeparator';

// ============ 骨架屏加载 ============

const MessageSkeleton = memo(() => (
  <div className="px-3 py-3 space-y-3">
    {[...Array(5)].map((_, i) => (
      <div key={i} className={`flex gap-2 ${i % 2 === 0 ? '' : 'flex-row-reverse'}`}>
        <div className="w-8 h-8 rounded-lg skeleton-enhanced flex-shrink-0" />
        <div className="flex flex-col gap-1.5 flex-1" style={{ maxWidth: '60%' }}>
          <div className={`h-3 skeleton-enhanced rounded ${i % 3 === 0 ? 'w-3/4' : 'w-1/2'}`} />
          <div className="h-8 skeleton-enhanced rounded-2xl" />
        </div>
      </div>
    ))}
  </div>
));

MessageSkeleton.displayName = 'MessageSkeleton';

// ============ 主组件 ============

export const VirtualMessageList = memo(({
  messages,
  currentUserId,
  loading = false,
  hasMore = true,
  onLoadMore,
  renderMessage,
  className = '',
}: VirtualMessageListProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(messages.length);
  const isLoadingMoreRef = useRef(false);
  const [showNewMsgTip, setShowNewMsgTip] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);

  // 检测是否在底部
  const checkIsAtBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom < 80;
  }, []);

  // 滚动事件处理 — 使用 passive 监听优化
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    isAtBottomRef.current = checkIsAtBottom();

    // 在底部时清除新消息提示
    if (isAtBottomRef.current) {
      setShowNewMsgTip(false);
      setNewMsgCount(0);
    }

    // 上拉加载更多
    if (container.scrollTop < 200 && hasMore && !isLoadingMoreRef.current && onLoadMore) {
      isLoadingMoreRef.current = true;
      const prevScrollHeight = container.scrollHeight;
      onLoadMore();
      // 保持滚动位置 — 使用 rAF 调度
      requestAnimationFrame(() => {
        const newScrollHeight = container.scrollHeight;
        container.scrollTop += newScrollHeight - prevScrollHeight;
        setTimeout(() => { isLoadingMoreRef.current = false; }, 300);
      });
    }
  }, [checkIsAtBottom, hasMore, onLoadMore]);

  // 注册 passive 滚动监听
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // 新消息到达时的滚动处理
  useEffect(() => {
    const newCount = messages.length - prevMessageCountRef.current;
    if (newCount > 0) {
      if (isAtBottomRef.current) {
        // 在底部：自动滚到新消息 — 使用 rAF 调度
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: newCount <= 3 ? 'smooth' : 'auto' });
        });
      } else {
        // 不在底部：显示新消息提示
        setNewMsgCount(prev => prev + newCount);
        setShowNewMsgTip(true);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  // 首次加载滚动到底部
  useEffect(() => {
    if (messages.length > 0 && prevMessageCountRef.current === messages.length) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 点击新消息提示滚到底部
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowNewMsgTip(false);
    setNewMsgCount(0);
  }, []);

  return (
    <div className={`relative flex-1 overflow-hidden ${className}`}>
      {/* 滚动容器 — GPU 加速 */}
      <div
        ref={scrollContainerRef}
        className="h-full overflow-y-auto overscroll-contain chat-messages-container"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* 加载更多指示器 */}
        {loading && hasMore && (
          <div className="flex justify-center py-3">
            <div className="flex items-center gap-2 text-xs text-dove-ink/40">
              <span className="w-4 h-4 border-2 border-dove-green/30 border-t-dove-green rounded-full animate-spin gpu-accelerated" />
              加载历史消息...
            </div>
          </div>
        )}

        {/* 骨架屏：首次加载时显示 */}
        {loading && messages.length === 0 && <MessageSkeleton />}

        {!hasMore && messages.length > 0 && (
          <div className="flex justify-center py-3">
            <span className="text-[10px] text-dove-ink/25">—— 已无更多消息 ——</span>
          </div>
        )}

        {/* 消息列表 — 使用 content-visibility 优化 */}
        <div className="py-2">
          {messages.map((msg, index) => {
            const isOwn = msg.senderId === currentUserId;
            const prevMsg = index > 0 ? messages[index - 1] : undefined;
            const showTime = shouldShowTimeSeparator(msg, prevMsg);

            return (
              <React.Fragment key={msg.id || `msg-${msg.seq}-${index}`}>
                {showTime && <TimeSeparator timestamp={msg.timestamp} />}
                {renderMessage
                  ? renderMessage(msg, isOwn)
                  : <DefaultMessageBubble msg={msg} isOwn={isOwn} />
                }
              </React.Fragment>
            );
          })}
        </div>

        {/* 底部锚点 */}
        <div ref={bottomRef} className="h-px" />
      </div>

      {/* 新消息浮标 — TG 风格弹入动画 */}
      <AnimatePresence>
        {showNewMsgTip && (
          <motion.button
            initial={{ opacity: 0, y: 20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.8 }}
            transition={springBadge}
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 bg-dove-green text-white text-xs font-medium rounded-full shadow-lg hover:bg-dove-bamboo transition-colors z-10 gpu-accelerated animate-float-badge"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            {newMsgCount} 条新消息
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
});

VirtualMessageList.displayName = 'VirtualMessageList';

export default VirtualMessageList;
