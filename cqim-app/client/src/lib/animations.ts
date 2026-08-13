/**
 * 高级动效配置和预设
 * 基于 Framer Motion 的优化动画库
 * 
 * Telegram 风格优化：
 * 1. 只动画 GPU 友好属性：transform(x/y/scale/rotate) + opacity
 * 2. 使用 spring/physics 动画实现自然减速
 * 3. 限制同时动画元素数量
 * 4. 针对低端设备降级
 */

import { type Variants, type Transition } from 'framer-motion';

// ============ Telegram 风格 Easing 曲线 ============

/** TG 标准 ease-out 曲线 — 快进慢出，自然减速 */
export const tgEaseOut: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** TG 弹性曲线 — 略带回弹 */
export const tgSpring: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

/** TG 快速曲线 — 用于微交互 */
export const tgFast: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

/** TG 退出曲线 — ease-in */
export const tgEaseIn: [number, number, number, number] = [0.55, 0.055, 0.675, 0.19];

// ============ Spring 动画配置 ============

/** 消息气泡弹入 — 阻尼适中，有轻微回弹 */
export const springBubble: Transition = {
  type: 'spring',
  damping: 20,
  stiffness: 300,
  mass: 0.8,
};

/** 页面过渡 — 阻尼较高，无回弹 */
export const springPage: Transition = {
  type: 'spring',
  damping: 28,
  stiffness: 250,
  mass: 1,
};

/** 弹性按钮 — 低阻尼，明显回弹 */
export const springButton: Transition = {
  type: 'spring',
  damping: 12,
  stiffness: 400,
  mass: 0.5,
};

/** 浮标/Badge — 中等弹性 */
export const springBadge: Transition = {
  type: 'spring',
  damping: 15,
  stiffness: 350,
  mass: 0.6,
};

// ============ 页面过渡动画预设（GPU 友好） ============

export const pageTransitions = {
  /** 淡入淡出 — 最轻量 */
  fadeInOut: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2, ease: tgFast },
  } as Variants,

  /** TG 风格：从右侧滑入（聊天详情页进入） */
  slideInFromRight: {
    initial: { opacity: 0, x: '100%' },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: '100%' },
    transition: { duration: 0.3, ease: tgEaseOut },
  } as Variants,

  /** TG 风格：从左侧滑入（返回） */
  slideInFromLeft: {
    initial: { opacity: 0, x: '-30%' },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: '-30%' },
    transition: { duration: 0.3, ease: tgEaseOut },
  } as Variants,

  /** TG 风格：从下方滑入（底部 Sheet） */
  slideInFromBottom: {
    initial: { opacity: 0, y: '100%' },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: '100%' },
    transition: { duration: 0.35, ease: tgEaseOut },
  } as Variants,

  /** 缩放弹入 — 模态框 */
  scaleIn: {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.9 },
    transition: { duration: 0.25, ease: tgEaseOut },
  } as Variants,
};

// ============ 消息气泡动画预设（核心优化） ============

export const bubbleAnimations = {
  /** 自己发送的消息 — 从底部飞入 + 轻微缩放（TG 风格） */
  messageSendFlyIn: {
    initial: { opacity: 0, y: 20, scale: 0.92 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: springBubble,
  } as Variants,

  /** 收到的消息 — 从底部淡入 + 轻微上移 */
  messageReceiveFadeIn: {
    initial: { opacity: 0, y: 12, scale: 0.96 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.25, ease: tgEaseOut },
  } as Variants,

  /** 消息淡入 — 最轻量，用于批量加载 */
  messageFadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.15 },
  } as Variants,

  /** 消息从左滑入（他人消息） */
  messageSlideLeft: {
    initial: { opacity: 0, x: -16 },
    animate: { opacity: 1, x: 0 },
    transition: { duration: 0.25, ease: tgEaseOut },
  } as Variants,

  /** 消息从右滑入（自己消息） */
  messageSlideRight: {
    initial: { opacity: 0, x: 16 },
    animate: { opacity: 1, x: 0 },
    transition: { duration: 0.25, ease: tgEaseOut },
  } as Variants,

  /** 群消息插入 — 从底部淡入 + 轻微上移（TG 大群风格） */
  groupMessageInsert: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.2, ease: tgFast },
  } as Variants,
};

// ============ 列表项动画预设 ============

export const listItemAnimations = {
  /** 逐项淡入 */
  staggerFadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.2 },
  } as Variants,

  /** 逐项从左滑入 */
  staggerSlideIn: {
    initial: { opacity: 0, x: -16 },
    animate: { opacity: 1, x: 0 },
    transition: { duration: 0.25, ease: tgEaseOut },
  } as Variants,

  /** 逐项从下浮入 */
  staggerFloatIn: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.25, ease: tgEaseOut },
  } as Variants,

  /** 悬停效果 — GPU 友好（只用 transform） */
  hoverLift: {
    whileHover: { y: -2, transition: { duration: 0.15 } },
    whileTap: { scale: 0.98 },
  } as Variants,
};

// ============ 按钮动画预设 ============

export const buttonAnimations = {
  /** 标准按钮 — 轻量 tap 反馈 */
  standard: {
    whileHover: { scale: 1.02, transition: { duration: 0.15 } },
    whileTap: { scale: 0.96 },
  } as Variants,

  /** 发送按钮 — TG 风格弹性 */
  send: {
    whileTap: { scale: 0.85, transition: springButton },
  } as Variants,

  /** 脉冲按钮 */
  pulse: {
    animate: {
      scale: [1, 1.05, 1],
      transition: { duration: 2, repeat: Infinity },
    },
    whileHover: { scale: 1.08 },
    whileTap: { scale: 0.95 },
  } as Variants,

  /** 弹性按钮 */
  bounce: {
    whileHover: { y: -2 },
    whileTap: { y: 0, scale: 0.97 },
  } as Variants,
};

// ============ 模态框动画预设 ============

export const modalAnimations = {
  /** 背景淡入 */
  backdropFadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2 },
  } as Variants,

  /** 内容从下方弹入 — TG 风格 */
  contentSlideUp: {
    initial: { opacity: 0, y: '100%' },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: '100%' },
    transition: { duration: 0.35, ease: tgEaseOut },
  } as Variants,

  /** 内容缩放弹入 */
  contentScaleIn: {
    initial: { opacity: 0, scale: 0.92 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.92 },
    transition: springBubble,
  } as Variants,
};

// ============ 输入框动画预设 ============

export const inputAnimations = {
  /** 聚焦时的光晕效果 */
  focusGlow: {
    focus: {
      boxShadow: '0 0 0 3px rgba(74, 124, 89, 0.1)',
      transition: { duration: 0.2 },
    },
  } as Variants,

  /** 错误抖动 — GPU 友好 */
  errorShake: {
    animate: {
      x: [-4, 4, -4, 4, 0],
      transition: { duration: 0.35 },
    },
  } as Variants,
};

// ============ 加载动画预设 ============

export const loadingAnimations = {
  /** 旋转加载 */
  spin: {
    animate: { rotate: 360 },
    transition: { duration: 1, repeat: Infinity, ease: 'linear' },
  } as Variants,

  /** 脉冲加载 */
  pulse: {
    animate: { opacity: [0.5, 1, 0.5] },
    transition: { duration: 1.5, repeat: Infinity },
  } as Variants,

  /** 弹跳加载 */
  bounce: {
    animate: { y: [0, -8, 0] },
    transition: { duration: 0.6, repeat: Infinity },
  } as Variants,

  /** 骨架屏加载 */
  skeleton: {
    animate: { backgroundPosition: ['200% 0', '-200% 0'] },
    transition: { duration: 1.4, repeat: Infinity, ease: 'linear' },
  } as Variants,
};

// ============ 通知/提示动画预设 ============

export const notificationAnimations = {
  /** 从上方滑入 */
  slideDown: {
    initial: { opacity: 0, y: -40 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -40 },
    transition: { duration: 0.3, ease: tgEaseOut },
  } as Variants,

  /** 从下方滑入 */
  slideUp: {
    initial: { opacity: 0, y: 40 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 40 },
    transition: { duration: 0.3, ease: tgEaseOut },
  } as Variants,

  /** 缩放弹入 */
  scaleIn: {
    initial: { opacity: 0, scale: 0.85 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.85 },
    transition: springBadge,
  } as Variants,
};

// ============ 容器动画预设 ============

export const containerAnimations = {
  /** 容器内项目逐个出现 */
  staggerContainer: {
    initial: 'initial',
    animate: 'animate',
    variants: {
      initial: { opacity: 0 },
      animate: {
        opacity: 1,
        transition: {
          staggerChildren: 0.06,
          delayChildren: 0.1,
        },
      },
    },
  },

  /** 容器内项目同时出现 */
  parallelContainer: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.2 },
  } as Variants,
};

// ============ 工具函数 ============

/**
 * 获取随机动画预设
 */
export function getRandomAnimation(category: keyof typeof pageTransitions) {
  const animations = Object.values(pageTransitions);
  return animations[Math.floor(Math.random() * animations.length)];
}

/**
 * 组合多个动画
 */
export function combineAnimations(...animations: Variants[]) {
  return animations.reduce<Record<string, unknown>>((merged, animation) => {
    Object.entries(animation).forEach(([key, value]) => {
      if (value !== undefined && !(key in merged)) {
        merged[key] = value;
      }
    });
    return merged;
  }, {});
}

/**
 * 延迟动画
 */
export function delayAnimation(animation: Variants, delay: number) {
  const nextAnimation: Record<string, unknown> = { ...animation };

  Object.entries(animation).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const variant = value as Record<string, unknown>;
      nextAnimation[key] = {
        ...variant,
        transition: {
          ...(typeof variant.transition === 'object' && variant.transition !== null
            ? (variant.transition as Record<string, unknown>)
            : {}),
          delay,
        },
      };
    }
  });

  return nextAnimation;
}

/**
 * 创建级联动画 — 优化版，限制最大 stagger 数量
 */
export function createCascadeAnimation(
  baseAnimation: Variants,
  itemCount: number,
  staggerDelay: number = 0.04
) {
  // 限制 stagger 数量，避免大列表动画卡顿
  const effectiveStagger = itemCount > 20 ? 0.02 : staggerDelay;
  
  return {
    container: {
      initial: 'initial',
      animate: 'animate',
      variants: {
        initial: { opacity: 0 },
        animate: {
          opacity: 1,
          transition: {
            staggerChildren: effectiveStagger,
            delayChildren: Math.min(0.15, effectiveStagger),
          },
        },
      },
    },
    item: baseAnimation,
  };
}

/**
 * 根据设备性能等级获取动画配置
 * 低端设备：禁用 spring，缩短 duration
 * 中端设备：使用 tween，适中 duration
 * 高端设备：使用 spring，完整动画
 */
export function getAdaptiveTransition(
  level: 'low' | 'medium' | 'high',
  fullTransition: Transition
): Transition {
  if (level === 'low') {
    return { duration: 0.1, ease: 'easeOut' };
  }
  if (level === 'medium') {
    return { duration: 0.2, ease: tgEaseOut };
  }
  return fullTransition;
}

/**
 * 判断是否应该跳过动画（大量消息批量加载时）
 */
export function shouldSkipAnimation(messageCount: number, threshold: number = 10): boolean {
  return messageCount > threshold;
}
