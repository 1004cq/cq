/**
 * 群设置弹窗 — 修改群名称、群ID（username）、群头像、群公告、成员管理、退出群聊
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Camera, Check, Loader2, Users, Pencil, Link2, AtSign,
  LogOut, ShieldCheck, ShieldOff, Crown, Ban, UserMinus, Megaphone,
  ChevronRight, Trash2, Copy, Plus, QrCode
} from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { GroupQRCodePage } from '@/components/GroupQRCodePage';
import { toast } from 'sonner';

interface GroupInfo {
  id: string;
  name: string;
  avatar?: string;
  username?: string | null;
  isPublic?: boolean;
  memberCount?: number;
  type?: string;
  ownerId?: string;
  announcement?: string | null;
}

interface MemberInfo {
  id: string;
  userId: string;
  role: string;
  nickname?: string;
  name?: string;
  avatar?: string;
  muteUntil?: string | null;
}

interface InviteLinkInfo {
  id: string;
  hash: string;
  url: string;
  fullUrl: string;
  name?: string | null;
  creatorId: string;
  expireAt?: string | null;
  maxUses: number;
  usedCount: number;
  remainingUses?: number | null;
  isExpired: boolean;
  createdAt: string;
}

interface GroupSettingsModalProps {
  groupId: string;
  currentUserId: string;
  currentGroupName: string;
  currentGroupAvatar?: string;
  onClose: () => void;
  onUpdated?: (updated: { name?: string; avatar?: string; username?: string | null }) => void;
  onLeaveGroup?: () => void;
}

type SubPage = 'main' | 'members' | 'announcement' | 'memberAction' | 'inviteLinks';

export const GroupSettingsModal: React.FC<GroupSettingsModalProps> = ({
  groupId,
  currentUserId,
  currentGroupName,
  currentGroupAvatar,
  onClose,
  onUpdated,
  onLeaveGroup,
}) => {
  // 群信息状态
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [subPage, setSubPage] = useState<SubPage>('main');

  // 编辑状态
  const [editingName, setEditingName] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [name, setName] = useState(currentGroupName);
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);

  // 群公告
  const [announcement, setAnnouncement] = useState('');
  const [editingAnnouncement, setEditingAnnouncement] = useState(false);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);

  // 成员列表
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberInfo | null>(null);

  // 头像上传
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 权限
  const [myRole, setMyRole] = useState<string>('member');

  // 操作中
  const [operating, setOperating] = useState(false);

  // 邀请链接管理
  const [inviteLinks, setInviteLinks] = useState<InviteLinkInfo[]>([]);
  const [loadingInviteLinks, setLoadingInviteLinks] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteExpireMode, setInviteExpireMode] = useState<'permanent' | '1h' | '1d' | '1w' | 'datetime'>('permanent');
  const [inviteExpireAtInput, setInviteExpireAtInput] = useState('');
  const [inviteUseMode, setInviteUseMode] = useState<'unlimited' | '1' | '10' | '100' | 'custom'>('unlimited');
  const [inviteCustomMaxUses, setInviteCustomMaxUses] = useState('');
  const [qrInvite, setQrInvite] = useState<InviteLinkInfo | null>(null);

  // 加载群信息
  useEffect(() => {
    const fetchGroupInfo = async () => {
      try {
        const res = await fetch(`/api/group/info?groupId=${encodeURIComponent(groupId)}`);
        if (!res.ok) throw new Error('获取群信息失败');
        const data = await res.json();
        setGroupInfo(data);
        setName(data.name || currentGroupName);
        setUsername(data.username || '');
        setAnnouncement(data.announcement || '');

        // 获取我的角色
        const membersRes = await fetch(`/api/group/members?groupId=${encodeURIComponent(groupId)}`);
        if (membersRes.ok) {
          const membersData = await membersRes.json();
          const me = membersData.members?.find((m: any) => m.userId === currentUserId);
          if (me) setMyRole(me.role);
        }
      } catch (err) {
        console.error('加载群信息失败:', err);
        toast.error('加载群信息失败');
      } finally {
        setLoading(false);
      }
    };
    fetchGroupInfo();
  }, [groupId, currentUserId, currentGroupName]);

  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'admin' || isOwner;
  const currentAvatar = avatarPreview || groupInfo?.avatar || currentGroupAvatar;

  // 加载成员列表
  const fetchMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/group/members?groupId=${encodeURIComponent(groupId)}`);
      if (!res.ok) throw new Error('获取成员列表失败');
      const data = await res.json();
      setMembers(data.members || []);
    } catch (err) {
      toast.error('加载成员列表失败');
    } finally {
      setLoadingMembers(false);
    }
  }, [groupId]);

  const fetchInviteLinks = useCallback(async () => {
    setLoadingInviteLinks(true);
    try {
      const res = await fetch(`/api/group/invite/list?groupId=${encodeURIComponent(groupId)}`);
      if (!res.ok) throw new Error('获取邀请链接失败');
      const data = await res.json();
      setInviteLinks(Array.isArray(data.links) ? data.links : []);
    } catch (err: any) {
      toast.error(err.message || '加载邀请链接失败');
    } finally {
      setLoadingInviteLinks(false);
    }
  }, [groupId]);

  const handleCreateInvite = useCallback(async () => {
    if (!isAdmin) {
      toast.error('仅管理员和群主可创建邀请链接');
      return;
    }

    let maxUses = 0;
    if (inviteUseMode === 'custom') {
      maxUses = Number(inviteCustomMaxUses);
      if (!Number.isInteger(maxUses) || maxUses <= 0) {
        toast.error('请输入有效的使用次数');
        return;
      }
    } else if (inviteUseMode !== 'unlimited') {
      maxUses = Number(inviteUseMode);
    }

    let expireHours: number | undefined;
    let expireAt: string | undefined;
    if (inviteExpireMode === '1h') expireHours = 1;
    if (inviteExpireMode === '1d') expireHours = 24;
    if (inviteExpireMode === '1w') expireHours = 24 * 7;
    if (inviteExpireMode === 'datetime') {
      if (!inviteExpireAtInput) {
        toast.error('请选择具体失效时间');
        return;
      }
      const date = new Date(inviteExpireAtInput);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        toast.error('失效时间必须晚于当前时间');
        return;
      }
      expireAt = date.toISOString();
    }

    setCreatingInvite(true);
    try {
      const res = await fetch('/api/group/invite/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          creatorId: currentUserId,
          name: inviteName.trim() || null,
          expireHours,
          expireAt,
          maxUses,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建邀请链接失败');
      toast.success('邀请链接已创建');
      setInviteName('');
      setInviteExpireMode('permanent');
      setInviteExpireAtInput('');
      setInviteUseMode('unlimited');
      setInviteCustomMaxUses('');
      await fetchInviteLinks();
      if (data.inviteLink) {
        setQrInvite(data.inviteLink);
      }
    } catch (err: any) {
      toast.error(err.message || '创建邀请链接失败');
    } finally {
      setCreatingInvite(false);
    }
  }, [currentUserId, fetchInviteLinks, groupId, inviteCustomMaxUses, inviteExpireAtInput, inviteExpireMode, inviteName, inviteUseMode, isAdmin]);

  const handleCopyInviteLink = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('邀请链接已复制');
    } catch {
      toast.error('复制失败');
    }
  }, []);

  const handleRevokeInvite = useCallback(async (hash: string) => {
    if (!confirm('确定要撤销这个邀请链接吗？')) return;
    try {
      const res = await fetch('/api/group/invite/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash, creatorId: currentUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '撤销失败');
      toast.success('邀请链接已撤销');
      await fetchInviteLinks();
    } catch (err: any) {
      toast.error(err.message || '撤销邀请链接失败');
    }
  }, [currentUserId, fetchInviteLinks]);

  // 保存群名称
  const handleSaveName = useCallback(async () => {
    if (!name.trim()) { toast.error('群名称不能为空'); return; }
    if (name.trim() === (groupInfo?.name || currentGroupName)) { setEditingName(false); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/group/update/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, userId: currentUserId, name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '修改失败');
      toast.success('群名称已更新');
      setGroupInfo(prev => prev ? { ...prev, name: data.name } : prev);
      setEditingName(false);
      onUpdated?.({ name: data.name });
    } catch (err: any) {
      toast.error(err.message || '修改群名称失败');
    } finally {
      setSaving(false);
    }
  }, [name, groupId, currentUserId, groupInfo, currentGroupName, onUpdated]);

  // 保存群 ID (username)
  const handleSaveUsername = useCallback(async () => {
    if (username && !/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) {
      toast.error('群 ID 必须以字母开头，5-32位字母数字下划线');
      return;
    }
    if (username === (groupInfo?.username || '')) { setEditingUsername(false); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/group/update/username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, userId: currentUserId, username: username || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '修改失败');
      toast.success(username ? `群 ID 已设置为 @${username}` : '群 ID 已清除');
      setGroupInfo(prev => prev ? { ...prev, username: data.username, isPublic: !!data.username } : prev);
      setEditingUsername(false);
      onUpdated?.({ username: data.username });
    } catch (err: any) {
      toast.error(err.message || '修改群 ID 失败');
    } finally {
      setSaving(false);
    }
  }, [username, groupId, currentUserId, groupInfo, onUpdated]);

  // 选择头像文件
  const handleAvatarSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) { toast.error('仅支持 JPG、PNG、GIF、WebP 格式'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('头像文件不能超过 5MB'); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setAvatarPreview(dataUrl);
      setUploadingAvatar(true);
      try {
        const base64 = dataUrl.split(',')[1];
        const res = await fetch('/api/group/update/avatar', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, userId: currentUserId, dataBase64: base64, mimeType: file.type }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '上传失败');
        toast.success('群头像已更新');
        setGroupInfo(prev => prev ? { ...prev, avatar: data.avatar } : prev);
        onUpdated?.({ avatar: data.avatar });
      } catch (err: any) {
        toast.error(err.message || '上传群头像失败');
        setAvatarPreview(null);
      } finally {
        setUploadingAvatar(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [groupId, currentUserId, onUpdated]);

  // 保存群公告
  const handleSaveAnnouncement = useCallback(async () => {
    setSavingAnnouncement(true);
    try {
      const res = await fetch('/api/group/announcement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, userId: currentUserId, announcement: announcement.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '设置失败');
      toast.success(announcement.trim() ? '群公告已更新' : '群公告已清除');
      setGroupInfo(prev => prev ? { ...prev, announcement: data.announcement } : prev);
      setEditingAnnouncement(false);
    } catch (err: any) {
      toast.error(err.message || '设置群公告失败');
    } finally {
      setSavingAnnouncement(false);
    }
  }, [groupId, currentUserId, announcement]);

  // 退出群聊
  const handleLeaveGroup = useCallback(async () => {
    if (!confirm('确定要退出该群聊吗？')) return;
    setOperating(true);
    try {
      const res = await fetch('/api/group/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, userId: currentUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '退出失败');
      toast.success('已退出群聊');
      onLeaveGroup?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || '退出群聊失败');
    } finally {
      setOperating(false);
    }
  }, [groupId, currentUserId, onClose, onLeaveGroup]);

  // 解散群聊
  const handleDissolveGroup = useCallback(async () => {
    if (!confirm('确定要解散该群聊吗？此操作不可撤销！')) return;
    setOperating(true);
    try {
      const res = await fetch('/api/group/dissolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, ownerId: currentUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '解散失败');
      toast.success('群聊已解散');
      onLeaveGroup?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || '解散群聊失败');
    } finally {
      setOperating(false);
    }
  }, [groupId, currentUserId, onClose, onLeaveGroup]);

  // 踢出成员
  const handleKickMember = useCallback(async (targetUserId: string) => {
    if (!confirm('确定要将该成员移出群聊吗？')) return;
    setOperating(true);
    try {
      const res = await fetch('/api/group/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, operatorId: currentUserId, targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      toast.success('已将成员移出群聊');
      setMembers(prev => prev.filter(m => m.userId !== targetUserId));
      setSelectedMember(null);
      setSubPage('members');
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    } finally {
      setOperating(false);
    }
  }, [groupId, currentUserId]);

  // 设置/取消管理员
  const handleToggleAdmin = useCallback(async (targetUserId: string, isCurrentlyAdmin: boolean) => {
    setOperating(true);
    try {
      const res = await fetch('/api/group/admin/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, ownerId: currentUserId, targetUserId, isAdmin: !isCurrentlyAdmin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      toast.success(isCurrentlyAdmin ? '已取消管理员' : '已设为管理员');
      setMembers(prev => prev.map(m =>
        m.userId === targetUserId ? { ...m, role: data.role } : m
      ));
      setSelectedMember(prev => prev ? { ...prev, role: data.role } : null);
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    } finally {
      setOperating(false);
    }
  }, [groupId, currentUserId]);

  // 转让群主
  const handleTransferOwner = useCallback(async (newOwnerId: string) => {
    if (!confirm('确定要将群主转让给该成员吗？转让后你将变为管理员。')) return;
    setOperating(true);
    try {
      const res = await fetch('/api/group/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, ownerId: currentUserId, newOwnerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      toast.success('群主已转让');
      setMyRole('admin');
      setSelectedMember(null);
      setSubPage('members');
      fetchMembers();
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    } finally {
      setOperating(false);
    }
  }, [groupId, currentUserId, fetchMembers]);

  // 禁言
  const handleMute = useCallback(async (targetUserId: string, duration: number) => {
    setOperating(true);
    try {
      const res = await fetch('/api/group/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, operatorId: currentUserId, targetUserId, duration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      toast.success(duration === 0 ? '已解除禁言' : '已禁言');
      setMembers(prev => prev.map(m =>
        m.userId === targetUserId ? { ...m, muteUntil: data.muteUntil } : m
      ));
      setSelectedMember(prev => prev ? { ...prev, muteUntil: data.muteUntil } : null);
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    } finally {
      setOperating(false);
    }
  }, [groupId, currentUserId]);

  // ============ 渲染子页面 ============

  const renderMemberAction = () => {
    if (!selectedMember) return null;
    const m = selectedMember;
    const isMuted = m.muteUntil && new Date(m.muteUntil) > new Date();

    return (
      <div className="flex-1 overflow-y-auto pb-safe">
        {/* 成员信息 */}
        <div className="flex flex-col items-center py-6">
          <DoveAvatar name={m.name || m.userId} avatar={m.avatar} size={64} />
          <p className="mt-2 text-base font-semibold text-gray-900 dark:text-gray-100">{m.name || m.userId}</p>
          <p className="text-xs text-gray-400">
            {m.role === 'owner' ? '群主' : m.role === 'admin' ? '管理员' : '成员'}
          </p>
          {isMuted && (
            <p className="text-xs text-red-500 mt-1">
              禁言至 {new Date(m.muteUntil!).toLocaleString()}
            </p>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="px-5 space-y-2">
          {/* 群主才能操作 */}
          {isOwner && m.role !== 'owner' && (
            <>
              {/* 设置/取消管理员 */}
              <button
                onClick={() => handleToggleAdmin(m.userId, m.role === 'admin')}
                disabled={operating}
                className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
              >
                {m.role === 'admin' ? (
                  <ShieldOff size={18} className="text-amber-500" />
                ) : (
                  <ShieldCheck size={18} className="text-emerald-500" />
                )}
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  {m.role === 'admin' ? '取消管理员' : '设为管理员'}
                </span>
              </button>

              {/* 转让群主 */}
              <button
                onClick={() => handleTransferOwner(m.userId)}
                disabled={operating}
                className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
              >
                <Crown size={18} className="text-yellow-500" />
                <span className="text-sm text-gray-900 dark:text-gray-100">转让群主</span>
              </button>
            </>
          )}

          {/* 管理员及以上可以禁言和踢人 */}
          {isAdmin && m.role !== 'owner' && !(m.role === 'admin' && !isOwner) && (
            <>
              {/* 禁言 */}
              {isMuted ? (
                <button
                  onClick={() => handleMute(m.userId, 0)}
                  disabled={operating}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <Ban size={18} className="text-green-500" />
                  <span className="text-sm text-gray-900 dark:text-gray-100">解除禁言</span>
                </button>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden">
                  <p className="px-4 pt-3 text-xs text-gray-400 font-medium">禁言</p>
                  <div className="flex gap-2 px-4 py-3">
                    {[
                      { label: '10分钟', value: 600 },
                      { label: '1小时', value: 3600 },
                      { label: '1天', value: 86400 },
                      { label: '7天', value: 604800 },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => handleMute(m.userId, opt.value)}
                        disabled={operating}
                        className="flex-1 py-2 text-xs font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 踢出 */}
              <button
                onClick={() => handleKickMember(m.userId)}
                disabled={operating}
                className="w-full flex items-center gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              >
                <UserMinus size={18} className="text-red-500" />
                <span className="text-sm text-red-600 dark:text-red-400">移出群聊</span>
              </button>
            </>
          )}

          {m.role === 'owner' && (
            <div className="text-center py-4">
              <p className="text-xs text-gray-400">群主无法被操作</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMembers = () => (
    <div className="flex-1 overflow-y-auto pb-safe">
      {loadingMembers ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={28} className="text-gray-300 animate-spin" />
          <p className="text-sm text-gray-400">加载成员列表...</p>
        </div>
      ) : (
        <div className="px-4 space-y-1">
          {members.map(m => {
            const isMuted = m.muteUntil && new Date(m.muteUntil) > new Date();
            return (
              <button
                key={m.userId}
                onClick={() => {
                  if (m.userId !== currentUserId && isAdmin) {
                    setSelectedMember(m);
                    setSubPage('memberAction');
                  }
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <DoveAvatar name={m.name || m.userId} avatar={m.avatar} size={40} />
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {m.name || m.nickname || m.userId}
                    </span>
                    {m.role === 'owner' && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded">群主</span>
                    )}
                    {m.role === 'admin' && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">管理员</span>
                    )}
                    {m.userId === currentUserId && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded">我</span>
                    )}
                  </div>
                  {isMuted && (
                    <p className="text-[10px] text-red-400">禁言中</p>
                  )}
                </div>
                {m.userId !== currentUserId && isAdmin && (
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderAnnouncement = () => (
    <div className="flex-1 overflow-y-auto pb-safe px-5 py-4">
      {editingAnnouncement ? (
        <div className="space-y-3">
          <textarea
            value={announcement}
            onChange={e => setAnnouncement(e.target.value)}
            maxLength={500}
            rows={6}
            autoFocus
            placeholder="输入群公告内容..."
            className="w-full bg-gray-50 dark:bg-gray-800 rounded-2xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none border border-gray-200 dark:border-gray-700 focus:border-emerald-400 transition-colors resize-none"
          />
          <p className="text-[10px] text-gray-400 text-right">{announcement.length}/500</p>
          <div className="flex gap-2">
            <button
              onClick={handleSaveAnnouncement}
              disabled={savingAnnouncement}
              className="flex-1 py-2.5 bg-emerald-500 text-white text-sm font-medium rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              {savingAnnouncement ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => { setEditingAnnouncement(false); setAnnouncement(groupInfo?.announcement || ''); }}
              className="px-6 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div>
          {groupInfo?.announcement ? (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl px-4 py-3">
              <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{groupInfo.announcement}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Megaphone size={32} className="text-gray-200" />
              <p className="text-sm text-gray-400">暂无群公告</p>
            </div>
          )}
          {isAdmin && (
            <button
              onClick={() => setEditingAnnouncement(true)}
              className="mt-4 w-full py-2.5 bg-emerald-500 text-white text-sm font-medium rounded-xl hover:bg-emerald-600 transition-colors"
            >
              {groupInfo?.announcement ? '编辑公告' : '发布公告'}
            </button>
          )}
        </div>
      )}
    </div>
  );

  const renderInviteLinks = () => {
    const customInviteLinks = inviteLinks.filter(link => link.name !== 'group_qrcode');
    const formatDateTime = (value?: string | null) => {
      if (!value) return '长期有效';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '长期有效';
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    };

    return (
      <div className="flex-1 overflow-y-auto pb-safe px-5 py-4 space-y-4">
        {isAdmin && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Plus size={16} className="text-emerald-500" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">创建新链接</p>
                <p className="text-[11px] text-gray-400">支持 1 小时、1 天、1 周、具体时间和使用次数限制</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">链接名称</p>
              <input
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                maxLength={30}
                placeholder="例如：活动海报 / 运营推广"
                className="w-full bg-white dark:bg-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none border border-gray-200 dark:border-gray-600 focus:border-emerald-400 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">失效时间</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'permanent', label: '长期' },
                  { key: '1h', label: '1小时' },
                  { key: '1d', label: '1天' },
                  { key: '1w', label: '1周' },
                  { key: 'datetime', label: '具体时间' },
                ].map(option => (
                  <button
                    key={option.key}
                    onClick={() => setInviteExpireMode(option.key as typeof inviteExpireMode)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${inviteExpireMode === option.key ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {inviteExpireMode === 'datetime' && (
                <input
                  type="datetime-local"
                  value={inviteExpireAtInput}
                  onChange={e => setInviteExpireAtInput(e.target.value)}
                  className="w-full bg-white dark:bg-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none border border-gray-200 dark:border-gray-600 focus:border-emerald-400 transition-colors"
                />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">使用次数</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'unlimited', label: '不限' },
                  { key: '1', label: '1次' },
                  { key: '10', label: '10次' },
                  { key: '100', label: '100次' },
                  { key: 'custom', label: '自定义' },
                ].map(option => (
                  <button
                    key={option.key}
                    onClick={() => setInviteUseMode(option.key as typeof inviteUseMode)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${inviteUseMode === option.key ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {inviteUseMode === 'custom' && (
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={inviteCustomMaxUses}
                  onChange={e => setInviteCustomMaxUses(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="输入使用次数上限"
                  className="w-full bg-white dark:bg-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none border border-gray-200 dark:border-gray-600 focus:border-emerald-400 transition-colors"
                />
              )}
            </div>

            <button
              onClick={handleCreateInvite}
              disabled={creatingInvite}
              className="w-full py-3 bg-emerald-500 text-white text-sm font-medium rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              {creatingInvite ? '创建中...' : '创建新链接'}
            </button>
          </div>
        )}

        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">自定义邀请链接</p>
              <p className="text-[11px] text-gray-400">达到设定时间或使用次数后会立即失效</p>
            </div>
            <button
              onClick={fetchInviteLinks}
              disabled={loadingInviteLinks}
              className="text-xs text-emerald-500 hover:text-emerald-600 transition-colors disabled:opacity-50"
            >
              {loadingInviteLinks ? '刷新中...' : '刷新'}
            </button>
          </div>

          {loadingInviteLinks ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin text-gray-300" />
            </div>
          ) : customInviteLinks.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">暂无自定义邀请链接</div>
          ) : (
            <div className="space-y-3">
              {customInviteLinks.map(link => (
                <div key={link.id} className="bg-white dark:bg-gray-900/40 rounded-2xl border border-gray-100 dark:border-gray-700 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {link.name || '未命名邀请链接'}
                        </p>
                        {link.isExpired ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-300">已失效</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300">生效中</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 break-all mt-1">{link.fullUrl}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                    <p>失效时间：{formatDateTime(link.expireAt)}</p>
                    <p>使用次数：{link.maxUses > 0 ? `${link.usedCount}/${link.maxUses}` : '不限'}</p>
                    <p>创建时间：{formatDateTime(link.createdAt)}</p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleCopyInviteLink(link.fullUrl)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200"
                    >
                      <Copy size={13} />复制
                    </button>
                    <button
                      onClick={() => setQrInvite(link)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-xs font-medium text-emerald-600 dark:text-emerald-300"
                    >
                      <QrCode size={13} />二维码
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => handleRevokeInvite(link.hash)}
                        className="px-3 inline-flex items-center justify-center py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs font-medium text-red-600 dark:text-red-300"
                      >
                        撤销
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMain = () => (
    <div className="flex-1 overflow-y-auto pb-safe">
      {/* 群头像区域 */}
      <div className="flex flex-col items-center py-6 px-5">
        <div className="relative group">
          <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-lg">
            {currentAvatar ? (
              <img src={currentAvatar} alt={name} className="w-full h-full object-cover" />
            ) : (
              <DoveAvatar name={name} size={80} isGroup />
            )}
          </div>
          {isAdmin && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute inset-0 w-20 h-20 rounded-2xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              {uploadingAvatar ? <Loader2 size={20} className="text-white animate-spin" /> : <Camera size={20} className="text-white" />}
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={handleAvatarSelect} />
        </div>
        {isAdmin && (
          <button onClick={() => fileInputRef.current?.click()} className="mt-2 text-xs text-emerald-500 hover:text-emerald-600 transition-colors">
            {uploadingAvatar ? '上传中...' : '修改头像'}
          </button>
        )}
        <div className="flex items-center gap-1 mt-2">
          <Users size={12} className="text-gray-400" />
          <span className="text-xs text-gray-400">{groupInfo?.memberCount || 0} 名成员</span>
        </div>
      </div>

      {/* 设置项列表 */}
      <div className="px-5 space-y-1">
        {/* 群名称 */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">群名称</span>
              {isAdmin && !editingName && (
                <button onClick={() => setEditingName(true)} className="flex items-center gap-1 text-[10px] text-emerald-500 hover:text-emerald-600 transition-colors">
                  <Pencil size={10} />编辑
                </button>
              )}
            </div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)} maxLength={30} autoFocus
                  className="flex-1 bg-white dark:bg-gray-700 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none border border-gray-200 dark:border-gray-600 focus:border-emerald-400 transition-colors"
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setEditingName(false); setName(groupInfo?.name || currentGroupName); } }}
                />
                <button onClick={handleSaveName} disabled={saving} className="w-8 h-8 flex items-center justify-center rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
                <button onClick={() => { setEditingName(false); setName(groupInfo?.name || currentGroupName); }} className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-300 transition-colors">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{groupInfo?.name || currentGroupName}</p>
            )}
            {editingName && <p className="text-[10px] text-gray-400 mt-1 text-right">{name.length}/30</p>}
          </div>
        </div>

        {/* 群 ID (username) */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">群 ID</span>
              {isOwner && !editingUsername && (
                <button onClick={() => setEditingUsername(true)} className="flex items-center gap-1 text-[10px] text-emerald-500 hover:text-emerald-600 transition-colors">
                  <Pencil size={10} />编辑
                </button>
              )}
            </div>
            {editingUsername ? (
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center bg-white dark:bg-gray-700 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-600 focus-within:border-emerald-400 transition-colors">
                    <AtSign size={14} className="text-gray-400 mr-1 flex-shrink-0" />
                    <input
                      type="text" value={username} onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} maxLength={32} autoFocus placeholder="设置群公开ID"
                      className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 outline-none placeholder-gray-400"
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveUsername(); if (e.key === 'Escape') { setEditingUsername(false); setUsername(groupInfo?.username || ''); } }}
                    />
                  </div>
                  <button onClick={handleSaveUsername} disabled={saving} className="w-8 h-8 flex items-center justify-center rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button onClick={() => { setEditingUsername(false); setUsername(groupInfo?.username || ''); }} className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-300 transition-colors">
                    <X size={14} />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">以字母开头，5-32位字母数字下划线。设置后可通过公开链接加入群聊。留空则清除。</p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {groupInfo?.username ? (
                  <>
                    <AtSign size={14} className="text-emerald-500 flex-shrink-0" />
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">@{groupInfo.username}</p>
                    <button onClick={() => { navigator.clipboard?.writeText(`https://wed.imim.chat/im/${groupInfo.username}`).then(() => toast.success('公开链接已复制')); }} className="ml-auto text-gray-400 hover:text-emerald-500 transition-colors">
                      <Link2 size={14} />
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">{isOwner ? '未设置（点击编辑设置公开ID）' : '未设置'}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 群公开链接 */}
        {groupInfo?.username && (
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl overflow-hidden">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Link2 size={14} className="text-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mb-0.5">公开链接</p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 truncate">wed.imim.chat/im/{groupInfo.username}</p>
                </div>
                <button onClick={() => { navigator.clipboard?.writeText(`https://wed.imim.chat/im/${groupInfo.username}`).then(() => toast.success('链接已复制')).catch(() => toast.error('复制失败')); }} className="px-3 py-1.5 bg-emerald-500 text-white text-[10px] font-medium rounded-lg hover:bg-emerald-600 transition-colors">
                  复制
                </button>
              </div>
            </div>
          </div>
        )}

        {isAdmin && (
          <button
            onClick={() => { setSubPage('inviteLinks'); fetchInviteLinks(); }}
            className="w-full bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden"
          >
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 size={16} className="text-gray-400" />
                <span className="text-sm text-gray-900 dark:text-gray-100">邀请链接</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-400">创建 / 管理</span>
                <ChevronRight size={16} className="text-gray-300" />
              </div>
            </div>
          </button>
        )}

        {/* 群公告入口 */}
        <button
          onClick={() => { setSubPage('announcement'); }}
          className="w-full bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden"
        >
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-gray-400" />
              <span className="text-sm text-gray-900 dark:text-gray-100">群公告</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400 truncate max-w-[120px]">
                {groupInfo?.announcement ? groupInfo.announcement.slice(0, 15) + (groupInfo.announcement.length > 15 ? '...' : '') : '未设置'}
              </span>
              <ChevronRight size={16} className="text-gray-300" />
            </div>
          </div>
        </button>

        {/* 成员列表入口 */}
        <button
          onClick={() => { setSubPage('members'); fetchMembers(); }}
          className="w-full bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden"
        >
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-gray-400" />
              <span className="text-sm text-gray-900 dark:text-gray-100">群成员</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">{groupInfo?.memberCount || 0}</span>
              <ChevronRight size={16} className="text-gray-300" />
            </div>
          </div>
        </button>

        {/* 权限提示 */}
        {!isAdmin && (
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl px-4 py-3 mt-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">仅群主和管理员可修改群信息</p>
          </div>
        )}

        {/* 退出群聊 / 解散群聊 */}
        <div className="pt-4 pb-6 space-y-2">
          {isOwner ? (
            <button
              onClick={handleDissolveGroup}
              disabled={operating}
              className="w-full flex items-center justify-center gap-2 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            >
              <Trash2 size={16} className="text-red-500" />
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                {operating ? '处理中...' : '解散群聊'}
              </span>
            </button>
          ) : (
            <button
              onClick={handleLeaveGroup}
              disabled={operating}
              className="w-full flex items-center justify-center gap-2 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            >
              <LogOut size={16} className="text-red-500" />
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                {operating ? '处理中...' : '退出群聊'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // 标题和返回
  const getTitle = () => {
    switch (subPage) {
      case 'members': return '群成员';
      case 'announcement': return '群公告';
      case 'inviteLinks': return '邀请链接';
      case 'memberAction': return selectedMember?.name || selectedMember?.userId || '成员操作';
      default: return '群设置';
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
          className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-t-3xl overflow-hidden flex flex-col"
          style={{ maxHeight: '85vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* 把手 */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />
          </div>

          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
            {subPage !== 'main' ? (
              <button
                onClick={() => {
                  if (subPage === 'memberAction') setSubPage('members');
                  else setSubPage('main');
                }}
                className="text-sm text-emerald-500 hover:text-emerald-600 transition-colors"
              >
                返回
              </button>
            ) : (
              <div className="w-8" />
            )}
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{getTitle()}</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <X size={16} className="text-gray-500" />
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={28} className="text-gray-300 animate-spin" />
              <p className="text-sm text-gray-400">加载群信息...</p>
            </div>
          ) : (
            <>
              {subPage === 'main' && renderMain()}
              {subPage === 'members' && renderMembers()}
              {subPage === 'announcement' && renderAnnouncement()}
              {subPage === 'inviteLinks' && renderInviteLinks()}
              {subPage === 'memberAction' && renderMemberAction()}
            </>
          )}
        </motion.div>
      </motion.div>

      {qrInvite && groupInfo && (
        <GroupQRCodePage
          groupId={groupId}
          groupName={groupInfo.name}
          groupAvatar={groupInfo.avatar}
          groupUsername={groupInfo.username}
          members={members}
          inviteUrl={qrInvite.fullUrl}
          inviteExpireAt={qrInvite.expireAt}
          inviteMaxUses={qrInvite.maxUses}
          inviteUsedCount={qrInvite.usedCount}
          inviteLabel={qrInvite.name ? `邀请链接：${qrInvite.name}` : '自定义邀请链接'}
          onClose={() => setQrInvite(null)}
        />
      )}
    </AnimatePresence>
  );
};
