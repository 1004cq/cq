/**
 * useRemoteProfileSync
 *
 * 订阅全局事件 `cqim:remote-user-profile-updated`，当好友/群成员更新头像、
 * 昵称等资料时，触发回调以刷新相关 UI 组件（如会话列表、群成员列表）。
 *
 * 事件由 AppContext 的 WebSocket 消息处理器派发，来自服务端 Redis pub/sub。
 */
import { useEffect, useRef, useCallback } from 'react';

export interface RemoteProfileUpdate {
  userId: string;
  nickname?: string;
  avatar?: string;
  username?: string;
  bio?: string;
  backgroundUrl?: string;
  updatedAt?: number;
}

/**
 * 注册远程用户资料更新回调。
 * @param onUpdate - 当收到远程资料更新时调用
 * @param filterUserIds - 可选，只关注特定用户的更新（传入 userId 数组）
 */
export function useRemoteProfileSync(
  onUpdate: (update: RemoteProfileUpdate) => void,
  filterUserIds?: string[]
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const filterRef = useRef(filterUserIds);
  filterRef.current = filterUserIds;

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RemoteProfileUpdate>).detail;
      if (!detail || !detail.userId) return;

      // 如果指定了过滤列表，只处理关注的用户
      const filter = filterRef.current;
      if (filter && filter.length > 0 && !filter.includes(detail.userId)) return;

      onUpdateRef.current(detail);
    };

    window.addEventListener('cqim:remote-user-profile-updated', handler);
    return () => {
      window.removeEventListener('cqim:remote-user-profile-updated', handler);
    };
  }, []);
}

/**
 * 获取更新后的用户资料（用于更新本地缓存）。
 * 返回一个函数，调用后返回更新后的字段。
 */
export function mergeProfileUpdate<T extends {
  id?: string;
  userId?: string;
  name?: string;
  avatar?: string;
  profileUpdatedAt?: number;
}>(
  item: T,
  update: RemoteProfileUpdate
): T {
  const itemUserId = item.id || item.userId || '';
  if (itemUserId !== update.userId) return item;

  if (
    update.updatedAt !== undefined
    && item.profileUpdatedAt !== undefined
    && update.updatedAt < item.profileUpdatedAt
  ) {
    return item;
  }

  const changes: Partial<T> = {} as Partial<T>;
  if (update.nickname !== undefined) (changes as any).name = update.nickname;
  if (update.avatar !== undefined) (changes as any).avatar = update.avatar;
  if (update.updatedAt !== undefined) (changes as any).profileUpdatedAt = update.updatedAt;

  return { ...item, ...changes };
}
