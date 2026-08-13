import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { formatTime } from '@/lib/store';
import LazyVideo from './LazyVideo';
import WechatImageGrid from './WechatImageGrid';
import type { MomentItem } from './types';

// ============ 双击点赞区域：单击不阻止，双击触发 onDoubleTap 并弹出飞心动画 ============
const DoubleTapZone: React.FC<{ onDoubleTap: () => void; children: React.ReactNode; style?: React.CSSProperties }> = memo(({ onDoubleTap, children, style }) => {
  const lastTapRef = useRef(0);
  const [hearts, setHearts] = useState<number[]>([]);
  const handleClick = useCallback(() => {
    const now = Date.now();
    // 双击间隔 < 300ms 视为双击
    if (now - lastTapRef.current < 300) {
      onDoubleTap();
      const id = now;
      setHearts(prev => [...prev, id]);
      // 600ms 后移除该红心节点，避免内存堆积
      window.setTimeout(() => setHearts(prev => prev.filter(h => h !== id)), 700);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [onDoubleTap]);
  return (
    <div onClickCapture={handleClick} style={{ position: 'relative', touchAction: 'pan-y', ...style }}>
      {children}
      {hearts.map(id => (
        <div key={id} className="double-tap-heart" aria-hidden="true">❤</div>
      ))}
    </div>
  );
});
const MomentCard = memo<{
  post: MomentItem;
  currentUserId: string;
  currentUserName: string;
  autoPlayVideo?: boolean;
  onLike: (id: string) => void;
  onComment: (id: string, content: string, parentId?: string, replyToUserName?: string) => void;
  onDeleteComment: (momentId: string, commentId: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onPreviewImages: (images: string[], index: number) => void;
}>(({ post, currentUserId, currentUserName, autoPlayVideo = false, onLike, onComment, onDeleteComment, onDelete, onPin, onPreviewImages }) => {
  const [expanded, setExpanded] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const isAuthor = post.authorId === currentUserId;

  const content = post.content || '';
  const MAX_LEN = 140;
  const isLong = content.length > MAX_LEN;
  const displayContent = isLong && !expanded ? content.slice(0, MAX_LEN) : content;
  const imageMedia = useMemo(() => post.media.filter(m => m.type === 'image'), [post.media]);
  const imageUrls = useMemo(() => imageMedia.map(m => m.url), [imageMedia]);
  const imageThumbUrls = useMemo(() => imageMedia.map(m => m.mediumUrl || m.url), [imageMedia]);
  const videoItems = useMemo(() => post.media.filter(m => m.type === 'video'), [post.media]);
  const visibleComments = useMemo(() => post.comments.filter(c => !c.isDeleted), [post.comments]);

  // 点击外部关闭操作菜单
  useEffect(() => {
    if (!showActions) return;
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [showActions]);

  const handleSubmitComment = () => {
    if (!commentText.trim()) return;
    onComment(post.id, commentText.trim(), replyTo?.id, replyTo?.name);
    setCommentText('');
    setReplyTo(null);
    setShowCommentInput(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      {/* 左侧头像 */}
      <div style={{ width: 48, flexShrink: 0, paddingTop: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 4, overflow: "hidden", background: "#e5e7eb" }}>
          {post.authorAvatar ? (
            <img src={post.authorAvatar} alt={post.authorName} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
          ) : (
            <DoveAvatar name={post.authorName} id={post.authorId} size={40} />
          )}
        </div>
      </div>

      {/* 右侧内容 */}
      <div style={{ flex: 1, paddingRight: 0 }}>
        {/* 用户名 */}
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#576b95", fontSize: 15, fontWeight: 500, cursor: "default" }}>{post.authorName}</span>
        </div>

        {/* 文字内容 */}
        {content && (
          <div style={{ marginBottom: 8, fontSize: 14, color: "#282828", lineHeight: 1.6, wordBreak: "break-all" }}>
            {displayContent}
            {isLong && !expanded && (
              <>
                <span style={{ color: "#888" }}>...</span>
                <span onClick={() => setExpanded(true)} style={{ color: "#576b95", cursor: "pointer", marginLeft: 4, fontSize: 14 }}>全文</span>
              </>
            )}
            {isLong && expanded && (
              <span onClick={() => setExpanded(false)} style={{ color: "#576b95", cursor: "pointer", marginLeft: 4, fontSize: 14 }}>收起</span>
            )}
          </div>
        )}

        {/* 图片网格（列表页使用缩略图，点击查看原图，双击点赞） */}
        {imageUrls.length > 0 && (
          <DoubleTapZone onDoubleTap={() => onLike(post.id)} style={{ marginBottom: 8 }}>
            <WechatImageGrid images={imageThumbUrls} onImageClick={(_, index) => onPreviewImages(imageUrls, index)} />
          </DoubleTapZone>
        )}

        {/* 视频（参照pyq：不使用DoubleTapZone包裹，避免爱心动画侵入视频播放器） */}
        {videoItems.length > 0 && (
          <div style={{ marginBottom: 8, maxWidth: 240, overflow: 'hidden', borderRadius: 6 }}>
            {videoItems.map((v, i) => (
              <LazyVideo
                key={i}
                src={v.url}
                poster={v.thumbUrl || v.mediumUrl}
                autoPlay={autoPlayVideo}
              />
            ))}
          </div>
        )}

        {/* 位置 */}
        {post.location && (
          <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 3, fontSize: 12, color: "#576b95" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#576b95" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
            </svg>
            <span>{post.location}</span>
          </div>
        )}

        {/* 时间 + 操作按钮行 */}
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: "#b2b2b2", fontSize: 12 }}>{formatTime(post.createdAt)}</span>
          <div style={{ position: "relative" }} ref={actionsRef}>
            <div
              onClick={() => setShowActions(!showActions)}
              style={{ width: 30, height: 20, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 3, cursor: "pointer" }}
            >
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#576b95", display: "inline-block" }} />
            </div>
            {showActions && (
              <div style={{ position: "absolute", right: 40, top: -10, zIndex: 10, animation: "slideIn 0.15s ease-out" }}>
                <div style={{ background: "#4c4c4c", color: "#fff", paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, borderRadius: 4, display: "flex", flexDirection: "row", alignItems: "center", gap: 0 }}>
                  <button
                    onClick={() => { onLike(post.id); setShowActions(false); }}
                    style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, paddingRight: 12, borderRight: "1px solid rgba(255,255,255,0.2)" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={post.isLiked ? "#ff6b6b" : "none"} stroke={post.isLiked ? "#ff6b6b" : "#fff"} strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    {post.isLiked ? "取消" : "赞"}
                  </button>
                  <button
                    onClick={() => {
                      setShowCommentInput(!showCommentInput);
                      setReplyTo(null);
                      setShowActions(false);
                      setTimeout(() => commentInputRef.current?.focus(), 100);
                    }}
                    style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, paddingLeft: 12, paddingRight: isAuthor ? 12 : 0, borderRight: isAuthor ? "1px solid rgba(255,255,255,0.2)" : "none" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    评论
                  </button>
                  {isAuthor && (
                    <>
                      <button
                        onClick={() => { onPin(post.id); setShowActions(false); }}
                        style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, paddingLeft: 12, paddingRight: 12, borderRight: "1px solid rgba(255,255,255,0.2)" }}
                      >
                        {post.isPinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        onClick={() => { onDelete(post.id); setShowActions(false); }}
                        style={{ background: "none", border: "none", color: "#ff6b6b", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13, paddingLeft: 12 }}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 点赞 + 评论区域 */}
        {(post.likes.length > 0 || visibleComments.length > 0) && (
          <div style={{ background: "#f7f7f7", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
            {post.likes.length > 0 && (
              <div style={{ padding: "6px 8px", display: "flex", alignItems: "flex-start", gap: 4, borderBottom: visibleComments.length > 0 ? "0.5px solid #e8e8e8" : "none" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#ff6b6b" stroke="#ff6b6b" strokeWidth={1} style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                <span style={{ fontSize: 13, color: "#576b95", lineHeight: 1.5 }}>
                  {post.likes.map(l => l.userName).join('，')}
                </span>
              </div>
            )}
            {visibleComments.length > 0 && (
              <div style={{ padding: "6px 8px" }}>
                {visibleComments.filter(c => !c.parentId).map(comment => {
                  const replies = visibleComments.filter(c => c.parentId === comment.id);
                  const canDelete = comment.userId === currentUserId || post.authorId === currentUserId;
                  return (
                    <div key={comment.id} style={{ marginBottom: 3 }}>
                      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                        <span style={{ color: "#576b95", cursor: "pointer" }} onClick={() => {
                          setReplyTo({ id: comment.id, name: comment.userName });
                          setShowCommentInput(true);
                          setTimeout(() => commentInputRef.current?.focus(), 100);
                        }}>{comment.userName}</span>
                        <span style={{ color: "#282828" }}>：{comment.content}</span>
                        {canDelete && (
                          <span
                            onClick={() => onDeleteComment(post.id, comment.id)}
                            style={{ color: "#999", cursor: "pointer", marginLeft: 6, fontSize: 11 }}
                          >删除</span>
                        )}
                      </div>
                      {replies.map(reply => {
                        const canDeleteReply = reply.userId === currentUserId || post.authorId === currentUserId;
                        return (
                          <div key={reply.id} style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 12 }}>
                            <span style={{ color: "#576b95" }}>{reply.userName}</span>
                            {reply.replyToUserName && (
                              <>
                                <span style={{ color: "#888" }}> 回复 </span>
                                <span style={{ color: "#576b95" }}>{reply.replyToUserName}</span>
                              </>
                            )}
                            <span style={{ color: "#282828" }}>：{reply.content}</span>
                            {canDeleteReply && (
                              <span
                                onClick={() => onDeleteComment(post.id, reply.id)}
                                style={{ color: "#999", cursor: "pointer", marginLeft: 6, fontSize: 11 }}
                              >删除</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 评论输入框 */}
        {showCommentInput && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 4 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, background: "#f7f7f7", borderRadius: 4, padding: "6px 8px" }}>
              {replyTo && <span style={{ fontSize: 12, color: "#999", flexShrink: 0 }}>回复 {replyTo.name}:</span>}
              <input
                ref={commentInputRef}
                type="text"
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmitComment()}
                placeholder={replyTo ? `回复 ${replyTo.name}...` : '写评论...'}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 14, color: "#282828" }}
              />
            </div>
            <button onClick={handleSubmitComment} disabled={!commentText.trim()}
              style={{ background: "none", border: "none", color: "#576b95", fontSize: 14, cursor: "pointer", opacity: commentText.trim() ? 1 : 0.4 }}>发送</button>
            <button onClick={() => { setShowCommentInput(false); setReplyTo(null); setCommentText(''); }}
              style={{ background: "none", border: "none", color: "#999", fontSize: 14, cursor: "pointer" }}>取消</button>
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较：只在关键数据变化时重新渲染
  return prevProps.post === nextProps.post
    && prevProps.currentUserId === nextProps.currentUserId
    && prevProps.onLike === nextProps.onLike
    && prevProps.onComment === nextProps.onComment;
});

export { MomentCard };
export default MomentCard;
