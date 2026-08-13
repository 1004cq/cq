import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Video, Mic, Loader2, Copy, CornerUpRight, Trash2, Star, X, Shield, Ban, Camera, Clock, Check, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { DoveAvatar } from '@/components/DoveAvatar';
import { VoiceMessageBubble } from '@/components/VoiceMessageBubble';
import { BotVoiceBubble } from '@/components/BotVoiceBubble';
import { GoldVerifiedBadge } from '@/components/GoldVerifiedBadge';
import LocationMessageBubble from '@/components/LocationMessageBubble';
import { LinkPreviewCard, extractUrl, renderTextWithLinks } from '@/components/LinkPreviewCard';
import LottieSticker from '@/components/LottieSticker';
import { formatChatTime, getUserById, type Message, type BurnAfterReadTimer, BURN_TIMER_OPTIONS, formatBurnTimer } from '@/lib/store';
import { bubbleAnimations, springBubble, tgEaseOut } from '@/lib/animations';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const isAnimatedStickerSource = (url?: string, format?: string) => {
  if (format === 'json' || format === 'tgs') return true;
  if (!url) return false;
  return /\.json(\?.*)?$/i.test(url) || /\.tgs(\?.*)?$/i.test(url);
};

const getLocalStickerPngFallback = (url?: string) => {
  if (!url) return '';
  return /\/api\/stickers\/files\/.+\.webp(\?.*)?$/i.test(url)
    ? url.replace(/\.webp(\?.*)?$/i, '.png$1')
    : '';
};

function buildStickerRenderSources(message: Message): string[] {
  return Array.from(new Set([
    message.imageUrl,
    message.stickerUrl,
    getLocalStickerPngFallback(message.stickerUrl),
    getLocalStickerPngFallback(message.imageUrl),
  ].filter((value): value is string => !!value)));
}

const StickerMessageContent: React.FC<{ message: Message }> = ({ message }) => {
  const sources = useMemo(() => buildStickerRenderSources(message), [message.imageUrl, message.stickerUrl]);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [message.id, message.imageUrl, message.stickerUrl]);

  if (!message.stickerUrl) return null;

  if (isAnimatedStickerSource(message.stickerUrl)) {
    return (
      <LottieSticker
        src={message.stickerUrl}
        width={144}
        height={144}
        className="pointer-events-none select-none"
        fallbackEmoji={message.stickerEmoji || '🙂'}
      />
    );
  }

  const currentSrc = sources[sourceIndex] || message.stickerUrl;

  return (
    <img
      src={currentSrc}
      alt={message.stickerEmoji || message.content || '表情包'}
      className="max-w-[156px] max-h-[156px] rounded-2xl object-contain"
      onContextMenu={(e) => e.preventDefault()}
      onError={() => {
        if (sourceIndex < sources.length - 1) {
          setSourceIndex(prev => Math.min(prev + 1, sources.length - 1));
        }
      }}
    />
  );
};

// 表情数据
const EMOJI_LIST = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉',
  '😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲',
  '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔',
  '😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔',
  '😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶',
  '🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕',
  '👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👋','🤚',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💯','💢',
];

// 时间分组标签
function getTimeGroupLabel(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);

  if (diffDays === 0) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } else if (diffDays === 1) {
    return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } else if (diffDays < 7) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekdays[date.getDay()]} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

// 判断是否需要显示时间分组
function shouldShowTimeGroup(current: Message, previous?: Message): boolean {
  if (!previous) return true;
  return current.timestamp - previous.timestamp > 300000; // 5分钟
}

function getMessagePreviewText(message?: Message): string {
  if (!message) return '原消息不可用';
  switch (message.type) {
    case 'image':
      return '[图片]';
    case 'video':
      return '[视频]';
    case 'voice':
      return '[语音]';
    case 'location':
      return '[位置]';
    case 'sticker':
      return message.stickerEmoji || '[贴纸]';
    default:
      return message.content || '[消息]';
  }
}

// ===== 阅后即焚倒计时 Hook =====
function useBurnCountdown(message: Message, onBurn: () => void) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [isBurning, setIsBurning] = useState(false);

  useEffect(() => {
    if (!message.burnAfterRead || !message.readAt) return;

    const deadline = message.readAt + message.burnAfterRead * 1000;
    const update = () => {
      const now = Date.now();
      const left = Math.max(0, Math.ceil((deadline - now) / 1000));
      setRemaining(left);
      if (left <= 0 && !isBurning) {
        setIsBurning(true);
        setTimeout(onBurn, 700); // 等动画播完再删除
      }
    };

    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [message.burnAfterRead, message.readAt, onBurn, isBurning]);

  return { remaining, isBurning };
}

// ===== 阅后即焚选择器 =====
const BurnTimerSelector: React.FC<{
  selected: BurnAfterReadTimer | undefined;
  onSelect: (timer: BurnAfterReadTimer | undefined) => void;
  onClose: () => void;
}> = ({ selected, onSelect, onClose }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="absolute bottom-full right-0 mb-2 bg-dove-paper border border-border rounded-2xl shadow-xl overflow-hidden z-50 w-64"
    >
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame size={14} className="text-dove-seal" />
          <span className="text-xs font-medium text-dove-ink">阅后即焚</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>
      <div className="p-2">
        <button
          onClick={() => { onSelect(undefined); onClose(); }}
          className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors ${
            !selected ? 'bg-dove-green/10 text-dove-green font-medium' : 'hover:bg-dove-warm-gray text-muted-foreground'
          }`}
        >
          关闭
        </button>
        {BURN_TIMER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => { onSelect(opt.value); onClose(); }}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors ${
              selected === opt.value ? 'bg-dove-seal/10 text-dove-seal font-medium' : 'hover:bg-dove-warm-gray text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </motion.div>
  );
};

// ===== 消失消息模式选择器 =====
const EphemeralTimerSelector: React.FC<{
  currentTimer: BurnAfterReadTimer | undefined;
  onSelect: (timer: BurnAfterReadTimer | undefined) => void;
  onClose: () => void;
}> = ({ currentTimer, onSelect, onClose }) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-dove-paper rounded-t-3xl shadow-2xl pb-safe">
        <div className="px-6 py-4 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-dove-green" />
              <span className="text-sm font-medium text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>
                消失消息模式
              </span>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X size={18} />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            开启后，会话内所有新消息将在设定时间后自动销毁
          </p>
        </div>
        <div className="p-4 space-y-1">
          <button
            onClick={() => { onSelect(undefined); onClose(); }}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors ${
              !currentTimer ? 'bg-dove-green/10' : 'hover:bg-dove-warm-gray'
            }`}
          >
            <span className={`text-sm ${!currentTimer ? 'text-dove-green font-medium' : 'text-foreground'}`}>
              关闭消失消息
            </span>
            {!currentTimer && <Check size={16} className="text-dove-green" />}
          </button>
          {BURN_TIMER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onSelect(opt.value); onClose(); }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors ${
                currentTimer === opt.value ? 'bg-dove-seal/10' : 'hover:bg-dove-warm-gray'
              }`}
            >
              <span className={`text-sm ${currentTimer === opt.value ? 'text-dove-seal font-medium' : 'text-foreground'}`}>
                {opt.label}后消失
              </span>
              {currentTimer === opt.value && <Check size={16} className="text-dove-seal" />}
            </button>
          ))}
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom, 16px)' }} />
      </div>
    </motion.div>
  );
};

// ===== 长按菜单（含防转发/防复制逻辑）=====
const MessageContextMenu: React.FC<{
  message: Message;
  isSelf: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onAction: (action: string) => void;
}> = ({ message, isSelf, position, onClose, onAction }) => {
  // 防转发消息：隐藏复制和转发选项
  const isRestricted = message.forwardRestricted;

  const menuItems = [
    ...(!isRestricted ? [
      { icon: Copy, label: '复制', action: 'copy' },
      { icon: CornerUpRight, label: '转发', action: 'forward' },
    ] : []),
    { icon: CornerUpRight, label: '回复', action: 'reply' },
    { icon: Star, label: '收藏', action: 'favorite' },
    ...(isSelf ? [{ icon: Trash2, label: '撤回', action: 'recall' }] : []),
  ];

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: -5 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85 }}
        className="fixed z-50 bg-dove-ink/90 backdrop-blur-md rounded-xl shadow-xl overflow-hidden"
        style={{
          left: Math.min(position.x, window.innerWidth - 200),
          top: Math.min(position.y, window.innerHeight - 200),
        }}
      >
        {isRestricted && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10">
            <Ban size={11} className="text-dove-seal/80" />
            <span className="text-[10px] text-dove-seal/80">此消息已限制转发</span>
          </div>
        )}
        <div className="flex items-center gap-0.5 p-1.5">
          {menuItems.map(({ icon: Icon, label, action }) => (
            <button
              key={action}
              onClick={() => { onAction(action); onClose(); }}
              className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors min-w-[52px]"
            >
              <Icon size={18} className="text-white" />
              <span className="text-[10px] text-white/80">{label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </>
  );
};

// ===== 聊天骨架屏组件 =====
export const ChatSkeleton: React.FC = () => (
  <div className="px-3 py-3 space-y-4 animate-pulse">
    {[...Array(6)].map((_, i) => (
      <div key={i} className={`chat-skeleton-bubble ${i % 3 === 0 ? 'flex-row-reverse' : ''}`}>
        <div className="chat-skeleton-avatar skeleton-enhanced" />
        <div className="chat-skeleton-content">
          <div className={`chat-skeleton-line skeleton-enhanced ${i % 2 === 0 ? 'chat-skeleton-line-long' : 'chat-skeleton-line-medium'}`} />
          <div className="chat-skeleton-line chat-skeleton-line-short skeleton-enhanced" />
        </div>
      </div>
    ))}
  </div>
);

// ============================================================
// 子组件：加密媒体加载器 (P0)
// ============================================================
const EncryptedMediaLoader = React.memo(({ url, fileKey, iv, type }: { url: string, fileKey: string, iv: string, type: 'image' | 'video' }) => {
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;
    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('下载失败');
        const buffer = await resp.arrayBuffer();
        
        const { E2EEManager } = await import('@/lib/e2ee/E2EEManager');
        const e2ee = E2EEManager.shared();
        const decrypted = await e2ee.decryptFile(buffer, fileKey, iv);
        
        const blob = new Blob([decrypted]);
        objectUrl = URL.createObjectURL(blob);
        setDecryptedUrl(objectUrl);
      } catch (err) {
        console.error('[E2EE] 媒体解密失败:', err);
      } finally {
        setLoading(false);
      }
    })();
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, fileKey, iv]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center w-[180px] h-[120px] bg-dove-warm-gray/20 rounded-lg gap-2">
        <Loader2 size={16} className="animate-spin text-dove-green/40" />
        <span className="text-[10px] text-muted-foreground/50">正在解密媒体...</span>
      </div>
    );
  }

  if (!decryptedUrl) {
    return (
      <div className="flex flex-col items-center justify-center w-[180px] h-[120px] bg-red-50 rounded-lg border border-red-100">
        <Ban size={16} className="text-red-300" />
        <span className="text-[10px] text-red-400 mt-1">解密失败</span>
      </div>
    );
  }

  if (type === 'image') {
    return <img src={decryptedUrl} alt="" className="rounded-lg max-w-[240px] max-h-[180px] object-cover" />;
  }

  return (
    <video src={decryptedUrl} controls className="rounded-lg max-w-[240px] max-h-[180px] object-cover" preload="metadata" />
  );
});
EncryptedMediaLoader.displayName = 'EncryptedMediaLoader';

// ===== 消息气泡组件（含阅后即焚倒计时 + 焚毁动画）=====
// 使用 React.memo 避免不必要的重渲染
const ChatBubble: React.FC<{
  message: Message;
  showAvatar: boolean;
  showTimeGroup: boolean;
  senderProfile?: { name?: string; avatar?: string };
  onReaction: (emoji: string) => void;
  onBurn: (messageId: string) => void;
  onMarkRead: (messageId: string) => void;
  onPlayVoice?: (messageId: string, payload: any) => void;
  onStopVoice?: (messageId: string) => void;
  voicePlaybackState?: any;
  onJoinLocationShare?: (shareId: string) => void;
  onRecall?: (messageId: string) => void;
  onVerifyIntegrity?: (messageId: string) => void;
  onReply?: (message: Message) => void;
  onShowProfile?: (userId: string) => void;
}> = ({ message, showAvatar, showTimeGroup, senderProfile, onReaction, onBurn, onMarkRead, onPlayVoice, onStopVoice, voicePlaybackState, onJoinLocationShare, onRecall, onVerifyIntegrity, onReply, onShowProfile }) => {
  const currentUser = useCurrentUser();
  const _currentUserId = currentUser.id || localStorage.getItem('user_id') || 'me';
  const isSelf = message.senderId === 'me' || message.senderId === _currentUserId;
  const sender = getUserById(message.senderId);

  // 实时解析发送者名称
  const resolvedSenderName = isSelf 
    ? (currentUser.name || localStorage.getItem('user_name') || '我') 
    : (sender?.name || senderProfile?.name || (message.senderId === 'BOT' ? 'imim AI' : message.senderId === 'official' ? 'imim 官方' : '用户'));

  // 深度优化头像解析逻辑：
  // 1. 优先识别“自己”：无论 ID 是 'me' 还是实际 UUID，只要匹配当前登录用户，就强制使用 currentUser 实时数据
  // 2. 解决第一秒缺失：不再依赖 message 对象里可能还没同步过来的 senderProfile
  const resolvedSenderAvatar = isSelf
    ? (currentUser.avatar || localStorage.getItem('user_avatar') || '/default-avatar.png')
    : (sender?.avatar || senderProfile?.avatar || (
        message.senderId === 'BOT' ? '/imim-ai-avatar.jpg' : 
        message.senderId === 'official' ? '/imim-official-avatar.jpg' : 
        ''
      ));
  const [showReactions, setShowReactions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const touchTimerRef = useRef<any>(null);

  const reactions = ['❤️', '👍', '😂', '😮', '😢', '🎉'];

  // 可见性检测：消息进入视口时标记为已读（触发阅后即焚倒计时）+ 触发完整性验证
  useEffect(() => {
    const needsBurnRead = message.burnAfterRead && !message.readAt && !isSelf;
    const needsIntegrityVerify = message.hmac && message.integrityStatus === 'unverified' && !isSelf;
    if (!needsBurnRead && !needsIntegrityVerify) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isVisible) {
          setIsVisible(true);
          if (needsBurnRead) onMarkRead(message.id);
          if (needsIntegrityVerify && onVerifyIntegrity) onVerifyIntegrity(message.id);
        }
      },
      { threshold: 0.5 }
    );

    if (bubbleRef.current) observer.observe(bubbleRef.current);
    return () => observer.disconnect();
  }, [message.burnAfterRead, message.readAt, message.hmac, message.integrityStatus, isSelf, isVisible, onMarkRead, onVerifyIntegrity, message.id]);

  // 自己发送的阅后即焚消息：等待服务器推送 burn_read 通知（对方真正阅读后才开始倒计时）
  // 不再模拟对方已读，而是通过 WebSocket burn_read 信令触发

  // 阅后即焚倒计时
  const handleBurn = useCallback(() => {
    onBurn(message.id);
  }, [onBurn, message.id]);

  const { remaining, isBurning } = useBurnCountdown(message, handleBurn);

  const handleContextMenu = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0]?.clientX || 0 : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY || 0 : e.clientY;
    setContextMenu({ x: clientX, y: clientY });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (message.senderId === 'system') return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    touchTimerRef.current = setTimeout(() => {
      if (window.navigator.vibrate) window.navigator.vibrate(50);
      setContextMenu({ x, y });
      touchTimerRef.current = null;
    }, 500);
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleMenuAction = (action: string) => {
    switch (action) {
      case 'copy':
        if (message.forwardRestricted) {
          toast('此消息已限制复制');
          return;
        }
        navigator.clipboard?.writeText(message.content).then(() => toast('已复制'));
        break;
      case 'forward':
        if (message.forwardRestricted) {
          toast('此消息已限制转发');
          return;
        }
        toast('转发功能开发中');
        break;
      case 'reply':
        if (onReply) {
          onReply(message);
          toast('已进入回复状态');
        } else {
          toast('当前无法回复这条消息');
        }
        break;
      case 'favorite':
        toast('已收藏');
        break;
      case 'recall':
        if (onRecall) {
          onRecall(message.id);
          toast('消息已撤回');
        } else {
          toast('撤回功能暂不可用');
        }
        break;
    }
  };

  // AI 机器人消息：紫色渐变卡片样式
  const isBotMsg = message.senderId === 'BOT';

  // 官方账号消息：特殊蓝色卡片样式
  const isOfficialMsg = message.senderId === 'official';
  const isLoginAlert = isOfficialMsg && message.content.includes('登录安全提醒');

  // AI 机器人消息：紫色渐变卡片样式（支持文字+语音同时显示）
  if (isBotMsg) {
    const hasVoice = message.voiceUrl || (message.type === 'voice' && message.voiceUrl);
    const hasText = !!message.content;

    return (
      <>
        {showTimeGroup && (
          <div className="flex justify-center py-3">
            <span className="text-[10px] text-muted-foreground/70 bg-dove-warm-gray/50 px-3 py-1 rounded-full">
              {getTimeGroupLabel(message.timestamp)}
            </span>
          </div>
        )}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2 px-4 py-1.5"
        >
          {/* AI 头像 */}
          {showAvatar ? (
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 mt-0.5 ring-2 ring-purple-200 bg-white shadow-sm">
              <img src="/imim-ai-avatar.jpg" alt="imim AI" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-8 flex-shrink-0" />
          )}
          <div className="max-w-[78%] flex flex-col gap-1">
            {showAvatar && (
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11px] font-semibold text-purple-600">imim AI</span>
                <GoldVerifiedBadge size={13} className="flex-shrink-0" />
                <span className="text-[8px] font-semibold text-purple-500 bg-purple-50 px-1 py-0.5 rounded-full border border-purple-200/50">🤖 AI 助手</span>
              </div>
            )}
            
            {/* AI 文字内容 */}
            {hasText && (
              <div className="rounded-2xl rounded-tl-sm overflow-hidden border border-purple-100 bg-white shadow-sm">
                <div className="px-3 py-2.5">
                  <p className="text-sm text-dove-ink leading-relaxed whitespace-pre-line">
                    {message.content}
                  </p>
                </div>
              </div>
            )}

            {/* AI 语音消息气泡 */}
            {hasVoice && message.voiceUrl !== 'error' && (
              <BotVoiceBubble
                messageId={message.id}
                voiceUrl={message.voiceUrl!}
                duration={message.duration}
              />
            )}
            {hasVoice && message.voiceUrl === 'error' && (
              <div className="px-3 py-2 bg-red-50/50 border border-red-100 rounded-xl mt-1">
                <p className="text-[10px] text-red-500/80 flex items-center gap-1">
                  <span className="animate-pulse">⚠️</span> 语音生成失败，请先查看文字回复
                </p>
              </div>
            )}
            
            <span className="text-[9px] text-muted-foreground/60 mt-0.5 pl-1">
              {formatChatTime(message.timestamp)}
            </span>
          </div>
        </motion.div>
      </>
    );
  }

  if (isOfficialMsg && message.type === 'text') {
    return (
      <>
        {showTimeGroup && (
          <div className="flex justify-center py-3">
            <span className="text-[10px] text-muted-foreground/70 bg-dove-warm-gray/50 px-3 py-1 rounded-full">
              {getTimeGroupLabel(message.timestamp)}
            </span>
          </div>
        )}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2 px-4 py-1.5"
        >
          {/* 官方账号头像 */}
          {showAvatar ? (
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 mt-0.5 ring-2 ring-blue-200">
              <img src="/imim-official-avatar.jpg" alt="imim官方" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-8 flex-shrink-0" />
          )}
          <div className="max-w-[78%] flex flex-col">
            {showAvatar && (
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[11px] font-semibold text-blue-600">imim 官方</span>
                <GoldVerifiedBadge size={13} className="flex-shrink-0" />
                <span className="text-[8px] font-semibold text-blue-500 bg-blue-50 px-1 py-0.5 rounded-full border border-blue-200/50">官方认证</span>
              </div>
            )}
            {/* 消息卡片 */}
            <div className={`rounded-2xl rounded-tl-sm overflow-hidden border ${
              isLoginAlert
                ? 'bg-blue-50 border-blue-200'
                : 'bg-white border-blue-100'
            }`}>
              {isLoginAlert && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-500">
                  <Shield size={13} className="text-white" />
                  <span className="text-[11px] font-medium text-white">登录安全提醒</span>
                </div>
              )}
              <div className="px-3 py-2.5">
                <p className="text-sm text-dove-ink leading-relaxed whitespace-pre-line">
                  {isLoginAlert
                    ? message.content.replace('🔐 登录安全提醒\n\n', '')
                    : message.content
                  }
                </p>
                {isLoginAlert && (
                  <button
                    onClick={() => toast('已发送登出指令，其他设备将在30秒内退出', { icon: '🔒' })}
                    className="mt-2.5 w-full py-2 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-xs font-medium rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Shield size={12} />
                    一键登出其他设备
                  </button>
                )}
              </div>
            </div>
            <span className="text-[9px] text-muted-foreground/60 mt-0.5 pl-1">
              {formatChatTime(message.timestamp)}
            </span>
          </div>
        </motion.div>
      </>
    );
  }

  // 已撤回消息特殊渲染
  if (message.isRecalled) {
    return (
      <>
        {showTimeGroup && (
          <div className="flex justify-center py-3">
            <span className="text-[10px] text-muted-foreground/70 bg-dove-warm-gray/50 px-3 py-1 rounded-full">
              {getTimeGroupLabel(message.timestamp)}
            </span>
          </div>
        )}
        <div className={`flex gap-2 px-4 py-1 ${isSelf ? 'flex-row-reverse' : 'flex-row'}`}>
          {showAvatar && !isSelf ? (
            <DoveAvatar name={resolvedSenderName} id={message.senderId} avatar={resolvedSenderAvatar} size="sm" className="mt-1" onClick={() => onShowProfile?.(message.senderId)} />
          ) : (
            <div className="w-8 flex-shrink-0" />
          )}
          <div className="max-w-[70%] flex flex-col">
            <div className={`px-3 py-2 rounded-2xl bg-dove-warm-gray/60 border border-border/30`}>
              <p className="text-xs text-muted-foreground/70 italic">
                {isSelf ? '你撤回了一条消息' : '对方撤回了一条消息'}
              </p>
            </div>
            <span className="text-[9px] text-muted-foreground/50 mt-0.5 px-1">
              {formatChatTime(message.timestamp)}
            </span>
          </div>
        </div>
      </>
    );
  }

  // 系统消息（含截屏通知、入群通知、群管理通知等）
  if (message.type === 'system') {
    const isScreenshot = message.content.includes('截取了屏幕');
    const isJoinNotice = message.content.includes('加入了群聊') || message.content.includes('邀请');
    const isLeaveNotice = message.content.includes('退出群聊') || message.content.includes('移出群聊');
    const isAdminNotice = message.content.includes('管理员') || message.content.includes('群主');
    const isGroupUpdate = message.content.includes('群名') || message.content.includes('群公告') || message.content.includes('群头像') || message.content.includes('群 ID');
    return (
      <div className="flex justify-center py-2">
        <span className={`text-[10px] px-3 py-1 rounded-full flex items-center gap-1 max-w-[85%] text-center leading-relaxed ${
          isScreenshot
            ? 'screenshot-notice'
            : isJoinNotice
            ? 'text-emerald-600/80 bg-emerald-50/80 border border-emerald-100/50'
            : isLeaveNotice
            ? 'text-orange-600/80 bg-orange-50/80 border border-orange-100/50'
            : isAdminNotice
            ? 'text-blue-600/80 bg-blue-50/80 border border-blue-100/50'
            : isGroupUpdate
            ? 'text-indigo-600/80 bg-indigo-50/80 border border-indigo-100/50'
            : 'text-muted-foreground bg-dove-warm-gray/60'
        }`}>
          {isScreenshot && <Camera size={10} />}
          {message.content}
        </span>
      </div>
    );
  }

  // 通话记录消息
  if (message.type === 'call') {
    const isAudio = message.content.includes('📞');
    const isMissed = message.content.includes('未接') || message.content.includes('已拒绝');
    return (
      <div className="flex justify-center py-2">
        <span className={`text-[10px] px-3 py-1.5 rounded-full flex items-center gap-1.5 border ${
          isMissed
            ? 'text-red-400 bg-red-50 border-red-100'
            : 'text-dove-green bg-dove-green/5 border-dove-green/20'
        }`}>
          {isAudio ? <Phone size={10} /> : <Video size={10} />}
          {message.content}
        </span>
      </div>
    );
  }

  // 贴纸消息：无气泡背景，直接显示 Lottie 动画
  if (message.type === 'sticker' && message.stickerUrl) {
    return (
      <>
        {showTimeGroup && (
          <div className="flex justify-center py-3">
            <span className="tg-time-pill text-[10px] font-medium px-3 py-1 rounded-full">
              {getTimeGroupLabel(message.timestamp)}
            </span>
          </div>
        )}
        <motion.div
          ref={bubbleRef}
          initial={{ opacity: 0, scale: 0.7, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 15, stiffness: 300, mass: 0.6 }}
          className={`flex gap-1.5 px-3 py-0.5 ${isSelf ? 'flex-row-reverse' : 'flex-row'}`}
        >
          {/* 头像 */}
          {showAvatar && !isSelf ? (
            <DoveAvatar name={resolvedSenderName} id={message.senderId} avatar={resolvedSenderAvatar} size="sm" className="mt-0.5 shadow-sm" onClick={() => onShowProfile?.(message.senderId)} />
          ) : (
            <div className="w-9 flex-shrink-0" />
          )}
          <div className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
            <div
              className="cursor-pointer transition-transform hover:scale-105 active:scale-95"
              onContextMenu={handleContextMenu}
            >
              <StickerMessageContent message={message} />
            </div>
            <div className={`flex items-center gap-1 mt-0.5 px-1 ${isSelf ? 'flex-row-reverse' : ''}`}>
              <span className="text-[9px] text-muted-foreground/60">
                {formatChatTime(message.timestamp)}
              </span>
              {isSelf && (
                message.status === 'read' ? (
                  <CheckCheck size={10} className="text-sky-500" />
                ) : message.status === 'delivered' ? (
                  <CheckCheck size={10} className="text-muted-foreground/60" />
                ) : message.status === 'sending' ? (
                  <Loader2 size={9} className="text-muted-foreground/50 animate-spin" />
                ) : (
                  <Check size={10} className="text-muted-foreground/60" />
                )
              )}
            </div>
          </div>
        </motion.div>

        {/* 贴纸右键菜单 */}
        {contextMenu && (
          <div
            className="fixed inset-0 z-50"
            onClick={() => setContextMenu(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-border/40 py-1.5 min-w-[140px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              {[
                { icon: Copy, label: '复制', action: 'copy' },
                { icon: Star, label: '收藏', action: 'favorite' },
                ...(isSelf ? [{ icon: Trash2, label: '撤回', action: 'recall' }] : []),
              ].map(({ icon: Icon, label, action }) => (
                <button
                  key={action}
                  onClick={() => { handleMenuAction(action); setContextMenu(null); }}
                  className="flex items-center gap-2.5 px-4 py-2 w-full hover:bg-dove-warm-gray/60 dark:hover:bg-slate-700 transition-colors"
                >
                  <Icon size={14} className="text-muted-foreground" />
                  <span className="text-sm text-dove-ink dark:text-slate-200">{label}</span>
                </button>
              ))}
            </motion.div>
          </div>
        )}
      </>
    );
  }

  // 显示的消息内容（优先使用解密后的内容）
  const displayContent = message.decryptedContent || message.content;
  const isRestricted = message.forwardRestricted;
  const useInlineMeta = message.type === 'text' || !message.type;
  const shouldPinEncryptionBadge = message.isEncrypted && useInlineMeta;
  const showBelowMetaRow = !useInlineMeta || !!message.burnAfterRead || message.integrityStatus === 'verified' || message.integrityStatus === 'tampered';

  return (
    <>
      {/* 时间分组标签 */}
      {showTimeGroup && (
        <div className="flex justify-center py-3">
          <span className="tg-time-pill text-[10px] font-medium px-3 py-1 rounded-full">
            {getTimeGroupLabel(message.timestamp)}
          </span>
        </div>
      )}

      <motion.div
        ref={bubbleRef}
        initial={isSelf ? bubbleAnimations.messageSlideRight.initial : bubbleAnimations.messageSlideLeft.initial}
        animate={isSelf ? bubbleAnimations.messageSlideRight.animate : bubbleAnimations.messageSlideLeft.animate}
        transition={isSelf
          ? { ...springBubble }
          : { duration: 0.25, ease: tgEaseOut }
        }
        className={`flex gap-1.5 px-3 py-0.5 message-item ${isSelf ? 'flex-row-reverse' : 'flex-row'} ${isBurning ? 'animate-burn-away' : ''}`}
      >
        {/* 头像 */}
        {showAvatar && !isSelf ? (
          <DoveAvatar name={resolvedSenderName} id={message.senderId} avatar={resolvedSenderAvatar} size="sm" className="mt-0.5 shadow-sm" onClick={() => onShowProfile?.(message.senderId)} />
        ) : (
          <div className="w-9 flex-shrink-0" />
        )}

        <div className={`min-w-0 max-w-[min(78vw,22rem)] sm:max-w-[78%] md:max-w-[70%] ${isSelf ? 'items-end' : 'items-start'} flex flex-col`}>
          {/* 群聊发送者名称 */}
          {showAvatar && !isSelf && message.senderId !== 'system' && message.senderId !== 'BOT' && message.senderId !== 'official' && senderProfile && (
            <span className="text-[11px] font-medium text-muted-foreground/70 mb-0.5 ml-1 truncate max-w-[200px]">
              {resolvedSenderName}
            </span>
          )}
          {/* 气泡 */}
          <div
            className={`relative max-w-full overflow-hidden px-3.5 py-2.5 ${useInlineMeta ? (isSelf ? 'pr-[4.75rem] pb-[1.35rem]' : 'pr-[3.9rem] pb-[1.35rem]') : shouldPinEncryptionBadge ? 'pr-8 pb-6' : ''} ${isSelf ? 'bubble-self' : 'bubble-other'} ${isRestricted ? 'bubble-restricted' : ''}`}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchEnd}
            onClick={() => showReactions && setShowReactions(false)}
          >
            {/* 焚毁粒子效果 */}
            {isBurning && (
              <div className="absolute inset-0 pointer-events-none overflow-visible">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="ember-particle"
                    style={{
                      left: `${20 + i * 15}%`,
                      top: '20%',
                    }}
                  />
                ))}
              </div>
            )}

            {message.type === 'image' && (message as any).fileKey && (message as any).iv ? (
              <EncryptedMediaLoader 
                url={message.imageUrl!} 
                fileKey={(message as any).fileKey} 
                iv={(message as any).iv} 
                type="image" 
              />
            ) : message.type === 'image' && message.imageUrl ? (
              <img
                src={message.imageUrl}
                alt=""
                className="rounded-lg max-w-[240px] max-h-[180px] object-cover"
                onContextMenu={(e) => e.preventDefault()}
              />
            ) : message.type === 'video' && (message as any).fileKey && (message as any).iv ? (
              <EncryptedMediaLoader 
                url={message.videoUrl!} 
                fileKey={(message as any).fileKey} 
                iv={(message as any).iv} 
                type="video" 
              />
            ) : message.type === 'video' && message.videoUrl ? (
              <div className="relative rounded-lg max-w-[240px] overflow-hidden">
                <video
                  src={message.videoUrl}
                  className="rounded-lg max-w-[240px] max-h-[180px] object-cover"
                  controls
                  preload="metadata"
                  onContextMenu={(e) => e.preventDefault()}
                />
              </div>
            ) : message.type === 'voice' && message.voiceCiphertext ? (
              <VoiceMessageBubble
                messageId={message.id}
                payload={{
                  ciphertext: message.voiceCiphertext!,
                  iv: message.voiceIv!,
                  keyBase64: message.voiceKeyBase64!,
                  mimeType: message.voiceMimeType || 'audio/webm',
                  waveform: message.voiceWaveform || [],
                  duration: message.duration || 3,
                }}
                isSelf={isSelf}
                playbackState={voicePlaybackState}
                onPlay={onPlayVoice || (() => {})}
                onStop={onStopVoice || (() => {})}
              />
            ) : message.type === 'voice' ? (
              // 旧式模拟语音消息展示（历史数据兼容）
              <div className="flex items-center gap-2 min-w-[80px]">
                <Mic size={14} className={isSelf ? 'text-dove-green' : 'text-muted-foreground'} />
                <div className="flex gap-0.5">
                  {[...Array(Math.min(message.duration || 3, 8))].map((_, i) => (
                    <div key={i} className={`w-0.5 rounded-full ${isSelf ? 'bg-dove-green' : 'bg-muted-foreground/40'}`}
                      style={{ height: `${8 + Math.random() * 10}px` }} />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">{message.duration || 3}″</span>
              </div>
            ) : (message.type === 'location' || message.type === 'location_share') && message.locationData ? (
              // 位置/实时位置共享消息气泡
              <LocationMessageBubble
                data={message.locationData as any}
                isSelf={isSelf}
                onJoinShare={onJoinLocationShare}
              />
            ) : (
              <div>
                <p
                  className={`text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${isSelf ? 'text-dove-ink' : 'text-foreground'}`}
                  style={{ userSelect: isRestricted ? 'none' : 'text' }} // 防复制
                >
                  {renderTextWithLinks(displayContent, isSelf)}
                </p>
                {/* 链接预览卡片 */}
                {(() => {
                  const linkUrl = message.linkUrl || extractUrl(displayContent);
                  if (!linkUrl) return null;
                  return (
                    <LinkPreviewCard
                      url={linkUrl}
                      isSelf={isSelf}
                      cachedData={message.linkPreview}
                    />
                  );
                })()}
              </div>
            )}

            {/* 防转发标识 */}
            {isRestricted && (
              <span className="inline-flex items-center gap-0.5 ml-1 align-middle" title="此消息已限制转发和复制">
                <Ban size={9} className="text-dove-seal/60" />
              </span>
            )}

            {/* Telegram 风格的气泡内时间 / 状态 / 加密标识 */}
            {useInlineMeta ? (
              <span
                className={`absolute right-3 bottom-2 inline-flex items-center gap-1 whitespace-nowrap pointer-events-none text-[10px] leading-none ${
                  isSelf ? 'text-black/45 dark:text-white/65' : 'text-black/40 dark:text-white/55'
                }`}
                title={message.isEncrypted ? '端到端加密消息' : '消息时间'}
              >
                {message.isEncrypted && (
                  <Lock
                    size={10}
                    className={message.encryptedEnvelope ? 'text-dove-green/80 dark:text-sky-300/80' : 'text-dove-seal/75 dark:text-sky-300/70'}
                  />
                )}
                <span>{formatChatTime(message.timestamp)}</span>
                {isSelf && (
                  message.status === 'read' ? (
                    <CheckCheck size={11} className="text-sky-500" />
                  ) : message.status === 'delivered' ? (
                    <CheckCheck size={11} className="text-black/35 dark:text-white/55" />
                  ) : message.status === 'sending' ? (
                    <Loader2 size={10} className="animate-spin text-black/35 dark:text-white/55" />
                  ) : (
                    <Check size={11} className="text-black/35 dark:text-white/55" />
                  )
                )}
              </span>
            ) : (
              <>
                {message.isEncrypted && message.encryptedEnvelope && (
                  shouldPinEncryptionBadge ? (
                    <span className="absolute right-2 bottom-2 inline-flex items-center justify-center whitespace-nowrap pointer-events-none" title="Signal Protocol 端到端加密">
                      <Lock size={10} className="text-dove-green/85" />
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 ml-1 align-middle" title="Signal Protocol 端到端加密">
                      <Lock size={9} className="text-dove-green" />
                    </span>
                  )
                )}
                {message.isEncrypted && !message.encryptedEnvelope && (
                  shouldPinEncryptionBadge ? (
                    <span className="absolute right-2 bottom-2 inline-flex items-center justify-center whitespace-nowrap pointer-events-none" title="端到端加密">
                      <Lock size={10} className="text-dove-seal/80" />
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center ml-1 align-middle" title="端到端加密">
                      <Lock size={9} className="text-dove-seal/70" />
                    </span>
                  )
                )}
              </>
            )}
          </div>

          {/* 需要额外暴露的安全与焚毁状态 */}
          {showBelowMetaRow && (
            <div className={`flex items-center gap-1 mt-1 px-1 ${isSelf ? 'flex-row-reverse' : ''}`}>
              {!useInlineMeta && (
                <>
                  <span className="text-[9px] text-muted-foreground/60">
                    {formatChatTime(message.timestamp)}
                  </span>
                  {message.encryptedEnvelope && (
                    <ShieldCheck size={9} className="text-dove-green/60" />
                  )}
                  {isSelf && (
                    <span className="flex items-center gap-0.5">
                      {message.status === 'read' ? (
                        <CheckCheck size={10} className="text-sky-500" />
                      ) : message.status === 'delivered' ? (
                        <CheckCheck size={10} className="text-muted-foreground/60" />
                      ) : message.status === 'sending' ? (
                        <Loader2 size={9} className="text-muted-foreground/50 animate-spin" />
                      ) : (
                        <Check size={10} className="text-muted-foreground/60" />
                      )}
                    </span>
                  )}
                </>
              )}
              {/* 消息防篡改状态 */}
              {message.integrityStatus === 'verified' && (
                <span title="已验证 - 消息完整" className="flex items-center">
                  <ShieldCheck size={9} className="text-emerald-500" />
                </span>
              )}
              {message.integrityStatus === 'tampered' && (
                <span title="警告 - 消息可能已被篡改" className="flex items-center">
                  <Shield size={9} className="text-red-500" />
                </span>
              )}
              {/* 阅后即焚倒计时显示 */}
              {message.burnAfterRead && (
                <span className={`flex items-center gap-0.5 text-[9px] ${
                  remaining !== null && remaining <= 5 ? 'text-dove-seal' : 'text-muted-foreground/60'
                }`}>
                  <Flame size={9} className={remaining !== null && remaining <= 5 ? 'animate-hourglass text-dove-seal' : ''} />
                  {remaining !== null ? (
                    remaining > 0 ? `${remaining}s` : '销毁中'
                  ) : (
                    formatBurnTimer(message.burnAfterRead)
                  )}
                </span>
              )}
            </div>
          )}

          {/* Reactions */}
          {Object.keys(message.reactions).length > 0 && (
            <div className={`flex gap-1 mt-0.5 ${isSelf ? 'justify-end' : 'justify-start'}`}>
              {Object.entries(message.reactions).map(([emoji, count]) => (
                <span key={emoji} className="bg-dove-warm-gray rounded-full px-1.5 py-0.5 text-[11px]">
                  {emoji} {count}
                </span>
              ))}
            </div>
          )}

          {/* Reaction 选择器 */}
          <AnimatePresence>
            {showReactions && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`flex gap-1 mt-1 bg-white rounded-full px-2 py-1 shadow-lg border border-border ${isSelf ? 'self-end' : 'self-start'}`}
              >
                {reactions.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => { onReaction(emoji); setShowReactions(false); }}
                    className="text-base hover:scale-125 transition-transform p-0.5"
                  >
                    {emoji}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 长按菜单 */}
        <AnimatePresence>
          {contextMenu && (
            <MessageContextMenu
              message={message}
              isSelf={isSelf}
              position={contextMenu}
              onClose={() => setContextMenu(null)}
              onAction={handleMenuAction}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
};

// React.memo 包装 ChatBubble，减少不必要重渲染
export const MemoizedChatBubble = React.memo(ChatBubble, (prevProps, nextProps) => {
  // 自定义比较：只在关键属性变化时重渲染
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.status === nextProps.message.status &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.decryptedContent === nextProps.message.decryptedContent &&
    prevProps.message.readAt === nextProps.message.readAt &&
    prevProps.message.isRecalled === nextProps.message.isRecalled &&
    prevProps.message.integrityStatus === nextProps.message.integrityStatus &&
    prevProps.showAvatar === nextProps.showAvatar &&
    prevProps.showTimeGroup === nextProps.showTimeGroup &&
    JSON.stringify(prevProps.message.reactions) === JSON.stringify(nextProps.message.reactions) &&
    prevProps.voicePlaybackState === nextProps.voicePlaybackState
  );
});
