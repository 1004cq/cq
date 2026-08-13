/**
 * imim 通讯录页面 — 精致升级版
 * 统一搜索栏、精致字母索引、流畅动画
 * 已接入真实 API：/api/friend/list, /api/friend/requests
 */
import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { type User } from '@/lib/store';
import { DoveAvatar } from '@/components/DoveAvatar';
import { useAppActions, useApp } from '@/contexts/AppContext';
import { useRemoteProfileSync, mergeProfileUpdate } from '@/hooks/useRemoteProfileSync';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, UserPlus, Users, Scan, X, UserX, Loader2 } from 'lucide-react';
import { QRCardModal } from '@/components/QRCodeCard';
import AddFriendPage from '@/pages/AddFriendPage';
import { authApi } from '@/lib/authFetch';

// 字母索引条组件 — 精致版
const AlphabetIndex: React.FC<{
  letters: string[];
  activeLetter: string;
  onSelect: (letter: string) => void;
}> = ({ letters, activeLetter, onSelect }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [hoverLetter, setHoverLetter] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const y = touch.clientY - rect.top;
    const index = Math.floor(y / (rect.height / letters.length));
    if (index >= 0 && index < letters.length) {
      setHoverLetter(letters[index]);
      onSelect(letters[index]);
    }
  }, [letters, onSelect]);

  return (
    <div
      ref={containerRef}
      className="fixed right-0.5 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center py-1"
      onTouchStart={() => setIsDragging(true)}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => { setIsDragging(false); setHoverLetter(null); }}
    >
      {/* 放大气泡提示 */}
      <AnimatePresence>
        {isDragging && hoverLetter && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-2xl bg-dove-green flex items-center justify-center shadow-soft-lg z-50"
          >
            <span className="text-2xl font-bold text-white">{hoverLetter}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {letters.map(letter => (
        <button
          key={letter}
          onClick={() => onSelect(letter)}
          className={`w-[18px] h-[18px] flex items-center justify-center text-[9px] font-semibold rounded-full transition-all duration-150 ${
            activeLetter === letter || hoverLetter === letter
              ? 'bg-dove-green text-white scale-125'
              : 'text-dove-green/60 hover:text-dove-green'
          }`}
        >
          {letter}
        </button>
      ))}
    </div>
  );
};

export default function ContactsPage() {
  const { showProfile } = useAppActions();
  const { state } = useApp();
  const [searchText, setSearchText] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeLetter, setActiveLetter] = useState('');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [addFriendTab, setAddFriendTab] = useState<'search' | 'requests' | 'privacy'>('search');
  const [friends, setFriends] = useState<User[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 加载好友列表
  const loadFriends = useCallback(async () => {
    if (!state.isLoggedIn) return;
    setFriendsLoading(true);
    try {
      const data = await authApi('/api/friend/list');
      setFriends(data.friends || []);
    } catch (err: any) {
      console.error('加载好友列表失败:', err);
    } finally {
      setFriendsLoading(false);
    }
  }, [state.isLoggedIn]);

  // 加载待处理好友请求数量
  const loadPendingCount = useCallback(async () => {
    if (!state.isLoggedIn) return;
    try {
      const data = await authApi('/api/friend/requests?type=received');
      const pending = (data.requests || []).filter((r: any) => r.status === 'pending');
      setPendingRequestCount(pending.length);
    } catch (err) {
      // 忽略错误
    }
  }, [state.isLoggedIn]);

  // 登录后自动加载
  useEffect(() => {
    if (state.isLoggedIn) {
      loadFriends();
      loadPendingCount();
    }
  }, [state.isLoggedIn, loadFriends, loadPendingCount]);

  // ★ 实时同步：好友更新头像/昵称后自动更新列表
  useRemoteProfileSync((update) => {
    setFriends(prev => prev.map(f => mergeProfileUpdate(f, update)));
  });

  // 关闭添加好友页面时刷新列表
  const handleCloseAddFriend = useCallback(() => {
    setShowAddFriend(false);
    loadFriends();
    loadPendingCount();
  }, [loadFriends, loadPendingCount]);

  // 格式化最后在线时间
  const formatLastSeen = (ts: number): string => {
    const now = Date.now();
    const diff = now - ts;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const filteredUsers = useMemo(() => {
    if (!searchText) return friends;
    return friends.filter(u =>
      u.name.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [searchText, friends]);

  // 按首字母分组
  const grouped = useMemo(() => {
    const groups: Record<string, User[]> = {};
    filteredUsers.forEach(u => {
      const letter = u.letter || '#';
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(u);
    });
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
  }, [filteredUsers]);

  const letters = useMemo(() => grouped.map(([letter]) => letter), [grouped]);

  const handleLetterSelect = useCallback((letter: string) => {
    setActiveLetter(letter);
    const section = sectionRefs.current[letter];
    if (section && scrollRef.current) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const quickActions = [
    {
      icon: UserPlus,
      label: '新的朋友',
      count: pendingRequestCount,
      color: 'bg-gradient-to-br from-orange-400 to-orange-500',
      onClick: () => { setAddFriendTab('requests'); setShowAddFriend(true); }
    },
    {
      icon: Users,
      label: '群聊',
      count: 0,
      color: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
      onClick: () => {}
    },
    {
      icon: Scan,
      label: '扫一扫',
      count: 0,
      color: 'bg-gradient-to-br from-blue-400 to-blue-500',
      onClick: () => setShowQRScanner(true)
    },
  ];

  return (
    <div className="flex flex-col h-full relative">
      {/* 顶部栏 */}
      <div className="dove-topbar">
        <h1 className="dove-topbar-title">通讯录</h1>
        <button
          onClick={() => { setAddFriendTab('search'); setShowAddFriend(true); }}
          className="dove-icon-btn relative"
        >
          <UserPlus size={20} className="text-dove-ink" />
          {pendingRequestCount > 0 && (
            <span className="dove-badge absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] text-[8px]">
              {pendingRequestCount}
            </span>
          )}
        </button>
      </div>

      {/* 搜索 */}
      <div className="px-4 pb-2.5">
        <motion.div
          className={`search-bar ${searchFocused ? 'focused' : ''}`}
          animate={{ scale: searchFocused ? 1.005 : 1 }}
          transition={{ duration: 0.2 }}
        >
          <Search size={15} className={`transition-colors duration-200 flex-shrink-0 ${searchFocused ? 'text-dove-green' : 'text-muted-foreground/50'}`} />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="搜索联系人"
          />
          {searchText && (
            <button onClick={() => setSearchText('')} className="p-0.5">
              <X size={14} className="text-muted-foreground/50" />
            </button>
          )}
        </motion.div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-6">
        {/* 快捷入口 */}
        {!searchText && (
          <div className="mb-1">
            {quickActions.map(({ icon: Icon, label, count, color, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="dove-list-item w-full"
              >
                <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center shadow-soft-sm`}>
                  <Icon size={18} className="text-white" />
                </div>
                <span className="text-sm text-foreground flex-1 text-left font-medium">{label}</span>
                {count > 0 && (
                  <span className="dove-badge">
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* 加载中 */}
        {friendsLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 size={24} className="text-dove-green animate-spin" />
            <p className="text-sm text-muted-foreground">加载联系人...</p>
          </div>
        )}

        {/* 联系人列表 */}
        {!friendsLoading && grouped.map(([letter, users]) => (
          <div
            key={letter}
            ref={el => { sectionRefs.current[letter] = el; }}
          >
            <div className="px-4 py-1.5 bg-dove-mist/70 sticky top-0 z-10 backdrop-blur-sm">
              <span className="text-[11px] text-dove-green/80 font-semibold tracking-wide"
                style={{ fontFamily: 'var(--font-wenkai)' }}>
                {letter}
              </span>
            </div>
            {users.map((user, i) => (
              <motion.button
                key={user.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => showProfile(user.id)}
                className="dove-list-item w-full"
              >
                <div className="relative flex-shrink-0">
                  <DoveAvatar name={user.name} id={user.id} avatar={user.avatar} size="md" />
                  <div className={`status-dot absolute -bottom-0.5 -right-0.5 ${
                    user.status === 'online' ? 'status-dot-online' :
                    user.status === 'busy' ? 'status-dot-busy' : 'status-dot-offline'
                  }`} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm text-foreground font-medium">{user.name}</p>
                  {user.bio ? (
                    <p className="text-[11px] text-muted-foreground/70 truncate">{user.bio}</p>
                  ) : (
                    <p className={`text-[11px] ${
                      user.status === 'online' ? 'text-dove-green/70' :
                      user.status === 'busy' ? 'text-amber-500/70' : 'text-muted-foreground/40'
                    }`}>
                      {user.status === 'online'
                        ? (user.deviceLabel ? `在线 · ${user.deviceLabel}` : '在线')
                        : user.status === 'busy' ? '忙碌'
                        : user.lastSeen
                          ? `最后在线 ${formatLastSeen(user.lastSeen)}`
                          : '离线'
                      }
                    </p>
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        ))}

        {/* 空状态：无好友 */}
        {!friendsLoading && !searchText && friends.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-16 text-muted-foreground"
          >
            <div className="w-16 h-16 rounded-2xl bg-dove-warm-gray/50 flex items-center justify-center mb-3">
              <Users size={28} className="text-muted-foreground/35" />
            </div>
            <p className="text-sm text-dove-ink/45" style={{ fontFamily: 'var(--font-wenkai)' }}>还没有好友</p>
            <p className="text-xs text-muted-foreground/35 mt-1">点击右上角添加好友</p>
          </motion.div>
        )}

        {/* 搜索无结果 */}
        {!friendsLoading && searchText && filteredUsers.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-16 text-muted-foreground"
          >
            <div className="w-16 h-16 rounded-2xl bg-dove-warm-gray/50 flex items-center justify-center mb-3">
              <UserX size={28} className="text-muted-foreground/35" />
            </div>
            <p className="text-sm text-dove-ink/45" style={{ fontFamily: 'var(--font-wenkai)' }}>没有找到「{searchText}」</p>
            <p className="text-xs text-muted-foreground/35 mt-1">试试搜索其他关键词</p>
          </motion.div>
        )}

        {/* 底部统计 */}
        {!searchText && !friendsLoading && friends.length > 0 && (
          <div className="py-6 text-center">
            <p className="text-[11px] text-muted-foreground/40 font-medium">
              {friends.length} 位联系人
            </p>
          </div>
        )}
      </div>

      {/* 右侧字母索引条 */}
      {!searchText && letters.length > 0 && (
        <AlphabetIndex
          letters={letters}
          activeLetter={activeLetter}
          onSelect={handleLetterSelect}
        />
      )}

      {/* 扫一扫二维码弹窗 */}
      <AnimatePresence>
        {showQRScanner && (
          <QRCardModal
            onClose={() => setShowQRScanner(false)}
            onScanSuccess={() => setShowQRScanner(false)}
          />
        )}
      </AnimatePresence>

      {/* 添加好友页面 */}
      <AnimatePresence>
        {showAddFriend && (
          <AddFriendPage
            onBack={handleCloseAddFriend}
            initialTab={addFriendTab}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
