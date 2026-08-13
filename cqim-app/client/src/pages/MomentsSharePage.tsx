/**
 * 朋友圈外链页面 — 与 pyq 项目完全一致的微信朋友圈风格
 * 适配 cqim 后端 API（/api/moments）
 */
import { useState, useRef, useCallback, useEffect } from "react";
import type { ShareComment as Comment, ShareLikeUser as LikeUser, SharePost as Post, ShareProfileUser as ProfileUser, ShareUser as User } from '@/components/moments/types';
import SharedImageLightbox from '@/components/moments/ImageLightbox';
import SharedVideoThumbnail from '@/components/moments/VideoThumbnail';

// ===== 工具函数 =====
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const postDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (postDay.getTime() === today.getTime()) return "今天";
  if (postDay.getTime() === yesterday.getTime()) return "昨天";
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return `${String(day).padStart(2, "0")} ${month}月`;
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = now.getTime() - target.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSeconds < 60) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  const hour = String(target.getHours()).padStart(2, "0");
  const minute = String(target.getMinutes()).padStart(2, "0");
  if (year === now.getFullYear()) return `${month}-${day} ${hour}:${minute}`;
  return `${year}-${month}-${day}`;
}

function getPostCover(post: Post): { type: "image" | "video"; url: string; coverUrl?: string } | null {
  if (post.videos && post.videos.length > 0) {
    return { type: "video", url: post.videos[0], coverUrl: post.coverUrl || undefined };
  }
  if (post.images && post.images.length > 0) {
    return { type: "image", url: post.images[0] };
  }
  return null;
}

function getImageCount(post: Post): number {
  return post.images?.length || 0;
}

function getUserAvatar(user: User): string | null {
  return user.avatarUrl || user.avatar || null;
}

// ===== 主题类型 =====
type ThemeMode = "light" | "dark" | "system";

// ===== MomentCard（详情弹窗用，与 pyq 完全一致）=====
const MAX_CONTENT_LENGTH = 120;

function MomentCard({ post, currentUserId, onLikeUpdate, onCommentAdded, onCommentDeleted, onPostDeleted, onImageClick, onPinUpdate, onContentUpdate, onEditTime, onLocationUpdate }: {
  post: Post;
  currentUserId: string | null;
  onLikeUpdate: (postId: string, liked: boolean, count: number, likeUser?: LikeUser) => void;
  onCommentAdded: (postId: string, comment: Comment) => void;
  onCommentDeleted: (postId: string, commentId: string) => void;
  onPostDeleted: (postId: string) => void;
  onImageClick: (images: string[], index: number) => void;
  onPinUpdate?: (postId: string, isPinned: boolean) => void;
  onContentUpdate?: (postId: string, newContent: string) => void;
  onEditTime?: (postId: string, currentTime: string) => void;
  onLocationUpdate?: (postId: string, newLocation: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [showOwnerDotMenu, setShowOwnerDotMenu] = useState(false);
  const [showEditMenu, setShowEditMenu] = useState(false);
  const [showEditLocationModal, setShowEditLocationModal] = useState(false);
  const [editLocationValue, setEditLocationValue] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const ownerDotMenuRef = useRef<HTMLDivElement>(null);
  const editMenuRef = useRef<HTMLDivElement>(null);

  const displayName = post.user.nickname || post.user.username;
  const avatarUrl = getUserAvatar(post.user);
  const isOwner = currentUserId === post.user.id;
  const isLong = (post.content?.length || 0) > MAX_CONTENT_LENGTH;
  const displayContent = isLong && !expanded ? post.content!.slice(0, MAX_CONTENT_LENGTH) : post.content;

  useEffect(() => {
    if (!showActions) return;
    const handleClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setShowActions(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showActions]);

  useEffect(() => {
    if (!showOwnerDotMenu) return;
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (ownerDotMenuRef.current && !ownerDotMenuRef.current.contains(e.target as Node)) setShowOwnerDotMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("touchstart", handleClick); };
  }, [showOwnerDotMenu]);

  useEffect(() => {
    if (!showEditMenu) return;
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (editMenuRef.current && !editMenuRef.current.contains(e.target as Node)) setShowEditMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("touchstart", handleClick); };
  }, [showEditMenu]);

  const handleLike = async () => {
    if (!currentUserId || likePending) return;
    setLikePending(true);
    const wasLiked = post.isLiked;
    const newCount = wasLiked ? post.likesCount - 1 : post.likesCount + 1;
    onLikeUpdate(post.id, !wasLiked, newCount);
    try {
      const res = await fetch(`/api/moments/${post.id}/like`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.likeUser) onLikeUpdate(post.id, !wasLiked, newCount, data.likeUser);
    } catch {
      onLikeUpdate(post.id, wasLiked, post.likesCount);
    } finally {
      setLikePending(false);
    }
  };

  const handlePin = async () => {
    if (!currentUserId || pinPending || !isOwner) return;
    setPinPending(true);
    setShowActions(false);
    try {
      const res = await fetch(`/api/moments/${post.id}/pin`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.success) onPinUpdate?.(post.id, data.isPinned ?? false);
    } catch {} finally { setPinPending(false); }
  };

  const openEditModal = () => {
    setEditContent(post.content || "");
    setShowEditModal(true);
    setShowActions(false);
  };

  const handleEditPost = async () => {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/moments/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: editContent }),
      });
      const data = await res.json();
      if (data.success) {
        onContentUpdate?.(post.id, editContent);
        setShowEditModal(false);
      } else {
        alert(data.error || "编辑失败");
      }
    } catch { alert("编辑失败，请稍后重试"); } finally { setSavingEdit(false); }
  };

  const handleEditLocation = async () => {
    if (savingLocation) return;
    setSavingLocation(true);
    try {
      const res = await fetch(`/api/moments/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ location: editLocationValue }),
      });
      const data = await res.json();
      if (data.success) {
        onLocationUpdate?.(post.id, editLocationValue);
        setShowEditLocationModal(false);
      } else {
        alert(data.error || "修改位置失败");
      }
    } catch { alert("修改位置失败"); } finally { setSavingLocation(false); }
  };

  const handleComment = async () => {
    if (!commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const body: any = { content: commentText.trim() };
      if (replyTo) body.replyToId = replyTo.id;
      const res = await fetch(`/api/moments/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.comment) {
        onCommentAdded(post.id, data.comment);
        setCommentText("");
        setReplyTo(null);
        setShowCommentInput(false);
      }
    } catch {} finally { setSubmittingComment(false); }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await fetch(`/api/moments/${post.id}/comments/${commentId}`, { method: "DELETE", credentials: "include" });
      onCommentDeleted(post.id, commentId);
    } catch {}
  };

  const handleDeletePost = async () => {
    try {
      await fetch(`/api/moments/${post.id}`, { method: "DELETE", credentials: "include" });
      onPostDeleted(post.id);
    } catch {}
    setShowDeleteConfirm(false);
  };

  const images = post.images || [];
  const videos = post.videos || [];
  const likeUsers = post.likeUsers || [];
  const isSingleImage = images.length === 1;
  const gridCols = images.length === 2 || images.length === 4 ? 2 : 3;

  return (
    <>
      <article style={{ display: "flex", flexDirection: "row", borderBottom: "1px solid #f0f0f0", paddingTop: 20, paddingLeft: 20, paddingRight: 20, position: "relative" }}>
        {post.isPinned && (
          <div style={{ position: "absolute", top: 0, right: 0, display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", background: "#f0f7ff", borderBottomLeftRadius: 6, fontSize: 11, color: "#576b95" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#576b95" stroke="none"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
            置顶
          </div>
        )}
        <div style={{ marginRight: 12 }}>
          <div style={{ width: 36, height: 36 }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 8 }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: "bold", color: "#fff", background: "linear-gradient(135deg, #4ade80, #2dd4bf)" }}>
                {displayName[0]?.toUpperCase() || "?"}
              </div>
            )}
          </div>
        </div>
        <div style={{ width: "100%", paddingBottom: 4 }}>
          <section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ color: "#576b95", fontSize: 14, cursor: "default" }}>{displayName}</span>
          </section>
          {post.content && (
            <>
              <section style={{ marginBottom: 4, fontSize: 14, lineHeight: 1.6, color: "#282828", wordBreak: "break-all" }}>
                {displayContent}
                {isLong && !expanded && (
                  <>
                    <span style={{ color: "#888" }}>...</span>
                    <span onClick={() => setExpanded(true)} style={{ color: "#576b95", cursor: "pointer", marginLeft: 4, fontSize: 14 }}>全文</span>
                  </>
                )}
              </section>
              {isLong && expanded && (
                <span onClick={() => setExpanded(false)} style={{ color: "#576b95", cursor: "pointer", marginBottom: 4, display: "block", fontSize: 14 }}>收起</span>
              )}
            </>
          )}
          {images.length > 0 && (
            <section style={{ display: "grid", gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 2, overflow: "hidden", marginBottom: 12 }}>
              {images.slice(0, 9).map((img, i) => (
                <div key={i} onClick={() => onImageClick(images, i)} style={{ overflow: "hidden", cursor: "zoom-in", ...(isSingleImage ? { gridColumn: "span 2" } : {}), position: "relative" }}>
                  {isSingleImage ? (
                    <img src={img} alt={`图片 ${i + 1}`} style={{ maxWidth: "100%", maxHeight: 256, objectFit: "cover", display: "block", width: "auto" }} />
                  ) : (
                    <div style={{ position: "relative", paddingTop: "100%" }}>
                      <img src={img} alt={`图片 ${i + 1}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
          {videos.length > 0 && (
            <div style={{ marginBottom: 12, overflow: "hidden", background: "#000", borderRadius: 2, maxWidth: 280 }}>
              <video src={videos[0]} controls playsInline muted style={{ width: "100%", maxHeight: 200, display: "block" }} />
            </div>
          )}
          {post.location && (
            <section style={{ marginBottom: 4 }}>
              <span style={{ color: "#576b95", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#576b95" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
                {post.location}
              </span>
            </section>
          )}
          <section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ color: "#999", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
              {formatRelativeTime(new Date(post.createdAt))}
              {isOwner && (
                <div style={{ position: "relative" }} ref={ownerDotMenuRef}>
                  <button onClick={() => setShowOwnerDotMenu((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", padding: "2px 4px", borderRadius: 4, background: "transparent", border: "none" }}>
                    <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
                    <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
                    <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
                  </button>
                  {showOwnerDotMenu && (
                    <div style={{ position: "absolute", left: 0, top: 24, zIndex: 20, background: "#fff", border: "0.5px solid #e8e8e8", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 100, overflow: "hidden" }}>
                      <button onClick={() => { setShowOwnerDotMenu(false); openEditModal(); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 14, color: "#282828", background: "none", border: "none", borderBottom: "0.5px solid #f0f0f0", cursor: "pointer" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#576b95" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        编辑
                      </button>
                      <button onClick={() => { setShowOwnerDotMenu(false); setShowDeleteConfirm(true); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 14, color: "#ff4444", background: "none", border: "none", cursor: "pointer" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        删除
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ width: 30, height: 20, position: "relative" }} ref={actionsRef}>
              {currentUserId && (
                <div onClick={() => setShowActions(!showActions)} style={{ width: 30, height: 20, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 3, cursor: "pointer" }}>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
                </div>
              )}
              {showActions && currentUserId && (
                <div style={{ position: "absolute", right: 40, top: -10, zIndex: 10 }}>
                  <div style={{ background: "#4c4c4c", color: "#fff", padding: "8px 16px", borderRadius: 4, display: "flex", alignItems: "center" }}>
                    <button onClick={() => { handleLike(); setShowActions(false); }} style={{ cursor: "pointer", color: "#fff", background: "none", border: "none", display: "flex", alignItems: "center", fontSize: 14, gap: 6, paddingRight: 12 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={post.isLiked ? "#ff6b6b" : "none"} stroke={post.isLiked ? "#ff6b6b" : "#fff"} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                      {post.isLiked ? "取消" : "赞"}
                    </button>
                    <span style={{ background: "#454545", height: 22, width: 1, display: "inline-block" }} />
                    <button onClick={() => { setShowActions(false); setShowCommentInput(true); setReplyTo(null); setTimeout(() => commentInputRef.current?.focus(), 100); }} style={{ cursor: "pointer", color: "#fff", background: "none", border: "none", display: "flex", alignItems: "center", fontSize: 14, gap: 6, paddingLeft: 12, paddingRight: isOwner ? 12 : 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 12.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                      评论
                    </button>
                    {isOwner && (
                      <>
                        <span style={{ background: "#454545", height: 22, width: 1, display: "inline-block" }} />
                        <button onClick={handlePin} disabled={pinPending} style={{ cursor: "pointer", color: "#fff", background: "none", border: "none", display: "flex", alignItems: "center", fontSize: 14, gap: 6, paddingLeft: 12, paddingRight: 12, opacity: pinPending ? 0.5 : 1 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={post.isPinned ? "#ffd700" : "none"} stroke={post.isPinned ? "#ffd700" : "#fff"} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                          {post.isPinned ? "取消置顶" : "置顶"}
                        </button>
                        <span style={{ background: "#454545", height: 22, width: 1, display: "inline-block" }} />
                        <div ref={editMenuRef} style={{ position: "relative" }}>
                          <button onClick={() => setShowEditMenu(v => !v)} style={{ cursor: "pointer", color: "#fff", background: "none", border: "none", display: "flex", alignItems: "center", fontSize: 14, gap: 6, paddingLeft: 12 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            编辑
                          </button>
                          {showEditMenu && (
                            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "#222", borderRadius: 10, overflow: "hidden", minWidth: 110, boxShadow: "0 4px 20px rgba(0,0,0,0.4)", zIndex: 100 }}>
                              <button onClick={() => { setShowEditMenu(false); openEditModal(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "11px 14px", background: "none", border: "none", color: "#fff", fontSize: 14, cursor: "pointer", borderBottom: "0.5px solid #333" }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                编辑内容
                              </button>
                              <button onClick={() => { setShowEditMenu(false); setShowActions(false); onEditTime?.(post.id, post.createdAt); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "11px 14px", background: "none", border: "none", color: "#fff", fontSize: 14, cursor: "pointer", borderBottom: "0.5px solid #333" }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" /></svg>
                                修改时间
                              </button>
                              <button onClick={() => { setShowEditMenu(false); setEditLocationValue(post.location || ""); setShowEditLocationModal(true); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "11px 14px", background: "none", border: "none", color: "#fff", fontSize: 14, cursor: "pointer" }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
                                修改位置
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
          <section style={{ borderRadius: 6, overflow: "hidden", marginBottom: 4, wordBreak: "break-all" }}>
            {likeUsers.length > 0 && (
              <div style={{ background: "#f7f7f7", padding: "8px 12px", display: "flex", alignItems: "center", borderBottom: post.comments.length > 0 ? "1px solid #efefef" : "none" }}>
                <span style={{ display: "inline-block", marginRight: 8, flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#f4516c" stroke="none"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                </span>
                <span style={{ fontSize: 14 }}>
                  <span style={{ color: "#576b95", fontSize: 14 }}>
                    {likeUsers.map((lu, idx) => (
                      <span key={lu.id}>
                        <span style={{ color: "#576b95", cursor: "pointer" }}>{lu.nickname || lu.username}</span>
                        {idx < likeUsers.length - 1 && <span style={{ color: "#576b95" }}>，</span>}
                      </span>
                    ))}
                  </span>
                </span>
              </div>
            )}
            {post.comments.length > 0 && (
              <div style={{ background: "#f7f7f7" }}>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {post.comments.map((comment) => (
                    <li key={comment.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "0 12px", lineHeight: "22px", minHeight: 24 }}>
                      <div style={{ fontSize: 14, color: "#282828", flex: 1, wordBreak: "break-all" }}>
                        <span style={{ color: "#576b95", cursor: "pointer" }}>{comment.user.nickname || comment.user.username}</span>
                        <span>：{comment.content}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: 8 }}>
                        {currentUserId && (
                          <button onClick={() => { setReplyTo({ id: comment.id, username: comment.user.nickname || comment.user.username }); setShowCommentInput(true); setTimeout(() => commentInputRef.current?.focus(), 100); }} style={{ fontSize: 12, color: "#576b95", cursor: "pointer", background: "none", border: "none" }}>回复</button>
                        )}
                        {(currentUserId === comment.user.id || currentUserId === post.user.id) && (
                          <button onClick={() => handleDeleteComment(comment.id)} style={{ fontSize: 12, color: "#576b95", cursor: "pointer", background: "none", border: "none", marginLeft: 4 }}>删除</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          {showCommentInput && currentUserId && (
            <div style={{ marginTop: 8, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "#f0f0f0", borderRadius: 18, padding: "5px 12px" }}>
                {replyTo && <span style={{ fontSize: 12, color: "#999", flexShrink: 0 }}>回复 {replyTo.username}:</span>}
                <input ref={commentInputRef} type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleComment()} placeholder={replyTo ? `回复 ${replyTo.username}...` : "写评论..."} maxLength={500} style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 14, color: "#282828" }} />
                {replyTo && <button onClick={() => setReplyTo(null)} style={{ fontSize: 12, color: "#999", flexShrink: 0, cursor: "pointer", background: "none", border: "none" }}>×</button>}
              </div>
              <button onClick={handleComment} disabled={!commentText.trim() || submittingComment} style={{ color: "#07c160", fontSize: 14, fontWeight: 500, flexShrink: 0, background: "none", border: "none", cursor: "pointer", opacity: !commentText.trim() || submittingComment ? 0.4 : 1 }}>发送</button>
              <button onClick={() => { setShowCommentInput(false); setReplyTo(null); }} style={{ color: "#999", fontSize: 14, flexShrink: 0, cursor: "pointer", background: "none", border: "none" }}>取消</button>
            </div>
          )}
        </div>
      </article>
      {showDeleteConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}>
          <div style={{ background: "#fff", borderRadius: 12, width: 288, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", textAlign: "center" }}>
              <p style={{ color: "#282828", fontWeight: 500 }}>确定删除这条动态？</p>
              <p style={{ color: "#888", fontSize: 14, marginTop: 4 }}>删除后无法恢复</p>
            </div>
            <div style={{ display: "flex", borderTop: "1px solid #f2f2f2" }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, padding: "12px 0", color: "#666", fontSize: 14, fontWeight: 500, borderRight: "1px solid #f2f2f2", background: "none", border: "none", cursor: "pointer" }}>取消</button>
              <button onClick={handleDeletePost} style={{ flex: 1, padding: "12px 0", color: "#ff4444", fontSize: 14, fontWeight: 500, background: "none", border: "none", cursor: "pointer" }}>删除</button>
            </div>
          </div>
        </div>
      )}
      {showEditModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.5)" }} onClick={() => !savingEdit && setShowEditModal(false)}>
          <div style={{ width: "100%", maxWidth: 567, background: "#fff", borderRadius: "16px 16px 0 0", overflow: "hidden", paddingBottom: "env(safe-area-inset-bottom, 0px)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "0.5px solid #f0f0f0" }}>
              <button onClick={() => !savingEdit && setShowEditModal(false)} style={{ fontSize: 15, color: "#666", background: "none", border: "none", cursor: "pointer" }}>取消</button>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#282828" }}>编辑动态</span>
              <button onClick={handleEditPost} disabled={savingEdit} style={{ fontSize: 15, color: "#07c160", fontWeight: 600, background: "none", border: "none", cursor: "pointer", opacity: savingEdit ? 0.5 : 1 }}>{savingEdit ? "保存中..." : "保存"}</button>
            </div>
            <div style={{ padding: "12px 16px 16px" }}>
              <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} placeholder="说些什么..." maxLength={2000} rows={6} autoFocus style={{ width: "100%", resize: "none", border: "none", outline: "none", fontSize: 15, lineHeight: 1.6, color: "#282828", background: "transparent", boxSizing: "border-box" }} />
              <div style={{ textAlign: "right", fontSize: 12, color: editContent.length > 1900 ? "#ff4444" : "#bbb", marginTop: 4 }}>{editContent.length} / 2000</div>
            </div>
          </div>
        </div>
      )}
      {showEditLocationModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.5)" }} onMouseDown={(e) => { if (e.target === e.currentTarget && !savingLocation) setShowEditLocationModal(false); }} onTouchEnd={(e) => { if (e.target === e.currentTarget && !savingLocation) setShowEditLocationModal(false); }}>
          <div style={{ width: "100%", maxWidth: 567, background: "#fff", borderRadius: "16px 16px 0 0", overflow: "hidden", paddingBottom: "env(safe-area-inset-bottom, 0px)" }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "0.5px solid #f0f0f0" }}>
              <button onClick={() => !savingLocation && setShowEditLocationModal(false)} style={{ color: "#888", fontSize: 15, background: "none", border: "none", cursor: "pointer" }}>取消</button>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#282828" }}>修改位置</span>
              <button onClick={handleEditLocation} disabled={savingLocation} style={{ color: "#07c160", fontSize: 15, fontWeight: 600, background: "none", border: "none", cursor: "pointer", opacity: savingLocation ? 0.5 : 1 }}>{savingLocation ? "保存中..." : "保存"}</button>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f7f7f7", borderRadius: 8, padding: "10px 12px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
                <input type="text" value={editLocationValue} onChange={(e) => setEditLocationValue(e.target.value)} placeholder="输入位置，如：北京天安门" maxLength={200} autoFocus style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 15, color: "#282828" }} />
                {editLocationValue && <button onClick={() => setEditLocationValue("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#bbb", fontSize: 18, lineHeight: 1 }}>×</button>}
              </div>
              <p style={{ color: "#bbb", fontSize: 12, marginTop: 8, textAlign: "right" }}>{editLocationValue.length}/200</p>
              {post.location && <p style={{ color: "#888", fontSize: 13, marginTop: 4 }}>当前位置：{post.location}</p>}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes slideIn { 0% { opacity: 0; transform: translateX(8px); } 100% { opacity: 1; transform: translateX(0); } }
        @keyframes fadeInDown { 0% { opacity: 0; transform: translateY(-6px); } 100% { opacity: 1; transform: translateY(0); } }
      `}</style>
    </>
  );
}


// ===== 工具函数 =====
function localDateTimeToISO(localStr: string): string {
  return new Date(localStr).toISOString();
}

function isoToLocalDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const PAGE_SIZE = 20;

// ===== 主组件 =====
export default function MomentsSharePage() {
  // 从 URL 获取用户 ID
  const urlParams = new URLSearchParams(window.location.search);
  const pathParts = window.location.pathname.split("/");
  const userId = urlParams.get("userId") || pathParts[pathParts.length - 1] || "";

  const [profileUser, setProfileUser] = useState<ProfileUser | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [topBgOpacity, setTopBgOpacity] = useState(0);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // 排序模式
  const [sortMode, setSortMode] = useState(false);
  const [sortingPosts, setSortingPosts] = useState<Post[]>([]);
  const [savingSort, setSavingSort] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Touch 排序
  const touchDragIndex = useRef<number | null>(null);
  const touchLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartYRef = useRef<number>(0);
  const touchStartXRef = useRef<number>(0);
  const touchDragging = useRef<boolean>(false);
  const sortListRef = useRef<HTMLDivElement>(null);

  // 修改时间弹窗
  const [editTimePostId, setEditTimePostId] = useState<string | null>(null);
  const [editTimeValue, setEditTimeValue] = useState<string>("");
  const [savingTime, setSavingTime] = useState(false);

  // 置顶展开面板
  const [showAllPinnedSheet, setShowAllPinnedSheet] = useState(false);
  const [pinnedSortMode, setPinnedSortMode] = useState(false);
  const [sortingPinnedPosts, setSortingPinnedPosts] = useState<Post[]>([]);
  const [savingPinnedSort, setSavingPinnedSort] = useState(false);
  const pinnedDragItem = useRef<number | null>(null);
  const pinnedDragOverItem = useRef<number | null>(null);
  const pinnedTouchDragIndex = useRef<number | null>(null);
  const pinnedTouchLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedTouchStartY = useRef<number>(0);
  const pinnedTouchStartX = useRef<number>(0);
  const pinnedTouchDragging = useRef<boolean>(false);
  const pinnedSortGridRef = useRef<HTMLDivElement>(null);

  // 卡片三点菜单
  const [cardDotMenuPostId, setCardDotMenuPostId] = useState<string | null>(null);
  const [deletePostId, setDeletePostId] = useState<string | null>(null);
  const [deletingPost, setDeletingPost] = useState(false);
  const [showEditContentModal, setShowEditContentModal] = useState(false);
  const [editContentPostId, setEditContentPostId] = useState<string | null>(null);
  const [editContentValue, setEditContentValue] = useState("");
  const [savingEditContent, setSavingEditContent] = useState(false);

  // ===== 暗色模式 =====
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("pyq-theme") as ThemeMode | null;
    const mode: ThemeMode = saved || "light";
    setThemeMode(mode);
    const applyTheme = (m: ThemeMode) => {
      if (m === "dark") setIsDark(true);
      else if (m === "light") setIsDark(false);
      else setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    };
    applyTheme(mode);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if ((localStorage.getItem("pyq-theme") || "system") === "system") setIsDark(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const cycleTheme = () => {
    const next: ThemeMode = themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light";
    setThemeMode(next);
    localStorage.setItem("pyq-theme", next);
    if (next === "dark") setIsDark(true);
    else if (next === "light") setIsDark(false);
    else setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
  };

  const colors = {
    bg: isDark ? "#1a1a1a" : "#fff",
    bgSecondary: isDark ? "#242424" : "#fff",
    bgCard: isDark ? "#2a2a2a" : "#f5f5f5",
    bgSheet: isDark ? "#1e1e1e" : "#f2f2f7",
    bgSheetItem: isDark ? "#2c2c2c" : "#fff",
    text: isDark ? "#e8e8e8" : "#222",
    textSecondary: isDark ? "#aaa" : "#888",
    textMuted: isDark ? "#666" : "#999",
    textContent: isDark ? "#d0d0d0" : "#333",
    border: isDark ? "#333" : "#f0f0f0",
    borderModal: isDark ? "#3a3a3a" : "#f2f2f2",
    borderInput: isDark ? "#444" : "#e5e5ea",
    accent: "#576b95",
    sortDragBg: isDark ? "#1e2a3a" : "#f0f7ff",
    modalBg: isDark ? "#242424" : "#fff",
    modalText: isDark ? "#e0e0e0" : "#282828",
    sheetDivider: isDark ? "#3a3a3a" : "#e5e5ea",
  };

  // ===== 初始化数据加载 =====
  useEffect(() => {
    if (!userId) return;
    const loadData = async () => {
      try {
        // 加载用户信息
        const profileRes = await fetch(`/api/q/profile/${userId}`);
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          setProfileUser(profileData);
        }
        // 加载动态
        const momentsRes = await fetch(`/api/moments?userId=${userId}&limit=${PAGE_SIZE}&shareMode=1`);
        if (momentsRes.ok) {
          const momentsData = await momentsRes.json();
          const postsList = (momentsData.moments || momentsData.posts || []).map((m: any) => ({
            id: m.id,
            content: m.content,
            images: m.images || (m.media?.filter((md: any) => md.type === "image").map((md: any) => md.url)) || [],
            videos: m.videos || (m.media?.filter((md: any) => md.type === "video").map((md: any) => md.url)) || [],
            coverUrl: m.coverUrl || null,
            createdAt: m.createdAt,
            sortOrder: m.sortOrder ?? 0,
            likesCount: m.likeCount ?? m.likesCount ?? 0,
            commentsCount: m.commentCount ?? m.commentsCount ?? 0,
            isLiked: m.isLiked ?? false,
            isPinned: m.isPinned ?? false,
            location: m.location || null,
            user: {
              id: m.user?.id || m.authorId || userId,
              username: m.user?.username || m.authorName || "",
              nickname: m.user?.nickname || m.authorName || null,
              avatarUrl: m.user?.avatarUrl || m.authorAvatar || null,
            },
            comments: (m.comments || []).map((c: any) => ({
              id: c.id,
              content: c.content,
              createdAt: c.createdAt,
              user: c.user || { id: c.userId || "", username: c.authorName || "", nickname: c.authorName || null },
            })),
            likeUsers: (m.likes || m.likeUsers || []).map((l: any) => ({
              id: l.id || l.userId || "",
              username: l.username || l.authorName || "",
              nickname: l.nickname || l.authorName || null,
            })),
          }));
          setPosts(postsList);
          setHasMore(momentsData.hasMore ?? postsList.length >= PAGE_SIZE);
        }
        // 尝试获取当前登录用户
        try {
          const meRes = await fetch("/api/user/me", { credentials: "include" });
          if (meRes.ok) {
            const meData = await meRes.json();
            setCurrentUserId(meData.id || meData.userId || null);
          }
        } catch {}
      } catch (e) {
        console.error("加载数据失败", e);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [userId]);

  // 滚动监听
  useEffect(() => {
    const handleScroll = () => setTopBgOpacity(Math.min(window.scrollY / 80, 1));
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 无限滚动
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMorePosts(); },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, posts.length]);

  const loadMorePosts = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const cursor = posts.length > 0 ? posts[posts.length - 1].id : undefined;
      const params = new URLSearchParams({ userId, limit: String(PAGE_SIZE), shareMode: "1" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/moments?${params.toString()}`);
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      const newPosts = (data.moments || data.posts || []).map((m: any) => ({
        id: m.id,
        content: m.content,
        images: m.images || [],
        videos: m.videos || [],
        coverUrl: m.coverUrl || null,
        createdAt: m.createdAt,
        sortOrder: m.sortOrder ?? 0,
        likesCount: m.likeCount ?? m.likesCount ?? 0,
        commentsCount: m.commentCount ?? m.commentsCount ?? 0,
        isLiked: m.isLiked ?? false,
        isPinned: m.isPinned ?? false,
        location: m.location || null,
        user: {
          id: m.user?.id || m.authorId || userId,
          username: m.user?.username || m.authorName || "",
          nickname: m.user?.nickname || m.authorName || null,
          avatarUrl: m.user?.avatarUrl || m.authorAvatar || null,
        },
        comments: (m.comments || []).map((c: any) => ({
          id: c.id, content: c.content, createdAt: c.createdAt,
          user: c.user || { id: c.userId || "", username: c.authorName || "", nickname: c.authorName || null },
        })),
        likeUsers: (m.likes || m.likeUsers || []).map((l: any) => ({
          id: l.id || l.userId || "", username: l.username || l.authorName || "", nickname: l.nickname || l.authorName || null,
        })),
      }));
      if (newPosts.length > 0) setPosts((prev) => [...prev, ...newPosts]);
      setHasMore(data.hasMore ?? newPosts.length >= PAGE_SIZE);
    } catch (e) { console.error("loadMorePosts error", e); } finally { setLoadingMore(false); }
  };

  // 点击外部关闭卡片三点菜单
  useEffect(() => {
    if (!cardDotMenuPostId) return;
    const handleClick = () => setCardDotMenuPostId(null);
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("touchstart", handleClick); };
  }, [cardDotMenuPostId]);

  // ===== 事件处理 =====
  const isOwner = currentUserId !== null && profileUser !== null && currentUserId === profileUser.id;

  const handleLikeUpdate = useCallback((postId: string, liked: boolean, count: number, likeUser?: LikeUser) => {
    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p;
      let newLikeUsers = p.likeUsers ? [...p.likeUsers] : [];
      if (liked && likeUser) { if (!newLikeUsers.find((u) => u.id === likeUser.id)) newLikeUsers = [...newLikeUsers, likeUser]; }
      else if (!liked && currentUserId) { newLikeUsers = newLikeUsers.filter((u) => u.id !== currentUserId); }
      return { ...p, isLiked: liked, likesCount: count, likeUsers: newLikeUsers };
    }));
  }, [currentUserId]);

  const handleCommentAdded = useCallback((postId: string, comment: Comment) => {
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, comments: [...p.comments, comment], commentsCount: p.commentsCount + 1 } : p));
  }, []);

  const handleCommentDeleted = useCallback((postId: string, commentId: string) => {
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, comments: p.comments.filter((c) => c.id !== commentId), commentsCount: Math.max(0, p.commentsCount - 1) } : p));
  }, []);

  const handlePostDeleted = useCallback((postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    setSelectedPost(null);
  }, []);

  const handleContentUpdate = useCallback((postId: string, newContent: string) => {
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, content: newContent || null } : p));
    setSelectedPost((prev) => prev && prev.id === postId ? { ...prev, content: newContent || null } : prev);
  }, []);

  const handleLocationUpdate = useCallback((postId: string, newLocation: string) => {
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, location: newLocation || null } : p));
    setSelectedPost((prev) => prev && prev.id === postId ? { ...prev, location: newLocation || null } : prev);
  }, []);

  const handlePinUpdate = useCallback((postId: string, isPinned: boolean) => {
    setPosts((prev) => prev.map((p) => ({ ...p, isPinned: p.id === postId ? isPinned : (isPinned ? false : p.isPinned) })));
  }, []);

  const openLightbox = useCallback((images: string[], index: number) => {
    setLightboxImages(images);
    setLightboxIndex(index);
  }, []);

  // ===== 排序功能 =====
  const pinnedPosts = posts.filter((p) => p.isPinned);
  const normalPosts = posts.filter((p) => !p.isPinned).sort((a, b) => {
    const sa = a.sortOrder ?? 0; const sb = b.sortOrder ?? 0;
    if (sa !== sb) return sa - sb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const displayNormalPosts = sortMode ? sortingPosts : normalPosts;
  const displayPinnedPosts = pinnedSortMode ? sortingPinnedPosts : pinnedPosts;

  const enterSortMode = () => { setSortingPosts([...normalPosts]); setSortMode(true); };
  const exitSortMode = () => { setSortMode(false); setSortingPosts([]); };

  const handleDragStart = (index: number) => { dragItem.current = index; };
  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
    if (dragItem.current === null || dragItem.current === index) return;
    setSortingPosts((prev) => { const n = [...prev]; const d = n.splice(dragItem.current!, 1)[0]; n.splice(index, 0, d); dragItem.current = index; return n; });
  };
  const handleDragEnd = () => { dragItem.current = null; dragOverItem.current = null; };

  const handleTouchStart = (index: number, e: React.TouchEvent) => {
    if (!sortMode) return;
    const touch = e.touches[0];
    touchStartYRef.current = touch.clientY;
    touchStartXRef.current = touch.clientX;
    touchDragging.current = false;
    touchLongPressTimer.current = setTimeout(() => { touchDragIndex.current = index; touchDragging.current = true; if (navigator.vibrate) navigator.vibrate(30); }, 300);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!sortMode) return;
    const touch = e.touches[0];
    if (!touchDragging.current) {
      if (Math.abs(touch.clientY - touchStartYRef.current) > 10 || Math.abs(touch.clientX - touchStartXRef.current) > 10) {
        if (touchLongPressTimer.current) { clearTimeout(touchLongPressTimer.current); touchLongPressTimer.current = null; }
      }
      return;
    }
    e.preventDefault();
    if (touchDragIndex.current === null || !sortListRef.current) return;
    const children = Array.from(sortListRef.current.children) as HTMLElement[];
    let targetIndex = touchDragIndex.current;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (touch.clientY < rect.top + rect.height / 2) { targetIndex = i; break; }
      targetIndex = i;
    }
    if (targetIndex !== touchDragIndex.current) {
      setSortingPosts((prev) => { const n = [...prev]; const d = n.splice(touchDragIndex.current!, 1)[0]; n.splice(targetIndex, 0, d); touchDragIndex.current = targetIndex; return n; });
    }
  };

  const handleTouchEnd = () => {
    if (touchLongPressTimer.current) { clearTimeout(touchLongPressTimer.current); touchLongPressTimer.current = null; }
    touchDragIndex.current = null; touchDragging.current = false;
  };

  const saveSortOrder = async () => {
    setSavingSort(true);
    const orders = sortingPosts.map((p, i) => ({ id: p.id, sortOrder: i }));
    try {
      const res = await fetch("/api/moments/sort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orders }),
      });
      const data = await res.json();
      if (data.success) {
        const orderMap = new Map(orders.map((o) => [o.id, o.sortOrder]));
        setPosts((prev) => prev.map((p) => ({ ...p, sortOrder: orderMap.has(p.id) ? orderMap.get(p.id)! : (p.sortOrder ?? 0) })));
        setSortMode(false); setSortingPosts([]);
      } else { alert(data.error || "保存排序失败"); }
    } catch { alert("保存排序失败"); } finally { setSavingSort(false); }
  };

  // ===== 置顶排序 =====
  const enterPinnedSortMode = () => { setSortingPinnedPosts([...pinnedPosts]); setPinnedSortMode(true); };
  const exitPinnedSortMode = () => { setPinnedSortMode(false); setSortingPinnedPosts([]); };

  const handlePinnedDragStart = (index: number) => { pinnedDragItem.current = index; };
  const handlePinnedDragEnter = (index: number) => {
    pinnedDragOverItem.current = index;
    if (pinnedDragItem.current === null || pinnedDragItem.current === index) return;
    setSortingPinnedPosts((prev) => { const n = [...prev]; const d = n.splice(pinnedDragItem.current!, 1)[0]; n.splice(index, 0, d); pinnedDragItem.current = index; return n; });
  };
  const handlePinnedDragEnd = () => { pinnedDragItem.current = null; pinnedDragOverItem.current = null; };

  const handlePinnedTouchStart = (index: number, e: React.TouchEvent) => {
    const touch = e.touches[0];
    pinnedTouchStartY.current = touch.clientY; pinnedTouchStartX.current = touch.clientX;
    pinnedTouchDragging.current = false;
    pinnedTouchLongPressTimer.current = setTimeout(() => { pinnedTouchDragIndex.current = index; pinnedTouchDragging.current = true; if (navigator.vibrate) navigator.vibrate(30); }, 300);
  };

  const handlePinnedTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!pinnedTouchDragging.current) {
      if (Math.abs(touch.clientY - pinnedTouchStartY.current) > 10 || Math.abs(touch.clientX - pinnedTouchStartX.current) > 10) {
        if (pinnedTouchLongPressTimer.current) { clearTimeout(pinnedTouchLongPressTimer.current); pinnedTouchLongPressTimer.current = null; }
      }
      return;
    }
    e.preventDefault();
    if (pinnedTouchDragIndex.current === null || !pinnedSortGridRef.current) return;
    const children = Array.from(pinnedSortGridRef.current.children) as HTMLElement[];
    let targetIndex = pinnedTouchDragIndex.current;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (touch.clientY < rect.top) { targetIndex = i; break; }
      if (touch.clientY <= rect.bottom) { if (touch.clientX < rect.left + rect.width / 2) { targetIndex = i; break; } targetIndex = i; }
    }
    if (targetIndex !== pinnedTouchDragIndex.current) {
      setSortingPinnedPosts((prev) => { const n = [...prev]; const d = n.splice(pinnedTouchDragIndex.current!, 1)[0]; n.splice(targetIndex, 0, d); pinnedTouchDragIndex.current = targetIndex; return n; });
    }
  };

  const handlePinnedTouchEnd = () => {
    if (pinnedTouchLongPressTimer.current) { clearTimeout(pinnedTouchLongPressTimer.current); pinnedTouchLongPressTimer.current = null; }
    pinnedTouchDragIndex.current = null; pinnedTouchDragging.current = false;
  };

  const savePinnedSortOrder = async () => {
    setSavingPinnedSort(true);
    const orders = sortingPinnedPosts.map((p, i) => ({ id: p.id, sortOrder: -(1000 - i) }));
    try {
      const res = await fetch("/api/moments/sort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orders }),
      });
      const data = await res.json();
      if (data.success) {
        const orderMap = new Map(orders.map((o) => [o.id, o.sortOrder]));
        setPosts((prev) => prev.map((p) => ({ ...p, sortOrder: orderMap.has(p.id) ? orderMap.get(p.id)! : (p.sortOrder ?? 0) })));
        setPinnedSortMode(false); setSortingPinnedPosts([]);
      } else { alert(data.error || "保存排序失败"); }
    } catch { alert("保存排序失败"); } finally { setSavingPinnedSort(false); }
  };

  // ===== 修改时间 =====
  const openEditTime = (postId: string, currentTime: string) => { setEditTimePostId(postId); setEditTimeValue(isoToLocalDateTime(currentTime)); };
  const closeEditTime = () => { setEditTimePostId(null); setEditTimeValue(""); };
  const saveEditTime = async () => {
    if (!editTimePostId || !editTimeValue) return;
    setSavingTime(true);
    try {
      const res = await fetch(`/api/moments/${editTimePostId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ createdAt: localDateTimeToISO(editTimeValue) }),
      });
      const data = await res.json();
      if (data.success) {
        setPosts((prev) => prev.map((p) => p.id === editTimePostId ? { ...p, createdAt: localDateTimeToISO(editTimeValue) } : p));
        closeEditTime();
      } else { alert(data.error || "修改时间失败"); }
    } catch { alert("修改时间失败"); } finally { setSavingTime(false); }
  };

  // 导航栏样式
  const navBgBase = isDark ? "30,30,30" : "255,255,255";
  const navBg = `rgba(${navBgBase},${topBgOpacity})`;
  const iconColor = topBgOpacity > 0.5 ? (isDark ? "#e0e0e0" : "#333") : "#fff";
  const iconShadow = topBgOpacity < 0.5 ? "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" : "none";

  const displayName = profileUser?.nickname || profileUser?.username || "用户";

  const ThemeIcon = () => {
    if (themeMode === "light") {
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} style={{ filter: iconShadow }}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>;
    } else if (themeMode === "dark") {
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} style={{ filter: iconShadow }}><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" strokeLinecap="round" /><line x1="12" y1="21" x2="12" y2="23" strokeLinecap="round" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" strokeLinecap="round" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" strokeLinecap="round" /><line x1="1" y1="12" x2="3" y2="12" strokeLinecap="round" /><line x1="21" y1="12" x2="23" y2="12" strokeLinecap="round" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" strokeLinecap="round" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" strokeLinecap="round" /></svg>;
    } else {
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} style={{ filter: iconShadow }}><circle cx="12" cy="12" r="5" /><path strokeLinecap="round" d="M12 7a5 5 0 000 10V7z" fill={iconColor} stroke="none" /><line x1="12" y1="1" x2="12" y2="3" strokeLinecap="round" /><line x1="12" y1="21" x2="12" y2="23" strokeLinecap="round" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" strokeLinecap="round" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" strokeLinecap="round" /><line x1="1" y1="12" x2="3" y2="12" strokeLinecap="round" /><line x1="21" y1="12" x2="23" y2="12" strokeLinecap="round" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" strokeLinecap="round" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" strokeLinecap="round" /></svg>;
    }
  };

  const themeLabel = themeMode === "light" ? "切换暗色" : themeMode === "dark" ? "切换自动" : "切换亮色";

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: colors.bg }}>
        <div style={{ textAlign: "center", color: isDark ? "#666" : "#aaa" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>
            <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p style={{ marginTop: 8, fontSize: 14 }}>加载中...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!profileUser) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: colors.bg }}>
        <p style={{ color: isDark ? "#666" : "#999", fontSize: 16 }}>用户不存在</p>
      </div>
    );
  }


  return (
    <div style={{ background: colors.bg, minHeight: "100vh", transition: "background 0.3s, color 0.3s" }}>
      <div style={{ maxWidth: 567, margin: "0 auto", background: colors.bg, position: "relative" }}>

        {/* ===== HEADER ===== */}
        <header style={{ width: "100%", backgroundSize: "cover", position: "relative", marginBottom: 48, height: "19.25rem", backgroundImage: profileUser.backgroundUrl ? `url('${profileUser.backgroundUrl}')` : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", backgroundPosition: "center" }}>
          {/* 排序模式工具栏 */}
          {sortMode && (
            <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: 56, zIndex: 60 }}>
              <div style={{ maxWidth: 567, margin: "0 auto", display: "flex", justifyContent: "space-between", height: "100%", alignItems: "center", padding: "0 16px", background: isDark ? "rgba(30,30,30,0.97)" : "rgba(255,255,255,0.97)", borderBottom: `0.5px solid ${colors.border}` }}>
                <button onClick={exitSortMode} style={{ fontSize: 16, color: isDark ? "#aaa" : "#666", background: "none", border: "none", cursor: "pointer" }}>取消</button>
                <span style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>拖拽排序</span>
                <button onClick={saveSortOrder} disabled={savingSort} style={{ fontSize: 16, color: "#07c160", fontWeight: 600, background: "none", border: "none", cursor: "pointer", opacity: savingSort ? 0.5 : 1 }}>{savingSort ? "保存中..." : "保存"}</button>
              </div>
            </div>
          )}

          {/* 固定顶部导航栏 */}
          <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: 56, zIndex: 50 }}>
            <div style={{ maxWidth: 567, margin: "0 auto", display: "flex", justifyContent: "space-between", height: "100%", background: navBg, transition: "background 0.3s" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ height: "100%", padding: "0 20px", display: "flex", alignItems: "center" }}>
                  <a onClick={() => window.history.back()} style={{ cursor: "pointer" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2.5} style={{ filter: iconShadow }}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  </a>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ height: "100%", padding: "0 20px", display: "flex", alignItems: "center", gap: 16 }}>
                  <button onClick={cycleTheme} title={themeLabel} style={{ cursor: "pointer", display: "flex", alignItems: "center", background: "none", border: "none", padding: 0 }}><ThemeIcon /></button>
                  {isOwner && (
                    <button onClick={() => {
                      const sortAction = confirm("是否进入排序模式？");
                      if (sortAction) enterSortMode();
                    }} style={{ cursor: "pointer", display: "flex", alignItems: "center", background: "none", border: "none", padding: 0 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} style={{ filter: iconShadow }}><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
                    </button>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* 右下角：昵称 + 头像 */}
          <div style={{ position: "absolute", right: "1.5rem", bottom: "-2.5rem", width: "90%", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end" }}>
              <span style={{ color: "#fff", marginRight: 20, marginBottom: 24, fontSize: 15, textShadow: "0 1px 3px rgba(0,0,0,0.4)", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</span>
              <div style={{ width: "3.75rem", height: "3.75rem", flexShrink: 0, borderRadius: 8, overflow: "hidden", background: "#e5e7eb" }}>
                {profileUser.avatarUrl ? (
                  <img src={profileUser.avatarUrl} alt={displayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", color: "#fff", background: "linear-gradient(135deg, #4ade80, #2dd4bf)" }}>
                    {displayName[0]?.toUpperCase() || "?"}
                  </div>
                )}
              </div>
            </div>
            {profileUser.bio && (
              <div style={{ fontSize: 12, marginTop: 12, color: isDark ? "#aaa" : "#888", width: "100%", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profileUser.bio}</div>
            )}
          </div>
        </header>

        {/* ===== 动态列表区域 ===== */}
        <div style={{ paddingTop: 8 }}>
          {/* 置顶区域 */}
          {pinnedPosts.length > 0 && (
            <div style={{ borderBottom: `0.5px solid ${colors.border}`, paddingBottom: 16, marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", padding: "16px 0 12px 0" }}>
                <div style={{ width: 88, flexShrink: 0, paddingLeft: 16 }}>
                  <span style={{ fontSize: 22, fontWeight: 600, color: colors.text, lineHeight: 1 }}>置顶</span>
                </div>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${Math.min(pinnedPosts.length, 3)}, 1fr)`, gap: 4 }}>
                  {pinnedPosts.slice(0, 3).map((post) => {
                    const cover = getPostCover(post);
                    const imgCount = getImageCount(post);
                    return (
                      <div key={post.id} onClick={() => { const c = getPostCover(post); if (c && c.type === "video") setPlayingVideoUrl(c.url); else setSelectedPost(post); }} style={{ aspectRatio: "1/1", borderRadius: 6, overflow: "hidden", background: colors.bgCard, cursor: "pointer", position: "relative" }}>
                        {imgCount > 1 && post.images ? (
                          <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `repeat(${imgCount <= 4 ? 2 : 3}, 1fr)`, gap: 1 }}>
                            {post.images.slice(0, imgCount <= 4 ? 4 : 9).map((imgUrl, i) => (
                              <div key={i} style={{ position: "relative", overflow: "hidden", aspectRatio: "1/1" }}>
                                <img src={imgUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
                              </div>
                            ))}
                          </div>
                        ) : cover ? (
                          <>
                            {cover.type === "image" ? (
                              <img src={cover.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
                            ) : (
                              <SharedVideoThumbnail src={cover.url} coverUrl={cover.coverUrl} style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
                            )}
                            {cover.type === "video" && (
                              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 19,12 5,21" /></svg>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 6 }}>
                            <span style={{ fontSize: 11, color: colors.textMuted, textAlign: "center", lineHeight: 1.4 }}>{post.content?.slice(0, 20)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div onClick={() => setShowAllPinnedSheet(true)} style={{ width: 28, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isDark ? "#aaa" : "#576b95"} strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" /></svg>
                  {pinnedPosts.length > 3 && (
                    <span style={{ position: "absolute", top: -6, right: -4, background: "#576b95", color: "#fff", borderRadius: 8, fontSize: 10, padding: "1px 4px", lineHeight: 1.4, fontWeight: 600 }}>{pinnedPosts.length}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 排序提示 */}
          {sortMode && (
            <div style={{ padding: "8px 16px 4px", background: isDark ? "#1e2a1e" : "#f0fff4", borderBottom: `0.5px solid ${colors.border}` }}>
              <p style={{ fontSize: 12, color: "#4a7", margin: 0, textAlign: "center" }}>长按列表项可拖拽排序，完成后点右上角「保存」</p>
            </div>
          )}

          {/* 普通动态列表 */}
          {displayNormalPosts.length === 0 && pinnedPosts.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center" }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={isDark ? "#444" : "#d1d5db"} strokeWidth={1} style={{ margin: "0 auto 12px" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p style={{ color: isDark ? "#555" : "#9ca3af", fontSize: 14 }}>暂无动态，去添加好友或发布第一条动态吧</p>
            </div>
          ) : (
            <div ref={sortListRef}>
              {displayNormalPosts.map((post, index) => {
                const cover = getPostCover(post);
                const dateLabel = formatDateLabel(post.createdAt);
                const imgCount = getImageCount(post);
                return (
                  <div key={post.id}
                    draggable={sortMode}
                    onDragStart={sortMode ? () => handleDragStart(index) : undefined}
                    onDragEnter={sortMode ? () => handleDragEnter(index) : undefined}
                    onDragEnd={sortMode ? handleDragEnd : undefined}
                    onDragOver={sortMode ? (e) => e.preventDefault() : undefined}
                    onTouchStart={sortMode ? (e) => handleTouchStart(index, e) : undefined}
                    onTouchMove={sortMode ? handleTouchMove : undefined}
                    onTouchEnd={sortMode ? handleTouchEnd : undefined}
                    onClick={sortMode ? undefined : (e) => { if ((e.target as HTMLElement).closest("[data-media-area]")) return; setSelectedPost(post); }}
                    style={{ borderBottom: `0.5px solid ${colors.border}`, cursor: sortMode ? "grab" : "pointer", background: sortMode ? (touchDragIndex.current === index || dragItem.current === index ? colors.sortDragBg : colors.bg) : colors.bg, transition: "background 0.15s", userSelect: sortMode ? "none" : "auto", touchAction: sortMode ? "none" : "auto" }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", padding: "16px 0" }}>
                      {/* 左侧日期 */}
                      <div style={{ width: 88, flexShrink: 0, paddingLeft: 16, paddingTop: 2, display: "flex", flexDirection: "column", alignItems: sortMode ? "center" : "flex-start" }}>
                        {sortMode ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isDark ? "#555" : "#bbb"} strokeWidth={2}><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /></svg>
                            <span style={{ fontSize: 12, color: isDark ? "#555" : "#bbb" }}>{index + 1}</span>
                          </div>
                        ) : (
                          <>
                            {dateLabel === "今天" || dateLabel === "昨天" ? (
                              <span style={{ fontSize: 22, fontWeight: 600, color: colors.text, lineHeight: 1 }}>{dateLabel}</span>
                            ) : (
                              <div style={{ lineHeight: 1 }}>
                                <span style={{ fontSize: 28, fontWeight: 700, color: colors.text }}>{dateLabel.split(" ")[0]}</span>
                                <span style={{ fontSize: 13, color: colors.textSecondary, marginLeft: 2 }}>{dateLabel.split(" ")[1]}</span>
                              </div>
                            )}
                            {post.location && (
                              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, lineHeight: 1.4, wordBreak: "break-all" }}>{post.location}</div>
                            )}
                          </>
                        )}
                      </div>
                      {/* 右侧内容 */}
                      <div style={{ flex: 1, paddingRight: 16, display: "flex", alignItems: "flex-start", gap: 12 }}>
                        {imgCount > 1 && post.images ? (
                          <div data-media-area="1" onClick={(e) => { e.stopPropagation(); openLightbox(post.images!, 0); }} style={{ width: 120, height: 120, flexShrink: 0, borderRadius: 8, overflow: "hidden", display: "grid", gridTemplateColumns: `repeat(${imgCount <= 4 ? 2 : 3}, 1fr)`, gap: 1, cursor: "zoom-in" }}>
                            {post.images.slice(0, imgCount <= 4 ? 4 : 9).map((imgUrl, i) => (
                              <div key={i} style={{ position: "relative", overflow: "hidden", aspectRatio: "1/1" }} onClick={(e) => { e.stopPropagation(); openLightbox(post.images!, i); }}>
                                <img src={imgUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
                              </div>
                            ))}
                          </div>
                        ) : cover ? (
                          <div data-media-area="1" style={{ width: 120, height: 120, flexShrink: 0, borderRadius: 8, overflow: "hidden", background: colors.bgCard, position: "relative", cursor: cover.type === "image" ? "zoom-in" : "pointer" }} onClick={(e) => { e.stopPropagation(); if (cover.type === "image") openLightbox([cover.url], 0); else setPlayingVideoUrl(cover.url); }}>
                            {cover.type === "image" ? (
                              <img src={cover.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
                            ) : (
                              <SharedVideoThumbnail src={cover.url} coverUrl={cover.coverUrl} style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
                            )}
                            {cover.type === "video" && (
                              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 19,12 5,21" /></svg>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {post.content && (
                            <p style={{ fontSize: 14, color: colors.textContent, lineHeight: 1.5, margin: 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" } as any}>{post.content}</p>
                          )}
                          {!post.content && !cover && <p style={{ fontSize: 13, color: colors.textMuted }}>（无内容）</p>}
                          {isOwner && !sortMode && (
                            <div style={{ position: "relative", marginTop: 6 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                              <button onClick={(e) => { e.stopPropagation(); setCardDotMenuPostId((prev) => prev === post.id ? null : post.id); }} style={{ fontSize: 11, color: colors.accent, background: "none", border: "none", padding: "2px 4px", cursor: "pointer", display: "flex", alignItems: "center", gap: 2, borderRadius: 4 }}>
                                <span style={{ width: 3, height: 3, borderRadius: "50%", background: colors.accent, display: "inline-block" }} />
                                <span style={{ width: 3, height: 3, borderRadius: "50%", background: colors.accent, display: "inline-block" }} />
                                <span style={{ width: 3, height: 3, borderRadius: "50%", background: colors.accent, display: "inline-block" }} />
                              </button>
                              {cardDotMenuPostId === post.id && (
                                <div style={{ position: "absolute", left: 0, top: 22, zIndex: 30, background: isDark ? "#2c2c2e" : "#fff", border: `0.5px solid ${isDark ? "#3a3a3c" : "#e8e8e8"}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", minWidth: 100, overflow: "hidden" }}>
                                  <button onClick={(e) => { e.stopPropagation(); setCardDotMenuPostId(null); setEditContentPostId(post.id); setEditContentValue(post.content || ""); setShowEditContentModal(true); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 13, color: isDark ? "#e5e5ea" : "#282828", background: "none", border: "none", borderBottom: `0.5px solid ${isDark ? "#3a3a3c" : "#f0f0f0"}`, cursor: "pointer" }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                    编辑
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); setCardDotMenuPostId(null); setDeletePostId(post.id); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 13, color: "#ff4444", background: "none", border: "none", cursor: "pointer" }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    删除
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 无限滚动哨兵 */}
        <div ref={loadMoreRef} style={{ height: 1 }} />
        {loadingMore && (
          <div style={{ textAlign: "center", padding: "16px 0", color: isDark ? "#666" : "#aaa", fontSize: 13 }}>
            <svg style={{ display: "inline-block", animation: "spin 1s linear infinite", marginRight: 8 }} width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        )}
        {!hasMore && posts.length > 0 && (
          <div style={{ textAlign: "center", padding: "16px 0", color: isDark ? "#444" : "#ccc", fontSize: 12 }}>— 已加载全部动态 —</div>
        )}
        <div style={{ height: 32 }} />
      </div>

      {/* ===== 置顶展开面板 ===== */}
      {showAllPinnedSheet && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.5)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAllPinnedSheet(false); }} onTouchEnd={(e) => { if (e.target === e.currentTarget) setShowAllPinnedSheet(false); }}>
          <div style={{ background: colors.modalBg, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 567, maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column", paddingBottom: "env(safe-area-inset-bottom)" }} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: `0.5px solid ${colors.borderModal}`, flexShrink: 0 }}>
              <span style={{ color: colors.modalText, fontWeight: 600, fontSize: 16 }}>置顶动态（{pinnedPosts.length}）</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {isOwner && (
                  pinnedSortMode ? (
                    <>
                      <button onClick={exitPinnedSortMode} style={{ color: isDark ? "#aaa" : "#666", fontSize: 14, background: "none", border: "none", cursor: "pointer" }}>取消</button>
                      <button onClick={savePinnedSortOrder} disabled={savingPinnedSort} style={{ color: "#576b95", fontSize: 14, fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>{savingPinnedSort ? "保存中..." : "保存"}</button>
                    </>
                  ) : (
                    <button onClick={enterPinnedSortMode} style={{ color: "#576b95", fontSize: 14, background: "none", border: "none", cursor: "pointer" }}>排序</button>
                  )
                )}
                <button onClick={() => { setShowAllPinnedSheet(false); exitPinnedSortMode(); }} style={{ color: isDark ? "#aaa" : "#666", fontSize: 15, background: "none", border: "none", cursor: "pointer" }}>关闭</button>
              </div>
            </div>
            {pinnedSortMode && (
              <div style={{ padding: "6px 12px", background: isDark ? "#1e2a1e" : "#f0fff4", borderBottom: `0.5px solid ${colors.borderModal}`, flexShrink: 0 }}>
                <p style={{ fontSize: 12, color: "#4a7", margin: 0, textAlign: "center" }}>长按图片可拖拽排序，完成后点「保存」</p>
              </div>
            )}
            <div style={{ overflowY: "auto", padding: 12 }}>
              <div ref={pinnedSortGridRef} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, touchAction: pinnedSortMode ? "none" : "auto" }}>
                {displayPinnedPosts.map((post, index) => {
                  const cover = getPostCover(post);
                  return (
                    <div key={post.id}
                      draggable={pinnedSortMode}
                      onDragStart={pinnedSortMode ? () => handlePinnedDragStart(index) : undefined}
                      onDragEnter={pinnedSortMode ? () => handlePinnedDragEnter(index) : undefined}
                      onDragEnd={pinnedSortMode ? handlePinnedDragEnd : undefined}
                      onDragOver={pinnedSortMode ? (e) => e.preventDefault() : undefined}
                      onTouchStart={pinnedSortMode ? (e) => { e.stopPropagation(); handlePinnedTouchStart(index, e); } : undefined}
                      onTouchMove={pinnedSortMode ? (e) => { e.stopPropagation(); handlePinnedTouchMove(e); } : undefined}
                      onTouchEnd={pinnedSortMode ? (e) => { e.stopPropagation(); handlePinnedTouchEnd(); } : undefined}
                      onClick={pinnedSortMode ? undefined : () => { setShowAllPinnedSheet(false); if (cover && cover.type === "video") setPlayingVideoUrl(cover.url); else if (cover && cover.type === "image") openLightbox(post.images && post.images.length > 0 ? post.images : [cover.url], 0); else setSelectedPost(post); }}
                      style={{ aspectRatio: "1/1", borderRadius: 8, overflow: "hidden", background: colors.bgCard, cursor: pinnedSortMode ? "grab" : "pointer", position: "relative" }}
                    >
                      {cover ? (
                        cover.type === "image" ? <img src={cover.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <SharedVideoThumbnail src={cover.url} coverUrl={cover.coverUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
                          <span style={{ fontSize: 11, color: colors.textMuted, textAlign: "center", lineHeight: 1.4 }}>{post.content?.slice(0, 24)}</span>
                        </div>
                      )}
                      {post.content && !pinnedSortMode && (
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.55))", padding: "12px 6px 5px", pointerEvents: "none" }}>
                          <span style={{ color: "#fff", fontSize: 11, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as any}>{post.content}</span>
                        </div>
                      )}
                      {pinnedSortMode && (
                        <div style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.45)", borderRadius: 4, padding: "2px 3px", pointerEvents: "none" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /></svg>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 修改时间弹窗 ===== */}
      {editTimePostId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}>
          <div style={{ background: colors.modalBg, borderRadius: 12, width: 300, overflow: "hidden" }}>
            <div style={{ padding: "20px 20px 12px", textAlign: "center" }}>
              <p style={{ color: colors.modalText, fontWeight: 600, fontSize: 16, marginBottom: 16 }}>修改发布时间</p>
              <input type="datetime-local" value={editTimeValue} onChange={(e) => setEditTimeValue(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: `1px solid ${colors.borderInput}`, borderRadius: 8, fontSize: 15, color: colors.modalText, background: isDark ? "#333" : "#fff", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", borderTop: `1px solid ${colors.borderModal}` }}>
              <button onClick={closeEditTime} style={{ flex: 1, padding: "12px 0", color: isDark ? "#aaa" : "#666", fontSize: 15, fontWeight: 500, background: "none", border: "none", borderRight: `1px solid ${colors.borderModal}`, cursor: "pointer" }}>取消</button>
              <button onClick={saveEditTime} disabled={savingTime || !editTimeValue} style={{ flex: 1, padding: "12px 0", color: "#07c160", fontSize: 15, fontWeight: 600, opacity: savingTime || !editTimeValue ? 0.5 : 1, background: "none", border: "none", cursor: "pointer" }}>{savingTime ? "保存中..." : "确定"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 删除动态确认弹窗 ===== */}
      {deletePostId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setDeletePostId(null); }}>
          <div style={{ background: colors.modalBg, borderRadius: 12, width: 280, overflow: "hidden" }}>
            <div style={{ padding: "20px 20px 12px", textAlign: "center" }}>
              <p style={{ color: colors.modalText, fontWeight: 600, fontSize: 16, marginBottom: 8 }}>删除动态</p>
              <p style={{ color: isDark ? "#aaa" : "#666", fontSize: 14 }}>确定要删除这条动态吗？删除后无法恢复。</p>
            </div>
            <div style={{ display: "flex", borderTop: `1px solid ${colors.borderModal}` }}>
              <button onClick={() => setDeletePostId(null)} style={{ flex: 1, padding: "12px 0", color: isDark ? "#aaa" : "#666", fontSize: 15, fontWeight: 500, background: "none", border: "none", borderRight: `1px solid ${colors.borderModal}`, cursor: "pointer" }}>取消</button>
              <button onClick={async () => {
                if (!deletePostId || deletingPost) return;
                setDeletingPost(true);
                try {
                  await fetch(`/api/moments/${deletePostId}`, { method: "DELETE", credentials: "include" });
                  setPosts((prev) => prev.filter((p) => p.id !== deletePostId));
                  setDeletePostId(null);
                } catch { alert("删除失败"); } finally { setDeletingPost(false); }
              }} disabled={deletingPost} style={{ flex: 1, padding: "12px 0", color: "#ff4444", fontSize: 15, fontWeight: 600, opacity: deletingPost ? 0.5 : 1, background: "none", border: "none", cursor: "pointer" }}>{deletingPost ? "删除中..." : "删除"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 编辑动态内容弹窗 ===== */}
      {showEditContentModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.5)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowEditContentModal(false); }}>
          <div style={{ background: colors.modalBg, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 567, overflow: "hidden", paddingBottom: "env(safe-area-inset-bottom)" }} onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px", borderBottom: `0.5px solid ${colors.borderModal}` }}>
              <button onClick={() => setShowEditContentModal(false)} style={{ color: isDark ? "#aaa" : "#666", fontSize: 15, background: "none", border: "none", cursor: "pointer" }}>取消</button>
              <span style={{ color: colors.modalText, fontWeight: 600, fontSize: 16 }}>编辑动态</span>
              <button onClick={async () => {
                if (!editContentPostId || savingEditContent) return;
                setSavingEditContent(true);
                try {
                  const res = await fetch(`/api/moments/${editContentPostId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ content: editContentValue }) });
                  const data = await res.json();
                  if (data.success) { setPosts((prev) => prev.map((p) => p.id === editContentPostId ? { ...p, content: editContentValue } : p)); setShowEditContentModal(false); }
                  else alert(data.error || "保存失败");
                } catch { alert("保存失败"); } finally { setSavingEditContent(false); }
              }} disabled={savingEditContent} style={{ color: "#07c160", fontSize: 15, fontWeight: 600, background: "none", border: "none", cursor: "pointer", opacity: savingEditContent ? 0.5 : 1 }}>{savingEditContent ? "保存中..." : "保存"}</button>
            </div>
            <div style={{ padding: 16 }}>
              <textarea value={editContentValue} onChange={(e) => setEditContentValue(e.target.value)} maxLength={2000} rows={6} autoFocus style={{ width: "100%", padding: "10px 12px", border: `1px solid ${colors.borderInput}`, borderRadius: 8, fontSize: 15, color: colors.modalText, background: isDark ? "#333" : "#fafafa", outline: "none", resize: "none", lineHeight: 1.6, boxSizing: "border-box" }} placeholder="输入动态内容..." />
              <div style={{ textAlign: "right", fontSize: 12, color: editContentValue.length > 1900 ? "#ff4444" : (isDark ? "#666" : "#bbb"), marginTop: 4 }}>{editContentValue.length} / 2000</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 视频全屏播放器 ===== */}
      {playingVideoUrl && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.95)" }} onClick={() => setPlayingVideoUrl(null)}>
          <video src={playingVideoUrl} controls autoPlay playsInline style={{ maxWidth: "100%", maxHeight: "100%", width: "100%" }} onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setPlayingVideoUrl(null)} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ===== 动态详情弹窗 ===== */}
      {selectedPost && (
        <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.4)" }} onClick={() => setSelectedPost(null)}>
          <div style={{ width: "100%", maxWidth: 567, margin: "0 auto", background: colors.modalBg, borderRadius: "16px 16px 0 0", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `0.5px solid ${colors.border}` }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: colors.modalText }}>动态详情</span>
              <button onClick={() => setSelectedPost(null)} style={{ fontSize: 22, color: isDark ? "#666" : "#999", lineHeight: 1, cursor: "pointer", background: "none", border: "none" }}>×</button>
            </div>
            <MomentCard
              post={selectedPost}
              currentUserId={currentUserId}
              onLikeUpdate={handleLikeUpdate}
              onCommentAdded={handleCommentAdded}
              onCommentDeleted={handleCommentDeleted}
              onPostDeleted={handlePostDeleted}
              onImageClick={openLightbox}
              onPinUpdate={handlePinUpdate}
              onContentUpdate={handleContentUpdate}
              onEditTime={(postId, currentTime) => { setSelectedPost(null); openEditTime(postId, currentTime); }}
              onLocationUpdate={handleLocationUpdate}
            />
          </div>
        </div>
      )}

      {/* ===== 图片灯箱 ===== */}
      {lightboxImages.length > 0 && (
        <SharedImageLightbox images={lightboxImages} initialIndex={lightboxIndex} onClose={() => setLightboxImages([])} />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { 0% { opacity: 0; transform: translateX(8px); } 100% { opacity: 1; transform: translateX(0); } }
        @keyframes fadeInDown { 0% { opacity: 0; transform: translateY(-6px); } 100% { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
      `}</style>
    </div>
  );
}
