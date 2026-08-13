/**
 * imim 添加好友页面
 * 支持通过账号ID / 手机号 / 邮箱搜索添加好友
 * 包含：好友请求列表（含群聊邀请）、隐私设置
 * 已接入真实 API：/api/users/search, /api/friend/request, /api/friend/requests, /api/friend/accept, /api/friend/reject
 * 新增群邀请 API：/api/group/invites, /api/group/invite-accept/:id, /api/group/invite-reject/:id
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Search, UserPlus, X, Check, ChevronRight,
  Shield, Phone, Mail, Hash, Clock, CheckCircle2,
  XCircle, AlertCircle, Eye, EyeOff, Settings, Bell,
  Send, User as UserIcon, Loader2, Users
} from 'lucide-react';
import { CURRENT_USER, type UserPrivacySettings } from '@/lib/store';
import { DoveAvatar } from '@/components/DoveAvatar';
import { authApi } from '@/lib/authFetch';
import { toast } from 'sonner';
import { useApp, useAppActions } from '@/contexts/AppContext';

// ============ 类型定义 ============
type SearchType = 'id' | 'phone' | 'email';

interface SearchResultUser {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  bio: string;
}

interface FriendRequestItem {
  id: string;
  fromId: string;
  fromName: string;
  fromUniqueId: string;
  fromAvatar: string;
  toId: string;
  toName: string;
  toAvatar: string;
  message: string;
  status: 'pending' | 'accepted' | 'rejected';
  searchMethod: 'id' | 'phone' | 'email';
  timestamp: number;
  isIncoming: boolean;
}

interface GroupInviteItem {
  id: string;
  groupId: string;
  groupName: string;
  groupAvatar: string;
  groupMemberCount: number;
  inviterId: string;
  inviterName: string;
  inviterAvatar: string;
  inviteeId: string;
  inviteeName: string;
  inviteeAvatar: string;
  message: string;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: number;
  isIncoming: boolean;
}

// 统一请求项类型
type RequestItem =
  | (FriendRequestItem & { _type: 'friend' })
  | (GroupInviteItem & { _type: 'group' });

// ============ 搜索结果卡片 ============
const SearchResultCard: React.FC<{
  user: SearchResultUser;
  requestSent: boolean;
  isSending: boolean;
  onSendRequest: (user: SearchResultUser, message: string) => void;
}> = ({ user, requestSent, isSending, onSendRequest }) => {
  const [showInput, setShowInput] = useState(false);
  const [message, setMessage] = useState('');
  const { state } = useApp();

  const handleSend = () => {
    onSendRequest(user, message || `你好，我是 ${state.currentUser?.nickname || CURRENT_USER.name}，加个好友吧！`);
    setShowInput(false);
    setMessage('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm border border-border/20 overflow-hidden mx-4"
    >
      {/* 用户信息 */}
      <div className="flex items-center gap-3 p-4">
        <DoveAvatar name={user.nickname} avatar={user.avatar} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-dove-ink">{user.nickname}</span>
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <Hash size={10} className="text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">{user.username}</span>
          </div>
          {user.bio && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{user.bio}</p>
          )}
        </div>

        {/* 操作按钮 */}
        {requestSent ? (
          <div className="flex items-center gap-1 px-3 py-1.5 bg-dove-green/10 rounded-xl">
            <CheckCircle2 size={13} className="text-dove-green" />
            <span className="text-[11px] text-dove-green">已发送</span>
          </div>
        ) : isSending ? (
          <div className="flex items-center gap-1 px-3 py-1.5 bg-dove-green/10 rounded-xl">
            <Loader2 size={13} className="text-dove-green animate-spin" />
            <span className="text-[11px] text-dove-green">发送中</span>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 bg-dove-green text-white rounded-xl text-[11px] font-medium active:scale-95 transition-transform"
          >
            <UserPlus size={13} />
            <span>加好友</span>
          </button>
        )}
      </div>

      {/* 附言输入 */}
      <AnimatePresence>
        {showInput && !requestSent && !isSending && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2 border-t border-border/20 pt-3">
              <p className="text-[11px] text-muted-foreground">附言（可选）</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={`你好，我是 ${state.currentUser?.nickname || CURRENT_USER.name}，加个好友吧！`}
                  maxLength={50}
                  className="flex-1 text-xs bg-dove-warm-gray/60 rounded-xl px-3 py-2 outline-none placeholder:text-muted-foreground/50"
                />
                <button
                  onClick={handleSend}
                  className="w-8 h-8 bg-dove-green rounded-xl flex items-center justify-center active:scale-95 transition-transform"
                >
                  <Send size={14} className="text-white" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">{message.length}/50</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ============ 请求列表（好友请求 + 群聊邀请） ============
const RequestList: React.FC<{
  friendRequests: FriendRequestItem[];
  groupInvites: GroupInviteItem[];
  loading: boolean;
  onAcceptFriend: (id: string) => void;
  onRejectFriend: (id: string) => void;
  onAcceptGroup: (id: string) => void;
  onRejectGroup: (id: string) => void;
  onRefresh: () => void;
}> = ({ friendRequests, groupInvites, loading, onAcceptFriend, onRejectFriend, onAcceptGroup, onRejectGroup, onRefresh }) => {

  // 合并好友请求和群邀请
  const allItems: RequestItem[] = [
    ...friendRequests.map(r => ({ ...r, _type: 'friend' as const })),
    ...groupInvites.map(r => ({ ...r, _type: 'group' as const })),
  ].sort((a, b) => b.timestamp - a.timestamp);

  const pending = allItems.filter(r => r.status === 'pending' && r.isIncoming);
  const handled = allItems.filter(r => r.status !== 'pending' || !r.isIncoming);

  const getMethodIcon = (method: FriendRequestItem['searchMethod']) => {
    if (method === 'id') return <Hash size={10} />;
    if (method === 'phone') return <Phone size={10} />;
    return <Mail size={10} />;
  };

  const getMethodLabel = (method: FriendRequestItem['searchMethod']) => {
    if (method === 'id') return '通过ID';
    if (method === 'phone') return '通过手机号';
    return '通过邮箱';
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    return Math.floor(diff / 86400000) + '天前';
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 size={24} className="text-dove-green animate-spin" />
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-16 h-16 rounded-full bg-dove-warm-gray/60 flex items-center justify-center">
          <Bell size={24} className="text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">暂无好友请求或群聊邀请</p>
        <button
          onClick={onRefresh}
          className="text-xs text-dove-green underline"
        >
          刷新
        </button>
      </div>
    );
  }

  const renderPendingItem = (item: RequestItem) => {
    if (item._type === 'friend') {
      const req = item as FriendRequestItem & { _type: 'friend' };
      return (
        <motion.div
          key={`friend-${req.id}`}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white rounded-2xl shadow-sm border border-border/20 p-3"
        >
          <div className="flex items-start gap-3">
            <DoveAvatar name={req.fromName} avatar={req.fromAvatar} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-dove-ink">{req.fromName}</span>
                <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground bg-dove-warm-gray/60 px-1.5 py-0.5 rounded-full">
                  {getMethodIcon(req.searchMethod)}
                  {getMethodLabel(req.searchMethod)}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Hash size={9} className="text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{req.fromUniqueId}</span>
                <span className="text-[10px] text-muted-foreground/50">· {formatTime(req.timestamp)}</span>
              </div>
              {req.message && (
                <p className="text-[11px] text-dove-ink/70 mt-1 bg-dove-mist rounded-lg px-2 py-1">
                  {req.message}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onRejectFriend(req.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-dove-warm-gray/60 rounded-xl text-xs text-muted-foreground active:scale-95 transition-transform"
            >
              <XCircle size={13} />
              拒绝
            </button>
            <button
              onClick={() => onAcceptFriend(req.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-dove-green text-white rounded-xl text-xs font-medium active:scale-95 transition-transform"
            >
              <Check size={13} />
              接受
            </button>
          </div>
        </motion.div>
      );
    } else {
      // 群聊邀请
      const inv = item as GroupInviteItem & { _type: 'group' };
      return (
        <motion.div
          key={`group-${inv.id}`}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white rounded-2xl shadow-sm border border-blue-100/60 p-3"
        >
          <div className="flex items-start gap-3">
            <div className="relative">
              <DoveAvatar name={inv.groupName} avatar={inv.groupAvatar} size="md" />
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                <Users size={8} className="text-white" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-dove-ink">{inv.groupName}</span>
                <span className="flex items-center gap-0.5 text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                  <Users size={8} />
                  群聊邀请
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[10px] text-muted-foreground">
                  {inv.inviterName} 邀请你加入 · {inv.groupMemberCount}人
                </span>
                <span className="text-[10px] text-muted-foreground/50">· {formatTime(inv.timestamp)}</span>
              </div>
              {inv.message && (
                <p className="text-[11px] text-dove-ink/70 mt-1 bg-blue-50/80 rounded-lg px-2 py-1">
                  {inv.message}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onRejectGroup(inv.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-dove-warm-gray/60 rounded-xl text-xs text-muted-foreground active:scale-95 transition-transform"
            >
              <XCircle size={13} />
              拒绝
            </button>
            <button
              onClick={() => onAcceptGroup(inv.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-blue-500 text-white rounded-xl text-xs font-medium active:scale-95 transition-transform"
            >
              <Check size={13} />
              加入群聊
            </button>
          </div>
        </motion.div>
      );
    }
  };

  const renderHandledItem = (item: RequestItem) => {
    if (item._type === 'friend') {
      const req = item as FriendRequestItem & { _type: 'friend' };
      return (
        <div
          key={`friend-${req.id}`}
          className="bg-white/60 rounded-2xl border border-border/10 p-3 flex items-center gap-3 opacity-60"
        >
          <DoveAvatar
            name={req.isIncoming ? req.fromName : req.toName}
            avatar={req.isIncoming ? req.fromAvatar : req.toAvatar}
            size="sm"
          />
          <div className="flex-1">
            <span className="text-xs text-dove-ink">
              {req.isIncoming ? req.fromName : req.toName}
            </span>
            <p className="text-[10px] text-muted-foreground">
              {req.isIncoming ? '收到' : '发出'} · {formatTime(req.timestamp)}
            </p>
          </div>
          {req.status === 'accepted' ? (
            <span className="flex items-center gap-1 text-[10px] text-dove-green">
              <CheckCircle2 size={11} /> 已接受
            </span>
          ) : req.status === 'rejected' ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <XCircle size={11} /> 已拒绝
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-amber-500">
              <Clock size={11} /> 等待中
            </span>
          )}
        </div>
      );
    } else {
      // 群聊邀请（已处理/已发出）
      const inv = item as GroupInviteItem & { _type: 'group' };
      return (
        <div
          key={`group-${inv.id}`}
          className="bg-white/60 rounded-2xl border border-border/10 p-3 flex items-center gap-3 opacity-60"
        >
          <div className="relative">
            <DoveAvatar name={inv.groupName} avatar={inv.groupAvatar} size="sm" />
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-blue-500 rounded-full flex items-center justify-center">
              <Users size={7} className="text-white" />
            </div>
          </div>
          <div className="flex-1">
            <span className="text-xs text-dove-ink">{inv.groupName}</span>
            <p className="text-[10px] text-muted-foreground">
              {inv.isIncoming ? `${inv.inviterName} 邀请` : `邀请 ${inv.inviteeName}`} · {formatTime(inv.timestamp)}
            </p>
          </div>
          {inv.status === 'accepted' ? (
            <span className="flex items-center gap-1 text-[10px] text-dove-green">
              <CheckCircle2 size={11} /> 已加入
            </span>
          ) : inv.status === 'rejected' ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <XCircle size={11} /> 已拒绝
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-amber-500">
              <Clock size={11} /> 等待中
            </span>
          )}
        </div>
      );
    }
  };

  return (
    <div className="space-y-3 px-4">
      {pending.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground mb-2 px-1">待处理 ({pending.length})</p>
          <div className="space-y-2">
            {pending.map(renderPendingItem)}
          </div>
        </div>
      )}

      {handled.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground mb-2 px-1 mt-4">已处理 / 已发出</p>
          <div className="space-y-2">
            {handled.map(renderHandledItem)}
          </div>
        </div>
      )}
    </div>
  );
};

// ============ 隐私设置面板 ============
const PrivacySettingsPanel: React.FC<{
  settings: UserPrivacySettings;
  onChange: (settings: UserPrivacySettings) => void;
}> = ({ settings, onChange }) => {
  const items = [
    {
      key: 'allowSearchById' as keyof UserPrivacySettings,
      icon: Hash,
      label: '允许通过账号ID添加',
      desc: '其他用户可以通过你的账号ID搜索到你',
      color: 'text-blue-500',
    },
    {
      key: 'allowSearchByPhone' as keyof UserPrivacySettings,
      icon: Phone,
      label: '允许通过手机号添加',
      desc: '其他用户可以通过你的手机号搜索到你',
      color: 'text-green-500',
    },
    {
      key: 'allowSearchByEmail' as keyof UserPrivacySettings,
      icon: Mail,
      label: '允许通过邮箱添加',
      desc: '其他用户可以通过你的邮箱搜索到你',
      color: 'text-orange-500',
    },
  ];

  return (
    <div className="px-4 space-y-3">
      {/* 说明 */}
      <div className="bg-dove-green/5 rounded-xl p-3 border border-dove-green/10 flex items-start gap-2">
        <Shield size={14} className="text-dove-green mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-dove-ink/70 leading-relaxed">
          控制其他用户通过哪些方式找到你并发送好友请求。关闭后，对应方式将无法搜索到你的账号。
        </p>
      </div>

      {/* 开关列表 */}
      <div className="bg-white rounded-2xl shadow-sm border border-border/20 overflow-hidden">
        {items.map(({ key, icon: Icon, label, desc, color }, i) => (
          <div key={key}>
            {i > 0 && <div className="border-t border-border/10 mx-4" />}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className={`w-8 h-8 rounded-lg bg-dove-warm-gray/40 flex items-center justify-center`}>
                <Icon size={15} className={color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-dove-ink">{label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
              </div>
              {/* Toggle Switch */}
              <button
                onClick={() => onChange({ ...settings, [key]: !settings[key] })}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                  settings[key] ? 'bg-dove-green' : 'bg-muted-foreground/20'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                    settings[key] ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 账号ID展示 */}
      <div className="bg-white rounded-2xl shadow-sm border border-border/20 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Hash size={13} className="text-dove-bamboo" />
          <span className="text-xs font-medium text-dove-ink">我的账号ID</span>
        </div>
        <div className="flex items-center gap-3 bg-dove-mist rounded-xl px-3 py-2.5">
          <span className="text-sm font-mono text-dove-ink flex-1">{CURRENT_USER.uniqueId}</span>
          <span className="text-[10px] text-muted-foreground bg-dove-warm-gray/60 px-2 py-0.5 rounded-full">唯一</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          账号ID最短1位，全局唯一，其他用户可通过此ID找到你（需开启上方开关）
        </p>
      </div>
    </div>
  );
};

// ============ 主页面 ============
type TabType = 'search' | 'requests' | 'privacy';

interface AddFriendPageProps {
  onBack: () => void;
  initialTab?: TabType;
}

export default function AddFriendPage({ onBack, initialTab = 'search' }: AddFriendPageProps) {
  const { state } = useApp();
  const { upsertChat, openChat } = useAppActions();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [searchType, setSearchType] = useState<SearchType>('id');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResultUser | null | 'not-found'>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [sendingRequests, setSendingRequests] = useState<Set<string>>(new Set());
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([]);
  const [groupInvites, setGroupInvites] = useState<GroupInviteItem[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [privacySettings, setPrivacySettings] = useState<UserPrivacySettings>(
    CURRENT_USER.privacy || { allowSearchById: true, allowSearchByPhone: true, allowSearchByEmail: true }
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const pendingFriendCount = friendRequests.filter(r => r.status === 'pending' && r.isIncoming).length;
  const pendingGroupCount = groupInvites.filter(r => r.status === 'pending' && r.isIncoming).length;
  const pendingCount = pendingFriendCount + pendingGroupCount;

  // 加载好友请求列表
  const loadFriendRequests = useCallback(async () => {
    if (!state.isLoggedIn) return;
    try {
      const data = await authApi('/api/friend/requests?type=all');
      setFriendRequests(data.requests || []);
    } catch (err: any) {
      console.error('加载好友请求失败:', err);
    }
  }, [state.isLoggedIn]);

  // 加载群聊邀请列表
  const loadGroupInvites = useCallback(async () => {
    if (!state.isLoggedIn || !state.currentUser?.id) return;
    try {
      const data = await fetch(`/api/group/invites?userId=${state.currentUser.id}&type=all`).then(r => r.json());
      setGroupInvites(data.invites || []);
    } catch (err: any) {
      console.error('加载群聊邀请失败:', err);
    }
  }, [state.isLoggedIn, state.currentUser?.id]);

  // 加载所有请求
  const loadAllRequests = useCallback(async () => {
    setRequestsLoading(true);
    await Promise.all([loadFriendRequests(), loadGroupInvites()]);
    setRequestsLoading(false);
  }, [loadFriendRequests, loadGroupInvites]);

  // 切换到请求 Tab 时自动加载
  useEffect(() => {
    if (activeTab === 'requests') {
      loadAllRequests();
    }
  }, [activeTab, loadAllRequests]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResult(null);
    try {
      const data = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery.trim())}`).then(r => r.json());
      if (data.users && data.users.length > 0) {
        const filtered = data.users.filter((u: SearchResultUser) => u.id !== state.currentUser?.id);
        if (filtered.length > 0) {
          setSearchResult(filtered[0]);
        } else {
          setSearchResult('not-found');
        }
      } else {
        setSearchResult('not-found');
      }
    } catch (err) {
      setSearchResult('not-found');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, state.currentUser?.id]);

  const handleSendRequest = useCallback(async (user: SearchResultUser, message: string) => {
    setSendingRequests(prev => new Set([...prev, user.id]));
    try {
      await authApi('/api/friend/request', {
        toId: user.id,
        message,
        searchMethod: searchType,
      });
      setSentRequests(prev => new Set([...prev, user.id]));
      toast.success(`已向 ${user.nickname} 发送好友请求`);
    } catch (err: any) {
      if (err.message?.includes('已经是好友')) {
        setSentRequests(prev => new Set([...prev, user.id]));
        toast.info('你们已经是好友了');
      } else if (err.message?.includes('已发送')) {
        setSentRequests(prev => new Set([...prev, user.id]));
        toast.info('已发送过好友请求，等待对方处理');
      } else if (err.message?.includes('自动成为好友')) {
        setSentRequests(prev => new Set([...prev, user.id]));
        toast.success('已成为好友！');
      } else {
        toast.error(err.message || '发送失败，请重试');
      }
    } finally {
      setSendingRequests(prev => { const s = new Set(prev); s.delete(user.id); return s; });
    }
  }, [searchType]);

  // 接受好友请求
  const handleAcceptFriend = useCallback(async (id: string) => {
    try {
      const data = await authApi(`/api/friend/accept/${id}`, {});
      setFriendRequests(prev =>
        prev.map(r => r.id === id ? { ...r, status: 'accepted' } : r)
      );
      toast.success('已接受好友申请');

      if (data?.chatId && upsertChat) {
        try {
          const chatData = await authApi(`/api/chat/${data.chatId}`, undefined, 'GET');
          if (chatData?.chat) {
            const c = chatData.chat;
            const currentUserId = state.currentUser?.id || localStorage.getItem('user_id') || 'me';
            upsertChat({
              id: c.id,
              type: 'private',
              name: c.peer?.nickname || c.peer?.username || c.peer?.id || '',
              avatar: c.peer?.avatar || '',
              lastMessage: c.lastMessage || '',
              lastMessageTime: c.lastMessageAt || c.createdAt,
              unreadCount: 0,
              isPinned: false,
              isMuted: false,
              isEncrypted: true,
              members: [currentUserId, c.peer?.id || ''],
            });
          }
        } catch (e) {
          // 忽略会话加载错误
        }
      }
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    }
  }, [upsertChat, state.currentUser]);

  // 拒绝好友请求
  const handleRejectFriend = useCallback(async (id: string) => {
    try {
      await authApi(`/api/friend/reject/${id}`, {});
      setFriendRequests(prev =>
        prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r)
      );
      toast.success('已拒绝好友申请');
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    }
  }, []);

  // 接受群聊邀请
  const handleAcceptGroup = useCallback(async (id: string) => {
    try {
      const userId = state.currentUser?.id;
      if (!userId) { toast.error('请先登录'); return; }

      const res = await fetch(`/api/group/invite-accept/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');

      setGroupInvites(prev =>
        prev.map(inv => inv.id === id ? { ...inv, status: 'accepted' } : inv)
      );
      toast.success(`已加入群聊「${data.groupName || ''}」`);

      // 将群聊加入会话列表
      if (data.groupId) {
        const chatId = `group_${data.groupId}`;
        upsertChat({
          id: chatId,
          type: 'group',
          name: data.groupName || '',
          avatar: data.groupAvatar || '',
          members: [],
          unreadCount: 0,
          lastMessage: '你已加入群聊',
          lastMessageTime: Date.now(),
          groupId: data.groupId,
        });
        openChat(chatId);
        onBack();
      }
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    }
  }, [state.currentUser, upsertChat, openChat, onBack]);

  // 拒绝群聊邀请
  const handleRejectGroup = useCallback(async (id: string) => {
    try {
      const userId = state.currentUser?.id;
      if (!userId) { toast.error('请先登录'); return; }

      const res = await fetch(`/api/group/invite-reject/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');

      setGroupInvites(prev =>
        prev.map(inv => inv.id === id ? { ...inv, status: 'rejected' } : inv)
      );
      toast.success('已拒绝群聊邀请');
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    }
  }, [state.currentUser]);

  const searchTypeTabs: { type: SearchType; icon: React.FC<any>; label: string; placeholder: string }[] = [
    { type: 'id', icon: Hash, label: 'ID', placeholder: '输入账号ID（如：linxixi）' },
    { type: 'phone', icon: Phone, label: '手机号', placeholder: '输入完整手机号' },
    { type: 'email', icon: Mail, label: '邮箱', placeholder: '输入邮箱地址' },
  ];

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-40 bg-dove-paper flex flex-col"
    >
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/20">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-dove-warm-gray transition-colors"
        >
          <ArrowLeft size={20} className="text-dove-ink" />
        </button>
        <h1 className="text-base font-medium text-dove-ink flex-1" style={{ fontFamily: 'var(--font-wenkai)' }}>
          添加好友
        </h1>
      </div>

      {/* Tab 栏 */}
      <div className="flex px-4 pt-3 pb-2 gap-1">
        {([
          { tab: 'search' as TabType, label: '搜索', icon: Search, badge: undefined as number | undefined },
          { tab: 'requests' as TabType, label: '好友请求', icon: Bell, badge: pendingCount as number | undefined },
          { tab: 'privacy' as TabType, label: '隐私设置', icon: Shield, badge: undefined as number | undefined },
        ]).map(({ tab, label, icon: Icon, badge }) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all ${
              activeTab === tab
                ? 'bg-dove-green text-white shadow-sm'
                : 'bg-dove-warm-gray/60 text-muted-foreground hover:bg-dove-warm-gray'
            }`}
          >
            <Icon size={13} />
            <span>{label}</span>
            {badge !== undefined && badge > 0 && (
              <span className={`text-[9px] rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-1 ${
                activeTab === tab ? 'bg-white/30 text-white' : 'bg-dove-seal text-white'
              }`}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* ===== 搜索 Tab ===== */}
          {activeTab === 'search' && (
            <motion.div
              key="search"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pt-2 pb-8 space-y-4"
            >
              {/* 搜索类型选择 */}
              <div className="px-4">
                <div className="flex gap-2 bg-dove-warm-gray/40 rounded-xl p-1">
                  {searchTypeTabs.map(({ type, icon: Icon, label }) => (
                    <button
                      key={type}
                      onClick={() => {
                        setSearchType(type);
                        setSearchQuery('');
                        setSearchResult(null);
                        inputRef.current?.focus();
                      }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                        searchType === type
                          ? 'bg-white shadow-sm text-dove-ink'
                          : 'text-muted-foreground hover:text-dove-ink'
                      }`}
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 搜索输入框 */}
              <div className="px-4">
                <div className="flex items-center gap-2 bg-white rounded-2xl shadow-sm border border-border/20 px-3 py-3">
                  <Search size={15} className="text-muted-foreground flex-shrink-0" />
                  <input
                    ref={inputRef}
                    type={searchType === 'phone' ? 'tel' : searchType === 'email' ? 'email' : 'text'}
                    value={searchQuery}
                    onChange={e => {
                      setSearchQuery(e.target.value);
                      setSearchResult(null);
                    }}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    placeholder={searchTypeTabs.find(t => t.type === searchType)?.placeholder}
                    className="flex-1 text-sm outline-none bg-transparent text-dove-ink placeholder:text-muted-foreground/50"
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(''); setSearchResult(null); }}
                      className="text-muted-foreground hover:text-dove-ink"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* 搜索按钮 */}
              <div className="px-4">
                <button
                  onClick={handleSearch}
                  disabled={!searchQuery.trim() || isSearching}
                  className="w-full py-3 bg-dove-green text-white rounded-2xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                >
                  {isSearching ? (
                    <><Loader2 size={15} className="animate-spin" />搜索中...</>
                  ) : (
                    <><Search size={15} />搜索</>
                  )}
                </button>
              </div>

              {/* 搜索结果 */}
              {searchResult === 'not-found' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-12 gap-3 px-4"
                >
                  <div className="w-16 h-16 rounded-full bg-dove-warm-gray/60 flex items-center justify-center">
                    <UserIcon size={24} className="text-muted-foreground/40" />
                  </div>
                  <p className="text-sm text-muted-foreground">未找到该用户</p>
                  <p className="text-[11px] text-muted-foreground/60 text-center">
                    请检查输入是否正确，或该用户已关闭对应搜索方式
                  </p>
                </motion.div>
              )}

              {searchResult && searchResult !== 'not-found' && (
                <SearchResultCard
                  user={searchResult}
                  requestSent={sentRequests.has(searchResult.id)}
                  isSending={sendingRequests.has(searchResult.id)}
                  onSendRequest={handleSendRequest}
                />
              )}

              {!searchResult && !isSearching && !searchQuery && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 px-4">
                  <div className="w-16 h-16 rounded-full bg-dove-warm-gray/40 flex items-center justify-center">
                    <Search size={24} className="text-muted-foreground/30" />
                  </div>
                  <p className="text-sm text-muted-foreground">输入账号ID、手机号或邮箱搜索</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ===== 好友请求 Tab ===== */}
          {activeTab === 'requests' && (
            <motion.div
              key="requests"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pt-2 pb-8"
            >
              <RequestList
                friendRequests={friendRequests}
                groupInvites={groupInvites}
                loading={requestsLoading}
                onAcceptFriend={handleAcceptFriend}
                onRejectFriend={handleRejectFriend}
                onAcceptGroup={handleAcceptGroup}
                onRejectGroup={handleRejectGroup}
                onRefresh={loadAllRequests}
              />
            </motion.div>
          )}

          {/* ===== 隐私设置 Tab ===== */}
          {activeTab === 'privacy' && (
            <motion.div
              key="privacy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pt-2 pb-8"
            >
              <PrivacySettingsPanel
                settings={privacySettings}
                onChange={setPrivacySettings}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
