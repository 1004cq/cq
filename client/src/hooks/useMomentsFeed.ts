import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppActions } from '@/contexts/AppContext';
import { authApi } from '@/lib/authFetch';
import { preloadMomentsMedia } from '@/lib/momentsPreloader';
import type { MomentPost } from '@/lib/store';
import type { MomentComment, MomentItem, VisibilityType } from '@/components/moments/types';
import {
  clearFeedCache,
  convertApiMoment,
  convertPost,
  loadFeedFromCache,
  saveFeedToCache,
} from '@/components/moments/utils';

interface UseMomentsFeedOptions {
  currentUserId: string;
  currentUserName: string;
}

export interface UseMomentsFeedResult {
  localMoments: MomentItem[];
  hasMore: boolean;
  loading: boolean;
  initialLoading: boolean;
  nextCursor: string | null;
  fetchFeed: (cursor?: string, opts?: { force?: boolean }) => Promise<void>;
  handleLoadMore: () => void;
  handleRefresh: () => Promise<void>;
  handleLike: (postId: string) => Promise<void>;
  handleComment: (postId: string, content: string, parentId?: string, replyToUserName?: string) => Promise<void>;
  handleDeleteComment: (momentId: string, commentId: string) => Promise<void>;
  handleDelete: (postId: string) => Promise<void>;
  handlePin: (postId: string) => Promise<void>;
  handlePost: (content: string, images: string[], location: string, visibility: VisibilityType) => Promise<void>;
}

export function useMomentsFeed({ currentUserId, currentUserName }: UseMomentsFeedOptions): UseMomentsFeedResult {
  const { likeMoment, addComment, addMoment } = useAppActions();
  const [localMoments, setLocalMoments] = useState<MomentItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const loadMoreCooldown = useRef(0);

  const fetchFeed = useCallback(async (cursor?: string, opts?: { force?: boolean }) => {
    if (fetchControllerRef.current) fetchControllerRef.current.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    const force = !!opts?.force;

    if (!cursor && initialLoading && !force) {
      const cached = loadFeedFromCache();
      if (cached && cached.length > 0) {
        setLocalMoments(cached.map(convertApiMoment));
        setInitialLoading(false);
      }
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (cursor) params.set('cursor', cursor);
      if (force) params.set('force', '1');
      if (force) params.set('_t', String(Date.now()));
      const data = await authApi(`/api/moments/feed?${params.toString()}`, undefined, 'GET');
      if (controller.signal.aborted) return;

      const items: MomentItem[] = (data?.moments || []).map(convertApiMoment);
      if (cursor) {
        setLocalMoments(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          return [...prev, ...items.filter(item => !existingIds.has(item.id))];
        });
      } else {
        setLocalMoments(items);
        saveFeedToCache(data?.moments || []);
      }
      setHasMore(data?.hasMore ?? false);
      setNextCursor(data?.nextCursor ?? null);
      try {
        preloadMomentsMedia(items.slice(0, 6).map(p => ({ media: p.media as any[] })), { maxImages: 18, maxVideos: 3 });
      } catch { /* media preloading is best effort */ }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('[moments] 加载好友动态失败:', err);
      if (!cursor && localMoments.length === 0) {
        const cached = loadFeedFromCache();
        if (cached && cached.length > 0) {
          setLocalMoments(cached.map(convertApiMoment));
          console.warn('[moments] 网络异常，已降级展示本地缓存');
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [initialLoading, localMoments.length]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void fetchFeed();
  }, [fetchFeed]);

  const handleLoadMore = useCallback(() => {
    if (loading || !hasMore || !nextCursor) return;
    const now = Date.now();
    if (now - loadMoreCooldown.current < 300) return;
    loadMoreCooldown.current = now;
    void fetchFeed(nextCursor);
  }, [loading, hasMore, nextCursor, fetchFeed]);

  const handleRefresh = useCallback(async () => {
    setNextCursor(null);
    clearFeedCache();
    await fetchFeed(undefined, { force: true });
  }, [fetchFeed]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { type, payload } = (e as CustomEvent).detail || {};
      if (type === 'moment_like_notify' && payload?.momentId) {
        setLocalMoments(prev => prev.map(m => {
          if (m.id !== payload.momentId) return m;
          return {
            ...m,
            likeCount: payload.likeCount ?? m.likeCount + 1,
            isLiked: m.isLiked,
            likes: payload.liked
              ? [...m.likes.filter(l => l.userId !== payload.userId), { userId: payload.userId, userName: payload.userName, createdAt: Date.now() }]
              : m.likes.filter(l => l.userId !== payload.userId),
          };
        }));
      }
      if (type === 'moment_comment_notify' && payload?.momentId) {
        setLocalMoments(prev => prev.map(m => {
          if (m.id !== payload.momentId) return m;
          const newComment: MomentComment = {
            id: payload.commentId || `rt-${Date.now()}`,
            momentId: payload.momentId,
            userId: payload.userId,
            userName: payload.userName,
            content: payload.content,
            parentId: payload.replyToId || undefined,
            createdAt: Date.now(),
            isDeleted: false,
          };
          if (m.comments.some(c => c.id === newComment.id)) return m;
          return { ...m, comments: [...m.comments, newComment], commentCount: m.commentCount + 1 };
        }));
      }
    };
    window.addEventListener('moment_realtime_event', handler);
    return () => window.removeEventListener('moment_realtime_event', handler);
  }, []);

  const handleLike = useCallback(async (postId: string) => {
    setLocalMoments(prev => prev.map(m => {
      if (m.id !== postId) return m;
      const alreadyLiked = m.isLiked;
      return {
        ...m,
        isLiked: !alreadyLiked,
        likeCount: alreadyLiked ? m.likeCount - 1 : m.likeCount + 1,
        likes: alreadyLiked
          ? m.likes.filter(l => l.userId !== currentUserId)
          : [...m.likes, { userId: currentUserId, userName: currentUserName, createdAt: Date.now() }],
      };
    }));
    likeMoment(postId);
    try {
      await authApi(`/api/moments/${postId}/like`, {}, 'POST');
    } catch (err) {
      console.error('[moments] 点赞失败:', err);
      setLocalMoments(prev => prev.map(m => {
        if (m.id !== postId) return m;
        const wasLiked = m.isLiked;
        return {
          ...m,
          isLiked: !wasLiked,
          likeCount: wasLiked ? m.likeCount - 1 : m.likeCount + 1,
          likes: wasLiked
            ? m.likes.filter(l => l.userId !== currentUserId)
            : [...m.likes, { userId: currentUserId, userName: currentUserName, createdAt: Date.now() }],
        };
      }));
    }
  }, [likeMoment, currentUserId, currentUserName]);

  const handleComment = useCallback(async (postId: string, content: string, parentId?: string, replyToUserName?: string) => {
    const tempId = `cm-${Date.now()}`;
    const localComment: MomentComment = {
      id: tempId,
      momentId: postId,
      userId: currentUserId,
      userName: currentUserName,
      content,
      parentId,
      replyToUserName,
      createdAt: Date.now(),
      isDeleted: false,
    };
    setLocalMoments(prev => prev.map(m => m.id === postId
      ? { ...m, comments: [...m.comments, localComment], commentCount: m.commentCount + 1 }
      : m));
    addComment(postId, { id: tempId, userId: currentUserId, userName: currentUserName, content, timestamp: Date.now(), replyTo: replyToUserName });
    try {
      const data = await authApi(`/api/moments/${postId}/comments`, { content, replyToId: parentId }, 'POST');
      if (data?.comment?.id) {
        setLocalMoments(prev => prev.map(m => m.id === postId
          ? { ...m, comments: m.comments.map(c => c.id === tempId ? { ...c, id: data.comment.id } : c) }
          : m));
      }
    } catch (err) {
      console.error('[moments] 评论失败:', err);
      setLocalMoments(prev => prev.map(m => m.id === postId
        ? { ...m, comments: m.comments.filter(c => c.id !== tempId), commentCount: Math.max(0, m.commentCount - 1) }
        : m));
    }
  }, [addComment, currentUserId, currentUserName]);

  const handleDeleteComment = useCallback(async (momentId: string, commentId: string) => {
    setLocalMoments(prev => prev.map(m => m.id === momentId
      ? { ...m, comments: m.comments.map(c => c.id === commentId ? { ...c, isDeleted: true } : c), commentCount: Math.max(0, m.commentCount - 1) }
      : m));
    try {
      await authApi(`/api/moments/${momentId}/comments/${commentId}`, undefined, 'DELETE');
    } catch (err) {
      console.error('[moments] 删除评论失败:', err);
      setLocalMoments(prev => prev.map(m => m.id === momentId
        ? { ...m, comments: m.comments.map(c => c.id === commentId ? { ...c, isDeleted: false } : c), commentCount: m.commentCount + 1 }
        : m));
    }
  }, []);

  const handleDelete = useCallback(async (postId: string) => {
    const backup = localMoments.find(m => m.id === postId);
    setLocalMoments(prev => prev.filter(m => m.id !== postId));
    try {
      await authApi(`/api/moments/${postId}`, undefined, 'DELETE');
    } catch (err) {
      console.error('[moments] 删除动态失败:', err);
      if (backup) setLocalMoments(prev => [...prev, backup].sort((a, b) => b.createdAt - a.createdAt));
    }
  }, [localMoments]);

  const handlePin = useCallback(async (postId: string) => {
    const target = localMoments.find(m => m.id === postId);
    if (!target) return;
    const willPin = !target.isPinned;
    setLocalMoments(prev => {
      const updated = prev.map(m => {
        if (m.id === postId) return { ...m, isPinned: willPin, pinnedAt: willPin ? Date.now() : undefined };
        if (willPin && m.isPinned && m.authorId === currentUserId) return { ...m, isPinned: false, pinnedAt: undefined };
        return m;
      });
      updated.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.isPinned && b.isPinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        return b.createdAt - a.createdAt;
      });
      return updated;
    });
    try {
      await authApi(`/api/moments/${postId}/pin`, { pin: willPin }, 'POST');
    } catch (err) {
      console.error('[moments] 置顶失败:', err);
      void fetchFeed(undefined, { force: true });
    }
  }, [localMoments, currentUserId, fetchFeed]);

  const handlePost = useCallback(async (content: string, images: string[], location: string, visibility: VisibilityType) => {
    let createdMoment: any = null;
    try {
      const payloadMedia = images.map(url => ({
        type: /\.(mp4|mov|avi|webm|mkv|m4v)$/i.test(url) || url.includes('video') ? 'video' : 'image',
        url,
      }));
      const data = await authApi('/api/moments', { content, visibility, location, media: payloadMedia }, 'POST');
      createdMoment = data?.moment || null;
    } catch (error) {
      console.error('[moments] 服务端发布失败，回退为本地动态:', error);
      throw error;
    }

    if (createdMoment) {
      const newItem = convertApiMoment({
        id: createdMoment.id,
        authorId: createdMoment.user?.id || currentUserId,
        authorName: createdMoment.user?.nickname || createdMoment.user?.username || currentUserName,
        authorAvatar: createdMoment.user?.avatar || '',
        content: createdMoment.content || content,
        media: createdMoment.media || [],
        topics: createdMoment.topics || [],
        location: createdMoment.location || location,
        visibility: createdMoment.visibility || visibility,
        likes: [],
        comments: [],
        likeCount: 0,
        commentCount: 0,
        isPinned: false,
        createdAt: createdMoment.createdAt ? new Date(createdMoment.createdAt).getTime() : Date.now(),
        isLiked: false,
      });
      setLocalMoments(prev => [...prev.filter(m => m.isPinned), newItem, ...prev.filter(m => !m.isPinned && m.id !== newItem.id)]);
      const newPost: MomentPost = {
        id: newItem.id,
        authorId: newItem.authorId,
        authorName: newItem.authorName,
        authorAvatar: newItem.authorAvatar || '',
        content: newItem.content,
        images: newItem.media.filter(m => m.type === 'image').map(m => m.url),
        timestamp: newItem.createdAt,
        likes: [],
        comments: [],
        visibility: newItem.permission.type,
      };
      addMoment(newPost);
    } else {
      const newPost: MomentPost = {
        id: `p-${Date.now()}`,
        authorId: currentUserId,
        authorName: currentUserName,
        authorAvatar: '',
        content,
        images,
        timestamp: Date.now(),
        likes: [],
        comments: [],
        visibility,
      };
      addMoment(newPost);
      const newItem = convertPost(newPost, currentUserId);
      setLocalMoments(prev => [...prev.filter(m => m.isPinned), newItem, ...prev.filter(m => !m.isPinned)]);
    }

    clearFeedCache();
    window.setTimeout(() => { void fetchFeed(undefined, { force: true }); }, 600);
    window.setTimeout(() => { void fetchFeed(undefined, { force: true }); }, 3000);
  }, [addMoment, currentUserId, currentUserName, fetchFeed]);

  return {
    localMoments,
    hasMore,
    loading,
    initialLoading,
    nextCursor,
    fetchFeed,
    handleLoadMore,
    handleRefresh,
    handleLike,
    handleComment,
    handleDeleteComment,
    handleDelete,
    handlePin,
    handlePost,
  };
}

export default useMomentsFeed;
