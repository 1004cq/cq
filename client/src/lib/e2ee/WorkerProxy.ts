/**
 * E2EE Worker Proxy — 主线程 RPC 代理
 *
 * 所有 Signal/MLS 重计算通过单队列串行执行，避免 Double Ratchet 和 MLS
 * 状态在多个异步任务之间发生竞态；Worker 不可用时由调用方安全降级到主线程。
 */

import type { SignalEnvelope } from './E2EEManager';

type PendingTask = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const RPC_TIMEOUT_MS = 30_000;

export class WorkerProxy {
  private worker: Worker | null = null;
  private pendingTasks = new Map<string, PendingTask>();
  private static _instance: WorkerProxy | null = null;
  private taskQueue: Promise<unknown> = Promise.resolve();
  private initPromise: Promise<void> | null = null;
  private ready = false;

  static shared(): WorkerProxy {
    if (!WorkerProxy._instance) {
      WorkerProxy._instance = new WorkerProxy();
    }
    return WorkerProxy._instance;
  }

  private constructor() {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      this.initWorker();
    }
  }

  private initWorker() {
    try {
      this.worker = new Worker(new URL('./e2ee.worker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event: MessageEvent) => {
        const { id, type, payload, error } = event.data || {};
        const task = this.pendingTasks.get(id);
        if (!task) return;

        clearTimeout(task.timeout);
        this.pendingTasks.delete(id);
        if (type === 'error') {
          task.reject(new Error(typeof error === 'string' ? error : 'E2EE Worker error'));
        } else {
          task.resolve(payload);
        }
      };

      this.worker.onerror = (event) => {
        const error = new Error(event.message || 'E2EE Worker crashed');
        this.ready = false;
        this.initPromise = null;
        for (const task of this.pendingTasks.values()) {
          clearTimeout(task.timeout);
          task.reject(error);
        }
        this.pendingTasks.clear();
        console.error('[E2EE Worker Proxy] Worker error:', event.message || event);
      };
    } catch (error) {
      this.worker = null;
      console.warn('[E2EE Worker Proxy] Worker unavailable, using main-thread fallback:', error);
    }
  }

  private dispatch<T>(type: string, payload?: unknown, transfer: Transferable[] = []): Promise<T> {
    if (!this.worker) {
      return Promise.reject(new Error('E2EE Worker not available'));
    }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTasks.delete(id);
        reject(new Error(`E2EE Worker timeout: ${type}`));
      }, RPC_TIMEOUT_MS);

      this.pendingTasks.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this.worker!.postMessage({ id, type, payload }, transfer);
    });
  }

  /** 串行化密钥状态更新，尤其是 Double Ratchet/MLS decrypt。 */
  private callWorker<T>(type: string, payload?: unknown, transfer: Transferable[] = []): Promise<T> {
    const run = () => this.dispatch<T>(type, payload, transfer);
    const result = this.taskQueue.then(run, run);
    this.taskQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async init(userId: string): Promise<void> {
    if (!this.worker) throw new Error('E2EE Worker not available');
    if (this.ready) return;
    if (!this.initPromise) {
      this.initPromise = this.callWorker<void>('init', { userId })
        .then(() => {
          this.ready = true;
        })
        .catch((error) => {
          this.initPromise = null;
          this.ready = false;
          throw error;
        });
    }
    return this.initPromise;
  }

  async signalEncrypt(peerId: string, plaintext: string): Promise<SignalEnvelope> {
    return this.callWorker<SignalEnvelope>('signal_encrypt', { peerId, plaintext });
  }

  async signalDecrypt(peerId: string, envelope: SignalEnvelope): Promise<string> {
    return this.callWorker<string>('signal_decrypt', { peerId, envelope });
  }

  async signalEncryptFile(fileBuffer: ArrayBuffer): Promise<{ ciphertext: ArrayBuffer; fileKey: string; iv: string }> {
    return this.callWorker('signal_encrypt_file', { fileBuffer }, [fileBuffer]);
  }

  async signalBatchDecrypt(peerId: string, messages: Array<{ id: string; envelope: SignalEnvelope }>): Promise<Array<{ id: string; plaintext?: string; error?: string; success: boolean }>> {
    return this.callWorker('signal_batch_decrypt', { peerId, messages });
  }

  async mlsHasState(groupId: string): Promise<boolean> {
    return this.callWorker<boolean>('mls_has_state', { groupId });
  }

  async mlsEncrypt(groupId: string, plaintext: string): Promise<any> {
    return this.callWorker('mls_encrypt', { groupId, plaintext });
  }

  async mlsDecrypt(groupId: string, data: { epoch: number; sender: number; ct: string; gen: number }): Promise<string | null> {
    return this.callWorker('mls_decrypt', { groupId, ...data });
  }

  async mlsBatchDecrypt(groupId: string, messages: Array<{ id: string; epoch: number; sender: number; ct: string; gen: number }>): Promise<Array<{ id: string; plaintext?: string | null; error?: string; success: boolean }>> {
    return this.callWorker('mls_batch_decrypt', { groupId, messages });
  }

  async reset(): Promise<void> {
    await this.callWorker<void>('reset');
    this.ready = false;
    this.initPromise = null;
  }

  get isWorkerAvailable(): boolean {
    return !!this.worker;
  }

  get isReady(): boolean {
    return this.ready;
  }
}

export const e2eeProxy = WorkerProxy.shared();
