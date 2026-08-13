/**
 * imim 朋友圈（发现）页面 — 微信朋友圈风格。
 * 页面层只负责布局、导航、封面和组件事件绑定；Feed 业务逻辑位于 useMomentsFeed。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUserState } from '@/contexts/AppContext';
import { useTheme } from '@/contexts/ThemeContext';
import { DoveAvatar } from '@/components/DoveAvatar';
import VirtualFeedList from '@/components/VirtualFeedList';
import { CURRENT_USER } from '@/lib/store';
import { authApi } from '@/lib/authFetch';
import { setupWeChatVideoAutoPlayHack } from '@/lib/momentsPreloader';
import { useMomentsFeed } from '@/hooks/useMomentsFeed';
import type { VisibilityType } from '@/components/moments/types';
import { clearFeedCache, MOMENTS_COVER_STORAGE_KEY } from '@/components/moments/utils';
import MomentCard from '@/components/moments/MomentCard';
import MomentSkeleton from '@/components/moments/MomentSkeleton';
import ImageLightbox from '@/components/moments/ImageLightbox';
import PostComposer from '@/components/moments/PostComposer';
import PullToRefresh from '@/components/moments/PullToRefresh';
import { MomentsManager, PublishActionSheet, SettingsActionSheet } from '@/components/moments/MomentsOverlays';

export default function MomentsPage() {
  const currentUserState = useCurrentUserState();
  const { mode, toggleTheme } = useTheme();
  const currentUser = currentUserState || {
    id: CURRENT_USER.id,
    username: CURRENT_USER.id,
    nickname: CURRENT_USER.name,
    avatar: CURRENT_USER.avatar,
    bio: '',
  };
  const currentUserId = currentUser.id;
  const currentUserName = currentUser.nickname || currentUser.username || CURRENT_USER.name;
  const currentUserAvatar = currentUser.avatar || CURRENT_USER.avatar;
  const {
    localMoments,
    hasMore,
    loading,
    initialLoading,
    fetchFeed,
    handleLoadMore,
    handleRefresh,
    handleLike,
    handleComment,
    handleDeleteComment,
    handleDelete,
    handlePin,
    handlePost,
  } = useMomentsFeed({ currentUserId, currentUserName });

  const [showComposer, setShowComposer] = useState(false);
  const [composerMode, setComposerMode] = useState<'photo' | 'camera' | 'video' | 'text'>('photo');
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showMomentsManager, setShowMomentsManager] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverImage, setCoverImage] = useState('');
  const [topBgOpacity, setTopBgOpacity] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [autoPlayVideo, setAutoPlayVideo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/site-config-public')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setAutoPlayVideo(!!d.autoPlayVideo); })
      .catch(() => {});
    setupWeChatVideoAutoPlayHack();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setTopBgOpacity(Math.min(container.scrollTop / 80, 1));
          ticking = false;
        });
        ticking = true;
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedCover = window.localStorage.getItem(MOMENTS_COVER_STORAGE_KEY) || '';
    setCoverImage(savedCover);
    authApi('/api/profile')
      .then((data: any) => {
        const remoteCover = data?.profile?.backgroundUrl || '';
        if (remoteCover) {
          setCoverImage(remoteCover);
          window.localStorage.setItem(MOMENTS_COVER_STORAGE_KEY, remoteCover);
        }
      })
      .catch(() => {});
  }, []);

  const handleCoverChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { uploadFileToCos } = await import('@/components/moments/mediaUpload');
      const objectUrl = URL.createObjectURL(file);
      setCoverImage(objectUrl);
      const uploadedUrl = await uploadFileToCos(file, 'background');
      setCoverImage(uploadedUrl);
      if (typeof window !== 'undefined') window.localStorage.setItem(MOMENTS_COVER_STORAGE_KEY, uploadedUrl);
      await authApi('/api/profile', { userId: 'me', backgroundUrl: uploadedUrl }, 'PUT');
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('[moments] 背景图上传失败:', err);
    }
    e.target.value = '';
  }, []);

  const openLightbox = useCallback((images: string[], index: number) => {
    setLightboxImages(images);
    setLightboxIndex(index);
  }, []);

  const pinnedPosts = useMemo(() => localMoments.filter(m => m.isPinned), [localMoments]);
  const normalPosts = useMemo(() => localMoments.filter(m => !m.isPinned), [localMoments]);
  const navBg = `rgba(255,255,255,${topBgOpacity})`;
  const iconColor = topBgOpacity > 0.5 ? '#333' : '#fff';
  const iconShadow = topBgOpacity < 0.5 ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' : 'none';

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff", color: "#282828" }}>
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        /* 双击点赞飞心动画（GPU 加速：仅 transform/opacity） */
        @keyframes doubleTapPop {
          0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          15%  { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
          50%  { transform: translate(-50%, -52%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -85%) scale(0.7); opacity: 0; }
        }
        .double-tap-heart {
          position: absolute; top: 50%; left: 50%;
          font-size: 64px; color: #ff3b30;
          pointer-events: none; user-select: none;
          transform: translate(-50%, -50%) scale(0.3); opacity: 0;
          animation: doubleTapPop 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
          will-change: transform, opacity;
          text-shadow: 0 4px 12px rgba(0,0,0,0.35);
          z-index: 5;
        }
      `}</style>

      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: "auto", background: "#fff" }}>
        <PullToRefresh onRefresh={handleRefresh} scrollRef={scrollContainerRef as React.RefObject<HTMLDivElement>}>
        <div style={{ maxWidth: 567, margin: "0 auto", background: "#fff", position: "relative" }}>

          {/* ===== 封面区域（微信风格）===== */}
          <header
            style={{
              height: "19.25rem",
              backgroundImage: coverImage ? `url('${coverImage}')` : "none",
              backgroundColor: coverImage ? undefined : "#333",
              backgroundSize: "cover",
              backgroundPosition: "center",
              position: "relative",
              marginBottom: "2.5rem",
              cursor: "pointer",
            }}
            onClick={() => coverInputRef.current?.click()}
          >
            {/* 固定顶部导航栏 */}
            <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: 56, zIndex: 20 }}>
              <div style={{ maxWidth: 567, margin: "0 auto", height: "100%", background: navBg, transition: "background 0.3s", display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 16 }}>
                <button onClick={e => { e.stopPropagation(); if (window.history.length > 1) window.history.back(); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2.5} style={{ filter: iconShadow }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                {topBgOpacity > 0.5 && <span style={{ fontSize: 17, fontWeight: 600, color: "#333" }}>朋友圈</span>}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={e => { e.stopPropagation(); setShowPublishMenu(true); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2.5} style={{ filter: iconShadow }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  <button onClick={e => { e.stopPropagation(); setShowSettingsMenu(true); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} style={{ filter: iconShadow }}>
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* 右下角：昵称 + 头像 */}
            <div style={{ position: "absolute", right: 16, bottom: -28, display: "flex", flexDirection: "row", alignItems: "flex-end" }}>
              <span style={{ color: "#fff", marginRight: 12, marginBottom: 16, fontSize: 16, fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,0.5)", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                {currentUserName}
              </span>
              <div style={{ width: 64, height: 64, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "#e5e7eb", border: "2px solid #fff" }}>
                {currentUserAvatar ? (
                  <img src={currentUserAvatar} alt={currentUserName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <DoveAvatar name={currentUserName} id={currentUserId} avatar={currentUserAvatar} size="lg" />
                )}
              </div>
            </div>

            <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
          </header>

          {/* ===== 动态列表区域 ===== */}
          <div style={{ paddingTop: 8 }}>

            {/* 首次加载骨架屏 */}
            {initialLoading && (
              <>
                <MomentSkeleton />
                <MomentSkeleton />
                <MomentSkeleton />
              </>
            )}

            {/* 置顶动态 */}
            {!initialLoading && pinnedPosts.map(post => (
              <div key={post.id} style={{ borderBottom: "0.5px solid #f0f0f0", padding: "12px 16px", position: "relative" }}>
                <div style={{ position: "absolute", top: 12, right: 16, background: "#576b95", color: "#fff", fontSize: 10, padding: "1px 6px", borderRadius: 2 }}>置顶</div>
                <MomentCard
                  post={post}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  autoPlayVideo={autoPlayVideo}
                  onLike={handleLike}
                  onComment={handleComment}
                  onDeleteComment={handleDeleteComment}
                  onDelete={handleDelete}
                  onPin={handlePin}
                  onPreviewImages={openLightbox}
                />
              </div>
            ))}

            {/* 普通动态列表 */}
            {!initialLoading && localMoments.length === 0 ? (
              <div style={{ padding: "64px 0", textAlign: "center" }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth={1} style={{ margin: "0 auto 12px", display: "block" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p style={{ color: "#9ca3af", fontSize: 14 }}>暂无动态，去添加好友或发布第一条动态吧</p>
                <button
                  onClick={() => setShowPublishMenu(true)}
                  style={{ marginTop: 16, background: "#07C160", color: "#fff", border: "none", borderRadius: 4, padding: "8px 24px", fontSize: 14, cursor: "pointer" }}
                >
                  发布第一条动态
                </button>
              </div>
            ) : !initialLoading && (
              <>
                <VirtualFeedList
                  items={normalPosts}
                  loading={loading}
                  hasMore={hasMore}
                  onLoadMore={handleLoadMore}
                  className="!overflow-visible"
                  renderItem={(post) => (
                    <div style={{ borderBottom: "0.5px solid #f0f0f0", padding: "12px 16px" }}>
                      <MomentCard
                        post={post}
                        currentUserId={currentUserId}
                        currentUserName={currentUserName}
                        autoPlayVideo={autoPlayVideo}
                        onLike={handleLike}
                        onComment={handleComment}
                        onDeleteComment={handleDeleteComment}
                        onDelete={handleDelete}
                        onPin={handlePin}
                        onPreviewImages={openLightbox}
                      />
                    </div>
                  )}
                />
                {loading && (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <MomentSkeleton />
                  </div>
                )}
                {!hasMore && normalPosts.length > 0 && (
                  <div style={{ textAlign: "center", padding: "24px 0 40px", color: "#ccc", fontSize: 12 }}>— 已经到底了 —</div>
                )}
              </>
            )}
          </div>
        </div>
        </PullToRefresh>
      </div>

      {/* 发布菜单 */}
      {showPublishMenu && (
        <PublishActionSheet
          onClose={() => setShowPublishMenu(false)}
          onSelect={(mode) => {
            setShowPublishMenu(false);
            setComposerMode(mode);
            setShowComposer(true);
          }}
        />
      )}

      {/* 发布弹窗 */}
      {showComposer && (
        <PostComposer onClose={() => setShowComposer(false)} onPost={handlePost} initialMode={composerMode} />
      )}

      {/* 图片灯箱 */}
      {lightboxImages.length > 0 && (
        <ImageLightbox images={lightboxImages} initialIndex={lightboxIndex} onClose={() => setLightboxImages([])} />
      )}

      {/* 设置底部菜单 */}
      {showSettingsMenu && (
        <SettingsActionSheet
          onClose={() => setShowSettingsMenu(false)}
          onSortMoments={() => { setShowSettingsMenu(false); setShowMomentsManager(true); }}
          userId={currentUserId}
        />
      )}

      {/* 动态管理页面 */}
      {showMomentsManager && (
        <MomentsManager
          onClose={() => { setShowMomentsManager(false); void fetchFeed(undefined, { force: true }); }}
        />
      )}
    </div>
  );
}
