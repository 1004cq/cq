/**
 * 消息预加载优化模块
 * 实现虚拟滚动、多媒体预加载和资源缓存
 */

export interface PreloadConfig {
  itemHeight: number;
  bufferSize: number;
  maxCacheSize: number;
  imagePreloadCount: number;
  videoPreloadCount: number;
  enableThumbnailPreload: boolean;
  maxConcurrentRequests: number;
  requestTimeout: number;
  retryAttempts: number;
}

export interface CachedMessage {
  id: string;
  timestamp: number;
  mediaUrls?: string[];
  loaded: boolean;
}

export interface PreloadTask {
  messageId: string;
  urls: string[];
  priority: 'high' | 'normal' | 'low';
}

export class MessagePreloader {
  private config: PreloadConfig;
  private messageCache: Map<string, CachedMessage>;
  private preloadQueue: PreloadTask[];
  private activeRequests: Set<string>;
  private resourceCache: Map<string, Blob>;

  constructor(config: Partial<PreloadConfig> = {}) {
    this.config = {
      itemHeight: 80,
      bufferSize: 10,
      maxCacheSize: 500,
      imagePreloadCount: 3,
      videoPreloadCount: 2,
      enableThumbnailPreload: true,
      maxConcurrentRequests: 4,
      requestTimeout: 15000,
      retryAttempts: 3,
      ...config,
    };

    this.messageCache = new Map();
    this.preloadQueue = [];
    this.activeRequests = new Set();
    this.resourceCache = new Map();
  }

  /**
   * 虚拟滚动：计算可见范围内的消息
   */
  public calculateVisibleRange(
    scrollTop: number,
    containerHeight: number,
    totalMessages: number
  ): { start: number; end: number; bufferStart: number; bufferEnd: number } {
    const visibleStart = Math.floor(scrollTop / this.config.itemHeight);
    const visibleEnd = Math.ceil((scrollTop + containerHeight) / this.config.itemHeight);

    const bufferStart = Math.max(0, visibleStart - this.config.bufferSize);
    const bufferEnd = Math.min(totalMessages, visibleEnd + this.config.bufferSize);

    return {
      start: visibleStart,
      end: visibleEnd,
      bufferStart,
      bufferEnd,
    };
  }

  /**
   * 预加载消息的多媒体资源
   */
  public async preloadMessageMedia(
    messageId: string,
    mediaUrls: string[],
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<void> {
    if (this.messageCache.has(messageId)) {
      const cached = this.messageCache.get(messageId)!;
      if (cached.loaded) return;
    }

    const task: PreloadTask = {
      messageId,
      urls: mediaUrls.filter(url => !this.resourceCache.has(url)),
      priority,
    };

    if (task.urls.length === 0) {
      this.markMessageLoaded(messageId);
      return;
    }

    this.preloadQueue.push(task);
    this.sortPreloadQueue();
    this.processPreloadQueue();
  }

  /**
   * 预加载可见范围内的消息
   */
  public async preloadVisibleMessages(
    messages: Array<{ id: string; imageUrl?: string; videoUrl?: string; stickerUrl?: string }>,
    visibleIndices: number[]
  ): Promise<void> {
    const tasks: PreloadTask[] = [];

    for (const idx of visibleIndices) {
      const msg = messages[idx];
      if (!msg) continue;

      const mediaUrls: string[] = [];
      if (msg.imageUrl) mediaUrls.push(msg.imageUrl);
      if (msg.videoUrl) mediaUrls.push(msg.videoUrl);
      if (msg.stickerUrl) mediaUrls.push(msg.stickerUrl);

      if (mediaUrls.length > 0) {
        tasks.push({
          messageId: msg.id,
          urls: mediaUrls,
          priority: 'high',
        });
      }
    }

    this.preloadQueue.push(...tasks);
    this.sortPreloadQueue();
    this.processPreloadQueue();
  }

  /**
   * 处理预加载队列
   */
  private async processPreloadQueue(): Promise<void> {
    while (
      this.preloadQueue.length > 0 &&
      this.activeRequests.size < this.config.maxConcurrentRequests
    ) {
      const task = this.preloadQueue.shift();
      if (!task) break;

      this.activeRequests.add(task.messageId);

      try {
        await this.preloadUrls(task.urls);
        this.markMessageLoaded(task.messageId);
      } catch (error) {
        console.error(`[MessagePreloader] 预加载失败: ${task.messageId}`, error);
      } finally {
        this.activeRequests.delete(task.messageId);
      }
    }
  }

  /**
   * 预加载 URL 列表
   */
  private async preloadUrls(urls: string[]): Promise<void> {
    const promises = urls.map(url => this.preloadUrl(url));
    await Promise.allSettled(promises);
  }

  /**
   * 预加载单个 URL
   */
  private async preloadUrl(
    url: string,
    attempt: number = 0
  ): Promise<void> {
    if (this.resourceCache.has(url)) {
      return;
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      this.resourceCache.set(url, blob);
      this.cleanupCache();
    } catch (error) {
      if (attempt < this.config.retryAttempts) {
        await new Promise(resolve =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
        return this.preloadUrl(url, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * 排序预加载队列（按优先级）
   */
  private sortPreloadQueue(): void {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    this.preloadQueue.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );
  }

  /**
   * 标记消息已加载
   */
  private markMessageLoaded(messageId: string): void {
    const cached = this.messageCache.get(messageId) || {
      id: messageId,
      timestamp: Date.now(),
      loaded: false,
    };
    cached.loaded = true;
    this.messageCache.set(messageId, cached);
  }

  /**
   * 清理过期缓存
   */
  private cleanupCache(): void {
    if (this.messageCache.size > this.config.maxCacheSize) {
      const entries = Array.from(this.messageCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toDelete = entries.slice(0, Math.floor(this.config.maxCacheSize * 0.2));
      for (const [id] of toDelete) {
        this.messageCache.delete(id);
      }
    }

    if (this.resourceCache.size > this.config.maxCacheSize * 2) {
      const entries = Array.from(this.resourceCache.entries());
      const toDelete = entries.slice(0, Math.floor(entries.length * 0.3));
      for (const [url] of toDelete) {
        this.resourceCache.delete(url);
      }
    }
  }

  /**
   * 获取缓存的资源
   */
  public getCachedResource(url: string): Blob | undefined {
    return this.resourceCache.get(url);
  }

  /**
   * 清空所有缓存
   */
  public clearCache(): void {
    this.messageCache.clear();
    this.resourceCache.clear();
    this.preloadQueue = [];
    this.activeRequests.clear();
  }

  /**
   * 获取缓存统计信息
   */
  public getStats() {
    return {
      cachedMessages: this.messageCache.size,
      cachedResources: this.resourceCache.size,
      queuedTasks: this.preloadQueue.length,
      activeRequests: this.activeRequests.size,
    };
  }
}

export const messagePreloader = new MessagePreloader();
