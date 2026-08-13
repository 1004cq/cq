/**
 * imim useE2EE Hook
 * 提供 E2EE 加密功能的 React Hook 封装
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  E2EEManager,
  type E2EEStatus,
  type SessionInfo,
  type SignalEnvelope,
  type PreKeyBundle,
} from '@/lib/e2ee';
import { trackE2EEFailure } from '@/lib/telemetry';
import { e2eeProxy } from '@/lib/e2ee/WorkerProxy';

interface UseE2EEReturn {
  /** E2EE 是否已初始化 */
  isReady: boolean;
  /** 初始化中 */
  isInitializing: boolean;
  /** E2EE 状态信息 */
  status: E2EEStatus | null;
  /** 加密消息 */
  encrypt: (peerId: string, plaintext: string) => Promise<SignalEnvelope | null>;
  /** 解密消息 */
  decrypt: (peerId: string, envelope: SignalEnvelope) => Promise<string | null>;
  /** 获取会话信息 */
  getSessionInfo: (peerId: string) => Promise<SessionInfo | null>;
  /** 获取真实远端 Bundle，不允许 Mock 回退 */
  fetchRemoteBundle: (peerId: string) => Promise<PreKeyBundle>;
  /** 建立 X3DH 会话 */
  establishSession: (peerId: string, bundle: PreKeyBundle) => Promise<void>;
  /** 客户端媒体文件加密 */
  encryptFile: (fileBuffer: ArrayBuffer) => Promise<{ ciphertext: ArrayBuffer; fileKey: string; iv: string }>;
  /** 获取 Safety Number */
  getSafetyNumber: (peerId: string) => Promise<string>;
  /** 获取本地指纹 */
  getLocalFingerprint: () => Promise<string>;
  /** 获取对端指纹 */
  getRemoteFingerprint: (peerId: string) => Promise<string>;
  /** 重置会话 */
  resetSession: (peerId: string) => Promise<void>;
  /** 刷新状态 */
  refreshStatus: () => Promise<void>;
}

export function useE2EE(): UseE2EEReturn {
  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [status, setStatus] = useState<E2EEStatus | null>(null);
  const managerRef = useRef<E2EEManager | null>(null);

  // 初始化
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (managerRef.current?.isInitialized) {
        setIsReady(true);
        return;
      }

      setIsInitializing(true);
      try {
        const manager = E2EEManager.shared();
        await manager.initialize();
        managerRef.current = manager;

        if (!cancelled) {
          setIsReady(true);
          const s = await manager.getStatus();
          setStatus(s);

          // 初始化后自动注册 Bundle 到服务器
          const userId = localStorage.getItem('user_id');
          if (userId) {
            manager.registerBundleToServer(userId).catch(err => {
              console.warn('[useE2EE] Bundle 注册失败:', err);
            });
            // 检查并补充服务端 PreKeys
            manager.checkAndReplenishServerPreKeys(userId).catch(err => {
              console.warn('[useE2EE] PreKey 补充失败:', err);
            });
          }
        }
      } catch (err) {
        console.error('[useE2EE] 初始化失败:', err);
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const encrypt = useCallback(async (peerId: string, plaintext: string): Promise<SignalEnvelope | null> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) return null;
    try {
      // 默认将 Signal X3DH/Double Ratchet 放入 Worker；只有 Worker 不可用时才降级。
      return e2eeProxy.isReady
        ? await e2eeProxy.signalEncrypt(peerId, plaintext)
        : await manager.encrypt(peerId, plaintext);
    } catch (err) {
      console.error('[useE2EE] 加密失败:', err);
      trackE2EEFailure('encrypt', { error: err, chatId: peerId, direction: 'outbound' });
      return null;
    }
  }, []);

  const decrypt = useCallback(async (peerId: string, envelope: SignalEnvelope): Promise<string | null> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) return null;
    try {
      return e2eeProxy.isReady
        ? await e2eeProxy.signalDecrypt(peerId, envelope)
        : await manager.decrypt(peerId, envelope);
    } catch (err) {
      console.error('[useE2EE] 解密失败:', err);
      trackE2EEFailure('decrypt', { error: err, chatId: peerId, direction: 'inbound' });
      return null;
    }
  }, []);

  const getSessionInfo = useCallback(async (peerId: string): Promise<SessionInfo | null> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) return null;
    return manager.getSessionInfo(peerId);
  }, []);

  const fetchRemoteBundle = useCallback(async (peerId: string): Promise<PreKeyBundle> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) throw new Error('E2EE 未初始化');
    return manager.fetchRemoteBundle(peerId);
  }, []);

  const establishSession = useCallback(async (peerId: string, bundle: PreKeyBundle): Promise<void> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) throw new Error('E2EE 未初始化');
    return manager.establishSession(peerId, bundle);
  }, []);

  const encryptFile = useCallback(async (fileBuffer: ArrayBuffer) => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) throw new Error('E2EE 未初始化');
    return e2eeProxy.isReady
      ? await e2eeProxy.signalEncryptFile(fileBuffer)
      : await manager.encryptFile(fileBuffer);
  }, []);

  const getSafetyNumber = useCallback(async (peerId: string): Promise<string> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) return '';
    return manager.getSafetyNumber(peerId);
  }, []);

  const getLocalFingerprint = useCallback(async (): Promise<string> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) return '';
    return manager.getLocalFingerprint();
  }, []);

  const getRemoteFingerprint = useCallback(async (peerId: string): Promise<string> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) return '';
    return manager.getRemoteFingerprint(peerId);
  }, []);

  const resetSession = useCallback(async (peerId: string): Promise<void> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) return;
    await manager.resetSession(peerId);
    const s = await manager.getStatus();
    setStatus(s);
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    const manager = managerRef.current;
    if (!manager?.isInitialized) return;
    const s = await manager.getStatus();
    setStatus(s);
  }, []);

  return {
    isReady,
    isInitializing,
    status,
    encrypt,
    decrypt,
    getSessionInfo,
    fetchRemoteBundle,
    establishSession,
    encryptFile,
    getSafetyNumber,
    getLocalFingerprint,
    getRemoteFingerprint,
    resetSession,
    refreshStatus,
  };
}
