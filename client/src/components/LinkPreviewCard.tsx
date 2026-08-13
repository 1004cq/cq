/**
 * 链接预览卡片组件
 * 自动抓取 OG/meta 元数据，展示标题、描述、图片、站点信息
 */
import React, { useState, useEffect, useRef } from 'react';
import { ExternalLink, Globe, Loader2 } from 'lucide-react';

export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
  favicon: string;
}

interface LinkPreviewCardProps {
  url: string;
  isSelf?: boolean;
  /** 是否已有缓存数据（避免重复请求） */
  cachedData?: LinkPreviewData;
  onDataLoaded?: (data: LinkPreviewData) => void;
}

// 全局内存缓存，避免重复请求同一 URL
const previewCache = new Map<string, LinkPreviewData | null>();

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({
  url,
  isSelf = false,
  cachedData,
  onDataLoaded,
}) => {
  const [data, setData] = useState<LinkPreviewData | null>(cachedData || null);
  const [loading, setLoading] = useState(!cachedData && !previewCache.has(url));
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (cachedData || fetchedRef.current) return;
    fetchedRef.current = true;

    // 检查全局缓存
    if (previewCache.has(url)) {
      const cached = previewCache.get(url) ?? null;
      setData(cached);
      setLoading(false);
      return;
    }

    const fetchPreview = async () => {
      try {
        const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error('fetch failed');
        const json: LinkPreviewData = await res.json();
        previewCache.set(url, json);
        setData(json);
        onDataLoaded?.(json);
      } catch {
        previewCache.set(url, null);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchPreview();
  }, [url, cachedData, onDataLoaded]);

  const handleClick = () => window.open(url, '_blank', 'noopener,noreferrer');

  // 加载中状态
  if (loading) {
    return (
      <div className={`mt-2 rounded-xl overflow-hidden border ${isSelf ? 'border-white/20 bg-white/10' : 'border-gray-100 bg-gray-50'} flex items-center gap-3 px-3 py-2.5 min-w-[200px]`}>
        <Loader2 size={14} className={`animate-spin flex-shrink-0 ${isSelf ? 'text-white/60' : 'text-gray-400'}`} />
        <span className={`text-xs ${isSelf ? 'text-white/60' : 'text-gray-400'}`}>正在加载预览...</span>
      </div>
    );
  }

  // 加载失败或无数据，仅显示域名
  if (error || !data) {
    let hostname = url;
    try { hostname = new URL(url).hostname; } catch {}
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2 ${isSelf ? 'text-white/80 hover:text-white' : 'text-blue-500 hover:text-blue-600'}`}
        onClick={e => e.stopPropagation()}
      >
        <Globe size={11} />
        {hostname}
      </a>
    );
  }

  const hasImage = data.image && data.image.length > 0;

  return (
    <button
      onClick={handleClick}
      className={`mt-2 rounded-xl overflow-hidden border text-left w-full max-w-[280px] transition-all active:scale-[0.98] ${
        isSelf
          ? 'border-white/20 bg-white/10 hover:bg-white/15'
          : 'border-gray-100 bg-white hover:bg-gray-50 shadow-sm'
      }`}
    >
      {/* 预览图 */}
      {hasImage && (
        <div className="w-full h-[140px] overflow-hidden bg-gray-100">
          <img
            src={data.image}
            alt={data.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* 内容区 */}
      <div className="px-3 py-2.5">
        {/* 站点信息 */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <img
            src={data.favicon}
            alt=""
            className="w-3.5 h-3.5 rounded-sm flex-shrink-0"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className={`text-[10px] truncate ${isSelf ? 'text-white/50' : 'text-gray-400'}`}>
            {data.siteName}
          </span>
          <ExternalLink size={9} className={`flex-shrink-0 ml-auto ${isSelf ? 'text-white/30' : 'text-gray-300'}`} />
        </div>

        {/* 标题 */}
        <p className={`text-xs font-semibold leading-snug line-clamp-2 mb-1 ${isSelf ? 'text-white' : 'text-gray-900'}`}>
          {data.title}
        </p>

        {/* 描述 */}
        {data.description && (
          <p className={`text-[11px] leading-relaxed line-clamp-2 ${isSelf ? 'text-white/60' : 'text-gray-500'}`}>
            {data.description}
          </p>
        )}
      </div>
    </button>
  );
};

/**
 * 从文本中提取第一个 URL
 */
export function extractUrl(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

/**
 * 判断文本是否为纯 URL（整条消息就是一个链接）
 */
export function isPureUrl(text: string): boolean {
  const trimmed = text.trim();
  try {
    new URL(trimmed);
    return /^https?:\/\/\S+$/.test(trimmed);
  } catch {
    return false;
  }
}

/**
 * 将文本中的 URL 渲染为可点击链接
 */
export function renderTextWithLinks(text: string, isSelf: boolean): React.ReactNode {
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
  const parts = text.split(urlRegex);

  return parts.map((part, i) => {
    if (urlRegex.test(part)) {
      urlRegex.lastIndex = 0;
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className={`underline underline-offset-2 break-all ${isSelf ? 'text-white/90 hover:text-white' : 'text-blue-500 hover:text-blue-600'}`}
          onClick={e => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}
