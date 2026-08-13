import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DoveAvatar } from '@/components/DoveAvatar';
import VirtualMessageList, { type VirtualMessageItem } from '@/components/VirtualMessageList';

export interface MessageListContainerProps {
  messages: VirtualMessageItem[];
  currentUserId: string;
  loading: boolean;
  hasMore: boolean;
  renderMessage: (message: VirtualMessageItem, isOwn: boolean, index: number, previous?: VirtualMessageItem) => React.ReactNode;
  typing?: boolean;
  typingName?: string;
  typingUserId?: string;
  typingAvatar?: string;
  className?: string;
}

export const MessageListContainer = React.memo(function MessageListContainer({
  messages,
  currentUserId,
  loading,
  hasMore,
  renderMessage,
  typing = false,
  typingName,
  typingUserId,
  typingAvatar,
  className = '',
}: MessageListContainerProps) {
  return (
    <div className={`flex-1 min-h-0 flex flex-col ${className}`} style={{ background: 'var(--imim-chat-bg, transparent)' }}>
      <VirtualMessageList
        messages={messages}
        currentUserId={currentUserId}
        loading={loading}
        hasMore={hasMore}
        renderMessage={renderMessage}
        className="px-1 py-3"
        estimatedRowHeight={88}
      />
      <AnimatePresence>
        {typing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex gap-2 px-4 py-2 overflow-hidden">
            <DoveAvatar name={typingName || '?'} id={typingUserId || 'typing-user'} avatar={typingAvatar || ''} size="sm" className="mt-1" />
            <div className="bubble-other px-4 py-3 flex items-center gap-1">
              {[0, 1, 2].map(index => (
                <motion.div key={index} className="w-2 h-2 bg-muted-foreground/40 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: index * 0.2 }} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default MessageListContainer;
