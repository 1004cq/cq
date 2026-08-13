/**
 * useMLSGroup.ts — MLS 群组端到端加密 React Hook
 *
 * 提供 MLS E2EE 群组的 React 生命周期管理：
 * 1. 自动初始化 MLS 管理器
 * 2. 群组 MLS 状态同步
 * 3. 消息加密/解密接口
 * 4. 成员变更处理
 * 5. 密钥更新触发
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  MLSGroupManager,
  getMLSGroupManager,
  type MLSGroupStatus,
} from '../lib/e2ee/MLSGroupManager';
import type {
  MLSApplicationMessage,
  MLSCommit,
  MLSWelcome,
  MLSKeyPackage,
} from '../lib/e2ee/MLSCrypto';

// ============================================================
// 类型
// ============================================================

export interface UseMLSGroupOptions {
  /** 群组 ID */
  groupId: string;
  /** 当前用户 ID */
  userId: string;
  /** WebSocket 实例 */
  ws: WebSocket | null;
  /** 是否启用 MLS E2EE */
  enabled?: boolean;
}

export interface UseMLSGroupReturn {
  /** MLS 是否已初始化 */
  isReady: boolean;
  /** MLS 群组状态 */
  status: MLSGroupStatus | null;
  /** 当前 epoch */
  epoch: number;
  /** 加密消息 */
  encryptMessage: (plaintext: string) => Promise<MLSApplicationMessage | null>;
  /** 解密消息 */
  decryptMessage: (msg: MLSApplicationMessage) => Promise<string | null>;
  /** 创建 MLS 群组 */
  createMLSGroup: () => Promise<void>;
  /** 添加成员 */
  addMember: (userId: string, keyPackage: MLSKeyPackage) => Promise<void>;
  /** 移除成员 */
  removeMember: (userId: string) => Promise<void>;
  /** 更新密钥 */
  updateKeys: () => Promise<void>;
  /** 检查群组是否已启用 MLS */
  hasMLSState: boolean;
  /** 错误信息 */
  error: string | null;
}

// ============================================================
// Hook 实现
// ============================================================

export function useMLSGroup(options: UseMLSGroupOptions): UseMLSGroupReturn {
  const { groupId, userId, ws, enabled = true } = options;

  const [isReady, setIsReady] = useState(false);
  const [status, setStatus] = useState<MLSGroupStatus | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [hasMLSState, setHasMLSState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const managerRef = useRef<MLSGroupManager | null>(null);
  const initializingRef = useRef(false);

  // ============ 初始化 ============

  useEffect(() => {
    if (!enabled || !userId || !groupId || initializingRef.current) return;

    let cancelled = false;
    initializingRef.current = true;

    const init = async () => {
      try {
        const manager = getMLSGroupManager();
        managerRef.current = manager;

        // 初始化 MLS 管理器
        await manager.initialize(userId);

        // 上传 KeyPackage（如果还没有）
        await manager.uploadKeyPackage().catch(() => {});

        // 检查群组是否已有 MLS 状态
        const hasMLS = await manager.hasMLSState(groupId);

        if (!cancelled) {
          setHasMLSState(hasMLS);
          if (hasMLS) {
            const groupStatus = await manager.getGroupStatus(groupId);
            setStatus(groupStatus);
            setEpoch(groupStatus?.epoch || 0);
          }
          setIsReady(true);
          setError(null);
        }
      } catch (err: any) {
        console.error('[useMLSGroup] 初始化失败:', err);
        if (!cancelled) {
          setError(err.message || '初始化失败');
          setIsReady(false);
        }
      } finally {
        initializingRef.current = false;
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [enabled, userId, groupId]);

  // ============ WebSocket MLS 消息处理 ============

  useEffect(() => {
    if (!ws || !enabled || !isReady) return;

    const handleMessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // MLS Welcome 消息
        if (data.type === 'mls_welcome' && data.groupId === groupId) {
          const manager = managerRef.current;
          if (manager) {
            try {
              const state = await manager.processWelcome(
                data.welcome as MLSWelcome,
                data.senderIdentityKey
              );
              setHasMLSState(true);
              setEpoch(state.epoch);
              setStatus(await manager.getGroupStatus(groupId));
              console.log(`[useMLSGroup] Welcome 处理成功, epoch=${state.epoch}`);
            } catch (err) {
              console.error('[useMLSGroup] Welcome 处理失败:', err);
            }
          }
        }

        // MLS Commit 消息
        if (data.type === 'mls_commit' && data.groupId === groupId) {
          const manager = managerRef.current;
          if (manager) {
            try {
              const state = await manager.processCommit(data.commit as MLSCommit);
              setEpoch(state.epoch);
              setStatus(await manager.getGroupStatus(groupId));
              console.log(`[useMLSGroup] Commit 处理成功, epoch=${state.epoch}`);
            } catch (err) {
              console.error('[useMLSGroup] Commit 处理失败:', err);
            }
          }
        }

        // MLS 状态同步请求
        if (data.type === 'mls_sync_request' && data.groupId === groupId) {
          const manager = managerRef.current;
          if (manager) {
            const state = await manager.syncGroupState(groupId);
            if (state) {
              setHasMLSState(true);
              setEpoch(state.epoch);
              setStatus(await manager.getGroupStatus(groupId));
            }
          }
        }
      } catch {
        // 忽略非 JSON 消息
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [ws, enabled, isReady, groupId]);

  // ============ 加密消息 ============

  const encryptMessage = useCallback(async (plaintext: string): Promise<MLSApplicationMessage | null> => {
    const manager = managerRef.current;
    if (!manager || !hasMLSState) return null;

    try {
      return await manager.encryptMessage(groupId, plaintext);
    } catch (err: any) {
      console.error('[useMLSGroup] 加密失败:', err);
      setError(err.message);
      return null;
    }
  }, [groupId, hasMLSState]);

  // ============ 解密消息 ============

  const decryptMessage = useCallback(async (msg: MLSApplicationMessage): Promise<string | null> => {
    const manager = managerRef.current;
    if (!manager) return null;

    try {
      return await manager.decryptMessage(msg);
    } catch (err: any) {
      console.error('[useMLSGroup] 解密失败:', err);
      return null;
    }
  }, []);

  // ============ 创建 MLS 群组 ============

  const createMLSGroup = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager) return;

    try {
      const state = await manager.createGroup(groupId);
      setHasMLSState(true);
      setEpoch(state.epoch);
      setStatus(await manager.getGroupStatus(groupId));

      // 通知服务器群组已启用 MLS
      await fetch('/api/mls/enable-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          userId,
          epoch: state.epoch,
          treeSnapshot: state.tree.map(n => ({ publicKey: n.publicKey })),
          members: state.members,
        }),
      });

      console.log(`[useMLSGroup] 群组 ${groupId} MLS 已启用`);
    } catch (err: any) {
      console.error('[useMLSGroup] 创建 MLS 群组失败:', err);
      setError(err.message);
    }
  }, [groupId, userId]);

  // ============ 添加成员 ============

  const addMember = useCallback(async (newUserId: string, keyPackage: MLSKeyPackage) => {
    const manager = managerRef.current;
    if (!manager || !hasMLSState) return;

    try {
      const { welcome, commit } = await manager.addMember(groupId, newUserId, keyPackage);

      // 发送 Welcome 和 Commit 到服务器
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'mls_add_member',
          payload: {
            groupId,
            targetUserId: newUserId,
            welcome,
            commit,
            senderIdentityKey: manager.getIdentityPublicKey(),
          },
        }));
      }

      setEpoch(commit.epoch);
      setStatus(await manager.getGroupStatus(groupId));
    } catch (err: any) {
      console.error('[useMLSGroup] 添加成员失败:', err);
      setError(err.message);
    }
  }, [groupId, ws, hasMLSState]);

  // ============ 移除成员 ============

  const removeMember = useCallback(async (targetUserId: string) => {
    const manager = managerRef.current;
    if (!manager || !hasMLSState) return;

    try {
      const commit = await manager.removeMember(groupId, targetUserId);

      // 发送 Commit 到服务器
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'mls_remove_member',
          payload: {
            groupId,
            targetUserId,
            commit,
          },
        }));
      }

      setEpoch(commit.epoch);
      setStatus(await manager.getGroupStatus(groupId));
    } catch (err: any) {
      console.error('[useMLSGroup] 移除成员失败:', err);
      setError(err.message);
    }
  }, [groupId, ws, hasMLSState]);

  // ============ 密钥更新 ============

  const updateKeys = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager || !hasMLSState) return;

    try {
      const commit = await manager.updateKeys(groupId);

      // 发送 Commit 到服务器
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'mls_update_keys',
          payload: {
            groupId,
            commit,
          },
        }));
      }

      setEpoch(commit.epoch);
      setStatus(await manager.getGroupStatus(groupId));
    } catch (err: any) {
      console.error('[useMLSGroup] 密钥更新失败:', err);
      setError(err.message);
    }
  }, [groupId, ws, hasMLSState]);

  return {
    isReady,
    status,
    epoch,
    encryptMessage,
    decryptMessage,
    createMLSGroup,
    addMember,
    removeMember,
    updateKeys,
    hasMLSState,
    error,
  };
}
