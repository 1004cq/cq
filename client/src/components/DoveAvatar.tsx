/**
 * DoveIM 头像组件 — 精致升级版
 * 支持首字母头像、图片头像、群聊头像与数值尺寸
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Users } from 'lucide-react';
import { getInitials, getAvatarColor } from '@/lib/store';

export interface DoveAvatarProps {
  name: string;
  id?: string;
  avatar?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  className?: string;
  onClick?: () => void;
  isGroup?: boolean;
}

const presetSizeMap = {
  sm: { className: 'w-8 h-8 text-xs', px: 32 },
  md: { className: 'w-10 h-10 text-sm', px: 40 },
  lg: { className: 'w-12 h-12 text-base', px: 48 },
  xl: { className: 'w-16 h-16 text-xl', px: 64 },
} as const;

function resolveSize(size: DoveAvatarProps['size']) {
  if (typeof size === 'number') {
    return {
      className: '',
      style: {
        width: size,
        height: size,
        fontSize: Math.max(12, Math.round(size * 0.35)),
      } as React.CSSProperties,
      px: size,
    };
  }

  const preset = presetSizeMap[size ?? 'md'];
  return {
    className: preset.className,
    style: undefined,
    px: preset.px,
  };
}

/** 给 COS 代理 URL 添加缓存破坏参数，避免浏览器/CDN 缓存旧的失败响应 */
function appendCacheBuster(url: string): string {
  if (!url || !url.includes('/api/cos/proxy/')) return url;
  const sep = url.includes('?') ? '&' : '?';
  // 使用 10 分钟粒度的时间戳，平衡缓存命中率与及时性
  const bucket = Math.floor(Date.now() / 600000);
  return `${url}${sep}_v=${bucket}`;
}

const MAX_RETRY = 3;
const RETRY_DELAY = 1000;

export const DoveAvatar: React.FC<DoveAvatarProps> = ({
  name,
  id,
  avatar,
  size = 'md',
  className = '',
  onClick,
  isGroup = false,
}) => {
  const [imgSrc, setImgSrc] = useState(() => appendCacheBuster(avatar || ''));
  const [imgFailed, setImgFailed] = useState(false);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    retryCountRef.current = 0;
    setImgFailed(false);
    setImgSrc(appendCacheBuster(avatar || ''));
  }, [avatar]);

  const handleError = useCallback(() => {
    if (!mountedRef.current) return;

    // 官方/AI 头像 fallback 到本地图片
    if ((id === 'BOT' || name === 'imim AI') && imgSrc !== '/imim-ai-avatar.jpg') {
      setImgSrc('/imim-ai-avatar.jpg');
      return;
    }
    if ((id === 'official' || name === 'imim 官方') && imgSrc !== '/imim-official-avatar.jpg') {
      setImgSrc('/imim-official-avatar.jpg');
      return;
    }

    // 对 COS 代理头像进行自动重试（最多1次）
    if (avatar && avatar.includes('/api/cos/proxy/') && retryCountRef.current < MAX_RETRY) {
      retryCountRef.current += 1;
      const delay = RETRY_DELAY * retryCountRef.current;
      setTimeout(() => {
        if (!mountedRef.current) return;
        const sep = avatar.includes('?') ? '&' : '?';
        setImgSrc(`${avatar}${sep}_r=${Date.now()}`);
      }, delay);
      return;
    }

    // 所有重试都失败，显示首字母 fallback
    setImgSrc('');
    setImgFailed(true);
  }, [avatar, id, name, imgSrc]);

  const { className: sizeClassName, style: sizeStyle, px } = resolveSize(size);
  const colorSeed = id || name || 'avatar';
  const color = getAvatarColor(colorSeed);
  const initial = getInitials(name || '?');
  const iconSize = Math.max(14, Math.round(px * 0.42));
  const sharedClassName = `${sizeClassName} rounded-2xl flex items-center justify-center flex-shrink-0 select-none overflow-hidden shadow-soft-sm ${onClick ? 'cursor-pointer active:scale-95 transition-transform' : ''} ${className}`.trim();

  // 有图片 URL 且未确认失败 → 尝试渲染图片
  if (imgSrc && !imgFailed) {
    return (
      <div
        onClick={onClick}
        className={sharedClassName}
        style={sizeStyle}
      >
        <img
          src={imgSrc}
          alt={name}
          className="w-full h-full object-cover"
          onError={handleError}
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  // Fallback: 首字母头像
  return (
    <div
      onClick={onClick}
      className={`${sharedClassName} font-semibold text-white`}
      style={{
        ...sizeStyle,
        background: isGroup
          ? `linear-gradient(135deg, ${color}ee, ${color}aa)`
          : `linear-gradient(135deg, ${color}, ${color}dd)`,
        fontFamily: 'var(--font-wenkai)',
        textShadow: '0 1px 2px rgba(0,0,0,0.1)',
      }}
    >
      {isGroup ? <Users size={iconSize} /> : initial}
    </div>
  );
};
