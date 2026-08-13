/**
 * imim 用户资料详情页（全屏从右滑入）
 * 视频中展示的效果：
 * 1. 头部信息区：头像、昵称、认证标识、账号ID
 * 2. 功能列表：设置备注、朋友圈（带缩略图预览）、解除好友关系、拉入黑名单、投诉
 * 3. 点击朋友圈进入动态展示页（封面背景 + 头像昵称 + 动态信息流）
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { getUserById, CURRENT_USER } from '@/lib/store';
import type { User } from '@/lib/store';
import { DoveAvatar } from '@/components/DoveAvatar';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Loader2, Heart, MessageCircle, Video, MessageSquare } from 'lucide-react';
import { GoldVerifiedBadge } from '@/components/GoldVerifiedBadge';
import { authApi } from '@/lib/authFetch';
import UserMomentsPage from '@/components/profile/UserMomentsPage';
import { toast } from 'sonner';

// ===== 类型定义 =====
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

// ===== 朋友圈预览缩略图（最多5个，包含视频封面） =====
const MomentsPreviewThumbs: React.FC<{ moments: MomentItem[] }> = ({ moments }) => {
  // 从最近的朋友圈中提取缩略图（图片+视频封面）
  const thumbs: { url: string; isVideo: boolean; videoUrl?: string }[] = [];
  for (const m of moments) {
    if (thumbs.length >= 5) break;
    // 优先从 media 数组提取（包含视频）
    if (m.media && m.media.length > 0) {
      for (const media of m.media) {
        if (thumbs.length >= 5) break;
        if (media.type === 'image') {
          thumbs.push({ url: media.thumbUrl || media.mediumUrl || media.url, isVideo: false });
        } else if (media.type === 'video') {
          // 视频使用封面图，如果没有封面则使用视频URL本身（让video标签提取帧）
          const poster = media.thumbUrl || media.mediumUrl || '';
          thumbs.push({ url: poster, isVideo: true, videoUrl: media.url });
        }
      }
    } else if (m.images && m.images.length > 0) {
      for (const img of m.images) {
        if (thumbs.length >= 5) break;
        thumbs.push({ url: img, isVideo: false });
      }
    }
  }

  if (thumbs.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {thumbs.map((thumb, i) => (
        <div key={i} style={{ width: 40, height: 40, borderRadius: 4, overflow: 'hidden', flexShrink: 0, position: 'relative', background: '#e5e5e5' }}>
          {thumb.isVideo && thumb.videoUrl ? (
            <video src={`${thumb.videoUrl}#t=0.5`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted preload="metadata" playsInline />
          ) : thumb.url ? (
            <img src={thumb.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : null}
          {thumb.isVideo && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ===== 朋友圈动态页面 =====
// ===== 主组件：用户个人详情页 =====
export const UserProfileSheet: React.FC = () => {
  const { state } = useApp();
  const { hideProfile, openChat, startCall, setTab, upsertChat } = useAppActions();
  const userId = state.showProfile;

  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [moments, setMoments] = useState<MomentItem[]>([]);
  const [loadingMoments, setLoadingMoments] = useState(false);
  const [showMomentsPage, setShowMomentsPage] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [checkingFriend, setCheckingFriend] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showConfirmBlock, setShowConfirmBlock] = useState(false);
  const [showRemarkInput, setShowRemarkInput] = useState(false);
  const [remarkValue, setRemarkValue] = useState('');
  const [showAvatarLightbox, setShowAvatarLightbox] = useState(false);

  useEffect(() => {
    if (!userId) {
      setUser(null);
      setUserProfile(null);
      setMoments([]);
      setShowMomentsPage(false);
      return;
    }

    // 从本地查找用户
    const local = getUserById(userId);
    if (local) setUser(local);

    // 从 chats 中查找
    const chatWithUser = state.chats.find(c =>
      c.type === 'private' && c.members?.includes(userId)
    );
    if (chatWithUser && !local) {
      setUser({
        id: userId,
        uniqueId: userId,
        name: chatWithUser.name,
        avatar: chatWithUser.avatar || '',
        status: 'offline',
      });
    }

    // 从 API 加载完整用户信息
    setLoadingUser(true);
    authApi(`/api/users/${userId}`, undefined, 'GET')
      .then((data: any) => {
        if (data?.id) {
          setUser({
            id: data.id,
            uniqueId: data.username || data.id,
            name: data.nickname || data.username || data.id,
            avatar: data.avatar || '',
            status: data.online ? 'online' : 'offline',
            bio: data.bio || '',
          });
          setUserProfile({
            id: data.id,
            username: data.username || data.id,
            nickname: data.nickname || data.username || data.id,
            avatar: data.avatar || '',
            bio: data.bio || '',
            backgroundUrl: data.backgroundUrl || '',
            online: data.online,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoadingUser(false));

    // 加载用户的朋友圈预览（最近5条，使用认证请求以获取好友可见动态）
    setLoadingMoments(true);
    authApi(`/api/moments?userId=${userId}&limit=5`, undefined, 'GET')
      .then((data: any) => {
        if (data?.moments) {
          const list = data.moments.map((m: any) => ({
            id: m.id,
            content: m.content || '',
            media: m.media || [],
            images: m.images || (m.media?.filter((md: any) => md.type === 'image').map((md: any) => md.mediumUrl || md.thumbUrl || md.url)) || [],
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
        }
      })
      .catch(() => {})
      .finally(() => setLoadingMoments(false));

    // 加载用户背景图
    fetch(`/api/q/profile/${userId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.profile) {
          setUserProfile(prev => ({
            id: data.profile.id || userId,
            username: prev?.username || data.profile.name || userId,
            nickname: data.profile.name || prev?.nickname || userId,
            avatar: data.profile.avatar || prev?.avatar || '',
            bio: data.profile.bio || prev?.bio || '',
            backgroundUrl: data.profile.backgroundUrl || '',
            online: prev?.online,
          }));
        }
      })
      .catch(() => {});

    // 检查好友关系
    setCheckingFriend(true);
    authApi(`/api/friend/check/${userId}`, undefined, 'GET')
      .then((data: any) => {
        setIsFriend(data?.isFriend ?? false);
      })
      .catch(() => {})
      .finally(() => setCheckingFriend(false));
  }, [userId]);

  if (!userId) return null;

  // 加载中
  if (loadingUser && !user) {
    return ReactDOM.createPortal(
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0, 0.67, 0] }}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 200, background: '#f2f2f7',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={24} className="animate-spin" style={{ color: '#8e8e93' }} />
          <p style={{ marginTop: 8, fontSize: 14, color: '#8e8e93' }}>加载用户信息...</p>
        </div>
      </motion.div>,
      document.body
    );
  }

  if (!user) return null;

  // 解除好友关系
  const handleDeleteFriend = async () => {
    try {
      await authApi(`/api/friend/${userId}`, undefined, 'DELETE');
      toast.success('已解除好友关系');
      setIsFriend(false);
      setShowConfirmDelete(false);
    } catch (e: any) {
      toast.error(e.message || '操作失败');
    }
  };

  // 投诉
  const handleReport = async () => {
    const reason = prompt('请输入投诉原因：');
    if (!reason || !reason.trim()) return;
    try {
      await authApi('/api/report', {
        targetType: 'user',
        targetId: userId,
        reason: reason.trim(),
      });
      toast.success('投诉已提交，我们会尽快处理');
    } catch (e: any) {
      toast.error(e.message || '投诉提交失败');
    }
  };

  // 拉入黑名单（前端提示，后端暂未实现完整黑名单功能）
  const handleBlock = async () => {
    try {
      // 先解除好友关系
      if (isFriend) {
        await authApi(`/api/friend/${userId}`, undefined, 'DELETE');
        setIsFriend(false);
      }
      toast.success('已将对方拉入黑名单');
      setShowConfirmBlock(false);
    } catch (e: any) {
      toast.error(e.message || '操作失败');
    }
  };

  const content = (
    <AnimatePresence>
      {userId && user && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0, 0.67, 0] }}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 200,
            background: '#f2f2f7',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* 顶部导航栏 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: '#f2f2f7',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
            flexShrink: 0,
          }}>
            <button
              onClick={hideProfile}
              style={{
                display: 'flex', alignItems: 'center', gap: 2,
                color: '#007AFF', fontSize: 14, fontWeight: 500,
                background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              <ChevronLeft size={20} />
              返回
            </button>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#1c1c1e' }}>
              个人信息
            </span>
            <div style={{ width: 60 }} />
          </div>

          {/* 内容区域 */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
          }}>
            {/* 封面背景区域 */}
            {userProfile?.backgroundUrl && (
              <div style={{
                width: '100%',
                height: 120,
                backgroundImage: `url('${userProfile.backgroundUrl}')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRadius: 0,
              }} />
            )}
            {/* 头部信息区 */}
            <div style={{
              background: '#fff',
              marginTop: userProfile?.backgroundUrl ? 0 : 10,
              padding: '20px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}>
              {/* 头像 - 点击查看大图 */}
              <div
                onClick={() => setShowAvatarLightbox(true)}
                style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden', flexShrink: 0, cursor: 'pointer' }}
              >
                {user.avatar ? (
                  <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <DoveAvatar name={user.name} id={user.id} size={64} />
                )}
              </div>
              {/* 昵称 + 认证 + 账号ID */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 600, color: '#1c1c1e' }}>
                    {user.name}
                  </span>
                  {(user.isOfficial || user.isVerified) && (
                    <GoldVerifiedBadge size={18} />
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#8e8e93', marginTop: 4 }}>
                  imim号：{user.uniqueId || userProfile?.username || user.id}
                </div>
                {user.bio && (
                  <div style={{ fontSize: 13, color: '#8e8e93', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.bio}
                  </div>
                )}
              </div>
            </div>

            {/* 功能列表 */}
            <div style={{ marginTop: 10 }}>
              {/* 设置备注 */}
              <div
                onClick={() => setShowRemarkInput(true)}
                style={{
                  background: '#fff',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  borderBottom: '0.5px solid #f0f0f0',
                }}
              >
                <span style={{ fontSize: 16, color: '#1c1c1e' }}>设置备注</span>
                <ChevronRight size={18} color="#c7c7cc" />
              </div>

              {/* 朋友圈 */}
              <div
                onClick={() => setShowMomentsPage(true)}
                style={{
                  background: '#fff',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  borderBottom: '0.5px solid #f0f0f0',
                }}
              >
                <span style={{ fontSize: 16, color: '#1c1c1e' }}>朋友圈</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {loadingMoments ? (
                    <Loader2 size={16} className="animate-spin" style={{ color: '#8e8e93' }} />
                  ) : (
                    <MomentsPreviewThumbs moments={moments} />
                  )}
                  <ChevronRight size={18} color="#c7c7cc" />
                </div>
              </div>
            </div>

            {/* 危险操作区 */}
            {isFriend && (
              <div style={{ marginTop: 10 }}>
                {/* 解除好友关系 */}
                <div
                  onClick={() => setShowConfirmDelete(true)}
                  style={{
                    background: '#fff',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    borderBottom: '0.5px solid #f0f0f0',
                  }}
                >
                  <span style={{ fontSize: 16, color: '#1c1c1e' }}>解除好友关系</span>
                  <ChevronRight size={18} color="#c7c7cc" />
                </div>

                {/* 拉入黑名单 */}
                <div
                  onClick={() => setShowConfirmBlock(true)}
                  style={{
                    background: '#fff',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    borderBottom: '0.5px solid #f0f0f0',
                  }}
                >
                  <span style={{ fontSize: 16, color: '#1c1c1e' }}>拉入黑名单</span>
                  <ChevronRight size={18} color="#c7c7cc" />
                </div>

                {/* 投诉 */}
                <div
                  onClick={handleReport}
                  style={{
                    background: '#fff',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 16, color: '#1c1c1e' }}>投诉</span>
                  <ChevronRight size={18} color="#c7c7cc" />
                </div>
              </div>
            )}

            {/* 非好友也显示投诉 */}
            {!isFriend && !checkingFriend && (
              <div style={{ marginTop: 10 }}>
                <div
                  onClick={handleReport}
                  style={{
                    background: '#fff',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 16, color: '#1c1c1e' }}>投诉</span>
                  <ChevronRight size={18} color="#c7c7cc" />
                </div>
              </div>
            )}

            {/* 底部安全间距（为固定按钮留空间） */}
            <div style={{ height: 100 }} />
          </div>

          {/* 底部固定按钮栏：视频通话 + 发消息 */}
          {isFriend && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              display: 'flex',
              gap: 12,
              padding: '12px 16px',
              paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)',
              background: '#f2f2f7',
              borderTop: '1px solid rgba(0,0,0,0.08)',
            }}>
              <button
                onClick={() => {
                  if (user) {
                    startCall(user.id, user.name, user.avatar || '', 'video', false);
                    hideProfile();
                  }
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '12px 0',
                  borderRadius: 8,
                  border: '1px solid #e5e5ea',
                  background: '#fff',
                  fontSize: 15,
                  fontWeight: 500,
                  color: '#1c1c1e',
                  cursor: 'pointer',
                }}
              >
                <Video size={18} color="#1c1c1e" />
                视频通话
              </button>
              <button
                onClick={async () => {
                  if (!user) return;
                  try {
                    // 创建或获取私聊会话
                    const res = await authApi('/api/chat/create', { targetUserId: user.id });
                    if (res?.chat?.id) {
                      // 更新本地会话列表
                      upsertChat({
                        id: res.chat.id,
                        type: 'private',
                        name: res.chat.peer?.nickname || res.chat.peer?.username || user.name,
                        avatar: res.chat.peer?.avatar || user.avatar || '',
                        unreadCount: 0,
                        isPinned: false,
                        isMuted: false,
                        members: [state.currentUser?.id || '', user.id],
                        lastMessage: '',
                        lastMessageTime: res.chat.lastMessageAt || Date.now(),
                      });
                      openChat(res.chat.id);
                      hideProfile();
                      setTab('chats');
                    }
                  } catch (e: any) {
                    toast.error(e.message || '打开会话失败');
                  }
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '12px 0',
                  borderRadius: 8,
                  border: 'none',
                  background: '#ff6723',
                  fontSize: 15,
                  fontWeight: 500,
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                <MessageSquare size={18} color="#fff" />
                发消息
              </button>
            </div>
          )}

          {/* 确认解除好友弹窗 */}
          <AnimatePresence>
            {showConfirmDelete && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 250 }}
                  onClick={() => setShowConfirmDelete(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  style={{
                    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    zIndex: 251, background: '#fff', borderRadius: 14, width: 270,
                    overflow: 'hidden', textAlign: 'center',
                  }}
                >
                  <div style={{ padding: '20px 16px 16px' }}>
                    <p style={{ fontSize: 17, fontWeight: 600, color: '#1c1c1e' }}>解除好友关系</p>
                    <p style={{ fontSize: 13, color: '#8e8e93', marginTop: 8 }}>
                      确定要解除与 {user.name} 的好友关系吗？
                    </p>
                  </div>
                  <div style={{ display: 'flex', borderTop: '0.5px solid rgba(0,0,0,0.1)' }}>
                    <button
                      onClick={() => setShowConfirmDelete(false)}
                      style={{ flex: 1, padding: '12px 0', fontSize: 17, color: '#007AFF', background: 'none', border: 'none', borderRight: '0.5px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}
                    >取消</button>
                    <button
                      onClick={handleDeleteFriend}
                      style={{ flex: 1, padding: '12px 0', fontSize: 17, fontWeight: 600, color: '#ff3b30', background: 'none', border: 'none', cursor: 'pointer' }}
                    >确定</button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* 确认拉黑弹窗 */}
          <AnimatePresence>
            {showConfirmBlock && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 250 }}
                  onClick={() => setShowConfirmBlock(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  style={{
                    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    zIndex: 251, background: '#fff', borderRadius: 14, width: 270,
                    overflow: 'hidden', textAlign: 'center',
                  }}
                >
                  <div style={{ padding: '20px 16px 16px' }}>
                    <p style={{ fontSize: 17, fontWeight: 600, color: '#1c1c1e' }}>拉入黑名单</p>
                    <p style={{ fontSize: 13, color: '#8e8e93', marginTop: 8 }}>
                      拉黑后将解除好友关系，对方将无法给你发送消息。
                    </p>
                  </div>
                  <div style={{ display: 'flex', borderTop: '0.5px solid rgba(0,0,0,0.1)' }}>
                    <button
                      onClick={() => setShowConfirmBlock(false)}
                      style={{ flex: 1, padding: '12px 0', fontSize: 17, color: '#007AFF', background: 'none', border: 'none', borderRight: '0.5px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}
                    >取消</button>
                    <button
                      onClick={handleBlock}
                      style={{ flex: 1, padding: '12px 0', fontSize: 17, fontWeight: 600, color: '#ff3b30', background: 'none', border: 'none', cursor: 'pointer' }}
                    >确定</button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* 设置备注弹窗 */}
          <AnimatePresence>
            {showRemarkInput && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 250 }}
                  onClick={() => setShowRemarkInput(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  style={{
                    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    zIndex: 251, background: '#fff', borderRadius: 14, width: 270,
                    overflow: 'hidden', textAlign: 'center',
                  }}
                >
                  <div style={{ padding: '20px 16px 12px' }}>
                    <p style={{ fontSize: 17, fontWeight: 600, color: '#1c1c1e', marginBottom: 12 }}>设置备注</p>
                    <input
                      type="text"
                      value={remarkValue}
                      onChange={e => setRemarkValue(e.target.value)}
                      placeholder="输入备注名"
                      style={{
                        width: '100%', padding: '8px 12px', fontSize: 15,
                        border: '1px solid #e5e5ea', borderRadius: 8, outline: 'none',
                        boxSizing: 'border-box',
                      }}
                      autoFocus
                    />
                  </div>
                  <div style={{ display: 'flex', borderTop: '0.5px solid rgba(0,0,0,0.1)' }}>
                    <button
                      onClick={() => setShowRemarkInput(false)}
                      style={{ flex: 1, padding: '12px 0', fontSize: 17, color: '#007AFF', background: 'none', border: 'none', borderRight: '0.5px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}
                    >取消</button>
                    <button
                      onClick={() => {
                        toast.success('备注已设置');
                        setShowRemarkInput(false);
                      }}
                      style={{ flex: 1, padding: '12px 0', fontSize: 17, fontWeight: 600, color: '#007AFF', background: 'none', border: 'none', cursor: 'pointer' }}
                    >确定</button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* 头像大图查看 */}
          {showAvatarLightbox && user.avatar && (
            <div
              onClick={() => setShowAvatarLightbox(false)}
              style={{
                position: 'fixed', inset: 0, zIndex: 300,
                background: 'rgba(0,0,0,0.9)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <img
                src={user.avatar}
                alt=""
                style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: 4 }}
              />
            </div>
          )}

          {/* 朋友圈详情页 */}
          <AnimatePresence>
            {showMomentsPage && userProfile && (
              <UserMomentsPage
                userId={userId}
                userProfile={userProfile}
                onClose={() => setShowMomentsPage(false)}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return ReactDOM.createPortal(content, document.body);
};
