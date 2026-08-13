/**
 * useCurrentUser
 *
 * 订阅当前用户资料的全局事件 `cqim:user-profile-updated`，让任何
 * 直接读取 `CURRENT_USER.avatar`/`CURRENT_USER.name` 的组件都能在
 * 头像/昵称等更新后立即重渲染（无需刷新页面）。
 *
 * 事件由 `client/src/lib/store.ts` 中的 `syncCurrentUserProfile` 派发，
 * 头像上传成功 → setProfile + syncCurrentUserProfile → 全部订阅组件刷新。
 */
import { useEffect, useState } from 'react';
import { CURRENT_USER } from '@/lib/store';

export interface CurrentUserSnapshot {
  id: string;
  name: string;
  uniqueId: string;
  avatar: string;
  bio: string;
}

function snapshot(): CurrentUserSnapshot {
  return {
    id: CURRENT_USER.id,
    name: CURRENT_USER.name,
    uniqueId: CURRENT_USER.uniqueId,
    avatar: CURRENT_USER.avatar,
    bio: CURRENT_USER.bio || '',
  };
}

export function useCurrentUser(): CurrentUserSnapshot {
  const [user, setUser] = useState<CurrentUserSnapshot>(snapshot);

  useEffect(() => {
    const handler = () => setUser(snapshot());
    if (typeof window !== 'undefined') {
      window.addEventListener('cqim:user-profile-updated', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('cqim:user-profile-updated', handler);
      }
    };
  }, []);

  return user;
}
