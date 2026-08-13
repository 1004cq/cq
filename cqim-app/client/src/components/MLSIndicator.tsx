/**
 * MLSIndicator.tsx — MLS E2EE 加密状态指示器
 *
 * 在群聊界面显示 MLS 端到端加密状态：
 * 1. 加密锁图标
 * 2. Epoch 信息
 * 3. 加密/未加密状态
 */

import React from 'react';

interface MLSIndicatorProps {
  /** 是否已启用 MLS */
  enabled: boolean;
  /** 当前 epoch */
  epoch?: number;
  /** 成员数 */
  memberCount?: number;
  /** 紧凑模式（仅显示图标） */
  compact?: boolean;
  /** 点击回调 */
  onClick?: () => void;
}

/**
 * MLS 加密状态指示器
 * 显示在群聊标题栏，指示端到端加密状态
 */
export const MLSIndicator: React.FC<MLSIndicatorProps> = ({
  enabled,
  epoch,
  memberCount,
  compact = false,
  onClick,
}) => {
  if (compact) {
    return (
      <span
        onClick={onClick}
        style={{
          cursor: onClick ? 'pointer' : 'default',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
          fontSize: '12px',
          color: enabled ? '#10b981' : '#9ca3af',
          padding: '2px 6px',
          borderRadius: '4px',
          backgroundColor: enabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(156, 163, 175, 0.1)',
        }}
        title={enabled ? `MLS E2EE 已启用 (epoch: ${epoch || 0})` : 'E2EE 未启用'}
      >
        {enabled ? '🔒' : '🔓'}
      </span>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        color: enabled ? '#10b981' : '#9ca3af',
        padding: '4px 10px',
        borderRadius: '6px',
        backgroundColor: enabled ? 'rgba(16, 185, 129, 0.08)' : 'rgba(156, 163, 175, 0.08)',
        border: `1px solid ${enabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(156, 163, 175, 0.2)'}`,
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: '14px' }}>{enabled ? '🔒' : '🔓'}</span>
      <span style={{ fontWeight: 500 }}>
        {enabled ? 'MLS E2EE' : '未加密'}
      </span>
      {enabled && epoch !== undefined && (
        <span style={{ opacity: 0.7, fontSize: '11px' }}>
          epoch:{epoch}
        </span>
      )}
      {enabled && memberCount !== undefined && (
        <span style={{ opacity: 0.7, fontSize: '11px' }}>
          {memberCount}人
        </span>
      )}
    </div>
  );
};

/**
 * 消息级加密标记
 * 显示在每条消息旁边，指示该消息是否经过 MLS 加密
 */
export const MLSMessageBadge: React.FC<{
  encrypted?: boolean;
  decryptFailed?: boolean;
  epoch?: number;
}> = ({ encrypted, decryptFailed, epoch }) => {
  if (!encrypted) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        fontSize: '10px',
        color: decryptFailed ? '#ef4444' : '#10b981',
        marginLeft: '4px',
        opacity: 0.7,
      }}
      title={
        decryptFailed
          ? '解密失败'
          : `MLS 加密 (epoch: ${epoch || '?'})`
      }
    >
      {decryptFailed ? '⚠️' : '🔒'}
    </span>
  );
};

export default MLSIndicator;
