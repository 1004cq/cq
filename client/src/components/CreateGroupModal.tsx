/**
 * 发起群聊弹窗
 * 从真实好友列表多选成员，调用 /api/group/create 创建群组
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Check, Users, Loader2, ChevronRight } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { toast } from 'sonner';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { authApi } from '@/lib/authFetch';

interface Friend {
  id: string;
  uniqueId: string;
  name: string;
  avatar: string;
  bio?: string;
  status: 'online' | 'offline';
  letter?: string;
}

interface CreateGroupModalProps {
  onClose: () => void;
  onGroupCreated?: (groupId: string, groupName: string) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ onClose, onGroupCreated }) => {
  const { state } = useApp();
  const { openChat } = useAppActions();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<'select' | 'name'>('select');
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  // 真实好友列表
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  const currentUser = state.currentUser;

  // 加载真实好友列表
  const loadFriends = useCallback(async () => {
    if (!state.isLoggedIn) return;
    setFriendsLoading(true);
    try {
      const data = await authApi('/api/friend/list');
      setFriends(data.friends || []);
    } catch (err: any) {
      console.error('加载好友列表失败:', err);
      toast.error('加载联系人失败');
    } finally {
      setFriendsLoading(false);
    }
  }, [state.isLoggedIn]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  const filtered = useMemo(() =>
    friends.filter(u =>
      !search || u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.uniqueId.toLowerCase().includes(search.toLowerCase())
    ),
    [search, friends]
  );

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedUsers = friends.filter(u => selected.has(u.id));

  const defaultGroupName = useMemo(() => {
    if (selectedUsers.length === 0) return '';
    const names = [currentUser?.nickname || '我', ...selectedUsers.map(u => u.name)];
    return names.slice(0, 3).join('、') + (names.length > 3 ? '...' : '');
  }, [selectedUsers, currentUser]);

  const handleNext = () => {
    if (selected.size === 0) {
      toast.error('请至少选择一位联系人');
      return;
    }
    setGroupName(defaultGroupName);
    setStep('name');
  };

  const handleCreate = async () => {
    if (!groupName.trim()) {
      toast.error('请输入群名称');
      return;
    }
    if (!currentUser) {
      toast.error('请先登录');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/group/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName.trim(),
          ownerId: currentUser.id,
          memberIds: Array.from(selected),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');

      toast.success(`群聊「${groupName}」已创建`);
      onGroupCreated?.(data.groupId, groupName.trim());
      onClose();
    } catch (err: any) {
      toast.error(err.message || '创建群聊失败，请重试');
    } finally {
      setCreating(false);
    }
  };

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
          className="relative w-full max-w-sm bg-white rounded-t-3xl overflow-hidden flex flex-col"
          style={{ maxHeight: '88vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* 把手 */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-gray-200 rounded-full" />
          </div>

          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              {step === 'name' && (
                <button
                  onClick={() => setStep('select')}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 mr-1"
                >
                  <ChevronRight size={14} className="text-gray-500 rotate-180" />
                </button>
              )}
              <h3 className="text-base font-semibold text-gray-900">
                {step === 'select' ? '发起群聊' : '设置群名称'}
              </h3>
              {step === 'select' && selected.size > 0 && (
                <span className="text-xs text-emerald-500 font-medium">已选 {selected.size} 人</span>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <X size={16} className="text-gray-500" />
            </button>
          </div>

          {step === 'select' ? (
            <>
              {/* 已选成员预览 */}
              {selected.size > 0 && (
                <div className="px-5 pb-2 flex gap-2 overflow-x-auto flex-shrink-0">
                  {selectedUsers.map(u => (
                    <div key={u.id} className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className="relative">
                        <DoveAvatar name={u.name} avatar={u.avatar} size={36} />
                        <button
                          onClick={() => toggle(u.id)}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-gray-500 rounded-full flex items-center justify-center"
                        >
                          <X size={8} className="text-white" />
                        </button>
                      </div>
                      <span className="text-[10px] text-gray-500 truncate w-10 text-center">{u.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 搜索框 */}
              <div className="px-4 pb-2 flex-shrink-0">
                <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
                  <Search size={15} className="text-gray-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="搜索联系人"
                    className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch('')}>
                      <X size={13} className="text-gray-400" />
                    </button>
                  )}
                </div>
              </div>

              {/* 联系人列表 */}
              <div className="flex-1 overflow-y-auto">
                {friendsLoading ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Loader2 size={24} className="text-gray-300 animate-spin" />
                    <p className="text-sm text-gray-400">加载联系人...</p>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Users size={32} className="text-gray-200" />
                    <p className="text-sm text-gray-400">
                      {friends.length === 0 ? '暂无好友，先去添加好友吧' : '未找到联系人'}
                    </p>
                  </div>
                ) : (
                  filtered.map(user => {
                    const isSelected = selected.has(user.id);
                    return (
                      <button
                        key={user.id}
                        onClick={() => toggle(user.id)}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                      >
                        {/* 选择框 */}
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
                        }`}>
                          {isSelected && <Check size={11} className="text-white" />}
                        </div>
                        <DoveAvatar name={user.name} avatar={user.avatar} size={40} />
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                          <p className="text-xs text-gray-400 truncate">{user.bio || `@${user.uniqueId}`}</p>
                        </div>
                        {user.status === 'online' && (
                          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* 下一步按钮 */}
              <div className="px-5 py-4 pb-safe flex-shrink-0 border-t border-gray-100">
                <button
                  onClick={handleNext}
                  disabled={selected.size === 0}
                  className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
                    selected.size > 0
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98]'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  下一步（{selected.size} 人）
                </button>
              </div>
            </>
          ) : (
            /* 设置群名称步骤 */
            <div className="flex flex-col flex-1 px-5 pb-safe">
              {/* 成员头像展示 */}
              <div className="flex items-center justify-center gap-1.5 py-5">
                {selectedUsers.slice(0, 5).map(u => (
                  <DoveAvatar key={u.id} name={u.name} avatar={u.avatar} size={40} />
                ))}
                {selectedUsers.length > 5 && (
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                    <span className="text-xs text-gray-500">+{selectedUsers.length - 5}</span>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-400 text-center mb-4">
                共 {selected.size + 1} 人（含你）
              </p>

              {/* 群名称输入 */}
              <div className="mb-6">
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">群名称</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="请输入群名称"
                  maxLength={30}
                  autoFocus
                  className="w-full px-4 py-3 bg-gray-100 rounded-xl text-sm text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <p className="text-xs text-gray-400 mt-1 text-right">{groupName.length}/30</p>
              </div>

              <button
                onClick={handleCreate}
                disabled={creating || !groupName.trim()}
                className={`w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                  creating || !groupName.trim()
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98]'
                }`}
              >
                {creating ? (
                  <><Loader2 size={15} className="animate-spin" />创建中...</>
                ) : (
                  <><Users size={15} />创建群聊</>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
