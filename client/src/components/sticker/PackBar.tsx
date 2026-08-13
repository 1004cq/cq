import React, { memo } from 'react';
import type { MediaCategory, StickerItem, StickerSet } from './types';
import StickerPreview from './StickerPreview';

interface CollectionItem {
  id: string;
  icon: string;
  name: string;
}

interface PackBarProps {
  panelTab: MediaCategory;
  collections: CollectionItem[];
  activeCollectionId: string;
  stickerSets: StickerSet[];
  memeSets: StickerSet[];
  onChange: (collectionId: string) => void;
}

const PackBar: React.FC<PackBarProps> = ({ panelTab, collections, activeCollectionId, stickerSets, memeSets, onChange }) => (
  <div className="mb-2 flex items-center gap-1 overflow-x-auto px-1 scrollbar-hide" role="tablist" aria-label="贴纸包">
    {collections.map((item) => {
      const isActive = activeCollectionId === item.id;
      const stickerSet = panelTab === 'sticker'
        ? stickerSets.find((set) => set.id === item.id)
        : panelTab === 'meme'
          ? memeSets.find((set) => set.id === item.id)
          : undefined;
      const coverSticker: StickerItem | undefined = stickerSet?.stickers[0];
      const coverSrc = stickerSet?.cover || coverSticker?.thumbUrl || coverSticker?.url;

      return (
        <button
          key={`${panelTab}-${item.id}`}
          type="button"
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(item.id)}
          className={`relative flex h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-2xl border transition-all ${isActive ? 'border-dove-green/35 bg-dove-green/10 shadow-[0_4px_14px_rgba(34,197,94,0.14)] dark:border-sky-400/35 dark:bg-sky-400/10' : 'border-transparent bg-transparent text-muted-foreground hover:bg-dove-warm-gray/45 dark:hover:bg-slate-800/65'}`}
          title={item.name}
        >
          {(panelTab === 'sticker' || panelTab === 'meme') && item.id !== 'recent' && coverSticker ? (
            <div className="pointer-events-none scale-[0.58]">
              <StickerPreview sticker={{ ...coverSticker, thumbUrl: coverSrc || coverSticker.thumbUrl }} compact={false} />
            </div>
          ) : (
            <span className={`text-lg ${isActive ? 'scale-110' : ''}`}>{item.icon}</span>
          )}
        </button>
      );
    })}
  </div>
);

export default memo(PackBar);
