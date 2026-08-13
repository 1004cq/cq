/**
 * DoveIM 应用全局状态上下文
 */
import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createStore, useStore } from 'zustand';
import {
  type Chat, type Message, type MomentPost, type CallState, type BurnAfterReadTimer,
  MOCK_CHATS, MOCK_MESSAGES, MOCK_MOMENTS, CURRENT_USER,
} from '@/lib/store';
import {
  formatMessagePreview,
  playNotificationSound,
  shouldShowBrowserNotification,
  showBrowserNotification,
  triggerNotificationVibration,
  warmupNotificationAudio,
} from '@/lib/notifications';
import { useFCM } from '@/hooks/useFCM';
import { useJPush } from '@/hooks/useJPush';
import { authApi } from '@/lib/authFetch';
import {
  loadChatsFromLocalDb,
  loadPrivateMessagesFromLocalDb,
  persistChats,
  persistPrivateMessages,
} from '@/lib/localdb';

export interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  bio?: string;
}

interface AppState {
  isLoggedIn: boolean;
  currentUser: AuthUser | null;
  currentChatId: string | null;
  chats: Chat[];
  messages: Record<string, Message[]>;
  moments: MomentPost[];
  call: CallState;
  activeTab: string;
  showChat: boolean;
  showProfile: string | null;
  /** 当前在线用户 ID 集合 */
  onlineUsers: Set<string>;
}

type Action =
  | { type: 'LOGIN'; user?: AuthUser; deviceInfo?: { ip: string; device: string; location: string; time: string } }
  | { type: 'LOGOUT' }
  | { type: 'SET_TAB'; tab: string }
  | { type: 'OPEN_CHAT'; chatId: string }
  | { type: 'CLOSE_CHAT' }
  | { type: 'SEND_MESSAGE'; chatId: string; message: Message }
  | { type: 'ADD_REACTION'; chatId: string; messageId: string; emoji: string }
  | { type: 'MARK_READ'; chatId: string }
  | { type: 'LIKE_MOMENT'; postId: string }
  | { type: 'ADD_COMMENT'; postId: string; comment: MomentPost['comments'][0] }
  | { type: 'ADD_MOMENT'; post: MomentPost }
  | { type: 'START_CALL'; peerId: string; peerName: string; peerAvatar: string; callType: 'audio' | 'video'; isIncoming: boolean; roomId?: string }
  | { type: 'ACCEPT_CALL' }
  | { type: 'END_CALL' }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_SPEAKER' }
  | { type: 'TOGGLE_VIDEO' }
  | { type: 'SHOW_PROFILE'; userId: string }
  | { type: 'HIDE_PROFILE' }
  | { type: 'DELETE_CHAT'; chatId: string }
  | { type: 'PIN_CHAT'; chatId: string }
  /** 切换会话免打扰 */
  | { type: 'MUTE_CHAT'; chatId: string }
  /** 清空会话消息记录 */
  | { type: 'CLEAR_MESSAGES'; chatId: string }
  | { type: 'RECEIVE_MESSAGE'; chatId: string; message: Message }
  // ===== 隐私安全 Actions =====
  /** 标记消息已读，触发阅后即焚倒计时 */
  | { type: 'MARK_MESSAGE_READ'; chatId: string; messageId: string }
  /** 销毁单条消息（阅后即焚到期） */
  | { type: 'BURN_MESSAGE'; chatId: string; messageId: string }
  /** 设置/取消消失消息模式 */
  | { type: 'SET_EPHEMERAL_TIMER'; chatId: string; timer: BurnAfterReadTimer | undefined }
  /** 截屏检测：插入系统提示消息 */
  | { type: 'INSERT_SCREENSHOT_NOTICE'; chatId: string; byUser: string }
  /** 插入通话记录消息 */
  | { type: 'INSERT_CALL_RECORD'; chatId: string; callType: 'audio' | 'video'; duration: number; status: 'completed' | 'missed' | 'rejected' }
  /** 更新通话状态（含 roomId） */
  | { type: 'UPDATE_CALL_STATE'; patch: Partial<import('@/lib/store').CallState> }
  // ===== 在线状态 Actions =====
  /** 标记用户上线 */
  | { type: 'SET_USER_ONLINE'; userId: string }
  /** 标记用户下线 */
  | { type: 'SET_USER_OFFLINE'; userId: string }
  // ===== 已读回执 Actions =====
  /** 将指定消息列表标记为已读（对方已读） */
  | { type: 'MARK_MESSAGES_READ_BY_PEER'; chatId: string; messageIds: string[] }
  // ===== 消息撤回 Actions =====
  /** 撤回一条消息（本地标记 isRecalled） */
  | { type: 'RECALL_MESSAGE'; chatId: string; messageId: string }
  | { type: 'RESTORE_MESSAGE'; chatId: string; messageId: string }
  // ===== 私聊持久化 Actions =====
  /** 设置会话列表（从 API 加载） */
  | { type: 'SET_CHATS'; chats: Chat[] }
  /** 设置某个会话的消息列表（从 API 加载） */
  | { type: 'SET_MESSAGES'; chatId: string; messages: Message[] }
  /** 插入或更新一个会话（创建新会话或更新现有会话） */
  | { type: 'UPSERT_CHAT'; chat: Chat }
  /** 替换临时消息ID为服务器真实ID */
  | { type: 'REPLACE_MESSAGE_ID'; chatId: string; tempId: string; realId: string }
  // ===== 消息防篡改 Actions =====
  /** 更新消息完整性验证状态 */
  | { type: 'UPDATE_MESSAGE_INTEGRITY'; chatId: string; messageId: string; integrityStatus: 'verified' | 'tampered' | 'unverified' }
  // ===== 用户资料同步 =====
  /** 更新会话列表中缓存的用户头像/昵称 */
  | { type: 'UPDATE_USER_PROFILE_IN_CHATS'; userId: string; nickname?: string; avatar?: string; updatedAt?: number };

const OFFICIAL_CHAT_ID = 'c0';
const BOT_CHAT_ID = 'cBOT';
const OFFICIAL_USER_ID = 'official';
const BOT_USER_ID = 'BOT';
const ALWAYS_ONLINE_USER_IDS = new Set<string>([OFFICIAL_USER_ID, BOT_USER_ID]);
const OFFICIAL_AVATAR = '/imim-official-avatar.jpg';
const BOT_AVATAR = '/imim-ai-avatar.jpg';

function isOfficialChatLike(chat: Partial<Chat>): boolean {
  if (chat.type === 'group') return false;
  const members = new Set(chat.members || []);
  return chat.id === OFFICIAL_CHAT_ID || chat.id === 'cOFFICIAL' || members.has(OFFICIAL_USER_ID) || chat.name === 'imim 官方';
}

function isBotChatLike(chat: Partial<Chat>): boolean {
  if (chat.type === 'group') return false;
  const members = new Set(chat.members || []);
  return chat.id === BOT_CHAT_ID || members.has(BOT_USER_ID) || chat.name === 'imim AI';
}

function mergeMembers(...memberLists: Array<string[] | undefined>): string[] {
  return Array.from(new Set(memberLists.flatMap(members => members || []).filter(Boolean)));
}

function normalizeSpecialChat(chat: Chat): Chat {
  if (chat.type === 'group') return chat;

  if (isOfficialChatLike(chat)) {
    return {
      ...chat,
      id: OFFICIAL_CHAT_ID,
      name: 'imim 官方',
      avatar: OFFICIAL_AVATAR,
      isOfficial: true,
      isPinned: true,
      members: mergeMembers(chat.members, ['me', OFFICIAL_USER_ID]),
    };
  }

  if (isBotChatLike(chat)) {
    return {
      ...chat,
      id: BOT_CHAT_ID,
      name: 'imim AI',
      avatar: BOT_AVATAR,
      isOfficial: true,
      isPinned: true,
      members: mergeMembers(chat.members, ['me', BOT_USER_ID]),
    };
  }

  return chat;
}

function dedupeChats(chats: Chat[]): Chat[] {
  const merged = new Map<string, Chat>();

  chats
    .map(normalizeSpecialChat)
    .forEach(chat => {
      const existing = merged.get(chat.id);
      if (!existing) {
        merged.set(chat.id, chat);
        return;
      }

      merged.set(chat.id, {
        ...existing,
        ...chat,
        members: mergeMembers(existing.members, chat.members),
        avatar: chat.avatar || existing.avatar,
        lastMessage: chat.lastMessage || existing.lastMessage,
        lastMessageTime: Math.max(existing.lastMessageTime || 0, chat.lastMessageTime || 0),
        unreadCount: Math.max(existing.unreadCount || 0, chat.unreadCount || 0),
      });
    });

  return Array.from(merged.values()).sort((a, b) => {
    if (a.id === OFFICIAL_CHAT_ID && b.id !== OFFICIAL_CHAT_ID) return -1;
    if (b.id === OFFICIAL_CHAT_ID && a.id !== OFFICIAL_CHAT_ID) return 1;
    if (a.id === BOT_CHAT_ID && b.id !== BOT_CHAT_ID && b.id !== OFFICIAL_CHAT_ID) return -1;
    if (b.id === BOT_CHAT_ID && a.id !== BOT_CHAT_ID && a.id !== OFFICIAL_CHAT_ID) return 1;
    return (b.lastMessageTime || 0) - (a.lastMessageTime || 0);
  });
}

const initialState: AppState = {
  isLoggedIn: false,
  currentUser: null,
  currentChatId: null,
  chats: dedupeChats(MOCK_CHATS),
  messages: MOCK_MESSAGES,
  moments: MOCK_MOMENTS,
  call: { isActive: false },
  activeTab: '/chats',
  showChat: false,
  showProfile: null,
  onlineUsers: new Set<string>(ALWAYS_ONLINE_USER_IDS),
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOGIN': {
      if (!action.deviceInfo) return { ...state, isLoggedIn: true, currentUser: action.user ?? state.currentUser };
      const { ip, device, location, time } = action.deviceInfo;
      const loginNoticeMsg: Message = {
        id: `sys-login-${Date.now()}`,
        chatId: 'c0',
        senderId: 'official',
        content: `🔐 登录安全提醒\n\n你的账号刚刚登录成功，如非本人操作，请立即修改密码并登出其他设备。\n\n📍 登录地点：${location}\n🌐 IP 地址：${ip}\n📱 设备信息：${device}\n🕐 登录时间：${time}`,
        type: 'text',
        timestamp: Date.now(),
        isEncrypted: false,
        reactions: {},
        status: 'delivered',
      };
      const c0Msgs = state.messages['c0'] || [];
      const updatedChats = state.chats.map(c =>
        c.id === 'c0'
          ? { ...c, lastMessage: '🔐 登录安全提醒', lastMessageTime: Date.now(), unreadCount: c.unreadCount + 1 }
          : c
      );
      return {
        ...state,
        isLoggedIn: true,
        currentUser: action.user ?? state.currentUser,
        messages: { ...state.messages, c0: [...c0Msgs, loginNoticeMsg] },
        chats: updatedChats,
      };
    }
    case 'LOGOUT':
      return { ...state, isLoggedIn: false, currentUser: null, onlineUsers: new Set(ALWAYS_ONLINE_USER_IDS) };
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'OPEN_CHAT':
      return {
        ...state,
        currentChatId: action.chatId,
        showChat: true,
        chats: state.chats.map(c =>
          c.id === action.chatId ? { ...c, unreadCount: 0 } : c
        ),
      };
    case 'CLOSE_CHAT':
      return { ...state, currentChatId: null, showChat: false };
    case 'SEND_MESSAGE': {
      const msgs = state.messages[action.chatId] || [];
      const stickerPreview = action.message.type === 'sticker' ? `[贴纸] ${action.message.stickerEmoji || ''}` : null;
      
      // 深度补齐发送者信息，解决“发信第一秒没头像”问题
      const enrichedMsg = { ...action.message };
      if (action.message.senderId === state.currentUser?.id) {
        enrichedMsg.senderProfile = {
          id: state.currentUser.id,
          nickname: state.currentUser.nickname,
          avatar: state.currentUser.avatar
        };
      }

      const newChats = state.chats.map(c =>
        c.id === action.chatId
          ? { ...c, lastMessage: stickerPreview || action.message.content || '[图片]', lastMessageTime: action.message.timestamp }
          : c
      );
      return {
        ...state,
        messages: { ...state.messages, [action.chatId]: [...msgs, enrichedMsg] },
        chats: newChats,
      };
    }
    case 'RECEIVE_MESSAGE': {
      const msgs = state.messages[action.chatId] || [];
      const isViewing = state.currentChatId === action.chatId && state.showChat;
      const recvStickerPreview = action.message.type === 'sticker' ? `[贴纸] ${action.message.stickerEmoji || ''}` : null;
      const newChats = state.chats.map(c =>
        c.id === action.chatId
          ? {
              ...c,
              lastMessage: recvStickerPreview || action.message.content || '[图片]',
              lastMessageTime: action.message.timestamp,
              unreadCount: isViewing ? c.unreadCount : c.unreadCount + 1,
            }
          : c
      );
      return {
        ...state,
        messages: { ...state.messages, [action.chatId]: [...msgs, action.message] },
        chats: newChats,
      };
    }
    case 'ADD_REACTION': {
      const msgs = state.messages[action.chatId] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: msgs.map(m =>
            m.id === action.messageId
              ? { ...m, reactions: { ...m.reactions, [action.emoji]: (m.reactions[action.emoji] || 0) + 1 } }
              : m
          ),
        },
      };
    }
    case 'MARK_READ':
      return {
        ...state,
        chats: state.chats.map(c =>
          c.id === action.chatId ? { ...c, unreadCount: 0 } : c
        ),
      };
    case 'LIKE_MOMENT': {
      return {
        ...state,
        moments: state.moments.map(p => {
          if (p.id !== action.postId) return p;
          const alreadyLiked = p.likes.some(l => l.userId === CURRENT_USER.id);
          return {
            ...p,
            likes: alreadyLiked
              ? p.likes.filter(l => l.userId !== CURRENT_USER.id)
              : [...p.likes, { userId: CURRENT_USER.id, userName: CURRENT_USER.name }],
          };
        }),
      };
    }
    case 'ADD_COMMENT':
      return {
        ...state,
        moments: state.moments.map(p =>
          p.id === action.postId
            ? { ...p, comments: [...p.comments, action.comment] }
            : p
        ),
      };
    case 'ADD_MOMENT':
      return { ...state, moments: [action.post, ...state.moments] };
    case 'START_CALL': {
      // 主叫方生成共享 roomId，被叫方使用主叫方传来的 roomId
      const sharedRoomId = action.roomId || `room-${[state.currentUser?.id || 'me', action.peerId].sort().join('-')}-${Date.now()}`;
      return {
        ...state,
        call: {
          isActive: true,
          callId: `call-${Date.now()}`,
          roomId: sharedRoomId,
          peerId: action.peerId,
          peerName: action.peerName,
          peerAvatar: action.peerAvatar,
          callType: action.callType,
          status: action.isIncoming ? 'ringing' : 'connecting',
          isIncoming: action.isIncoming,
          isMuted: false,
          isSpeaker: false,
          isVideoOff: false,
          duration: 0,
        },
      };
    }
    case 'ACCEPT_CALL':
      return { ...state, call: { ...state.call, status: 'connected' } };
    case 'END_CALL':
      return { ...state, call: { isActive: false } };
    case 'TOGGLE_MUTE':
      return { ...state, call: { ...state.call, isMuted: !state.call.isMuted } };
    case 'TOGGLE_SPEAKER':
      return { ...state, call: { ...state.call, isSpeaker: !state.call.isSpeaker } };
    case 'TOGGLE_VIDEO':
      return { ...state, call: { ...state.call, isVideoOff: !state.call.isVideoOff } };
    case 'SHOW_PROFILE':
      return { ...state, showProfile: action.userId };
    case 'HIDE_PROFILE':
      return { ...state, showProfile: null };
    case 'DELETE_CHAT':
      return {
        ...state,
        chats: state.chats.filter(c => c.id !== action.chatId),
        currentChatId: state.currentChatId === action.chatId ? null : state.currentChatId,
        showChat: state.currentChatId === action.chatId ? false : state.showChat,
      };
    case 'PIN_CHAT':
      return {
        ...state,
        chats: state.chats.map(c =>
          c.id === action.chatId ? { ...c, isPinned: !c.isPinned } : c
        ),
      };
    case 'MUTE_CHAT':
      return {
        ...state,
        chats: state.chats.map(c =>
          c.id === action.chatId ? { ...c, isMuted: !c.isMuted } : c
        ),
      };
    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: { ...state.messages, [action.chatId]: [] },
      };

    // ===== 隐私安全 Reducers =====

    case 'MARK_MESSAGE_READ': {
      const msgs = state.messages[action.chatId] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: msgs.map(m =>
            m.id === action.messageId && m.burnAfterRead && !m.readAt
              ? { ...m, readAt: Date.now() }
              : m
          ),
        },
      };
    }

    case 'BURN_MESSAGE': {
      const msgs = state.messages[action.chatId] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: msgs.filter(m => m.id !== action.messageId),
        },
      };
    }

    case 'SET_EPHEMERAL_TIMER': {
      return {
        ...state,
        chats: state.chats.map(c =>
          c.id === action.chatId
            ? { ...c, ephemeralTimer: action.timer }
            : c
        ),
      };
    }

    case 'INSERT_CALL_RECORD': {
      const msgs = state.messages[action.chatId] || [];
      const callMsg: Message = {
        id: `call-${Date.now()}`,
        chatId: action.chatId,
        senderId: CURRENT_USER.id,
        content: action.callType === 'audio'
          ? (action.status === 'completed' ? `📞 语音通话 ${Math.floor(action.duration / 60).toString().padStart(2,'0')}:${(action.duration % 60).toString().padStart(2,'0')}`
            : action.status === 'missed' ? '📞 未接来电'
            : '📞 已拒绝通话')
          : (action.status === 'completed' ? `📹 视频通话 ${Math.floor(action.duration / 60).toString().padStart(2,'0')}:${(action.duration % 60).toString().padStart(2,'0')}`
            : action.status === 'missed' ? '📹 未接视频通话'
            : '📹 已拒绝视频通话'),
        type: 'call',
        timestamp: Date.now(),
        isEncrypted: false,
        reactions: {},
        status: 'sent',
      };
      return {
        ...state,
        messages: { ...state.messages, [action.chatId]: [...msgs, callMsg] },
        chats: state.chats.map(c =>
          c.id === action.chatId
            ? { ...c, lastMessage: callMsg.content, lastMessageTime: callMsg.timestamp }
            : c
        ),
      };
    }
    case 'UPDATE_CALL_STATE':
      return { ...state, call: { ...state.call, ...action.patch } };
    case 'INSERT_SCREENSHOT_NOTICE': {
      const msgs = state.messages[action.chatId] || [];
      const noticeMsg: Message = {
        id: `sys-screenshot-${Date.now()}`,
        chatId: action.chatId,
        senderId: 'system',
        content: `${action.byUser} 截取了屏幕`,
        type: 'system',
        timestamp: Date.now(),
        isEncrypted: false,
        reactions: {},
        status: 'read',
      };
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: [...msgs, noticeMsg],
        },
      };
    }

    // ===== 在线状态 Reducers =====
    case 'SET_USER_ONLINE': {
      const next = new Set(state.onlineUsers);
      next.add(action.userId);
      return { ...state, onlineUsers: next };
    }
    case 'SET_USER_OFFLINE': {
      if (ALWAYS_ONLINE_USER_IDS.has(action.userId)) {
        return state;
      }
      const next = new Set(state.onlineUsers);
      next.delete(action.userId);
      return { ...state, onlineUsers: next };
    }

    // ===== 已读回执 Reducer =====
    case 'MARK_MESSAGES_READ_BY_PEER': {
      const msgs = state.messages[action.chatId] || [];
      const idSet = new Set(action.messageIds);
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: msgs.map(m =>
            idSet.has(m.id) ? { ...m, status: 'read' as const } : m
          ),
        },
      };
    }

    // ===== 私聊持久化 Reducers =====
    case 'SET_CHATS': {
      return { ...state, chats: dedupeChats([...state.chats, ...action.chats]) };
    }
    case 'SET_MESSAGES': {
      return {
        ...state,
        messages: { ...state.messages, [action.chatId]: action.messages },
      };
    }
    case 'UPSERT_CHAT': {
      return {
        ...state,
        chats: dedupeChats([...state.chats, action.chat]),
      };
    }
    case 'REPLACE_MESSAGE_ID': {
      const msgs = state.messages[action.chatId] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: msgs.map(m =>
            m.id === action.tempId ? { ...m, id: action.realId, status: 'sent' as const } : m
          ),
        },
      };
    }

    // ===== 消息撤回 Reducer =====
    case 'RECALL_MESSAGE': {
      const msgs = state.messages[action.chatId] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: msgs.map(m =>
            m.id === action.messageId
              ? { ...m, isRecalled: true, content: '消息已撤回' }
              : m
          ),
        },
        // 如果最后一条消息被撤回，更新会话预览
        chats: state.chats.map(c => {
          if (c.id !== action.chatId) return c;
          const chatMsgs = state.messages[action.chatId] || [];
          const lastMsg = chatMsgs[chatMsgs.length - 1];
          if (lastMsg?.id === action.messageId) {
            return { ...c, lastMessage: '消息已撤回' };
          }
          return c;
        }),
      };
    }
    case 'RESTORE_MESSAGE': {
      const msgs = state.messages[action.chatId] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: msgs.map(m =>
            m.id === action.messageId ? { ...m, isRecalled: false } : m
          ),
        },
      };
    }

    // ===== 消息防篡改 Reducer =====
    case 'UPDATE_MESSAGE_INTEGRITY': {
      const msgs = state.messages[action.chatId] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: msgs.map(m =>
            m.id === action.messageId
              ? { ...m, integrityStatus: action.integrityStatus }
              : m
          ),
        },
      };
    }

    // ===== 用户资料实时同步：更新会话列表中缓存的头像/昵称 =====
    case 'UPDATE_USER_PROFILE_IN_CHATS': {
      const { userId, nickname, avatar, updatedAt } = action;
      return {
        ...state,
        chats: state.chats.map(c => {
          if (c.type === 'private' && c.members?.includes(userId)) {
            if (
              updatedAt !== undefined
              && c.peerProfileUpdatedAt !== undefined
              && updatedAt < c.peerProfileUpdatedAt
            ) {
              return c;
            }
            const updates: Partial<Chat> = {};
            if (nickname !== undefined) updates.name = nickname;
            if (avatar !== undefined) updates.avatar = avatar;
            if (updatedAt !== undefined) updates.peerProfileUpdatedAt = updatedAt;
            return { ...c, ...updates };
          }
          return c;
        }),
      };
    }

    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** 持久信令 WebSocket（供子组件发送已读回执、撤回等信令） */
  signalWs: React.RefObject<WebSocket | null>;
}

interface AppActionsContextType {
  dispatch: React.Dispatch<Action>;
  signalWs: React.RefObject<WebSocket | null>;
}

// React 19 修复：使用 Zustand 全局 store 替代 React Context
// Zustand 使用 useSyncExternalStore 内部实现，保证在任何 React 版本下状态变化时一定触发重渲染
interface AppZustandStore {
  state: AppState;
  setState: (state: AppState) => void;
}

// 延迟初始化：在模块加载时创建 store，使用 getInitialState() 作为初始值
// 这样 useStore 一开始就有正确的值，当 AppProvider 更新 store 时，Zustand 会触发所有订阅者重渲染
let appZustandStore: ReturnType<typeof createStore<AppZustandStore>>;

function getAppZustandStore() {
  if (!appZustandStore) {
    appZustandStore = createStore<AppZustandStore>((set) => ({
      state: getInitialState(),
      setState: (state: AppState) => set({ state }),
    }));
  }
  return appZustandStore;
}

let _dispatch: React.Dispatch<Action> | null = null;

// 全局 dispatch 函数，允许在 AppProvider 外部调用
export function globalDispatch(action: Action) {
  if (_dispatch) _dispatch(action);
}

// 导出 getAppStore，允许外部组件直接订阅 store 变化
export function getAppStore() {
  return getAppZustandStore();
}

/**
 * 领域级只读订阅：页面只订阅自己需要的切片，不再因 call/ui 等无关状态变化而读取整棵 AppState。
 * 旧的 useApp() 保留给兼容代码和需要 signalWs/dispatch 的主容器。
 */
export function useAppSelector<T>(selector: (state: AppState) => T): T {
  return useStore(getAppZustandStore(), (storeState) => selector(storeState.state));
}

export const useChats = () => useAppSelector(state => state.chats);
export const useCurrentUserState = () => useAppSelector(state => state.currentUser);
export const useCurrentChatId = () => useAppSelector(state => state.currentChatId);
export const useOnlineUsers = () => useAppSelector(state => state.onlineUsers);
const EMPTY_MESSAGES: Message[] = [];
export const useChatMessages = (chatId: string | null) => useAppSelector(state => chatId ? (state.messages[chatId] || EMPTY_MESSAGES) : EMPTY_MESSAGES);

const AppActionsContext = createContext<AppActionsContextType | null>(null);
// 保留 AppContext 以兼容现有代码
const AppContext = createContext<AppContextType | null>(null);

/** 从 localStorage 恢复登录状态的初始化函数 */
function getInitialState(): AppState {
  try {
    const token = localStorage.getItem('user_token');
    const uid = localStorage.getItem('user_id');
    const nickname = localStorage.getItem('user_nickname');
    const username = localStorage.getItem('user_username');
    const avatar = localStorage.getItem('user_avatar') || '';
    const bio = localStorage.getItem('user_bio') || '';
    if (token && uid && nickname) {
      return {
        ...initialState,
        isLoggedIn: true,
        currentUser: { id: uid, username: username || uid, nickname, avatar, bio },
      };
    }
  } catch {}
  return initialState;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);
  const botWsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // FCM 推送通知（仅在 Native App 环境中生效）
  useJPush(state.isLoggedIn);
  useFCM(state.isLoggedIn);

  useEffect(() => {
    if (!state.isLoggedIn) return;
    void loadChatsFromLocalDb()
      .then((localChats) => {
        if (localChats.length > 0) {
          dispatch({ type: 'SET_CHATS', chats: localChats });
          console.log(`[AppContext] 已从本地 NoSQL 恢复 ${localChats.length} 个会话`);
        }
      })
      .catch((err) => console.error('[AppContext] 本地会话恢复失败:', err));
  }, [state.isLoggedIn]);

  useEffect(() => {
    if (!state.isLoggedIn || state.chats.length === 0) return;
    void persistChats(state.chats).catch((err) => console.error('[AppContext] 本地会话持久化失败:', err));
  }, [state.isLoggedIn, state.chats]);

  useEffect(() => {
    if (!state.isLoggedIn || !state.currentChatId) return;
    if ((state.messages[state.currentChatId] || []).length > 0) return;

    void loadPrivateMessagesFromLocalDb(state.currentChatId)
      .then((localMessages) => {
        if (localMessages.length > 0) {
          dispatch({ type: 'SET_MESSAGES', chatId: state.currentChatId as string, messages: localMessages });
          console.log(`[AppContext] 已从本地 NoSQL 恢复会话 ${state.currentChatId} 的 ${localMessages.length} 条消息`);
        }
      })
      .catch((err) => console.error('[AppContext] 本地私聊消息恢复失败:', err));
  }, [state.isLoggedIn, state.currentChatId, state.messages]);

  useEffect(() => {
    if (!state.isLoggedIn) return;
    const allMessages = Object.values(state.messages).flat();
    if (allMessages.length === 0) return;
    void persistPrivateMessages(allMessages).catch((err) => console.error('[AppContext] 本地私聊消息持久化失败:', err));
  }, [state.isLoggedIn, state.messages]);

  const notifyIncomingMessage = useCallback((chatId: string, message: Message) => {
    const currentState = stateRef.current;
    const chat = currentState.chats.find(item => item.id === chatId);
    const currentUserId = currentState.currentUser?.id || CURRENT_USER.id;
    const isOwnMessage = message.senderId === currentUserId;
    const isViewingCurrentChat = currentState.currentChatId === chatId && currentState.showChat;

    if (isOwnMessage || isViewingCurrentChat || chat?.isMuted) {
      return;
    }

    void playNotificationSound();
    triggerNotificationVibration();

    if (shouldShowBrowserNotification()) {
      showBrowserNotification({
        chatId,
        title: chat?.name || 'imim 新消息',
        body: formatMessagePreview(message),
        icon: chat?.avatar || '/favicon.ico',
        tag: `cqim-chat-${chatId}`,
      });
    }
  }, []);

  useEffect(() => {
    const warmup = () => {
      void warmupNotificationAudio();
    };

    window.addEventListener('pointerdown', warmup, { passive: true });
    window.addEventListener('keydown', warmup);
    window.addEventListener('touchstart', warmup, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', warmup);
      window.removeEventListener('keydown', warmup);
      window.removeEventListener('touchstart', warmup);
    };
  }, []);

  useEffect(() => {
    const handleOpenChatFromNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string }>).detail;
      if (!detail?.chatId) return;
      dispatch({ type: 'OPEN_CHAT', chatId: detail.chatId });
    };

    window.addEventListener('cqim:open-chat-from-notification', handleOpenChatFromNotification as EventListener);

    return () => {
      window.removeEventListener('cqim:open-chat-from-notification', handleOpenChatFromNotification as EventListener);
    };
  }, [dispatch]);

  // ===== 登录后初始化 E2EE 并加载会话列表 =====
  useEffect(() => {
    if (!state.isLoggedIn) return;
    const token = localStorage.getItem('user_token');
    if (!token) return;

    const currentUserId = stateRef.current.currentUser?.id || localStorage.getItem('user_id') || 'me';

    // P0: 登录后强制初始化 E2EE 并注册 Bundle
    (async () => {
      try {
        const { E2EEManager } = await import('../lib/e2ee/E2EEManager');
        const e2ee = E2EEManager.shared();
        await e2ee.initialize();
        await e2ee.registerBundleToServer(currentUserId);
        await e2ee.checkAndReplenishServerPreKeys(currentUserId);
        console.log('[E2EE] 身份凭证已就绪');
      } catch (err) {
        console.error('[E2EE] 初始化失败:', err);
      }
    })();

    const authHeaders = { 'Authorization': `Bearer ${token}` };

    // P1：首页聚合接口优先，失败时回退到原有双接口，避免新接口异常影响登录
    fetch('/api/home/sync', { headers: authHeaders })
      .then(async (response) => {
        if (response.ok) {
          const payload = await response.json();
          if (payload?.data) return { aggregated: true, ...payload.data };
        }
        const [privateData, groupData] = await Promise.all([
          fetch('/api/chat/list', { headers: authHeaders }).then(r => r.ok ? r.json() : null),
          fetch(`/api/group/list?userId=${encodeURIComponent(currentUserId)}`).then(r => r.ok ? r.json() : null),
        ]);
        return { aggregated: false, chats: privateData?.chats || [], groups: groupData?.groups || [] };
      })
      .then((homeData: any) => {
        const privateChats: Chat[] = (homeData?.chats || []).map((c: any) => {
          const peerId = c.peer?.id;
          const peerName = c.peer?.nickname || c.peer?.username || '未知用户';

          return normalizeSpecialChat({
            id: c.id,
            type: 'private' as const,
            name: peerName,
            avatar: c.peer?.avatar || '',
            lastMessage: c.lastMessage || '',
            lastMessageTime: c.lastMessageAt || c.createdAt,
            unreadCount: c.unreadCount || 0,
            isPinned: false,
            isMuted: false,
            isEncrypted: true,
            members: [currentUserId, peerId].filter(Boolean),
          });
        });

        const groupChats: Chat[] = (homeData?.groups || []).map((g: any) => ({
          id: `group_${g.groupId || g.id}`,
          groupId: g.groupId || g.id,
          type: 'group' as const,
          name: g.name || '未命名群聊',
          avatar: g.avatar || '',
          lastMessage: g.lastMessage || '',
          lastMessageTime: g.updatedAt || g.createdAt || Date.now(),
          unreadCount: g.unreadCount || 0,
          isPinned: false,
          isMuted: false,
          isEncrypted: true,
          members: [],
        }));

        const mergedChats = [...privateChats, ...groupChats];
        dispatch({ type: 'SET_CHATS', chats: mergedChats });
        console.log(`[AppContext] ${homeData?.aggregated ? '聚合' : '回退'}加载了 ${privateChats.length} 个私聊会话，${groupChats.length} 个群聊会话`);
      })
      .catch(err => console.error('[AppContext] 加载会话列表失败:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isLoggedIn]);

  // 建立持久 WebSocket 连接，接收服务器推送的消息
  useEffect(() => {
    // 只在登录后连接
    if (!state.isLoggedIn) return;

    const currentUserId = state.currentUser?.id || 'me';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/signal?userId=${encodeURIComponent(currentUserId)}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      botWsRef.current = ws;

      // 应用层心跳定时器，每 25s 发送一次 heartbeat，保持 Redis TTL 刷新
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      ws.onopen = () => {
        console.log('[AppContext] 持久信令连接已建立');
        // 通知群聊同步模块：这是一个新的连接，可按各群 lastSeq 增量补消息
        window.dispatchEvent(new CustomEvent('cqim:signal-open', { detail: { ws } }));
        // 开启心跳：每 25s 发送一次（服务端 30s 超时，留 5s 容错）
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // ===== BOT 消息推送 =====
          if (msg.type === 'bot_message') {
            const { chatId, senderId, content, messageId, timestamp, msgType, voiceUrl, duration } = msg;
            const hasVoice = (msgType === 'voice' || !!voiceUrl) && voiceUrl;
            const newMsg: Message = {
              id: messageId || `bot-${Date.now()}`,
              chatId,
              senderId: senderId || 'BOT',
              content: content || (hasVoice ? 'AI 语音回复' : ''),
              type: (msgType === 'voice' || hasVoice) ? 'voice' : 'text',
              timestamp: timestamp || Date.now(),
              isEncrypted: false,
              reactions: {},
              status: 'delivered',
              ...(hasVoice ? { voiceUrl, duration: duration || 0 } : {}),
            };
            dispatch({ type: 'RECEIVE_MESSAGE', chatId, message: newMsg });
            notifyIncomingMessage(chatId, newMsg);
            window.dispatchEvent(new CustomEvent('bot_message_received', { detail: { chatId } }));
            console.log(`[AppContext] 收到 BOT 消息: chatId=${chatId} ${hasVoice ? '[语音] ' + voiceUrl : ''} ${content ? 'content=' + content.slice(0, 40) : ''}`);
            return;
          }

          // ===== 私聊消息推送 =====
          if (msg.type === 'private_message') {
            const payload = msg.payload || {};
            const { id, chatId, senderId, msgType, content, replyToId, isRevoked, extra, createdAt, tempId, ack, burnAfterRead, hmac } = payload;
            const currentUserId = stateRef.current.currentUser?.id || localStorage.getItem('user_id') || 'me';

            if (ack && tempId) {
              // 发送确认：替换临时消息ID
              dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId, realId: id });
              console.log(`[AppContext] 私聊消息确认: tempId=${tempId} -> realId=${id}`);
            } else if (senderId !== currentUserId) {
              // 收到对方消息
              (async () => {
                let decryptedContent = isRevoked ? '消息已撤回' : (content || '');
                let finalMsgType = msgType || 'text';
                let finalExtra = extra;
                let decryptionFailed = false;

                // P0: 强制 E2EE 解密，拒绝旧明文投递
                if (msgType === 'encrypted' && content && !isRevoked) {
                  try {
                    const { E2EEManager } = await import('../lib/e2ee/E2EEManager');
                    const e2ee = E2EEManager.shared();
                    const envelope = JSON.parse(content);
                    const decryptedStr = await e2ee.decrypt(senderId, envelope);
                    const decrypted = JSON.parse(decryptedStr);
                    
                    decryptedContent = decrypted.content;
                    finalMsgType = decrypted.msgType || 'text';
                    finalExtra = { ...extra, ...decrypted.extra };
                  } catch (err) {
                    console.error('[E2EE] 解密失败:', err);
                    decryptedContent = '🔒 无法解密消息，请重置安全会话';
                    decryptionFailed = true;
                  }
                } else if (msgType !== 'encrypted' && !isRevoked) {
                  decryptedContent = '⚠️ [不支持的旧明文消息]';
                  decryptionFailed = true;
                }

                const newMsg: Message = {
                  id,
                  chatId,
                  senderId,
                  content: decryptedContent,
                  type: finalMsgType as any,
                  timestamp: createdAt || Date.now(),
                  isEncrypted: true,
                  reactions: {},
                  status: 'delivered',
                  isRecalled: isRevoked || false,
                  replyTo: replyToId || undefined,
                  decryptionFailed,
                  ...(finalExtra?.voiceUrl ? { voiceUrl: finalExtra.voiceUrl, duration: finalExtra.duration || 0 } : {}),
                  ...(finalExtra?.imageUrl ? { imageUrl: finalExtra.imageUrl } : {}),
                  ...(finalExtra?.videoUrl ? { videoUrl: finalExtra.videoUrl } : {}),
                  ...(finalExtra?.locationData ? { locationData: finalExtra.locationData } : {}),
                  ...(finalExtra?.stickerUrl ? { stickerUrl: finalExtra.stickerUrl, stickerEmoji: finalExtra.stickerEmoji, stickerSetName: finalExtra.stickerSetName } : {}),
                  ...(burnAfterRead ? { burnAfterRead } : {}),
                  ...(hmac ? { hmac, integrityStatus: 'unverified' as const } : {}),
                };
                dispatch({ type: 'RECEIVE_MESSAGE', chatId, message: newMsg });
                notifyIncomingMessage(chatId, newMsg);
              })();
            }

            // 如果该会话不在列表中，动态创建
            const currentState = stateRef.current;
            if (!currentState.chats.find(c => c.id === chatId)) {
              const token = localStorage.getItem('user_token');
              if (token) {
                fetch(`/api/chat/${chatId}`, {
                  headers: { 'Authorization': `Bearer ${token}` },
                })
                  .then(r => r.ok ? r.json() : null)
                  .then(data => {
                    if (data?.chat) {
                      const c = data.chat;
                      dispatch({
                        type: 'UPSERT_CHAT',
                        chat: normalizeSpecialChat({
                          id: c.id,
                          type: 'private',
                          name: c.peer?.nickname || c.peer?.username || '未知用户',
                          avatar: c.peer?.avatar || '',
                          lastMessage: '🔒 [加密消息]',
                          lastMessageTime: createdAt || Date.now(),
                          unreadCount: 1,
                          isPinned: false,
                          isMuted: false,
                          isEncrypted: true,
                          members: [currentUserId, c.peer?.id].filter(Boolean),
                        }),
                      });
                    }
                  })
                  .catch(() => {});
              }
            }
            console.log(`[AppContext] 收到私聊消息: chatId=${chatId} from=${senderId}`);
            return;
          }

          // ===== 私聊正在输入状态 =====
          if (msg.type === 'private_typing') {
            const { chatId: typingChatId } = msg.payload || {};
            if (typingChatId) {
              dispatch({
                type: 'UPSERT_CHAT',
                chat: {
                  ...stateRef.current.chats.find(c => c.id === typingChatId)!,
                  isTyping: true,
                },
              });
              // 3秒后自动清除
              setTimeout(() => {
                const chat = stateRef.current.chats.find(c => c.id === typingChatId);
                if (chat?.isTyping) {
                  dispatch({
                    type: 'UPSERT_CHAT',
                    chat: { ...chat, isTyping: false },
                  });
                }
              }, 3000);
            }
            return;
          }

          // ===== 初始在线用户列表（连接时服务端推送） =====
          if (msg.type === 'online_users_list') {
            const { userIds } = msg.payload || {};
            if (Array.isArray(userIds)) {
              userIds.forEach((uid: string) => dispatch({ type: 'SET_USER_ONLINE', userId: uid }));
              console.log(`[AppContext] 初始在线用户列表: ${userIds.length} 人在线`);
            }
            return;
          }

          // ===== 好友在线状态推送 =====
          if (msg.type === 'friend_online') {
            const { userId } = msg.payload || {};
            if (userId) dispatch({ type: 'SET_USER_ONLINE', userId });
            return;
          }
          if (msg.type === 'friend_offline') {
            const { userId } = msg.payload || {};
            if (userId) dispatch({ type: 'SET_USER_OFFLINE', userId });
            return;
          }

          // ===== 已读回执 =====
          if (msg.type === 'read_receipt') {
            const { chatId, messageIds } = msg.payload || {};
            if (chatId && Array.isArray(messageIds) && messageIds.length > 0) {
              dispatch({ type: 'MARK_MESSAGES_READ_BY_PEER', chatId, messageIds });
              console.log(`[AppContext] 已读回执: chatId=${chatId} ids=${messageIds.join(',')}`);
            }
            return;
          }

          // ===== 私聊撤回通知 =====
          if (msg.type === 'recall_notify') {
            const { chatId, messageId } = msg.payload || {};
            if (chatId && messageId) {
              dispatch({ type: 'RECALL_MESSAGE', chatId, messageId });
              console.log(`[AppContext] 收到撤回通知: chatId=${chatId} msgId=${messageId}`);
            }
            return;
          }

          // ===== 群聊撤回通知 =====
          if (msg.type === 'group_recall_notify') {
            const { groupId, messageId } = msg.payload || {};
            if (groupId && messageId) {
              // groupId 对应前端的 chatId（需要找到对应的 chat）
              const currentState = stateRef.current;
              const chat = currentState.chats.find(c => c.groupId === groupId || c.id === groupId || c.id === `group_${groupId}`);
              if (chat) {
                dispatch({ type: 'RECALL_MESSAGE', chatId: chat.id, messageId });
              }
              console.log(`[AppContext] 群聊撤回通知: groupId=${groupId} msgId=${messageId}`);
            }
            return;
          }

          // ===== 阅后即焚：消息已被对方阅读，开始倒计时 =====
          if (msg.type === 'burn_read') {
            const { chatId, messageId, readAt, burnAfterRead } = msg.payload || {};
            if (chatId && messageId) {
              dispatch({ type: 'MARK_MESSAGE_READ', chatId, messageId });
              console.log(`[AppContext] 阅后即焚已读: chatId=${chatId} msgId=${messageId} burnAfterRead=${burnAfterRead}s`);
            }
            return;
          }

          // ===== 阅后即焚：服务器通知删除消息 =====
          if (msg.type === 'burn_delete') {
            const { chatId, messageId } = msg.payload || {};
            if (chatId && messageId) {
              dispatch({ type: 'BURN_MESSAGE', chatId, messageId });
              console.log(`[AppContext] 阅后即焚销毁: chatId=${chatId} msgId=${messageId}`);
            }
            return;
          }

          // ===== 来电邀请（被叫方收到，触发来电弹窗）=====
          if (msg.type === 'call_invite') {
            const callerId = msg.from;
            const callType: 'audio' | 'video' = msg.payload?.callType || 'audio';
            const callerRoomId: string | undefined = msg.payload?.roomId;
            const callerName: string | undefined = msg.payload?.callerName;
            const callerAvatar: string | undefined = msg.payload?.callerAvatar;
            const currentState = stateRef.current;
            // 如果当前已有通话进行中，忽略
            if (currentState.call?.isActive) return;
            // 从 chats 中找到对方信息，优先使用 payload 中携带的 callerName
            const callerChat = currentState.chats.find(
              c => c.type === 'private' && Array.isArray(c.members) && c.members.includes(callerId)
            );
            const peerName = callerName || callerChat?.name || callerId;
            const peerAvatar = callerAvatar || callerChat?.avatar || '';
            dispatch({
              type: 'START_CALL',
              peerId: callerId,
              peerName,
              peerAvatar,
              callType,
              isIncoming: true,
              roomId: callerRoomId,  // ★ 使用主叫方传来的 roomId，确保双方进入同一个 TRTC 房间
            });
            console.log(`[AppContext] 收到来电: from=${callerId} name=${peerName} type=${callType} roomId=${callerRoomId}`);
            return;
          }

          // ===== 被叫方接听（主叫方收到）=====
          if (msg.type === 'call_accept') {
            const currentState = stateRef.current;
            if (currentState.call?.isActive) {
              dispatch({ type: 'ACCEPT_CALL' });
              console.log(`[AppContext] 对方已接听通话`);
            }
            return;
          }

          // ===== 来电被拒绝 / 通话结束（主叫方收到）=====
          if (msg.type === 'call_reject' || msg.type === 'call_end') {
            const currentState = stateRef.current;
            if (currentState.call?.isActive) {
              dispatch({ type: 'END_CALL' });
              console.log(`[AppContext] 通话结束: type=${msg.type}`);
            }
            return;
          }

          // ===== 朋友圈实时推送：点赞/评论通知 =====
          if (msg.type === 'moment_like_notify' || msg.type === 'moment_comment_notify') {
            window.dispatchEvent(new CustomEvent('moment_realtime_event', { detail: { type: msg.type, payload: msg.payload } }));
            console.log(`[AppContext] 朋友圈实时事件: ${msg.type}`, msg.payload);
            return;
          }

          // ===== 用户资料实时更新 =====
          if (msg.type === 'user_profile_updated') {
            const { userId, nickname, avatar, username, bio, backgroundUrl, updatedAt } = msg.payload || {};
            if (!userId) return;
            // 更新会话列表中的缓存
            dispatch({ type: 'UPDATE_USER_PROFILE_IN_CHATS', userId, nickname, avatar, updatedAt });
            // 派发全局事件，让各组件自行刷新
            window.dispatchEvent(new CustomEvent('cqim:remote-user-profile-updated', {
              detail: { userId, nickname, avatar, username, bio, backgroundUrl, updatedAt },
            }));
            console.log(`[AppContext] 收到用户资料更新: userId=${userId} nickname=${nickname}`);
            return;
          }
        } catch (e) {
          // 忽略非 JSON 消息（如 WebRTC 信令）
        }
      };

       ws.onclose = () => {
        console.log('[AppContext] 持久信令连接断开，5 秒后重连...');
        // 清除心跳定时器
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        setTimeout(() => {
          if (stateRef.current.isLoggedIn) connect();
        }, 5000);
      };
      ws.onerror = (err) => {
        console.error('[AppContext] 持久信令连接错误:', err);
        // 错误时也清除心跳
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };
    };
    connect();
    return () => {
      botWsRef.current?.close();
      botWsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isLoggedIn, notifyIncomingMessage]);

  // 同步到 Zustand store
  // 在渲染期间直接同步更新，确保 AppContent 重渲染时读取到最新值
  // 注意： Zustand 的 setState 内部使用 Object.assign 更新 store，不会导致 React 重渲染循环
  _dispatch = dispatch;
  const store = getAppZustandStore();
  const currentZustandState = store.getState().state;
  if (currentZustandState !== state) {
    // 直接同步更新 store，让 AppContent 的 forceUpdate 订阅回调能在正确时机读到最新值
    store.getState().setState(state);
  }

  const actionsValue = React.useMemo(
    () => ({ dispatch, signalWs: botWsRef }),
    // dispatch 和 botWsRef 是稳定引用，useMemo 依赖不变，避免不必要的重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <AppActionsContext.Provider value={actionsValue}>
      {children}
    </AppActionsContext.Provider>
  );
}

export function useApp() {
  // React 19 修复：直接从 store 读取最新值，不依赖 useSyncExternalStore
  // 在 AppContent 中用 forceUpdate + store.subscribe 触发重渲染，重渲染时直接读取最新值
  const state = getAppZustandStore().getState().state;
  const actions = useContext(AppActionsContext);
  
  if (!actions) throw new Error('useApp must be used within AppProvider');
  return { state, dispatch: actions.dispatch, signalWs: actions.signalWs };
}

export function useAppActions() {
  const { dispatch } = useApp();

  return {
    login: useCallback((user?: AuthUser, deviceInfo?: { ip: string; device: string; location: string; time: string }) => dispatch({ type: 'LOGIN', user, deviceInfo }), [dispatch]),
    logout: useCallback(() => dispatch({ type: 'LOGOUT' }), [dispatch]),
    setTab: useCallback((tab: string) => dispatch({ type: 'SET_TAB', tab }), [dispatch]),
    openChat: useCallback((chatId: string) => dispatch({ type: 'OPEN_CHAT', chatId }), [dispatch]),
    closeChat: useCallback(() => dispatch({ type: 'CLOSE_CHAT' }), [dispatch]),
    sendMessage: useCallback((chatId: string, message: Message) => dispatch({ type: 'SEND_MESSAGE', chatId, message }), [dispatch]),
    receiveMessage: useCallback((chatId: string, message: Message) => dispatch({ type: 'RECEIVE_MESSAGE', chatId, message }), [dispatch]),
    addReaction: useCallback((chatId: string, messageId: string, emoji: string) => dispatch({ type: 'ADD_REACTION', chatId, messageId, emoji }), [dispatch]),
    markRead: useCallback((chatId: string) => dispatch({ type: 'MARK_READ', chatId }), [dispatch]),
    likeMoment: useCallback((postId: string) => dispatch({ type: 'LIKE_MOMENT', postId }), [dispatch]),
    addComment: useCallback((postId: string, comment: MomentPost['comments'][0]) => dispatch({ type: 'ADD_COMMENT', postId, comment }), [dispatch]),
    addMoment: useCallback((post: MomentPost) => dispatch({ type: 'ADD_MOMENT', post }), [dispatch]),
    startCall: useCallback((peerId: string, peerName: string, peerAvatar: string, callType: 'audio' | 'video', isIncoming: boolean, roomId?: string) =>
      dispatch({ type: 'START_CALL', peerId, peerName, peerAvatar, callType, isIncoming, roomId }), [dispatch]),
    acceptCall: useCallback(() => dispatch({ type: 'ACCEPT_CALL' }), [dispatch]),
    endCall: useCallback(() => dispatch({ type: 'END_CALL' }), [dispatch]),
    toggleMute: useCallback(() => dispatch({ type: 'TOGGLE_MUTE' }), [dispatch]),
    toggleSpeaker: useCallback(() => dispatch({ type: 'TOGGLE_SPEAKER' }), [dispatch]),
    toggleVideo: useCallback(() => dispatch({ type: 'TOGGLE_VIDEO' }), [dispatch]),
    showProfile: useCallback((userId: string) => dispatch({ type: 'SHOW_PROFILE', userId }), [dispatch]),
    hideProfile: useCallback(() => dispatch({ type: 'HIDE_PROFILE' }), [dispatch]),
    deleteChat: useCallback(async (chatId: string) => {
      await authApi(`/api/chat/${encodeURIComponent(chatId)}`, undefined, 'DELETE');
      dispatch({ type: 'DELETE_CHAT', chatId });
    }, [dispatch]),
    pinChat: useCallback((chatId: string) => dispatch({ type: 'PIN_CHAT', chatId }), [dispatch]),
    muteChat: useCallback((chatId: string) => dispatch({ type: 'MUTE_CHAT', chatId }), [dispatch]),
    clearMessages: useCallback((chatId: string) => dispatch({ type: 'CLEAR_MESSAGES', chatId }), [dispatch]),

    // ===== 隐私安全 Actions =====
    markMessageRead: useCallback((chatId: string, messageId: string) =>
      dispatch({ type: 'MARK_MESSAGE_READ', chatId, messageId }), [dispatch]),
    burnMessage: useCallback((chatId: string, messageId: string) =>
      dispatch({ type: 'BURN_MESSAGE', chatId, messageId }), [dispatch]),
    setEphemeralTimer: useCallback((chatId: string, timer: BurnAfterReadTimer | undefined) =>
      dispatch({ type: 'SET_EPHEMERAL_TIMER', chatId, timer }), [dispatch]),
    insertScreenshotNotice: useCallback((chatId: string, byUser: string) =>
      dispatch({ type: 'INSERT_SCREENSHOT_NOTICE', chatId, byUser }), [dispatch]),
    insertCallRecord: useCallback((chatId: string, callType: 'audio' | 'video', duration: number, status: 'completed' | 'missed' | 'rejected') =>
      dispatch({ type: 'INSERT_CALL_RECORD', chatId, callType, duration, status }), [dispatch]),
    updateCallState: useCallback((patch: Partial<import('@/lib/store').CallState>) =>
      dispatch({ type: 'UPDATE_CALL_STATE', patch }), [dispatch]),

    // ===== 消息撤回 Actions =====
    recallMessage: useCallback(async (chatId: string, messageId: string) => {
      // 1. 乐观更新
      dispatch({ type: 'RECALL_MESSAGE', chatId, messageId });
      
      try {
        // 2. 调用后端 API
        // 注意：authApi 在请求失败时会抛出错误，成功时返回解析后的 JSON
        await authApi(`/api/chat/${encodeURIComponent(chatId)}/recall/${encodeURIComponent(messageId)}`, {}, 'POST');
      } catch (error) {
        console.error('Recall message failed:', error);
        // 3. 失败回滚
        dispatch({ type: 'RESTORE_MESSAGE', chatId, messageId });
        // 如果是 404 或其他错误，可能消息已经不在了或无法撤回，这里可以根据需要提示用户
      }
    }, [dispatch]),

    // ===== 私聊持久化 Actions =====
    setChats: useCallback((chats: Chat[]) =>
      dispatch({ type: 'SET_CHATS', chats }), [dispatch]),
    setMessages: useCallback((chatId: string, messages: Message[]) =>
      dispatch({ type: 'SET_MESSAGES', chatId, messages }), [dispatch]),
    upsertChat: useCallback((chat: Chat) =>
      dispatch({ type: 'UPSERT_CHAT', chat }), [dispatch]),
    replaceMessageId: useCallback((chatId: string, tempId: string, realId: string) =>
      dispatch({ type: 'REPLACE_MESSAGE_ID', chatId, tempId, realId }), [dispatch]),
  };
}
