/**
 * 全局资源预热模块
 * 在应用启动时预加载常用资源
 */

export interface GlobalPreloadConfig {
  enableAvatarPreload: boolean;
  enableStickerPreload: boolean;
  enableFontPreload: boolean;
  maxAvatarsToPreload: number;
  maxStickersToPreload: number;
  preloadDelay: number; // 延迟预加载时间（ms）
}

export class GlobalResourcePreloader {
  private config: GlobalPreloadConfig;
  private preloadedUrls: Set<string>;
  private idleCallbackId: number | null;

  constructor(config: Partial<GlobalPreloadConfig> = {}) {
    this.config = {
      enableAvatarPreload: true,
      enableStickerPreload: true,
      enableFontPreload: true,
      maxAvatarsToPreload: 10,
      maxStickersToPreload: 20,
      preloadDelay: 2000,
      ...config,
    };

    this.preloadedUrls = new Set();
    this.idleCallbackId = null;
  }

  /**
   * 启动全局预加载
   */
  public async start(): Promise<void> {
    // 延迟启动，避免影响初始加载
    await new Promise(resolve => setTimeout(resolve, this.config.preloadDelay));

    // 使用 requestIdleCallback 在浏览器空闲时执行
    this.scheduleIdleTask(async () => {
      if (this.config.enableAvatarPreload) {
        await this.preloadAvatars();
      }

      if (this.config.enableStickerPreload) {
        await this.preloadStickers();
      }

      if (this.config.enableFontPreload) {
        await this.preloadFonts();
      }
    });
  }

  /**
   * 预加载用户头像
   */
  private async preloadAvatars(): Promise<void> {
    try {
      // 从 localStorage 或 API 获取最近联系人
      const recentContacts = this.getRecentContacts();

      const avatarUrls = recentContacts
        .slice(0, this.config.maxAvatarsToPreload)
        .map(contact => contact.avatarUrl)
        .filter((url): url is string => !!url && !this.preloadedUrls.has(url));

      await this.preloadUrls(avatarUrls);

      avatarUrls.forEach(url => this.preloadedUrls.add(url));
    } catch (error) {
      console.error('[GlobalResourcePreloader] 预加载头像失败:', error);
    }
  }

  /**
   * 预加载贴纸包
   */
  private async preloadStickers(): Promise<void> {
    try {
      // 获取最常用的贴纸包
      const frequentStickerPacks = this.getFrequentStickerPacks();

      const stickerUrls = frequentStickerPacks
        .slice(0, this.config.maxStickersToPreload)
        .map(pack => pack.coverUrl)
        .filter((url): url is string => !!url && !this.preloadedUrls.has(url));

      await this.preloadUrls(stickerUrls);

      stickerUrls.forEach(url => this.preloadedUrls.add(url));
    } catch (error) {
      console.error('[GlobalResourcePreloader] 预加载贴纸失败:', error);
    }
  }

  /**
   * 预加载字体
   */
  private async preloadFonts(): Promise<void> {
    try {
      const fontUrls = [
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
        'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap',
      ];

      await this.preloadUrls(fontUrls);

      fontUrls.forEach(url => this.preloadedUrls.add(url));
    } catch (error) {
      console.error('[GlobalResourcePreloader] 预加载字体失败:', error);
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
  private async preloadUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load: ${url}`));
      img.src = url;
    });
  }

  /**
   * 获取最近联系人
   */
  private getRecentContacts(): Array<{ id: string; avatarUrl?: string; name: string }> {
    try {
      const stored = localStorage.getItem('recent_contacts');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * 获取最常用的贴纸包
   */
  private getFrequentStickerPacks(): Array<{ id: string; coverUrl?: string; name: string }> {
    try {
      const stored = localStorage.getItem('frequent_sticker_packs');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * 调度空闲任务
   */
  private scheduleIdleTask(task: () => Promise<void> | void): void {
    if ('requestIdleCallback' in window) {
      this.idleCallbackId = requestIdleCallback(() => {
        task().catch(error => {
          console.error('[GlobalResourcePreloader] 任务执行失败:', error);
        });
      });
    } else {
      // 降级方案：使用 setTimeout
      setTimeout(() => {
        task().catch(error => {
          console.error('[GlobalResourcePreloader] 任务执行失败:', error);
        });
      }, 0);
    }
  }

  /**
   * 取消预加载
   */
  public cancel(): void {
    if (this.idleCallbackId !== null && 'cancelIdleCallback' in window) {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
  }

  /**
   * 清空预加载记录
   */
  public clear(): void {
    this.preloadedUrls.clear();
    this.cancel();
  }

  /**
   * 获取预加载统计
   */
  public getStats() {
    return {
      preloadedUrls: this.preloadedUrls.size,
    };
  }
}

// 导出单例
export const globalResourcePreloader = new GlobalResourcePreloader();
