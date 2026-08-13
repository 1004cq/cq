/**
 * 网络请求优化模块
 * 实现请求合并、缓存和速率限制
 */

export interface NetworkOptimizationConfig {
  enableRequestMerging: boolean;
  enableResponseCache: boolean;
  enableRateLimiting: boolean;
  cacheTTL: number; // 缓存时间（ms）
  maxConcurrentRequests: number;
  requestTimeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface CachedResponse {
  data: any;
  timestamp: number;
  ttl: number;
}

export interface PendingRequest {
  promise: Promise<any>;
  resolvers: Array<(value: any) => void>;
  rejectors: Array<(reason: any) => void>;
}

/**
 * 网络优化器
 */
export class NetworkOptimizer {
  private config: NetworkOptimizationConfig;
  private responseCache: Map<string, CachedResponse>;
  private pendingRequests: Map<string, PendingRequest>;
  private activeRequests: number;
  private requestQueue: Array<() => Promise<any>>;

  constructor(config: Partial<NetworkOptimizationConfig> = {}) {
    this.config = {
      enableRequestMerging: true,
      enableResponseCache: true,
      enableRateLimiting: true,
      cacheTTL: 5 * 60 * 1000, // 5分钟
      maxConcurrentRequests: 6,
      requestTimeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    this.responseCache = new Map();
    this.pendingRequests = new Map();
    this.activeRequests = 0;
    this.requestQueue = [];
  }

  /**
   * 发起优化的 GET 请求
   */
  public async get<T = any>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const cacheKey = `GET:${url}`;

    // 检查缓存
    if (this.config.enableResponseCache) {
      const cached = this.getCachedResponse(cacheKey);
      if (cached) return cached as T;
    }

    // 检查待处理请求（请求合并）
    if (this.config.enableRequestMerging && this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!.promise as Promise<T>;
    }

    // 创建新请求
    const request = this.createRequest(url, {
      ...options,
      method: 'GET',
    });

    // 存储待处理请求
    if (this.config.enableRequestMerging) {
      this.pendingRequests.set(cacheKey, request);
    }

    try {
      const response = await this.executeRequest(request.promise);
      const data = await response.json() as T;

      // 缓存响应
      if (this.config.enableResponseCache) {
        this.setCachedResponse(cacheKey, data);
      }

      return data;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * 发起优化的 POST 请求
   */
  public async post<T = any>(
    url: string,
    body?: any,
    options: RequestInit = {}
  ): Promise<T> {
    const request = this.createRequest(url, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });

    try {
      const response = await this.executeRequest(request.promise);
      return await response.json() as T;
    } finally {
      // POST 请求不缓存
    }
  }

  /**
   * 创建请求
   */
  private createRequest(
    url: string,
    options: RequestInit
  ): PendingRequest {
    const resolvers: Array<(value: any) => void> = [];
    const rejectors: Array<(reason: any) => void> = [];

    const promise = new Promise((resolve, reject) => {
      resolvers.push(resolve);
      rejectors.push(reject);

      // 加入请求队列
      if (this.config.enableRateLimiting) {
        this.requestQueue.push(async () => {
          try {
            const response = await this.fetchWithRetry(url, options);
            resolve(response);
          } catch (error) {
            reject(error);
          }
        });

        this.processRequestQueue();
      } else {
        this.fetchWithRetry(url, options)
          .then(resolve)
          .catch(reject);
      }
    });

    return { promise, resolvers, rejectors };
  }

  /**
   * 处理请求队列
   */
  private async processRequestQueue(): Promise<void> {
    while (
      this.requestQueue.length > 0 &&
      this.activeRequests < this.config.maxConcurrentRequests
    ) {
      const request = this.requestQueue.shift();
      if (!request) break;

      this.activeRequests++;

      try {
        await request();
      } finally {
        this.activeRequests--;
        // 继续处理队列
        if (this.requestQueue.length > 0) {
          this.processRequestQueue();
        }
      }
    }
  }

  /**
   * 带重试的 fetch
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    attempt: number = 0
  ): Promise<Response> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.requestTimeout
      );

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (error) {
      if (attempt < this.config.retryAttempts) {
        // 指数退避
        const delay = this.config.retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, options, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * 执行请求
   */
  private async executeRequest(promise: Promise<any>): Promise<Response> {
    return promise;
  }

  /**
   * 获取缓存响应
   */
  private getCachedResponse(key: string): any | null {
    const cached = this.responseCache.get(key);

    if (!cached) return null;

    // 检查 TTL
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.responseCache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * 设置缓存响应
   */
  private setCachedResponse(key: string, data: any): void {
    this.responseCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: this.config.cacheTTL,
    });
  }

  /**
   * 清空缓存
   */
  public clearCache(): void {
    this.responseCache.clear();
  }

  /**
   * 获取统计信息
   */
  public getStats() {
    return {
      cachedResponses: this.responseCache.size,
      pendingRequests: this.pendingRequests.size,
      activeRequests: this.activeRequests,
      queuedRequests: this.requestQueue.length,
    };
  }
}

// 导出单例
export const networkOptimizer = new NetworkOptimizer();
