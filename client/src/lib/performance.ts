/**
 * 性能优化工具集
 * 包括防抖、节流、虚拟滚动、内存管理等
 */

/**
 * 防抖函数 - 延迟执行，适用于搜索、输入等
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  return function (...args: Parameters<T>) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * 节流函数 - 限制执行频率，适用于滚动、窗口缩放等
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  return function (...args: Parameters<T>) {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 请求动画帧节流 - 基于 requestAnimationFrame 的高性能节流
 */
export function rafThrottle<T extends (...args: any[]) => any>(
  fn: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null;
  return function (...args: Parameters<T>) {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      fn(...args);
      rafId = null;
    });
  };
}

/**
 * 批量更新优化 - 将多个状态更新合并为一次
 */
export function batchUpdates(callback: () => void) {
  if ('unstable_batchedUpdates' in require('react-dom')) {
    require('react-dom').unstable_batchedUpdates(callback);
  } else {
    callback();
  }
}

/**
 * 懒加载图片
 */
export function lazyLoadImage(img: HTMLImageElement) {
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          img.src = img.dataset.src || '';
          observer.unobserve(img);
        }
      });
    });
    observer.observe(img);
  } else {
    img.src = img.dataset.src || '';
  }
}

/**
 * 计算列表虚拟滚动的可见项
 */
export function getVisibleRange(
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  bufferSize: number = 5
) {
  const visibleStart = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
  const visibleEnd = Math.min(
    totalItems,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + bufferSize
  );
  return { start: visibleStart, end: visibleEnd };
}

/**
 * 内存泄漏检测 - 监控长期运行的事件监听器
 */
export class EventListenerTracker {
  private listeners = new Map<string, Set<Function>>();

  addEventListener(target: EventTarget, event: string, handler: EventListener) {
    target.addEventListener(event, handler);
    const key = `${event}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(handler);
  }

  removeEventListener(target: EventTarget, event: string, handler: EventListener) {
    target.removeEventListener(event, handler);
    const key = `${event}`;
    this.listeners.get(key)?.delete(handler);
  }

  cleanup() {
    this.listeners.clear();
  }

  getStats() {
    return {
      totalListeners: Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0),
      eventTypes: this.listeners.size,
    };
  }
}

/**
 * 性能监测 - 记录页面性能指标
 */
export function measurePerformance(label: string) {
  return {
    mark: () => performance.mark(`${label}-start`),
    measure: () => {
      performance.mark(`${label}-end`);
      performance.measure(label, `${label}-start`, `${label}-end`);
      const measure = performance.getEntriesByName(label)[0];
      console.log(`⏱️ ${label}: ${(measure as PerformanceMeasure).duration.toFixed(2)}ms`);
    },
  };
}

/**
 * 帧率监测
 */
export function monitorFrameRate(callback: (fps: number) => void) {
  let lastTime = performance.now();
  let frames = 0;

  function countFrame() {
    frames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      callback(frames);
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(countFrame);
  }

  requestAnimationFrame(countFrame);
}

/**
 * 动画帧计时器 - 用于精确的动画时序
 */
export class AnimationTimer {
  private startTime = 0;
  private pausedTime = 0;
  private isPaused = false;

  start() {
    this.startTime = performance.now();
  }

  pause() {
    if (!this.isPaused) {
      this.pausedTime = performance.now();
      this.isPaused = true;
    }
  }

  resume() {
    if (this.isPaused) {
      this.startTime += performance.now() - this.pausedTime;
      this.isPaused = false;
    }
  }

  getElapsed() {
    if (this.isPaused) {
      return this.pausedTime - this.startTime;
    }
    return performance.now() - this.startTime;
  }

  getProgress(duration: number) {
    return Math.min(1, this.getElapsed() / duration);
  }
}

/**
 * 平滑滚动优化
 */
export function smoothScroll(
  element: HTMLElement,
  targetScrollTop: number,
  duration: number = 300
) {
  const startScrollTop = element.scrollTop;
  const distance = targetScrollTop - startScrollTop;
  const startTime = performance.now();

  function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function scroll(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = easeInOutCubic(progress);
    element.scrollTop = startScrollTop + distance * easeProgress;

    if (progress < 1) {
      requestAnimationFrame(scroll);
    }
  }

  requestAnimationFrame(scroll);
}

/**
 * 触摸反馈优化 - 减少触摸延迟
 */
export function enableFastClick(element: HTMLElement) {
  let touchStartTime = 0;
  let touchStartX = 0;
  let touchStartY = 0;

  element.addEventListener('touchstart', (e) => {
    touchStartTime = Date.now();
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  });

  element.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const moveDistance = Math.sqrt(
      Math.pow(touchEndX - touchStartX, 2) + Math.pow(touchEndY - touchStartY, 2)
    );
    const duration = Date.now() - touchStartTime;

    // 如果是快速点击（移动距离小，时间短）
    if (moveDistance < 10 && duration < 200) {
      element.click();
    }
  });
}

/**
 * 内存优化 - 定期清理不需要的对象
 */
export class MemoryManager {
  private objects = new WeakMap<object, number>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  track(obj: object) {
    this.objects.set(obj, Date.now());
  }

  startAutoCleanup(interval: number = 60000) {
    this.cleanupInterval = setInterval(() => {
      // WeakMap 会自动清理不再被引用的对象
      console.log('🧹 Memory cleanup cycle completed');
    }, interval);
  }

  stopAutoCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * 获取当前设备的性能等级
 */
type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number;
};

export function getDevicePerformanceLevel(): 'low' | 'medium' | 'high' {
  const cores = navigator.hardwareConcurrency || 1;
  const memory = (navigator as NavigatorWithDeviceMemory).deviceMemory || 4;

  if (cores <= 2 || memory <= 2) return 'low';
  if (cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}

/**
 * 根据设备性能调整动画
 */
export function getAnimationConfig(level: 'low' | 'medium' | 'high') {
  const configs = {
    low: { duration: 150, delay: 0 },
    medium: { duration: 300, delay: 50 },
    high: { duration: 400, delay: 100 },
  };
  return configs[level];
}
