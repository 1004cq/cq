import React, { memo, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { MediaCategory, StickerItem } from './types';
import StickerPreview from './StickerPreview';
import { stickerPrefetcher } from './stickerPrefetch';
import { collectStaticPreviewUrls, isAnimatedSticker } from './utils';

interface StickerGridProps {
  items: StickerItem[];
  panelTab: Extract<MediaCategory, 'sticker' | 'meme' | 'gif'>;
  onSelect: (item: StickerItem) => void;
}

const StickerGridItem = memo(({ item, panelTab, onSelect }: { item: StickerItem; panelTab: StickerGridProps['panelTab']; onSelect: (item: StickerItem) => void }) => (
  <motion.button
    type="button"
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.92 }}
    onClick={() => onSelect({ ...item, mediaType: item.mediaType || panelTab })}
    className={`group relative flex items-center justify-center overflow-hidden rounded-[22px] transition-colors ${panelTab === 'gif' ? 'aspect-[0.95] bg-dove-warm-gray/20 p-1.5 hover:bg-dove-warm-gray/35 dark:bg-slate-800/30 dark:hover:bg-slate-700/50' : 'aspect-square bg-white/55 p-1 hover:bg-dove-warm-gray/30 dark:bg-slate-800/20 dark:hover:bg-slate-700/40'}`}
    title={`${item.emoji} ${item.name}`}
  >
    <StickerPreview sticker={item} compact={panelTab === 'gif'} />
    {(panelTab === 'meme' || panelTab === 'gif') && (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent px-2 pb-1.5 pt-4 opacity-90">
        <div className="truncate text-[10px] font-medium text-white/92">{item.name}</div>
      </div>
    )}
  </motion.button>
));

StickerGridItem.displayName = 'StickerGridItem';

const StickerGrid: React.FC<StickerGridProps> = ({ items, panelTab, onSelect }) => {
  const pageSize = panelTab === 'gif' ? 18 : 32;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setVisibleCount(pageSize), [items, panelTab, pageSize]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= items.length || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisibleCount((count) => {
          const nextCount = Math.min(count + pageSize, items.length);
          // 预加载下一页缓冲区（Medium 优先级）
          const bufferItems = items.slice(nextCount, nextCount + pageSize);
          const bufferAnimated = bufferItems.filter(isAnimatedSticker).map(s => s.url).filter(Boolean);
          const bufferStatic = collectStaticPreviewUrls(bufferItems, pageSize);
          if (bufferAnimated.length) stickerPrefetcher.prefetch(bufferAnimated, 'medium');
          if (bufferStatic.length) stickerPrefetcher.prefetch(bufferStatic, 'medium');
          return nextCount;
        });
      }
    }, { rootMargin: '220px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, pageSize, visibleCount]);

  return (
    <>
      <div className={panelTab === 'gif' ? 'grid grid-cols-3 gap-2.5' : 'grid grid-cols-4 gap-2'}>
        {items.slice(0, visibleCount).map((item) => (
          <StickerGridItem key={`${item.mediaType || panelTab}-${item.packId || 'local'}-${item.id}`} item={item} panelTab={panelTab} onSelect={onSelect} />
        ))}
      </div>
      {visibleCount < items.length && <div ref={sentinelRef} className="h-8" aria-hidden="true" />}
    </>
  );
};

export default memo(StickerGrid);
