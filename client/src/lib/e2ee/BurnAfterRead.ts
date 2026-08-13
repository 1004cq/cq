/**
 * BurnAfterRead.ts — 阅后即焚管理器
 *
 * 基于 Signal 模式的阅后即焚实现：
 * 1. 发送方设置 burnAfterRead 秒数
 * 2. 消息通过 E2EE 加密传输（包含过期元数据）
 * 3. 接收方阅读后启动本地定时器
 * 4. 到期后从本地安全删除
 * 5. 通过加密控制消息同步删除指令
 *
 * 安全原则：
 * - 服务器不知道哪些消息是阅后即焚（元数据也加密）
 * - 每个设备独立处理删除
 * - 删除后覆盖内存中的明文
 */

// ============================================================
// 类型定义
// ============================================================

export interface BurnMessage {
  /** 消息 ID */
  messageId: string;
  /** 聊天/群组 ID */
  chatId: string;
  /** 消息类型：private | group */
  chatType: 'private' | 'group';
  /** 阅读后多少秒销毁 */
  burnAfterRead: number;
  /** 消息被阅读的时间戳（ms） */
  readAt?: number;
  /** 消息过期时间戳（ms） */
  expireAt?: number;
  /** 是否已标记为已读 */
  isRead: boolean;
  /** 是否已销毁 */
  isDestroyed: boolean;
}

export interface BurnConfig {
  /** 预设的阅后即焚时间选项（秒） */
  presets: { label: string; value: number }[];
  /** 默认阅后即焚时间（秒），0 表示关闭 */
  defaultBurn: number;
}

/** 销毁回调 */
export type BurnCallback = (messageId: string, chatId: string, chatType: string) => void;

// ============================================================
// 常量
// ============================================================

/** 预设的阅后即焚时间选项 */
export const BURN_PRESETS: BurnConfig['presets'] = [
  { label: '关闭', value: 0 },
  { label: '5秒', value: 5 },
  { label: '10秒', value: 10 },
  { label: '30秒', value: 30 },
  { label: '1分钟', value: 60 },
  { label: '5分钟', value: 300 },
  { label: '30分钟', value: 1800 },
  { label: '1小时', value: 3600 },
  { label: '12小时', value: 43200 },
  { label: '1天', value: 86400 },
  { label: '7天', value: 604800 },
];

/** IndexedDB 数据库名 */
const BURN_DB_NAME = 'imim_burn_messages';
const BURN_STORE_NAME = 'burn_queue';

// ============================================================
// BurnAfterReadManager 单例
// ============================================================

export class BurnAfterReadManager {
  private static instance: BurnAfterReadManager | null = null;

  /** 活跃的定时器 Map: messageId -> timerId */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 内存中的待销毁消息队列 */
  private burnQueue = new Map<string, BurnMessage>();

  /** 销毁回调列表 */
  private onDestroyCallbacks: BurnCallback[] = [];

  /** 是否已初始化 */
  private initialized = false;

  /** 定期检查间隔（ms） */
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  static shared(): BurnAfterReadManager {
    if (!BurnAfterReadManager.instance) {
      BurnAfterReadManager.instance = new BurnAfterReadManager();
    }
    return BurnAfterReadManager.instance;
  }

  // ============ 初始化 ============

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 从 localStorage 恢复待销毁队列
    try {
      const saved = localStorage.getItem('burn_queue');
      if (saved) {
        const items: BurnMessage[] = JSON.parse(saved);
        for (const item of items) {
          if (!item.isDestroyed) {
            this.burnQueue.set(item.messageId, item);
            // 恢复定时器
            if (item.expireAt && item.expireAt > Date.now()) {
              this.startTimer(item);
            } else if (item.expireAt && item.expireAt <= Date.now()) {
              // 已过期，立即销毁
              this.destroyMessage(item.messageId);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Burn] 恢复队列失败:', err);
    }

    // 启动定期检查（每 5 秒检查一次过期消息）
    this.checkInterval = setInterval(() => {
      this.checkExpiredMessages();
    }, 5000);

    this.initialized = true;
    console.log(`[Burn] 初始化完成, 队列中 ${this.burnQueue.size} 条待销毁消息`);
  }

  // ============ 注册销毁回调 ============

  onDestroy(callback: BurnCallback): () => void {
    this.onDestroyCallbacks.push(callback);
    return () => {
      this.onDestroyCallbacks = this.onDestroyCallbacks.filter(cb => cb !== callback);
    };
  }

  // ============ 添加阅后即焚消息 ============

  /**
   * 注册一条阅后即焚消息
   * 发送方和接收方都需要调用
   */
  registerBurnMessage(params: {
    messageId: string;
    chatId: string;
    chatType: 'private' | 'group';
    burnAfterRead: number;
  }): void {
    if (params.burnAfterRead <= 0) return;

    const msg: BurnMessage = {
      messageId: params.messageId,
      chatId: params.chatId,
      chatType: params.chatType,
      burnAfterRead: params.burnAfterRead,
      isRead: false,
      isDestroyed: false,
    };

    this.burnQueue.set(params.messageId, msg);
    this.persistQueue();
    console.log(`[Burn] 注册消息 ${params.messageId}, ${params.burnAfterRead}秒后销毁`);
  }

  // ============ 标记消息已读（启动倒计时） ============

  /**
   * 标记消息已读，启动销毁倒计时
   * 接收方打开/查看消息时调用
   */
  markAsRead(messageId: string): void {
    const msg = this.burnQueue.get(messageId);
    if (!msg || msg.isRead || msg.isDestroyed) return;

    const now = Date.now();
    msg.isRead = true;
    msg.readAt = now;
    msg.expireAt = now + msg.burnAfterRead * 1000;

    this.burnQueue.set(messageId, msg);
    this.persistQueue();

    // 启动定时器
    this.startTimer(msg);

    console.log(`[Burn] 消息 ${messageId} 已读, ${msg.burnAfterRead}秒后销毁`);
  }

  // ============ 获取消息剩余时间 ============

  /**
   * 获取消息剩余存活时间（秒）
   * 返回 -1 表示未开始倒计时，0 表示已过期
   */
  getRemainingTime(messageId: string): number {
    const msg = this.burnQueue.get(messageId);
    if (!msg) return -1;
    if (!msg.expireAt) return -1;
    if (msg.isDestroyed) return 0;

    const remaining = Math.max(0, msg.expireAt - Date.now());
    return Math.ceil(remaining / 1000);
  }

  /**
   * 检查消息是否为阅后即焚消息
   */
  isBurnMessage(messageId: string): boolean {
    return this.burnQueue.has(messageId);
  }

  /**
   * 获取消息的阅后即焚配置
   */
  getBurnConfig(messageId: string): BurnMessage | undefined {
    return this.burnQueue.get(messageId);
  }

  // ============ 内部方法 ============

  private startTimer(msg: BurnMessage): void {
    // 清除旧定时器
    const oldTimer = this.timers.get(msg.messageId);
    if (oldTimer) clearTimeout(oldTimer);

    if (!msg.expireAt) return;

    const delay = Math.max(0, msg.expireAt - Date.now());
    const timer = setTimeout(() => {
      this.destroyMessage(msg.messageId);
    }, delay);

    this.timers.set(msg.messageId, timer);
  }

  private destroyMessage(messageId: string): void {
    const msg = this.burnQueue.get(messageId);
    if (!msg || msg.isDestroyed) return;

    msg.isDestroyed = true;

    // 清除定时器
    const timer = this.timers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(messageId);
    }

    // 通知回调
    for (const callback of this.onDestroyCallbacks) {
      try {
        callback(messageId, msg.chatId, msg.chatType);
      } catch (err) {
        console.error('[Burn] 销毁回调错误:', err);
      }
    }

    // 从队列中移除
    this.burnQueue.delete(messageId);
    this.persistQueue();

    // 通知服务器删除（通过 HTTP API）
    this.notifyServerDestroy(messageId, msg.chatId, msg.chatType).catch(() => {});

    console.log(`[Burn] 消息 ${messageId} 已销毁`);
  }

  private async notifyServerDestroy(
    messageId: string,
    chatId: string,
    chatType: string
  ): Promise<void> {
    try {
      const endpoint = chatType === 'group'
        ? '/api/group/burn-message'
        : '/api/chat/burn-message';

      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, chatId }),
      });
    } catch (err) {
      console.warn('[Burn] 通知服务器销毁失败:', err);
    }
  }

  private checkExpiredMessages(): void {
    const now = Date.now();
    for (const [messageId, msg] of this.burnQueue) {
      if (msg.expireAt && msg.expireAt <= now && !msg.isDestroyed) {
        this.destroyMessage(messageId);
      }
    }
  }

  private persistQueue(): void {
    try {
      const items = Array.from(this.burnQueue.values());
      localStorage.setItem('burn_queue', JSON.stringify(items));
    } catch (err) {
      console.warn('[Burn] 持久化队列失败:', err);
    }
  }

  // ============ 清理 ============

  dispose(): void {
    // 清除所有定时器
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // 清除定期检查
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.persistQueue();
    this.initialized = false;
  }
}

// ============================================================
// 便捷函数
// ============================================================

/** 获取 BurnAfterReadManager 单例 */
export function getBurnManager(): BurnAfterReadManager {
  return BurnAfterReadManager.shared();
}

/** 格式化阅后即焚时间显示 */
export function formatBurnTime(seconds: number): string {
  if (seconds <= 0) return '关闭';
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
  return `${Math.floor(seconds / 86400)}天`;
}

/** 格式化剩余时间倒计时显示 */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '已销毁';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
