/**
 * 邀请好友入群弹窗
 * 从好友列表中多选成员，批量邀请加入群聊
 * 微信风格全屏弹窗设计
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Check, Users, Loader2, ChevronLeft, UserPlus } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { toast } from 'sonner';
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

interface InviteMembersModalProps {
  groupId: string;
  currentUserId: string;
  /** 当前群成员ID列表，用于过滤已在群中的好友 */
  existingMemberIds: string[];
  onClose: () => void;
  onInvited?: (addedCount: number) => void;
}

export const InviteMembersModal: React.FC<InviteMembersModalProps> = ({
  groupId,
  currentUserId,
  existingMemberIds,
  onClose,
  onInvited,
}) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [inviting, setInviting] = useState(false);

  const existingSet = useMemo(() => new Set(existingMemberIds), [existingMemberIds]);

  // 加载好友列表
  const loadFriends = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  // 过滤：搜索 + 排除已在群中的好友
  const filtered = useMemo(() => {
    return friends.filter(u => {
      // 搜索过滤
      if (search) {
        const keyword = search.toLowerCase();
        if (!u.name.toLowerCase().includes(keyword) &&
            !u.uniqueId.toLowerCase().includes(keyword)) {
          return false;
        }
      }
      return true;
    });
  }, [search, friends]);

  // 按字母分组
  const grouped = useMemo(() => {
    const groups: Record<string, Friend[]> = {};
    for (const f of filtered) {
      const letter = f.letter || '#';
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(f);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const toggle = (id: string) => {
    // 不允许选择已在群中的好友
    if (existingSet.has(id)) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedUsers = friends.filter(u => selected.has(u.id));

  // 执行邀请
  const handleInvite = async () => {
    if (selected.size === 0) {
      toast.error('请至少选择一位好友');
      return;
    }
    setInviting(true);
    try {
      const res = await fetch('/api/group/invite-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          inviterId: currentUserId,
          memberIds: Array.from(selected),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '邀请失败');

      const invited = data.invited || 0;
      const alreadyPending = data.alreadyPending || 0;
      const alreadyMembers = data.alreadyMembers || 0;

      if (invited > 0) {
        toast.success(`已向 ${invited} 位好友发送群聊邀请，等待对方确认`);
      }
      if (alreadyPending > 0) {
        toast.info(`${alreadyPending} 位好友已有待处理的邀请`);
      }
      if (alreadyMembers > 0 && invited === 0 && alreadyPending === 0) {
        toast('所选好友已全部在群中');
      } else if (alreadyMembers > 0) {
        toast(`其中 ${alreadyMembers} 位好友已在群中`);
      }

      onInvited?.(invited);
      onClose();
    } catch (err: any) {
      toast.error(err.message || '邀请好友失败，请重试');
    } finally {
      setInviting(false);
    }
  };

  const content = (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0, 0.67, 0] }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 210,
        background: '#f2f2f7',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        width: '100%',
        maxWidth: '100vw',
      }}
    >
      {/* 顶部导航栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: '#f2f2f7',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', gap: 2,
            color: '#007AFF', fontSize: 14, fontWeight: 500,
            background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <ChevronLeft size={20} />
          取消
        </button>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#1c1c1e' }}>
          邀请好友入群
        </span>
        <button
          onClick={handleInvite}
          disabled={selected.size === 0 || inviting}
          style={{
            fontSize: 14, fontWeight: 600,
            color: selected.size > 0 ? '#007AFF' : '#c7c7cc',
            background: 'none', border: 'none', cursor: selected.size > 0 ? 'pointer' : 'default',
            opacity: inviting ? 0.5 : 1,
            minWidth: 60,
            textAlign: 'right',
          }}
        >
          {inviting ? '邀请中...' : selected.size > 0 ? `邀请(${selected.size})` : '邀请'}
        </button>
      </div>

      {/* 已选成员预览 */}
      {selected.size > 0 && (
        <div style={{
          padding: '10px 16px',
          background: '#fff',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          flexShrink: 0,
        }}>
          {selectedUsers.map(u => (
            <div key={u.id} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0,
            }}>
              <div style={{ position: 'relative' }}>
                <DoveAvatar name={u.name} avatar={u.avatar} size={40} />
                <button
                  onClick={() => toggle(u.id)}
                  style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 18, height: 18, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.5)', border: '2px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', padding: 0,
                  }}
                >
                  <X size={10} color="#fff" />
                </button>
              </div>
              <span style={{
                fontSize: 10, color: '#8e8e93',
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', width: 44, textAlign: 'center',
              }}>
                {u.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 搜索框 */}
      <div style={{
        padding: '8px 16px',
        background: '#f2f2f7',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#e5e5ea', borderRadius: 10,
          padding: '8px 12px',
        }}>
          <Search size={15} color="#8e8e93" style={{ flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索联系人"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 14, color: '#1c1c1e',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              <X size={15} color="#8e8e93" />
            </button>
          )}
        </div>
      </div>

      {/* 联系人列表 */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch' as any,
      }}>
        {friendsLoading ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 200, gap: 8,
          }}>
            <Loader2 size={24} color="#c7c7cc" className="animate-spin" />
            <span style={{ fontSize: 14, color: '#8e8e93' }}>加载联系人...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 200, gap: 8,
          }}>
            <Users size={32} color="#e5e5ea" />
            <span style={{ fontSize: 14, color: '#8e8e93' }}>
              {friends.length === 0 ? '暂无好友' : '未找到匹配的联系人'}
            </span>
          </div>
        ) : (
          <div style={{ background: '#fff' }}>
            {grouped.map(([letter, groupFriends]) => (
              <div key={letter}>
                {/* 字母索引 */}
                <div style={{
                  padding: '4px 16px',
                  fontSize: 12, fontWeight: 600, color: '#8e8e93',
                  background: '#f2f2f7',
                  position: 'sticky', top: 0, zIndex: 1,
                }}>
                  {letter}
                </div>
                {groupFriends.map(user => {
                  const isInGroup = existingSet.has(user.id);
                  const isSelected = selected.has(user.id);
                  return (
                    <div
                      key={user.id}
                      onClick={() => toggle(user.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 16px',
                        cursor: isInGroup ? 'default' : 'pointer',
                        borderBottom: '1px solid rgba(0,0,0,0.04)',
                        opacity: isInGroup ? 0.5 : 1,
                      }}
                    >
                      {/* 选择框 */}
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%',
                        border: `2px solid ${isInGroup ? '#c7c7cc' : isSelected ? '#34c759' : '#c7c7cc'}`,
                        background: isInGroup ? '#e5e5ea' : isSelected ? '#34c759' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                        transition: 'all 0.15s',
                      }}>
                        {(isSelected || isInGroup) && <Check size={12} color="#fff" />}
                      </div>

                      {/* 头像 */}
                      <DoveAvatar name={user.name} avatar={user.avatar} size={40} />

                      {/* 信息 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 15, fontWeight: 500, color: '#1c1c1e',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {user.name}
                        </div>
                        {isInGroup ? (
                          <div style={{ fontSize: 12, color: '#8e8e93' }}>已在群中</div>
                        ) : user.bio ? (
                          <div style={{
                            fontSize: 12, color: '#8e8e93',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {user.bio}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: '#8e8e93' }}>@{user.uniqueId}</div>
                        )}
                      </div>

                      {/* 在线状态 */}
                      {!isInGroup && user.status === 'online' && (
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: '#34c759', flexShrink: 0,
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部安全区域 */}
      <div style={{ height: 'env(safe-area-inset-bottom, 0px)', background: '#f2f2f7', flexShrink: 0 }} />
    </motion.div>
  );

  return ReactDOM.createPortal(content, document.body);
};

export default InviteMembersModal;
