import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Loader2, Heart, MessageCircle, Video } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { authApi } from '@/lib/authFetch';

interface MomentMedia {
  type: 'image' | 'video';
  url: string;
  thumbUrl?: string;
  mediumUrl?: string;
}
interface MomentItem {
  id: string;
  content: string;
  media: MomentMedia[];
  images?: string[];
  videos?: string[];
  coverUrl?: string | null;
  createdAt: number;
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  isPinned: boolean;
  likes?: Array<{ userId: string; userName: string }>;
  comments?: Array<{ id: string; userId: string; userName: string; content: string; createdAt: number }>;
}
interface UserProfile {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  bio: string;
  backgroundUrl?: string;
  online?: boolean;
}

const UserMomentsPage: React.FC<{
  userId: string;
  userProfile: UserProfile;
  onClose: () => void;
}> = ({ userId, userProfile, onClose }) => {
  const [moments, setMoments] = useState<MomentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMoments();
  }, [userId]);

  const loadMoments = async () => {
    try {
      const data = await authApi(`/api/moments?userId=${userId}&limit=20`, undefined, 'GET');
      if (data) {
        const list = (data.moments || []).map((m: any) => ({
          id: m.id,
          content: m.content || '',
          media: m.media || [],
          images: m.images || (m.media?.filter((md: any) => md.type === 'image').map((md: any) => md.mediumUrl || md.url)) || [],
          videos: m.videos || (m.media?.filter((md: any) => md.type === 'video').map((md: any) => md.url)) || [],
          coverUrl: m.coverUrl || null,
          createdAt: typeof m.createdAt === 'number' ? m.createdAt : new Date(m.createdAt).getTime(),
          likeCount: m.likeCount ?? 0,
          commentCount: m.commentCount ?? 0,
          isLiked: m.isLiked ?? false,
          isPinned: m.isPinned ?? false,
          likes: m.likes || [],
          comments: m.comments || [],
        }));
        setMoments(list);
        setHasMore(data.hasMore ?? false);
      }
    } catch (e) {
      console.error('加载朋友圈失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore || moments.length === 0) return;
    setLoadingMore(true);
    try {
      const lastMoment = moments[moments.length - 1];
      const cursor = new Date(lastMoment.createdAt).toISOString();
      const data = await authApi(`/api/moments?userId=${userId}&limit=20&cursor=${cursor}`, undefined, 'GET');
      if (data) {
        const list = (data.moments || []).map((m: any) => ({
          id: m.id,
          content: m.content || '',
          media: m.media || [],
          images: m.images || (m.media?.filter((md: any) => md.type === 'image').map((md: any) => md.mediumUrl || md.url)) || [],
          videos: m.videos || (m.media?.filter((md: any) => md.type === 'video').map((md: any) => md.url)) || [],
          coverUrl: m.coverUrl || null,
          createdAt: typeof m.createdAt === 'number' ? m.createdAt : new Date(m.createdAt).getTime(),
          likeCount: m.likeCount ?? 0,
          commentCount: m.commentCount ?? 0,
          isLiked: m.isLiked ?? false,
          isPinned: m.isPinned ?? false,
          likes: m.likes || [],
          comments: m.comments || [],
        }));
        setMoments(prev => [...prev, ...list]);
        setHasMore(data.hasMore ?? false);
      }
    } catch (e) {
      console.error('加载更多失败:', e);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      loadMore();
    }
  }, [moments, hasMore, loadingMore]);

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hour}:${minute}`;
  };

  // 图片网格布局
  const renderImageGrid = (images: string[]) => {
    if (images.length === 0) return null;
    const count = images.length;
    const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
    const size = count === 1 ? 200 : count <= 4 ? 100 : 80;

    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${size}px)`,
        gap: 4,
        marginTop: 8,
      }}>
        {images.slice(0, 9).map((img, i) => (
          <div
            key={i}
            onClick={() => { setLightboxImages(images); setLightboxIndex(i); }}
            style={{
              width: size,
              height: size,
              borderRadius: 4,
              overflow: 'hidden',
              cursor: 'pointer',
            }}
          >
            <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0, 0.67, 0] }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 210,
        background: '#f2f2f7',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 顶部导航 */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'transparent',
      }}>
        <button
          onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', gap: 2,
            color: '#fff', fontSize: 14, fontWeight: 500,
            background: 'none', border: 'none', cursor: 'pointer',
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
          }}
        >
          <ChevronLeft size={22} color="#fff" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }} />
        </button>
      </div>

      {/* 内容区域 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        {/* 封面背景 */}
        <div style={{
          width: '100%',
          height: 280,
          backgroundImage: userProfile.backgroundUrl
            ? `url('${userProfile.backgroundUrl}')`
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
        }}>
          {/* 右下角：昵称 + 头像 */}
          <div style={{
            position: 'absolute',
            right: 16,
            bottom: -28,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 12,
          }}>
            <span style={{
              color: '#fff',
              fontSize: 16,
              fontWeight: 500,
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              marginBottom: 16,
            }}>
              {userProfile.nickname || userProfile.username}
            </span>
            <div style={{
              width: 60, height: 60,
              borderRadius: 8,
              overflow: 'hidden',
              border: '2px solid #fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }}>
              {userProfile.avatar ? (
                <img src={userProfile.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <DoveAvatar name={userProfile.nickname || userProfile.username} id={userProfile.id} size={60} />
              )}
            </div>
          </div>
        </div>

        {/* 间距 */}
        <div style={{ height: 48 }} />

        {/* 动态列表 */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={24} className="animate-spin" style={{ color: '#8e8e93' }} />
          </div>
        ) : moments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#8e8e93', fontSize: 14 }}>
            暂无动态
          </div>
        ) : (
          <div style={{ background: '#fff' }}>
            {moments.map((moment, idx) => (
              <div key={moment.id} style={{
                padding: '16px',
                borderBottom: idx < moments.length - 1 ? '0.5px solid #f0f0f0' : 'none',
              }}>
                {/* 头像 + 内容 */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                    {userProfile.avatar ? (
                      <img src={userProfile.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <DoveAvatar name={userProfile.nickname} id={userProfile.id} size={40} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* 昵称 */}
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#576b95', marginBottom: 4 }}>
                      {userProfile.nickname || userProfile.username}
                    </div>
                    {/* 文字内容 */}
                    {moment.content && (
                      <div style={{ fontSize: 15, color: '#1c1c1e', lineHeight: 1.5, marginBottom: 4, wordBreak: 'break-word' }}>
                        {moment.content}
                      </div>
                    )}
                    {/* 图片网格 */}
                    {moment.images && moment.images.length > 0 && renderImageGrid(moment.images)}
                    {/* 视频 */}
                    {moment.videos && moment.videos.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {moment.videos.map((videoUrl: string, vi: number) => (
                          <div key={vi} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', maxWidth: 240, marginBottom: 4 }}>
                            <video
                              src={videoUrl}
                              style={{ width: '100%', borderRadius: 6, display: 'block', background: '#000' }}
                              controls
                              playsInline
                              preload="metadata"
                              poster={moment.coverUrl || undefined}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 时间 + 操作 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <span style={{ fontSize: 12, color: '#8e8e93' }}>{formatTime(moment.createdAt)}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {moment.likeCount > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, color: '#8e8e93' }}>
                            <Heart size={12} /> {moment.likeCount}
                          </span>
                        )}
                        {moment.commentCount > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, color: '#8e8e93' }}>
                            <MessageCircle size={12} /> {moment.commentCount}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 点赞和评论区 */}
                    {((moment.likes && moment.likes.length > 0) || (moment.comments && moment.comments.length > 0)) && (
                      <div style={{ marginTop: 8, background: '#f7f7f7', borderRadius: 4, padding: '6px 8px' }}>
                        {/* 点赞列表 */}
                        {moment.likes && moment.likes.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 13, color: '#576b95', flexWrap: 'wrap' }}>
                            <Heart size={12} fill="#576b95" color="#576b95" style={{ marginTop: 2 }} />
                            {moment.likes.map((l, i) => (
                              <span key={i}>
                                {l.userName}{i < moment.likes!.length - 1 ? '，' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* 评论列表 */}
                        {moment.comments && moment.comments.length > 0 && (
                          <div style={{ marginTop: moment.likes && moment.likes.length > 0 ? 4 : 0 }}>
                            {moment.comments.map(c => (
                              <div key={c.id} style={{ fontSize: 13, lineHeight: 1.6 }}>
                                <span style={{ color: '#576b95', fontWeight: 500 }}>{c.userName}</span>
                                <span style={{ color: '#1c1c1e' }}>：{c.content}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loadingMore && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
                <Loader2 size={20} className="animate-spin" style={{ color: '#8e8e93' }} />
              </div>
            )}
            {!hasMore && moments.length > 0 && (
              <div style={{ textAlign: 'center', padding: 16, color: '#8e8e93', fontSize: 12 }}>
                — 没有更多了 —
              </div>
            )}
          </div>
        )}
      </div>

      {/* 图片灯箱 */}
      {lightboxImages && (
        <div
          onClick={() => setLightboxImages(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img
            src={lightboxImages[lightboxIndex]}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
          {lightboxImages.length > 1 && (
            <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: '#fff', fontSize: 14 }}>
              {lightboxIndex + 1} / {lightboxImages.length}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};

export default UserMomentsPage;
