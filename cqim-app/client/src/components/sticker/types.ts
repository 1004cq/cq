export type MediaCategory = 'gif' | 'sticker' | 'meme' | 'emoji';

export interface StickerItem {
  id: string;
  url: string;
  emoji: string;
  name: string;
  keywords?: string[];
  format?: 'json' | 'tgs' | 'webp' | 'png' | 'jpg' | 'jpeg' | 'gif' | 'emoji';
  width?: number;
  height?: number;
  file?: string;
  packId?: string;
  packName?: string;
  mediaType?: MediaCategory;
  thumbUrl?: string;
}

export interface StickerSet {
  id: string;
  name: string;
  icon: string;
  description?: string;
  sourceType?: 'remote' | 'local';
  stickers: StickerItem[];
  stickerCount?: number;
  cover?: string;
  mediaType?: Extract<MediaCategory, 'gif' | 'sticker' | 'meme'>;
}

export interface EmojiGroup {
  id: string;
  name: string;
  icon: string;
  emojis: string[];
}

export interface StickerPanelProps {
  onStickerSelect: (sticker: StickerItem) => void;
  onClose: () => void;
}
