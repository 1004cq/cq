/**
 * 万人群消息全局上下文
 *
 * 管理多个群的消息状态、未读数、在线状态
 * 与 AppContext 协作，为大群场景提供专用的高性能消息通道
 */

import React, { createContext, useContext, useCallback, useRef, useEffect, useReducer, type ReactNode } from 'react';
import { loadGroupMessagesFromLocalDb, persistGroupMessages } from '@/lib/localdb';
import { trackEvent } from '@/lib/telemetry';

// ============ 类型定义 ============

export interface GroupMessageItem {
  id: string;
  seq: number;
  senderId: string;
  senderName: string;
  msgType: string;
  content: string;
  replyToId?: string;
  extra?: any;
  timestamp: number;
  isRevoked?: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'failed';
}

interface GroupState {
  messages: GroupMessageItem[];
  lastAckSeq: number;
  latestSeq: number;
  unreadCount: number;
  hasMore: boolean;
  loading: boolean;
}

interface State {
  groups: Record<string, GroupState>;
  wsConnected: boolean;
}

type Action =
  | { type: 'SET_MESSAGES'; groupId: string; messages: GroupMessageItem[]; hasMore: boolean; latestSeq: number }
  | { type: 'APPEND_MESSAGES'; groupId: string; messages: GroupMessageItem[] }
  | { type: 'PREPEND_MESSAGES'; groupId: string; messages: GroupMessageItem[]; hasMore: boolean }
  | { type: 'OPTIMISTIC_SEND'; groupId: string; message: GroupMessageItem }
  | { type: 'CONFIRM_SEND'; groupId: string; localId: string; seq: number; timestamp: number }
  | { type: 'SET_LOADING'; groupId: string; loading: boolean }
  | { type: 'SET_UNREAD'; groupId: string; count: number }
  | { type: 'ACK'; groupId: string; seq: number }
  | { type: 'SET_WS_CONNECTED'; connected: boolean }
  | { type: 'CLEAR_GROUP'; groupId: string };

// ============ Reducer ============

const initialState: State = {
  groups: {},
  wsConnected: false,
};

function getGroupState(state: State, groupId: string): GroupState {
  return state.groups[groupId] || {
    messages: [],
    lastAckSeq: 0,
    latestSeq: 0,
    unreadCount: 0,
    hasMore: true,
    loading: false,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_MESSAGES': {
      const gs = getGroupState(state, action.groupId);
      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: {
            ...gs,
            messages: action.messages,
            hasMore: action.hasMore,
            latestSeq: action.latestSeq,
            loading: false,
          },
        },
      };
    }

    case 'APPEND_MESSAGES': {
      const gs = getGroupState(state, action.groupId);
      const existingSeqs = new Set(gs.messages.map(m => m.seq));
      const newMsgs = action.messages.filter(m => !existingSeqs.has(m.seq));
      if (newMsgs.length === 0) return state;

      let merged = [...gs.messages, ...newMsgs].sort((a, b) => a.seq - b.seq);
      // 内存淘汰：保留最新 2000 条
      if (merged.length > 2000) {
        merged = merged.slice(merged.length - 2000);
      }

      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: {
            ...gs,
            messages: merged,
            latestSeq: Math.max(gs.latestSeq, ...newMsgs.map(m => m.seq)),
            unreadCount: gs.unreadCount + newMsgs.length,
          },
        },
      };
    }

    case 'PREPEND_MESSAGES': {
      const gs = getGroupState(state, action.groupId);
      const existingSeqs = new Set(gs.messages.map(m => m.seq));
      const newMsgs = action.messages.filter(m => !existingSeqs.has(m.seq));
      if (newMsgs.length === 0) return { ...state, groups: { ...state.groups, [action.groupId]: { ...gs, hasMore: action.hasMore, loading: false } } };

      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: {
            ...gs,
            messages: [...newMsgs, ...gs.messages].sort((a, b) => a.seq - b.seq),
            hasMore: action.hasMore,
            loading: false,
          },
        },
      };
    }

    case 'OPTIMISTIC_SEND': {
      const gs = getGroupState(state, action.groupId);
      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: {
            ...gs,
            messages: [...gs.messages, action.message],
          },
        },
      };
    }

    case 'CONFIRM_SEND': {
      const gs = getGroupState(state, action.groupId);
      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: {
            ...gs,
            messages: gs.messages.map(m =>
              m.id === action.localId
                ? { ...m, seq: action.seq, timestamp: action.timestamp, status: 'sent' as const }
                : m
            ),
          },
        },
      };
    }

    case 'SET_LOADING': {
      const gs = getGroupState(state, action.groupId);
      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: { ...gs, loading: action.loading },
        },
      };
    }

    case 'SET_UNREAD': {
      const gs = getGroupState(state, action.groupId);
      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: { ...gs, unreadCount: action.count },
        },
      };
    }

    case 'ACK': {
      const gs = getGroupState(state, action.groupId);
      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: {
            ...gs,
            lastAckSeq: Math.max(gs.lastAckSeq, action.seq),
            unreadCount: 0,
          },
        },
      };
    }

    case 'SET_WS_CONNECTED':
      return { ...state, wsConnected: action.connected };

    case 'CLEAR_GROUP': {
      const { [action.groupId]: _, ...rest } = state.groups;
      return { ...state, groups: rest };
    }

    default:
      return state;
  }
}

// ============ Context ============

interface GroupMessageContextType {
  state: State;
  /** 初始加载群消息 */
  loadGroupMessages: (groupId: string) => Promise<void>;
  /** 加载更多历史消息 */
  loadMoreMessages: (groupId: string) => Promise<void>;
  /** 发送群消息 */
  sendGroupMessage: (groupId: string, content: string, msgType?: string, extra?: any) => void;
  /** 确认已读 */
  ackGroup: (groupId: string) => void;
  /** 加入群在线 */
  joinGroup: (groupId: string) => void;
  /** 离开群在线 */
  leaveGroup: (groupId: string) => void;
  /** 获取群消息列表 */
  getGroupMessages: (groupId: string) => GroupMessageItem[];
  /** 获取群未读数 */
  getGroupUnread: (groupId: string) => number;
}

const GroupMessageContext = createContext<GroupMessageContextType | null>(null);

// ============ Provider ============

export function GroupMessageProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // WebSocket 连接管理
  useEffect(() => {
    if (!userId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/signal?userId=${encodeURIComponent(userId)}`;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        dispatch({ type: 'SET_WS_CONNECTED', connected: true });
        console.log('[GroupMsgCtx] WebSocket 已连接');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // 群消息推送
          if (data.type === 'group_message') {
            if (data.payload?.ack) {
              // 发送确认
              dispatch({
                type: 'CONFIRM_SEND',
                groupId: data.payload.groupId,
                localId: '', // 需要匹配
                seq: data.payload.seq,
                timestamp: data.payload.timestamp,
              });
              return;
            }

            if (data.payload?.pull) {
              // 拉取响应
              const msgs: GroupMessageItem[] = (data.payload.messages || []).map((m: any) => ({
                ...m,
                timestamp: new Date(m.createdAt).getTime(),
                status: 'delivered' as const,
              }));
              dispatch({
                type: 'APPEND_MESSAGES',
                groupId: data.payload.groupId,
                messages: msgs,
              });
              return;
            }

            // 普通推送
            const msg: GroupMessageItem = {
              id: data.id || `gm-${data.seq}`,
              seq: data.seq,
              senderId: data.senderId,
              senderName: data.senderName,
              msgType: data.msgType,
              content: data.content,
              replyToId: data.replyToId,
              extra: data.extra,
              timestamp: data.timestamp,
              status: 'delivered',
            };
            dispatch({ type: 'APPEND_MESSAGES', groupId: data.groupId, messages: [msg] });
          }

          // 批量推送
          if (data.type === 'group_message_batch') {
            const msgs: GroupMessageItem[] = (data.messages || []).map((m: any) => ({
              id: m.id || `gm-${m.seq}`,
              seq: m.seq,
              senderId: m.senderId,
              senderName: m.senderName,
              msgType: m.msgType,
              content: m.content,
              replyToId: m.replyToId,
              extra: m.extra,
              timestamp: m.timestamp,
              status: 'delivered' as const,
            }));
            dispatch({ type: 'APPEND_MESSAGES', groupId: data.groupId, messages: msgs });
          }
        } catch {
          // 忽略非群消息
        }
      };

      ws.onclose = () => {
        dispatch({ type: 'SET_WS_CONNECTED', connected: false });
        trackEvent('ws_reconnect', { groupId: userId, code: 'group_socket_closed' });
        console.log('[GroupMsgCtx] WebSocket 断开，5秒后重连...');
        reconnectTimer = setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        console.error('[GroupMsgCtx] WebSocket 错误:', err);
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    const entries = Object.entries(state.groups);
    if (entries.length === 0) return;

    void Promise.all(
      entries
        .filter(([, groupState]) => groupState.messages.length > 0)
        .map(([groupId, groupState]) => persistGroupMessages(groupId, groupState.messages, userId))
    ).catch((err) => console.error('[GroupMsgCtx] 本地群消息持久化失败:', err));
  }, [state.groups]);

  // ============ API 方法 ============

  const loadGroupMessages = useCallback(async (groupId: string) => {
    dispatch({ type: 'SET_LOADING', groupId, loading: true });
    let localLatestSeq = 0;

    try {
      const localMessages = await loadGroupMessagesFromLocalDb(groupId, userId) as GroupMessageItem[];
      localLatestSeq = Math.max(...localMessages.map((m: GroupMessageItem) => m.seq), 0);
      if (localMessages.length > 0) {
        const latestSeq = localLatestSeq;
        dispatch({
          type: 'SET_MESSAGES',
          groupId,
          messages: localMessages,
          hasMore: true,
          latestSeq,
        });
        console.log(`[GroupMsgCtx] 已从本地 NoSQL 恢复群 ${groupId} 的 ${localMessages.length} 条消息`);
      }
    } catch (err) {
      console.error('[GroupMsgCtx] 本地群消息恢复失败:', err);
    }

    try {
      const cachedLatestSeq = Math.max(localLatestSeq, stateRef.current.groups[groupId]?.latestSeq || 0);
      const params = new URLSearchParams({ groupId, userId, limit: '50' });
      if (cachedLatestSeq > 0) params.set('afterSeq', String(cachedLatestSeq));
      const resp = await fetch(`/api/group/messages?${params}`);
      if (!resp.ok) throw new Error('加载失败');
      const data = await resp.json();

      const msgs: GroupMessageItem[] = (data.messages || []).map((m: any) => ({
        ...m,
        timestamp: new Date(m.createdAt).getTime(),
        status: 'delivered' as const,
      }));

      const hasCached = localMessages.length > 0 || (stateRef.current.groups[groupId]?.messages.length || 0) > 0;
      if (cachedLatestSeq > 0 && hasCached) {
        dispatch({ type: 'APPEND_MESSAGES', groupId, messages: msgs });
        dispatch({ type: 'SET_LOADING', groupId, loading: false });
      } else {
        dispatch({
          type: 'SET_MESSAGES',
          groupId,
          messages: msgs,
          hasMore: data.hasMore,
          latestSeq: data.latestSeq,
        });
      }
    } catch (err) {
      console.error('[GroupMsgCtx] 加载消息失败:', err);
      dispatch({ type: 'SET_LOADING', groupId, loading: false });
    }
  }, [userId]);

  const loadMoreMessages = useCallback(async (groupId: string) => {
    const gs = stateRef.current.groups[groupId];
    if (!gs || gs.loading || !gs.hasMore) return;

    dispatch({ type: 'SET_LOADING', groupId, loading: true });
    try {
      const oldestSeq = gs.messages.length > 0
        ? Math.min(...gs.messages.map(m => m.seq))
        : undefined;

      const params = new URLSearchParams({ groupId, userId, limit: '50' });
      if (oldestSeq !== undefined && oldestSeq > 1) {
        params.set('beforeSeq', String(oldestSeq));
      }

      const resp = await fetch(`/api/group/messages?${params}`);
      if (!resp.ok) throw new Error('加载失败');
      const data = await resp.json();

      const msgs: GroupMessageItem[] = (data.messages || [])
        .filter((m: any) => !oldestSeq || m.seq < oldestSeq)
        .map((m: any) => ({
          ...m,
          timestamp: new Date(m.createdAt).getTime(),
          status: 'delivered' as const,
        }));

      dispatch({
        type: 'PREPEND_MESSAGES',
        groupId,
        messages: msgs,
        hasMore: data.hasMore,
      });
    } catch (err) {
      console.error('[GroupMsgCtx] 加载更多失败:', err);
      dispatch({ type: 'SET_LOADING', groupId, loading: false });
    }
  }, [userId]);

  const sendGroupMessage = useCallback((groupId: string, content: string, msgType = 'text', extra?: any) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      trackEvent('message_send_failed', { groupId, msgType, code: 'group_ws_not_open', direction: 'outbound' });
      return;
    }

    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMsg: GroupMessageItem = {
      id: localId,
      seq: 0,
      senderId: userId,
      senderName: userId,
      msgType,
      content,
      extra,
      timestamp: Date.now(),
      status: 'sending',
    };

    dispatch({ type: 'OPTIMISTIC_SEND', groupId, message: optimisticMsg });

    ws.send(JSON.stringify({
      type: 'group_send',
      payload: { groupId, content, msgType, extra },
    }));
  }, [userId]);

  const ackGroup = useCallback((groupId: string) => {
    const gs = stateRef.current.groups[groupId];
    if (!gs || gs.messages.length === 0) return;

    const maxSeq = Math.max(...gs.messages.map(m => m.seq));
    if (maxSeq <= gs.lastAckSeq) return;

    dispatch({ type: 'ACK', groupId, seq: maxSeq });

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'group_ack',
        payload: { groupId, lastAckSeq: maxSeq },
      }));
    }
  }, []);

  const joinGroup = useCallback((groupId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'group_join', payload: { groupId } }));
    }
  }, []);

  const leaveGroup = useCallback((groupId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'group_leave', payload: { groupId } }));
    }
    dispatch({ type: 'CLEAR_GROUP', groupId });
  }, []);

  const getGroupMessages = useCallback((groupId: string): GroupMessageItem[] => {
    return stateRef.current.groups[groupId]?.messages || [];
  }, []);

  const getGroupUnread = useCallback((groupId: string): number => {
    return stateRef.current.groups[groupId]?.unreadCount || 0;
  }, []);

  return (
    <GroupMessageContext.Provider value={{
      state,
      loadGroupMessages,
      loadMoreMessages,
      sendGroupMessage,
      ackGroup,
      joinGroup,
      leaveGroup,
      getGroupMessages,
      getGroupUnread,
    }}>
      {children}
    </GroupMessageContext.Provider>
  );
}

// ============ Hooks ============

export function useGroupMessages() {
  const ctx = useContext(GroupMessageContext);
  if (!ctx) throw new Error('useGroupMessages must be used within GroupMessageProvider');
  return ctx;
}

/**
 * 获取指定群的消息和操作
 */
export function useGroupChat(groupId: string) {
  const ctx = useGroupMessages();
  const groupState = ctx.state.groups[groupId];

  return {
    messages: groupState?.messages || [],
    loading: groupState?.loading || false,
    hasMore: groupState?.hasMore ?? true,
    unreadCount: groupState?.unreadCount || 0,
    latestSeq: groupState?.latestSeq || 0,
    wsConnected: ctx.state.wsConnected,
    loadMessages: () => ctx.loadGroupMessages(groupId),
    loadMore: () => ctx.loadMoreMessages(groupId),
    sendMessage: (content: string, msgType?: string, extra?: any) =>
      ctx.sendGroupMessage(groupId, content, msgType, extra),
    ack: () => ctx.ackGroup(groupId),
    join: () => ctx.joinGroup(groupId),
    leave: () => ctx.leaveGroup(groupId),
  };
}
