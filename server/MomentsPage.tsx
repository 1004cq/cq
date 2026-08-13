/**
 * imim 朋友圈（发现）页面 v2.0
 * 功能：单列无限下拉加载、点赞/评论展开收起、毛玻璃效果、动态置顶、权限控制
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { useTheme } from '@/contexts/ThemeContext';
import { DoveAvatar } from '@/components/DoveAvatar';
import { formatTime, CURRENT_USER, type MomentPost } from '@/lib/store';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, Heart, MessageCircle, Send, X, Image,
  ChevronLeft, ChevronRight, Pin, PinOff, Trash2,
  Globe, Users, Lock, Eye, EyeOff, MapPin, Hash,
  MoreHorizontal, Reply, ChevronDown, ChevronUp,
  RefreshCw, Loader2, ExternalLink, Copy, Check,
  Sun, Moon, SunMoon
} from 'lucide-react';

const MOMENTS_COVER_STORAGE_KEY = 'cqim_moments_cover_image';

// ============ 类型定义 ============

interface MomentMedia {
  type: 'image' | 'video';
  url: string;
}

interface MomentComment {
  id: string;
  momentId: string;
  userId: string;
  userName: string;
  content: string;
  parentId?: string;
  replyToUserId?: string;
  replyToUserName?: string;
  createdAt: number;
  isDeleted: boolean;
}

interface MomentLike {
  userId: string;
  userName: string;
  createdAt: number;
}

type VisibilityType = 'public' | 'friends' | 'private';

interface MomentItem {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  media: MomentMedia[];
  topics: string[];
  location?: string;
  permission: { type: VisibilityType };
  likes: MomentLike[];
  comments: MomentComment[];
  likeCount: number;
  commentCount: number;
  isPinned: boolean;
  pinnedAt?: number;
  createdAt: number;
  isLiked: boolean;
}

// ============ 示例图片库 ============
const SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=600&fit=crop',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&h=600&fit=crop',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&h=600&fit=crop',
  'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=600&h=600&fit=crop',
  'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600&h=600&fit=crop',
  'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=600&h=600&fit=crop',
];

// ============ 工具函数 ============

function extractTopics(content: string): string[] {
  const matches = content.match(/#([^#\s]+)#/g) || [];
  return [...new Set(matches.map(m => m.replace(/#/g, '')))];
}

function renderContentWithTopics(content: string) {
  const parts = content.split(/(#[^#\s]+#)/g);
  return parts.map((part, i) => {
    if (part.match(/^#[^#\s]+#$/)) {
      const topic = part.replace(/#/g, '');
      return (
        <span
          key={i}
          className="inline-flex items-center text-dove-green font-medium bg-dove-green/8 px-1 rounded-md mx-0.5 text-[13px] hover:bg-dove-green/15 transition-colors cursor-pointer"
        >
          #{topic}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ============ 图片大图预览组件 ============
const ImagePreview: React.FC<{
  images: string[];
  initialIndex: number;
  onClose: () => void;
}> = ({ images, initialIndex, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const handlePrev = () => setCurrentIndex(i => Math.max(0, i - 1));
  const handleNext = () => setCurrentIndex(i => Math.min(images.length - 1, i + 1));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"
      >
        <X size={18} className="text-white" />
      </button>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
        {currentIndex + 1} / {images.length}
      </div>
      <AnimatePresence mode="wait">
        <motion.img
          key={currentIndex}
          src={images[currentIndex]}
          alt=""
          className="max-w-[90%] max-h-[80vh] object-contain rounded-lg"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          onClick={e => e.stopPropagation()}
        />
      </AnimatePresence>
      {images.length > 1 && (
        <>
          {currentIndex > 0 && (
            <button
              onClick={e => { e.stopPropagation(); handlePrev(); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"
            >
              <ChevronLeft size={24} className="text-white" />
            </button>
          )}
          {currentIndex < images.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); handleNext(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"
            >
              <ChevronRight size={24} className="text-white" />
            </button>
          )}
          <div className="absolute bottom-6 flex gap-2" onClick={e => e.stopPropagation()}>
            {images.map((img, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                  i === currentIndex ? 'border-white scale-110' : 'border-transparent opacity-50'
                }`}
              >
                <img src={img} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
};

// ============ 九宫格图片组件 ============
const ImageGrid: React.FC<{
  images: string[];
  onPreview: (index: number) => void;
}> = ({ images, onPreview }) => {
  if (images.length === 0) return null;
  const cols = images.length === 1 ? 1 : images.length <= 4 ? 2 : 3;
  const size = images.length === 1 ? 'max-w-[240px]' : '';
  return (
    <div className={`grid gap-1 mt-2 ${size}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {images.map((img, i) => (
        <motion.div
          key={i}
          className="aspect-square rounded-md overflow-hidden bg-dove-warm-gray cursor-pointer"
          whileTap={{ scale: 0.95 }}
          onClick={() => onPreview(i)}
        >
          <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
        </motion.div>
      ))}
    </div>
  );
};

// ============ 评论列表组件（支持嵌套回复） ============
const CommentList: React.FC<{
  comments: MomentComment[];
  momentAuthorId: string;
  currentUserId: string;
  onReply: (commentId: string, replyToUserName: string) => void;
  onDelete: (commentId: string) => void;
}> = ({ comments, momentAuthorId, currentUserId, onReply, onDelete }) => {
  // 只取一级评论（无 parentId）
  const topLevel = comments.filter(c => !c.parentId && !c.isDeleted);

  return (
    <div className="space-y-2">
      {topLevel.map(comment => {
        const replies = comments.filter(c => c.parentId === comment.id && !c.isDeleted);
        const canDelete = comment.userId === currentUserId || momentAuthorId === currentUserId;
        return (
          <div key={comment.id} className="text-[11px]">
            {/* 一级评论 */}
            <div className="flex items-start gap-1 group">
              <div className="flex-1 min-w-0">
                <span className="text-dove-green font-medium" style={{ fontFamily: 'var(--font-wenkai)' }}>
                  {comment.userName}
                </span>
                <span className="text-foreground">：{comment.content}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button
                  onClick={() => onReply(comment.id, comment.userName)}
                  className="text-muted-foreground hover:text-dove-green transition-colors"
                >
                  <Reply size={10} />
                </button>
                {canDelete && (
                  <button
                    onClick={() => onDelete(comment.id)}
                    className="text-muted-foreground hover:text-dove-seal transition-colors"
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            </div>
            {/* 嵌套回复（缩进显示） */}
            {replies.length > 0 && (
              <div className="ml-3 mt-1 pl-2 border-l-2 border-border/30 space-y-1">
                {replies.map(reply => {
                  const canDeleteReply = reply.userId === currentUserId || momentAuthorId === currentUserId;
                  return (
                    <div key={reply.id} className="flex items-start gap-1 group">
                      <div className="flex-1 min-w-0">
                        <span className="text-dove-green font-medium" style={{ fontFamily: 'var(--font-wenkai)' }}>
                          {reply.userName}
                        </span>
                        {reply.replyToUserName && (
                          <>
                            <span className="text-muted-foreground"> 回复 </span>
                            <span className="text-dove-green font-medium">{reply.replyToUserName}</span>
                          </>
                        )}
                        <span className="text-foreground">：{reply.content}</span>
                      </div>
                      {canDeleteReply && (
                        <button
                          onClick={() => onDelete(reply.id)}
                          className="text-muted-foreground hover:text-dove-seal transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ============ 权限图标 ============
const VisibilityIcon: React.FC<{ type: VisibilityType; size?: number }> = ({ type, size = 10 }) => {
  if (type === 'public') return <Globe size={size} className="text-muted-foreground" />;
  if (type === 'friends') return <Users size={size} className="text-muted-foreground" />;
  return <Lock size={size} className="text-muted-foreground" />;
};

// ============ 单条动态卡片组件 ============
const MomentCard: React.FC<{
  post: MomentItem;
  currentUserId: string;
  onLike: (id: string) => void;
  onComment: (id: string, content: string, parentId?: string, replyToUserName?: string) => void;
  onDeleteComment: (momentId: string, commentId: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onPreviewImages: (images: string[], index: number) => void;
}> = ({ post, currentUserId, onLike, onComment, onDeleteComment, onDelete, onPin, onPreviewImages }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const isAuthor = post.authorId === currentUserId;
  const inputRef = useRef<HTMLInputElement>(null);

  const handleReply = (commentId: string, userName: string) => {
    setReplyTo({ id: commentId, name: userName });
    setShowCommentInput(true);
    setIsExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSubmitComment = () => {
    if (!commentText.trim()) return;
    onComment(post.id, commentText.trim(), replyTo?.id, replyTo?.name);
    setCommentText('');
    setReplyTo(null);
    setShowCommentInput(false);
  };

  const imageUrls = post.media.filter(m => m.type === 'image').map(m => m.url);
  const visibleComments = post.comments.filter(c => !c.isDeleted);
  const topLevelCount = visibleComments.filter(c => !c.parentId).length;

  return (
    <div className="relative">
      {/* 置顶标识 */}
      {post.isPinned && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
          <Pin size={9} className="text-amber-600 dark:text-amber-400" />
          <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">置顶</span>
        </div>
      )}

      {/* 卡片主体 — 毛玻璃效果 */}
      <div
        className="mx-3 mb-3 rounded-2xl border border-black/[0.06] bg-[rgba(255,252,248,0.82)] px-4 py-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl transition-shadow hover:shadow-md dark:border-white/5 dark:bg-[rgba(28,28,30,0.9)] dark:shadow-none dark:hover:shadow-none"
        style={{
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex gap-3">
          <DoveAvatar name={post.authorName} id={post.authorId} size="md" />
          <div className="flex-1 min-w-0">
            {/* 作者 + 时间 + 权限 */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-dove-green" style={{ fontFamily: 'var(--font-wenkai)' }}>
                {post.authorName}
              </span>
              <div className="flex items-center gap-1.5">
                <VisibilityIcon type={post.permission.type} />
                <span className="text-[10px] text-muted-foreground">{formatTime(post.createdAt)}</span>
                {/* 更多菜单（仅作者） */}
                {isAuthor && (
                  <div className="relative">
                    <button
                      onClick={() => setShowMenu(!showMenu)}
                      className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-dove-warm-gray transition-colors"
                    >
                      <MoreHorizontal size={12} className="text-muted-foreground" />
                    </button>
                    <AnimatePresence>
                      {showMenu && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9, y: -4 }}
                          className="absolute right-0 top-6 z-20 min-w-[100px] overflow-hidden rounded-xl border border-border/30 bg-dove-paper shadow-soft-md dark:border-white/10 dark:bg-[#262629]"
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { onPin(post.id); setShowMenu(false); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-dove-warm-gray dark:hover:bg-white/5"
                          >
                            {post.isPinned ? (
                              <><PinOff size={12} className="text-amber-500" /><span>取消置顶</span></>
                            ) : (
                              <><Pin size={12} className="text-amber-500" /><span>置顶动态</span></>
                            )}
                          </button>
                          <div className="border-t border-border/30" />
                          <button
                            onClick={() => { onDelete(post.id); setShowMenu(false); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-dove-seal hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 size={12} />
                            <span>删除动态</span>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>

            {/* 正文内容 */}
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed mb-1">
              {renderContentWithTopics(post.content)}
            </p>

            {/* 位置 */}
            {post.location && (
              <div className="flex items-center gap-1 mb-1">
                <MapPin size={10} className="text-dove-green/70" />
                <span className="text-[10px] text-dove-green/70">{post.location}</span>
              </div>
            )}

            {/* 图片九宫格 */}
            <ImageGrid
              images={imageUrls}
              onPreview={(index) => onPreviewImages(imageUrls, index)}
            />

            {/* 互动区 */}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/30">
              <div className="flex items-center gap-3">
                {/* 点赞按钮 */}
                <motion.button
                  onClick={() => onLike(post.id)}
                  className="flex items-center gap-1.5"
                  whileTap={{ scale: 0.8 }}
                >
                  <Heart
                    size={15}
                    className={post.isLiked ? 'fill-dove-seal text-dove-seal' : 'text-muted-foreground'}
                  />
                  {post.likeCount > 0 && (
                    <span className={`text-[11px] ${post.isLiked ? 'text-dove-seal' : 'text-muted-foreground'}`}>
                      {post.likeCount}
                    </span>
                  )}
                </motion.button>

                {/* 评论按钮 */}
                <motion.button
                  onClick={() => {
                    setShowCommentInput(!showCommentInput);
                    if (!showCommentInput) setIsExpanded(true);
                    setReplyTo(null);
                    setTimeout(() => inputRef.current?.focus(), 100);
                  }}
                  className="flex items-center gap-1.5"
                  whileTap={{ scale: 0.8 }}
                >
                  <MessageCircle size={15} className="text-muted-foreground" />
                  {post.commentCount > 0 && (
                    <span className="text-[11px] text-muted-foreground">{post.commentCount}</span>
                  )}
                </motion.button>
              </div>

              {/* 展开/收起评论 */}
              {(post.likeCount > 0 || topLevelCount > 0) && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-dove-green transition-colors"
                >
                  {isExpanded ? (
                    <><ChevronUp size={12} /><span>收起</span></>
                  ) : (
                    <><ChevronDown size={12} /><span>展开</span></>
                  )}
                </button>
              )}
            </div>

            {/* 展开区域：点赞列表 + 评论列表 */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 overflow-hidden rounded-xl bg-dove-mist/80 dark:bg-white/[0.04]">
                    {/* 点赞列表 */}
                    {post.likes.length > 0 && (
                      <div className="px-3 py-2 flex items-center gap-1 flex-wrap border-b border-border/20">
                        <Heart size={10} className="fill-dove-seal text-dove-seal flex-shrink-0" />
                        <span className="text-[11px] text-dove-green">
                          {post.likes.map(l => l.userName).join('、')}
                        </span>
                      </div>
                    )}

                    {/* 评论列表 */}
                    {visibleComments.length > 0 && (
                      <div className="px-3 py-2">
                        <CommentList
                          comments={visibleComments}
                          momentAuthorId={post.authorId}
                          currentUserId={currentUserId}
                          onReply={handleReply}
                          onDelete={(commentId) => onDeleteComment(post.id, commentId)}
                        />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 评论输入框 */}
            <AnimatePresence>
              {showCommentInput && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex flex-1 items-center gap-1 rounded-xl border border-border/40 bg-white/80 px-3 py-1.5 backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.06]">
                      {replyTo && (
                        <div className="flex items-center gap-1 mr-1">
                          <span className="text-[10px] text-dove-green">回复 {replyTo.name}</span>
                          <button onClick={() => setReplyTo(null)}>
                            <X size={10} className="text-muted-foreground" />
                          </button>
                        </div>
                      )}
                      <input
                        ref={inputRef}
                        type="text"
                        value={commentText}
                        onChange={e => setCommentText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSubmitComment()}
                        placeholder={replyTo ? `回复 ${replyTo.name}...` : '写评论...'}
                        className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                        autoFocus
                      />
                    </div>
                    <motion.button
                      onClick={handleSubmitComment}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-dove-green text-white flex-shrink-0"
                      whileTap={{ scale: 0.9 }}
                    >
                      <Send size={12} />
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ 发布动态弹窗 ============
const PostComposer: React.FC<{
  onClose: () => void;
  onPost: (content: string, images: string[], location: string, visibility: VisibilityType) => void;
}> = ({ onClose, onPost }) => {
  const [text, setText] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [visibility, setVisibility] = useState<VisibilityType>('friends');
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理用户从相册选图
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const remaining = 9 - selectedImages.length;
    const toProcess = files.slice(0, remaining);
    toProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          setSelectedImages(prev => prev.length < 9 ? [...prev, dataUrl] : prev);
        }
      };
      reader.readAsDataURL(file);
    });
    // 重置 input 允许重复选择相同文件
    e.target.value = '';
  };

  const topics = extractTopics(text);
  const canPost = text.trim().length > 0 || selectedImages.length > 0;

  const visibilityOptions: { type: VisibilityType; label: string; icon: React.ReactNode }[] = [
    { type: 'public', label: '所有人可见', icon: <Globe size={14} /> },
    { type: 'friends', label: '仅好友可见', icon: <Users size={14} /> },
    { type: 'private', label: '仅自己可见', icon: <Lock size={14} /> },
  ];

  const currentVisibility = visibilityOptions.find(v => v.type === visibility)!;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full max-w-[480px] bg-dove-paper rounded-t-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <button onClick={onClose} className="text-sm text-muted-foreground">取消</button>
          <span className="text-sm font-medium" style={{ fontFamily: 'var(--font-wenkai)' }}>发布动态</span>
          <motion.button
            onClick={() => { if (canPost) { onPost(text.trim(), selectedImages, location, visibility); onClose(); } }}
            className={`text-sm font-medium transition-all px-3 py-1 rounded-full ${
              canPost ? 'text-white bg-dove-green shadow-sm' : 'text-muted-foreground/50 bg-transparent'
            }`}
            whileTap={canPost ? { scale: 0.95 } : {}}
          >
            发布
          </motion.button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="这一刻的想法... 用 #话题# 标记内容"
              className="w-full h-28 bg-transparent outline-none text-sm resize-none placeholder:text-muted-foreground/50"
              style={{ fontFamily: 'var(--font-wenkai)' }}
              autoFocus
            />

            {/* 话题预览 */}
            {topics.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {topics.map(t => (
                  <span key={t} className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-dove-green/10 text-dove-green text-[11px]">
                    <Hash size={9} />
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* 已选图片预览 */}
            {selectedImages.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {selectedImages.map((img, i) => (
                  <div key={i} className="aspect-square rounded-lg overflow-hidden relative">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    {/* 删除按鈕始终显示（移动端没有 hover 状态） */}
                    <button
                      onClick={() => setSelectedImages(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center"
                    >
                      <X size={13} className="text-white" />
                    </button>
                    {/* 序号 */}
                    <div className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-dove-green/80 flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold">{i + 1}</span>
                    </div>
                  </div>
                ))}
                {/* 继续添加按鈕 */}
                {selectedImages.length < 9 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-lg border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-1 text-muted-foreground/50 hover:border-dove-green/50 hover:text-dove-green/60 transition-colors"
                  >
                    <Image size={20} />
                    <span className="text-[10px]">添加</span>
                  </button>
                )}
              </div>
            )}
            {/* 未选图时显示大添加按鈕 */}
            {selectedImages.length === 0 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 w-full h-24 rounded-xl border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 hover:border-dove-green/50 hover:text-dove-green/60 transition-colors"
              >
                <Image size={28} />
                <span className="text-xs">点击选拤相册图片</span>
              </button>
            )}
          </div>

          {/* 工具栏 */}
          <div className="px-4 py-2 border-t border-border/30 flex items-center gap-2 flex-wrap">
            {/* 图片选择：调用手机相册 */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={selectedImages.length >= 9}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                selectedImages.length >= 9
                  ? 'text-muted-foreground/30 cursor-not-allowed'
                  : 'hover:bg-dove-warm-gray text-muted-foreground active:bg-dove-green-light active:text-dove-green'
              }`}
            >
              <Image size={15} />
              <span>图片 {selectedImages.length > 0 ? `(${selectedImages.length}/9)` : ''}</span>
            </button>
            {/* 隐藏的 file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            {/* 位置 */}
            <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-dove-warm-gray transition-colors">
              <MapPin size={15} className="text-muted-foreground" />
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="添加位置"
                className="text-xs bg-transparent outline-none w-20 placeholder:text-muted-foreground/50"
              />
            </div>

            {/* 可见范围 */}
            <div className="relative">
              <button
                onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-dove-warm-gray text-xs text-muted-foreground transition-colors"
              >
                {currentVisibility.icon}
                <span>{currentVisibility.label}</span>
              </button>
              <AnimatePresence>
                {showVisibilityMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="absolute bottom-full left-0 mb-1 bg-dove-paper rounded-xl shadow-soft-md border border-border/30 overflow-hidden min-w-[140px] z-10"
                  >
                    {visibilityOptions.map(opt => (
                      <button
                        key={opt.type}
                        onClick={() => { setVisibility(opt.type); setShowVisibilityMenu(false); }}
                        className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors ${
                          visibility === opt.type ? 'text-dove-green bg-dove-green/5' : 'hover:bg-dove-warm-gray'
                        }`}
                      >
                        {opt.icon}
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* 已选图片预览区（内嵌在内容区）—— 移到内容区里显示 */}
        </div>

        <div style={{ height: 'env(safe-area-inset-bottom, 16px)' }} />
      </motion.div>
    </motion.div>
  );
};

// ============ 无限下拉加载触发器 ============
const LoadTrigger: React.FC<{
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}> = ({ loading, hasMore, onLoadMore }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => { if (ref.current) observer.unobserve(ref.current); };
  }, [loading, hasMore, onLoadMore]);

  return (
    <div ref={ref} className="py-8 text-center">
      {loading ? (
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">加载中...</span>
        </div>
      ) : hasMore ? (
        <span className="text-xs text-muted-foreground/50">下拉加载更多</span>
      ) : (
        <p className="text-xs text-muted-foreground/50" style={{ fontFamily: 'var(--font-wenkai)' }}>
          — 已经到底了 —
        </p>
      )}
    </div>
  );
};

// ============ 外链分享按鈕组件 ============
const ShareLinkButton: React.FC<{ userId: string }> = ({ userId }) => {
  const [state, setState] = useState<'idle' | 'copied'>('idle');

  const handleShare = async () => {
    const url = `${window.location.origin}/q/${userId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: '我的朋友圈', url });
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {}
  };

  return (
    <motion.button
      onClick={(e) => { e.stopPropagation(); void handleShare(); }}
      className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/10 text-white/95 backdrop-blur-sm drop-shadow-[0_1px_6px_rgba(0,0,0,0.18)] transition-colors hover:bg-black/15 hover:text-white dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
      whileTap={{ scale: 0.95 }}
      title={state === 'copied' ? '链接已复制' : '分享我的朋友圈外链'}
    >
      {state === 'copied' ? <Check size={18} /> : <MoreHorizontal size={18} />}
    </motion.button>
  );
};

const ThemeModeButton: React.FC<{ mode: 'light' | 'dark' | 'system'; onToggle: () => void }> = ({ mode, onToggle }) => {
  const title = mode === 'light'
    ? '当前：亮色，点击切换暗色'
    : mode === 'dark'
      ? '当前：暗色，点击切换跟随系统'
      : '当前：跟随系统，点击切换亮色';

  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="absolute top-4 right-16 z-10 flex h-9 min-w-9 items-center justify-center rounded-full bg-black/10 px-2 text-white/95 backdrop-blur-sm drop-shadow-[0_1px_6px_rgba(0,0,0,0.18)] transition-colors hover:bg-black/15 hover:text-white dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
      whileTap={{ scale: 0.95 }}
      title={title}
    >
      {mode === 'light' ? (
        <Sun size={16} className="text-amber-300" />
      ) : mode === 'dark' ? (
        <Moon size={16} className="text-sky-200" />
      ) : (
        <SunMoon size={16} className="text-white/90" />
      )}
    </motion.button>
  );
};

// ============ 将 AppContext MomentPost 转换为本地 MomentItem ============
function convertPost(post: MomentPost, currentUserId: string): MomentItem {
  return {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName,
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

// ============ 主页面组件 ============
export default function MomentsPage() {
  const { state } = useApp();
  const { likeMoment, addComment, addMoment } = useAppActions();
  const { mode, toggleTheme } = useTheme();
  const [showComposer, setShowComposer] = useState(false);
  const [previewState, setPreviewState] = useState<{ images: string[]; index: number } | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverImage, setCoverImage] = useState('');

  // 本地扩展状态（置顶、删除、评论删除、权限等）
  const [localMoments, setLocalMoments] = useState<MomentItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const PAGE_SIZE = 10;
  // 标记是否已初始化，避免 state.moments 变化时覆盖本地操作
  const initializedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedCover = window.localStorage.getItem(MOMENTS_COVER_STORAGE_KEY) || '';
    setCoverImage(savedCover);
  }, []);

  // 仅初始化一次：将 AppContext 的 moments 转换为本地格式
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const converted = state.moments.map((p: MomentPost) => convertPost(p, CURRENT_USER.id));
    // 置顶排序：置顶优先 → 置顶时间倒序 → 发布时间倒序
    converted.sort((a: MomentItem, b: MomentItem) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isPinned && b.isPinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
      return b.createdAt - a.createdAt;
    });
    setLocalMoments(converted.slice(0, PAGE_SIZE));
    setHasMore(converted.length > PAGE_SIZE);
    setPage(1);
  }, [state.moments]);

  // 模拟加载更多
  const handleLoadMore = useCallback(() => {
    if (loading || !hasMore) return;
    setLoading(true);
    setTimeout(() => {
      const all = state.moments.map((p: MomentPost) => convertPost(p, CURRENT_USER.id));
      all.sort((a: MomentItem, b: MomentItem) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.isPinned && b.isPinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        return b.createdAt - a.createdAt;
      });
      const nextPage = page + 1;
      const nextSlice = all.slice(0, nextPage * PAGE_SIZE);
      setLocalMoments(nextSlice);
      setHasMore(all.length > nextPage * PAGE_SIZE);
      setPage(nextPage);
      setLoading(false);
    }, 600);
  }, [loading, hasMore, page, state.moments]);

  // 点赞
  const handleLike = useCallback((postId: string) => {
    likeMoment(postId);
    setLocalMoments(prev => prev.map(m => {
      if (m.id !== postId) return m;
      const alreadyLiked = m.isLiked;
      return {
        ...m,
        isLiked: !alreadyLiked,
        likeCount: alreadyLiked ? m.likeCount - 1 : m.likeCount + 1,
        likes: alreadyLiked
          ? m.likes.filter(l => l.userId !== CURRENT_USER.id)
          : [...m.likes, { userId: CURRENT_USER.id, userName: CURRENT_USER.name, createdAt: Date.now() }],
      };
    }));
  }, [likeMoment]);

  // 评论
  const handleComment = useCallback((postId: string, content: string, parentId?: string, replyToUserName?: string) => {
    const newComment = {
      id: `cm-${Date.now()}`,
      userId: CURRENT_USER.id,
      userName: CURRENT_USER.name,
      content,
      timestamp: Date.now(),
      replyTo: replyToUserName,
    };
    addComment(postId, newComment);
    setLocalMoments(prev => prev.map(m => {
      if (m.id !== postId) return m;
      const localComment: MomentComment = {
        id: newComment.id,
        momentId: postId,
        userId: CURRENT_USER.id,
        userName: CURRENT_USER.name,
        content,
        parentId,
        replyToUserName,
        createdAt: Date.now(),
        isDeleted: false,
      };
      return { ...m, comments: [...m.comments, localComment], commentCount: m.commentCount + 1 };
    }));
  }, [addComment]);

  // 删除评论（本地）
  const handleDeleteComment = useCallback((momentId: string, commentId: string) => {
    setLocalMoments(prev => prev.map(m => {
      if (m.id !== momentId) return m;
      return {
        ...m,
        comments: m.comments.map(c => c.id === commentId ? { ...c, isDeleted: true } : c),
        commentCount: Math.max(0, m.commentCount - 1),
      };
    }));
  }, []);

  // 删除动态（本地）
  const handleDelete = useCallback((postId: string) => {
    setLocalMoments(prev => prev.filter(m => m.id !== postId));
  }, []);

  // 置顶/取消置顶
  const handlePin = useCallback((postId: string) => {
    setLocalMoments(prev => {
      const target = prev.find(m => m.id === postId);
      if (!target) return prev;
      const willPin = !target.isPinned;
      let updated = prev.map(m => {
        if (m.id === postId) {
          return { ...m, isPinned: willPin, pinnedAt: willPin ? Date.now() : undefined };
        }
        // 取消其他置顶（最多 1 条）
        if (willPin && m.isPinned && m.authorId === CURRENT_USER.id) {
          return { ...m, isPinned: false, pinnedAt: undefined };
        }
        return m;
      });
      // 重新排序
      updated.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.isPinned && b.isPinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        return b.createdAt - a.createdAt;
      });
      return updated;
    });
  }, []);

  // 发布动态
  const handlePost = useCallback((content: string, images: string[], location: string, visibility: VisibilityType) => {
    const newPost: MomentPost = {
      id: `p-${Date.now()}`,
      authorId: CURRENT_USER.id,
      authorName: CURRENT_USER.name,
      authorAvatar: '',
      content,
      images,
      timestamp: Date.now(),
      likes: [],
      comments: [],
      visibility,
    };
    // 同步写入 AppContext（持久化）
    addMoment(newPost);
    // 直接插入 localMoments 顶部，不依赖 useEffect 重跑（避免覆盖本地点赞/评论/置顶状态）
    const newItem = convertPost(newPost, CURRENT_USER.id);
    setLocalMoments(prev => {
      // 非置顶帖子插到置顶帖子之后、其他帖子之前
      const pinnedItems = prev.filter(m => m.isPinned);
      const normalItems = prev.filter(m => !m.isPinned);
      return [...pinnedItems, newItem, ...normalItems];
    });
  }, [addMoment]);

  const handleCoverChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      setCoverImage(dataUrl);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MOMENTS_COVER_STORAGE_KEY, dataUrl);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const showEmptyMomentsState = localMoments.length === 0;

  return (
    <div className="flex h-full flex-col bg-[#f6f4ef] text-[#111111] dark:bg-[#050608] dark:text-[#f5f5f7]">
      <div className="flex-1 overflow-y-auto bg-[#f6f4ef] dark:bg-[#050608]">
        <div className="relative">
          {/* 封面区域 */}
          <div
            className="relative h-[330px] cursor-pointer overflow-hidden bg-[#f3f1ec] dark:bg-[#0a0c0f]"
            onClick={() => coverInputRef.current?.click()}
          >
            {coverImage ? (
              <img src={coverImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 bg-[linear-gradient(180deg,#f7f5f0_0%,#ece8df_100%)] dark:bg-[radial-gradient(circle_at_top,#2a2d31_0%,#111317_46%,#050608_100%)]" />
            )}
            <div className={`absolute inset-0 ${coverImage ? 'bg-gradient-to-b from-transparent via-black/5 to-[#f6f4ef] dark:via-black/10 dark:to-[#050608]' : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.02)_0%,rgba(246,244,239,0.92)_100%)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.03)_0%,rgba(5,6,8,0.92)_100%)]'}`} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[#f6f4ef] dark:to-[#050608]" />

            <motion.button
              onClick={(e) => {
                e.stopPropagation();
                if (window.history.length > 1) window.history.back();
              }}
              className="absolute top-4 left-4 z-10 flex h-9 w-9 items-center justify-center text-white/95 drop-shadow-[0_1px_6px_rgba(0,0,0,0.18)] transition-colors hover:text-white"
              whileTap={{ scale: 0.95 }}
              title="返回"
            >
              <ChevronLeft size={20} />
            </motion.button>

            <ThemeModeButton mode={mode} onToggle={toggleTheme} />
            <ShareLinkButton userId={CURRENT_USER.id} />

            <div className="absolute bottom-0 left-0 right-0 z-10 px-7 pb-6 pt-16">
              <div className="flex items-end justify-end gap-4">
                <span className="pb-4 text-[18px] font-medium tracking-[0.08em] text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.35)]" style={{ fontFamily: 'var(--font-wenkai)' }}>
                  {CURRENT_USER.name}
                </span>
                {CURRENT_USER.avatar ? (
                  <img
                    src={CURRENT_USER.avatar}
                    alt={CURRENT_USER.name}
                    className="h-20 w-20 rounded-2xl object-cover shadow-[0_10px_28px_rgba(0,0,0,0.35)]"
                  />
                ) : (
                  <DoveAvatar name={CURRENT_USER.name} id={CURRENT_USER.id} avatar={CURRENT_USER.avatar} size="lg" />
                )}
              </div>
            </div>

            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCoverChange}
            />
          </div>

          <div className="relative -mt-1 min-h-[calc(100dvh-330px)] bg-[#f6f4ef] px-7 pb-14 pt-10 dark:bg-[#050608]">
            {!coverImage && (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="mb-8 text-xs text-[#8f8f94] transition-colors hover:text-[#444444] dark:text-[#5e5e63] dark:hover:text-[#b5b5ba]"
              >
                点击上方空白区域设置朋友圈背景
              </button>
            )}

            <div className="flex items-start gap-5">
              <div className="min-w-[72px] pt-2 text-[22px] font-medium text-[#111111] dark:text-white" style={{ fontFamily: 'var(--font-wenkai)' }}>
                今天
              </div>
              <motion.button
                type="button"
                onClick={() => setShowComposer(true)}
                className="flex min-h-[136px] flex-1 items-center gap-4 rounded-[24px] border border-[#ebe7df] bg-[#f8f5ee] px-5 py-4 text-left text-[#555555] shadow-[0_12px_30px_rgba(28,28,30,0.05)] transition-colors dark:border-white/[0.06] dark:bg-[#121417] dark:text-[#8e8e93] dark:shadow-none"
                whileTap={{ scale: 0.98 }}
              >
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-[#efebe3] text-[#c8bfb2] dark:bg-[#1b1d21] dark:text-[#4f545c]">
                  <Camera size={30} />
                </div>
                <div className="space-y-1">
                  <div className="text-[15px] text-[#2b2b2b] dark:text-[#f2f2f4]">拍一张照片</div>
                  <div className="text-sm leading-6 text-[#6a6a6a] dark:text-[#74747c]">开始记录你的生活</div>
                </div>
              </motion.button>
            </div>

            {showEmptyMomentsState ? (
              <div className="pt-20 text-center text-sm tracking-[0.35em] text-[#c8c8cc] dark:text-[#4d4d52]" style={{ fontFamily: 'var(--font-wenkai)' }}>
                —— 没有更多 ——
              </div>
            ) : (
              <div className="mt-8 space-y-3">
                {localMoments.map((post, i) => (
                  <motion.div
                    key={post.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    className="rounded-3xl border border-[#ece7de] bg-[#fcfbf8] text-dove-ink shadow-[0_10px_30px_rgba(0,0,0,0.05)] dark:border-white/5 dark:bg-[#121417] dark:text-[#f5f5f7] dark:shadow-none"
                  >
                    <MomentCard
                      post={post}
                      currentUserId={CURRENT_USER.id}
                      onLike={handleLike}
                      onComment={handleComment}
                      onDeleteComment={handleDeleteComment}
                      onDelete={handleDelete}
                      onPin={handlePin}
                      onPreviewImages={(images, index) => setPreviewState({ images, index })}
                    />
                  </motion.div>
                ))}

                <LoadTrigger loading={loading} hasMore={hasMore} onLoadMore={handleLoadMore} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 发布弹窗 */}
      <AnimatePresence>
        {showComposer && (
          <PostComposer
            onClose={() => setShowComposer(false)}
            onPost={handlePost}
          />
        )}
      </AnimatePresence>

      {/* 图片大图预览 */}
      <AnimatePresence>
        {previewState && (
          <ImagePreview
            images={previewState.images}
            initialIndex={previewState.index}
            onClose={() => setPreviewState(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
