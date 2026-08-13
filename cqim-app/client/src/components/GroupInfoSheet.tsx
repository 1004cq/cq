/**
 * 群聊信息页（微信风格全屏 Sheet）
 * 修复：布局适配、Toggle 显示、+ 按钮功能、整体排版
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Plus, Minus,
  Crown, ShieldCheck, Loader2, Link2, Copy, QrCode, Trash2, Camera,
} from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { GroupQRCodePage } from '@/components/GroupQRCodePage';
import { InviteMembersModal } from '@/components/InviteMembersModal';
import { useRemoteProfileSync, mergeProfileUpdate } from '@/hooks/useRemoteProfileSync';
import { toast } from 'sonner';
import { SettingRow } from '@/components/sheets/SheetPrimitives';

interface MemberInfo {
  id: string;
  userId: string;
  role: string;
  name?: string;
  nickname?: string;
  avatar?: string;
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

interface GroupInfoSheetProps {
  groupId: string;
  currentUserId: string;
  isMuted: boolean;
  isPinned: boolean;
  onClose: () => void;
  onToggleMute: () => void;
  onTogglePin: () => void;
  onClearMessages: () => void;
  onLeaveGroup: () => void;
  onUpdated?: (updated: { name?: string; avatar?: string; username?: string | null }) => void;
  onShowProfile?: (userId: string) => void;
}

export const GroupInfoSheet: React.FC<GroupInfoSheetProps> = ({
  groupId,
  currentUserId,
  isMuted,
  isPinned,
  onClose,
  onToggleMute,
  onTogglePin,
  onClearMessages,
  onLeaveGroup,
  onUpdated,
  onShowProfile,
}) => {
  const [groupInfo, setGroupInfo] = useState<{
    id: string; name: string; avatar?: string;
    username?: string | null;
    announcement?: string | null; ownerId?: string;
  } | null>(null);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllMembers, setShowAllMembers] = useState(false);

  const [myNickname, setMyNickname] = useState('');
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const nicknameInputRef = useRef<HTMLInputElement>(null);

  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [showInviteMembers, setShowInviteMembers] = useState(false);
  const [isSavedToContacts, setIsSavedToContacts] = useState(false);
  const [showMemberNicknames, setShowMemberNicknames] = useState(true);

  // 群名称编辑
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [savingGroupName, setSavingGroupName] = useState(false);
  const groupNameInputRef = useRef<HTMLInputElement>(null);

  const [editingGroupUsername, setEditingGroupUsername] = useState(false);
  const [groupUsernameInput, setGroupUsernameInput] = useState('');
  const [savingGroupUsername, setSavingGroupUsername] = useState(false);
  const groupUsernameInputRef = useRef<HTMLInputElement>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 群公告编辑
  const [editingAnnouncement, setEditingAnnouncement] = useState(false);
  const [announcementInput, setAnnouncementInput] = useState('');
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);

  const [showInviteLinks, setShowInviteLinks] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<InviteLinkInfo[]>([]);
  const [loadingInviteLinks, setLoadingInviteLinks] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteExpireMode, setInviteExpireMode] = useState<'permanent' | '1h' | '1d' | '1w' | 'datetime'>('permanent');
  const [inviteExpireAtInput, setInviteExpireAtInput] = useState('');
  const [inviteUseMode, setInviteUseMode] = useState<'unlimited' | '1' | '10' | '100' | 'custom'>('unlimited');
  const [inviteCustomMaxUses, setInviteCustomMaxUses] = useState('');
  const [qrInvite, setQrInvite] = useState<InviteLinkInfo | null>(null);

  const myRole = members.find(m => m.userId === currentUserId)?.role;
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'admin' || isOwner;

  // 加载群信息和成员
  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/group/info?groupId=${encodeURIComponent(groupId)}`).then(r => r.json()),
      fetch(`/api/group/members?groupId=${encodeURIComponent(groupId)}`).then(r => r.json()),
    ]).then(([info, memberList]) => {
      setGroupInfo(info);
      const list: MemberInfo[] = Array.isArray(memberList) ? memberList : (memberList.members || []);
      setMembers(list);
      const me = list.find((m: MemberInfo) => m.userId === currentUserId);
      setMyNickname(me?.nickname || '');
      setNicknameInput(me?.nickname || '');
      setGroupNameInput(info?.name || '');
      setGroupUsernameInput(info?.username || '');
      setAnnouncementInput(info?.announcement || '');
    }).catch(err => {
      console.error('[GroupInfoSheet] 加载失败:', err);
      toast.error('加载群信息失败');
    }).finally(() => setLoading(false));
  }, [groupId, currentUserId]);

  // ★ 实时同步：群成员更新头像/昵称后自动更新成员列表
  useRemoteProfileSync((update) => {
    setMembers(prev => prev.map(m => mergeProfileUpdate(m, update)));
  });

  // 保存群昵称
  const handleSaveNickname = useCallback(async () => {
    if (savingNickname) return;
    setSavingNickname(true);
    try {
      const res = await fetch('/api/group/member/nickname', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, userId: currentUserId, nickname: nicknameInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      const nextNickname = nicknameInput.trim();
      setMyNickname(nextNickname);
      setMembers(prev => prev.map(member => member.userId === currentUserId ? { ...member, nickname: nextNickname } : member));
      setEditingNickname(false);
      toast.success('群昵称已更新');
    } catch (err: any) {
      toast.error(err.message || '保存群昵称失败');
    } finally {
      setSavingNickname(false);
    }
  }, [groupId, currentUserId, nicknameInput, savingNickname]);

  // 保存群名称
  const handleSaveGroupName = useCallback(async () => {
    if (savingGroupName || !groupNameInput.trim()) return;
    setSavingGroupName(true);
    try {
      const res = await fetch('/api/group/update/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, userId: currentUserId, name: groupNameInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      setGroupInfo(prev => prev ? { ...prev, name: groupNameInput.trim() } : prev);
      setEditingGroupName(false);
      onUpdated?.({ name: groupNameInput.trim() });
      toast.success('群名称已更新');
    } catch (err: any) {
      toast.error(err.message || '修改群名称失败');
    } finally {
      setSavingGroupName(false);
    }
  }, [groupId, currentUserId, groupNameInput, savingGroupName, onUpdated]);

  const handleSaveGroupUsername = useCallback(async () => {
    const nextUsername = groupUsernameInput.trim();
    if (nextUsername && !/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(nextUsername)) {
      toast.error('群 ID 必须以字母开头，5-32位字母数字下划线');
      return;
    }
    if (savingGroupUsername) return;
    setSavingGroupUsername(true);
    try {
      const res = await fetch('/api/group/update/username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, userId: currentUserId, username: nextUsername || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      setGroupInfo(prev => prev ? { ...prev, username: data.username || null } : prev);
      setGroupUsernameInput(data.username || '');
      setEditingGroupUsername(false);
      onUpdated?.({ username: data.username || null });
      toast.success(data.username ? `群 ID 已设置为 @${data.username}` : '群 ID 已清除');
    } catch (err: any) {
      toast.error(err.message || '修改群 ID 失败');
    } finally {
      setSavingGroupUsername(false);
    }
  }, [currentUserId, groupId, groupUsernameInput, onUpdated, savingGroupUsername]);

  const handleAvatarSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('仅支持 JPG、PNG、GIF、WebP 格式');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('头像文件不能超过 5MB');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
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
        setGroupInfo(prev => prev ? { ...prev, avatar: data.avatar } : prev);
        onUpdated?.({ avatar: data.avatar });
        toast.success('群头像已更新');
      } catch (err: any) {
        toast.error(err.message || '上传群头像失败');
      } finally {
        setUploadingAvatar(false);
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  }, [currentUserId, groupId, onUpdated]);

  // 保存群公告
  const handleSaveAnnouncement = useCallback(async () => {
    if (savingAnnouncement) return;
    setSavingAnnouncement(true);
    try {
      const res = await fetch('/api/group/announcement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, userId: currentUserId, announcement: announcementInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      setGroupInfo(prev => prev ? { ...prev, announcement: announcementInput.trim() } : prev);
      setEditingAnnouncement(false);
      toast.success('群公告已更新');
    } catch (err: any) {
      toast.error(err.message || '修改群公告失败');
    } finally {
      setSavingAnnouncement(false);
    }
  }, [groupId, currentUserId, announcementInput, savingAnnouncement]);

  // 添加成员（打开邀请好友选择器）
  const handleAddMember = useCallback(() => {
    setShowInviteMembers(true);
  }, []);

  // 邀请好友成功后刷新成员列表
  const handleInvited = useCallback((addedCount: number) => {
    if (addedCount > 0) {
      // 重新加载群信息和成员
      Promise.all([
        fetch(`/api/group/info?groupId=${encodeURIComponent(groupId)}`).then(r => r.json()),
        fetch(`/api/group/members?groupId=${encodeURIComponent(groupId)}`).then(r => r.json()),
      ]).then(([info, memberList]) => {
        setGroupInfo(info);
        const list: MemberInfo[] = Array.isArray(memberList) ? memberList : (memberList.members || []);
        setMembers(list);
        onUpdated?.({});
      }).catch(err => {
        console.error('[GroupInfoSheet] 刷新成员列表失败:', err);
      });
    }
  }, [groupId, onUpdated]);

  const fetchInviteLinks = useCallback(async () => {
    setLoadingInviteLinks(true);
    try {
      const res = await fetch(`/api/group/invite/list?groupId=${encodeURIComponent(groupId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '获取邀请链接失败');
      setInviteLinks(Array.isArray(data.links) ? data.links : []);
    } catch (err: any) {
      toast.error(err.message || '加载邀请链接失败');
    } finally {
      setLoadingInviteLinks(false);
    }
  }, [groupId]);

  const handleOpenInviteLinks = useCallback(() => {
    setShowInviteLinks(true);
    fetchInviteLinks();
  }, [fetchInviteLinks]);

  const handleCreateInviteLink = useCallback(async () => {
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

  const handleRevokeInviteLink = useCallback(async (hash: string) => {
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

  const displayMembers = showAllMembers ? members : members.slice(0, 15);

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

  /* ====== 底部弹出编辑面板 ====== */
  const BottomSheet: React.FC<{
    show: boolean;
    title: string;
    onCancel: () => void;
    onSave: () => void;
    saving: boolean;
    saveText?: string;
    savingText?: string;
    children: React.ReactNode;
  }> = ({ show, title, onCancel, onSave, saving, saveText, savingText, children }) => (
    <AnimatePresence>
      {show && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(0,0,0,0.4)' }}
            onClick={onCancel}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 261,
              background: '#fff', borderRadius: '16px 16px 0 0',
              padding: '16px 16px 32px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <button onClick={onCancel} style={{ fontSize: 14, color: '#8e8e93', background: 'none', border: 'none' }}>取消</button>
              <span style={{ fontSize: 16, fontWeight: 600, color: '#1c1c1e' }}>{title}</span>
              <button
                onClick={onSave}
                disabled={saving}
                style={{ fontSize: 14, color: '#007AFF', fontWeight: 500, background: 'none', border: 'none', opacity: saving ? 0.5 : 1 }}
              >
                {saving ? (savingText || '保存中...') : (saveText || '完成')}
              </button>
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  /* ====== 确认对话框 ====== */
  const ConfirmDialog: React.FC<{
    show: boolean;
    title: string;
    desc: string;
    confirmText: string;
    onCancel: () => void;
    onConfirm: () => void;
  }> = ({ show, title, desc, confirmText, onCancel, onConfirm }) => (
    <AnimatePresence>
      {show && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(0,0,0,0.4)' }} onClick={onCancel} />
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{ position: 'fixed', inset: 0, zIndex: 261, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}
          >
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 280, overflow: 'hidden' }}>
              <div style={{ padding: '24px 24px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1c1c1e', marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 14, color: '#8e8e93' }}>{desc}</div>
              </div>
              <div style={{ borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex' }}>
                <button
                  onClick={onCancel}
                  style={{ flex: 1, padding: '12px 0', fontSize: 14, color: '#007AFF', background: 'none', border: 'none', borderRight: '1px solid rgba(0,0,0,0.1)' }}
                >取消</button>
                <button
                  onClick={onConfirm}
                  style={{ flex: 1, padding: '12px 0', fontSize: 14, fontWeight: 600, color: '#ff3b30', background: 'none', border: 'none' }}
                >{confirmText}</button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const content = (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0, 0.67, 0] }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 200,
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
          返回
        </button>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#1c1c1e' }}>
          聊天信息({members.length})
        </span>
        <div style={{ width: 60 }} />
      </div>

      {/* 内容区域 */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        width: '100%',
      }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160 }}>
            <Loader2 size={24} className="animate-spin" style={{ color: '#8e8e93' }} />
          </div>
        ) : (
          <>
            <div style={{
              background: '#fff',
              marginTop: 10,
              padding: '20px 16px 16px',
              width: '100%',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}>
              <div
                onClick={() => {
                  if (!isAdmin) {
                    toast.error('仅管理员和群主可修改群头像');
                    return;
                  }
                  if (!uploadingAvatar) avatarFileInputRef.current?.click();
                }}
                style={{ position: 'relative', cursor: isAdmin ? 'pointer' : 'default' }}
              >
                <DoveAvatar
                  name={groupInfo?.name || '群聊'}
                  avatar={groupInfo?.avatar}
                  size={82}
                />
                <div style={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: uploadingAvatar ? '#c7c7cc' : '#007AFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
                }}>
                  {uploadingAvatar ? <Loader2 size={14} color="#fff" className="animate-spin" /> : <Camera size={14} color="#fff" />}
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#1c1c1e', textAlign: 'center' }}>
                {groupInfo?.name || '群聊'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <span style={{ fontSize: 14, color: '#8e8e93' }}>
                  群ID：{groupInfo?.username ? `@${groupInfo.username}` : '未设置'}
                </span>
                {isOwner && (
                  <button
                    onClick={() => {
                      setGroupUsernameInput(groupInfo?.username || '');
                      setEditingGroupUsername(true);
                      setTimeout(() => groupUsernameInputRef.current?.focus(), 100);
                    }}
                    style={{ padding: '4px 10px', borderRadius: 999, border: 'none', background: 'rgba(0,122,255,0.12)', color: '#007AFF', fontSize: 12, cursor: 'pointer' }}
                  >
                    修改群ID
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#c7c7cc' }}>
                {isAdmin ? '点击头像可修改群头像' : `${members.length} 位成员`}
              </div>
            </div>

            {/* ========== 成员网格 ========== */}
            <div style={{
              background: '#fff',
              marginTop: 10,
              padding: '16px 16px 12px',
              width: '100%',
              boxSizing: 'border-box',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '12px 8px',
              }}>
                {displayMembers.map(member => (
                  <div key={member.userId} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    cursor: onShowProfile ? 'pointer' : 'default',
                  }} onClick={() => onShowProfile?.(member.userId)}>
                    <div style={{ position: 'relative' }}>
                      <DoveAvatar
                        name={member.name || member.nickname || member.userId}
                        avatar={member.avatar}
                        size={48}
                      />
                      {member.role === 'owner' && (
                        <div style={{
                          position: 'absolute', top: -3, right: -3,
                          width: 16, height: 16, borderRadius: '50%',
                          background: '#f5a623', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Crown size={9} color="#fff" />
                        </div>
                      )}
                      {member.role === 'admin' && (
                        <div style={{
                          position: 'absolute', top: -3, right: -3,
                          width: 16, height: 16, borderRadius: '50%',
                          background: '#007AFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <ShieldCheck size={9} color="#fff" />
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontSize: 11, color: '#8e8e93',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', width: '100%', textAlign: 'center',
                    }}>
                      {member.name || member.nickname || member.userId}
                    </span>
                  </div>
                ))}
                {/* + 添加成员 */}
                <div
                  onClick={handleAddMember}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 48, height: 48, borderRadius: 8,
                    border: '1.5px dashed #c7c7cc',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Plus size={22} color="#c7c7cc" />
                  </div>
                  <span style={{ fontSize: 11, color: 'transparent' }}>-</span>
                </div>
                {/* - 移除成员（仅群主/管理员可见） */}
                {isAdmin && (
                  <div
                    onClick={() => toast('移除成员功能开发中')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{
                      width: 48, height: 48, borderRadius: 8,
                      border: '1.5px dashed #c7c7cc',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Minus size={22} color="#c7c7cc" />
                    </div>
                    <span style={{ fontSize: 11, color: 'transparent' }}>-</span>
                  </div>
                )}
              </div>
              {members.length > 15 && (
                <button
                  onClick={() => setShowAllMembers(v => !v)}
                  style={{
                    marginTop: 12, width: '100%', textAlign: 'center',
                    fontSize: 14, color: '#007AFF', background: 'none', border: 'none', cursor: 'pointer',
                  }}
                >
                  {showAllMembers ? '收起' : `查看更多群成员 (${members.length})`}
                </button>
              )}
            </div>

            {/* ========== 群聊名称 + 群二维码 + 群公告 + 备注 ========== */}
            <div style={{ background: '#fff', marginTop: 10, width: '100%', boxSizing: 'border-box' }}>
              <SettingRow
                label="群聊名称"
                value={groupInfo?.name || ''}
                hasArrow
                onClick={() => {
                  setGroupNameInput(groupInfo?.name || '');
                  setEditingGroupName(true);
                  setTimeout(() => groupNameInputRef.current?.focus(), 100);
                }}
              />
              <SettingRow
                label="群ID"
                value={groupInfo?.username ? `@${groupInfo.username}` : '未设置'}
                hasArrow
                onClick={() => {
                  if (!isOwner) {
                    toast.error('仅群主可修改群 ID');
                    return;
                  }
                  setGroupUsernameInput(groupInfo?.username || '');
                  setEditingGroupUsername(true);
                  setTimeout(() => groupUsernameInputRef.current?.focus(), 100);
                }}
              />
              <SettingRow
                label="群二维码"
                hasArrow
                onClick={() => setShowQRCode(true)}
              />
              {isAdmin && (
                <SettingRow
                  label="邀请链接"
                  value="创建 / 管理"
                  hasArrow
                  onClick={handleOpenInviteLinks}
                />
              )}
              <SettingRow
                label="邀请好友入群"
                hasArrow
                onClick={() => setShowInviteMembers(true)}
              />
              <SettingRow
                label="群公告"
                value={groupInfo?.announcement || '未设置'}
                hasArrow
                onClick={() => {
                  setAnnouncementInput(groupInfo?.announcement || '');
                  setEditingAnnouncement(true);
                }}
              />
              <SettingRow
                label="备注"
                hasArrow
                isLast
                onClick={() => toast('备注功能开发中')}
              />
            </div>

            {/* ========== 查找聊天内容 ========== */}
            <div style={{ background: '#fff', marginTop: 10, width: '100%', boxSizing: 'border-box' }}>
              <SettingRow
                label="查找聊天内容"
                hasArrow
                isLast
                onClick={() => toast('查找聊天内容功能开发中')}
              />
            </div>

            {/* ========== 消息免打扰 + 置顶聊天 + 保存到通讯录 ========== */}
            <div style={{ background: '#fff', marginTop: 10, width: '100%', boxSizing: 'border-box' }}>
              <SettingRow
                label="消息免打扰"
                toggle={{ value: isMuted, onChange: onToggleMute }}
              />
              <SettingRow
                label="置顶聊天"
                toggle={{ value: isPinned, onChange: onTogglePin }}
              />
              <SettingRow
                label="保存到通讯录"
                toggle={{ value: isSavedToContacts, onChange: () => setIsSavedToContacts(v => !v) }}
                isLast
              />
            </div>

            {/* ========== 我在本群的昵称 + 显示群成员昵称 ========== */}
            <div style={{ background: '#fff', marginTop: 10, width: '100%', boxSizing: 'border-box' }}>
              <SettingRow
                label="我在本群的昵称"
                value={myNickname || '未设置'}
                hasArrow
                onClick={() => {
                  setEditingNickname(true);
                  setTimeout(() => nicknameInputRef.current?.focus(), 100);
                }}
              />
              <SettingRow
                label="显示群成员昵称"
                toggle={{ value: showMemberNicknames, onChange: () => setShowMemberNicknames(v => !v) }}
                isLast
              />
            </div>

            {/* ========== 设置当前聊天背景 ========== */}
            <div style={{ background: '#fff', marginTop: 10, width: '100%', boxSizing: 'border-box' }}>
              <SettingRow
                label="设置当前聊天背景"
                hasArrow
                isLast
                onClick={() => toast('设置聊天背景功能开发中')}
              />
            </div>

            {/* ========== 清空聊天记录 ========== */}
            <div style={{ background: '#fff', marginTop: 10, width: '100%', boxSizing: 'border-box' }}>
              <SettingRow
                label="清空聊天记录"
                hasArrow
                isLast
                onClick={() => setShowConfirmClear(true)}
              />
            </div>

            {/* ========== 投诉 ========== */}
            <div style={{ background: '#fff', marginTop: 10, width: '100%', boxSizing: 'border-box' }}>
              <SettingRow
                label="投诉"
                labelColor="#576b95"
                hasArrow
                isLast
                onClick={() => toast('投诉功能开发中')}
              />
            </div>

            {/* ========== 退出/解散群聊 ========== */}
            <div style={{ background: '#fff', marginTop: 10, marginBottom: 40, width: '100%', boxSizing: 'border-box' }}>
              <div
                onClick={() => setShowConfirmLeave(true)}
                style={{
                  padding: '14px 16px',
                  textAlign: 'center',
                  fontSize: 15,
                  fontWeight: 500,
                  color: '#ff3b30',
                  cursor: 'pointer',
                }}
              >
                {isOwner ? '解散群聊' : '退出群聊'}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ========== 邀请好友入群 ========== */}
      <AnimatePresence>
        {showInviteMembers && (
          <InviteMembersModal
            groupId={groupId}
            currentUserId={currentUserId}
            existingMemberIds={members.map(m => m.userId)}
            onClose={() => setShowInviteMembers(false)}
            onInvited={handleInvited}
          />
        )}
      </AnimatePresence>

      {/* ========== 群二维码页面 ========== */}
      <AnimatePresence>
        {showQRCode && groupInfo && (
          <GroupQRCodePage
            groupId={groupId}
            groupName={groupInfo.name}
            groupAvatar={groupInfo.avatar}
            groupUsername={groupInfo.username}
            members={members.map(m => ({
              userId: m.userId,
              name: m.nickname || m.name,
              avatar: m.avatar,
            }))}
            onClose={() => setShowQRCode(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {qrInvite && groupInfo && (
          <GroupQRCodePage
            groupId={groupId}
            groupName={groupInfo.name}
            groupAvatar={groupInfo.avatar}
            groupUsername={groupInfo.username}
            members={members.map(m => ({
              userId: m.userId,
              name: m.nickname || m.name,
              avatar: m.avatar,
            }))}
            inviteUrl={qrInvite.fullUrl}
            inviteExpireAt={qrInvite.expireAt}
            inviteMaxUses={qrInvite.maxUses}
            inviteUsedCount={qrInvite.usedCount}
            inviteLabel={qrInvite.name ? `邀请链接：${qrInvite.name}` : '自定义邀请链接'}
            onClose={() => setQrInvite(null)}
          />
        )}
      </AnimatePresence>

      <BottomSheet
        show={showInviteLinks}
        title="邀请链接"
        onCancel={() => setShowInviteLinks(false)}
        onSave={handleCreateInviteLink}
        saving={creatingInvite}
        saveText="创建"
        savingText="创建中..."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '68vh', overflowY: 'auto', paddingBottom: 8 }}>
          <div style={{ background: '#f7f7fa', borderRadius: 14, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Link2 size={16} color="#07C160" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1c1e' }}>创建新链接</div>
                <div style={{ fontSize: 11, color: '#8e8e93' }}>支持 1 小时、1 天、1 周、具体时间和使用次数限制</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                maxLength={30}
                placeholder="例如：活动海报 / 运营推广"
                style={{ width: '100%', background: '#fff', borderRadius: 12, padding: '12px 14px', fontSize: 14, border: '1px solid rgba(0,0,0,0.08)', outline: 'none', boxSizing: 'border-box' }}
              />

              <div>
                <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 8 }}>失效时间</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
                      style={{ padding: '8px 12px', borderRadius: 999, border: inviteExpireMode === option.key ? '1px solid #07C160' : '1px solid rgba(0,0,0,0.08)', background: inviteExpireMode === option.key ? 'rgba(7,193,96,0.12)' : '#fff', color: inviteExpireMode === option.key ? '#07C160' : '#4b5563', fontSize: 12 }}
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
                    style={{ width: '100%', marginTop: 10, background: '#fff', borderRadius: 12, padding: '12px 14px', fontSize: 14, border: '1px solid rgba(0,0,0,0.08)', outline: 'none', boxSizing: 'border-box' }}
                  />
                )}
              </div>

              <div>
                <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 8 }}>使用次数</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
                      style={{ padding: '8px 12px', borderRadius: 999, border: inviteUseMode === option.key ? '1px solid #07C160' : '1px solid rgba(0,0,0,0.08)', background: inviteUseMode === option.key ? 'rgba(7,193,96,0.12)' : '#fff', color: inviteUseMode === option.key ? '#07C160' : '#4b5563', fontSize: 12 }}
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
                    style={{ width: '100%', marginTop: 10, background: '#fff', borderRadius: 12, padding: '12px 14px', fontSize: 14, border: '1px solid rgba(0,0,0,0.08)', outline: 'none', boxSizing: 'border-box' }}
                  />
                )}
              </div>
            </div>
          </div>

          <div style={{ background: '#f7f7fa', borderRadius: 14, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1c1e' }}>现有邀请链接</div>
                <div style={{ fontSize: 11, color: '#8e8e93' }}>达到设定时间或使用次数后会立即失效</div>
              </div>
              <button onClick={fetchInviteLinks} style={{ fontSize: 12, color: '#07C160', background: 'none', border: 'none' }}>刷新</button>
            </div>

            {loadingInviteLinks ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
                <Loader2 size={20} className="animate-spin" style={{ color: '#8e8e93' }} />
              </div>
            ) : inviteLinks.filter(link => link.name !== 'group_qrcode').length === 0 ? (
              <div style={{ textAlign: 'center', fontSize: 13, color: '#8e8e93', padding: '20px 0' }}>暂无自定义邀请链接</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {inviteLinks.filter(link => link.name !== 'group_qrcode').map(link => (
                  <div key={link.id} style={{ background: '#fff', borderRadius: 12, padding: 12, border: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#1c1c1e' }}>{link.name || '未命名邀请链接'}</span>
                          <span style={{ fontSize: 11, color: link.isExpired ? '#ff3b30' : '#07C160' }}>{link.isExpired ? '已失效' : '生效中'}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 6, wordBreak: 'break-all' }}>{link.fullUrl}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 8, lineHeight: 1.6 }}>
                      <div>失效时间：{formatDateTime(link.expireAt)}</div>
                      <div>使用次数：{link.maxUses > 0 ? `${link.usedCount}/${link.maxUses}` : '不限'}</div>
                      <div>创建时间：{formatDateTime(link.createdAt)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => handleCopyInviteLink(link.fullUrl)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '9px 0', borderRadius: 10, border: 'none', background: '#f2f2f7', color: '#1c1c1e', fontSize: 12 }}><Copy size={13} />复制</button>
                      <button onClick={() => setQrInvite(link)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '9px 0', borderRadius: 10, border: 'none', background: 'rgba(7,193,96,0.12)', color: '#07C160', fontSize: 12 }}><QrCode size={13} />二维码</button>
                      <button onClick={() => handleRevokeInviteLink(link.hash)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '9px 12px', borderRadius: 10, border: 'none', background: 'rgba(255,59,48,0.12)', color: '#ff3b30', fontSize: 12 }}><Trash2 size={13} />撤销</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </BottomSheet>

      {/* ========== 编辑昵称 ========== */}
      <BottomSheet
        show={editingNickname}
        title="我在本群的昵称"
        onCancel={() => setEditingNickname(false)}
        onSave={handleSaveNickname}
        saving={savingNickname}
      >
        <input
          ref={nicknameInputRef}
          type="text"
          value={nicknameInput}
          onChange={e => setNicknameInput(e.target.value)}
          placeholder="设置你在本群的昵称"
          maxLength={20}
          onKeyDown={e => e.key === 'Enter' && handleSaveNickname()}
          style={{
            width: '100%', background: '#f2f2f7', borderRadius: 12,
            padding: '12px 16px', fontSize: 14, color: '#1c1c1e',
            border: 'none', outline: 'none', boxSizing: 'border-box',
          }}
        />
        <div style={{ textAlign: 'right', fontSize: 12, color: '#c7c7cc', marginTop: 4 }}>
          {nicknameInput.length}/20
        </div>
      </BottomSheet>

      <BottomSheet
        show={editingGroupUsername}
        title="修改群ID"
        onCancel={() => setEditingGroupUsername(false)}
        onSave={handleSaveGroupUsername}
        saving={savingGroupUsername}
      >
        <input
          ref={groupUsernameInputRef}
          type="text"
          value={groupUsernameInput}
          onChange={e => setGroupUsernameInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
          placeholder="设置公开群ID，例如 AAAAA"
          maxLength={32}
          onKeyDown={e => e.key === 'Enter' && handleSaveGroupUsername()}
          style={{
            width: '100%', background: '#f2f2f7', borderRadius: 12,
            padding: '12px 16px', fontSize: 14, color: '#1c1c1e',
            border: 'none', outline: 'none', boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 8, lineHeight: 1.6 }}>
          以字母开头，5-32 位字母数字下划线。设置后将显示为 @{groupUsernameInput || '群ID'}。
        </div>
      </BottomSheet>

      {/* ========== 编辑群名称 ========== */}
      <BottomSheet
        show={editingGroupName}
        title="修改群名称"
        onCancel={() => setEditingGroupName(false)}
        onSave={handleSaveGroupName}
        saving={savingGroupName}
      >
        <input
          ref={groupNameInputRef}
          type="text"
          value={groupNameInput}
          onChange={e => setGroupNameInput(e.target.value)}
          placeholder="输入群名称"
          maxLength={30}
          onKeyDown={e => e.key === 'Enter' && handleSaveGroupName()}
          style={{
            width: '100%', background: '#f2f2f7', borderRadius: 12,
            padding: '12px 16px', fontSize: 14, color: '#1c1c1e',
            border: 'none', outline: 'none', boxSizing: 'border-box',
          }}
        />
        <div style={{ textAlign: 'right', fontSize: 12, color: '#c7c7cc', marginTop: 4 }}>
          {groupNameInput.length}/30
        </div>
      </BottomSheet>

      {/* ========== 编辑群公告 ========== */}
      <BottomSheet
        show={editingAnnouncement}
        title="群公告"
        onCancel={() => setEditingAnnouncement(false)}
        onSave={handleSaveAnnouncement}
        saving={savingAnnouncement}
      >
        <textarea
          value={announcementInput}
          onChange={e => setAnnouncementInput(e.target.value)}
          placeholder="输入群公告内容"
          maxLength={500}
          rows={5}
          style={{
            width: '100%', background: '#f2f2f7', borderRadius: 12,
            padding: '12px 16px', fontSize: 14, color: '#1c1c1e',
            border: 'none', outline: 'none', resize: 'none', boxSizing: 'border-box',
          }}
        />
        <div style={{ textAlign: 'right', fontSize: 12, color: '#c7c7cc', marginTop: 4 }}>
          {announcementInput.length}/500
        </div>
      </BottomSheet>

      <input
        ref={avatarFileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
        onChange={handleAvatarSelect}
        style={{ display: 'none' }}
      />

      {/* ========== 确认对话框 ========== */}
      <ConfirmDialog
        show={showConfirmLeave}
        title={isOwner ? '解散群聊' : '退出群聊'}
        desc={isOwner ? '解散后群聊将永久删除，无法恢复。' : '退出后将不再收到该群消息。'}
        confirmText={isOwner ? '解散' : '退出'}
        onCancel={() => setShowConfirmLeave(false)}
        onConfirm={() => { setShowConfirmLeave(false); onLeaveGroup(); }}
      />
      <ConfirmDialog
        show={showConfirmClear}
        title="清空聊天记录"
        desc="清空后将无法恢复，确认清空？"
        confirmText="清空"
        onCancel={() => setShowConfirmClear(false)}
        onConfirm={() => { setShowConfirmClear(false); onClearMessages(); }}
      />
    </motion.div>
  );

  return ReactDOM.createPortal(content, document.body);
};

export default GroupInfoSheet;
