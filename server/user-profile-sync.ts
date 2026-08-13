/**
 * 用户资料变更实时同步（Redis Pub/Sub）
 * 统一使用数据库 updatedAt 作为版本时间戳，多端按时间戳去重/合并。
 */
import prisma from './db.js';
import { publishMessage } from './redis.js';
import { avatarToProxy } from './cos-signer.js';

export interface UserProfileSyncSource {
  id: string;
  nickname?: string | null;
  avatar?: string | null;
  username: string;
  bio?: string | null;
  backgroundUrl?: string | null;
  updatedAt: Date;
}

/** 发布用户资料更新事件，通知好友与群成员 */
export async function publishUserProfileUpdated(user: UserProfileSyncSource): Promise<void> {
  const updatedAt = user.updatedAt.getTime();

  const [friends, groupMemberships] = await Promise.all([
    prisma.friend.findMany({
      where: { userId: user.id, status: 'accepted' },
      select: { friendId: true },
    }),
    prisma.groupMember.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    }),
  ]);

  await publishMessage('user_profile_updated', {
    userId: user.id,
    nickname: user.nickname,
    avatar: avatarToProxy(user.avatar),
    username: user.username,
    bio: user.bio,
    backgroundUrl: user.backgroundUrl,
    updatedAt,
    targetFriendIds: friends.map((f) => f.friendId),
    targetGroupIds: groupMemberships.map((m) => m.groupId),
  });
}

/** 按 userId 从库读取并广播（管理员/遗留接口在 update 后调用） */
export async function publishUserProfileUpdatedById(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nickname: true,
      avatar: true,
      username: true,
      bio: true,
      backgroundUrl: true,
      updatedAt: true,
    },
  });
  if (!user) return;
  await publishUserProfileUpdated(user);
}
