/**
 * imim 消息列表页 — 精致升级版
 * 统一搜索栏、精致卡片、流畅动画、深色下拉菜单
 * 已接入：发起群聊、添加朋友、扫一扫、我的二维码
 */
import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { DoveAvatar } from '@/components/DoveAvatar';
import { formatTime, MOCK_USERS } from '@/lib/store';
import type { Chat } from '@/lib/store';
import { authApi } from '@/lib/authFetch';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Pin, VolumeX, Lock, X, Users, UserPlus, ScanLine, QrCode, Plus, ChevronRight, User, Moon, Sun, SunMoon, MessageCircle } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { GoldVerifiedBadge } from '@/components/GoldVerifiedBadge';
import { toast } from 'sonner';
import { QRCodeModal } from '@/components/QRCodeModal';
import { ScannerModal } from '@/components/ScannerModal';
import { AddFriendModal } from '@/components/AddFriendModal';
import { CreateGroupModal } from '@/components/CreateGroupModal';
import { getVisibleRange, rafThrottle } from '@/lib/performance';

const CHAT_ITEM_HEIGHT = 80;
const VIRTUALIZATION_THRESHOLD = 24;
const VIRTUAL_BUFFER = 6;

// ============ 新建会话弹窗 ============
const NewChatSheet: React.FC<{
  onClose: () => void;
  onSelectUser: (userId: string, userName: string) => void;
}> = ({ onClose, onSelectUser }) => {
  const [search, setSearch] = useState('');
  const filtered = MOCK_USERS.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="dove-sheet-backdrop"
      onClick={onClose}
    >
      <div className="dove-sheet-overlay" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="dove-sheet-content max-h-[75vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="dove-sheet-handle" />
        <div className="flex items-center justify-between px-5 py-3">
          <h3 className="text-base font-semibold text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>发起聊天</h3>
          <button onClick={onClose} className="dove-icon-btn w-7 h-7 bg-dove-warm-gray">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
        <div className="px-4 pb-2">
          <div className="search-bar">
            <Search size={14} className="text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索联系人"
              autoFocus
            />
            {search && <button onClick={() => setSearch('')}><X size={13} className="text-muted-foreground" /></button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pb-4">
          {!search && (
            <div className="px-4 py-1.5">
              <span className="text-[11px] text-muted-foreground/50 font-medium uppercase tracking-wider">联系人</span>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Search size={28} className="mb-2 opacity-30" />
              <p className="text-sm">没有找到联系人</p>
            </div>
          ) : (
            filtered.map((user, i) => (
              <motion.button
                key={user.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.015 }}
                onClick={() => { onSelectUser(user.id, user.name); onClose(); }}
                className="dove-list-item w-full"
              >
                <div className="relative">
                  <DoveAvatar name={user.name} id={user.id} avatar={user.avatar} size="md" />
                  <div className={`status-dot absolute -bottom-0.5 -right-0.5 ${
                    user.status === 'online' ? 'status-dot-online' :
                    user.status === 'busy' ? 'status-dot-busy' : 'status-dot-offline'
                  }`} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm text-foreground font-medium truncate">{user.name}</p>
                  {user.bio && <p className="text-[11px] text-muted-foreground truncate">{user.bio}</p>}
                </div>
                <ChevronRight size={14} className="text-muted-foreground/30 flex-shrink-0" />
              </motion.button>
            ))
          )}
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom, 16px)' }} />
      </motion.div>
    </motion.div>
  );
};

const ChatListSkeleton: React.FC = () => (
  <div className="px-3 py-3 space-y-2.5">
    {[...Array(10)].map((_, i) => (
      <div key={i} className="flex items-center gap-3 rounded-[24px] px-3 py-2.5">
        <div className="h-12 w-12 rounded-full skeleton-enhanced" />
        <div className="min-w-0 flex-1">
          <div className="mb-2 h-3.5 w-28 rounded-full skeleton-enhanced" />
          <div className={`h-3 rounded-full skeleton-enhanced ${i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-2/3' : 'w-1/2'}`} />
        </div>
        <div className="h-3 w-10 rounded-full skeleton-enhanced" />
      </div>
    ))}
  </div>
);

export default function ChatsPage() {
  const { state } = useApp();
  const { openChat, deleteChat, pinChat } = useAppActions();
  const { theme, mode, toggleTheme } = useTheme();
  const [searchText, setSearchText] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [swipedChatId, setSwipedChatId] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);

  // 四个功能弹窗状态
  const [showQRCode, setShowQRCode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [scannedUserId, setScannedUserId] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<'all' | 'group'>('all');
  const listRef = useRef<HTMLDivElement | null>(null);
  const initialListResolvedRef = useRef(state.chats.length > 0);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: VIRTUALIZATION_THRESHOLD + VIRTUAL_BUFFER * 2 });
  const [showListSkeleton, setShowListSkeleton] = useState(() => state.chats.length === 0);

  const currentUser = state.currentUser;

  // Tab 过滤逻辑
  const isGroupChat = (chat: Chat) => chat.type === 'group';
  const getFixedChatRank = (chat: Chat) => {
    if (chat.id === 'c0' || chat.members?.includes('official')) return 0;
    if (chat.id === 'cBOT' || chat.members?.includes('BOT')) return 1;
    return 99;
  };
  const isFixedOfficialChat = (chat: Chat) => getFixedChatRank(chat) < 99;

  const sortedChats = useMemo(() => {
    return [...state.chats]
      .filter(chat => {
        if (searchText && !chat.name.toLowerCase().includes(searchText.toLowerCase())) return false;
        if (activeTab === 'group') return isGroupChat(chat);
        return true;
      })
      .sort((a, b) => {
        const aRank = getFixedChatRank(a);
        const bRank = getFixedChatRank(b);
        if (aRank !== bRank) return aRank - bRank;
        if (aRank < 99 && bRank < 99) return 0;
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return (b.lastMessageTime || 0) - (a.lastMessageTime || 0);
      });
  }, [state.chats, searchText, activeTab]);

  const groupUnread = state.chats.filter(isGroupChat).reduce((s, c) => s + c.unreadCount, 0);

  const handleSwipeAction = useCallback(async (chatId: string, action: 'pin' | 'delete') => {
    if (action === 'pin') {
      pinChat(chatId);
      toast(state.chats.find(c => c.id === chatId)?.isPinned ? '已取消置顶' : '已置顶');
      setSwipedChatId(null);
      return;
    }

    try {
      await deleteChat(chatId);
      toast('会话已删除');
      setSwipedChatId(null);
    } catch (err: any) {
      toast.error(err?.message || '删除会话失败');
    }
  }, [pinChat, deleteChat, state.chats]);

  const { upsertChat } = useAppActions();

  const handleSelectUser = useCallback(async (userId: string, userName: string) => {
    const existing = state.chats.find(c => c.type === 'private' && c.members?.includes(userId));
    if (existing) {
      openChat(existing.id);
      return;
    }
    // 创建新私聊会话
    try {
      const currentUserId = state.currentUser?.id || localStorage.getItem('user_id') || 'me';
      const data = await authApi('/api/chat/create', { targetUserId: userId });
      if (data?.chat) {
        const c = data.chat;
        const peerId = c.peer?.id || userId;
        const isOfficial = peerId === 'official';
        const isBot = peerId === 'BOT';
        const newChat: Chat = {
          id: isOfficial ? 'c0' : isBot ? 'cBOT' : c.id,
          type: 'private',
          name: isOfficial ? 'imim 官方' : isBot ? 'imim AI' : (c.peer?.nickname || c.peer?.username || userName),
          avatar: isOfficial ? '/imim-official-avatar.jpg' : isBot ? '/imim-ai-avatar.jpg' : (c.peer?.avatar || ''),
          lastMessage: '',
          lastMessageTime: c.lastMessageAt || c.createdAt,
          unreadCount: 0,
          isPinned: isOfficial || isBot,
          isMuted: false,
          isEncrypted: true,
          members: [currentUserId, peerId],
        };
        upsertChat(newChat);
        openChat(newChat.id);
      }
    } catch (err: any) {
      toast.error(err.message || '创建会话失败');
    }
  }, [state.chats, state.currentUser, openChat, upsertChat]);

  // 扫码成功后打开添加好友
  const handleScanResult = useCallback((userId: string) => {
    setScannedUserId(userId);
    setShowAddFriend(true);
  }, []);

  const totalUnread = state.chats.reduce((s, c) => s + c.unreadCount, 0);
  const shouldVirtualize = sortedChats.length > VIRTUALIZATION_THRESHOLD;

  const updateVisibleRange = useMemo(
    () => rafThrottle(() => {
      if (!listRef.current) return;
      const { scrollTop, clientHeight } = listRef.current;
      const nextRange = getVisibleRange(
        scrollTop,
        clientHeight || CHAT_ITEM_HEIGHT * VIRTUALIZATION_THRESHOLD,
        CHAT_ITEM_HEIGHT,
        sortedChats.length,
        VIRTUAL_BUFFER,
      );
      setVisibleRange(prev => (
        prev.start === nextRange.start && prev.end === nextRange.end ? prev : nextRange
      ));
    }),
    [sortedChats.length],
  );

  useLayoutEffect(() => {
    if (!shouldVirtualize) {
      setVisibleRange({ start: 0, end: sortedChats.length });
      return;
    }

    if (listRef.current) {
      updateVisibleRange();
      return;
    }

    setVisibleRange({
      start: 0,
      end: Math.min(sortedChats.length, VIRTUALIZATION_THRESHOLD + VIRTUAL_BUFFER * 2),
    });
  }, [shouldVirtualize, sortedChats.length, updateVisibleRange]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTo({ top: 0, behavior: 'auto' });
    if (shouldVirtualize) updateVisibleRange();
  }, [searchText, activeTab, shouldVirtualize, updateVisibleRange]);

  useEffect(() => {
    if (!shouldVirtualize) return;
    const handleResize = () => updateVisibleRange();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [shouldVirtualize, updateVisibleRange]);

  useEffect(() => {
    if (initialListResolvedRef.current) {
      setShowListSkeleton(false);
      return;
    }

    if (state.chats.length > 0) {
      initialListResolvedRef.current = true;
      setShowListSkeleton(false);
      return;
    }

    const timer = window.setTimeout(() => {
      initialListResolvedRef.current = true;
      setShowListSkeleton(false);
    }, 420);

    return () => window.clearTimeout(timer);
  }, [state.chats.length]);

  const visibleChats = useMemo(() => {
    if (!shouldVirtualize) return sortedChats;
    return sortedChats.slice(visibleRange.start, visibleRange.end);
  }, [shouldVirtualize, sortedChats, visibleRange.start, visibleRange.end]);

  const topSpacerHeight = shouldVirtualize ? visibleRange.start * CHAT_ITEM_HEIGHT : 0;
  const bottomSpacerHeight = shouldVirtualize
    ? Math.max(0, (sortedChats.length - visibleRange.end) * CHAT_ITEM_HEIGHT)
    : 0;

  const menuItems = [
    {
      icon: Users,
      label: '发起群聊',
      action: () => { setShowCreateGroup(true); setShowPlusMenu(false); },
    },
    {
      icon: UserPlus,
      label: '添加朋友',
      action: () => { setScannedUserId(undefined); setShowAddFriend(true); setShowPlusMenu(false); },
    },
    {
      icon: ScanLine,
      label: '扫一扫',
      action: () => { setShowScanner(true); setShowPlusMenu(false); },
    },
    {
      icon: QrCode,
      label: '我的二维码',
      action: () => {
        if (!currentUser) { toast.error('请先登录'); return; }
        setShowQRCode(true);
        setShowPlusMenu(false);
      },
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="dove-topbar">
        <div className="flex items-center gap-2.5">
          <h1 className="dove-topbar-title">消息</h1>
          <AnimatePresence>
            {totalUnread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                className="dove-badge"
              >
                {totalUnread > 99 ? '99+' : totalUnread}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {/* 扫码 + 加号按钮 */}
        <div className="flex items-center gap-1">
          <button
            className="dove-icon-btn"
            onClick={toggleTheme}
            title={mode === 'light' ? '当前：亮色，点击切换暗色' : mode === 'dark' ? '当前：暗色，点击跟随系统' : '当前：跟随系统，点击切换亮色'}
          >
            {mode === 'light' ? (
              <Sun size={20} className="text-amber-500" />
            ) : mode === 'dark' ? (
              <Moon size={20} className="text-blue-400" />
            ) : (
              <SunMoon size={20} className="text-dove-ink dark:text-gray-300" />
            )}
          </button>
        <div className="relative">
          <button
            className="dove-icon-btn"
            onClick={() => setShowPlusMenu(v => !v)}
          >
            <Plus size={22} className="text-dove-ink" />
          </button>

          {/* 深色下拉菜单 */}
          <AnimatePresence>
            {showPlusMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPlusMenu(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -8 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-11 z-50 bg-[#2a2a2a] rounded-2xl overflow-hidden shadow-2xl min-w-[168px]"
                  style={{ transformOrigin: 'top right' }}
                >
                  <div className="absolute -top-1.5 right-3.5 w-3 h-3 bg-[#2a2a2a] rotate-45 rounded-sm" />
                  {menuItems.map(({ icon: Icon, label, action }, i, arr) => (
                    <button
                      key={label}
                      onClick={action}
                      className={`w-full flex items-center gap-3.5 px-5 py-3.5 hover:bg-white/8 active:bg-white/12 transition-colors ${
                        i < arr.length - 1 ? 'border-b border-white/6' : ''
                      }`}
                    >
                      <Icon size={17} className="text-white/75 flex-shrink-0" />
                      <span className="text-[13px] text-white/90 font-normal">{label}</span>
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
        </div>
      </div>

      {/* Tab 分类栏 */}
      <div className="flex items-center gap-1 px-4 pb-2">
        {[
          { key: 'all' as const, label: '全部', badge: 0 },
          { key: 'group' as const, label: '群聊', badge: groupUnread },
        ].map(({ key, label, badge, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
              activeTab === key
                ? 'bg-dove-green text-white shadow-sm'
                : 'bg-dove-warm-gray/60 text-muted-foreground hover:bg-dove-warm-gray'
            }`}
          >
            {Icon && <Icon size={11} />}
            {label}
            {badge > 0 && (
              <span className={`ml-0.5 min-w-[14px] h-[14px] rounded-full text-[9px] flex items-center justify-center px-1 ${
                activeTab === key ? 'bg-white/30 text-white' : 'bg-dove-green text-white'
              }`}>
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 搜索栏 */}
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
            placeholder="搜索聊天记录"
          />
          {searchText && (
            <button onClick={() => setSearchText('')} className="p-0.5">
              <X size={14} className="text-muted-foreground/50" />
            </button>
          )}
        </motion.div>
      </div>

      {/* 会话列表 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        onScroll={shouldVirtualize ? updateVisibleRange : undefined}
      >
        {showListSkeleton && !searchText ? (
          <ChatListSkeleton />
        ) : (
          <>
            {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} aria-hidden="true" />}
            <AnimatePresence initial={false}>
              {visibleChats.map((chat, index) => {
                const isSwiped = swipedChatId === chat.id;
                const entryDelay = shouldVirtualize ? 0 : Math.min(index, 8) * 0.02;

                return (
                  <motion.div
                    key={chat.id}
                    initial={shouldVirtualize ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldVirtualize ? undefined : { opacity: 0, x: -20 }}
                    transition={{ delay: entryDelay, duration: 0.2 }}
                    className="relative overflow-hidden"
                    style={shouldVirtualize ? { minHeight: CHAT_ITEM_HEIGHT } : undefined}
                  >
                    {/* 滑动操作按钮（背景层） */}
                    <AnimatePresence>
                      {isSwiped && !isFixedOfficialChat(chat) && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-y-0 right-0 flex items-center z-10"
                        >
                          <button
                            onClick={() => handleSwipeAction(chat.id, 'pin')}
                            className="h-full px-5 bg-dove-bamboo/80 flex flex-col items-center justify-center gap-0.5"
                          >
                            <Pin size={15} className="text-white" />
                            <span className="text-[10px] text-white">{chat.isPinned ? '取消' : '置顶'}</span>
                          </button>
                          <button
                            onClick={() => handleSwipeAction(chat.id, 'delete')}
                            className="h-full px-5 bg-red-500/80 flex flex-col items-center justify-center gap-0.5"
                          >
                            <X size={15} className="text-white" />
                            <span className="text-[10px] text-white">删除</span>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* 会话卡片 */}
                    <motion.div
                      animate={{ x: isSwiped ? -120 : 0 }}
                      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                      className={`dove-list-item cursor-pointer relative z-20 ${(chat.isPinned && !isFixedOfficialChat(chat)) ? 'bg-dove-warm-gray/60' : 'bg-background'}`}
                      onClick={() => {
                        if (isSwiped) { setSwipedChatId(null); return; }
                        openChat(chat.id);
                      }}
                      onTouchStart={(e) => {
                        if (isFixedOfficialChat(chat)) return;
                        const startX = e.touches[0].clientX;
                        const handleMove = (me: TouchEvent) => {
                          const dx = me.touches[0].clientX - startX;
                          if (dx < -40) setSwipedChatId(chat.id);
                          else if (dx > 20) setSwipedChatId(null);
                        };
                        document.addEventListener('touchmove', handleMove, { passive: true });
                        document.addEventListener('touchend', () => {
                          document.removeEventListener('touchmove', handleMove);
                        }, { once: true });
                      }}
                    >
                      {/* 头像 */}
                      <div className="relative flex-shrink-0">
                        <DoveAvatar
                          name={chat.name}
                          id={chat.id}
                          avatar={chat.avatar || ''}
                          size="md"
                          isGroup={chat.type === 'group'}
                        />
                        {chat.type === 'private' && (() => {
                          // 获取私聊对方的 userId
                          const currentUserId = state.currentUser?.id || localStorage.getItem('user_id') || 'me';
                          const peerId = chat.members?.find(m => m !== currentUserId && m !== 'me');
                          const isOnline = peerId ? state.onlineUsers.has(peerId) : false;
                          return (
                            <div className={`status-dot absolute -bottom-0.5 -right-0.5 ${
                              isOnline ? 'status-dot-online' : 'status-dot-offline'
                            }`} />
                          );
                        })()}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-medium text-foreground truncate">{chat.name}</span>
                            {chat.type === 'group' && (
                              <MessageCircle
                                size={14}
                                strokeWidth={1.9}
                                className="flex-shrink-0"
                                style={{ color: '#1485ee', fill: 'none' }}
                              />
                            )}
                            {chat.isOfficial && <GoldVerifiedBadge size={13} className="flex-shrink-0" />}
                            {chat.isEncrypted && <Lock size={11} className="text-dove-bamboo/60 flex-shrink-0" />}
                            {chat.isMuted && <VolumeX size={11} className="text-muted-foreground/40 flex-shrink-0" />}
                            {chat.isPinned && !isFixedOfficialChat(chat) && <Pin size={10} className="text-dove-bamboo/50 flex-shrink-0" />}
                          </div>
                          <span className="text-[11px] text-muted-foreground/50 flex-shrink-0 ml-2">
                            {formatTime(chat.lastMessageTime || 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-[12px] text-muted-foreground truncate flex-1">
                            {chat.lastMessage || ''}
                          </p>
                          {chat.unreadCount > 0 && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className={`dove-badge ml-2 flex-shrink-0 ${chat.isMuted ? 'bg-muted-foreground/20 text-muted-foreground' : ''}`}
                            >
                              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                            </motion.span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />}

            {sortedChats.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search size={32} className="mb-3 opacity-20" />
                <p className="text-sm opacity-50">没有找到相关会话</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* 新建会话弹窗 */}
      <AnimatePresence>
        {showNewChat && (
          <NewChatSheet
            onClose={() => setShowNewChat(false)}
            onSelectUser={handleSelectUser}
          />
        )}
      </AnimatePresence>

      {/* 我的二维码弹窗 */}
      {showQRCode && currentUser && (
        <QRCodeModal
          userId={currentUser.id}
          nickname={currentUser.nickname || currentUser.name || '用户'}
          avatar={currentUser.avatar}
          onClose={() => setShowQRCode(false)}
        />
      )}

      {/* 扫一扫弹窗 */}
      {showScanner && (
        <ScannerModal
          onClose={() => setShowScanner(false)}
          onScanResult={handleScanResult}
        />
      )}

      {/* 添加朋友弹窗 */}
      {showAddFriend && (
        <AddFriendModal
          onClose={() => { setShowAddFriend(false); setScannedUserId(undefined); }}
          prefillUserId={scannedUserId}
        />
      )}

      {/* 发起群聊弹窗 */}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onGroupCreated={(groupId, groupName) => {
            const chatId = `group_${groupId}`;
            upsertChat({
              id: chatId,
              groupId,
              type: 'group',
              name: groupName,
              avatar: '',
              lastMessage: '',
              lastMessageTime: Date.now(),
              unreadCount: 0,
              isPinned: false,
              isMuted: false,
              isEncrypted: true,
              members: [],
            });
            openChat(chatId);
            toast.success(`群聊「${groupName}」创建成功`);
          }}
        />
      )}
    </div>
  );
}
