import type { MomentPost } from '@/lib/store';
import type { MomentItem, VisibilityType } from './types';

export const MOMENTS_COVER_STORAGE_KEY = 'cqim_moments_cover_image';
export const FEED_CACHE_KEY = 'cqim_moments_feed_cache';
export const FEED_CACHE_VERSION = 'v2';
export const FEED_CACHE_MAX_AGE = 5 * 60 * 1000;

export function extractTopics(content: string): string[] {
  const matches = content.match(/#([^#\s]+)#/g) || [];
  return [...new Set(matches.map(m => m.replace(/#/g, '')))];
}

export function saveFeedToCache(moments: any[]): void {
  try {
    const data = { version: FEED_CACHE_VERSION, ts: Date.now(), moments: moments.slice(0, 20) };
    window.localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(data));
  } catch { /* 存储满时静默失败 */ }
}

export function loadFeedFromCache(): any[] | null {
  try {
    const raw = window.localStorage.getItem(FEED_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== FEED_CACHE_VERSION) return null;
    if (Date.now() - data.ts > FEED_CACHE_MAX_AGE) return null;
    return data.moments || null;
  } catch { return null; }
}

export function clearFeedCache(): void {
  try { window.localStorage.removeItem(FEED_CACHE_KEY); } catch { /* no-op */ }
}

export function convertApiMoment(m: any): MomentItem {
  return {
    id: m.id,
    authorId: m.authorId,
    authorName: m.authorName || '',
    authorAvatar: m.authorAvatar || '',
    content: m.content || '',
    media: (m.media || []).map((item: any) => ({
      type: (item.type === 'video' ? 'video' : 'image') as 'image' | 'video',
      url: item.url || '',
      thumbUrl: item.thumbUrl || undefined,
      mediumUrl: item.mediumUrl || undefined,
      lowQualityUrl: item.lowQualityUrl || undefined,
      posterUrl: item.posterUrl || undefined,
      width: typeof item.width === 'number' ? item.width : undefined,
      height: typeof item.height === 'number' ? item.height : undefined,
      duration: typeof item.duration === 'number' ? item.duration : undefined,
    })),
    topics: m.topics || [],
    location: m.location || undefined,
    permission: { type: (m.visibility || 'public') as VisibilityType },
    likes: (m.likes || []).map((l: any) => ({
      userId: l.userId,
      userName: l.userName || '',
      createdAt: l.createdAt || 0,
    })),
    comments: (m.comments || []).map((c: any) => ({
      id: c.id,
      momentId: m.id,
      userId: c.userId,
      userName: c.userName || '',
      content: c.content || '',
      parentId: c.parentId || undefined,
      replyToUserId: c.replyToUserId || undefined,
      replyToUserName: c.replyToUserName || undefined,
      createdAt: c.createdAt || 0,
      isDeleted: c.isDeleted || false,
    })),
    likeCount: m.likeCount ?? (m.likes?.length || 0),
    commentCount: m.commentCount ?? (m.comments?.length || 0),
    isPinned: m.isPinned || false,
    pinnedAt: m.pinnedAt || undefined,
    createdAt: m.createdAt || 0,
    isLiked: m.isLiked || false,
  };
}

export function convertPost(post: MomentPost, currentUserId: string): MomentItem {
  return {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName,
    authorAvatar: post.authorAvatar,
    content: post.content,
    media: post.images.map(url => ({ type: 'image' as const, url })),
    topics: extractTopics(post.content),
    location: undefined,
    permission: { type: post.visibility === 'public' ? 'public' : post.visibility === 'private' ? 'private' : 'friends' },
    likes: post.likes.map(l => ({ userId: l.userId, userName: l.userName, createdAt: post.timestamp })),
    comments: post.comments.map(c => ({
      id: c.id,
      momentId: post.id,
      userId: c.userId,
      userName: c.userName,
      content: c.content,
      parentId: undefined,
      replyToUserId: undefined,
      replyToUserName: c.replyTo,
      createdAt: c.timestamp,
      isDeleted: false,
    })),
    likeCount: post.likes.length,
    commentCount: post.comments.length,
    isPinned: false,
    createdAt: post.timestamp,
    isLiked: post.likes.some(l => l.userId === currentUserId),
  };
}
