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
    setMessages(prev => {
      // 去重（基于 seq）
      const existingSeqs = new Set(prev.map(m => m.seq));
      const newMsgs = batch.filter(m => !existingSeqs.has(m.seq));
      if (newMsgs.length === 0) return prev;

      let merged = [...prev, ...newMsgs].sort((a, b) => a.seq - b.seq);

      // 内存淘汰：保留最新的 maxMessagesInMemory 条
      if (merged.length > maxMessagesInMemory) {
        merged = merged.slice(merged.length - maxMessagesInMemory);
        setHasMore(true); // 淘汰了旧消息，可以继续加载
      }

      return merged;
    });
  }, [maxMessagesInMemory]);

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

  const persistLastSeq = useCallback((seq: number) => {
    if (!groupId || !userId || seq <= 0) return;
    try {
      localStorage.setItem(lastSeqStorageKey, String(seq));
    } catch {
      // localStorage 不可用时不影响实时消息
    }
  }, [groupId, userId, lastSeqStorageKey]);

  // ============ 初始加载 ============

  const loadInitial = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const msgs = await pullMessages();
      setMessages(msgs);
      let initialSeq = 0;
      try {
        initialSeq = Number(localStorage.getItem(lastSeqStorageKey) || 0);
      } catch {
        initialSeq = 0;
      }
      if (msgs.length > 0) {
        initialSeq = Math.max(initialSeq, msgs[msgs.length - 1].seq);
      }
      localSeqRef.current = initialSeq;
      persistLastSeq(initialSeq);
    } finally {
      setLoading(false);
    }
  }, [enabled, pullMessages, lastSeqStorageKey, persistLastSeq]);

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

      const olderMsgs: GroupMessage[] = (data.messages || [])
        .filter((m: any) => m.seq < (oldestSeq ?? Infinity))
        .map((m: any) => ({
          ...m,
          timestamp: new Date(m.createdAt).getTime(),
          status: 'delivered' as const,
        }));

      if (olderMsgs.length === 0) {
        setHasMore(false);
      } else {
        setMessages(prev => {
          const existingSeqs = new Set(prev.map(m => m.seq));
          const newMsgs = olderMsgs.filter(m => !existingSeqs.has(m.seq));
          return [...newMsgs, ...prev].sort((a, b) => a.seq - b.seq);
        });
      }
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, groupId, userId, pageSize]);

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
            const pullMsgs: GroupMessage[] = (data.payload.messages || []).map((m: any) => ({
              ...m,
              timestamp: new Date(m.createdAt).getTime(),
              status: 'delivered' as const,
            }));
            if (pullMsgs.length > 0) {
              handleBatchMessages(pullMsgs);
            }
            setHasMore(data.payload.hasMore);
            setLatestSeq(data.payload.latestSeq);
            return;
          }

          // 普通推送消息
          let msgContent = data.content;
          let mlsEncrypted = false;
          let mlsEpoch: number | undefined;
          let mlsDecryptFailed = false;
          let displayMsgType = data.msgType;

          // MLS E2EE 解密：检查是否为加密消息
          if (data.msgType === 'mls_encrypted' || (data.extra?.mlsEncrypted)) {
            try {
              const parsed = JSON.parse(data.content);
              if (parsed._mls) {
                const { MLSGroupManager } = await import('../lib/e2ee/MLSGroupManager');
                const mlsManager = MLSGroupManager.shared();
                if (mlsManager.isInitialized) {
                  const decrypted = await mlsManager.decryptMessage({
                    groupId,
                    epoch: parsed.epoch,
                    senderLeafIndex: parsed.sender,
                    ciphertext: parsed.ct,
                    generation: parsed.gen,
                  });
                  if (decrypted) {
                    msgContent = decrypted;
                    mlsEncrypted = true;
                    mlsEpoch = parsed.epoch;
                    displayMsgType = 'text'; // 解密后恢复原始类型
                    console.log(`[MLS] 消息已解密, epoch=${parsed.epoch}`);
                  }
                }
              }
            } catch (err) {
              console.warn('[MLS] 解密失败:', err);
              msgContent = '🔒 加密消息（无法解密）';
              mlsEncrypted = true;
              mlsDecryptFailed = true;
            }
          }

          const msg: GroupMessage = {
            id: data.id || `gm-${data.seq}`,
            seq: data.seq,
            senderId: data.senderId,
            senderName: data.senderName,
            senderAvatar: data.senderAvatar,
            msgType: displayMsgType,
            content: msgContent,
            replyToId: data.replyToId,
            extra: data.extra,
            timestamp: data.timestamp,
            status: 'delivered',
            mlsEncrypted,
            mlsEpoch,
            mlsDecryptFailed,
          };

          // 通过合并器处理
          batcherRef.current?.add(msg);
          localSeqRef.current = Math.max(localSeqRef.current, msg.seq);
          persistLastSeq(localSeqRef.current);

          // 触发新消息回调（用于更新会话列表）
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
        // 批量群消息推送
        if (data.type === 'group_message_batch' && data.groupId === groupId) {
          const batchMsgs: GroupMessage[] = (data.messages || []).map((m: any) => ({
            id: m.id || `gm-${m.seq}`,
            seq: m.seq,
            senderId: m.senderId,
            senderName: m.senderName,
            senderAvatar: m.senderAvatar,
            msgType: m.msgType,
            content: m.content,
            replyToId: m.replyToId,
            extra: m.extra,
            timestamp: m.timestamp,
            status: 'delivered' as const,
          }));

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

    // MLS E2EE 加密：尝试加密消息内容
    let finalContent = content;
    let mlsEncrypted = false;
    let mlsEpoch: number | undefined;
    let mlsPayload: any = null;

    try {
      const { MLSGroupManager } = await import('../lib/e2ee/MLSGroupManager');
      const mlsManager = MLSGroupManager.shared();
      if (mlsManager.isInitialized) {
        const hasMLS = await mlsManager.hasMLSState(groupId);
        if (hasMLS) {
          const appMsg = await mlsManager.encryptMessage(groupId, content);
          if (appMsg) {
            // 加密成功：将加密负载序列化为 content
            finalContent = JSON.stringify({
              _mls: true,
              epoch: appMsg.epoch,
              sender: appMsg.senderLeafIndex,
              gen: appMsg.generation,
              ct: appMsg.ciphertext,
            });
            mlsEncrypted = true;
            mlsEpoch = appMsg.epoch;
            mlsPayload = appMsg;
            console.log(`[MLS] 消息已加密, epoch=${appMsg.epoch}, gen=${appMsg.generation}`);
          }
        }
      }
    } catch (err) {
      console.warn('[MLS] 加密失败，回退明文发送:', err);
    }

    // 乐观更新：立即显示在列表中（显示明文）
    const optimisticMsg: GroupMessage = {
      id: localId,
      localId,
      seq: 0,
      senderId: userId,
      senderName,
      senderAvatar,
      msgType: mlsEncrypted ? 'mls_encrypted' : msgType,
      content, // 本地显示明文
      extra,
      timestamp: Date.now(),
      status: 'sending',
      mlsEncrypted,
      mlsEpoch,
    };

    setMessages(prev => [...prev, optimisticMsg]);

    // 通过 WebSocket 发送（加密后的内容）
    ws.send(JSON.stringify({
      type: 'group_send',
      payload: {
        groupId,
        content: finalContent,
        msgType: mlsEncrypted ? 'mls_encrypted' : msgType,
        extra: mlsEncrypted ? { ...extra, mlsEncrypted: true, mlsEpoch } : extra,
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
