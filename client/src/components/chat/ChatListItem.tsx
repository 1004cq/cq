import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pin, X, VolumeX, Lock, MessageCircle } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { GoldVerifiedBadge } from '@/components/GoldVerifiedBadge';
import { formatTime, type Chat } from '@/lib/store';

interface ChatListItemProps {
  chat: Chat;
  index: number;
  isSwiped: boolean;
  currentUserId: string;
  onlineUsers: ReadonlySet<string>;
  isFixed: boolean;
  onOpen: (chatId: string) => void;
  onSwipeChange: (chatId: string | null) => void;
  onSwipeAction: (chatId: string, action: 'pin' | 'delete') => void;
}

export const ChatListItem = React.memo(function ChatListItem({
  chat,
  index,
  isSwiped,
  currentUserId,
  onlineUsers,
  isFixed,
  onOpen,
  onSwipeChange,
  onSwipeAction,
}: ChatListItemProps) {
  const peerId = chat.type === 'private'
    ? chat.members?.find(memberId => memberId !== currentUserId && memberId !== 'me')
    : undefined;
  const isOnline = peerId ? onlineUsers.has(peerId) : false;

  return (
    <motion.div
      initial={index < 8 ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: Math.min(index, 8) * 0.02, duration: 0.2 }}
      className="relative overflow-hidden"
      style={{ minHeight: 80 }}
    >
      <AnimatePresence>
        {isSwiped && !isFixed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-y-0 right-0 flex items-center z-10"
          >
            <button
              onClick={() => onSwipeAction(chat.id, 'pin')}
              className="h-full px-5 bg-dove-bamboo/80 flex flex-col items-center justify-center gap-0.5"
            >
              <Pin size={15} className="text-white" />
              <span className="text-[10px] text-white">{chat.isPinned ? '取消' : '置顶'}</span>
            </button>
            <button
              onClick={() => onSwipeAction(chat.id, 'delete')}
              className="h-full px-5 bg-red-500/80 flex flex-col items-center justify-center gap-0.5"
            >
              <X size={15} className="text-white" />
              <span className="text-[10px] text-white">删除</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        animate={{ x: isSwiped ? -120 : 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={`dove-list-item cursor-pointer relative z-20 ${(chat.isPinned && !isFixed) ? 'bg-dove-warm-gray/60' : 'bg-background'}`}
        onClick={() => {
          if (isSwiped) {
            onSwipeChange(null);
            return;
          }
          onOpen(chat.id);
        }}
        onTouchStart={(event) => {
          if (isFixed) return;
          const startX = event.touches[0]?.clientX ?? 0;
          const handleMove = (moveEvent: TouchEvent) => {
            const dx = (moveEvent.touches[0]?.clientX ?? 0) - startX;
            if (dx < -40) onSwipeChange(chat.id);
            else if (dx > 20) onSwipeChange(null);
          };
          const handleEnd = () => {
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('touchend', handleEnd);
          };
          document.addEventListener('touchmove', handleMove, { passive: true });
          document.addEventListener('touchend', handleEnd, { once: true });
        }}
      >
        <div className="relative flex-shrink-0">
          <DoveAvatar
            name={chat.name}
            id={chat.id}
            avatar={chat.avatar || ''}
            size="md"
            isGroup={chat.type === 'group'}
          />
          {chat.type === 'private' && (
            <div className={`status-dot absolute -bottom-0.5 -right-0.5 ${isOnline ? 'status-dot-online' : 'status-dot-offline'}`} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">{chat.name}</span>
              {chat.type === 'group' && (
                <MessageCircle size={14} strokeWidth={1.9} className="flex-shrink-0" style={{ color: '#1485ee', fill: 'none' }} />
              )}
              {chat.isOfficial && <GoldVerifiedBadge size={13} className="flex-shrink-0" />}
              {chat.isEncrypted && <Lock size={11} className="text-dove-bamboo/60 flex-shrink-0" />}
              {chat.isMuted && <VolumeX size={11} className="text-muted-foreground/40 flex-shrink-0" />}
              {chat.isPinned && !isFixed && <Pin size={10} className="text-dove-bamboo/50 flex-shrink-0" />}
            </div>
            <span className="text-[11px] text-muted-foreground/50 flex-shrink-0 ml-2">{formatTime(chat.lastMessageTime || 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-muted-foreground truncate flex-1">{chat.lastMessage || ''}</p>
            {chat.unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={`dove-badge ml-2 flex-shrink-0 ${chat.isMuted ? 'bg-muted-foreground/20 text-muted-foreground' : ''}`}
              >
                {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
              </motion.span>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});

export default ChatListItem;
