/**
 * 频道详情页 — Telegram 风格单向广播频道
 *
 * 展示频道消息流，仅管理员可发布消息，订阅者只读。
 * 复用 ChatDetailPage 的消息渲染基础设施。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Hash, ArrowLeft, Send, Users, MoreVertical, Bell, BellOff, Share2, LogOut } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { authFetch } from '../lib/authFetch';
import { avatarToProxy } from '../lib/utils';

interface ChannelDetail {
  id: string;
  dialogId: string;
  name: string;
  username: string | null;
  avatar: string | null;
  type: string;
  isPublic: boolean;
  memberCount: number;
  announcement: string | null;
  lastMsgSeq: string;
  lastMsgTime: string | null;
  isSubscribed: boolean;
  memberRole: string | null;
  canPost: boolean;
  createdAt: string;
}

interface ChannelMessage {
  id: string;
  seq: number;
  senderId: string;
  senderName: string;
  msgType: string;
  content: string;
  replyToId: string | null;
  extra: string | null;
  isRevoked: boolean;
  createdAt: string;
}

export default function ChannelDetailPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [channel, setChannel] = useState<ChannelDetail | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 加载频道信息
  const loadChannel = useCallback(async () => {
    if (!channelId || !user?.id) return;
    try {
      const res = await authFetch(`/api/channel/info?channelId=${channelId}&userId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setChannel(data);
      } else if (res.status === 404) {
        navigate('/channels', { replace: true });
      }
    } catch (err) {
      console.error('[ChannelDetail] 加载频道信息失败:', err);
    }
  }, [channelId, user?.id, navigate]);

  // 加载频道消息
  const loadMessages = useCallback(async () => {
    if (!channelId || !user?.id) return;
    try {
      const res = await authFetch(
        `/api/channel/messages?channelId=${channelId}&userId=${user.id}&limit=50`
      );
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('[ChannelDetail] 加载消息失败:', err);
    } finally {
      setLoading(false);
    }
  }, [channelId, user?.id]);

  useEffect(() => {
    loadChannel();
    loadMessages();
  }, [loadChannel, loadMessages]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
  const handleSend = async () => {
    if (!messageText.trim() || !channelId || !user?.id || sending) return;
    try {
      setSending(true);
      const res = await authFetch('/api/channel/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          senderId: user.id,
          senderName: user.nickname || user.username,
          content: messageText.trim(),
          msgType: 'text',
        }),
      });
      if (res.ok) {
        setMessageText('');
        // 重新加载消息
        setTimeout(loadMessages, 300);
      }
    } catch (err) {
      console.error('[ChannelDetail] 发送消息失败:', err);
    } finally {
      setSending(false);
    }
  };

  // 订阅频道
  const handleSubscribe = async () => {
    if (!channelId || !user?.id) return;
    try {
      const res = await authFetch('/api/channel/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, userId: user.id }),
      });
      if (res.ok) {
        loadChannel();
        loadMessages();
      }
    } catch (err) {
      console.error('[ChannelDetail] 订阅失败:', err);
    }
  };

  // 取消订阅
  const handleUnsubscribe = async () => {
    if (!channelId || !user?.id) return;
    if (!confirm('确定要取消订阅此频道吗？')) return;
    try {
      const res = await authFetch('/api/channel/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, userId: user.id }),
      });
      if (res.ok) {
        navigate('/channels', { replace: true });
      }
    } catch (err) {
      console.error('[ChannelDetail] 取消订阅失败:', err);
    }
  };

  // 键盘发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) +
      ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatMemberCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M 订阅者`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K 订阅者`;
    return `${count} 订阅者`;
  };

  const renderMessage = (msg: ChannelMessage) => {
    const isSystem = msg.msgType === 'system';

    if (isSystem) {
      return (
        <div key={msg.id} className="flex justify-center py-2">
          <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
            {msg.content}
          </span>
        </div>
      );
    }

    return (
      <div key={msg.id} className="flex gap-3 px-4 py-2 hover:bg-muted/30 transition-colors">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Hash className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium">{msg.senderName}</span>
            <span className="text-[10px] text-muted-foreground">
              {formatTime(msg.createdAt)}
            </span>
          </div>
          <div className="text-sm mt-0.5 whitespace-pre-wrap break-words">
            {msg.isRevoked ? (
              <span className="italic text-muted-foreground">此消息已被删除</span>
            ) : (
              msg.content
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading && !channel) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部栏 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button
          onClick={() => navigate('/channels')}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">
            {channel?.name || '加载中...'}
          </h1>
          {channel && (
            <p className="text-xs text-muted-foreground">
              {formatMemberCount(channel.memberCount)}
            </p>
          )}
        </div>

        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors relative"
        >
          <MoreVertical className="w-5 h-5" />
        </button>

        {/* 更多菜单 */}
        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-4 top-14 z-50 bg-background border border-border rounded-xl shadow-lg py-2 w-48">
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {channel?.username ? `@${channel.username}` : '频道'}
              </div>
              <div className="border-t border-border my-1" />
              <button
                onClick={() => {
                  setShowMenu(false);
                  navigator.clipboard.writeText(
                    channel?.username
                      ? `https://wed.imim.chat/im/${channel.username}`
                      : window.location.href
                  );
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <Share2 className="w-4 h-4" />
                复制链接
              </button>
              {channel?.memberRole === 'owner' && (
                <button
                  onClick={() => {
                    setShowMenu(false);
                    navigate(`/channel/${channelId}/subscribers`);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                >
                  <Users className="w-4 h-4" />
                  管理订阅者
                </button>
              )}
              {channel?.memberRole !== 'owner' && (
                <button
                  onClick={() => {
                    setShowMenu(false);
                    handleUnsubscribe();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  取消订阅
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* 频道公告 */}
      {channel?.announcement && (
        <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">简介：</span>
            {channel.announcement}
          </p>
        </div>
      )}

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto">
        {!channel?.isSubscribed ? (
          // 未订阅状态
          <div className="flex flex-col items-center justify-center h-full px-4">
            <Hash className="w-16 h-16 mb-4 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold mb-1">{channel?.name}</h2>
            <p className="text-sm text-muted-foreground mb-1">
              {channel ? formatMemberCount(channel.memberCount) : ''}
            </p>
            {channel?.announcement && (
              <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
                {channel.announcement}
              </p>
            )}
            <button
              onClick={handleSubscribe}
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              订阅频道
            </button>
          </div>
        ) : (
          // 消息列表
          <div className="pb-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Hash className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm">暂无消息</p>
                <p className="text-xs mt-1">频道创建者发布消息后将显示在这里</p>
              </div>
            ) : (
              messages.map(renderMessage)
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 底部输入栏 — 仅管理员可见 */}
      {channel?.isSubscribed && channel?.canPost && (
        <div className="p-3 border-t border-border">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="发布频道消息..."
              rows={1}
              className="flex-1 px-4 py-2.5 rounded-xl bg-muted text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none max-h-32"
            />
            <button
              onClick={handleSend}
              disabled={!messageText.trim() || sending}
              className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 底部提示 — 仅订阅者可见 */}
      {channel?.isSubscribed && !channel?.canPost && (
        <div className="p-3 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">仅频道管理员可发布消息</p>
        </div>
      )}
    </div>
  );
}
