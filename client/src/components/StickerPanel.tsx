/**
 * StickerPanel — Telegram 风格素材面板
 * 支持贴纸 / 表情包 / GIF 动图 / 表情四分类，优先从后端贴纸 API 拉取贴纸包，失败时回退到内置素材。
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AddStickerSheet from '@/components/AddStickerSheet';
import LottieSticker, { preloadStickers } from '@/components/LottieSticker';
import { authApi } from '@/lib/authFetch';
import { X, Search, Sparkles, Sticker, Loader2, RefreshCw, SmilePlus, Image as ImageIcon, Plus } from 'lucide-react';

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

interface EmojiGroup {
  id: string;
  name: string;
  icon: string;
  emojis: string[];
}

const FALLBACK_STICKER_SETS: StickerSet[] = [
  {
    id: 'emoji_animated',
    name: '动态表情',
    icon: '😀',
    sourceType: 'remote',
    mediaType: 'sticker',
    stickers: [
      { id: 's1', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '😀', name: '开心', format: 'json', mediaType: 'sticker' },
      { id: 's2', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '❤️', name: '爱心', format: 'json', mediaType: 'sticker' },
      { id: 's3', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '👍', name: '点赞', format: 'json', mediaType: 'sticker' },
      { id: 's4', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🎉', name: '庆祝', format: 'json', mediaType: 'sticker' },
      { id: 's5', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '🔥', name: '火焰', format: 'json', mediaType: 'sticker' },
      { id: 's6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '⭐', name: '星星', format: 'json', mediaType: 'sticker' },
      { id: 's7', url: 'https://assets8.lottiefiles.com/packages/lf20_kkflmtur.json', emoji: '🎵', name: '音乐', format: 'json', mediaType: 'sticker' },
      { id: 's8', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💬', name: '聊天', format: 'json', mediaType: 'sticker' },
    ],
  },
  {
    id: 'cute_animals',
    name: '可爱动物',
    icon: '🐱',
    sourceType: 'remote',
    mediaType: 'sticker',
    stickers: [
      { id: 'a1', url: 'https://assets9.lottiefiles.com/packages/lf20_syqnfe7c.json', emoji: '🐱', name: '猫咪', format: 'json', mediaType: 'sticker' },
      { id: 'a2', url: 'https://assets3.lottiefiles.com/packages/lf20_gzl797gs.json', emoji: '🐶', name: '小狗', format: 'json', mediaType: 'sticker' },
      { id: 'a3', url: 'https://assets3.lottiefiles.com/packages/lf20_gzl797gs.json', emoji: '🐼', name: '熊猫', format: 'json', mediaType: 'sticker' },
      { id: 'a4', url: 'https://assets6.lottiefiles.com/packages/lf20_OT15QW.json', emoji: '🦋', name: '蝴蝶', format: 'json', mediaType: 'sticker' },
      { id: 'a5', url: 'https://assets6.lottiefiles.com/packages/lf20_OT15QW.json', emoji: '🐦', name: '小鸟', format: 'json', mediaType: 'sticker' },
      { id: 'a6', url: 'https://assets7.lottiefiles.com/packages/lf20_M9p23l.json', emoji: '🐠', name: '小鱼', format: 'json', mediaType: 'sticker' },
      { id: 'a7', url: 'https://assets4.lottiefiles.com/packages/lf20_jR229r.json', emoji: '🦊', name: '狐狸', format: 'json', mediaType: 'sticker' },
      { id: 'a8', url: 'https://assets7.lottiefiles.com/packages/lf20_M9p23l.json', emoji: '🐰', name: '兔子', format: 'json', mediaType: 'sticker' },
    ],
  },
  {
    id: 'gestures',
    name: '手势动作',
    icon: '👋',
    sourceType: 'remote',
    mediaType: 'sticker',
    stickers: [
      { id: 'g1', url: 'https://assets4.lottiefiles.com/packages/lf20_jR229r.json', emoji: '👋', name: '挥手', format: 'json', mediaType: 'sticker' },
      { id: 'g2', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '👏', name: '鼓掌', format: 'json', mediaType: 'sticker' },
      { id: 'g3', url: 'https://assets8.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '✌️', name: '胜利', format: 'json', mediaType: 'sticker' },
      { id: 'g4', url: 'https://assets1.lottiefiles.com/packages/lf20_obhph3sh.json', emoji: '🤝', name: '握手', format: 'json', mediaType: 'sticker' },
      { id: 'g5', url: 'https://assets3.lottiefiles.com/packages/lf20_touohxv0.json', emoji: '💪', name: '加油', format: 'json', mediaType: 'sticker' },
      { id: 'g6', url: 'https://assets7.lottiefiles.com/packages/lf20_xlmz9xwm.json', emoji: '🙏', name: '祈祷', format: 'json', mediaType: 'sticker' },
    ],
  },
  {
    id: 'love_romance',
    name: '爱情浪漫',
    icon: '💕',
    sourceType: 'remote',
    mediaType: 'sticker',
    stickers: [
      { id: 'l1', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '💖', name: '心跳', format: 'json', mediaType: 'sticker' },
      { id: 'l2', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '😍', name: '花痴', format: 'json', mediaType: 'sticker' },
      { id: 'l3', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '💝', name: '礼物心', format: 'json', mediaType: 'sticker' },
      { id: 'l4', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🥰', name: '甜蜜', format: 'json', mediaType: 'sticker' },
      { id: 'l5', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💌', name: '情书', format: 'json', mediaType: 'sticker' },
      { id: 'l6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '✨', name: '闪耀', format: 'json', mediaType: 'sticker' },
    ],
  },
];

const RAW_FALLBACK_GIF_SETS: StickerSet[] = [
  {
    id: 'gif_reactions',
    name: '热门反应',
    icon: '🔥',
    description: '高频情绪表达 GIF',
    sourceType: 'remote',
    mediaType: 'gif',
    stickers: [
      { id: 'gif-1', url: 'https://media.giphy.com/media/l0HlvtIPzPdt2usKs/giphy.gif', emoji: '😂', name: '开心大笑', format: 'gif', keywords: ['笑', '开心', '欢乐'], mediaType: 'gif' },
      { id: 'gif-2', url: 'https://media.giphy.com/media/l0HlvtIPzPdt2usKs/giphy.gif', emoji: '👏', name: '鼓掌', format: 'gif', keywords: ['鼓掌', '支持', '赞'], mediaType: 'gif' },
      { id: 'gif-3', url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', emoji: '🥳', name: '庆祝', format: 'gif', keywords: ['庆祝', '派对', '开心'], mediaType: 'gif' },
      { id: 'gif-4', url: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif', emoji: '❤️', name: '爱心', format: 'gif', keywords: ['爱心', '喜欢', '心动'], mediaType: 'gif' },
      { id: 'gif-5', url: 'https://media.giphy.com/media/3oz8xIsloV7zOmt81G/giphy.gif', emoji: '😮', name: '震惊', format: 'gif', keywords: ['震惊', '惊讶'], mediaType: 'gif' },
      { id: 'gif-6', url: 'https://media.giphy.com/media/9Y5BbDSkSTiY8/giphy.gif', emoji: '👍', name: '点赞', format: 'gif', keywords: ['点赞', '支持'], mediaType: 'gif' },
    ],
  },
  {
    id: 'gif_cute',
    name: '可爱日常',
    icon: '🐾',
    description: '适合聊天场景的萌系 GIF',
    sourceType: 'remote',
    mediaType: 'gif',
    stickers: [
      { id: 'gif-7', url: 'https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif', emoji: '🐱', name: '猫咪打滚', format: 'gif', keywords: ['猫', '可爱', '卖萌'], mediaType: 'gif' },
      { id: 'gif-8', url: 'https://media.giphy.com/media/13borq7Zo2kulO/giphy.gif', emoji: '🐶', name: '狗狗问好', format: 'gif', keywords: ['狗狗', '你好', '可爱'], mediaType: 'gif' },
      { id: 'gif-9', url: 'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif', emoji: '😴', name: '困困', format: 'gif', keywords: ['困', '睡觉', '晚安'], mediaType: 'gif' },
      { id: 'gif-10', url: 'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif', emoji: '🤗', name: '抱抱', format: 'gif', keywords: ['抱抱', '安慰'], mediaType: 'gif' },
      { id: 'gif-11', url: 'https://media.giphy.com/media/YTbZzCkRQCEJa/giphy.gif', emoji: '😘', name: '飞吻', format: 'gif', keywords: ['亲亲', '飞吻'], mediaType: 'gif' },
      { id: 'gif-12', url: 'https://media.giphy.com/media/QAsBwSjx9zVKoGp9nr/giphy.gif', emoji: '👋', name: '挥手', format: 'gif', keywords: ['挥手', '打招呼'], mediaType: 'gif' },
    ],
  },
  {
    id: 'gif_mood',
    name: '情绪状态',
    icon: '✨',
    description: '表达心情与状态的 GIF',
    sourceType: 'remote',
    mediaType: 'gif',
    stickers: [
      { id: 'gif-13', url: 'https://media.giphy.com/media/3orieTfp1MeFLiBQR2/giphy.gif', emoji: '🤦', name: '无语', format: 'gif', keywords: ['无语', '无奈'], mediaType: 'gif' },
      { id: 'gif-14', url: 'https://media.giphy.com/media/1BXa2alBjrCXC/giphy.gif', emoji: '😭', name: '哭哭', format: 'gif', keywords: ['哭', '难过'], mediaType: 'gif' },
      { id: 'gif-15', url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif', emoji: '🤩', name: '眼前一亮', format: 'gif', keywords: ['喜欢', '惊喜'], mediaType: 'gif' },
      { id: 'gif-16', url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif', emoji: '🙌', name: '太棒了', format: 'gif', keywords: ['太棒', '开心'], mediaType: 'gif' },
      { id: 'gif-17', url: 'https://media.giphy.com/media/3o6fJ1BM7R2EBRDnxK/giphy.gif', emoji: '😎', name: '酷', format: 'gif', keywords: ['酷', '得意'], mediaType: 'gif' },
      { id: 'gif-18', url: 'https://media.giphy.com/media/26BRuo6sLetdllPAQ/giphy.gif', emoji: '🤝', name: '安排', format: 'gif', keywords: ['安排', '合作', '成交'], mediaType: 'gif' },
    ],
  },
];

// 直接使用原始 Giphy CDN 地址，避免本地路径不存在导致 404
const FALLBACK_GIF_SETS: StickerSet[] = RAW_FALLBACK_GIF_SETS;

const FALLBACK_MEME_SETS: StickerSet[] = [
  {
    id: 'meme_daily',
    name: '日常回复',
    icon: '🤣',
    sourceType: 'local',
    mediaType: 'meme',
    stickers: [
      { id: 'meme-1', url: 'https://dummyimage.com/512x512/fef3c7/92400e.png&text=%E6%94%B6%E5%88%B0', emoji: '👌', name: '收到', format: 'png', keywords: ['收到', 'ok', '明白'], mediaType: 'meme' },
      { id: 'meme-2', url: 'https://dummyimage.com/512x512/dbeafe/1d4ed8.png&text=%E5%AE%89%E6%8E%92', emoji: '🤝', name: '安排', format: 'png', keywords: ['安排', '稳', '交给我'], mediaType: 'meme' },
      { id: 'meme-3', url: 'https://dummyimage.com/512x512/fee2e2/b91c1c.png&text=%E5%93%88%E5%93%88', emoji: '😂', name: '哈哈', format: 'png', keywords: ['哈哈', '笑死', '大笑'], mediaType: 'meme' },
      { id: 'meme-4', url: 'https://dummyimage.com/512x512/e9d5ff/7e22ce.png&text=%E6%88%91%E5%A4%AA%E9%9A%BE%E4%BA%86', emoji: '😭', name: '我太难了', format: 'png', keywords: ['太难了', '委屈', '崩溃'], mediaType: 'meme' },
    ],
  },
  {
    id: 'meme_mood',
    name: '情绪表达',
    icon: '🥹',
    sourceType: 'local',
    mediaType: 'meme',
    stickers: [
      { id: 'meme-5', url: 'https://dummyimage.com/512x512/dcfce7/166534.png&text=%E5%A4%AA%E6%A3%92%E4%BA%86', emoji: '🥳', name: '太棒了', format: 'png', keywords: ['太棒了', '庆祝', '开心'], mediaType: 'meme' },
      { id: 'meme-6', url: 'https://dummyimage.com/512x512/fce7f3/be185d.png&text=%E4%B8%8D%E8%A6%81%E5%95%8A', emoji: '😱', name: '不要啊', format: 'png', keywords: ['不要', '震惊', '拒绝'], mediaType: 'meme' },
      { id: 'meme-7', url: 'https://dummyimage.com/512x512/e0f2fe/0369a1.png&text=%E7%A8%8D%E7%AD%89', emoji: '⏳', name: '稍等', format: 'png', keywords: ['稍等', '等会', '马上'], mediaType: 'meme' },
      { id: 'meme-8', url: 'https://dummyimage.com/512x512/f3e8ff/6b21a8.png&text=%E7%BB%99%E4%BD%A0%E6%AF%94%E5%BF%83', emoji: '💜', name: '给你比心', format: 'png', keywords: ['比心', '喜欢', '爱你'], mediaType: 'meme' },
    ],
  },
];

const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'recent',
    name: '最近',
    icon: '🕘',
    emojis: [],
  },
  {
    id: 'faces',
    name: '笑脸',
    icon: '😊',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲'],
  },
  {
    id: 'gestures',
    name: '手势',
    icon: '👍',
    emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👋','🤚','👏','🙌','🙏','💪','🫶','🤝'],
  },
  {
    id: 'hearts',
    name: '爱心',
    icon: '❤️',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💖','💘','💝','💞','💕','💓','💗'],
  },
  {
    id: 'moods',
    name: '情绪',
    icon: '🎉',
    emojis: ['🎉','🎊','🎁','🎈','🎀','🎵','🎶','🔥','⭐','✨','💯','💢','🤯','🥳','😭','😤'],
  },
];

const RECENT_STICKERS_KEY = 'imim_recent_stickers';
const RECENT_MEMES_KEY = 'imim_recent_memes';
const RECENT_GIFS_KEY = 'imim_recent_gifs';
const RECENT_EMOJIS_KEY = 'imim_recent_emojis';
const MAX_RECENT = 24;
const preloadedStaticUrls = new Set<string>();

function scheduleIdleTask(task: () => void) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback: (callback: IdleRequestCallback) => number }).requestIdleCallback(() => task());
    return;
  }
  window.setTimeout(task, 32);
}

function preloadStaticAssets(urls: string[]) {
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

function safeReadArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function safeWriteArray<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

function addRecentMedia(key: string, item: StickerItem) {
  const recent = safeReadArray<StickerItem>(key).filter(existing => existing.id !== item.id || existing.packId !== item.packId);
  recent.unshift(item);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  safeWriteArray(key, recent);
  return recent;
}

function addRecentEmoji(emoji: string) {
  const recent = safeReadArray<string>(RECENT_EMOJIS_KEY).filter(item => item !== emoji);
  recent.unshift(emoji);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  safeWriteArray(RECENT_EMOJIS_KEY, recent);
  return recent;
}

function isAnimatedSticker(sticker: StickerItem) {
  return sticker.format === 'json' || sticker.format === 'tgs' || sticker.url.endsWith('.json') || sticker.url.endsWith('.tgs');
}

function getLocalPngFallback(url?: string) {
  if (!url) return '';
  return /\/api\/stickers\/files\/.+\.webp(\?.*)?$/i.test(url)
    ? url.replace(/\.webp(\?.*)?$/i, '.png$1')
    : '';
}

function buildImageSources(sticker: StickerItem): string[] {
  return Array.from(new Set([
    sticker.thumbUrl,
    sticker.url,
    getLocalPngFallback(sticker.url),
  ].filter((value): value is string => !!value)));
}

function pickPrioritySets(sets: StickerSet[], activeSetId: string, limit = 3) {
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

function collectStaticPreviewUrls(items: StickerItem[], limit: number) {
  return items
    .flatMap((item) => buildImageSources(item).slice(0, 2))
    .filter(Boolean)
    .slice(0, limit);
}

function inferSetMediaType(set: any, stickers: StickerItem[]): Extract<MediaCategory, 'sticker' | 'meme'> {
  if (set?.mediaType === 'meme') return 'meme';
  if (set?.mediaType === 'sticker') return 'sticker';
  if (set?.sourceType === 'local') return 'meme';
  const hasAnimated = stickers.some(isAnimatedSticker);
  const hasStaticImage = stickers.some(item => ['webp', 'png', 'jpg', 'jpeg'].includes(String(item.format || '').toLowerCase()));
  return hasStaticImage && !hasAnimated ? 'meme' : 'sticker';
}

function dedupeMediaItems(items: StickerItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.packId || ''}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function repartitionRecentMedia(
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

function normalizeSticker(sticker: any, pack?: Partial<StickerSet>): StickerItem {
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

function normalizeSet(set: any): StickerSet {
  const baseStickers = Array.isArray(set?.stickers)
    ? set.stickers.map((item: any) => normalizeSticker(item, set)).filter((item: StickerItem) => !!item.url)
    : [];
  const mediaType = inferSetMediaType(set, baseStickers);
  const stickers = baseStickers.map((item) => ({ ...item, mediaType }));
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

async function loadStickerSets(): Promise<StickerSet[]> {
  const data = await authApi('/api/stickers/packs?includeStickers=true');
  if (!Array.isArray(data?.packs)) throw new Error('贴纸数据格式不正确');
  const sets = data.packs.map(normalizeSet).filter((set: StickerSet) => set.stickers.length > 0);
  if (!sets.length) throw new Error('暂无可用贴纸包');
  return sets;
}

function matchesKeyword(item: StickerItem, packName: string, keyword: string) {
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

interface StickerPanelProps {
  onStickerSelect: (sticker: StickerItem) => void;
  onClose: () => void;
}

const StickerPreview: React.FC<{ sticker: StickerItem; compact?: boolean }> = ({ sticker, compact = false }) => {
  const size = compact ? 56 : 72;
  const imageSources = useMemo(() => buildImageSources(sticker), [sticker.id, sticker.url, sticker.thumbUrl]);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    setImageIndex(0);
  }, [sticker.id, sticker.url, sticker.thumbUrl]);

  if (isAnimatedSticker(sticker)) {
    return (
      <LottieSticker
        src={sticker.url}
        width={size}
        height={size}
        loop={true}
        autoplay={true}
        fallbackEmoji={sticker.emoji}
      />
    );
  }

  const currentSrc = imageSources[imageIndex] || '';
  if (!currentSrc) {
    return <div className={compact ? 'w-14 h-14 rounded-xl bg-dove-warm-gray/25' : 'w-[72px] h-[72px] rounded-2xl bg-dove-warm-gray/25'} />;
  }

  return (
    <img
      src={currentSrc}
      alt={sticker.name}
      className={compact ? 'w-14 h-14 object-cover rounded-xl select-none pointer-events-none' : 'w-[72px] h-[72px] object-contain select-none pointer-events-none'}
      loading="lazy"
      decoding="async"
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      onError={() => {
        setImageIndex((prev) => (prev < imageSources.length - 1 ? prev + 1 : prev));
      }}
    />
  );
};

const StickerPanel: React.FC<StickerPanelProps> = ({ onStickerSelect, onClose }) => {
  const [panelTab, setPanelTab] = useState<MediaCategory>('sticker');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentStickers, setRecentStickers] = useState<StickerItem[]>(() => safeReadArray<StickerItem>(RECENT_STICKERS_KEY));
  const [recentMemes, setRecentMemes] = useState<StickerItem[]>(() => safeReadArray<StickerItem>(RECENT_MEMES_KEY));
  const [recentGifs, setRecentGifs] = useState<StickerItem[]>(() => safeReadArray<StickerItem>(RECENT_GIFS_KEY));
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => safeReadArray<string>(RECENT_EMOJIS_KEY));
  const [stickerSets, setStickerSets] = useState<StickerSet[]>(FALLBACK_STICKER_SETS);
  const [memeSets, setMemeSets] = useState<StickerSet[]>(FALLBACK_MEME_SETS);
  const [gifSets] = useState<StickerSet[]>(FALLBACK_GIF_SETS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [activeStickerSetId, setActiveStickerSetId] = useState<string>('');
  const [activeMemeSetId, setActiveMemeSetId] = useState<string>('');
  const [activeGifSetId, setActiveGifSetId] = useState<string>('recent');
  const [activeEmojiGroupId, setActiveEmojiGroupId] = useState<string>('recent');
  const [showAddSheet, setShowAddSheet] = useState(false);

  const fetchSets = useCallback(async () => {
    setLoading(true);
    try {
      const sets = await loadStickerSets();
      const nextStickerSets = sets.filter(set => set.mediaType !== 'meme');
      const nextMemeSets = sets.filter(set => set.mediaType === 'meme');
      setStickerSets(nextStickerSets.length > 0 ? nextStickerSets : FALLBACK_STICKER_SETS);
      setMemeSets(nextMemeSets.length > 0 ? nextMemeSets : FALLBACK_MEME_SETS);
      setActiveStickerSetId(prev => prev && nextStickerSets.some(set => set.id === prev) ? prev : nextStickerSets[0]?.id || FALLBACK_STICKER_SETS[0]?.id || '');
      setActiveMemeSetId(prev => prev && prev !== 'recent' && nextMemeSets.some(set => set.id === prev) ? prev : nextMemeSets[0]?.id || FALLBACK_MEME_SETS[0]?.id || 'recent');

      const stickerPackIds = new Set(nextStickerSets.map(set => set.id));
      const memePackIds = new Set(nextMemeSets.map(set => set.id));
      const { nextRecentStickers, nextRecentMemes } = repartitionRecentMedia(
        safeReadArray<StickerItem>(RECENT_STICKERS_KEY),
        safeReadArray<StickerItem>(RECENT_MEMES_KEY),
        stickerPackIds,
        memePackIds,
      );
      safeWriteArray(RECENT_STICKERS_KEY, nextRecentStickers);
      safeWriteArray(RECENT_MEMES_KEY, nextRecentMemes);
      setRecentStickers(nextRecentStickers);
      setRecentMemes(nextRecentMemes);
      setLoadError('');
    } catch (error) {
      console.error('[StickerPanel] 加载贴纸包失败:', error);
      setStickerSets(FALLBACK_STICKER_SETS);
      setMemeSets(FALLBACK_MEME_SETS);
      setActiveStickerSetId(prev => prev || FALLBACK_STICKER_SETS[0]?.id || '');
      setActiveMemeSetId(prev => (prev && prev !== 'recent') ? prev : (FALLBACK_MEME_SETS[0]?.id || 'recent'));

      const fallbackStickerPackIds = new Set(FALLBACK_STICKER_SETS.map(set => set.id));
      const fallbackMemePackIds = new Set(FALLBACK_MEME_SETS.map(set => set.id));
      const { nextRecentStickers, nextRecentMemes } = repartitionRecentMedia(
        safeReadArray<StickerItem>(RECENT_STICKERS_KEY),
        safeReadArray<StickerItem>(RECENT_MEMES_KEY),
        fallbackStickerPackIds,
        fallbackMemePackIds,
      );
      safeWriteArray(RECENT_STICKERS_KEY, nextRecentStickers);
      safeWriteArray(RECENT_MEMES_KEY, nextRecentMemes);
      setRecentStickers(nextRecentStickers);
      setRecentMemes(nextRecentMemes);
      setLoadError(error instanceof Error ? error.message : '加载贴纸失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSets();
  }, [fetchSets]);

  useEffect(() => {
    if (!activeStickerSetId && stickerSets[0]) {
      setActiveStickerSetId(stickerSets[0].id);
    }
  }, [activeStickerSetId, stickerSets]);

  useEffect(() => {
    if ((!activeMemeSetId || activeMemeSetId === 'recent') && memeSets[0]) {
      setActiveMemeSetId((current) => {
        if (current && current !== 'recent' && memeSets.some(set => set.id === current)) return current;
        if (current === 'recent' && recentMemes.length > 0) return current;
        return memeSets[0].id;
      });
    }
  }, [activeMemeSetId, memeSets, recentMemes.length]);

  useEffect(() => {
    if (activeGifSetId === 'recent' && recentGifs.length === 0 && gifSets[0]) {
      setActiveGifSetId(gifSets[0].id);
    }
  }, [activeGifSetId, gifSets, recentGifs.length]);

  const stickerAnimationPreloadUrls = useMemo(() => {
    const prioritizedSets = pickPrioritySets(stickerSets, activeStickerSetId, 3);

    const recentAnimated = recentStickers
      .filter(isAnimatedSticker)
      .slice(0, 8)
      .map(sticker => sticker.url);

    const packAnimated = prioritizedSets.flatMap((set) => (
      set.stickers
        .filter(isAnimatedSticker)
        .slice(0, 6)
        .map(sticker => sticker.url)
    ));

    const animatedCovers = prioritizedSets
      .map(set => set.cover)
      .filter((cover): cover is string => Boolean(cover) && (/\.json(\?.*)?$/i.test(cover) || /\.tgs(\?.*)?$/i.test(cover)));

    return Array.from(new Set([...recentAnimated, ...animatedCovers, ...packAnimated].filter(Boolean)));
  }, [activeStickerSetId, recentStickers, stickerSets]);

  const stickerStaticPreloadUrls = useMemo(() => {
    const prioritizedSets = pickPrioritySets(stickerSets, activeStickerSetId, 2);
    return Array.from(new Set([
      ...collectStaticPreviewUrls(recentStickers.slice(0, 8), 12),
      ...prioritizedSets.flatMap((set) => collectStaticPreviewUrls(set.stickers.slice(0, 6), 12)),
    ].filter(Boolean)));
  }, [activeStickerSetId, recentStickers, stickerSets]);

  const memePreloadUrls = useMemo(() => {
    const prioritizedSets = pickPrioritySets(memeSets, activeMemeSetId === 'recent' ? memeSets[0]?.id || '' : activeMemeSetId, 2);
    return Array.from(new Set([
      ...collectStaticPreviewUrls(recentMemes.slice(0, 10), 16),
      ...prioritizedSets.flatMap((set) => collectStaticPreviewUrls(set.stickers.slice(0, 8), 16)),
    ].filter(Boolean)));
  }, [activeMemeSetId, memeSets, recentMemes]);

  const gifPreloadUrls = useMemo(() => {
    const prioritizedSets = pickPrioritySets(gifSets, activeGifSetId === 'recent' ? gifSets[0]?.id || '' : activeGifSetId, 2);
    return Array.from(new Set([
      ...recentGifs.slice(0, 6).map(item => item.url),
      ...prioritizedSets.flatMap((set) => set.stickers.slice(0, 4).map(item => item.url)),
    ].filter(Boolean)));
  }, [activeGifSetId, gifSets, recentGifs]);

  useEffect(() => {
    if (stickerAnimationPreloadUrls.length > 0) {
      preloadStickers(stickerAnimationPreloadUrls);
    }
  }, [stickerAnimationPreloadUrls]);

  useEffect(() => {
    if (stickerStaticPreloadUrls.length > 0) {
      preloadStaticAssets(stickerStaticPreloadUrls);
    }
  }, [stickerStaticPreloadUrls]);

  useEffect(() => {
    if (memePreloadUrls.length > 0) {
      preloadStaticAssets(memePreloadUrls);
    }
  }, [memePreloadUrls]);

  useEffect(() => {
    if (gifPreloadUrls.length > 0) {
      preloadStaticAssets(gifPreloadUrls);
    }
  }, [gifPreloadUrls]);

  const handleSelect = useCallback((item: StickerItem) => {
    if (item.mediaType === 'gif') {
      setRecentGifs(addRecentMedia(RECENT_GIFS_KEY, item));
    } else if (item.mediaType === 'meme') {
      setRecentMemes(addRecentMedia(RECENT_MEMES_KEY, item));
    } else {
      setRecentStickers(addRecentMedia(RECENT_STICKERS_KEY, item));
    }
    onStickerSelect(item);
  }, [onStickerSelect]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setRecentEmojis(addRecentEmoji(emoji));
    onStickerSelect({
      id: `emoji-${emoji}`,
      url: '',
      emoji,
      name: emoji,
      format: 'emoji',
      mediaType: 'emoji',
    });
  }, [onStickerSelect]);

  const handlePackInstalled = useCallback(async (packId: string) => {
    await fetchSets();
    setPanelTab('sticker');
    if (packId) {
      setActiveStickerSetId(packId);
    }
    setShowAddSheet(false);
  }, [fetchSets]);

  const displayStickers = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (keyword) {
      return stickerSets.flatMap(set => set.stickers.filter(item => matchesKeyword(item, set.name, keyword)));
    }
    if (activeStickerSetId === 'recent') return recentStickers;
    return stickerSets.find(set => set.id === activeStickerSetId)?.stickers || [];
  }, [activeStickerSetId, recentStickers, searchQuery, stickerSets]);

  const displayMemes = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (keyword) {
      return memeSets.flatMap(set => set.stickers.filter(item => matchesKeyword(item, set.name, keyword)));
    }
    if (activeMemeSetId === 'recent') return recentMemes;
    return memeSets.find(set => set.id === activeMemeSetId)?.stickers || [];
  }, [activeMemeSetId, memeSets, recentMemes, searchQuery]);

  const groupedRecentMemes = useMemo(() => {
    const packsById = new Map(memeSets.map(set => [set.id, set] as const));
    const grouped = new Map<string, { id: string; name: string; items: StickerItem[] }>();

    recentMemes.forEach((item) => {
      const packId = item.packId || 'unknown';
      const pack = packsById.get(packId);
      const sectionId = pack?.id || packId;
      const sectionName = pack?.name || item.packName || '其他表情包';
      if (!grouped.has(sectionId)) {
        grouped.set(sectionId, { id: sectionId, name: sectionName, items: [] });
      }
      grouped.get(sectionId)!.items.push(item);
    });

    return Array.from(grouped.values());
  }, [memeSets, recentMemes]);

  const displayGifs = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (keyword) {
      return gifSets.flatMap(set => set.stickers.filter(item => matchesKeyword(item, set.name, keyword)));
    }
    if (activeGifSetId === 'recent') return recentGifs;
    return gifSets.find(set => set.id === activeGifSetId)?.stickers || [];
  }, [activeGifSetId, gifSets, recentGifs, searchQuery]);

  const currentEmojiGroups = useMemo(() => {
    return EMOJI_GROUPS.map(group => group.id === 'recent' ? { ...group, emojis: recentEmojis } : group);
  }, [recentEmojis]);

  const displayEmojis = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    const groups = currentEmojiGroups.filter(group => group.id !== 'recent' || group.emojis.length > 0);
    if (keyword) {
      return groups.flatMap(group => group.emojis.filter(emoji => emoji.includes(keyword)));
    }
    return groups.find(group => group.id === activeEmojiGroupId)?.emojis || [];
  }, [activeEmojiGroupId, currentEmojiGroups, searchQuery]);

  const activeCollections = useMemo(() => {
    if (panelTab === 'gif') {
      return [{ id: 'recent', icon: '🕘', name: '最近使用' }, ...gifSets.map(set => ({ id: set.id, icon: set.icon, name: set.name }))];
    }
    if (panelTab === 'meme') {
      return [{ id: 'recent', icon: '🕘', name: '最近使用' }, ...memeSets.map(set => ({ id: set.id, icon: set.icon, name: set.name }))];
    }
    if (panelTab === 'emoji') {
      return currentEmojiGroups
        .filter(group => group.id !== 'recent' || group.emojis.length > 0)
        .map(group => ({ id: group.id, icon: group.icon, name: group.name }));
    }
    return [{ id: 'recent', icon: '🕘', name: '最近使用' }, ...stickerSets.map(set => ({ id: set.id, icon: set.icon, name: set.name }))];
  }, [currentEmojiGroups, gifSets, memeSets, panelTab, stickerSets]);

  const activeContentCount = panelTab === 'gif'
    ? displayGifs.length
    : panelTab === 'meme'
      ? (activeMemeSetId === 'recent' && !searchQuery.trim()
          ? groupedRecentMemes.reduce((total, section) => total + section.items.length, 0)
          : displayMemes.length)
      : panelTab === 'emoji'
        ? displayEmojis.length
        : displayStickers.length;

  const searchPlaceholder = panelTab === 'gif'
    ? '搜索 GIF 动图...'
    : panelTab === 'meme'
      ? '搜索表情包...'
      : panelTab === 'emoji'
        ? '搜索表情...'
        : '搜索贴纸...';

  const activeCollectionId = panelTab === 'gif'
    ? activeGifSetId
    : panelTab === 'meme'
      ? activeMemeSetId
      : panelTab === 'emoji'
        ? activeEmojiGroupId
        : activeStickerSetId;

  const activeCollectionName = activeCollections.find(item => item.id === activeCollectionId)?.name
    || (panelTab === 'gif' ? 'GIF 动图' : panelTab === 'meme' ? '表情包专辑' : panelTab === 'emoji' ? '表情' : '贴纸');

  const currentMediaItems = panelTab === 'gif'
    ? displayGifs
    : panelTab === 'meme'
      ? displayMemes
      : displayStickers;

  const contentViewKey = `${panelTab}-${activeCollectionId || 'default'}-${searchQuery ? 'search' : 'browse'}`;

  const handleCollectionChange = useCallback((collectionId: string) => {
    setSearchQuery('');
    if (panelTab === 'gif') setActiveGifSetId(collectionId);
    else if (panelTab === 'meme') setActiveMemeSetId(collectionId);
    else if (panelTab === 'emoji') setActiveEmojiGroupId(collectionId);
    else setActiveStickerSetId(collectionId);
  }, [panelTab]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      className="relative flex flex-col overflow-hidden rounded-t-[28px] border-t border-border/30 bg-white/96 dark:bg-slate-900/96 backdrop-blur-2xl shadow-[0_-14px_40px_rgba(15,23,42,0.08)]"
      style={{
        height: 'min(460px, calc(100dvh - 188px))',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
      }}
    >
      <div className="border-b border-border/15 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full bg-dove-warm-gray/45 px-3 dark:bg-slate-800/70">
            <Search size={14} className="text-muted-foreground/65 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm text-dove-ink dark:text-slate-200 outline-none placeholder:text-muted-foreground/55"
            />
          </div>

          {panelTab === 'sticker' && (
            <>
              <button
                type="button"
                onClick={() => setShowAddSheet(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-dove-warm-gray/55 dark:hover:bg-slate-800/70"
                title="添加表情包"
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                onClick={() => void fetchSets()}
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-dove-warm-gray/55 dark:hover:bg-slate-800/70"
                title="刷新表情包"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-dove-warm-gray/60 dark:hover:bg-slate-800/70"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground/80">
          <span className="font-medium text-dove-ink/80 dark:text-slate-200/80">{activeCollectionName}</span>
          <span>{activeContentCount} 项</span>
        </div>
      </div>

      {loadError && panelTab === 'sticker' && (
        <div className="px-3 pt-2 text-[11px] text-amber-600 dark:text-amber-400">
          当前使用本地回退表情包：{loadError}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={contentViewKey}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.16 }}
          className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3"
        >
          {panelTab === 'sticker' && loading && activeContentCount === 0 ? (
            <div className="grid grid-cols-4 gap-2.5 py-3 sm:grid-cols-5">
              {[...Array(15)].map((_, index) => (
                <div
                  key={index}
                  className="flex aspect-square items-center justify-center rounded-[22px] bg-dove-warm-gray/18 dark:bg-slate-800/50"
                >
                  <div className="h-12 w-12 rounded-2xl skeleton-enhanced" />
                </div>
              ))}
            </div>
          ) : activeContentCount === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-muted-foreground/50">
              <Sparkles size={24} className="mb-2 opacity-40" />
                  <span className="text-xs">
                    {searchQuery ? '未找到匹配内容' : panelTab === 'gif' ? '还没有使用过 GIF' : panelTab === 'meme' ? '还没有使用过表情包' : panelTab === 'emoji' ? '还没有使用过表情' : '还没有使用过贴纸'}
                  </span>

              <span className="mt-1 text-[10px]">切换分类或尝试搜索其他关键词</span>
            </div>
          ) : panelTab === 'emoji' ? (
            <div className="grid grid-cols-8 gap-1.5">
              {displayEmojis.map((emoji) => (
                <motion.button
                  key={`emoji-${emoji}`}
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.86 }}
                  onClick={() => handleEmojiSelect(emoji)}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl text-[22px] transition-colors hover:bg-dove-warm-gray/40 dark:hover:bg-slate-700/50"
                >
                  {emoji}
                </motion.button>
              ))}
            </div>
          ) : panelTab === 'meme' && activeMemeSetId === 'recent' && !searchQuery.trim() ? (
            <div className="space-y-4">
              {groupedRecentMemes.map((section) => (
                <section key={section.id} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs font-medium text-dove-ink/80 dark:text-slate-200/80">{section.name}</h4>
                    <span className="text-[10px] text-muted-foreground/70">{section.items.length} 项</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {section.items.map((item) => (
                      <motion.button
                        key={`${section.id}-${item.id}`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.92 }}
                        onClick={() => handleSelect({ ...item, mediaType: 'meme' })}
                        className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-[22px] bg-white/55 p-1 transition-colors hover:bg-dove-warm-gray/30 dark:bg-slate-800/20 dark:hover:bg-slate-700/40"
                        title={`${item.emoji} ${item.name}`}
                      >
                        <StickerPreview sticker={item} compact={false} />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent px-2 pb-1.5 pt-4 opacity-90">
                          <div className="truncate text-[10px] font-medium text-white/92">{item.name}</div>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div key={contentViewKey} className={panelTab === 'gif' ? 'grid grid-cols-3 gap-2.5' : 'grid grid-cols-4 gap-2'}>
              {currentMediaItems.map((item) => (
                <motion.button
                  key={`${item.mediaType || panelTab}-${item.packId || 'local'}-${item.id}`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => handleSelect({ ...item, mediaType: item.mediaType || panelTab })}
                  className={`group relative flex items-center justify-center overflow-hidden rounded-[22px] transition-colors ${
                    panelTab === 'gif'
                      ? 'aspect-[0.95] bg-dove-warm-gray/20 p-1.5 hover:bg-dove-warm-gray/35 dark:bg-slate-800/30 dark:hover:bg-slate-700/50'
                      : 'aspect-square bg-white/55 p-1 hover:bg-dove-warm-gray/30 dark:bg-slate-800/20 dark:hover:bg-slate-700/40'
                  }`}
                  title={`${item.emoji} ${item.name}`}
                >
                  <StickerPreview sticker={item} compact={panelTab === 'gif'} />
                  {(panelTab === 'meme' || panelTab === 'gif') && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent px-2 pb-1.5 pt-4 opacity-90">
                      <div className="truncate text-[10px] font-medium text-white/92">{item.name}</div>
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="border-t border-border/15 bg-white/82 px-2 pt-2 dark:bg-slate-900/82">
        <div className="mb-2 flex items-center gap-1 overflow-x-auto px-1 scrollbar-hide">
          {activeCollections.map(item => {
            const isActive = activeCollectionId === item.id;
            const stickerSet = panelTab === 'sticker'
              ? stickerSets.find(set => set.id === item.id)
              : panelTab === 'meme'
                ? memeSets.find(set => set.id === item.id)
                : undefined;
            const coverSticker = stickerSet?.stickers[0];
            const coverSrc = stickerSet?.cover || coverSticker?.thumbUrl || coverSticker?.url;

            return (
                  <button
                    key={`${panelTab}-${item.id}`}
                    type="button"
                    onClick={() => handleCollectionChange(item.id)}
                    className={`relative flex h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-2xl border transition-all ${

                  isActive
                    ? 'border-dove-green/35 bg-dove-green/10 shadow-[0_4px_14px_rgba(34,197,94,0.14)] dark:border-sky-400/35 dark:bg-sky-400/10'
                    : 'border-transparent bg-transparent text-muted-foreground hover:bg-dove-warm-gray/45 dark:hover:bg-slate-800/65'
                }`}
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

        <div className="mx-auto grid w-full max-w-md grid-cols-4 gap-1 rounded-full bg-black/5 p-1 dark:bg-white/5">
          <button
            type="button"
            onClick={() => { setPanelTab('sticker'); setSearchQuery(''); }}
            className={`min-w-0 whitespace-nowrap rounded-full px-2 py-2 text-xs sm:px-3 sm:text-sm transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${panelTab === 'sticker' ? 'bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Sticker size={15} className="shrink-0" />
            <span className="truncate">贴纸</span>
          </button>
          <button
            type="button"
            onClick={() => { setPanelTab('gif'); setSearchQuery(''); }}
            className={`min-w-0 whitespace-nowrap rounded-full px-2 py-2 text-xs sm:px-3 sm:text-sm transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${panelTab === 'gif' ? 'bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ImageIcon size={15} className="shrink-0" />
            <span className="truncate">GIF动图</span>
          </button>
          <button
            type="button"
            onClick={() => { setPanelTab('meme'); setSearchQuery(''); setActiveMemeSetId((current) => (current && current !== 'recent') ? current : (memeSets[0]?.id || current || 'recent')); }}
            className={`min-w-0 whitespace-nowrap rounded-full px-2 py-2 text-xs sm:px-3 sm:text-sm transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${panelTab === 'meme' ? 'bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ImageIcon size={15} className="shrink-0" />
            <span className="truncate">表情包</span>
          </button>
          <button
            type="button"
            onClick={() => { setPanelTab('emoji'); setSearchQuery(''); }}
            className={`min-w-0 whitespace-nowrap rounded-full px-2 py-2 text-xs sm:px-3 sm:text-sm transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${panelTab === 'emoji' ? 'bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <SmilePlus size={15} className="shrink-0" />
            <span className="truncate">表情</span>
          </button>
        </div>
      </div>

      <AddStickerSheet
        open={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        onInstalled={handlePackInstalled}
      />
    </motion.div>
  );
};

export default StickerPanel;
