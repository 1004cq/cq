import React, { memo, useEffect, useMemo, useState } from 'react';
import LottieSticker from '@/components/LottieSticker';
import type { StickerItem } from './types';
import { buildImageSources, isAnimatedSticker } from './utils';

interface StickerPreviewProps {
  sticker: StickerItem;
  compact?: boolean;
  className?: string;
}

const StickerPreview: React.FC<StickerPreviewProps> = memo(({ sticker, compact = false, className = '' }) => {
  const size = compact ? 56 : 72;
  const imageSources = useMemo(
    () => buildImageSources(sticker),
    [sticker.id, sticker.url, sticker.thumbUrl],
  );
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => setImageIndex(0), [sticker.id, sticker.url, sticker.thumbUrl]);

  if (isAnimatedSticker(sticker)) {
    return (
      <LottieSticker
        src={sticker.url}
        width={size}
        height={size}
        loop
        autoplay
        fallbackEmoji={sticker.emoji}
        fallbackSrc={sticker.thumbUrl}
        className={className}
      />
    );
  }

  const currentSrc = imageSources[imageIndex] || '';
  if (!currentSrc) {
    return <div className={`${compact ? 'h-14 w-14 rounded-xl' : 'h-[72px] w-[72px] rounded-2xl'} bg-dove-warm-gray/25 ${className}`} aria-label="贴纸资源不可用" />;
  }

  return (
    <img
      src={currentSrc}
      alt={sticker.name}
      className={`${compact ? 'h-14 w-14 rounded-xl object-cover' : 'h-[72px] w-[72px] object-contain'} select-none pointer-events-none ${className}`}
      loading="lazy"
      decoding="async"
      draggable={false}
      onContextMenu={(event) => event.preventDefault()}
      onError={() => setImageIndex((previous) => Math.min(previous + 1, imageSources.length - 1))}
    />
  );
});

StickerPreview.displayName = 'StickerPreview';

export default StickerPreview;
