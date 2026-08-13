import type { MediaCategory, StickerItem, StickerSet } from './types';
import {
  MAX_RECENT,
  RECENT_EMOJIS_KEY,
} from './catalog';

const preloadedStaticUrls = new Set<string>();

function scheduleIdleTask(task: () => void) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback: (callback: IdleRequestCallback) => number }).requestIdleCallback(() => task());
    return;
  }
  setTimeout(task, 32);
}

export function preloadStaticAssets(urls: string[]) {
  const nextUrls = Array.from(new Set(urls.filter(Boolean))).filter(url => !preloadedStaticUrls.has(url));
  if (nextUrls.length === 0) return;

  scheduleIdleTask(() => {
    nextUrls.forEach((url) => {
      if (!url || preloadedStaticUrls.has(url)) return;
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = url;
      preloadedStaticUrls.add(url);
    });
  });
}

export function safeReadArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function safeWriteArray<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function addRecentMedia(key: string, item: StickerItem) {
  const recent = safeReadArray<StickerItem>(key).filter(existing => existing.id !== item.id || existing.packId !== item.packId);
  recent.unshift(item);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  safeWriteArray(key, recent);
  return recent;
}

export function addRecentEmoji(emoji: string) {
  const recent = safeReadArray<string>(RECENT_EMOJIS_KEY).filter(item => item !== emoji);
  recent.unshift(emoji);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  safeWriteArray(RECENT_EMOJIS_KEY, recent);
  return recent;
}

export function isAnimatedSticker(sticker: StickerItem) {
  return sticker.format === 'json' || sticker.format === 'tgs' || sticker.url.endsWith('.json') || sticker.url.endsWith('.tgs');
}

export function getLocalPngFallback(url?: string) {
  if (!url) return '';
  return /\/api\/stickers\/files\/.+\.webp(\?.*)?$/i.test(url)
    ? url.replace(/\.webp(\?.*)?$/i, '.png$1')
    : '';
}

export function buildImageSources(sticker: StickerItem): string[] {
  return Array.from(new Set([
    sticker.thumbUrl,
    sticker.url,
    getLocalPngFallback(sticker.url),
  ].filter((value): value is string => !!value)));
}

export function pickPrioritySets(sets: StickerSet[], activeSetId: string, limit = 3) {
  if (sets.length === 0) return [] as StickerSet[];
  const activeIndex = Math.max(0, sets.findIndex(set => set.id === activeSetId));
  const candidates = [
    sets[activeIndex],
    sets[activeIndex - 1],
    sets[activeIndex + 1],
    ...sets.slice(0, limit),
  ].filter((set): set is StickerSet => Boolean(set));

  return Array.from(new Map(candidates.map(set => [set.id, set])).values()).slice(0, limit + 2);
}

export function collectStaticPreviewUrls(items: StickerItem[], limit: number) {
  return items
    .flatMap((item) => buildImageSources(item).slice(0, 2))
    .filter(Boolean)
    .slice(0, limit);
}

export function inferSetMediaType(set: any, stickers: StickerItem[]): Extract<MediaCategory, 'sticker' | 'meme'> {
  if (set?.mediaType === 'meme') return 'meme';
  if (set?.mediaType === 'sticker') return 'sticker';
  if (set?.sourceType === 'local') return 'meme';
  const hasAnimated = stickers.some(isAnimatedSticker);
  const hasStaticImage = stickers.some(item => ['webp', 'png', 'jpg', 'jpeg'].includes(String(item.format || '').toLowerCase()));
  return hasStaticImage && !hasAnimated ? 'meme' : 'sticker';
}

export function dedupeMediaItems(items: StickerItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.packId || ''}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function repartitionRecentMedia(
  stickerItems: StickerItem[],
  memeItems: StickerItem[],
  stickerPackIds: Set<string>,
  memePackIds: Set<string>,
) {
  const combined = dedupeMediaItems([...stickerItems, ...memeItems]);
  const nextRecentStickers: StickerItem[] = [];
  const nextRecentMemes: StickerItem[] = [];

  combined.forEach((item) => {
    const packId = item.packId || '';
    const resolvedMediaType: MediaCategory = memePackIds.has(packId)
      ? 'meme'
      : stickerPackIds.has(packId)
        ? 'sticker'
        : item.mediaType === 'gif'
          ? 'gif'
          : item.mediaType === 'emoji'
            ? 'emoji'
            : item.mediaType === 'meme'
              ? 'meme'
              : 'sticker';

    const normalizedItem: StickerItem = {
      ...item,
      mediaType: resolvedMediaType === 'meme' ? 'meme' : 'sticker',
      thumbUrl: item.thumbUrl || getLocalPngFallback(item.url) || undefined,
    };

    if (resolvedMediaType === 'meme') {
      nextRecentMemes.push(normalizedItem);
    } else {
      nextRecentStickers.push(normalizedItem);
    }
  });

  return {
    nextRecentStickers: nextRecentStickers.slice(0, MAX_RECENT),
    nextRecentMemes: nextRecentMemes.slice(0, MAX_RECENT),
  };
}

export function normalizeSticker(sticker: any, pack?: Partial<StickerSet>): StickerItem {
  const url = String(sticker.url || '');
  const thumbUrl = typeof sticker.thumbUrl === 'string' && sticker.thumbUrl
    ? sticker.thumbUrl
    : (getLocalPngFallback(url) || undefined);
  return {
    id: String(sticker.id || `${pack?.id || 'pack'}-${sticker.name || 'sticker'}`),
    url,
    emoji: String(sticker.emoji || '🙂'),
    name: String(sticker.name || sticker.id || '贴纸'),
    keywords: Array.isArray(sticker.keywords) ? sticker.keywords : [],
    format: sticker.format,
    width: typeof sticker.width === 'number' ? sticker.width : undefined,
    height: typeof sticker.height === 'number' ? sticker.height : undefined,
    file: typeof sticker.file === 'string' ? sticker.file : undefined,
    packId: pack?.id,
    packName: pack?.name,
    mediaType: pack?.mediaType === 'meme' ? 'meme' : 'sticker',
    thumbUrl,
  };
}

export function normalizeSet(set: any): StickerSet {
  const baseStickers = Array.isArray(set?.stickers)
    ? set.stickers.map((item: any) => normalizeSticker(item, set)).filter((item: StickerItem) => !!item.url)
    : [];
  const mediaType = inferSetMediaType(set, baseStickers);
  const stickers: StickerItem[] = baseStickers.map((item: StickerItem) => ({ ...item, mediaType }));
  return {
    id: String(set?.id || `pack-${Date.now()}`),
    name: String(set?.name || '未命名贴纸包'),
    icon: String(set?.icon || stickers[0]?.emoji || '🙂'),
    description: typeof set?.description === 'string' ? set.description : '',
    sourceType: set?.sourceType === 'local' ? 'local' : 'remote',
    stickerCount: typeof set?.stickerCount === 'number' ? set.stickerCount : stickers.length,
    cover: typeof set?.cover === 'string' ? set.cover : (stickers[0]?.thumbUrl || stickers[0]?.url),
    stickers,
    mediaType,
  };
}


export function matchesKeyword(item: StickerItem, packName: string, keyword: string) {
  if (!keyword) return true;
  const lowered = keyword.trim().toLowerCase();
  if (!lowered) return true;
  return (
    item.name.toLowerCase().includes(lowered) ||
    item.emoji.includes(lowered) ||
    (item.packName || packName || '').toLowerCase().includes(lowered) ||
    (Array.isArray(item.keywords) ? item.keywords : []).some(entry => entry.toLowerCase().includes(lowered))
  );
}

