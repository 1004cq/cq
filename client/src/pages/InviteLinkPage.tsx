/**
 * InviteLinkPage — 外链落地页
 * 路径: /im/:slug
 * 功能: 自动解析 slug 为用户(username)或群组(id)，展示信息卡片
 *       - 用户: 展示头像/昵称/简介 + "添加好友"按钮
 *       - 群组: 展示群头像/群名/成员数 + "加入群组"按钮
 *       - 已登录: 直接操作
 *       - 未登录: 引导登录后自动跳回
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, Users, Check, Loader2, AlertCircle, ArrowLeft, LogIn, Copy, Share2 } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { toast } from 'sonner';
import { authApi } from '@/lib/authFetch';

// ============ 类型定义 ============

interface UserData {
  id: string;
  dialogId: string | null;
  username: string;
  nickname: string;
  avatar: string;
  bio: string;
  isBot: boolean;
}

interface GroupData {
  id: string;
  dialogId: string | null;
  username: string | null;
  name: string;
  avatar: string;
  memberCount: number;
  groupType: string;
  isPublic: boolean;
}

interface InviteData {
  hash: string;
  groupId: string;
  dialogId: string | null;
  groupName: string;
  groupUsername: string | null;
  groupAvatar: string;
  memberCount: number;
  groupType: string;
}

type ResolveResult =
  | { type: 'user'; data: UserData }
  | { type: 'group'; data: GroupData }
  | { type: 'invite'; data: InviteData };

type PageState = 'loading' | 'user' | 'group' | 'invite' | 'not_found' | 'error' | 'expired';

// ============ 组件 ============

export default function InviteLinkPage() {
  const slug = window.location.pathname.replace(/^\/im\//, '').replace(/\/$/, '');
  const [pageState, setPageState] = useState<PageState>('loading');
  const [userData, setUserData] = useState<UserData | null>(null);
  const [groupData, setGroupData] = useState<GroupData | null>(null);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [actionState, setActionState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [actionMessage, setActionMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // 检查登录状态
  useEffect(() => {
    const token = localStorage.getItem('user_token');
    const userStr = localStorage.getItem('imim_current_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        setIsLoggedIn(true);
        setCurrentUserId(user.id || null);
      } catch {
        setIsLoggedIn(false);
      }
    }
  }, []);

  // 解析 slug
  useEffect(() => {
    if (!slug) {
      setPageState('not_found');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/im/resolve/${encodeURIComponent(slug)}`);
        if (res.status === 404) {
          setPageState('not_found');
          return;
        }
        if (res.status === 410) {
          const data = await res.json().catch(() => ({}));
          setErrorMessage(data.error || '链接已过期或已被撤销');
          setPageState('expired');
          return;
        }
        if (!res.ok) {
          setPageState('error');
          return;
        }
        const result: ResolveResult = await res.json();
        if (result.type === 'user') {
          setUserData(result.data as UserData);
          setPageState('user');
        } else if (result.type === 'group') {
          setGroupData(result.data as GroupData);
          setPageState('group');
        } else if (result.type === 'invite') {
          setInviteData(result.data as InviteData);
          setPageState('invite');
        } else {
          setPageState('not_found');
        }
      } catch {
        setPageState('error');
      }
    })();
  }, [slug]);

  // 添加好友
  const handleAddFriend = useCallback(async () => {
    if (!userData || actionState !== 'idle') return;
    if (!isLoggedIn) {
      // 保存当前外链路径，登录后跳回
      localStorage.setItem('imim_redirect_after_login', window.location.pathname);
      window.location.href = '/';
      return;
    }
    if (currentUserId === userData.id) {
      toast.info('这是你自己的链接');
      return;
    }
    setActionState('loading');
    try {
      const currentUser = JSON.parse(localStorage.getItem('imim_current_user') || '{}');
      await authApi('/api/friend/request', {
        toId: userData.id,
        message: `你好，我通过外链添加你为好友`,
        searchMethod: 'id',
      });
      setActionState('done');
      setActionMessage('好友申请已发送');
      toast.success(`已向 ${userData.nickname} 发送好友请求`);
    } catch (err: any) {
      if (err.message?.includes('已经是好友')) {
        setActionState('done');
        setActionMessage('你们已经是好友了');
        toast.info('你们已经是好友了');
      } else if (err.message?.includes('已发送')) {
        setActionState('done');
        setActionMessage('已发送过好友请求');
        toast.info('已发送过好友请求，等待对方处理');
      } else if (err.message?.includes('自动成为好友')) {
        setActionState('done');
        setActionMessage('已成为好友');
        toast.success('已成为好友！');
      } else {
        setActionState('idle');
        toast.error(err.message || '发送失败，请重试');
      }
    }
  }, [userData, actionState, isLoggedIn, currentUserId]);

  // 加入群组
  const handleJoinGroup = useCallback(async () => {
    if (!groupData || actionState !== 'idle') return;
    if (!isLoggedIn) {
      localStorage.setItem('imim_redirect_after_login', window.location.pathname);
      window.location.href = '/';
      return;
    }
    setActionState('loading');
    try {
      const res = await fetch('/api/group/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('user_token')}`,
        },
        body: JSON.stringify({ groupId: groupData.id, userId: currentUserId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '加入失败');
      }
      setActionState('done');
      setActionMessage('已成功加入群组');
      toast.success(`已加入「${groupData.name}」`);
    } catch (err: any) {
      if (err.message?.includes('已是群成员') || err.message?.includes('already')) {
        setActionState('done');
        setActionMessage('你已经在群组中了');
        toast.info('你已经在群组中了');
      } else {
        setActionState('idle');
        toast.error(err.message || '加入失败，请重试');
      }
    }
  }, [groupData, actionState, isLoggedIn, currentUserId]);

  // 通过邀请链接加入群组
  const handleJoinByInvite = useCallback(async () => {
    if (!inviteData || actionState !== 'idle') return;
    if (!isLoggedIn) {
      localStorage.setItem('imim_redirect_after_login', window.location.pathname);
      window.location.href = '/';
      return;
    }
    setActionState('loading');
    try {
      const res = await fetch('/api/group/invite/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('user_token')}`,
        },
        body: JSON.stringify({ hash: inviteData.hash, userId: currentUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '加入失败');
      }
      if (data.alreadyMember) {
        setActionState('done');
        setActionMessage('你已经在群组中了');
        toast.info('你已经在群组中了');
      } else {
        setActionState('done');
        setActionMessage('已成功加入群组');
        toast.success(`已加入「${inviteData.groupName}」`);
      }
    } catch (err: any) {
      setActionState('idle');
      toast.error(err.message || '加入失败，请重试');
    }
  }, [inviteData, actionState, isLoggedIn, currentUserId]);

  // 打开App
  const handleOpenApp = () => {
    window.location.href = '/';
  };

  // 复制链接
  const handleCopyLink = () => {
    const link = `https://wed.imim.chat/im/${slug}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success('链接已复制');
    }).catch(() => {
      // 降级方案
      const input = document.createElement('input');
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      toast.success('链接已复制');
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-gray-50 flex flex-col">
      {/* 顶部导航栏 */}
      <header className="flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <button
          onClick={handleOpenApp}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={18} />
          <span>返回</span>
        </button>
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="灵鸽 IM" className="w-6 h-6 rounded-md" />
          <span className="text-sm font-semibold text-gray-800" style={{ fontFamily: 'var(--font-wenkai)' }}>
            灵鸽 IM
          </span>
        </div>
        <button
          onClick={handleCopyLink}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <Copy size={15} />
        </button>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <AnimatePresence mode="wait">
          {/* 加载中 */}
          {pageState === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4"
            >
              <motion.div
                className="w-10 h-10 border-3 border-emerald-200 border-t-emerald-600 rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
              <p className="text-sm text-gray-400" style={{ fontFamily: 'var(--font-wenkai)' }}>
                正在解析链接...
              </p>
            </motion.div>
          )}

          {/* 用户外链 - 添加好友 */}
          {pageState === 'user' && userData && (
            <motion.div
              key="user"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-sm"
            >
              <div className="bg-white rounded-3xl shadow-lg shadow-gray-200/60 overflow-hidden">
                {/* 顶部装饰条 */}
                <div className="h-24 bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-500 relative">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.15),transparent)]" />
                </div>

                {/* 用户信息卡片 */}
                <div className="px-6 pb-6 -mt-10 relative">
                  <div className="flex flex-col items-center">
                    {/* 头像 */}
                    <div className="ring-4 ring-white rounded-full shadow-md">
                      <DoveAvatar
                        name={userData.nickname}
                        avatar={userData.avatar}
                        size={80}
                      />
                    </div>

                    {/* 昵称 */}
                    <h2 className="mt-3 text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-wenkai)' }}>
                      {userData.nickname}
                    </h2>

                    {/* 用户名 */}
                    <p className="text-sm text-gray-400 mt-0.5">@{userData.username}</p>

                    {/* 机器人标识 */}
                    {userData.isBot && (
                      <div className="mt-1">
                        <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-medium">BOT</span>
                      </div>
                    )}

                    {/* 简介 */}
                    {userData.bio && (
                      <p className="text-sm text-gray-500 mt-2 text-center leading-relaxed max-w-[260px]">
                        {userData.bio}
                      </p>
                    )}

                    {/* 分隔线 */}
                    <div className="w-full h-px bg-gray-100 my-5" />

                    {/* 操作按钮 */}
                    {actionState === 'done' ? (
                      <div className="flex flex-col items-center gap-3 w-full">
                        <div className="flex items-center gap-2 text-emerald-600">
                          <Check size={20} strokeWidth={2.5} />
                          <span className="text-sm font-medium">{actionMessage}</span>
                        </div>
                        <button
                          onClick={handleOpenApp}
                          className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
                        >
                          打开灵鸽 IM
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 w-full">
                        <button
                          onClick={handleAddFriend}
                          disabled={actionState === 'loading'}
                          className="w-full py-3 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {actionState === 'loading' ? (
                            <><Loader2 size={16} className="animate-spin" />发送中...</>
                          ) : !isLoggedIn ? (
                            <><LogIn size={16} />登录并添加好友</>
                          ) : (
                            <><UserPlus size={16} />添加好友</>
                          )}
                        </button>
                        {!isLoggedIn && (
                          <p className="text-xs text-gray-400 text-center">
                            需要登录灵鸽 IM 才能添加好友
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* 群组外链 - 加入群组 */}
          {pageState === 'group' && groupData && (
            <motion.div
              key="group"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-sm"
            >
              <div className="bg-white rounded-3xl shadow-lg shadow-gray-200/60 overflow-hidden">
                {/* 顶部装饰条 */}
                <div className="h-24 bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 relative">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(255,255,255,0.15),transparent)]" />
                </div>

                {/* 群组信息卡片 */}
                <div className="px-6 pb-6 -mt-10 relative">
                  <div className="flex flex-col items-center">
                    {/* 群头像 */}
                    <div className="ring-4 ring-white rounded-full shadow-md">
                      <DoveAvatar
                        name={groupData.name}
                        avatar={groupData.avatar}
                        size={80}
                        isGroup
                      />
                    </div>

                    {/* 群名 */}
                    <h2 className="mt-3 text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-wenkai)' }}>
                      {groupData.name}
                    </h2>

                    {/* 群公开用户名 */}
                    {groupData.username && (
                      <p className="text-sm text-gray-400 mt-0.5">@{groupData.username}</p>
                    )}

                    {/* 成员数 */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Users size={14} className="text-gray-400" />
                      <span className="text-sm text-gray-400">{groupData.memberCount} 名成员</span>
                    </div>

                    {/* 分隔线 */}
                    <div className="w-full h-px bg-gray-100 my-5" />

                    {/* 操作按钮 */}
                    {actionState === 'done' ? (
                      <div className="flex flex-col items-center gap-3 w-full">
                        <div className="flex items-center gap-2 text-indigo-600">
                          <Check size={20} strokeWidth={2.5} />
                          <span className="text-sm font-medium">{actionMessage}</span>
                        </div>
                        <button
                          onClick={handleOpenApp}
                          className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
                        >
                          打开灵鸽 IM
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 w-full">
                        <button
                          onClick={handleJoinGroup}
                          disabled={actionState === 'loading'}
                          className="w-full py-3 bg-indigo-500 text-white rounded-xl text-sm font-semibold hover:bg-indigo-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {actionState === 'loading' ? (
                            <><Loader2 size={16} className="animate-spin" />加入中...</>
                          ) : !isLoggedIn ? (
                            <><LogIn size={16} />登录并加入群组</>
                          ) : (
                            <><Users size={16} />加入群组</>
                          )}
                        </button>
                        {!isLoggedIn && (
                          <p className="text-xs text-gray-400 text-center">
                            需要登录灵鸽 IM 才能加入群组
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* 邀请链接 - 加入群组 */}
          {pageState === 'invite' && inviteData && (
            <motion.div
              key="invite"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-sm"
            >
              <div className="bg-white rounded-3xl shadow-lg shadow-gray-200/60 overflow-hidden">
                {/* 顶部装饰条 */}
                <div className="h-24 bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 relative">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(255,255,255,0.15),transparent)]" />
                  <div className="absolute top-3 right-4 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1">
                    <span className="text-xs text-white font-medium">邀请链接</span>
                  </div>
                </div>

                {/* 群组信息卡片 */}
                <div className="px-6 pb-6 -mt-10 relative">
                  <div className="flex flex-col items-center">
                    {/* 群头像 */}
                    <div className="ring-4 ring-white rounded-full shadow-md">
                      <DoveAvatar
                        name={inviteData.groupName}
                        avatar={inviteData.groupAvatar}
                        size={80}
                        isGroup
                      />
                    </div>

                    {/* 群名 */}
                    <h2 className="mt-3 text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-wenkai)' }}>
                      {inviteData.groupName}
                    </h2>

                    {/* 群公开用户名 */}
                    {inviteData.groupUsername && (
                      <p className="text-sm text-gray-400 mt-0.5">@{inviteData.groupUsername}</p>
                    )}

                    {/* 成员数 */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Users size={14} className="text-gray-400" />
                      <span className="text-sm text-gray-400">{inviteData.memberCount} 名成员</span>
                    </div>

                    {/* 分隔线 */}
                    <div className="w-full h-px bg-gray-100 my-5" />

                    {/* 操作按钮 */}
                    {actionState === 'done' ? (
                      <div className="flex flex-col items-center gap-3 w-full">
                        <div className="flex items-center gap-2 text-orange-600">
                          <Check size={20} strokeWidth={2.5} />
                          <span className="text-sm font-medium">{actionMessage}</span>
                        </div>
                        <button
                          onClick={handleOpenApp}
                          className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
                        >
                          打开灵鸽 IM
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 w-full">
                        <button
                          onClick={handleJoinByInvite}
                          disabled={actionState === 'loading'}
                          className="w-full py-3 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {actionState === 'loading' ? (
                            <><Loader2 size={16} className="animate-spin" />加入中...</>
                          ) : !isLoggedIn ? (
                            <><LogIn size={16} />登录并加入群组</>
                          ) : (
                            <><Users size={16} />通过邀请链接加入</>
                          )}
                        </button>
                        {!isLoggedIn && (
                          <p className="text-xs text-gray-400 text-center">
                            需要登录灵鸽 IM 才能加入群组
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* 链接已过期/已撤销 */}
          {pageState === 'expired' && (
            <motion.div
              key="expired"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 text-center px-4"
            >
              <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
                <AlertCircle size={28} className="text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold text-gray-700" style={{ fontFamily: 'var(--font-wenkai)' }}>
                链接已失效
              </h2>
              <p className="text-sm text-gray-400 max-w-[260px]">
                {errorMessage || '该邀请链接已过期或已被撤销'}
              </p>
              <button
                onClick={handleOpenApp}
                className="mt-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 transition-colors"
              >
                打开灵鸽 IM
              </button>
            </motion.div>
          )}

          {/* 未找到 */}
          {pageState === 'not_found' && (
            <motion.div
              key="not_found"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 text-center px-4"
            >
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                <AlertCircle size={28} className="text-gray-300" />
              </div>
              <h2 className="text-lg font-semibold text-gray-700" style={{ fontFamily: 'var(--font-wenkai)' }}>
                链接无效
              </h2>
              <p className="text-sm text-gray-400 max-w-[260px]">
                该用户或群组不存在，请检查链接是否正确
              </p>
              <button
                onClick={handleOpenApp}
                className="mt-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 transition-colors"
              >
                打开灵鸽 IM
              </button>
            </motion.div>
          )}

          {/* 错误 */}
          {pageState === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 text-center px-4"
            >
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <AlertCircle size={28} className="text-red-300" />
              </div>
              <h2 className="text-lg font-semibold text-gray-700" style={{ fontFamily: 'var(--font-wenkai)' }}>
                加载失败
              </h2>
              <p className="text-sm text-gray-400 max-w-[260px]">
                网络异常，请稍后重试
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                重试
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 底部品牌 */}
      <footer className="py-4 text-center">
        <p className="text-xs text-gray-300" style={{ fontFamily: 'var(--font-wenkai)' }}>
          灵鸽 IM · 安全即时通讯
        </p>
      </footer>
    </div>
  );
}
