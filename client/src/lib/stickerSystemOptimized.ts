import { StickerItem, StickerSet, StickerOptimizationConfig } from '../types/sticker';

class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;
  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  clear(): void {
    this.cache.clear();
  }
  size(): number {
    return this.cache.size;
  }
}

export class StickerSystemOptimized {
  private config: StickerOptimizationConfig;
  private cache: LRUCache<string, StickerItem>;
  private preloadedUrls: Set<string>;
  private cacheName = 'sticker-assets-v1';

  constructor(config: Partial<StickerOptimizationConfig> = {}) {
    this.config = {
      enableDynamicPreload: true,
      enableLRUCache: true,
      maxCacheSize: 200,
      preloadPriority: 'moderate',
      enableCompressionPreload: true,
      ...config,
    };
    this.cache = new LRUCache(this.config.maxCacheSize);
    this.preloadedUrls = new Set();
  }

  public async preloadStickerSet(set: StickerSet): Promise<void> {
    const preloadCount = this.getPreloadCount();
    const stickersToPreload = set.stickers.slice(0, preloadCount);
    const urls = stickersToPreload.flatMap(sticker => {
      const urls: string[] = [sticker.url];
      if (sticker.thumbUrl) urls.push(sticker.thumbUrl);
      return urls;
    });

    const batchSize = 5;
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(url => this.preloadUrl(url)));
    }
  }

  private async preloadUrl(url: string): Promise<void> {
    if (this.preloadedUrls.has(url)) return;
    
    try {
      if (typeof window !== 'undefined' && 'caches' in window) {
        const cache = await caches.open(this.cacheName);
        const response = await cache.match(url);
        if (!response) {
          const fetchResponse = await fetch(url, { mode: 'no-cors' });
          if (fetchResponse.ok || fetchResponse.type === 'opaque') {
            await cache.put(url, fetchResponse.clone());
          }
        }
      }
      
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.preloadedUrls.add(url);
          resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = url;
      });
    } catch (e) {
      // Ignore errors
    }
  }

  private getPreloadCount(): number {
    switch (this.config.preloadPriority) {
      case 'aggressive': return 20;
      case 'moderate': return 10;
      case 'lazy': return 5;
      default: return 10;
    }
  }

  public getStickerFromCache(id: string): StickerItem | undefined {
    return this.config.enableLRUCache ? this.cache.get(id) : undefined;
  }

  public cacheStickerItem(sticker: StickerItem): void {
    if (this.config.enableLRUCache) this.cache.set(sticker.id, sticker);
  }

  public getCompressionUrl(url: string): string {
    return url;
  }

  public clearCache(): void {
    this.cache.clear();
    this.preloadedUrls.clear();
  }

  public getStats() {
    return {
      cachedStickers: this.cache.size(),
      preloadedUrls: this.preloadedUrls.size,
    };
  }
}

export const stickerSystemOptimized = new StickerSystemOptimized();
