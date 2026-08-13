/**
 * 频道列表页 — Telegram 风格
 *
 * 展示用户订阅的所有频道，支持：
 * - 订阅的频道列表（按最后消息时间排序）
 * - 搜索公开频道
 * - 创建新频道
 * - 频道未读标记
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Hash, Users, ChevronRight } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { authFetch } from '../lib/authFetch';
import { avatarToProxy } from '../lib/utils';

interface ChannelInfo {
  id: string;
  dialogId: string;
  name: string;
  username: string | null;
  avatar: string | null;
  type: string;
  isPublic: boolean;
  memberCount: number;
  announcement: string | null;
  myRole: string;
  lastMsgSeq: string;
  lastMsgTime: string | null;
  joinedAt: string;
}

interface ChannelSearchResult {
  id: string;
  dialogId: string;
  name: string;
  username: string | null;
  avatar: string | null;
  type: string;
  isPublic: boolean;
  memberCount: number;
  announcement: string | null;
}

export default function ChannelsPage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChannelSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // 加载订阅的频道
  const loadChannels = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const res = await authFetch(`/api/channel/my?userId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels || []);
      }
    } catch (err) {
      console.error('[ChannelsPage] 加载频道列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // 搜索公开频道
  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    try {
      setSearching(true);
      const res = await authFetch(`/api/channel/search?q=${encodeURIComponent(q.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.channels || []);
      }
    } catch (err) {
      console.error('[ChannelsPage] 搜索频道失败:', err);
    } finally {
      setSearching(false);
    }
  }, []);

  // 订阅频道
  const handleSubscribe = async (channelId: string) => {
    if (!user?.id) return;
    try {
      const res = await authFetch('/api/channel/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, userId: user.id }),
      });
      if (res.ok) {
        loadChannels();
      }
    } catch (err) {
      console.error('[ChannelsPage] 订阅频道失败:', err);
    }
  };

  // 创建频道
  const handleCreate = async () => {
    if (!user?.id || !createName.trim()) return;
    try {
      setCreating(true);
      setCreateError('');
      const res = await authFetch('/api/channel/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          ownerId: user.id,
          username: createUsername.trim() || undefined,
          description: createDescription.trim() || undefined,
          isPublic: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setShowCreateModal(false);
        setCreateName('');
        setCreateUsername('');
        setCreateDescription('');
        loadChannels();
        navigate(`/channel/${data.channel.id}`);
      } else {
        setCreateError(data.error || '创建失败');
      }
    } catch (err: any) {
      setCreateError(err.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const formatMemberCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">请先登录</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">频道</h1>
        <p className="text-sm text-muted-foreground mt-1">订阅你感兴趣的频道，获取最新广播</p>
      </div>

      {/* 搜索栏 */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索公开频道..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-muted text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {searchQuery.trim() ? (
          // 搜索结果
          <div className="px-4">
            {searching ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Hash className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">未找到相关频道</p>
                <p className="text-xs mt-1">尝试其他关键词</p>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {searchResults.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => navigate(`/channel/${ch.id}`)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {ch.avatar ? (
                        <img src={avatarToProxy(ch.avatar)} alt={ch.name} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <Hash className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ch.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ch.username ? `@${ch.username}` : ''}
                        {ch.memberCount > 0 && (
                          <span className="ml-2">
                            <Users className="w-3 h-3 inline mr-0.5" />
                            {formatMemberCount(ch.memberCount)} 订阅者
                          </span>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          // 我的频道列表
          <div className="px-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : channels.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Hash className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-base font-medium mb-1">你还没有订阅任何频道</p>
                <p className="text-sm mb-4">搜索并订阅感兴趣的频道，获取最新广播</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  创建频道
                </button>
              </div>
            ) : (
              <div className="space-y-1 pb-4">
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => navigate(`/channel/${ch.id}`)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {ch.avatar ? (
                        <img src={avatarToProxy(ch.avatar)} alt={ch.name} className="w-12 h-12 rounded-full object-cover" />
                      ) : (
                        <Hash className="w-6 h-6 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{ch.name}</p>
                        {ch.myRole === 'owner' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            所有者
                          </span>
                        )}
                        {ch.myRole === 'admin' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            管理员
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatMemberCount(ch.memberCount)} 订阅者
                        {ch.lastMsgTime && (
                          <span className="ml-2">{formatTime(ch.lastMsgTime)}</span>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 创建频道按钮 */}
      <div className="p-4 border-t border-border">
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          创建频道
        </button>
      </div>

      {/* 创建频道弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">创建频道</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    频道名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="输入频道名称"
                    maxLength={30}
                    className="w-full px-3 py-2 rounded-lg bg-muted text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    频道 ID（可选）
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                    <input
                      type="text"
                      value={createUsername}
                      onChange={(e) => setCreateUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="channel_name"
                      maxLength={32}
                      className="w-full pl-7 pr-3 py-2 rounded-lg bg-muted text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    5-32位字母数字下划线，设置后可生成公开链接
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    频道简介（可选）
                  </label>
                  <textarea
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="描述你的频道内容..."
                    maxLength={200}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-muted text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                  />
                </div>
              </div>

              {createError && (
                <p className="text-sm text-red-500 mt-4">{createError}</p>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError('');
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!createName.trim() || creating}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
