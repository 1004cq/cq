import React from 'react';
import { ArrowLeft, Clock, MoreVertical, Phone, Shield, Video } from 'lucide-react';
import { GoldVerifiedBadge } from '@/components/GoldVerifiedBadge';
import { formatBurnTimer, type BurnAfterReadTimer, type Chat } from '@/lib/store';

export interface ChatHeaderProps {
  chat: Chat;
  isGroupChat: boolean;
  otherUser?: { id: string; name: string; avatar?: string };
  isOtherOnline?: boolean;
  presenceLabel?: string;
  groupMemberCount?: number;
  ephemeralTimer?: BurnAfterReadTimer;
  e2ee: { isReady: boolean; isInitializing: boolean; sessionEstablished: boolean };
  onBack: () => void;
  onTitleClick: () => void;
  onCall: (type: 'audio' | 'video') => void;
  onShowChatInfo: () => void;
  onShowEncryption: () => void;
  onShowMLS: () => void;
}

function EncryptionBadge({
  e2ee,
  isGroupChat,
  onClick,
}: Pick<ChatHeaderProps, 'e2ee' | 'isGroupChat'> & { onClick: () => void }) {
  const ready = e2ee.isReady && e2ee.sessionEstablished;
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full transition-all duration-200 active:scale-95 ${
        ready
          ? 'bg-dove-green/15 border border-dove-green/30 hover:bg-dove-green/25'
          : e2ee.isInitializing
            ? 'bg-yellow-400/15 border border-yellow-400/30'
            : 'bg-muted/40 border border-border/50'
      }`}
    >
      <span className={`text-[8px] font-bold tracking-wider ${ready ? 'text-dove-green' : 'text-muted-foreground'}`}>
        {isGroupChat ? 'MLS' : 'E2EE'} {ready ? '🔒' : ''}
      </span>
      <span className={`text-[7px] whitespace-nowrap ${ready ? 'text-dove-green/80' : 'text-muted-foreground'}`}>
        {e2ee.isInitializing ? '建立安全会话...' : ready ? (isGroupChat ? '群组端到端加密' : 'Signal Protocol 加密') : '加密就绪中'}
      </span>
    </button>
  );
}

export const ChatHeader = React.memo(function ChatHeader({
  chat,
  isGroupChat,
  otherUser,
  isOtherOnline = false,
  presenceLabel,
  groupMemberCount = 0,
  ephemeralTimer,
  e2ee,
  onBack,
  onTitleClick,
  onCall,
  onShowChatInfo,
  onShowEncryption,
  onShowMLS,
}: ChatHeaderProps) {
  const isOfficial = chat.members?.includes('official');
  const isBot = chat.members?.includes('BOT');

  return (
    <header className="tg-chat-topbar flex items-center gap-2 px-2.5 py-3">
      <button type="button" onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-dove-warm-gray/60 transition-all active:scale-95" aria-label="返回">
        <ArrowLeft size={18} className="text-dove-ink dark:text-slate-100" />
      </button>

      <button type="button" className="flex-1 min-w-0 text-center cursor-pointer" onClick={onTitleClick}>
        <div className="flex items-center justify-center gap-1.5">
          <h2 className="text-sm font-medium text-dove-ink dark:text-slate-100 truncate" style={{ fontFamily: 'var(--font-wenkai)' }}>{chat.name}</h2>
          {(isOfficial || isBot) && <GoldVerifiedBadge size={16} className="flex-shrink-0" />}
          {isBot && <span className="text-[9px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full border border-purple-200/60">AI</span>}
          {ephemeralTimer && <span className="flex items-center gap-0.5 bg-dove-seal/10 text-dove-seal px-1.5 py-0.5 rounded-full text-[9px]"><Clock size={9} />{formatBurnTimer(ephemeralTimer)}</span>}
        </div>
        <div className="flex items-center justify-center gap-2 min-h-4">
          {isOfficial ? (
            <span className="text-[9px] font-medium text-blue-500">imim 官方认证账号</span>
          ) : isBot ? (
            <span className="text-[9px] font-medium text-purple-500">AI 智能助手 · 全天候在线</span>
          ) : isGroupChat ? (
            <>
              <span className="text-[9px] font-medium text-muted-foreground">{groupMemberCount > 0 ? `${groupMemberCount} 位成员` : '群聊'}</span>
              <EncryptionBadge e2ee={{ ...e2ee, sessionEstablished: true }} isGroupChat onClick={onShowMLS} />
            </>
          ) : (
            <>
              <span className={`w-1.5 h-1.5 rounded-full ${isOtherOnline ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]' : 'bg-gray-400'}`} />
              <span className={`text-[9px] font-medium ${isOtherOnline ? 'text-green-600' : 'text-muted-foreground'}`}>{presenceLabel || (isOtherOnline ? '在线' : '离线')}</span>
              <EncryptionBadge e2ee={e2ee} isGroupChat={false} onClick={onShowEncryption} />
            </>
          )}
        </div>
      </button>

      <div className="flex items-center gap-0.5">
        {chat.type === 'private' && !isOfficial && !isBot && otherUser && (
          <>
            <button type="button" onClick={() => onCall('audio')} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-dove-green/8 transition-all active:scale-95" aria-label="语音通话"><Phone size={17} className="text-dove-green" /></button>
            <button type="button" onClick={() => onCall('video')} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-dove-green/8 transition-all active:scale-95" aria-label="视频通话"><Video size={17} className="text-dove-green" /></button>
          </>
        )}
        <button type="button" onClick={onShowChatInfo} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-dove-warm-gray/60 transition-all active:scale-95" aria-label="聊天资料"><MoreVertical size={18} className="text-dove-ink dark:text-slate-100" /></button>
      </div>
    </header>
  );
});

export default ChatHeader;
