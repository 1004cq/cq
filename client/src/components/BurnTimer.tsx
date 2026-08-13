/**
 * BurnTimer.tsx — 阅后即焚 UI 组件
 *
 * 提供：
 * 1. 阅后即焚时间选择器
 * 2. 消息倒计时显示
 * 3. 焚烧动画效果
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  getBurnManager,
  formatBurnTime,
  formatCountdown,
  BURN_PRESETS,
} from '../lib/e2ee/BurnAfterRead';

// ============================================================
// 阅后即焚时间选择器
// ============================================================

interface BurnTimerPickerProps {
  /** 当前选中的阅后即焚时间（秒），0 表示关闭 */
  value: number;
  /** 选择变更回调 */
  onChange: (seconds: number) => void;
  /** 是否紧凑模式 */
  compact?: boolean;
}

export const BurnTimerPicker: React.FC<BurnTimerPickerProps> = ({
  value,
  onChange,
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (compact) {
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '14px',
            color: value > 0 ? '#f59e0b' : '#9ca3af',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title={value > 0 ? `阅后即焚: ${formatBurnTime(value)}` : '设置阅后即焚'}
        >
          <span>{value > 0 ? '🔥' : '⏱️'}</span>
          {value > 0 && <span style={{ fontSize: '11px' }}>{formatBurnTime(value)}</span>}
        </button>

        {isOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: '0',
              backgroundColor: '#1f2937',
              borderRadius: '8px',
              padding: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              zIndex: 1000,
              minWidth: '120px',
            }}
          >
            {BURN_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => {
                  onChange(preset.value);
                  setIsOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 12px',
                  background: value === preset.value ? 'rgba(245, 158, 11, 0.2)' : 'none',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: value === preset.value ? '#f59e0b' : '#d1d5db',
                  fontSize: '13px',
                  textAlign: 'left',
                }}
              >
                {preset.value > 0 ? '🔥 ' : ''}{preset.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {BURN_PRESETS.map((preset) => (
        <button
          key={preset.value}
          onClick={() => onChange(preset.value)}
          style={{
            padding: '4px 10px',
            borderRadius: '12px',
            border: `1px solid ${value === preset.value ? '#f59e0b' : '#374151'}`,
            background: value === preset.value ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
            color: value === preset.value ? '#f59e0b' : '#9ca3af',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
};

// ============================================================
// 消息倒计时显示
// ============================================================

interface BurnCountdownProps {
  /** 消息 ID */
  messageId: string;
  /** 阅后即焚秒数 */
  burnAfterRead: number;
  /** 消息已销毁回调 */
  onDestroyed?: () => void;
}

export const BurnCountdown: React.FC<BurnCountdownProps> = ({
  messageId,
  burnAfterRead,
  onDestroyed,
}) => {
  const [remaining, setRemaining] = useState<number>(-1);
  const [isDestroyed, setIsDestroyed] = useState(false);

  useEffect(() => {
    const burnManager = getBurnManager();

    // 注册销毁回调
    const unsubscribe = burnManager.onDestroy((destroyedId) => {
      if (destroyedId === messageId) {
        setIsDestroyed(true);
        onDestroyed?.();
      }
    });

    // 定期更新剩余时间
    const interval = setInterval(() => {
      const time = burnManager.getRemainingTime(messageId);
      setRemaining(time);
      if (time === 0) {
        setIsDestroyed(true);
        onDestroyed?.();
      }
    }, 1000);

    // 初始检查
    setRemaining(burnManager.getRemainingTime(messageId));

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [messageId, onDestroyed]);

  if (isDestroyed) {
    return (
      <span
        style={{
          fontSize: '10px',
          color: '#ef4444',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
        }}
      >
        🔥 已销毁
      </span>
    );
  }

  if (remaining < 0) {
    // 未开始倒计时（未阅读）
    return (
      <span
        style={{
          fontSize: '10px',
          color: '#f59e0b',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
          opacity: 0.8,
        }}
        title={`阅后 ${formatBurnTime(burnAfterRead)} 销毁`}
      >
        🔥 {formatBurnTime(burnAfterRead)}
      </span>
    );
  }

  // 倒计时中
  const urgency = remaining <= 10 ? '#ef4444' : remaining <= 60 ? '#f59e0b' : '#6b7280';

  return (
    <span
      style={{
        fontSize: '10px',
        color: urgency,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        fontFamily: 'monospace',
        animation: remaining <= 5 ? 'pulse 0.5s infinite' : undefined,
      }}
      title="阅后即焚倒计时"
    >
      🔥 {formatCountdown(remaining)}
    </span>
  );
};

// ============================================================
// 阅后即焚标记（消息气泡上的小图标）
// ============================================================

interface BurnBadgeProps {
  /** 阅后即焚秒数 */
  burnAfterRead?: number;
}

export const BurnBadge: React.FC<BurnBadgeProps> = ({ burnAfterRead }) => {
  if (!burnAfterRead || burnAfterRead <= 0) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        fontSize: '10px',
        color: '#f59e0b',
        marginLeft: '4px',
        opacity: 0.7,
      }}
      title={`阅后 ${formatBurnTime(burnAfterRead)} 销毁`}
    >
      🔥
    </span>
  );
};

export default BurnTimerPicker;
