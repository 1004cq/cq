/**
 * StickerPrefetchScheduler — 贴纸资源预加载调度器
 * 实现优先级队列：可视区 > 缓冲区 > 闲置填充
 * 限制并发网络请求，支持取消，避免阻塞业务 API
 */

type Priority = 'high' | 'medium' | 'low';

interface PrefetchTask {
  url: string;
  priority: Priority;
  controller: AbortController;
  onComplete?: () => void;
}

class StickerPrefetchScheduler {
  private queue: PrefetchTask[] = [];
  private activeCount = 0;
  private maxConcurrent = 3;
  private cache = new Set<string>();

  /**
   * 添加预加载任务
   * @param urls 资源列表
   * @param priority 优先级
   */
  public prefetch(urls: string[], priority: Priority = 'low') {
    const nextUrls = urls.filter((url) => url && !this.cache.has(url) && !this.isTaskPending(url));
    if (nextUrls.length === 0) return;

    const tasks: PrefetchTask[] = nextUrls.map((url) => ({
      url,
      priority,
      controller: new AbortController(),
    }));

    if (priority === 'high') {
      this.queue.unshift(...tasks);
    } else {
      this.queue.push(...tasks);
    }

    this.processQueue();
  }

  /**
   * 取消特定 URL 的预加载（例如离开视口）
   */
  public cancel(url: string) {
    const index = this.queue.findIndex((task) => task.url === url);
    if (index !== -1) {
      this.queue[index].controller.abort();
      this.queue.splice(index, 1);
    }
  }

  /**
   * 清空队列
   */
  public clear() {
    this.queue.forEach((task) => task.controller.abort());
    this.queue = [];
  }

  public isCached(url: string): boolean {
    return this.cache.has(url);
  }

  private isTaskPending(url: string): boolean {
    return this.queue.some((task) => task.url === url);
  }

  private async processQueue() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) return;

    // 按优先级排序：high > medium > low
    this.queue.sort((a, b) => {
      const pMap = { high: 0, medium: 1, low: 2 };
      return pMap[a.priority] - pMap[b.priority];
    });

    // 尽量灌满并发槽位
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.runTask(task);
    }
  }

  private async runTask(task: PrefetchTask) {
    this.activeCount++;
    try {
      const response = await fetch(task.url, {
        signal: task.controller.signal,
        cache: 'force-cache',
      });
      if (response.ok) {
        this.cache.add(task.url);
        // 如果是 Lottie 资源，顺便填充磁盘缓存，供 LottieSticker 秒开
        if (task.url.endsWith('.json') || task.url.includes('.tgs')) {
          const buffer = await response.clone().arrayBuffer();
          const { saveStickerToDisk } = await import('./stickerDiskCache');
          void saveStickerToDisk(task.url, buffer);
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.warn(`[StickerPrefetch] Failed to prefetch: ${task.url}`, error);
      }
    } finally {
      this.activeCount--;
      void this.processQueue();
    }
  }
}

export const stickerPrefetcher = new StickerPrefetchScheduler();
