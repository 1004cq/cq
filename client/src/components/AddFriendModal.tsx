/**
 * 添加朋友弹窗
 * Tab 1 - 找人：通过用户ID / 手机号 / 邮箱精确搜索用户，并发送真实好友申请
 * Tab 2 - 找群：通过群名称 / 群ID搜索群组
 */
import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, UserPlus, Check, Loader2, Users } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { toast } from 'sonner';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { authApi } from '@/lib/authFetch';

interface SearchUser {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  bio: string;
}

interface SearchGroup {
  id: string;
  name: string;
  avatar: string;
  memberCount: number;
}

interface AddFriendModalProps {
  onClose: () => void;
  /** 扫码后预填的 userId */
  prefillUserId?: string;
}

type TabType = 'people' | 'group';

export const AddFriendModal: React.FC<AddFriendModalProps> = ({ onClose, prefillUserId }) => {
  const { state } = useApp();
  const { upsertChat, openChat } = useAppActions();
  const [activeTab, setActiveTab] = useState<TabType>('people');
  const [query, setQuery] = useState('');
  const [userResults, setUserResults] = useState<SearchUser[]>([]);
  const [groupResults, setGroupResults] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [joined, setJoined] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 如果有预填 userId，直接搜索
  React.useEffect(() => {
    if (prefillUserId) {
      setQuery(prefillUserId);
      searchUser(prefillUserId);
    }
  }, [prefillUserId]);

  const searchUser = useCallback(async (q: string) => {
    if (!q || q.trim().length < 1) { setUserResults([]); setError(''); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '搜索失败');
      const filtered = (data.users as SearchUser[]).filter(u => u.id !== state.currentUser?.id);
      setUserResults(filtered);
      if (filtered.length === 0) setError('未找到匹配用户');
    } catch (err: any) {
      setError(err.message || '搜索失败，请重试');
      setUserResults([]);
    } finally {
      setLoading(false);
    }
  }, [state.currentUser?.id]);

  const searchGroup = useCallback(async (q: string) => {
    if (!q || q.trim().length < 1) { setGroupResults([]); setError(''); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/group/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '搜索失败');
      setGroupResults(data.groups as SearchGroup[]);
      if ((data.groups as SearchGroup[]).length === 0) setError('未找到匹配群聊');
    } catch (err: any) {
      setError(err.message || '搜索失败，请重试');
      setGroupResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length >= 1) {
      debounceRef.current = setTimeout(() => {
        if (activeTab === 'people') searchUser(val);
        else searchGroup(val);
      }, 400);
    } else {
      setUserResults([]);
      setGroupResults([]);
      setError('');
    }
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setQuery('');
    setUserResults([]);
    setGroupResults([]);
    setError('');
  };

  const handleAddFriend = async (user: SearchUser) => {
    if (sent.has(user.id) || sending.has(user.id)) return;
    setSending(prev => new Set([...prev, user.id]));
    try {
      await authApi('/api/friend/request', {
        toId: user.id,
        message: `你好，我是 ${state.currentUser?.nickname || state.currentUser?.username}，加个好友吧！`,
        searchMethod: 'id',
      });
      setSent(prev => new Set([...prev, user.id]));
      toast.success(`已向 ${user.nickname} 发送好友请求`);
    } catch (err: any) {
      if (err.message?.includes('已经是好友')) {
        setSent(prev => new Set([...prev, user.id]));
        toast.info(`你们已经是好友了`);
      } else if (err.message?.includes('已发送')) {
        setSent(prev => new Set([...prev, user.id]));
        toast.info(`已发送过好友请求，等待对方处理`);
      } else if (err.message?.includes('自动成为好友')) {
        setSent(prev => new Set([...prev, user.id]));
        toast.success(`已成为好友！`);
      } else {
        toast.error(err.message || '发送失败，请重试');
      }
    } finally {
      setSending(prev => { const s = new Set(prev); s.delete(user.id); return s; });
    }
  };

  const handleJoinGroup = async (group: SearchGroup) => {
    if (joined.has(group.id)) return;
    try {
      const userId = state.currentUser?.id;
      if (!userId) { toast.error('请先登录'); return; }
      const res = await fetch('/api/group/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '加入失败');
      }
      setJoined(prev => new Set([...prev, group.id]));
      toast.success(`已加入「${group.name}」`);
      // 将新群插入会话列表
      const chatId = `group_${group.id}`;
      upsertChat({
        id: chatId,
        type: 'group',
        name: group.name,
        avatar: group.avatar || '',
        members: [],
        unreadCount: 0,
        lastMessage: '你已加入群聊',
        lastMessageTime: Date.now(),
        groupId: group.id,
      });
      // 自动进入群聊
      openChat(chatId);
      onClose();
    } catch (err: any) {
      toast.error(err.message || '加入失败，请重试');
    }
  };

  const placeholder = activeTab === 'people' ? 'ID / 手机号 / 邮箱' : '群名称 / 群ID';
  const hint = activeTab === 'people' ? '支持用户ID、手机号、邮箱精确搜索' : '支持群名称模糊搜索或群ID精确搜索';
  const emptyText = activeTab === 'people' ? '输入ID、手机号或邮箱搜索' : '输入群名称或群ID搜索';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="relative w-full max-w-sm bg-white rounded-t-3xl overflow-hidden"
          style={{ maxHeight: '85vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* 把手 */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-gray-200 rounded-full" />
          </div>

          {/* 标题栏：Tab 切换居中 + 关闭按钮 */}
          <div className="flex items-center justify-between px-5 py-3">
            {/* 占位，保持居中 */}
            <div className="w-8" />
            {/* Tab 切换（仿 QQ 胶囊样式） */}
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => handleTabChange('people')}
                className={`px-5 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  activeTab === 'people'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                找人
              </button>
              <button
                onClick={() => handleTabChange('group')}
                className={`px-5 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  activeTab === 'group'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                找群
              </button>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <X size={16} className="text-gray-500" />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2.5">
              <Search size={16} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                value={query}
                onChange={e => handleInput(e.target.value)}
                placeholder={placeholder}
                autoFocus
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
              />
              {loading && <Loader2 size={15} className="text-gray-400 animate-spin flex-shrink-0" />}
              {query && !loading && (
                <button onClick={() => { setQuery(''); setUserResults([]); setGroupResults([]); setError(''); }}>
                  <X size={14} className="text-gray-400" />
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1.5 px-1">{hint}</p>
          </div>

          {/* 搜索结果 */}
          <div className="overflow-y-auto pb-safe pb-6" style={{ maxHeight: '55vh' }}>
            {/* 错误 / 空结果提示 */}
            {error && !loading && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                {activeTab === 'people'
                  ? <UserPlus size={32} className="text-gray-200" />
                  : <Users size={32} className="text-gray-200" />}
                <p className="text-sm text-gray-400">{error}</p>
              </div>
            )}

            {!error && query.length < 1 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Search size={32} className="text-gray-200" />
                <p className="text-sm text-gray-400">{emptyText}</p>
              </div>
            )}

            {/* 找人结果 */}
            {activeTab === 'people' && userResults.map(user => (
              <div
                key={user.id}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <DoveAvatar name={user.nickname} avatar={user.avatar} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.nickname}</p>
                  <p className="text-xs text-gray-400 truncate">{user.bio || `@${user.username}`}</p>
                </div>
                <button
                  onClick={() => handleAddFriend(user)}
                  disabled={sending.has(user.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                    sent.has(user.id)
                      ? 'bg-gray-100 text-gray-400'
                      : sending.has(user.id)
                      ? 'bg-emerald-300 text-white cursor-not-allowed'
                      : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95'
                  }`}
                >
                  {sent.has(user.id) ? (
                    <><Check size={12} />已发送</>
                  ) : sending.has(user.id) ? (
                    <><Loader2 size={12} className="animate-spin" />发送中</>
                  ) : (
                    <><UserPlus size={12} />添加</>
                  )}
                </button>
              </div>
            ))}

            {/* 找群结果 */}
            {activeTab === 'group' && groupResults.map(group => (
              <div
                key={group.id}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <DoveAvatar name={group.name} avatar={group.avatar} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{group.name}</p>
                  <p className="text-xs text-gray-400">{group.memberCount} 名成员</p>
                </div>
                <button
                  onClick={() => handleJoinGroup(group)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                    joined.has(group.id)
                      ? 'bg-gray-100 text-gray-400'
                      : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95'
                  }`}
                >
                  {joined.has(group.id) ? <><Check size={12} />已加入</> : <><Users size={12} />加入</>}
                </button>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
