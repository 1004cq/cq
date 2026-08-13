/**
 * imim 聊天详情页
 * 集成 Signal Protocol E2EE：消息加密发送、解密接收、加密状态展示
 * 隐私安全功能：阅后即焚、消失消息模式、焚毁动画、截屏检测、防转发/防复制
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { DoveAvatar } from '@/components/DoveAvatar';
import { EncryptionInfo } from '@/components/EncryptionInfo';
import {
  formatChatTime, getUserById, CURRENT_USER, type Message,
  type BurnAfterReadTimer, BURN_TIMER_OPTIONS, formatBurnTimer,
} from '@/lib/store';
import { useE2EE } from '@/hooks/useE2EE';
import { useVoiceMessage } from '@/hooks/useVoiceMessage';
import { VoiceMessageBubble, RecordingPreview } from '@/components/VoiceMessageBubble';
import { BotVoiceBubble } from '@/components/BotVoiceBubble';
import { motion, AnimatePresence } from 'framer-motion';
import { bubbleAnimations, springBubble, tgEaseOut } from '@/lib/animations';
import { GoldVerifiedBadge } from '@/components/GoldVerifiedBadge';
import {
  ArrowLeft, Phone, Video, MoreVertical, Send, Mic, Image,
  Paperclip, Lock, Check, CheckCheck, Copy, CornerUpRight, Trash2, Star,
  X, Shield, ShieldCheck, Key, Loader2, Smile,
  Flame, Timer, Eye, EyeOff, Ban, Camera, Clock, MapPin, Sticker, Link2, Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import LocationMessageBubble from '@/components/LocationMessageBubble';
import LocationPicker from '@/components/LocationPicker';
import type { LocationPickerResult } from '@/components/LocationPicker';
import LocationSharePage from '@/pages/LocationSharePage';
import { LinkPreviewCard, extractUrl, renderTextWithLinks } from '@/components/LinkPreviewCard';
import { deriveIntegrityKey, signMessage, verifyMessage } from '@/lib/messageIntegrity';
import { useGroupSync, type GroupMessage } from '@/hooks/useGroupSync';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { preFetchVideoStream } from '@/lib/mediaManager';
import StickerPanel, { type StickerItem } from '@/components/StickerPanel';
import LottieSticker from '@/components/LottieSticker';
import { GroupSettingsModal } from '@/components/GroupSettingsModal';
import { GroupInfoSheet } from '@/components/GroupInfoSheet';
import { PrivateChatInfoSheet } from '@/components/PrivateChatInfoSheet';
import { MLSEncryptionInfo } from '@/components/MLSEncryptionInfo';

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
const ChatSkeleton: React.FC = () => (
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
const MemoizedChatBubble = React.memo(ChatBubble, (prevProps, nextProps) => {
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

// E2EE 状态栏组件
const E2EEStatusBar: React.FC<{
  isReady: boolean;
  isInitializing: boolean;
  sessionEstablished: boolean;
  onShowEncryption: () => void;
}> = ({ isReady, isInitializing, sessionEstablished, onShowEncryption }) => {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onShowEncryption(); }}
      className={`
        inline-flex items-center gap-0.5 px-1.5 py-px rounded-full
        transition-all duration-200 active:scale-95
        ${
          isReady && sessionEstablished
            ? 'bg-dove-green/15 backdrop-blur-sm border border-dove-green/30 shadow-[0_0_8px_rgba(76,175,80,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-dove-green/25 hover:shadow-[0_0_12px_rgba(76,175,80,0.4),inset_0_1px_0_rgba(255,255,255,0.4)]'
            : isInitializing
            ? 'bg-yellow-400/15 backdrop-blur-sm border border-yellow-400/30'
            : 'bg-dove-green/10 backdrop-blur-sm border border-dove-green/20'
        }
      `}
    >
      {isInitializing ? (
        <>
          <Loader2 size={8} className="text-yellow-500 animate-spin" />
          <span className="text-[9px] text-yellow-600 font-medium">正在建立加密...</span>
        </>
      ) : isReady && sessionEstablished ? (
        <div className="flex flex-col items-center" style={{lineHeight:'1.1'}}>
          <span className="text-[8px] text-dove-green font-bold tracking-wider flex items-center gap-0.5">
            E2EE <span className="text-[7px]">🔒</span>
          </span>
          <span className="text-[7px] text-dove-green/80 font-medium whitespace-nowrap">Signal Protocol加密</span>
        </div>
      ) : isReady ? (
        <>
          <Shield size={8} className="text-dove-green" />
          <span className="text-[9px] text-dove-green font-medium">加密就绪</span>
        </>
      ) : (
        <>
          <Lock size={8} className="text-muted-foreground" />
          <span className="text-[9px] text-muted-foreground">加密中</span>
        </>
      )}
    </button>
  );
};

// 主页面
export default function ChatDetailPage() {
  const { state, signalWs, dispatch } = useApp();
  const currentUser = useCurrentUser();
  const {
    closeChat, sendMessage, addReaction, startCall,
    markMessageRead, burnMessage, setEphemeralTimer, insertScreenshotNotice,
    insertCallRecord, recallMessage, setMessages, upsertChat,
    muteChat, clearMessages, pinChat, showProfile,
  } = useAppActions();
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [inputText, setInputText] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showEncryption, setShowEncryption] = useState(false);
  const [showMLSInfo, setShowMLSInfo] = useState(false);
  const [typingIndicator, setTypingIndicator] = useState(false);

  // ===== 加密语音消息 Hook =====
  const voice = useVoiceMessage();
  // 录音按下状态（按住录音模式）
  const [voicePressActive, setVoicePressActive] = useState(false);
  const [sessionEstablished, setSessionEstablished] = useState(false);
  const [encryptionLog, setEncryptionLog] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // ===== 隐私功能状态 =====
  const [burnTimer, setBurnTimer] = useState<BurnAfterReadTimer | undefined>(undefined);
  const [showBurnSelector, setShowBurnSelector] = useState(false);
  const [forwardRestricted, setForwardRestricted] = useState(false);
  const [showStickerPanel, setShowStickerPanel] = useState(false);
  const [showEphemeralSelector, setShowEphemeralSelector] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // 位置共享状态
  const [showLocationShare, setShowLocationShare] = useState(false);
  const [locationShareId, setLocationShareId] = useState<string | undefined>(undefined);
  // 位置选择器状态（单次发送位置）
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  // 图片/视频上传
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  // 群设置弹窗
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  // 群聊信息 Sheet（微信风格）
  const [showGroupInfoSheet, setShowGroupInfoSheet] = useState(false);
  // 私聊聊天详情 Sheet
  const [showPrivateChatInfo, setShowPrivateChatInfo] = useState(false);

  // ===== 群聊 @ 提及状态 =====
  const [groupMembers, setGroupMembers] = useState<Array<{ id: string; name: string; avatar?: string }>>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = 未触发，'' = 触发中
  const [mentionAnchor, setMentionAnchor] = useState(0); // @ 在输入框中的位置
  const [pendingMentions, setPendingMentions] = useState<string[]>([]); // 待发送的 mentions 用户 ID 列表

  const chatId = state.currentChatId;
  const chat = state.chats.find(c => c.id === chatId);
  const isGroupChat = chat?.type === 'group' && !!chat?.groupId;

  // ===== 群聊消息同步 Hook =====
  const groupSync = useGroupSync({
    groupId: chat?.groupId || '',
    userId: state.currentUser?.id || localStorage.getItem('user_id') || 'me',
    ws: signalWs?.current || null,
    enabled: isGroupChat,
    onNewMessage: useCallback((msg) => {
      if (!chatId || !chat) return;
      // 更新会话列表的最后一条消息预览
      const preview = msg.msgType === 'image' ? '[图片]' :
        msg.msgType === 'video' ? '[视频]' :
        msg.msgType === 'voice' ? '[语音]' :
        msg.msgType === 'sticker' ? '[贴纸]' :
        msg.msgType === 'location' ? '[位置]' :
        msg.msgType === 'system' ? msg.content :
        msg.content || '';
      const senderLabel = msg.senderId === (state.currentUser?.id || 'me') ? '' : `${msg.senderName}: `;
      upsertChat({
        ...chat,
        lastMessage: `${senderLabel}${preview}`,
        lastMessageTime: msg.timestamp,
      });
    }, [chatId, chat, state.currentUser?.id, upsertChat]),
  });

  // 将 GroupMessage 转换为 Message 格式
  const groupMessagesAsMessages = useMemo((): Message[] => {
    if (!isGroupChat || !chatId) return [];
    return groupSync.messages.map((gm: GroupMessage): Message => ({
      id: gm.id,
      chatId,
      senderId: gm.senderId,
      content: gm.isRevoked ? '消息已撤回' : gm.content,
      type: (gm.msgType || 'text') as Message['type'],
      timestamp: gm.timestamp,
      isEncrypted: gm.mlsEncrypted || false,
      encryptedEnvelope: gm.mlsEncrypted ? 'mls' : undefined,
      reactions: {},
      status: gm.status === 'sending' ? 'sending' : 'delivered',
      isRecalled: gm.isRevoked,
      ...(gm.extra?.imageUrl ? { imageUrl: gm.extra.imageUrl } : {}),
      ...(gm.extra?.videoUrl ? { videoUrl: gm.extra.videoUrl } : {}),
      ...(gm.extra?.stickerUrl ? { stickerUrl: gm.extra.stickerUrl, stickerEmoji: gm.extra.stickerEmoji, stickerSetName: gm.extra.stickerSetName } : {}),
      ...(gm.extra?.locationData ? { locationData: gm.extra.locationData } : {}),
      ...(gm.extra?.voiceUrl ? { voiceUrl: gm.extra.voiceUrl, duration: gm.extra.duration || 0 } : {}),
      ...(gm.replyToId ? { replyTo: gm.replyToId } : {}),
      ...(gm.extra?.mentions ? { mentions: gm.extra.mentions } : {}),
    }));
  }, [isGroupChat, chatId, groupSync.messages]);

  // 统一消息列表：群聊用 groupSync，私聊用 AppContext
  const messages = isGroupChat
    ? groupMessagesAsMessages
    : (chatId ? (state.messages[chatId] || []) : []);

  // E2EE Hook
  const e2ee = useE2EE();

  const currentUserId = state.currentUser?.id || localStorage.getItem('user_id') || 'me';
  const otherMember = chat?.members?.find(m => m !== currentUserId) || chat?.members?.find(m => m !== 'me');

  // ===== 消息防篡改：派生 HMAC 完整性密钥 =====
  const [integrityKey, setIntegrityKey] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    if (!chatId || !currentUserId || !otherMember) return;
    deriveIntegrityKey(chatId, currentUserId, otherMember).then(setIntegrityKey).catch(() => {});
  }, [chatId, currentUserId, otherMember]);
  // otherUser: 优先从 MOCK_USERS 查找，找不到则用 chat 信息构造基础对象（避免弹窗因 null 而不渲染）
  const otherUser = otherMember
    ? (getUserById(otherMember) ?? {
        id: otherMember,
        name: chat?.name || otherMember,
        avatar: chat?.avatar || '',
        status: state.onlineUsers.has(otherMember) ? 'online' as const : 'offline' as const,
      })
    : null;

  // ===== Presence 状态：设备信息 + 最后在线时间 =====
  const [presenceDevices, setPresenceDevices] = useState<Array<{deviceType: string; browser: string; os: string}>>([]);
  const [presenceLastSeen, setPresenceLastSeen] = useState<number | null>(null);

  // 格式化最后在线时间
  const formatLastSeen = (ts: number | null): string => {
    if (!ts) return '很久之前';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  // 进入会话时加载 Presence
  useEffect(() => {
    if (!otherMember || chat?.type !== 'private') return;
    const token = localStorage.getItem('auth_token');
    fetch(`/api/users/${otherMember}/presence`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setPresenceDevices(data.devices || []);
        setPresenceLastSeen(data.lastSeen ?? null);
      })
      .catch(() => {});
  }, [otherMember, chatId]);

  // ===== 进入会话时从 API 加载历史消息 =====
  useEffect(() => {
    if (!chatId || chatId === 'c0' || chatId === 'cBOT') return;
    // 如果已有消息，不重复加载
    if (state.messages[chatId]?.length) return;

    const token = localStorage.getItem('user_token');
    if (!token) return;

    setLoadingMessages(true);
    fetch(`/api/chat/${chatId}/messages?limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(async data => {
        if (!data?.messages) return;
        
        const msgs: Message[] = await Promise.all(data.messages.map(async (m: any) => {
          let decryptedContent = m.isRevoked ? '消息已撤回' : (m.content || '');
          let finalMsgType = m.msgType || 'text';
          let finalExtra = typeof m.extra === 'string' ? JSON.parse(m.extra) : m.extra;
          let decryptionFailed = false;

          // P0: 历史消息解密，非加密明文消息打上不支持占位
          if (m.msgType === 'encrypted' && m.content && !m.isRevoked) {
            try {
              const envelope = JSON.parse(m.content);
              const decryptedStr = await e2ee.decrypt(m.senderId, envelope);
              const decrypted = JSON.parse(decryptedStr);
              decryptedContent = decrypted.content;
              finalMsgType = decrypted.msgType || 'text';
              finalExtra = { ...finalExtra, ...decrypted.extra };
            } catch (err) {
              console.error('[E2EE] 历史消息解密失败:', err);
              decryptedContent = '🔒 无法解密历史消息';
              decryptionFailed = true;
            }
          } else if (m.msgType !== 'encrypted' && !m.isRevoked) {
            decryptedContent = '⚠️ [不支持的旧明文消息]';
            decryptionFailed = true;
          }

          return {
            id: m.id,
            chatId: m.chatId,
            senderId: m.senderId,
            content: decryptedContent,
            type: finalMsgType as any,
            timestamp: m.createdAt || Date.now(),
            isEncrypted: true,
            decryptionFailed,
            reactions: {},
            status: m.status || 'sent',
            isRecalled: m.isRevoked || false,
            replyTo: m.replyToId || undefined,
            ...(finalExtra?.voiceUrl ? { voiceUrl: finalExtra.voiceUrl, duration: finalExtra.duration || 0 } : {}),
            ...(finalExtra?.imageUrl ? { imageUrl: finalExtra.imageUrl } : {}),
            ...(finalExtra?.videoUrl ? { videoUrl: finalExtra.videoUrl } : {}),
            ...(finalExtra?.locationData ? { locationData: finalExtra.locationData } : {}),
            ...(finalExtra?.stickerUrl ? { stickerUrl: finalExtra.stickerUrl, stickerEmoji: finalExtra.stickerEmoji, stickerSetName: finalExtra.stickerSetName } : {}),
            ...(m.hmac ? { hmac: m.hmac, integrityStatus: 'unverified' as const } : {}),
          };
        }));

        setMessages(chatId, msgs);
        setHasMoreMessages(data.hasMore || false);
      })
      .catch(err => console.error('[ChatDetail] 加载消息失败:', err))
      .finally(() => setLoadingMessages(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // 检查会话状态
  useEffect(() => {
    if (e2ee.isReady && otherMember) {
      e2ee.getSessionInfo(otherMember).then(info => {
        if (info?.established) {
          setSessionEstablished(true);
        }
      });
    }
  }, [e2ee.isReady, otherMember]);

  // 同步消失消息模式定时器
  useEffect(() => {
    if (chat?.ephemeralTimer !== undefined) {
      setBurnTimer(chat.ephemeralTimer);
    }
  }, [chat?.ephemeralTimer]);

  // ===== 截屏检测 =====
  useEffect(() => {
    if (!chatId) return;

    // 监听键盘截屏快捷键（PrintScreen）
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === '5'))) {
        insertScreenshotNotice(chatId, CURRENT_USER.name);
        toast('截屏已被记录', { icon: '📸' });
      }
    };

    // 监听页面可见性变化（移动端截屏后通常会短暂切换）
    let lastHidden = 0;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        lastHidden = Date.now();
      } else {
        // 如果隐藏时间很短（< 2秒），可能是截屏
        if (lastHidden > 0 && Date.now() - lastHidden < 2000) {
          // 移动端截屏检测（启发式）
          // 注意：真实场景需要原生 API 支持，这里做前端最大努力检测
        }
      }
    };

    // 监听 visibilitychange（模拟截屏检测）
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [chatId, insertScreenshotNotice]);

  // 添加加密日志
  const addLog = useCallback((msg: string) => {
    setEncryptionLog(prev => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 40), 120);
    textarea.style.height = `${nextHeight}px`;
  }, [inputText]);

  // 监听 AstrBot 回复事件，关闭打字指示器
  useEffect(() => {
    const handleBotMsg = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.chatId === chatId) {
        setTypingIndicator(false);
      }
    };
    window.addEventListener('bot_message_received', handleBotMsg);
    return () => window.removeEventListener('bot_message_received', handleBotMsg);
  }, [chatId]);

  // ===== 已读回执：进入私聊时自动发送 read_receipt =====
  useEffect(() => {
    if (!chatId || !otherMember || chat?.type !== 'private') return;
    const ws = signalWs?.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // 找到对方发的未读消息
    const unreadMsgIds = messages
      .filter(m => m.senderId !== currentUserId && m.senderId !== 'me' && m.status !== 'read')
      .map(m => m.id);
    if (unreadMsgIds.length === 0) return;
    ws.send(JSON.stringify({
      type: 'read_receipt',
      to: otherMember,
      payload: { chatId, messageIds: unreadMsgIds },
    }));
  // 每次消息列表变化时重新发送已读回执
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, messages.length]);

  // ===== 群聊：加载群成员列表（用于 @ 提及）=====
  useEffect(() => {
    if (!chat?.groupId) return;
    fetch(`/api/group/members?groupId=${chat.groupId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.members) {
          setGroupMembers(data.members.map((m: any) => ({
            id: m.userId,
            name: m.name || m.nickname || m.user?.nickname || m.user?.username || m.userId,
            avatar: m.avatar || m.user?.avatar || '',
          })));
        }
      })
      .catch(() => {});
  }, [chat?.groupId]);

  // ===== 阅后即焚回调 =====
  const handleMarkRead = useCallback((messageId: string) => {
    if (chatId) {
      markMessageRead(chatId, messageId);
      // 通过 WebSocket 通知服务器消息已读（启动服务端倒计时）
      const ws = signalWs?.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'burn_read',
          payload: { chatId, messageId },
        }));
      }
    }
  }, [chatId, markMessageRead, signalWs]);

  const handleBurn = useCallback((messageId: string) => {
    if (chatId) {
      burnMessage(chatId, messageId);
      // 通过 WebSocket 通知服务器删除消息
      const ws = signalWs?.current;
      const otherUserId = chat?.members?.find(m => m !== currentUserId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'burn_delete',
          to: otherUserId,
          payload: { chatId, messageId },
        }));
      }
    }
  }, [chatId, burnMessage, signalWs, chat, currentUserId]);

  // ===== 消息防篡改：接收方验证 HMAC 完整性 =====
  const handleVerifyIntegrity = useCallback(async (messageId: string) => {
    if (!chatId || !integrityKey) return;
    const msgs = state.messages[chatId] || [];
    const msg = msgs.find(m => m.id === messageId);
    if (!msg || !msg.hmac || msg.integrityStatus !== 'unverified') return;

    try {
      const status = await verifyMessage({
        content: msg.content,
        senderId: msg.senderId,
        chatId,
        msgType: msg.type,
        timestamp: msg.timestamp,
        hmac: msg.hmac,
        integrityKey,
      });
      dispatch({ type: 'UPDATE_MESSAGE_INTEGRITY', chatId, messageId, integrityStatus: status });
      if (status === 'tampered') {
        console.warn(`[Integrity] 消息 ${messageId} 完整性验证失败！可能已被篡改`);
      }
    } catch (err) {
      console.error('[Integrity] 验证异常:', err);
    }
  }, [chatId, integrityKey, state.messages, dispatch]);

  // ===== 消失消息模式设置 =====
  const handleSetEphemeralTimer = useCallback((timer: BurnAfterReadTimer | undefined) => {
    if (!chatId) return;
    setEphemeralTimer(chatId, timer);
    if (timer) {
      toast(`消失消息模式已开启：${formatBurnTimer(timer)}后自动销毁`, { icon: '⏱' });
      // 插入系统提示
      sendMessage(chatId, {
        id: `sys-ephemeral-${Date.now()}`,
        chatId,
        senderId: 'system',
        content: `消失消息模式已开启，新消息将在 ${formatBurnTimer(timer)} 后自动销毁`,
        type: 'system',
        timestamp: Date.now(),
        isEncrypted: false,
        reactions: {},
        status: 'read',
      });
    } else {
      toast('消失消息模式已关闭', { icon: '🔓' });
      sendMessage(chatId, {
        id: `sys-ephemeral-off-${Date.now()}`,
        chatId,
        senderId: 'system',
        content: '消失消息模式已关闭',
        type: 'system',
        timestamp: Date.now(),
        isEncrypted: false,
        reactions: {},
        status: 'read',
      });
    }
  }, [chatId, setEphemeralTimer, sendMessage]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !chatId) return;
    const text = inputText.trim();
    const currentMentions = [...pendingMentions];
    const activeReply = replyingTo;
    setInputText('');
    setPendingMentions([]);
    setMentionQuery(null);
    setReplyingTo(null);
    setShowExtra(false);
    setShowEmoji(false);

    // ===== 群聊消息发送：通过 useGroupSync =====
    if (isGroupChat && chat?.groupId) {
      const currentMentionsCopy = [...pendingMentions];
      groupSync.sendMessage(
        text,
        'text',
        {
          ...(currentMentionsCopy.length > 0 ? { mentions: currentMentionsCopy } : {}),
          ...(activeReply ? { replyToId: activeReply.id } : {}),
        }
      );
      return;
    }

    // ===== BOT 聊天：调用 AI 接口 =====
    if (chat?.members?.includes('BOT')) {
      // 先发送用户消息
      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        chatId,
        senderId: currentUserId,
        senderProfile: { name: currentUser.name, avatar: currentUser.avatar }, // 强制注入当前用户 Profile
        content: text,
        type: 'text',
        timestamp: Date.now(),
        isEncrypted: false,
        reactions: {},
        status: 'sent',
        replyTo: activeReply?.id,
      };
      sendMessage(chatId, userMsg);

      // 显示打字指示器
      setTypingIndicator(true);

      try {
        // 通过 push-to-onebot 将消息上报给 AstrBot 处理
        // AstrBot 处理后会通过 send_private_msg 回调，后端再通过 WebSocket 推送 bot_message
        const resp = await fetch('/api/push-to-onebot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId,
            senderId: CURRENT_USER.id,
            content: text,
            nickname: CURRENT_USER.name,
            isGroup: false,
          }),
        });

        if (!resp.ok) {
          // push-to-onebot 失败（AstrBot 未连接），显示错误提示
          setTypingIndicator(false);
          const errReply: Message = {
            id: `bot-err-${Date.now()}`,
            chatId,
            senderId: 'BOT',
            content: '抱歉，AI 服务暂时不可用，请稍后再试。',
            type: 'text',
            timestamp: Date.now() + 100,
            isEncrypted: false,
            reactions: {},
            status: 'delivered',
          };
          sendMessage(chatId, errReply);
        }
        // 成功时不做任何事，等待后端通过 WebSocket 推送 bot_message
        // AppContext 会自动接收并展示 AstrBot 的回复，同时关闭打字指示器
      } catch {
        setTypingIndicator(false);
        const errReply: Message = {
          id: `bot-err-${Date.now()}`,
          chatId,
          senderId: 'BOT',
          content: '网络连接失败，请检查网络后重试。',
          type: 'text',
          timestamp: Date.now() + 100,
          isEncrypted: false,
          reactions: {},
          status: 'delivered',
        };
        sendMessage(chatId, errReply);
      }
      return;
    }

    // 确定消息的阅后即焚定时器（优先使用会话级消失模式）
    const effectiveBurnTimer = chat?.ephemeralTimer ?? burnTimer;

    // P0 安全铁律：私聊强制 E2EE
    if (chat?.type === 'private' && otherMember && chatId !== 'c0' && chatId !== 'cBOT') {
      try {
        addLog(`[E2EE] 正在加密消息...`);
        
        // 1. 建立会话（如果不存在）
        const sessionInfo = await e2ee.getSessionInfo(otherMember);
        if (!sessionInfo?.established) {
          const bundle = await e2ee.fetchRemoteBundle(otherMember);
          await e2ee.establishSession(otherMember, bundle);
          setSessionEstablished(true);
        }

        // 2. 准备加密载荷（包含真实消息类型和内容）
        const payload = JSON.stringify({
          content: text,
          msgType: 'text',
          extra: {
            mentions: currentMentions.length > 0 ? currentMentions : undefined,
          }
        });

        // 3. 执行加密得到信封
        const envelope = await e2ee.encrypt(otherMember, payload);
        const envelopeStr = JSON.stringify(envelope);

        const encTempId = `enc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const msgTimestamp = Date.now();

        // 4. 消息防篡改：对密文计算 HMAC
        let msgHmac: string | undefined;
        if (integrityKey) {
          try {
            msgHmac = await signMessage({ content: envelopeStr, senderId: currentUserId, chatId, msgType: 'encrypted', timestamp: msgTimestamp, integrityKey });
          } catch (e) { console.warn('[Integrity] HMAC 签名失败:', e); }
        }

        const msg: Message = {
          id: encTempId,
          chatId,
          senderId: currentUserId,
          senderProfile: { name: currentUser.name, avatar: currentUser.avatar },
          content: text, // UI 本地显示明文
          type: 'text',
          timestamp: msgTimestamp,
          isEncrypted: true,
          status: 'sending',
          burnAfterRead: effectiveBurnTimer,
          forwardRestricted: forwardRestricted,
          hmac: msgHmac,
          integrityStatus: msgHmac ? 'verified' : 'unverified',
          replyTo: activeReply?.id,
        };
        sendMessage(chatId, msg);

        // 5. 发送加密信封给服务器
        const ws = signalWs?.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'private_send',
            payload: { 
              chatId, 
              content: envelopeStr, 
              msgType: 'encrypted', 
              tempId: encTempId, 
              ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}), 
              ...(msgHmac ? { hmac: msgHmac } : {}), 
              ...(activeReply ? { replyToId: activeReply.id } : {}) 
            },
          }));
        } else {
          const token = localStorage.getItem('user_token');
          if (token) {
            fetch(`/api/chat/${chatId}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ content: envelopeStr, msgType: 'encrypted', ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}), ...(msgHmac ? { hmac: msgHmac } : {}), ...(activeReply ? { replyToId: activeReply.id } : {}) }),
            })
              .then(r => r.ok ? r.json() : null)
              .then(data => { if (data?.message) dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId: encTempId, realId: data.message.id }); });
          }
        }
        return;
      } catch (err: any) {
        console.error('[E2EE] 发送失败:', err);
        toast.error(`无法建立加密连接: ${err.message}`);
        addLog(`❌ E2EE 错误: ${err.message}`);
        return;
      }
    }

    // 非私聊保留原有逻辑（降级/Mock）
    const detectedUrlFallback = extractUrl(text);
  }, [inputText, chatId, sendMessage, chat, e2ee, otherMember, sessionEstablished, addLog, burnTimer, forwardRestricted, signalWs, currentUserId, dispatch, integrityKey, pendingMentions, replyingTo, isGroupChat, groupSync]);

  const handleSendEmoji = useCallback(async (emoji: string) => {
    if (!chatId) return;
    // 群聊表情发送
    if (isGroupChat && chat?.groupId) {
      groupSync.sendMessage(emoji, 'text');
      return;
    }

    // P0: 私聊强制 E2EE
    if (chat?.type === 'private' && otherMember && chatId !== 'c0' && chatId !== 'cBOT') {
      try {
        const payload = JSON.stringify({ content: emoji, msgType: 'text' });
        const envelope = await e2ee.encrypt(otherMember, payload);
        const envelopeStr = JSON.stringify(envelope);
        const tempId = `enc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        const msg: Message = {
          id: tempId,
          chatId,
          senderId: currentUserId,
          content: emoji,
          type: 'text',
          timestamp: Date.now(),
          isEncrypted: true,
          status: 'sending',
          burnAfterRead: chat?.ephemeralTimer ?? burnTimer,
        };
        sendMessage(chatId, msg);

        const ws = signalWs?.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'private_send',
            payload: { chatId, content: envelopeStr, msgType: 'encrypted', tempId, burnAfterRead: msg.burnAfterRead },
          }));
        }
        return;
      } catch (err) {
        toast.error('发送失败，安全连接异常');
        return;
      }
    }

    // 兜底逻辑（非私聊）
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const msg: Message = {
      id: tempId,
      chatId,
      senderId: currentUserId,
      content: emoji,
      type: 'text',
      timestamp: Date.now(),
      isEncrypted: false,
      status: 'sending',
    };
    sendMessage(chatId, msg);
  }, [chatId, sendMessage, burnTimer, chat, currentUserId, signalWs, otherMember, e2ee, isGroupChat, groupSync]);

  // ===== 贴纸消息发送 =====
  const handleSendSticker = useCallback(async (sticker: StickerItem) => {
    if (!chatId) return;
    setShowStickerPanel(false);

    try {
      if (!sticker || (!sticker.url && sticker.mediaType !== 'emoji' && sticker.format !== 'emoji')) {
        toast.error('素材加载未完成，请稍后再试');
        return;
      }

      if (sticker.mediaType === 'emoji' || sticker.format === 'emoji' || !sticker.url) {
        await handleSendEmoji(sticker.emoji || sticker.name || '🙂');
        return;
      }

      if (sticker.mediaType === 'gif' || sticker.format === 'gif') {
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const gifTimestamp = Date.now();
        const effectiveBurnTimer = chat?.ephemeralTimer ?? burnTimer;
        let gifHmac: string | undefined;
        if (integrityKey) {
          try { gifHmac = await signMessage({ content: '[GIF]', senderId: currentUserId, chatId, msgType: 'image', timestamp: gifTimestamp, integrityKey }); } catch {}
        }
        if (isGroupChat && chat?.groupId) {
          groupSync.sendMessage('[GIF]', 'image', { imageUrl: sticker.url });
          return;
        }
        const msg: Message = {
          id: tempId,
          chatId,
          senderId: currentUserId,
          content: '[GIF]',
          type: 'image',
          timestamp: gifTimestamp,
          isEncrypted: true,
          reactions: {},
          status: 'sending',
          imageUrl: sticker.url,
          burnAfterRead: effectiveBurnTimer,
          forwardRestricted,
          hmac: gifHmac,
          integrityStatus: gifHmac ? 'verified' : 'unverified',
        };
        sendMessage(chatId, msg);
        const ws = signalWs?.current;
        if (ws && ws.readyState === WebSocket.OPEN && chatId !== 'c0' && chatId !== 'cBOT') {
          ws.send(JSON.stringify({
            type: 'private_send',
            payload: { chatId, content: '[GIF]', msgType: 'image', tempId, extra: { imageUrl: sticker.url }, ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}), ...(gifHmac ? { hmac: gifHmac } : {}) },
          }));
        } else if (chatId !== 'c0' && chatId !== 'cBOT') {
          const token = localStorage.getItem('user_token');
          if (token) {
            fetch(`/api/chat/${chatId}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ content: '[GIF]', msgType: 'image', extra: { imageUrl: sticker.url }, ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}), ...(gifHmac ? { hmac: gifHmac } : {}) }),
            })
              .then(r => r.ok ? r.json() : null)
              .then(data => { if (data?.message) dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId, realId: data.message.id }); })
              .catch(() => {});
          }
        }
        return;
      }

      if (isGroupChat && chat?.groupId) {
        const label = sticker.mediaType === 'meme' ? '[表情包]' : `[贴纸] ${sticker.emoji}`;
        groupSync.sendMessage(label, 'sticker', {
          stickerUrl: sticker.url,
          stickerEmoji: sticker.emoji,
          stickerSetName: sticker.packName || sticker.name,
          ...(sticker.mediaType === 'meme' ? { imageUrl: sticker.thumbUrl || sticker.url } : {}),
        });
        return;
      }

      const stickerLabel = sticker.mediaType === 'meme' ? '[表情包]' : `[贴纸] ${sticker.emoji}`;
      const stickerExtra = {
        stickerUrl: sticker.url,
        stickerEmoji: sticker.emoji || '',
        stickerSetName: sticker.packName || sticker.name || '贴纸',
        ...(sticker.mediaType === 'meme' ? { imageUrl: sticker.thumbUrl || sticker.url } : {}),
      };

      // P0: 私聊强制 E2EE
      if (chat?.type === 'private' && otherMember && chatId !== 'c0' && chatId !== 'cBOT') {
        try {
          const payload = JSON.stringify({
            content: stickerLabel,
            msgType: 'sticker',
            extra: stickerExtra
          });
          const envelope = await e2ee.encrypt(otherMember, payload);
          const envelopeStr = JSON.stringify(envelope);
          const tempId = `enc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const msg: Message = {
            id: tempId,
            chatId,
            senderId: currentUserId,
            content: stickerLabel,
            type: 'sticker',
            timestamp: Date.now(),
            isEncrypted: true,
            status: 'sending',
            stickerUrl: sticker.url,
            stickerEmoji: sticker.emoji,
            stickerSetName: stickerExtra.stickerSetName,
            burnAfterRead: chat?.ephemeralTimer ?? burnTimer,
          };
          sendMessage(chatId, msg);

          const ws = signalWs?.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'private_send',
              payload: { chatId, content: envelopeStr, msgType: 'encrypted', tempId, burnAfterRead: msg.burnAfterRead },
            }));
          }
          return;
        } catch (err) {
          toast.error('贴纸发送失败，安全会话异常');
          return;
        }
      }

      // 非私聊兜底
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const msg: Message = {
        id: tempId,
        chatId,
        senderId: currentUserId,
        content: stickerLabel,
        type: 'sticker',
        timestamp: Date.now(),
        isEncrypted: false,
        status: 'sending',
        stickerUrl: sticker.url,
      };
      sendMessage(chatId, msg);
    } catch (error) {
      console.error('[pages/ChatDetailPage] 发送贴纸失败:', error, sticker);
      toast.error('发送失败，请重新选择一个贴纸');
    }
  }, [chatId, sendMessage, currentUserId, signalWs, dispatch, chat, burnTimer, integrityKey, forwardRestricted, isGroupChat, groupSync, signMessage, handleSendEmoji]);

  // ===== 图片/视频上传发送 =====
  const handleMediaUpload = useCallback(async (file: File, mediaType: 'image' | 'video') => {
    if (!chatId || mediaUploading) return;
    setMediaUploading(true);
    setShowExtra(false);

    try {
      let dataBase64 = '';
      let fileKey: string | undefined;
      let iv: string | undefined;

      const isPrivate = chat?.type === 'private' && otherMember && chatId !== 'c0' && chatId !== 'cBOT';
      const { bufferToBase64 } = await import('../lib/e2ee/CryptoUtils');

      if (isPrivate) {
        addLog('[E2EE] 正在加密媒体文件...');
        const buffer = await file.arrayBuffer();
        const encrypted = await e2ee.encryptFile(buffer);
        dataBase64 = bufferToBase64(encrypted.ciphertext);
        fileKey = encrypted.fileKey;
        iv = encrypted.iv;
      } else {
        const buffer = await file.arrayBuffer();
        dataBase64 = bufferToBase64(buffer);
      }

      // 上传到服务器
      const resp = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataBase64,
          mimeType: file.type,
          mediaType,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        toast.error(err.error || '上传失败');
        return;
      }

      const data = await resp.json();

      // 群聊图片/视频发送
      if (isGroupChat && chat?.groupId) {
        if (mediaType === 'image') {
          groupSync.sendMessage('[图片]', 'image', { imageUrl: data.url });
          toast.success('图片发送成功');
        } else {
          groupSync.sendMessage('[视频]', 'video', { videoUrl: data.url });
          toast.success('视频发送成功');
        }
        return;
      }

      const effectiveBurnTimer = chat?.ephemeralTimer ?? burnTimer;

      // 私聊 E2EE 发送
      if (isPrivate) {
        const label = mediaType === 'image' ? '[图片]' : '[视频]';
        const payload = JSON.stringify({
          content: label,
          msgType: mediaType,
          extra: {
            [mediaType === 'image' ? 'imageUrl' : 'videoUrl']: data.url,
            fileKey,
            iv,
            isEncryptedMedia: true,
          }
        });

        const envelope = await e2ee.encrypt(otherMember, payload);
        const envelopeStr = JSON.stringify(envelope);
        const encTempId = `enc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const msgTimestamp = Date.now();

        const msg: Message = {
          id: encTempId,
          chatId,
          senderId: currentUserId,
          content: label,
          type: mediaType,
          timestamp: msgTimestamp,
          isEncrypted: true,
          status: 'sending',
          imageUrl: mediaType === 'image' ? data.url : undefined,
          videoUrl: mediaType === 'video' ? data.url : undefined,
          burnAfterRead: effectiveBurnTimer,
          forwardRestricted,
        };
        sendMessage(chatId, msg);

        const ws = signalWs?.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'private_send',
            payload: { 
              chatId, 
              content: envelopeStr, 
              msgType: 'encrypted', 
              tempId: encTempId, 
              burnAfterRead: effectiveBurnTimer 
            },
          }));
        }
        toast.success(`${mediaType === 'image' ? '图片' : '视频'}已加密发送`);
        return;
      }

      // 非私聊兜底逻辑
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const mediaTimestamp = Date.now();
      const msg: Message = {
        id: tempId,
        chatId,
        senderId: currentUserId,
        content: mediaType === 'image' ? '[图片]' : '[视频]',
        type: mediaType,
        timestamp: mediaTimestamp,
        isEncrypted: false,
        status: 'sending',
        imageUrl: mediaType === 'image' ? data.url : undefined,
        videoUrl: mediaType === 'video' ? data.url : undefined,
      };
      sendMessage(chatId, msg);
    } catch (err) {
      console.error('[Media] 上传失败:', err);
      toast.error('文件上传失败，请重试');
    } finally {
      setMediaUploading(false);
    }
  }, [chatId, mediaUploading, chat, burnTimer, forwardRestricted, sendMessage, currentUserId, signalWs, integrityKey, dispatch]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleMediaUpload(file, 'image');
    e.target.value = ''; // 重置以允许重复选择同一文件
  }, [handleMediaUpload]);

  const handleVideoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleMediaUpload(file, 'video');
    e.target.value = '';
  }, [handleMediaUpload]);

  // ===== 加密语音消息：开始录音 =====
  const handleVoicePressStart = useCallback(async () => {
    if (voice.isRecording || voice.isProcessing) return;
    const ok = await voice.startRecording();
    if (ok) setVoicePressActive(true);
  }, [voice]);

  // ===== 加密语音消息：停止录音并加密发送 =====
  const handleVoicePressEnd = useCallback(async () => {
    if (!voice.isRecording || !chatId) return;
    setVoicePressActive(false);
    const payload = await voice.stopRecording();
    if (!payload) return;

    // ===== BOT 聊天：上传语音并推送给 AstrBot 进行 STT 识别 =====
    if (chat?.members?.includes('BOT')) {
      // 1. 先在前端显示用户发送的语音消息（加密形式）
      const userVoiceMsg: Message = {
        id: `msg-${Date.now()}`,
        chatId,
        senderId: currentUserId,
        content: `[语音 ${payload.duration}秒]`,
        type: 'voice',
        timestamp: Date.now(),
        isEncrypted: true,
        reactions: {},
        status: 'sending',
        duration: payload.duration,
        voiceCiphertext: payload.ciphertext,
        voiceIv: payload.iv,
        voiceKeyBase64: payload.keyBase64,
        voiceMimeType: payload.mimeType,
        voiceWaveform: payload.waveform,
      };
      sendMessage(chatId, userVoiceMsg);

      try {
        // 2. 解密音频数据并转为 base64 上传到服务器
        const { base64ToBuffer } = await import('@/lib/e2ee/CryptoUtils');
        const { aesDecrypt } = await import('@/lib/e2ee/CryptoUtils');
        const keyMaterial = base64ToBuffer(payload.keyBase64);
        const decryptedBuffer = await aesDecrypt(
          { ciphertext: payload.ciphertext, iv: payload.iv, tag: '' },
          keyMaterial
        );
        // 转为 base64
        const uint8 = new Uint8Array(decryptedBuffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const audioBase64 = btoa(binary);

        // 3. 上传到服务器
        const uploadResp = await fetch('/api/voice/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType: payload.mimeType || 'audio/webm',
          }),
        });

        if (uploadResp.ok) {
          const uploadData = await uploadResp.json();
          // 4. 推送给 AstrBot
          await fetch('/api/push-to-onebot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId,
              senderId: 'me',
              content: `[语音 ${payload.duration}秒]`,
              nickname: '清风',
              isGroup: false,
              isVoice: true,
              voiceUrl: uploadData.voiceUrl,
            }),
          });
          console.log('[ChatDetail] 语音已推送给 AstrBot:', uploadData.voiceUrl);
        } else {
          console.error('[ChatDetail] 语音上传失败');
        }
      } catch (err) {
        console.error('[ChatDetail] 语音推送失败:', err);
      }
      return;
    }

    // 群聊语音消息发送
    if (isGroupChat && chat?.groupId) {
      // 群聊不支持加密语音，解密后上传
      try {
        const { base64ToBuffer, aesDecrypt } = await import('@/lib/e2ee/CryptoUtils');
        const keyMaterial = base64ToBuffer(payload.keyBase64);
        const decryptedBuffer = await aesDecrypt(
          { ciphertext: payload.ciphertext, iv: payload.iv, tag: '' },
          keyMaterial
        );
        const uint8 = new Uint8Array(decryptedBuffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
        const audioBase64 = btoa(binary);
        const uploadResp = await fetch('/api/voice/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64, mimeType: payload.mimeType || 'audio/webm' }),
        });
        if (uploadResp.ok) {
          const uploadData = await uploadResp.json();
          groupSync.sendMessage(`[语音 ${payload.duration}秒]`, 'voice', {
            voiceUrl: uploadData.voiceUrl,
            duration: payload.duration,
          });
          toast.success('语音发送成功');
        } else {
          toast.error('语音上传失败');
        }
      } catch (err) {
        console.error('[ChatDetail] 群聊语音发送失败:', err);
        toast.error('语音发送失败');
      }
      return;
    }

    const effectiveBurnTimer = chat?.ephemeralTimer ?? burnTimer;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const extra = {
      duration: payload.duration,
      burnAfterRead: effectiveBurnTimer,
      forwardRestricted,
      voiceCiphertext: payload.ciphertext,
      voiceIv: payload.iv,
      voiceKeyBase64: payload.keyBase64,
      voiceMimeType: payload.mimeType,
      voiceWaveform: payload.waveform,
    };
    const msg: Message = {
      id: tempId,
      chatId,
      senderId: currentUserId,
      content: `[加密语音 ${payload.duration}秒]`,
      type: 'voice',
      timestamp: Date.now(),
      isEncrypted: true,
      reactions: {},
      status: 'sending',
      duration: payload.duration,
      burnAfterRead: effectiveBurnTimer,
      forwardRestricted: forwardRestricted,
      // 加密语音字段
      voiceCiphertext: payload.ciphertext,
      voiceIv: payload.iv,
      voiceKeyBase64: payload.keyBase64,
      voiceMimeType: payload.mimeType,
      voiceWaveform: payload.waveform,
    };
    sendMessage(chatId, msg);

    try {
      const token = localStorage.getItem('user_token');
      if (!token) {
        toast.error('登录状态已失效，请重新登录后再发送语音');
        return;
      }
      if (chatId === 'c0' || chatId === 'cBOT') {
        toast.error('当前会话暂不支持加密语音消息');
        return;
      }

      const response = await fetch(`/api/chat/${chatId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: `[加密语音 ${payload.duration}秒]`,
          msgType: 'voice',
          extra,
          ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}),
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.message?.id) {
        toast.error(data?.error || '语音消息发送失败，请重试');
        return;
      }

      dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId, realId: data.message.id });
      addLog(`✓ 语音消息加密完成 | 时长: ${payload.duration}s | 密文长度: ${payload.ciphertext.length}`);
    } catch (error) {
      console.error('[ChatDetail] 私聊语音发送失败:', error);
      toast.error('语音消息发送失败，请检查网络后重试');
    }
  }, [voice, chatId, chat, burnTimer, forwardRestricted, sendMessage, addLog, currentUserId, dispatch]);

  // 展示语音消息播放状态
  const handlePlayVoice = useCallback((messageId: string, payload: any) => {
    voice.playVoice(messageId, payload);
  }, [voice]);

  const handleStopVoice = useCallback((messageId: string) => {
    voice.stopVoice(messageId);
  }, [voice]);

  // 兼容旧接口（保留空实现）
  const handleSendVoice = useCallback(() => {}, []);

  // ===== 群聊 @ 提及：监听输入变化 =====
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    if (!chat?.groupId) return;
    // 检测最后一个 @ 符号的位置
    const cursor = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursor);
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx !== -1) {
      const query = textBeforeCursor.slice(atIdx + 1);
      // @ 后面不包含空格，才显示选择器
      if (!query.includes(' ')) {
        setMentionQuery(query);
        setMentionAnchor(atIdx);
        return;
      }
    }
    setMentionQuery(null);
  }, [chat?.groupId]);

  // 选择被 @ 的成员
  const handleMentionSelect = useCallback((member: { id: string; name: string }) => {
    const before = inputText.slice(0, mentionAnchor);
    const after = inputText.slice(mentionAnchor + 1 + (mentionQuery?.length ?? 0));
    setInputText(`${before}@${member.name} ${after}`);
    setPendingMentions(prev => [...prev, member.id]);
    setMentionQuery(null);
    inputRef.current?.focus();
  }, [inputText, mentionAnchor, mentionQuery]);

  const handleReplyToMessage = useCallback((message: Message) => {
    setReplyingTo(message);
    setShowExtra(false);
    setShowEmoji(false);
    setShowStickerPanel(false);
    setShowBurnSelector(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!chat) return null;

  const ephemeralTimer = chat.ephemeralTimer;
  const effectiveBurnTimer = ephemeralTimer ?? burnTimer;

  return (
    <div className="tg-chat-shell flex flex-col h-full animate-slide-in">
      {/* 顶部栏 */}
      <div className="tg-chat-topbar flex items-center gap-2 px-2.5 py-3">
          <button
            onClick={closeChat}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-dove-warm-gray/60 transition-all active:scale-95"
          >
            <ArrowLeft size={18} className="text-dove-ink" />
          </button>

        <div
          className="flex-1 min-w-0 text-center cursor-pointer"
          onClick={() => {
            if (isGroupChat && chat?.groupId) {
              setShowGroupInfoSheet(true);
            } else if (otherUser) {
              showProfile(otherUser.id);
            }
          }}
        >
          <div className="flex items-center justify-center gap-1.5">
            <h2 className="text-sm font-medium text-dove-ink truncate" style={{ fontFamily: 'var(--font-wenkai)' }}>
              {chat.name}
            </h2>
            {/* 官方账号认证徽章 */}
            {chat.members?.includes('official') && (
              <GoldVerifiedBadge size={16} className="flex-shrink-0" />
            )}
            {/* AI 机器人认证徽章 */}
            {chat.members?.includes('BOT') && (
              <>
                <GoldVerifiedBadge size={16} className="flex-shrink-0" />
                <span className="text-[9px] font-semibold text-purple-600 bg-gradient-to-r from-purple-50 to-purple-100 px-1.5 py-0.5 rounded-full border border-purple-200/60 shadow-sm">🤖 AI</span>
              </>
            )}
            {/* 消失消息模式标识 */}
            {ephemeralTimer && (
              <span className="flex items-center gap-0.5 bg-dove-seal/10 text-dove-seal px-1.5 py-0.5 rounded-full text-[9px] animate-ephemeral">
                <Clock size={9} />
                {formatBurnTimer(ephemeralTimer)}
              </span>
            )}

          </div>
          {/* 官方账号显示官方标识，普通聊天显示在线状态 + E2EE 状态 */}
          {chat.members?.includes('official') ? (
            <div className="flex items-center justify-center gap-1">
              <span className="text-[9px] font-medium text-blue-500">imim 官方认证账号 · 发布系统通知</span>
            </div>
          ) : chat.members?.includes('BOT') ? (
            <div className="flex items-center justify-center gap-1">
              <span className="text-[9px] font-medium text-purple-500">imim 官方认证 · AI 智能助手 · 全天候在线</span>
            </div>
          ) : isGroupChat ? (
            <div className="flex items-center justify-between w-full px-2">
              <span className="text-[9px] font-medium text-muted-foreground">
                {groupMembers.length > 0 ? `${groupMembers.length} 位成员` : '群聊'}
              </span>
              {/* MLS 加密标识（与私聊 E2EEStatusBar 完全相同的位置） */}
              <button
                onClick={() => setShowMLSInfo(true)}
                className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full transition-all duration-200 active:scale-95 bg-dove-green/15 backdrop-blur-sm border border-dove-green/30 shadow-[0_0_8px_rgba(76,175,80,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-dove-green/25 hover:shadow-[0_0_12px_rgba(76,175,80,0.4),inset_0_1px_0_rgba(255,255,255,0.4)]"
              >
                <div className="flex flex-col items-center" style={{lineHeight:'1.1'}}>
                  <span className="text-[8px] text-dove-green font-bold tracking-wider flex items-center gap-0.5">
                    MLS <span className="text-[7px]">🔒</span>
                  </span>
                  <span className="text-[7px] text-dove-green/80 font-medium whitespace-nowrap">群组端到端加密</span>
                </div>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full px-2">
              {/* 对方在线状态小点 + 设备信息 + 最后在线时间 */}
              <span className="flex items-center gap-1">
                {otherMember && (() => {
                  const isOnline = state.onlineUsers.has(otherMember);
                  const primaryDevice = presenceDevices[0];
                  const deviceLabel = primaryDevice
                    ? `${primaryDevice.os} · ${primaryDevice.browser}`
                    : null;
                  return (
                    <span className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        isOnline
                          ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'
                          : 'bg-gray-400'
                      }`} />
                      <span className={`text-[9px] font-medium ${
                        isOnline ? 'text-green-600' : 'text-muted-foreground'
                      }`}>
                        {isOnline
                          ? (deviceLabel ? `在线 · ${deviceLabel}` : '在线')
                          : (presenceLastSeen ? `最后在线 ${formatLastSeen(presenceLastSeen)}` : '离线')
                        }
                      </span>
                    </span>
                  );
                })()}
              </span>
              {/* E2EE 加密标识靠右 */}
              <E2EEStatusBar
                isReady={e2ee.isReady}
                isInitializing={e2ee.isInitializing}
                sessionEstablished={sessionEstablished}
                onShowEncryption={() => setShowEncryption(true)}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {chat.type === 'private' && !chat.members?.includes('official') && !chat.members?.includes('BOT') && (
            <>
              <button
                onClick={() => {
                  if (otherUser) startCall(otherUser.id, otherUser.name, otherUser.avatar || '', 'audio', false);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-dove-green/8 transition-all active:scale-95"
              >
                <Phone size={17} className="text-dove-green" />
              </button>
              <button
                onClick={() => {
                  if (otherUser) {
                    // ★ iOS Safari: 在用户手势中预获取摄像头
                    preFetchVideoStream();
                    startCall(otherUser.id, otherUser.name, otherUser.avatar || '', 'video', false);
                  }
                }}
                className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-dove-green/8 transition-all active:scale-95"
              >
                <Video size={17} className="text-dove-green" />
              </button>
            </>
          )}
          <button
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-dove-warm-gray/60 transition-all active:scale-95"
            onClick={() => {
              if (isGroupChat && chat?.groupId) {
                setShowGroupInfoSheet(true);
              } else {
                setShowPrivateChatInfo(true);
              }
            }}
            title="聊天资料"
          >
            <MoreVertical size={18} className="text-dove-ink" />
          </button>
        </div>
      </div>

      {/* E2EE 状态已合并到 Header 副标题行，此处不再重复展示 */}

      {/* 官方账号认证横幅 */}
      {chat.members?.includes('official') && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="bg-blue-50 border-b border-blue-100 px-4 py-2.5 flex items-center gap-2.5"
        >
          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-blue-300 shadow-sm">
            <img src="/imim-official-avatar.jpg" alt="imim官方" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-blue-700">imim 官方认证账号</span>
              <GoldVerifiedBadge size={13} className="flex-shrink-0" />
            </div>
            <p className="text-[10px] text-blue-500/80 truncate">发布系统公告、安全提醒等重要信息</p>
          </div>
          <Shield size={16} className="text-blue-400 flex-shrink-0" />
        </motion.div>
      )}

      {/* AI 机器人认证横幅 */}
      {chat.members?.includes('BOT') && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="bg-purple-50 border-b border-purple-100 px-4 py-2.5 flex items-center gap-2.5"
        >
          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-purple-300 shadow-sm bg-white">
            <img src="/imim-ai-avatar.jpg" alt="imim AI" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-purple-700">imim 官方认证</span>
              <GoldVerifiedBadge size={13} className="flex-shrink-0" />
              <span className="text-[8px] font-semibold text-purple-500 bg-purple-100 px-1.5 py-0.5 rounded-full border border-purple-200/50">🤖 AI 助手</span>
            </div>
            <p className="text-[10px] text-purple-500/80 truncate">基于 GPT-4 构建的智能助手，支持问答、写作、翻译、代码分析</p>
          </div>
          <span className="text-[9px] font-medium text-purple-500 bg-purple-100 px-2 py-1 rounded-full border border-purple-200/50">全天候在线</span>
        </motion.div>
      )}

      {/* 消息列表 — GPU 加速滚动容器 */}
      <div className="flex-1 overflow-y-auto px-1 py-3 chat-messages-container" style={{ background: 'var(--imim-chat-bg, transparent)' }}>
        {/* 骨架屏加载占位 */}
        {loadingMessages && messages.length === 0 && <ChatSkeleton />}
        {messages.map((msg, i) => {
          const prevMsg = messages[i - 1];
          const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId ||
            (msg.timestamp - prevMsg.timestamp > 300000);
          const showTimeGroup = shouldShowTimeGroup(msg, prevMsg);
          const senderProfile = (() => {
            if (msg.senderId === currentUserId || msg.senderId === 'me') {
              return {
                name: state.currentUser?.nickname || state.currentUser?.username || CURRENT_USER.name,
                avatar: state.currentUser?.avatar || CURRENT_USER.avatar,
              };
            }
            if (msg.senderId === 'BOT') {
              return { name: 'imim AI', avatar: '/imim-ai-avatar.jpg' };
            }
            if (msg.senderId === 'official') {
              return { name: 'imim 官方', avatar: '/imim-official-avatar.jpg' };
            }
            if (chat?.type === 'group') {
              const member = groupMembers.find(m => m.id === msg.senderId);
              if (member) return member;
            }
            if (otherUser && msg.senderId === otherUser.id) {
              return { name: otherUser.name, avatar: otherUser.avatar || '' };
            }
            return undefined;
          })();
          return (
            <MemoizedChatBubble
              key={msg.id}
              message={msg}
              showAvatar={showAvatar}
              showTimeGroup={showTimeGroup}
              senderProfile={senderProfile}
              onReaction={(emoji) => chatId && addReaction(chatId, msg.id, emoji)}
              onBurn={handleBurn}
              onMarkRead={handleMarkRead}
              onPlayVoice={handlePlayVoice}
              onStopVoice={handleStopVoice}
              voicePlaybackState={voice.playbackStates[msg.id]}
              onJoinLocationShare={(shareId) => { setLocationShareId(shareId); setShowLocationShare(true); }}
              onRecall={(msgId) => {
                if (!chatId) return;
                if (isGroupChat && chat?.groupId) {
                  // 群聊撤回：通过 groupSync
                  const gm = groupSync.messages.find(m => m.id === msgId);
                  groupSync.recallMessage(msgId, gm?.seq || 0);
                  toast('消息已撤回');
                } else {
                  // 私聊撤回
                  recallMessage(chatId, msgId);
                  const ws = signalWs?.current;
                  if (ws && ws.readyState === WebSocket.OPEN && otherMember) {
                    ws.send(JSON.stringify({
                      type: 'recall',
                      payload: { toUserId: otherMember, messageId: msgId },
                    }));
                  }
                }
              }}
              onVerifyIntegrity={handleVerifyIntegrity}
              onReply={handleReplyToMessage}
              onShowProfile={showProfile}
            />
          );
        })}

        {/* 正在输入指示器 */}
        <AnimatePresence>
          {typingIndicator && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex gap-2 px-4 py-2"
            >
              <DoveAvatar
                name={otherUser?.name || '?'}
                id={otherMember || 'u1'}
                avatar={otherUser?.avatar || ''}
                size="sm"
                className="mt-1"
              />
              <div className="bubble-other px-4 py-3 flex items-center gap-1">
                <motion.div
                  className="w-2 h-2 bg-muted-foreground/40 rounded-full"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                />
                <motion.div
                  className="w-2 h-2 bg-muted-foreground/40 rounded-full"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                />
                <motion.div
                  className="w-2 h-2 bg-muted-foreground/40 rounded-full"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div
        className="px-3 pt-2"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}
      >
        {/* 加密录音预览栏 */}
        <AnimatePresence>
          {voice.isRecording && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <RecordingPreview
                duration={voice.recordDuration}
                liveWaveform={voice.liveWaveform}
                onCancel={voice.cancelRecording}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 加密处理中提示 */}
        <AnimatePresence>
          {voice.isProcessing && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex items-center justify-center gap-2 py-2 bg-dove-green/5"
            >
              <Loader2 size={14} className="text-dove-green animate-spin" />
              <span className="text-xs text-dove-green">正在加密语音...</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 隐私功能状态栏 */}
        <AnimatePresence>
          {(effectiveBurnTimer || forwardRestricted) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex items-center gap-2 px-4 py-1.5 bg-dove-seal/5 border-b border-dove-seal/10"
            >
              {effectiveBurnTimer && (
                <span className="flex items-center gap-1 text-[10px] text-dove-seal">
                  <Flame size={10} />
                  {ephemeralTimer ? '消失模式' : '阅后即焚'}：{formatBurnTimer(effectiveBurnTimer)}
                </span>
              )}
              {effectiveBurnTimer && forwardRestricted && (
                <span className="text-dove-seal/30 text-[10px]">·</span>
              )}
              {forwardRestricted && (
                <span className="flex items-center gap-1 text-[10px] text-dove-seal">
                  <Ban size={10} />
                  防转发已开启
                </span>
              )}
              {!ephemeralTimer && (
                <button
                  onClick={() => { setBurnTimer(undefined); setForwardRestricted(false); }}
                  className="ml-auto text-dove-seal/60 hover:text-dove-seal"
                >
                  <X size={12} />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 回复预览条 */}
        <AnimatePresence>
          {replyingTo && (
            <motion.div
              initial={{ height: 0, opacity: 0, y: 6 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: 6 }}
              className="mx-1 mb-2 overflow-hidden"
            >
              <div className="rounded-2xl border border-dove-green/15 bg-dove-green/5 px-4 py-2.5 flex items-start gap-3 backdrop-blur-sm dark:bg-sky-400/10 dark:border-sky-300/15">
                <div className="mt-0.5 h-9 w-1 rounded-full bg-dove-green dark:bg-sky-300" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-dove-green dark:text-sky-300">
                    回复 {replyingTo.senderId === currentUserId || replyingTo.senderId === 'me'
                      ? '自己'
                      : chat?.type === 'group'
                        ? (groupMembers.find(member => member.id === replyingTo.senderId)?.name || '群成员')
                        : (otherUser?.name || '对方')}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-dove-ink/70 dark:text-slate-200/75">
                    {getMessagePreviewText(replyingTo)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-dove-ink/45 transition-colors hover:bg-black/5 hover:text-dove-ink dark:text-slate-300/60 dark:hover:bg-white/10 dark:hover:text-slate-100"
                >
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 群聊 @ 提及成员选择器 */}
        <AnimatePresence>
          {mentionQuery !== null && groupMembers.length > 0 && (() => {
            const filtered = groupMembers.filter(m =>
              m.name.toLowerCase().includes((mentionQuery || '').toLowerCase())
            );
            if (filtered.length === 0) return null;
            return (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="mx-3 mb-1 bg-white border border-border/40 rounded-2xl shadow-lg overflow-hidden max-h-[180px] overflow-y-auto"
              >
                {filtered.map(member => (
                  <button
                    key={member.id}
                    onMouseDown={(e) => { e.preventDefault(); handleMentionSelect(member); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-dove-warm-gray/60 transition-colors text-left"
                  >
                    <DoveAvatar name={member.name} id={member.id} size="sm" />
                    <span className="text-sm text-dove-ink">{member.name}</span>
                  </button>
                ))}
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* 官方账号只读提示栏 */}
        {chat.members?.includes('official') && (
          <div className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-50 border-t border-blue-100">
            <GoldVerifiedBadge size={16} className="flex-shrink-0" />
            <span className="text-xs font-medium text-blue-600">这是官方认证账号，仅发送系统通知，无法回复</span>
          </div>
        )}

        {!chat.members?.includes('official') && (
        <>
        {/* BOT 聊天：显示 AI 输入提示 */}
        {chat.members?.includes('BOT') && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-purple-50 border-t border-purple-100">
            <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse shadow-[0_0_6px_rgba(168,85,247,0.4)]" />
            <span className="text-[10px] font-medium text-purple-500">🤖 AI 助手正在待命，随时可以提问或发送语音</span>
          </div>
        )}
        <div className="flex items-end gap-1 sm:gap-2 px-1 py-2 w-full transition-all duration-300 ease-out">
          <button
            type="button"
            onClick={() => { setShowExtra(!showExtra); setShowEmoji(false); setShowBurnSelector(false); }}
            className={`tg-chat-icon-btn flex-shrink-0 active:scale-95 ${showExtra ? 'scale-95' : ''}`}
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          >
            <Paperclip size={20} className={`transition-transform duration-200 ${showExtra ? 'rotate-12' : ''}`} />
          </button>

          <div className="tg-chat-composer flex-1">
            <textarea
              ref={inputRef}
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={e2ee.isReady ? "输入消息..." : chat?.groupId ? "输入消息，@ 提及成员..." : "输入消息..."}
              className="flex-1 min-w-0 resize-none overflow-y-auto bg-transparent py-2 text-[16px] leading-5 text-dove-ink outline-none placeholder:text-black/35 dark:text-slate-100 dark:placeholder:text-white/35"
              style={{ minHeight: 40, maxHeight: 120 }}
            />
            <button
              type="button"
              className={`flex-shrink-0 p-1.5 hover:bg-black/5 rounded-lg transition-colors ${showEmoji ? 'text-dove-green' : 'text-black/35'}`}
              onClick={() => { setShowEmoji(!showEmoji); setShowStickerPanel(false); setShowExtra(false); }}
            >
              <Smile size={20} />
            </button>
          </div>


          <button
            type="button"
            className={`tg-chat-icon-btn flex-shrink-0 active:scale-95 ${showStickerPanel ? 'scale-95 text-dove-green dark:text-sky-300' : ''}`}
            onClick={() => { setShowStickerPanel(!showStickerPanel); setShowEmoji(false); setShowExtra(false); setShowBurnSelector(false); }}
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            title="贴纸"
          >
            <Sticker size={19} />
          </button>

          {/* 阅后即焚按钮 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowBurnSelector(!showBurnSelector); setShowExtra(false); setShowEmoji(false); }}
              className={`tg-chat-icon-btn flex-shrink-0 active:scale-95 ${
                effectiveBurnTimer ? 'text-dove-seal dark:text-amber-300' : ''
              }`}
              title="阅后即焚"
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            >
              <Timer size={18} />
            </button>
            <AnimatePresence>
              {showBurnSelector && !ephemeralTimer && (
                <BurnTimerSelector
                  selected={burnTimer}
                  onSelect={(t) => setBurnTimer(t)}
                  onClose={() => setShowBurnSelector(false)}
                />
              )}
            </AnimatePresence>
          </div>

          {inputText.trim() ? (
            <motion.button
              type="button"
              onClick={handleSend}
              className="tg-chat-send-btn flex-shrink-0"
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
              initial={{ scale: 0.92, opacity: 0.85 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 24 }}
              whileTap={{ scale: 0.86 }}
            >
              <motion.span
                animate={{ y: [0, -1.2, 0] }}
                transition={{ duration: 0.28 }}
                className="inline-flex"
              >
                <Send size={17} />
              </motion.span>
            </motion.button>
          ) : (
            <button
              type="button"
              className={`tg-chat-icon-btn flex-shrink-0 transition-all ${
                voice.isRecording
                  ? 'bg-red-500 text-white scale-110 shadow-lg border-transparent'
                  : voice.isProcessing
                  ? 'bg-dove-green/20 text-dove-green border-dove-green/20'
                  : 'active:scale-95'
              }`}
              title="按住录音"
              style={{ touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                e.preventDefault();
                handleVoicePressStart();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                handleVoicePressEnd();
              }}
              onPointerCancel={(e) => {
                e.preventDefault();
                if (voice.isRecording) handleVoicePressEnd();
              }}
              onPointerLeave={() => { if (voice.isRecording) handleVoicePressEnd(); }}
            >
              {voice.isProcessing
                ? <Loader2 size={18} className="text-dove-green animate-spin" />
                : <Mic size={20} className={voice.isRecording ? 'text-white' : 'text-current'} />
              }
            </button>
          )}
        </div>

        {/* 表情面板 */}
        <AnimatePresence>
          {showEmoji && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-8 gap-1 px-4 py-3 max-h-[200px] overflow-y-auto">
                {EMOJI_LIST.map((emoji, i) => (
                  <button
                    key={i}
                    onClick={() => setInputText(prev => prev + emoji)}
                    className="w-9 h-9 flex items-center justify-center text-xl hover:bg-dove-warm-gray rounded-lg transition-colors active:scale-90"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 贴纸面板 */}
        <AnimatePresence>
          {showStickerPanel && (
            <StickerPanel
              onStickerSelect={handleSendSticker}
              onClose={() => setShowStickerPanel(false)}
            />
          )}
        </AnimatePresence>

        {/* 额外功能面板 */}
        <AnimatePresence>
          {showExtra && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-4 gap-4 px-6 py-4">
                {[
                  { icon: Image, label: '图片', color: 'bg-blue-50', iconColor: 'text-blue-500' },
                  { icon: Video, label: '视频', color: 'bg-purple-50', iconColor: 'text-purple-500' },
                  { icon: Phone, label: '语音通话', color: 'bg-green-50', iconColor: 'text-green-500' },
                  { icon: Video, label: '视频通话', color: 'bg-orange-50', iconColor: 'text-orange-500' },
                  { icon: MapPin, label: '发送位置', color: 'bg-emerald-50', iconColor: 'text-emerald-500' },
                  { icon: MapPin, label: '位置共享', color: 'bg-teal-50', iconColor: 'text-teal-500' },
                  {
                    icon: Ban,
                    label: forwardRestricted ? '取消防转发' : '防转发',
                    color: forwardRestricted ? 'bg-dove-seal/10' : 'bg-gray-50',
                    iconColor: forwardRestricted ? 'text-dove-seal' : 'text-gray-500',
                  },
                  {
                    icon: Clock,
                    label: '消失模式',
                    color: ephemeralTimer ? 'bg-dove-seal/10' : 'bg-gray-50',
                    iconColor: ephemeralTimer ? 'text-dove-seal' : 'text-gray-500',
                  },
                ].map(({ icon: Icon, label, color, iconColor }) => (
                  <button
                    key={label}
                    className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
                    onClick={() => {
                      if (label === '图片') {
                        if (mediaUploading) { toast('正在上传中，请稍候...'); return; }
                        imageInputRef.current?.click();
                      } else if (label === '视频') {
                        if (mediaUploading) { toast('正在上传中，请稍候...'); return; }
                        videoInputRef.current?.click();
                      } else if (label === '语音通话' && otherUser) {
                        startCall(otherUser.id, otherUser.name, otherUser.avatar || '', 'audio', false);
                      } else if (label === '视频通话' && otherUser) {
                        preFetchVideoStream();
                        startCall(otherUser.id, otherUser.name, otherUser.avatar || '', 'video', false);
                      } else if (label === '防转发' || label === '取消防转发') {
                        setForwardRestricted(!forwardRestricted);
                        toast(forwardRestricted ? '防转发已关闭' : '防转发已开启：下条消息将限制转发和复制', { icon: forwardRestricted ? '🔓' : '🔒' });
                        setShowExtra(false);
                      } else if (label === '消失模式') {
                        setShowEphemeralSelector(true);
                        setShowExtra(false);
                      } else if (label === '发送位置') {
                        setShowLocationPicker(true);
                        setShowExtra(false);
                      } else if (label === '位置共享') {
                        setLocationShareId(undefined);
                        setShowLocationShare(true);
                        setShowExtra(false);
                      } else {
                        toast(`${label}功能开发中`);
                      }
                    }}
                  >
                    <div className={`w-12 h-12 rounded-2xl ${color} flex items-center justify-center transition-all shadow-soft-sm`}>
                      <Icon size={22} className={iconColor} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        </>
        )}
        <div style={{ height: 'max(env(safe-area-inset-bottom, 0px), 4px)' }} />
      </div>

      {/* E2EE 加密信息弹窗 */}
      {otherUser && (
        <EncryptionInfo
          isOpen={showEncryption}
          onClose={() => setShowEncryption(false)}
          peerId={otherUser.id}
          peerName={otherUser.name}
          e2eeHook={e2ee}
          encryptionLog={encryptionLog}
          sessionEstablished={sessionEstablished}
        />
      )}
      {/* MLS 群组加密信息弹窗 */}
      {isGroupChat && chatId && (
        <MLSEncryptionInfo
          isOpen={showMLSInfo}
          onClose={() => setShowMLSInfo(false)}
          groupId={chatId}
          groupName={chat?.name || '群聊'}
          memberCount={groupMembers.length}
        />
      )}
      {/* 消失消息模式选择器 */}
      <AnimatePresence>
        {showEphemeralSelector && (
          <EphemeralTimerSelector
            currentTimer={ephemeralTimer}
            onSelect={handleSetEphemeralTimer}
            onClose={() => setShowEphemeralSelector(false)}
          />
        )}
      </AnimatePresence>

      {/* 位置共享页面（全屏覆盖） */}
      {showLocationShare && chatId && (
        <LocationSharePage
          chatId={chatId}
          chatName={chat?.name || '聊天'}
          shareId={locationShareId}
          onBack={() => { setShowLocationShare(false); setLocationShareId(undefined); }}
        />
      )}

      {/* 发送位置选择器（全屏覆盖） */}
      {showLocationPicker && chatId && (
        <LocationPicker
          onClose={() => setShowLocationPicker(false)}
          onConfirm={async (locResult: LocationPickerResult) => {
            if (!chatId) return;
            const effectiveBurnTimer = chat?.ephemeralTimer ?? burnTimer;
            const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const locTimestamp = Date.now();
            let locHmac: string | undefined;
            if (integrityKey) {
              try { locHmac = await signMessage({ content: '[位置]', senderId: currentUserId, chatId, msgType: 'location', timestamp: locTimestamp, integrityKey }); } catch {}
            }
            const locationData = {
              lat: locResult.lat,
              lng: locResult.lng,
              locationType: 'location' as const,
              address: locResult.address,
            };
            const msg: Message = {
              id: tempId,
              chatId,
              senderId: currentUserId,
              content: '[位置]',
              type: 'location',
              timestamp: locTimestamp,
              isEncrypted: false,
              reactions: {},
              status: 'sending',
              locationData,
              burnAfterRead: effectiveBurnTimer,
              forwardRestricted,
              hmac: locHmac,
              integrityStatus: locHmac ? 'verified' : 'unverified',
            };
            sendMessage(chatId, msg);
            // WS 发送
            const ws = signalWs?.current;
            if (ws && ws.readyState === WebSocket.OPEN && chatId !== 'c0' && chatId !== 'cBOT') {
              ws.send(JSON.stringify({
                type: 'private_send',
                payload: {
                  chatId,
                  content: '[位置]',
                  msgType: 'location',
                  tempId,
                  extra: { locationData },
                  ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}),
                  ...(locHmac ? { hmac: locHmac } : {}),
                },
              }));
            } else if (chatId !== 'c0' && chatId !== 'cBOT') {
              const token = localStorage.getItem('user_token');
              if (token) {
                fetch(`/api/chat/${chatId}/messages`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({
                    content: '[位置]',
                    msgType: 'location',
                    extra: { locationData },
                    ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}),
                    ...(locHmac ? { hmac: locHmac } : {}),
                  }),
                })
                  .then(r => r.ok ? r.json() : null)
                  .then(res => {
                    if (res?.message) {
                      dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId, realId: res.message.id });
                    }
                  })
                  .catch(() => {});
              }
            }
            toast.success('位置消息已发送');
            setShowLocationPicker(false);
          }}
        />
      )}

      {/* 隐藏的文件选择器 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
        className="hidden"
        onChange={handleImageSelect}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/3gpp"
        className="hidden"
        onChange={handleVideoSelect}
      />

      {/* 上传进度遮罩 */}
      {mediaUploading && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 size={20} className="animate-spin text-dove-green" />
            <span className="text-sm text-gray-700">正在上传...</span>
          </div>
        </div>
      )}

      {/* 群设置弹窗（群主/管理员修改群名称、头像、ID） */}
      {showGroupSettings && isGroupChat && chat?.groupId && (
        <GroupSettingsModal
          groupId={chat.groupId}
          currentUserId={state.currentUser?.id || localStorage.getItem('user_id') || ''}
          currentGroupName={chat.name}
          currentGroupAvatar={chat.avatar}
          onClose={() => setShowGroupSettings(false)}
          onUpdated={(updated) => {
            if (chat) {
              upsertChat({
                ...chat,
                name: updated.name || chat.name,
                avatar: updated.avatar || chat.avatar,
              });
            }
          }}
          onLeaveGroup={() => {
            if (chatId) dispatch({ type: 'DELETE_CHAT', chatId });
            closeChat();
          }}
        />
      )}

      {/* 群聊信息 Sheet（微信风格）— 直接条件渲染，Portal在组件内部处理 */}
      {showGroupInfoSheet && isGroupChat && chat?.groupId && (
        <GroupInfoSheet
          groupId={chat.groupId}
          currentUserId={state.currentUser?.id || localStorage.getItem('user_id') || ''}
          isMuted={!!chat.isMuted}
          isPinned={!!chat.isPinned}
          onClose={() => setShowGroupInfoSheet(false)}
          onToggleMute={() => {
            if (chatId) muteChat(chatId);
          }}
          onTogglePin={() => {
            if (chatId) pinChat(chatId);
          }}
          onClearMessages={() => {
            if (chatId) {
              clearMessages(chatId);
              toast.success('聊天记录已清空');
            }
          }}
          onLeaveGroup={() => {
            setShowGroupInfoSheet(false);
            if (chatId) dispatch({ type: 'DELETE_CHAT', chatId });
            closeChat();
          }}
          onUpdated={(updated) => {
            if (chat) {
              upsertChat({
                ...chat,
                name: updated.name || chat.name,
                avatar: updated.avatar || chat.avatar,
              });
            }
          }}
          onShowProfile={(userId) => {
            setShowGroupInfoSheet(false);
            showProfile(userId);
          }}
        />
      )}

      {/* 私聊聊天详情 Sheet */}
      {showPrivateChatInfo && !isGroupChat && chatId && otherUser && (
        <PrivateChatInfoSheet
          chatId={chatId}
          chatName={otherUser.name}
          chatAvatar={otherUser.avatar}
          otherUserId={otherUser.id}
          isMuted={!!chat?.isMuted}
          isPinned={!!chat?.isPinned}
          onClose={() => setShowPrivateChatInfo(false)}
          onToggleMute={() => {
            if (chatId) muteChat(chatId);
          }}
          onTogglePin={() => {
            if (chatId) pinChat(chatId);
          }}
          onClearMessages={() => {
            if (chatId) {
              clearMessages(chatId);
            }
          }}
          onShowProfile={(userId) => {
            setShowPrivateChatInfo(false);
            showProfile(userId);
          }}
        />
      )}
    </div>
  );
}
