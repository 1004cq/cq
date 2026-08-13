/**
 * 万人群消息增量同步 Hook
 *
 * 核心优化：
 * 1. 增量同步：通过 seq 游标只拉取新消息，避免全量加载
 * 2. 消息合并：高频消息批量处理，减少 React 渲染次数
 * 3. 离线补偿：重连后自动补拉离线期间的消息
 * 4. 双通道：WebSocket 实时推送 + HTTP 拉取兜底
 * 5. 内存管理：超过阈值自动淘汰旧消息，保持内存稳定
 * 6. localId 匹配：发送消息时携带 localId，ACK 回传后精确匹配乐观消息
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { CURRENT_USER } from '@/lib/store';
import { e2eeProxy } from '@/lib/e2ee/WorkerProxy';
import {
  loadGroupMessagesFromLocalDb,
  persistGroupMessages,
  loadSyncState,
  updateSyncState,
} from '@/lib/localdb';

// ============ 类型定义 ============

export interface GroupMessage {
  id: string;
  seq: number;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  msgType: string;
  content: string;
  replyToId?: string;
  extra?: any;
  timestamp: number;
  isRevoked?: boolean;
  /** 客户端状态 */
  status?: 'sending' | 'sent' | 'delivered' | 'failed';
  /** 本地临时 ID（用于 ACK 匹配） */
  localId?: string;
  /** MLS E2EE 加密标记 */
  mlsEncrypted?: boolean;
  /** MLS epoch（加密时的 epoch） */
  mlsEpoch?: number;
  /** MLS 解密失败标记 */
  mlsDecryptFailed?: boolean;
  /** 本地展示副本的解密状态 */
  decryptionStatus?: 'decrypted' | 'ciphertext' | 'failed' | 'legacy';
}

interface UseGroupSyncOptions {
  /** 群组 ID */
  groupId: string;
  /** 当前用户 ID */
  userId: string;
  /** WebSocket 实例 */
  ws: WebSocket | null;
  /** 是否启用（进入聊天页面时启用） */
  enabled?: boolean;
  /** 每页拉取条数 */
  pageSize?: number;
  /** 内存中最大消息数（超过自动淘汰旧消息） */
  maxMessagesInMemory?: number;
  /** 群消息变更回调（用于更新会话列表的最后消息等） */
  onNewMessage?: (msg: GroupMessage) => void;
}

// ============ 消息合并器 ============

class MessageBatcher {
  private buffer: GroupMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private callback: (messages: GroupMessage[]) => void;
  private windowMs: number;
  private maxBatch: number;

  constructor(
    callback: (messages: GroupMessage[]) => void,
    windowMs = 100,
    maxBatch = 20
  ) {
    this.callback = callback;
    this.windowMs = windowMs;
    this.maxBatch = maxBatch;
  }

  add(msg: GroupMessage) {
    this.buffer.push(msg);
    if (this.buffer.length >= this.maxBatch) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const batch = [...this.buffer];
      this.buffer = [];
      this.callback(batch);
    }
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.buffer = [];
  }
}

function normalizeGroupMessage(raw: any): GroupMessage {
  return {
    id: raw.id || `gm-${raw.seq}`,
    seq: Number(raw.seq || 0),
    senderId: raw.senderId,
    senderName: raw.senderName || raw.senderId,
    senderAvatar: raw.senderAvatar,
    msgType: raw.msgType || 'text',
    content: raw.content || '',
    replyToId: raw.replyToId,
    extra: raw.extra,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : new Date(raw.createdAt || Date.now()).getTime(),
    isRevoked: raw.isRevoked,
    status: raw.status || 'delivered',
  };
}

async function decryptGroupBatch(groupId: string, userId: string, rawMessages: any[]): Promise<GroupMessage[]> {
  const normalized = rawMessages.map(normalizeGroupMessage);
  const encrypted = normalized
    .filter(message => !message.isRevoked && (message.msgType === 'mls_encrypted' || message.extra?.mlsEncrypted))
    .map(message => {
      try {
        const envelope = JSON.parse(message.content);
        if (!envelope?._mls) throw new Error('invalid_mls_envelope');
        return {
          id: message.id,
          epoch: Number(envelope.epoch),
          sender: Number(envelope.sender),
          ct: envelope.ct,
          gen: Number(envelope.gen),
        };
      } catch {
        return null;
      }
    })
    .filter((message): message is { id: string; epoch: number; sender: number; ct: any; gen: number } => !!message);

  const resultById = new Map<string, { success: boolean; plaintext?: string | null; error?: string }>();
  if (encrypted.length > 0) {
    if (e2eeProxy.isReady) {
      const results = await e2eeProxy.mlsBatchDecrypt(groupId, encrypted);
      for (const result of results) resultById.set(result.id, result);
    } else {
      const { MLSGroupManager } = await import('@/lib/e2ee/MLSGroupManager');
      const manager = MLSGroupManager.shared();
      if (!manager.isInitialized) await manager.initialize(userId);
      for (const item of encrypted) {
        try {
          const plaintext = await manager.decryptMessage({
            groupId,
            epoch: item.epoch,
            senderLeafIndex: item.sender,
            ciphertext: item.ct,
            generation: item.gen,
          });
          resultById.set(item.id, { success: true, plaintext });
        } catch (error) {
          resultById.set(item.id, { success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }

  return normalized.map(message => {
    if (message.isRevoked) return { ...message, content: '消息已撤回' };
    const isMLS = message.msgType === 'mls_encrypted' || message.extra?.mlsEncrypted;
    if (!isMLS) {
      return message.msgType === 'system'
        ? message
        : { ...message, content: '⚠️ [不支持的旧明文群消息]', mlsDecryptFailed: true, decryptionStatus: 'legacy' };
    }

    const result = resultById.get(message.id);
    if (!result?.success || !result.plaintext) {
      return {
        ...message,
        content: '🔒 加密消息（无法解密，请等待群安全会话同步）',
        mlsEncrypted: true,
        mlsDecryptFailed: true,
        mlsEpoch: message.extra?.mlsEpoch,
        decryptionStatus: 'failed',
      };
    }

    try {
      const application = JSON.parse(result.plaintext);
      const isStructured = application && typeof application === 'object' && 'content' in application;
      return {
        ...message,
        content: isStructured ? String(application.content ?? '') : result.plaintext,
        msgType: isStructured ? String(application.msgType || 'text') : 'text',
        extra: isStructured ? application.extra : message.extra,
        mlsEncrypted: true,
        mlsEpoch: message.extra?.mlsEpoch,
        mlsDecryptFailed: false,
        decryptionStatus: 'decrypted',
      };
    } catch {
      // 兼容早期只加密 content 的 MLS 消息；它仍然是密文解开后的内容。
      return {
        ...message,
        content: result.plaintext,
        msgType: 'text',
        mlsEncrypted: true,
        mlsDecryptFailed: false,
        decryptionStatus: 'decrypted',
      };
    }
  });
}

// ============ Hook 实现 ============

export function useGroupSync(options: UseGroupSyncOptions) {
  const {
    groupId,
    userId,
    ws,
    enabled = true,
    pageSize = 50,
    maxMessagesInMemory = 2000,
    onNewMessage,
  } = options;

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestSeq, setLatestSeq] = useState(0);

  const lastAckSeqRef = useRef(0);
  const localSeqRef = useRef(0);
  const lastPullAtRef = useRef(0);
  const batcherRef = useRef<MessageBatcher | null>(null);
  const messagesRef = useRef<GroupMessage[]>([]);
  const onNewMessageRef = useRef(onNewMessage);
  onNewMessageRef.current = onNewMessage;

  // 保持 messagesRef 同步
  messagesRef.current = messages;

  // ============ 消息合并处理 ============

  const handleBatchMessages = useCallback((batch: GroupMessage[]) => {
    const existingSeqs = new Set(messagesRef.current.map(m => m.seq));
    const newMsgs = batch.filter(m => !existingSeqs.has(m.seq));
    if (newMsgs.length === 0) return;

    // 本地只保存已经完成展示态转换的副本，不把业务明文发回服务器。
    void persistGroupMessages(groupId, newMsgs, userId).catch(error => {
      console.warn('[GroupSync] 本地群消息缓存失败:', error);
    });

    setMessages(prev => {
      const currentSeqs = new Set(prev.map(m => m.seq));
      const unique = newMsgs.filter(m => !currentSeqs.has(m.seq));
      if (unique.length === 0) return prev;
      let merged = [...prev, ...unique].sort((a, b) => a.seq - b.seq);

      if (merged.length > maxMessagesInMemory) {
        merged = merged.slice(merged.length - maxMessagesInMemory);
        setHasMore(true);
      }
      return merged;
    });
  }, [groupId, userId, maxMessagesInMemory]);

  // 初始化消息合并器
  useEffect(() => {
    batcherRef.current = new MessageBatcher(handleBatchMessages, 100, 20);
    return () => {
      batcherRef.current?.destroy();
    };
  }, [handleBatchMessages]);

  // ============ HTTP 拉取消息 ============

  const pullMessages = useCallback(async (afterSeq?: number): Promise<GroupMessage[]> => {
    try {
      const params = new URLSearchParams({
        groupId,
        userId,
        limit: String(pageSize),
      });
      if (afterSeq !== undefined) {
        params.set('afterSeq', String(afterSeq));
      }

      const resp = await fetch(`/api/group/messages?${params}`);
      if (!resp.ok) throw new Error('拉取失败');

      const data = await resp.json();
      setHasMore(data.hasMore);
      setLatestSeq(data.latestSeq);

      return (data.messages || []).map((m: any) => ({
        ...m,
        timestamp: new Date(m.createdAt).getTime(),
        status: 'delivered' as const,
      }));
    } catch (err) {
      console.error('[GroupSync] 拉取消息失败:', err);
      return [];
    }
  }, [groupId, userId, pageSize]);

  const lastSeqStorageKey = `cqim:last-seq:${groupId}:${userId}`;
  const syncStateId = `group:${groupId}:${userId}`;

  const persistLastSeq = useCallback((seq: number) => {
    if (!groupId || !userId || seq <= 0) return;
    try {
      localStorage.setItem(lastSeqStorageKey, String(seq));
    } catch {
      // localStorage 不可用时不影响实时消息
    }
    void updateSyncState({
      id: syncStateId,
      scope: 'group',
      ownerId: userId,
      cursor: String(seq),
      updatedAt: Date.now(),
    }).catch(() => {});
  }, [groupId, userId, lastSeqStorageKey, syncStateId]);

  // ============ 初始加载 ============

  const loadInitial = useCallback(async () => {
    if (!enabled || !groupId || !userId) return;
    setLoading(true);
    try {
      const [localMessages, syncState] = await Promise.all([
        loadGroupMessagesFromLocalDb(groupId, userId),
        loadSyncState(syncStateId),
      ]);
      const cached = localMessages as GroupMessage[];
      if (cached.length > 0) {
        const visibleCached = cached.slice(-maxMessagesInMemory);
        setMessages(visibleCached);
        messagesRef.current = visibleCached;
      }

      let initialSeq = Number(syncState?.cursor || 0);
      try {
        initialSeq = Math.max(initialSeq, Number(localStorage.getItem(lastSeqStorageKey) || 0));
      } catch {
        // 使用 IndexedDB cursor
      }
      if (cached.length > 0) initialSeq = Math.max(initialSeq, cached[cached.length - 1].seq);
      localSeqRef.current = initialSeq;

      // 只拉本地最后一条之后的新消息；无缓存时由服务端返回最近一页。
      const pulled = await pullMessages(initialSeq > 0 ? initialSeq : undefined);
      if (pulled.length > 0) {
        const decrypted = await decryptGroupBatch(groupId, userId, pulled);
        handleBatchMessages(decrypted);
        const newestSeq = Math.max(initialSeq, ...decrypted.map(message => message.seq));
        localSeqRef.current = newestSeq;
        persistLastSeq(newestSeq);
      } else if (initialSeq > 0) {
        persistLastSeq(initialSeq);
      }
    } catch (error) {
      console.error('[GroupSync] 初始化失败:', error);
    } finally {
      setLoading(false);
    }
  }, [enabled, groupId, userId, pullMessages, syncStateId, lastSeqStorageKey, maxMessagesInMemory, handleBatchMessages, persistLastSeq]);

  // 首次进入加载
  useEffect(() => {
    if (enabled && groupId) {
      loadInitial();
    }
    return () => {
      setMessages([]);
      localSeqRef.current = 0;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, enabled]);

  // ============ 加载更多历史消息 ============

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const currentMessages = messagesRef.current;
      const oldestSeq = currentMessages.length > 0
        ? Math.min(...currentMessages.map(m => m.seq)) - 1
        : undefined;

      // 拉取更早的消息（反向分页）
      const params = new URLSearchParams({
        groupId,
        userId,
        limit: String(pageSize),
      });
      // 拉取 seq < oldestSeq 的消息
      if (oldestSeq !== undefined && oldestSeq > 0) {
        // 使用 afterSeq=0 并限制到 oldestSeq 之前
        params.set('afterSeq', String(Math.max(0, oldestSeq - pageSize)));
        params.set('limit', String(pageSize));
      }

      const resp = await fetch(`/api/group/messages?${params}`);
      if (!resp.ok) throw new Error('拉取失败');
      const data = await resp.json();

      const olderRaw = (data.messages || [])
        .filter((m: any) => m.seq < (oldestSeq ?? Infinity));
      const olderMsgs = await decryptGroupBatch(groupId, userId, olderRaw);

      if (olderMsgs.length === 0) {
        setHasMore(false);
      } else {
        handleBatchMessages(olderMsgs);
      }
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, groupId, userId, pageSize, handleBatchMessages]);

  // ============ WebSocket 实时消息处理 ============

  useEffect(() => {
    if (!ws || !enabled) return;

    const handleWsMessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // 单条群消息推送
        if (data.type === 'group_message' && data.groupId === groupId) {
          // ACK 响应（包含 localId 用于精确匹配）
          if (data.payload?.ack) {
            const { seq, localId, error } = data.payload;
            if (error) {
              // 发送失败
              setMessages(prev => prev.map(m =>
                m.localId && m.localId === localId
                  ? { ...m, status: 'failed' as const }
                  : m
              ));
            } else {
              // 发送成功：通过 localId 精确匹配乐观消息
              setMessages(prev => prev.map(m =>
                m.localId && m.localId === localId
                  ? { ...m, seq, status: 'sent' as const, timestamp: data.payload.timestamp || m.timestamp }
                  : m
              ));
            }
            return;
          }

          // 拉取响应
          if (data.payload?.pull) {
            const pullMsgs = await decryptGroupBatch(groupId, userId, data.payload.messages || []);
            if (pullMsgs.length > 0) {
              handleBatchMessages(pullMsgs);
              localSeqRef.current = Math.max(localSeqRef.current, ...pullMsgs.map(message => message.seq));
              persistLastSeq(localSeqRef.current);
            }
            setHasMore(data.payload.hasMore);
            setLatestSeq(data.payload.latestSeq);
            return;
          }

          // 普通推送消息：统一交给 Worker 串行解密。
          const [msg] = await decryptGroupBatch(groupId, userId, [data]);
          if (!msg) return;

          batcherRef.current?.add(msg);
          localSeqRef.current = Math.max(localSeqRef.current, msg.seq);
          persistLastSeq(localSeqRef.current);
          onNewMessageRef.current?.(msg);
        }

        // ===== 群聊撤回通知 =====
        if (data.type === 'group_recall_notify') {
          const { groupId: rGroupId, messageId: revokedId } = data.payload || {};
          if (rGroupId === groupId && revokedId) {
            setMessages(prev => prev.map(m =>
              m.id === revokedId
                ? { ...m, isRevoked: true, content: '消息已撤回' }
                : m
            ));
          }
          return;
        }
        // 批量群消息推送：Worker 内按 seq 顺序解密，禁止明文透传。
        if (data.type === 'group_message_batch' && data.groupId === groupId) {
          const batchMsgs = await decryptGroupBatch(groupId, userId, data.messages || []);
          handleBatchMessages(batchMsgs);
          if (batchMsgs.length > 0) {
            localSeqRef.current = Math.max(
              localSeqRef.current,
              Math.max(...batchMsgs.map(m => m.seq))
            );
            persistLastSeq(localSeqRef.current);
            // 触发最后一条消息回调
            onNewMessageRef.current?.(batchMsgs[batchMsgs.length - 1]);
          }
        }
      } catch {
        // 忽略非 JSON 消息
      }

      // ★ 用户资料实时更新：也通过 addEventListener 处理
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'user_profile_updated') {
          const { userId, nickname, avatar, username, bio, backgroundUrl, updatedAt } = msg.payload || {};
          if (userId) {
            window.dispatchEvent(new CustomEvent('cqim:remote-user-profile-updated', {
              detail: { userId, nickname, avatar, username, bio, backgroundUrl, updatedAt },
            }));
          }
        }
      } catch {
        // 忽略
      }
    };

    ws.addEventListener('message', handleWsMessage);
    return () => {
      ws.removeEventListener('message', handleWsMessage);
    };
  }, [ws, enabled, groupId, handleBatchMessages, persistLastSeq]);

  // ============ 加入/离开群在线列表 ============

  useEffect(() => {
    if (!ws || !enabled || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'group_join',
      payload: { groupId },
    }));

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'group_leave',
          payload: { groupId },
        }));
      }
    };
  }, [ws, enabled, groupId]);

  // ============ 发送消息 ============

  const sendMessage = useCallback(async (content: string, msgType = 'text', extra?: any) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // 生成唯一 localId 用于 ACK 匹配
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 获取当前用户的昵称和头像
    const senderName = CURRENT_USER.name || userId;
    const senderAvatar = CURRENT_USER.avatar || '';

    // 系统事件可明文；所有业务消息必须把正文、类型和扩展字段整体封装进 MLS。
    const isSystemMessage = msgType === 'system';
    let finalContent = content;
    let mlsEncrypted = false;
    let mlsEpoch: number | undefined;

    if (!isSystemMessage) {
      try {
        const applicationPayload = JSON.stringify({ content, msgType, extra });
        let appMsg: any;
        if (e2eeProxy.isReady) {
          const hasMLS = await e2eeProxy.mlsHasState(groupId);
          if (!hasMLS) throw new Error('群安全会话尚未建立或未就绪 (MLS State Missing)');
          appMsg = await e2eeProxy.mlsEncrypt(groupId, applicationPayload);
        } else {
          const { MLSGroupManager } = await import('@/lib/e2ee/MLSGroupManager');
          const mlsManager = MLSGroupManager.shared();
          if (!mlsManager.isInitialized) await mlsManager.initialize(userId);
          const hasMLS = await mlsManager.hasMLSState(groupId);
          if (!hasMLS) throw new Error('群安全会话尚未建立或未就绪 (MLS State Missing)');
          appMsg = await mlsManager.encryptMessage(groupId, applicationPayload);
        }
        if (!appMsg) throw new Error('MLS 消息加密生成失败');
        finalContent = JSON.stringify({
          _mls: true,
          epoch: appMsg.epoch,
          sender: appMsg.senderLeafIndex,
          gen: appMsg.generation,
          ct: appMsg.ciphertext,
        });
        mlsEncrypted = true;
        mlsEpoch = appMsg.epoch;
      } catch (err: any) {
        console.error('[MLS] 强制加密失败，阻断发送:', err.message);
        onNewMessageRef.current?.({
          id: localId,
          localId,
          seq: 0,
          senderId: userId,
          senderName,
          senderAvatar,
          msgType: 'system',
          content: `❌ 发送失败: ${err.message || '群安全会话未就绪'}`,
          timestamp: Date.now(),
          status: 'failed',
        } as any);
        return;
      }
    }

    // 乐观更新：立即显示在列表中（显示明文）
    const optimisticMsg: GroupMessage = {
      id: localId,
      localId,
      seq: 0,
      senderId: userId,
      senderName,
      senderAvatar,
      msgType,
      content,
      extra,
      timestamp: Date.now(),
      status: 'sending',
      mlsEncrypted,
      mlsEpoch,
      decryptionStatus: 'decrypted',
    };

    setMessages(prev => [...prev, optimisticMsg]);
    void persistGroupMessages(groupId, [optimisticMsg], userId).catch(() => {});

    // 通过 WebSocket 发送：业务消息只有 mls_encrypted，系统消息才允许 system。
    ws.send(JSON.stringify({
      type: 'group_send',
      payload: {
        groupId,
        content: finalContent,
        msgType: isSystemMessage ? 'system' : 'mls_encrypted',
        extra: isSystemMessage ? extra : { mlsEncrypted: true, mlsEpoch },
        localId,
        senderName,
      },
    }));

    // 触发新消息回调
    onNewMessageRef.current?.(optimisticMsg);
  }, [ws, groupId, userId]);

  // ============ 撤回群消息 ============

  const recallMessage = useCallback((messageId: string, seq: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // 本地乐观更新
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, isRevoked: true, content: '消息已撤回' } : m
    ));
    // 通知服务器
    ws.send(JSON.stringify({
      type: 'group_recall',
      payload: { groupId, messageId, seq },
    }));
  }, [ws, groupId]);

  // ============ 确认已读 ============

  const ackMessages = useCallback((seq?: number) => {
    const ackSeq = seq || localSeqRef.current;
    if (ackSeq <= lastAckSeqRef.current) return;

    lastAckSeqRef.current = ackSeq;

    // 通过 WebSocket 发送 ACK
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'group_ack',
        payload: { groupId, lastAckSeq: ackSeq },
      }));
    }

    setUnreadCount(0);
  }, [ws, groupId]);

  // ============ 离线补偿（重连后按 lastSeq 自动补拉） ============

  useEffect(() => {
    if (!enabled || !groupId) return;

    const pullAfterReconnect = (candidate?: WebSocket | null) => {
      const activeWs = candidate || ws;
      const lastSeq = localSeqRef.current;
      if (!activeWs || activeWs.readyState !== WebSocket.OPEN || lastSeq <= 0) return;

      // 同一次重连可能同时触发 open 与全局事件，避免重复补拉
      const now = Date.now();
      if (now - lastPullAtRef.current < 500) return;
      lastPullAtRef.current = now;
      activeWs.send(JSON.stringify({
        type: 'group_pull',
        payload: { groupId, lastSeq, limit: 100 },
      }));
    };

    const handleOpen = () => pullAfterReconnect(ws);
    const handleGlobalOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ ws?: WebSocket }>).detail;
      pullAfterReconnect(detail?.ws || null);
    };

    ws?.addEventListener('open', handleOpen);
    window.addEventListener('cqim:signal-open', handleGlobalOpen);
    return () => {
      ws?.removeEventListener('open', handleOpen);
      window.removeEventListener('cqim:signal-open', handleGlobalOpen);
    };
  }, [ws, enabled, groupId]);

  return {
    /** 当前群消息列表（已排序） */
    messages,
    /** 是否正在加载 */
    loading,
    /** 是否有更多历史消息 */
    hasMore,
    /** 未读消息数 */
    unreadCount,
    /** 群最新 seq */
    latestSeq,
    /** 加载更多历史消息 */
    loadMore,
    /** 发送消息 */
    sendMessage,
    /** 确认已读 */
    ackMessages,
    /** 撤回群消息 */
    recallMessage,
    /** 重新加载 */
    reload: loadInitial,
  };
}
