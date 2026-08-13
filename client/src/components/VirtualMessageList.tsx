/**
 * CQIM 统一窗口化消息列表
 *
 * 只渲染视口附近的消息，消息高度通过 ResizeObserver 动态测量；
 * 不依赖第三方虚拟列表库，群聊与私聊都可以复用。
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springBadge } from '@/lib/animations';

export interface VirtualMessageItem {
  id?: string;
  seq?: number;
  senderId: string;
  senderName?: string;
  msgType?: string;
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'delivered' | 'failed' | string;
  isRevoked?: boolean;
}

interface VirtualMessageListProps {
  messages: VirtualMessageItem[];
  currentUserId: string;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  renderMessage?: (
    msg: VirtualMessageItem,
    isOwn: boolean,
    index: number,
    previous?: VirtualMessageItem,
  ) => React.ReactNode;
  className?: string;
  estimatedRowHeight?: number;
}

const DEFAULT_ROW_HEIGHT = 76;
const OVERSCAN_PX = 900;
const LOAD_MORE_THRESHOLD = 240;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${hours}:${mins}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hours}:${mins}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hours}:${mins}`;
}

function shouldShowTimeSeparator(current: VirtualMessageItem, previous?: VirtualMessageItem): boolean {
  return !previous || current.timestamp - previous.timestamp > 5 * 60 * 1000;
}

const DefaultMessageBubble = memo(({ msg, isOwn }: { msg: VirtualMessageItem; isOwn: boolean }) => {
  if (msg.msgType === 'system') {
    return (
      <div className="flex justify-center py-1.5">
        <span className="text-xs text-dove-ink/40 bg-dove-mist/50 px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    );
  }

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-3 py-0.5 message-item`}>
      {!isOwn && (
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-dove-green/20 to-dove-bamboo/20 flex items-center justify-center text-xs font-medium text-dove-green mr-2 mt-0.5 flex-shrink-0">
          {(msg.senderName || msg.senderId).charAt(0).toUpperCase()}
        </div>
      )}
      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isOwn && <span className="text-[10px] text-dove-ink/40 mb-0.5 ml-1">{msg.senderName || msg.senderId}</span>}
        <div className={`relative px-3 py-2 rounded-2xl text-sm leading-relaxed break-words gpu-accelerated ${isOwn ? 'bg-gradient-to-br from-dove-green to-dove-bamboo text-white rounded-tr-md' : 'bg-white dark:bg-dove-ink/10 text-dove-ink rounded-tl-md shadow-soft-sm'}`}>
          {msg.content}
          {isOwn && msg.status && (
            <span className="inline-block ml-1.5 align-bottom">
              {msg.status === 'sending' && <span className="inline-block w-3 h-3 border border-white/50 border-t-transparent rounded-full animate-spin" />}
              {(msg.status === 'sent' || msg.status === 'delivered') && (
                <svg className="inline w-3 h-3 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
          )}
        </div>
        <span className={`text-[10px] text-dove-ink/30 mt-0.5 ${isOwn ? 'mr-1' : 'ml-1'}`}>{formatTime(msg.timestamp)}</span>
      </div>
    </div>
  );
});
DefaultMessageBubble.displayName = 'DefaultMessageBubble';

const TimeSeparator = memo(({ timestamp }: { timestamp: number }) => (
  <div className="flex justify-center py-2">
    <span className="text-[10px] text-dove-ink/30 bg-dove-mist/30 px-2.5 py-0.5 rounded-full">{formatTime(timestamp)}</span>
  </div>
));
TimeSeparator.displayName = 'TimeSeparator';

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

export const VirtualMessageList = memo(({
  messages,
  currentUserId,
  loading = false,
  hasMore = true,
  onLoadMore,
  renderMessage,
  className = '',
  estimatedRowHeight = DEFAULT_ROW_HEIGHT,
}: VirtualMessageListProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const rowHeightsRef = useRef(new Map<string, number>());
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null);
  const isLoadingMoreRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const prevLengthRef = useRef(messages.length);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [showNewMsgTip, setShowNewMsgTip] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);

  const getKey = useCallback((msg: VirtualMessageItem, index: number) => `${msg.id || msg.seq || 'message'}-${index}`, []);
  const getHeight = useCallback((msg: VirtualMessageItem, index: number) => rowHeightsRef.current.get(getKey(msg, index)) || estimatedRowHeight, [estimatedRowHeight, getKey]);

  const getRange = useCallback(() => {
    const startLimit = Math.max(0, scrollTop - OVERSCAN_PX);
    const endLimit = scrollTop + viewportHeight + OVERSCAN_PX;
    let offset = 0;
    let start = 0;
    let end = messages.length;
    for (let i = 0; i < messages.length; i += 1) {
      const next = offset + getHeight(messages[i], i);
      if (next >= startLimit) { start = i; break; }
      offset = next;
    }
    offset = 0;
    for (let i = 0; i < messages.length; i += 1) {
      offset += getHeight(messages[i], i);
      if (offset >= endLimit) { end = i + 1; break; }
    }
    return { start, end };
  }, [getHeight, messages, scrollTop, viewportHeight]);

  const getOffsetBefore = useCallback((index: number) => {
    let offset = 0;
    for (let i = 0; i < index; i += 1) offset += getHeight(messages[i], i);
    return offset;
  }, [getHeight, messages]);

  const totalHeight = messages.reduce((sum, msg, index) => sum + getHeight(msg, index), 0);
  const { start, end } = getRange();

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isAtBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isAtBottomRef.current) {
      setShowNewMsgTip(false);
      setNewMsgCount(0);
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setScrollTop(container.scrollTop);
      setViewportHeight(container.clientHeight);
    });
    if (container.scrollTop < LOAD_MORE_THRESHOLD && hasMore && onLoadMore && !isLoadingMoreRef.current) {
      isLoadingMoreRef.current = true;
      prependScrollRef.current = { height: container.scrollHeight, top: container.scrollTop };
      onLoadMore();
      window.setTimeout(() => { isLoadingMoreRef.current = false; }, 600);
    }
  }, [hasMore, onLoadMore]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setViewportHeight(container.clientHeight);
      setLayoutVersion(version => version + 1);
    });
    observer.observe(container);
    setViewportHeight(container.clientHeight);
    setScrollTop(container.scrollTop);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const pending = prependScrollRef.current;
    const container = scrollContainerRef.current;
    if (!pending || !container) return;
    const delta = container.scrollHeight - pending.height;
    if (delta > 0) container.scrollTop = pending.top + delta;
    prependScrollRef.current = null;
    setScrollTop(container.scrollTop);
  }, [messages.length, layoutVersion]);

  useEffect(() => {
    const added = messages.length - prevLengthRef.current;
    if (added > 0) {
      if (isAtBottomRef.current) {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: added <= 3 ? 'smooth' : 'auto' }));
      } else {
        setNewMsgCount(count => count + added);
        setShowNewMsgTip(true);
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowNewMsgTip(false);
    setNewMsgCount(0);
  }, []);

  const measureRow = useCallback((key: string, node: HTMLDivElement | null) => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height;
      if (height && Math.abs((rowHeightsRef.current.get(key) || 0) - height) > 1) {
        rowHeightsRef.current.set(key, height);
        setLayoutVersion(version => version + 1);
      }
    });
    observer.observe(node);
  }, []);

  return (
    <div className={`relative flex-1 overflow-hidden ${className}`}>
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-contain chat-messages-container"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {loading && hasMore && <div className="flex justify-center py-3"><span className="w-4 h-4 border-2 border-dove-green/30 border-t-dove-green rounded-full animate-spin" /></div>}
        {loading && messages.length === 0 && <MessageSkeleton />}
        {!hasMore && messages.length > 0 && <div className="flex justify-center py-3"><span className="text-[10px] text-dove-ink/25">—— 已无更多消息 ——</span></div>}
        <div style={{ height: totalHeight, position: 'relative' }}>
          {messages.slice(start, end).map((msg, visibleIndex) => {
            const index = start + visibleIndex;
            const key = getKey(msg, index);
            const previous = index > 0 ? messages[index - 1] : undefined;
            const isOwn = msg.senderId === currentUserId;
            return (
              <div
                key={key}
                ref={node => measureRow(key, node)}
                className="absolute left-0 right-0"
                style={{ transform: `translateY(${getOffsetBefore(index)}px)`, contain: 'layout paint style' }}
              >
                {shouldShowTimeSeparator(msg, previous) && <TimeSeparator timestamp={msg.timestamp} />}
                {renderMessage ? renderMessage(msg, isOwn, index, previous) : <DefaultMessageBubble msg={msg} isOwn={isOwn} />}
              </div>
            );
          })}
        </div>
        <div ref={bottomRef} className="h-px" />
      </div>
      <AnimatePresence>
        {showNewMsgTip && (
          <motion.button
            initial={{ opacity: 0, y: 20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.8 }}
            transition={springBadge}
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 bg-dove-green text-white text-xs font-medium rounded-full shadow-lg z-10"
          >
            ↓ {newMsgCount} 条新消息
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
});

VirtualMessageList.displayName = 'VirtualMessageList';
export default VirtualMessageList;
