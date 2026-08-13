import { useCallback, useEffect, useMemo, useState } from 'react';
import { authApi } from '@/lib/authFetch';
import { stickerPrefetcher } from './stickerPrefetch';
import {
  EMOJI_GROUPS,
  FALLBACK_GIF_SETS,
  FALLBACK_MEME_SETS,
  FALLBACK_STICKER_SETS,
  MAX_RECENT,
  RECENT_EMOJIS_KEY,
  RECENT_GIFS_KEY,
  RECENT_MEMES_KEY,
  RECENT_STICKERS_KEY,
} from './catalog';
import type { MediaCategory, StickerItem, StickerSet } from './types';
import {
  addRecentEmoji,
  addRecentMedia,
  collectStaticPreviewUrls,
  matchesKeyword,
  normalizeSet,
  repartitionRecentMedia,
  safeReadArray,
  safeWriteArray,
  isAnimatedSticker,
} from './utils';

async function loadStickerSets(): Promise<StickerSet[]> {
  const data = await authApi('/api/stickers/packs?includeStickers=true');
  if (!Array.isArray(data?.packs)) throw new Error('贴纸数据格式不正确');
  const sets = data.packs.map(normalizeSet).filter((set: StickerSet) => set.stickers.length > 0);
  if (!sets.length) throw new Error('暂无可用贴纸包');
  return sets;
}

export function useStickerPacks() {
  const [panelTab, setPanelTab] = useState<MediaCategory>('sticker');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentStickers, setRecentStickers] = useState<StickerItem[]>(() => safeReadArray<StickerItem>(RECENT_STICKERS_KEY).slice(0, MAX_RECENT));
  const [recentMemes, setRecentMemes] = useState<StickerItem[]>(() => safeReadArray<StickerItem>(RECENT_MEMES_KEY).slice(0, MAX_RECENT));
  const [recentGifs, setRecentGifs] = useState<StickerItem[]>(() => safeReadArray<StickerItem>(RECENT_GIFS_KEY).slice(0, MAX_RECENT));
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => safeReadArray<string>(RECENT_EMOJIS_KEY).slice(0, MAX_RECENT));
  const [stickerSets, setStickerSets] = useState<StickerSet[]>(FALLBACK_STICKER_SETS);
  const [memeSets, setMemeSets] = useState<StickerSet[]>(FALLBACK_MEME_SETS);
  const gifSets = FALLBACK_GIF_SETS;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeStickerSetId, setActiveStickerSetId] = useState('');
  const [activeMemeSetId, setActiveMemeSetId] = useState('');
  const [activeGifSetId, setActiveGifSetId] = useState('recent');
  const [activeEmojiGroupId, setActiveEmojiGroupId] = useState('recent');

  const fetchSets = useCallback(async () => {
    setLoading(true);
    try {
      const sets = await loadStickerSets();
      const nextStickerSets = sets.filter((set) => set.mediaType !== 'meme');
      const nextMemeSets = sets.filter((set) => set.mediaType === 'meme');
      const resolvedStickers = nextStickerSets.length ? nextStickerSets : FALLBACK_STICKER_SETS;
      const resolvedMemes = nextMemeSets.length ? nextMemeSets : FALLBACK_MEME_SETS;
      setStickerSets(resolvedStickers);
      setMemeSets(resolvedMemes);
      setActiveStickerSetId((previous) => previous && resolvedStickers.some((set) => set.id === previous) ? previous : resolvedStickers[0]?.id || '');
      setActiveMemeSetId((previous) => previous && resolvedMemes.some((set) => set.id === previous) ? previous : resolvedMemes[0]?.id || 'recent');

      const { nextRecentStickers, nextRecentMemes } = repartitionRecentMedia(
        safeReadArray<StickerItem>(RECENT_STICKERS_KEY),
        safeReadArray<StickerItem>(RECENT_MEMES_KEY),
        new Set(nextStickerSets.map((set) => set.id)),
        new Set(nextMemeSets.map((set) => set.id)),
      );
      safeWriteArray(RECENT_STICKERS_KEY, nextRecentStickers);
      safeWriteArray(RECENT_MEMES_KEY, nextRecentMemes);
      setRecentStickers(nextRecentStickers);
      setRecentMemes(nextRecentMemes);
      setLoadError('');
    } catch (error) {
      setStickerSets(FALLBACK_STICKER_SETS);
      setMemeSets(FALLBACK_MEME_SETS);
      setActiveStickerSetId((previous) => previous || FALLBACK_STICKER_SETS[0]?.id || '');
      setActiveMemeSetId((previous) => previous || FALLBACK_MEME_SETS[0]?.id || 'recent');
      setLoadError(error instanceof Error ? error.message : '加载贴纸失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSets(); }, [fetchSets]);
  useEffect(() => {
    if (!activeStickerSetId && stickerSets[0]) setActiveStickerSetId(stickerSets[0].id);
  }, [activeStickerSetId, stickerSets]);
  useEffect(() => {
    if (!activeMemeSetId && memeSets[0]) setActiveMemeSetId(memeSets[0].id);
  }, [activeMemeSetId, memeSets]);
  useEffect(() => {
    if (activeGifSetId === 'recent' && recentGifs.length === 0 && gifSets[0]) setActiveGifSetId(gifSets[0].id);
  }, [activeGifSetId, gifSets, recentGifs.length]);

  const currentEmojiGroups = useMemo(
    () => EMOJI_GROUPS.map((group) => group.id === 'recent' ? { ...group, emojis: recentEmojis } : group),
    [recentEmojis],
  );
  const keyword = searchQuery.trim().toLowerCase();

  const displayStickers = useMemo(() => {
    if (keyword) return stickerSets.flatMap((set) => set.stickers.filter((item) => matchesKeyword(item, set.name, keyword)));
    if (activeStickerSetId === 'recent') return recentStickers;
    return stickerSets.find((set) => set.id === activeStickerSetId)?.stickers || [];
  }, [activeStickerSetId, keyword, recentStickers, stickerSets]);
  const displayMemes = useMemo(() => {
    if (keyword) return memeSets.flatMap((set) => set.stickers.filter((item) => matchesKeyword(item, set.name, keyword)));
    if (activeMemeSetId === 'recent') return recentMemes;
    return memeSets.find((set) => set.id === activeMemeSetId)?.stickers || [];
  }, [activeMemeSetId, keyword, memeSets, recentMemes]);
  const displayGifs = useMemo(() => {
    if (keyword) return gifSets.flatMap((set) => set.stickers.filter((item) => matchesKeyword(item, set.name, keyword)));
    if (activeGifSetId === 'recent') return recentGifs;
    return gifSets.find((set) => set.id === activeGifSetId)?.stickers || [];
  }, [activeGifSetId, gifSets, keyword, recentGifs]);
  const displayEmojis = useMemo(() => {
    const groups = currentEmojiGroups.filter((group) => group.id !== 'recent' || group.emojis.length > 0);
    if (keyword) return groups.flatMap((group) => group.emojis.filter((emoji) => emoji.includes(keyword)));
    return groups.find((group) => group.id === activeEmojiGroupId)?.emojis || [];
  }, [activeEmojiGroupId, currentEmojiGroups, keyword]);
  const groupedRecentMemes = useMemo(() => {
    const packsById = new Map(memeSets.map((set) => [set.id, set] as const));
    const grouped = new Map<string, { id: string; name: string; items: StickerItem[] }>();
    recentMemes.forEach((item) => {
      const packId = item.packId || 'unknown';
      const pack = packsById.get(packId);
      const id = pack?.id || packId;
      if (!grouped.has(id)) grouped.set(id, { id, name: pack?.name || item.packName || '其他表情包', items: [] });
      grouped.get(id)!.items.push(item);
    });
    return Array.from(grouped.values());
  }, [memeSets, recentMemes]);

  const currentMediaItems = panelTab === 'gif' ? displayGifs : panelTab === 'meme' ? displayMemes : displayStickers;
  const activeCollectionId = panelTab === 'gif' ? activeGifSetId : panelTab === 'meme' ? activeMemeSetId : panelTab === 'emoji' ? activeEmojiGroupId : activeStickerSetId;
  const activeCollections = useMemo(() => {
    if (panelTab === 'gif') return [{ id: 'recent', icon: '🕘', name: '最近使用' }, ...gifSets.map((set) => ({ id: set.id, icon: set.icon, name: set.name }))];
    if (panelTab === 'meme') return [{ id: 'recent', icon: '🕘', name: '最近使用' }, ...memeSets.map((set) => ({ id: set.id, icon: set.icon, name: set.name }))];
    if (panelTab === 'emoji') return currentEmojiGroups.filter((group) => group.id !== 'recent' || group.emojis.length > 0).map((group) => ({ id: group.id, icon: group.icon, name: group.name }));
    return [{ id: 'recent', icon: '🕘', name: '最近使用' }, ...stickerSets.map((set) => ({ id: set.id, icon: set.icon, name: set.name }))];
  }, [currentEmojiGroups, gifSets, memeSets, panelTab, stickerSets]);
  const activeContentCount = panelTab === 'gif' ? displayGifs.length : panelTab === 'meme' && activeMemeSetId === 'recent' && !keyword ? groupedRecentMemes.reduce((total, section) => total + section.items.length, 0) : panelTab === 'emoji' ? displayEmojis.length : panelTab === 'meme' ? displayMemes.length : displayStickers.length;
  const activeCollectionName = activeCollections.find((item) => item.id === activeCollectionId)?.name || '贴纸';

  useEffect(() => {
    const items = panelTab === 'gif' ? displayGifs : panelTab === 'meme' ? displayMemes : displayStickers;
    // 1. 高优先级：当前可视区（前 8-12 个）
    const highPriority = items.slice(0, panelTab === 'gif' ? 6 : 8);
    const highAnimated = highPriority.filter(isAnimatedSticker).map((item) => item.url).filter(Boolean);
    const highStatic = collectStaticPreviewUrls(highPriority, 8);
    
    // 2. 中优先级：缓冲区（接下来的 12-16 个）
    const mediumPriority = items.slice(panelTab === 'gif' ? 6 : 8, panelTab === 'gif' ? 18 : 24);
    const mediumAnimated = mediumPriority.filter(isAnimatedSticker).map((item) => item.url).filter(Boolean);
    const mediumStatic = collectStaticPreviewUrls(mediumPriority, 12);

    if (highAnimated.length) stickerPrefetcher.prefetch(highAnimated, 'high');
    if (highStatic.length) stickerPrefetcher.prefetch(highStatic, 'high');
    if (mediumAnimated.length) stickerPrefetcher.prefetch(mediumAnimated, 'medium');
    if (mediumStatic.length) stickerPrefetcher.prefetch(mediumStatic, 'medium');
  }, [displayGifs, displayMemes, displayStickers, panelTab]);

  const handleSelect = useCallback((item: StickerItem) => {
    if (item.mediaType === 'gif') setRecentGifs(addRecentMedia(RECENT_GIFS_KEY, item));
    else if (item.mediaType === 'meme') setRecentMemes(addRecentMedia(RECENT_MEMES_KEY, item));
    else setRecentStickers(addRecentMedia(RECENT_STICKERS_KEY, item));
  }, []);
  const handleEmojiSelect = useCallback((emoji: string) => setRecentEmojis(addRecentEmoji(emoji)), []);
  const selectAndNotify = useCallback((item: StickerItem, onSelect: (item: StickerItem) => void) => {
    handleSelect(item);
    onSelect(item);
  }, [handleSelect]);
  const selectEmojiAndNotify = useCallback((emoji: string, onSelect: (item: StickerItem) => void) => {
    handleEmojiSelect(emoji);
    onSelect({ id: `emoji-${emoji}`, url: '', emoji, name: emoji, format: 'emoji', mediaType: 'emoji' });
  }, [handleEmojiSelect]);
  const handleCollectionChange = useCallback((collectionId: string) => {
    setSearchQuery('');
    if (panelTab === 'gif') setActiveGifSetId(collectionId);
    else if (panelTab === 'meme') setActiveMemeSetId(collectionId);
    else if (panelTab === 'emoji') setActiveEmojiGroupId(collectionId);
    else setActiveStickerSetId(collectionId);
  }, [panelTab]);
  const handleStickerPackChange = useCallback((collectionId: string) => {
    setSearchQuery('');
    setActiveStickerSetId(collectionId);
  }, []);

  return {
    panelTab, setPanelTab, searchQuery, setSearchQuery, loading, loadError, fetchSets,
    stickerSets, memeSets, activeCollections, activeCollectionId, activeCollectionName,
    activeContentCount, currentMediaItems, displayEmojis, groupedRecentMemes,
    activeMemeSetId, handleCollectionChange, handleStickerPackChange, selectAndNotify, selectEmojiAndNotify,
  };
}
