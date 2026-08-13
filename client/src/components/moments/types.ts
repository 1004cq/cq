import type { MomentPost } from '@/lib/store';

export type VisibilityType = 'public' | 'friends' | 'private';

export interface MomentMedia {
  type: 'image' | 'video';
  url: string;
  thumbUrl?: string;
  mediumUrl?: string;
  lowQualityUrl?: string;
  posterUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface MomentComment {
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

export interface MomentLike {
  userId: string;
  userName: string;
  createdAt: number;
}

export interface MomentItem {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
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

export interface MomentFeedResult {
  moments: MomentItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type MomentPostInput = Pick<MomentPost, 'id' | 'authorId' | 'authorName' | 'content' | 'images' | 'timestamp' | 'likes' | 'comments' | 'visibility'> & {
  authorAvatar?: string;
};

export interface ShareUser {
  id: string;
  username: string;
  nickname: string | null;
  avatarUrl?: string | null;
  avatar?: string | null;
}

export interface ShareLikeUser {
  id: string;
  username: string;
  nickname: string | null;
}

export interface ShareComment {
  id: string;
  content: string;
  createdAt: string;
  user: ShareUser;
}

export interface SharePost {
  id: string;
  content: string | null;
  images: string[] | null;
  videos: string[] | null;
  coverUrl?: string | null;
  createdAt: string;
  sortOrder?: number;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  isPinned?: boolean;
  location?: string | null;
  user: ShareUser;
  comments: ShareComment[];
  likeUsers?: ShareLikeUser[];
}

export interface ShareProfileUser {
  id: string;
  username: string;
  nickname: string | null;
  bio: string | null;
  avatarUrl: string | null;
  backgroundUrl?: string | null;
}
