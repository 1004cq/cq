/**
 * E2EE Web Worker — Signal & MLS 后台加解密核心。
 * Worker 只持有本设备 IndexedDB 中的密钥状态，服务器永远只接触密文。
 */

import { E2EEManager } from './E2EEManager';
import { MLSGroupManager } from './MLSGroupManager';

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

let e2eeManager: E2EEManager | null = null;
let mlsManager: MLSGroupManager | null = null;
let initializedUserId = '';

async function ensureManagers(userId?: string) {
  const effectiveUserId = userId || initializedUserId;
  if (!effectiveUserId) throw new Error('E2EE Worker 缺少 userId');

  if (!e2eeManager) {
    e2eeManager = E2EEManager.shared();
    await e2eeManager.initialize();
  }
  if (!mlsManager) {
    mlsManager = MLSGroupManager.shared();
    await mlsManager.initialize(effectiveUserId);
  }
  initializedUserId = effectiveUserId;
}

function yieldToWorker(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

ctx.onmessage = async (event: MessageEvent) => {
  const { id, type, payload } = event.data || {};

  try {
    switch (type) {
      case 'init':
        await ensureManagers(payload?.userId);
        ctx.postMessage({ id, type: 'init_ok', payload: true });
        return;

      case 'signal_encrypt':
        if (!e2eeManager) throw new Error('E2EE Worker 未初始化');
        ctx.postMessage({ id, type: 'signal_encrypt_ok', payload: await e2eeManager.encrypt(payload.peerId, payload.plaintext) });
        return;

      case 'signal_decrypt':
        if (!e2eeManager) throw new Error('E2EE Worker 未初始化');
        ctx.postMessage({ id, type: 'signal_decrypt_ok', payload: await e2eeManager.decrypt(payload.peerId, payload.envelope) });
        return;

      case 'signal_encrypt_file': {
        if (!e2eeManager) throw new Error('E2EE Worker 未初始化');
        const encrypted = await e2eeManager.encryptFile(payload.fileBuffer);
        ctx.postMessage({ id, type: 'signal_encrypt_file_ok', payload: encrypted }, [encrypted.ciphertext]);
        return;
      }

      case 'signal_batch_decrypt': {
        if (!e2eeManager) throw new Error('E2EE Worker 未初始化');
        const results: Array<{ id: string; plaintext?: string; error?: string; success: boolean }> = [];
        // 必须按消息时间顺序串行解密；Double Ratchet 不能 Promise.all 并发推进。
        for (const message of payload.messages || []) {
          try {
            const plaintext = await e2eeManager.decrypt(payload.peerId, message.envelope);
            results.push({ id: message.id, plaintext, success: true });
          } catch (error) {
            results.push({ id: message.id, error: error instanceof Error ? error.message : String(error), success: false });
          }
          // 大批量历史同步时主动让出 Worker 事件循环，避免阻塞后续控制请求。
          if (results.length % 8 === 0) await yieldToWorker();
        }
        ctx.postMessage({ id, type: 'signal_batch_decrypt_ok', payload: results });
        return;
      }

      case 'mls_has_state':
        if (!mlsManager) throw new Error('E2EE Worker 未初始化');
        ctx.postMessage({ id, type: 'mls_has_state_ok', payload: await mlsManager.hasMLSState(payload.groupId) });
        return;

      case 'mls_encrypt':
        if (!mlsManager) throw new Error('E2EE Worker 未初始化');
        ctx.postMessage({ id, type: 'mls_encrypt_ok', payload: await mlsManager.encryptMessage(payload.groupId, payload.plaintext) });
        return;

      case 'mls_decrypt':
        if (!mlsManager) throw new Error('E2EE Worker 未初始化');
        ctx.postMessage({
          id,
          type: 'mls_decrypt_ok',
          payload: await mlsManager.decryptMessage({
            groupId: payload.groupId,
            epoch: payload.epoch,
            senderLeafIndex: payload.sender,
            ciphertext: payload.ct,
            generation: payload.gen,
          }),
        });
        return;

      case 'mls_batch_decrypt': {
        if (!mlsManager) throw new Error('E2EE Worker 未初始化');
        const results: Array<{ id: string; plaintext?: string | null; error?: string; success: boolean }> = [];
        for (const message of payload.messages || []) {
          try {
            const plaintext = await mlsManager.decryptMessage({
              groupId: payload.groupId,
              epoch: message.epoch,
              senderLeafIndex: message.sender,
              ciphertext: message.ct,
              generation: message.gen,
            });
            results.push({ id: message.id, plaintext, success: plaintext != null });
          } catch (error) {
            results.push({ id: message.id, error: error instanceof Error ? error.message : String(error), success: false });
          }
          if (results.length % 8 === 0) await yieldToWorker();
        }
        ctx.postMessage({ id, type: 'mls_batch_decrypt_ok', payload: results });
        return;
      }

      case 'reset':
        if (e2eeManager) await e2eeManager.resetAll();
        if (mlsManager) await mlsManager.resetAll();
        e2eeManager = null;
        mlsManager = null;
        initializedUserId = '';
        ctx.postMessage({ id, type: 'reset_ok', payload: true });
        return;

      default:
        throw new Error(`Unknown E2EE Worker task: ${type}`);
    }
  } catch (error) {
    ctx.postMessage({ id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
