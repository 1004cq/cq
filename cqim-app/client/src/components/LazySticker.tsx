import React, { useState, useEffect, useRef } from 'react';
import StickerPreview from './StickerPreview';
import { StickerItem } from '../types/sticker';

interface LazyStickerProps {
  sticker: StickerItem;
  onClick: (sticker: StickerItem) => void;
}

const LazySticker: React.FC<LazyStickerProps> = ({ sticker, onClick }) => {
  const [isIntersecting, setIntersecting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIntersecting(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative aspect-square w-full">
      {isIntersecting ? (
        <button
          type="button"
          onClick={() => onClick(sticker)}
          className="group relative flex h-full w-full items-center justify-center rounded-xl p-1.5 transition-all hover:bg-black/5 active:scale-95 dark:hover:bg-white/5"
        >
          <StickerPreview sticker={sticker} />
        </button>
      ) : (
        <div className="h-full w-full animate-pulse rounded-xl bg-muted/20" />
      )}
    </div>
  );
};

export default LazySticker;
