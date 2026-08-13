/**
 * imim 聊天详情页
 * 集成 Signal Protocol E2EE：消息加密发送、解密接收、加密状态展示
 * 隐私安全功能：阅后即焚、消失消息模式、焚毁动画、截屏检测、防转发/防复制
 */
import React, { lazy, Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp, useAppActions, useChats, useCurrentUserState, useCurrentChatId, useOnlineUsers, useChatMessages } from '@/contexts/AppContext';
import { DoveAvatar } from '@/components/DoveAvatar';
import { EncryptionInfo } from '@/components/EncryptionInfo';
import {
  formatChatTime, getUserById, CURRENT_USER, type Message,
  type BurnAfterReadTimer, BURN_TIMER_OPTIONS, formatBurnTimer,
} from '@/lib/store';
import { useE2EE } from '@/hooks/useE2EE';
import { loadPrivateMessagesFromLocalDb } from '@/lib/localdb';
import { trackE2EEFailure, trackEvent } from '@/lib/telemetry';
import { e2eeProxy } from '@/lib/e2ee/WorkerProxy';
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
import type { StickerItem } from '@/components/StickerPanel';
import VirtualMessageList, { type VirtualMessageItem } from '@/components/VirtualMessageList';
import ChatHeader from '@/components/chat/ChatHeader';
import MessageListContainer from '@/components/chat/MessageListContainer';
import Composer from '@/components/chat/Composer';
import { ChatSkeleton, MemoizedChatBubble } from '@/components/chat/ChatBubble';
import LottieSticker from '@/components/LottieSticker';
import { GroupSettingsModal } from '@/components/GroupSettingsModal';
import { GroupInfoSheet } from '@/components/GroupInfoSheet';
import { PrivateChatInfoSheet } from '@/components/PrivateChatInfoSheet';
import { MLSEncryptionInfo } from '@/components/MLSEncryptionInfo';

const StickerPanel = lazy(() => import('@/components/StickerPanel'));



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
  const { signalWs, dispatch } = useApp();
  const currentChatId = useCurrentChatId();
  const chats = useChats();
  const currentUserState = useCurrentUserState();
  const onlineUsers = useOnlineUsers();
  const currentMessages = useChatMessages(currentChatId);
  const state = React.useMemo(() => ({
    currentChatId,
    chats,
    currentUser: currentUserState,
    messages: currentChatId ? { [currentChatId]: currentMessages } : {},
    onlineUsers,
  }), [currentChatId, chats, currentUserState, currentMessages, onlineUsers]);
  const currentUser = useCurrentUser();
  const {
    closeChat, sendMessage, addReaction, startCall,
    markMessageRead, burnMessage, setEphemeralTimer, insertScreenshotNotice,
    insertCallRecord, recallMessage, setMessages, upsertChat,
    muteChat, clearMessages, pinChat, showProfile, updateMessageStatus,
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

  // ===== 本地秒开 + 后台同步私聊历史 =====
  useEffect(() => {
    if (!chatId || chatId === 'c0' || chatId === 'cBOT') return;
    const token = localStorage.getItem('user_token');
    if (!token) return;
    let cancelled = false;

    const mergeMessages = (base: Message[], incoming: Message[]) => {
      const byId = new Map<string, Message>();
      for (const message of base) byId.set(message.id, message);
      for (const message of incoming) {
        const existing = byId.get(message.id);
        // 服务端只返回密文；本地已有已解密展示稿时不能被 ciphertext 占位覆盖。
        if (existing && existing.decryptionStatus === 'decrypted' && message.decryptionStatus === 'ciphertext') continue;
        byId.set(message.id, message);
      }
      return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
    };

    (async () => {
      try {
        const localMessages = await loadPrivateMessagesFromLocalDb(chatId, currentUserId);
        if (cancelled) return;
        const current = state.messages[chatId] || [];
        const cached = localMessages.length > 0 ? mergeMessages(current, localMessages) : current;
        if (localMessages.length > 0 && current.length === 0) setMessages(chatId, cached);
        setLoadingMessages(cached.length === 0);

        const response = await fetch(`/api/chat/${chatId}/messages?limit=50`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`history_${response.status}`);
        const data = await response.json();
        if (!data?.messages || cancelled) return;

        // Double Ratchet 必须按同一对端的时间顺序串行推进，不能对整批消息 Promise.all。
        const decryptResults = new Map<string, { plaintext?: string; error?: string; success: boolean }>();
        const bySender = new Map<string, Array<{ id: string; envelope: any }>>();
        for (const m of data.messages as any[]) {
          // 自己发出的密文优先使用本地解密副本；换机后没有副本时不伪造明文。
          if (m.msgType !== 'encrypted' || !m.content || m.isRevoked || m.senderId === currentUserId) continue;
          try {
            const list = bySender.get(m.senderId) || [];
            list.push({ id: m.id, envelope: JSON.parse(m.content) });
            bySender.set(m.senderId, list);
          } catch {
            decryptResults.set(m.id, { success: false, error: 'invalid_envelope' });
          }
        }

        for (const [senderId, encryptedMessages] of bySender) {
          const results = e2eeProxy.isReady
            ? await e2eeProxy.signalBatchDecrypt(senderId, encryptedMessages)
            : await (async () => {
                const fallbackResults: Array<{ id: string; plaintext?: string; error?: string; success: boolean }> = [];
                for (const item of encryptedMessages) {
                  try {
                    fallbackResults.push({ id: item.id, plaintext: await e2ee.decrypt(senderId, item.envelope), success: true });
                  } catch (error) {
                    fallbackResults.push({ id: item.id, error: error instanceof Error ? error.message : String(error), success: false });
                  }
                }
                return fallbackResults;
              })();
          for (const result of results) decryptResults.set(result.id, result);
        }

        const msgs: Message[] = (data.messages as any[]).map((m: any) => {
          let decryptedContent = m.isRevoked ? '消息已撤回' : (m.content || '');
          let finalMsgType = m.msgType || 'text';
          let finalExtra = typeof m.extra === 'string' ? (() => { try { return JSON.parse(m.extra); } catch { return {}; } })() : (m.extra || {});
          let decryptionFailed = false;
          let decryptionStatus: Message['decryptionStatus'] = 'decrypted';

          if (m.msgType === 'encrypted' && m.content && !m.isRevoked) {
            if (m.senderId === currentUserId) {
              decryptedContent = '🔒 [本地加密消息]';
              decryptionStatus = 'ciphertext';
            } else {
              const result = decryptResults.get(m.id);
              try {
                if (!result?.success || !result.plaintext) throw new Error(result?.error || 'decrypt_failed');
                const decrypted = JSON.parse(result.plaintext);
                decryptedContent = decrypted.content;
                finalMsgType = decrypted.msgType || 'text';
                finalExtra = { ...finalExtra, ...decrypted.extra };
              } catch (err) {
                console.error('[E2EE] 历史消息解密失败:', err);
                trackE2EEFailure('decrypt', { chatId, msgType: m.msgType, error: err, direction: 'inbound' });
                decryptedContent = '🔒 无法解密历史消息，请重新验证安全会话';
                decryptionFailed = true;
                decryptionStatus = 'failed';
              }
            }
          } else if (m.msgType !== 'encrypted' && !m.isRevoked) {
            decryptedContent = '⚠️ [不支持的旧明文消息]';
            decryptionFailed = true;
            decryptionStatus = 'legacy';
          }

          return {
            id: m.id,
            chatId: m.chatId,
            cursor: m.id,
            senderId: m.senderId,
            content: decryptedContent,
            type: finalMsgType as any,
            timestamp: m.createdAt || Date.now(),
            isEncrypted: m.msgType === 'encrypted',
            decryptionFailed,
            decryptionStatus,
            direction: m.senderId === currentUserId ? 'outbound' as const : 'inbound' as const,
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
        });

        if (!cancelled) {
          setMessages(chatId, mergeMessages(cached, msgs));
          setHasMoreMessages(data.hasMore || false);
          trackEvent('private_history_sync', { chatId, count: msgs.length, direction: 'inbound' });
        }
      } catch (err) {
        if (!cancelled) console.error('[ChatDetail] 加载消息失败:', err);
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, currentUserId]);

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
              .then(async r => {
                if (!r.ok) throw new Error(`send_${r.status}`);
                return r.json();
              })
              .then(data => { if (data?.message) dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId: encTempId, realId: data.message.id }); })
              .catch(err => {
                updateMessageStatus(chatId, encTempId, 'failed');
                trackEvent('message_send_failed', { chatId, msgType: 'encrypted', error: err, direction: 'outbound' });
              });
          } else {
            updateMessageStatus(chatId, encTempId, 'failed');
          }
        }
        return;
      } catch (err: any) {
        console.error('[E2EE] 发送失败:', err);
        trackE2EEFailure(err?.message?.includes('Bundle') || err?.message?.includes('安全凭证') ? 'bundle' : 'encrypt', { chatId, msgType: 'encrypted', error: err, direction: 'outbound' });
        trackEvent('message_send_failed', { chatId, msgType: 'encrypted', error: err, direction: 'outbound' });
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
        // 私聊 GIF 仍然是业务消息，完整资源地址必须在 Signal 明文载荷内。
        if (chat?.type === 'private' && otherMember && chatId !== 'c0' && chatId !== 'cBOT') {
          try {
            const envelope = await e2ee.encrypt(otherMember, JSON.stringify({
              content: '[GIF]',
              msgType: 'image',
              extra: { imageUrl: sticker.url },
            }));
            if (!envelope) throw new Error('无法建立安全会话');
            const envelopeStr = JSON.stringify(envelope);
            const gifHmac = integrityKey
              ? await signMessage({ content: envelopeStr, senderId: currentUserId, chatId, msgType: 'encrypted', timestamp: gifTimestamp, integrityKey })
              : undefined;
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
            const payload = { chatId, content: envelopeStr, msgType: 'encrypted', tempId, ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}), ...(gifHmac ? { hmac: gifHmac } : {}) };
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'private_send', payload }));
            } else {
              const token = localStorage.getItem('user_token');
              if (!token) throw new Error('登录状态已失效');
              const response = await fetch(`/api/chat/${chatId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error(`发送失败 ${response.status}`);
              const data = await response.json();
              if (data?.message) dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId, realId: data.message.id });
            }
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'GIF 发送失败，安全会话异常');
          }
          return;
        }

        // 官方/机器人等非私聊路径保留原有媒体发送语义。
        const msg: Message = {
          id: tempId,
          chatId,
          senderId: currentUserId,
          content: '[GIF]',
          type: 'image',
          timestamp: gifTimestamp,
          isEncrypted: false,
          reactions: {},
          status: 'sending',
          imageUrl: sticker.url,
          burnAfterRead: effectiveBurnTimer,
          forwardRestricted,
        };
        sendMessage(chatId, msg);
        const ws = signalWs?.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'private_send', payload: { chatId, content: '[GIF]', msgType: 'image', tempId, extra: { imageUrl: sticker.url } } }));
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

      if (!otherMember) throw new Error('无法确认安全会话对端');
      const envelope = await e2ee.encrypt(otherMember, JSON.stringify({
        content: `[加密语音 ${payload.duration}秒]`,
        msgType: 'voice',
        extra,
      }));
      if (!envelope) throw new Error('无法建立安全会话');

      const response = await fetch(`/api/chat/${chatId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: JSON.stringify(envelope),
          msgType: 'encrypted',
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
  }, [voice, chatId, chat, burnTimer, forwardRestricted, sendMessage, addLog, currentUserId, dispatch, otherMember, e2ee]);

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

  const renderVirtualMessage = useCallback((virtualMsg: VirtualMessageItem, _isOwn: boolean, index: number, previousVirtual?: VirtualMessageItem) => {
    const msg = virtualMsg as unknown as Message;
    const previous = previousVirtual as unknown as Message | undefined;
    const showAvatar = !previous || previous.senderId !== msg.senderId || (msg.timestamp - previous.timestamp > 300000);
    const showTimeGroup = shouldShowTimeGroup(msg, previous);
    const senderProfile = (() => {
      if (msg.senderId === currentUserId || msg.senderId === 'me') {
        return {
          name: state.currentUser?.nickname || state.currentUser?.username || CURRENT_USER.name,
          avatar: state.currentUser?.avatar || CURRENT_USER.avatar,
        };
      }
      if (msg.senderId === 'BOT') return { name: 'imim AI', avatar: '/imim-ai-avatar.jpg' };
      if (msg.senderId === 'official') return { name: 'imim 官方', avatar: '/imim-official-avatar.jpg' };
      if (chat?.type === 'group') return groupMembers.find(member => member.id === msg.senderId);
      if (otherUser && msg.senderId === otherUser.id) return { name: otherUser.name, avatar: otherUser.avatar || '' };
      return undefined;
    })();

    return (
      <MemoizedChatBubble
        key={msg.id || `${msg.senderId}-${index}`}
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
            const gm = groupSync.messages.find(groupMessage => groupMessage.id === msgId);
            groupSync.recallMessage(msgId, gm?.seq || 0);
            toast('消息已撤回');
          } else {
            recallMessage(chatId, msgId);
            const ws = signalWs?.current;
            if (ws && ws.readyState === WebSocket.OPEN && otherMember) {
              ws.send(JSON.stringify({ type: 'recall', payload: { toUserId: otherMember, messageId: msgId } }));
            }
          }
        }}
        onVerifyIntegrity={handleVerifyIntegrity}
        onReply={handleReplyToMessage}
        onShowProfile={showProfile}
      />
    );
  }, [addReaction, chat, chatId, currentUserId, groupMembers, groupSync, handleBurn, handleMarkRead, handlePlayVoice, handleReplyToMessage, handleStopVoice, handleVerifyIntegrity, isGroupChat, otherMember, otherUser, recallMessage, showProfile, signalWs, state.currentUser, voice.playbackStates]);

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
      <ChatHeader
        chat={chat}
        isGroupChat={isGroupChat}
        otherUser={otherUser}
        isOtherOnline={otherMember ? state.onlineUsers.has(otherMember) : false}
        presenceLabel={presenceLastSeen ? `最后在线 ${formatLastSeen(presenceLastSeen)}` : undefined}
        groupMemberCount={groupMembers.length}
        ephemeralTimer={ephemeralTimer}
        e2ee={{ isReady: e2ee.isReady, isInitializing: e2ee.isInitializing, sessionEstablished }}
        onBack={closeChat}
        onTitleClick={() => {
          if (isGroupChat && chat.groupId) setShowGroupInfoSheet(true);
          else if (otherUser) showProfile(otherUser.id);
        }}
        onCall={(type) => {
          if (!otherUser) return;
          if (type === 'video') preFetchVideoStream();
          startCall(otherUser.id, otherUser.name, otherUser.avatar || '', type, false);
        }}
        onShowChatInfo={() => {
          if (isGroupChat && chat.groupId) setShowGroupInfoSheet(true);
          else setShowPrivateChatInfo(true);
        }}
        onShowEncryption={() => setShowEncryption(true)}
        onShowMLS={() => setShowMLSInfo(true)}
      />
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

      <MessageListContainer
        messages={messages as unknown as VirtualMessageItem[]}
        currentUserId={currentUserId}
        loading={loadingMessages}
        hasMore={hasMoreMessages}
        renderMessage={renderVirtualMessage}
        typing={typingIndicator}
        typingName={otherUser?.name}
        typingUserId={otherMember || 'typing-user'}
        typingAvatar={otherUser?.avatar}
      />

      <Composer
        inputText={inputText}
        inputRef={inputRef}
        placeholder={e2ee.isReady ? '输入消息...' : chat.groupId ? '输入消息，@ 提及成员...' : '输入消息...'}
        voice={voice}
        replyingTo={replyingTo}
        replyLabel={replyingTo ? (replyingTo.senderId === currentUserId || replyingTo.senderId === 'me' ? '自己' : chat.type === 'group' ? (groupMembers.find(member => member.id === replyingTo.senderId)?.name || '群成员') : (otherUser?.name || '对方')) : undefined}
        effectiveBurnTimer={effectiveBurnTimer}
        ephemeralTimer={ephemeralTimer}
        forwardRestricted={forwardRestricted}
        mediaUploading={mediaUploading}
        isOfficial={chat.members?.includes('official') || false}
        isBot={chat.members?.includes('BOT') || false}
        groupMembers={groupMembers}
        mentionQuery={mentionQuery}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        onSendEmoji={handleSendEmoji}
        onSendSticker={handleSendSticker}
        onVoicePressStart={handleVoicePressStart}
        onVoicePressEnd={handleVoicePressEnd}
        onCancelReply={() => setReplyingTo(null)}
        onMentionSelect={handleMentionSelect}
        onSetBurnTimer={setBurnTimer}
        onToggleForwardRestricted={() => {
          setForwardRestricted(value => !value);
          toast(forwardRestricted ? '防转发已关闭' : '防转发已开启：下条消息将限制转发和复制', { icon: forwardRestricted ? '🔓' : '🔒' });
        }}
        onOpenEphemeral={() => setShowEphemeralSelector(true)}
        onOpenLocation={() => setShowLocationPicker(true)}
        onOpenLocationShare={() => { setLocationShareId(undefined); setShowLocationShare(true); }}
        onStartCall={(type) => {
          if (!otherUser) return;
          if (type === 'video') preFetchVideoStream();
          startCall(otherUser.id, otherUser.name, otherUser.avatar || '', type, false);
        }}
        onChooseImage={() => { if (!mediaUploading) imageInputRef.current?.click(); }}
        onChooseVideo={() => { if (!mediaUploading) videoInputRef.current?.click(); }}
        onClearPrivacy={() => { setBurnTimer(undefined); setForwardRestricted(false); }}
      />

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
            const isPrivateLocation = chat?.type === 'private' && !!otherMember && chatId !== 'c0' && chatId !== 'cBOT';
            let wireContent = '[位置]';
            let wireMsgType = 'location';
            if (isPrivateLocation) {
              const envelope = await e2ee.encrypt(otherMember!, JSON.stringify({
                content: '[位置]',
                msgType: 'location',
                extra: { locationData },
              }));
              if (!envelope) throw new Error('无法建立安全会话');
              wireContent = JSON.stringify(envelope);
              wireMsgType = 'encrypted';
            }

            const msg: Message = {
              id: tempId,
              chatId,
              senderId: currentUserId,
              content: '[位置]',
              type: 'location',
              timestamp: locTimestamp,
              isEncrypted: isPrivateLocation,
              reactions: {},
              status: 'sending',
              locationData,
              burnAfterRead: effectiveBurnTimer,
              forwardRestricted,
              hmac: locHmac,
              integrityStatus: locHmac ? 'verified' : 'unverified',
            };
            sendMessage(chatId, msg);

            const ws = signalWs?.current;
            const wirePayload = {
              chatId,
              content: wireContent,
              msgType: wireMsgType,
              tempId,
              ...(isPrivateLocation ? {} : { extra: { locationData } }),
              ...(effectiveBurnTimer ? { burnAfterRead: effectiveBurnTimer } : {}),
              ...(locHmac ? { hmac: locHmac } : {}),
            };
            if (ws && ws.readyState === WebSocket.OPEN && chatId !== 'c0' && chatId !== 'cBOT') {
              ws.send(JSON.stringify({ type: 'private_send', payload: wirePayload }));
            } else if (chatId !== 'c0' && chatId !== 'cBOT') {
              const token = localStorage.getItem('user_token');
              if (token) {
                const response = await fetch(`/api/chat/${chatId}/messages`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify(wirePayload),
                });
                const res = await response.json().catch(() => null);
                if (res?.message) dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId, realId: res.message.id });
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
