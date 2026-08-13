/**
 * 个人资料设置页面 — 精致升级版
 * 统一 dove 主题、精致圆角卡片、优雅动画
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, ChevronLeft, Camera, User,
  MapPin, Phone, Hash, QrCode, Scan, PenLine, Calendar,
  Check, X, ChevronDown, Link
} from 'lucide-react';
import { toast } from 'sonner';
import { CURRENT_USER, syncCurrentUserProfile } from '@/lib/store';
import RegionPicker from '@/components/RegionPicker';
import { authApi, authFetch } from '@/lib/authFetch';
import { DoveAvatar } from '@/components/DoveAvatar';
import { QRCardModal } from '@/components/QRCodeCard';
async function uploadFileToLocal(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
        const res = await authFetch('/api/media/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataBase64: base64, mimeType: file.type, mediaType, source: 'avatar' }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '上传失败');
        resolve(data.url);
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

async function uploadFileToCos(file: File, prefix: string): Promise<string> {
  try {
    const stsData = await authApi('/api/cos/sts', undefined, 'GET');
    const { credentials, bucket, region, baseUrl, avatarFolder, expiredTime } = stsData || {};
    if (credentials?.tmpSecretId && credentials?.tmpSecretKey && credentials?.sessionToken && bucket && region && baseUrl && avatarFolder) {
      const COS = (await import('cos-js-sdk-v5')).default;
      const cos = new COS({
        getAuthorization: (_options: any, callback: any) => {
          callback({
            TmpSecretId: credentials.tmpSecretId,
            TmpSecretKey: credentials.tmpSecretKey,
            SecurityToken: credentials.sessionToken,
            ExpiredTime: expiredTime,
          });
        },
      });
      const rawExt = file.name.split('.').pop() || file.type.split('/').pop() || 'jpg';
      const safeExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      // 头像目录结构：imimchat/头像/用户ID/{fileName}
      const key = `${avatarFolder}/${prefix}_${Date.now()}.${safeExt}`;
      return await new Promise<string>((resolve, reject) => {
        cos.uploadFile(
          { Bucket: bucket, Region: region, Key: key, Body: file },
          (err: any) => {
            if (err) reject(new Error(err.message || 'COS上传失败'));
            else resolve(`${String(baseUrl).replace(/\/$/, '')}/${key}`);
          }
        );
      });
    }
  } catch (cosErr) {
    console.warn('[profile] COS 上传不可用，回退本地上传:', cosErr);
  }
  return uploadFileToLocal(file);
}

// ============ 类型 ============

interface UserProfile {
  id: string;
  name: string;
  nickname: string;
  gender: string;
  region: string;
  phone: string;
  email: string;
  wechatId: string;
  bio: string;
  avatar: string;
  birthday: string;
  updatedAt?: number;
}

// ============ 内联编辑页（全屏滑入） ============

const EditFieldPage: React.FC<{
  title: string;
  value: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  maxLength?: number;
  onClose: () => void;
  onSave: (val: string) => Promise<boolean>;
}> = ({ title, value, placeholder, hint, multiline, maxLength = 30, onClose, onSave }) => {
  const [val, setVal] = useState(value);
  const [submitting, setSubmitting] = useState(false);

  const handleDone = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const ok = await onSave(val.trim());
      if (ok) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 300 }}
      className="fixed inset-0 z-50 settings-page flex flex-col"
      style={{ maxWidth: '480px', margin: '0 auto' }}
    >
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between px-4 py-3.5 glass-effect border-b border-border/30">
        <button onClick={onClose} disabled={submitting} className="flex items-center gap-1 text-dove-green">
          <ChevronLeft size={20} />
          <span className="text-sm font-medium">取消</span>
        </button>
        <h2 className="text-sm font-semibold text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>{title}</h2>
        <button
          onClick={handleDone}
          disabled={submitting}
          className="text-sm text-dove-green font-semibold disabled:opacity-50"
        >
          {submitting ? '保存中...' : '完成'}
        </button>
      </div>

      {/* 输入区域 */}
      <div className="p-4 mt-2">
        <div className="dove-card px-4 py-3.5">
          {multiline ? (
            <textarea
              value={val}
              onChange={e => setVal(e.target.value)}
              placeholder={placeholder}
              maxLength={maxLength}
              rows={4}
              className="w-full text-sm text-dove-ink outline-none resize-none bg-transparent placeholder-muted-foreground/40"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={val}
                onChange={e => setVal(e.target.value)}
                placeholder={placeholder}
                maxLength={maxLength}
                className="flex-1 text-sm text-dove-ink outline-none bg-transparent placeholder-muted-foreground/40"
                autoFocus
              />
              {val && (
                <button onClick={() => setVal('')} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                  <X size={16} />
                </button>
              )}
            </div>
          )}
        </div>
        {hint && <p className="text-[11px] text-muted-foreground/50 mt-2 px-1">{hint}</p>}
        {maxLength && (
          <p className="text-[11px] text-muted-foreground/40 mt-1 px-1 text-right tabular-nums">{val.length}/{maxLength}</p>
        )}
      </div>
    </motion.div>
  );
};

// ============ 性别选择底部弹窗 ============

const GenderPicker: React.FC<{
  value: string;
  onClose: () => void;
  onSelect: (val: string) => void;
}> = ({ value, onClose, onSelect }) => {
  const options = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
    { value: 'other', label: '保密' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="dove-sheet-backdrop"
      style={{ maxWidth: '480px', margin: '0 auto' }}
    >
      <div className="dove-sheet-overlay" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="dove-sheet-content pb-8"
      >
        <div className="dove-sheet-handle" />
        <div className="flex items-center justify-between px-5 py-3">
          <button onClick={onClose} className="text-sm text-muted-foreground/60 font-medium">取消</button>
          <h3 className="text-sm font-semibold text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>性别</h3>
          <div className="w-10" />
        </div>
        <div className="mx-4 settings-group">
          {options.map((opt, i) => (
            <button
              key={opt.value}
              onClick={() => { onSelect(opt.value); onClose(); }}
              className="settings-item w-full"
            >
              <span className="text-sm text-dove-ink">{opt.label}</span>
              {value === opt.value && <Check size={16} className="text-dove-green" />}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

// ============ 头像选择底部弹窗 ============

const AvatarPicker: React.FC<{
  onClose: () => void;
  onSelect: (url: string) => void;
}> = ({ onClose, onSelect }) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('头像图片不能超过 5MB');
      return;
    }
    try {
      const url = await uploadFileToCos(file, 'avatar');
      onSelect(url);
      onClose();
    } catch (error: any) {
      toast.error(error?.message || '头像上传失败');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="dove-sheet-backdrop"
      style={{ maxWidth: '480px', margin: '0 auto' }}
    >
      <div className="dove-sheet-overlay" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="dove-sheet-content pb-8"
      >
        <div className="dove-sheet-handle" />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        <div className="mx-4 mt-3 settings-group">
          <button
            onClick={() => fileRef.current?.click()}
            className="settings-item w-full gap-3"
          >
            <div className="w-8 h-8 rounded-xl bg-dove-green/8 flex items-center justify-center">
              <Camera size={16} className="text-dove-green" />
            </div>
            <span className="text-sm text-dove-ink">从相册选择</span>
          </button>
          <button
            onClick={() => { toast('拍照功能需要原生 App 支持'); onClose(); }}
            className="settings-item w-full gap-3"
          >
            <div className="w-8 h-8 rounded-xl bg-dove-bamboo/8 flex items-center justify-center">
              <Scan size={16} className="text-dove-bamboo" />
            </div>
            <span className="text-sm text-dove-ink">拍一张</span>
          </button>
        </div>
        <div className="mx-4 mt-3 settings-group">
          <button onClick={onClose} className="w-full py-3.5 text-sm text-muted-foreground/60 hover:bg-dove-mist transition-colors text-center font-medium">
            取消
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ============ 主页面 ============

interface ProfileSettingsPageProps {
  onClose: () => void;
  onProfileUpdate?: (profile: UserProfile) => void;
}

export default function ProfileSettingsPage({ onClose, onProfileUpdate }: ProfileSettingsPageProps) {
  const [profile, setProfile] = useState<UserProfile>({
    id: CURRENT_USER.id || 'me',
    name: CURRENT_USER.name || '用户',
    nickname: CURRENT_USER.name || '用户',
    gender: '',
    region: '',
    phone: '',
    email: '',
    wechatId: CURRENT_USER.uniqueId || CURRENT_USER.id || 'me',
    bio: CURRENT_USER.bio || '',
    avatar: '',
    birthday: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editField, setEditField] = useState<{
    key: keyof UserProfile;
    title: string;
    placeholder?: string;
    hint?: string;
    multiline?: boolean;
    maxLength?: number;
  } | null>(null);
  const [showGender, setShowGender] = useState(false);
  const [showRegion, setShowRegion] = useState(false);
  const [showAvatar, setShowAvatar] = useState(false);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    Promise.all([
      authFetch(`/api/profile?userId=${CURRENT_USER.id || 'me'}`).then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || '加载资料失败');
        return data;
      }),
      authFetch('/api/auth/me').then(async (r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([profileRes, meRes]) => {
        const profile = profileRes?.profile || {};
        const me = meRes?.user || {};
        setProfile(prev => ({
          ...prev,
          ...profile,
          gender: me.gender ?? profile.gender ?? prev.gender,
          region: me.region ?? profile.region ?? prev.region,
          birthday: me.birthday ?? profile.birthday ?? prev.birthday,
          phone: me.phone ?? profile.phone ?? prev.phone,
          email: me.email ?? profile.email ?? prev.email,
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const saveField = async (key: keyof UserProfile, value: string): Promise<boolean> => {
    const updated = { ...profile, [key]: value };
    setSaving(true);
    try {
      const response = await authFetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: updated.name || updated.nickname,
          avatar: updated.avatar,
          bio: updated.bio,
          username: updated.wechatId,
          gender: updated.gender,
          region: updated.region,
          birthday: updated.birthday,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '保存失败，请重试');
      }

      // 修复：wechatId 优先使用用户输入的新属为准，防止后端 session 缓存导致返回旧属导致前端显示旧展示
      // 优先级：用户输入的新属 (updated.wechatId) > 后端返回的 profile.wechatId > 后端返回的 user.username
      const savedProfile: UserProfile = {
        ...updated,
        ...(data.profile || {}),
        wechatId: key === 'wechatId' ? updated.wechatId : (data.profile?.wechatId || data.user?.username || updated.wechatId),
        name: data.profile?.name || data.profile?.nickname || updated.name,
        nickname: data.profile?.nickname || data.profile?.name || updated.nickname,
        gender: data.profile?.gender ?? data.user?.gender ?? updated.gender,
        region: data.profile?.region ?? data.user?.region ?? updated.region,
        birthday: data.profile?.birthday ?? data.user?.birthday ?? updated.birthday,
        updatedAt: data.profile?.updatedAt ?? data.user?.updatedAt ?? updated.updatedAt,
      };

      setProfile(savedProfile);
      syncCurrentUserProfile({
        nickname: savedProfile.nickname || savedProfile.name,
        uniqueId: savedProfile.wechatId,
        avatar: savedProfile.avatar,
        bio: savedProfile.bio,
        phone: savedProfile.phone,
        email: savedProfile.email,
        profileUpdatedAt: savedProfile.updatedAt,
      });
      onProfileUpdate?.(savedProfile);
      toast.success('已保存');
      return true;
    } catch (error: any) {
      toast.error(error?.message || '保存失败，请重试');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const genderLabel = { male: '男', female: '女', other: '保密', '': '未填写' }[profile.gender] || '未填写';

  const ListItem: React.FC<{
    label: string;
    value?: React.ReactNode;
    onClick?: () => void;
    showArrow?: boolean;
    last?: boolean;
  }> = ({ label, value, onClick, showArrow = true, last }) => (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="settings-item w-full"
    >
      <span className="text-sm text-dove-ink flex-shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0 ml-4">
        {typeof value === 'string' ? (
          <span className="text-sm text-muted-foreground/50 truncate max-w-[180px]">{value || '未填写'}</span>
        ) : value}
        {showArrow && onClick && <ChevronRight size={14} className="text-muted-foreground/30 flex-shrink-0" />}
      </div>
    </button>
  );

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 300 }}
      className="fixed inset-0 z-40 settings-page flex flex-col overflow-y-auto"
      style={{ maxWidth: '480px', margin: '0 auto' }}
    >
      {/* 顶部导航 */}
      <div className="flex items-center justify-between px-3 py-3.5 glass-effect border-b border-border/30 flex-shrink-0 sticky top-0 z-10">
        <button onClick={onClose} className="flex items-center gap-1 text-dove-green">
          <ChevronLeft size={20} />
          <span className="text-sm font-medium">返回</span>
        </button>
        <h2 className="text-sm font-semibold text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>个人资料</h2>
        <div className="w-14" />
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-dove-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 py-4 space-y-3 px-4">

          {/* 第一组：头像 */}
          <div className="settings-group">
            <button
              onClick={() => setShowAvatar(true)}
              className="settings-item w-full"
            >
              <span className="text-sm text-dove-ink">头像</span>
              <div className="flex items-center gap-2">
                {profile.avatar ? (
                  <img
                    src={profile.avatar}
                    alt="头像"
                    className="w-14 h-14 rounded-xl object-cover shadow-soft-sm"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl overflow-hidden shadow-soft-sm">
                    <DoveAvatar name={profile.name} id={profile.id} size="xl" />
                  </div>
                )}
                <ChevronRight size={14} className="text-muted-foreground/30" />
              </div>
            </button>
          </div>

          {/* 第二组：基本信息 */}
          <div className="settings-group">
            <ListItem
              label="名字"
              value={profile.name}
              onClick={() => setEditField({ key: 'name', title: '名字', placeholder: '请输入名字', maxLength: 20 })}
            />
            <ListItem
              label="性别"
              value={genderLabel}
              onClick={() => setShowGender(true)}
            />
            <ListItem
              label="地区"
              value={profile.region || '未填写'}
              onClick={() => setShowRegion(true)}
            />
            <ListItem
              label="手机号"
              value={profile.phone ? profile.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : ''}
              onClick={() => setEditField({ key: 'phone', title: '手机号', placeholder: '请输入手机号', hint: '手机号仅自己可见', maxLength: 20 })}
            />
            <ListItem
              label="邮箱"
              value={profile.email ? profile.email.replace(/(.{2}).*(@.*)/, '$1****$2') : ''}
              onClick={() => setEditField({ key: 'email', title: '邮箱', placeholder: '请输入邮箱地址', hint: '邮箱仅自己可见', maxLength: 50 })}
              last
            />
          </div>

          {/* 第三组：账号信息 */}
          <div className="settings-group">
            <ListItem
              label="账号ID"
              value={profile.wechatId}
              onClick={() => setEditField({ key: 'wechatId', title: '账号ID', placeholder: '请输入账号ID', hint: '账号ID全局唯一，设置后可更改', maxLength: 20 })}
            />
            <ListItem
              label="我的二维码"
              value={
                <div className="w-6 h-6 text-muted-foreground/40">
                  <QrCode size={20} />
                </div>
              }
              onClick={() => setShowQR(true)}
            />
            <ListItem
              label="我的外链"
              value={
                <div className="w-6 h-6 text-muted-foreground/40">
                  <Link size={20} />
                </div>
              }
              onClick={() => {
                const username = profile.wechatId || CURRENT_USER.username;
                const link = `https://wed.imim.chat/im/${username}`;
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(link).then(() => toast.success('外链已复制: ' + link)).catch(() => toast.error('复制失败'));
                } else {
                  const input = document.createElement('input');
                  input.value = link;
                  document.body.appendChild(input);
                  input.select();
                  document.execCommand('copy');
                  document.body.removeChild(input);
                  toast.success('外链已复制: ' + link);
                }
              }}
            />
            <ListItem
              label="拍一拍"
              value={
                <span className="text-sm text-muted-foreground/40 italic">ℹ</span>
              }
              onClick={() => toast('拍一拍功能开发中')}
              last
            />
          </div>

          {/* 第四组：签名 */}
          <div className="settings-group">
            <ListItem
              label="签名"
              value={profile.bio || '未填写'}
              onClick={() => setEditField({ key: 'bio', title: '签名', placeholder: '请输入签名', multiline: true, maxLength: 100 })}
              last
            />
          </div>

          {/* 第五组：其他 */}
          <div className="settings-group">
            <ListItem
              label="来电铃声"
              onClick={() => toast('来电铃声功能开发中')}
            />
            <ListItem
              label="我的地址"
              onClick={() => toast('地址管理功能开发中')}
            />
            <ListItem
              label="我的发票抬头"
              onClick={() => toast('发票抬头功能开发中')}
              last
            />
          </div>

        </div>
      )}

      {/* 保存中提示 */}
      <AnimatePresence>
        {saving && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-dove-ink/80 text-white text-xs px-5 py-2.5 rounded-full shadow-soft-lg backdrop-blur-sm"
          >
            保存中...
          </motion.div>
        )}
      </AnimatePresence>

      {/* 文字编辑页 */}
      <AnimatePresence>
        {editField && (
          <EditFieldPage
            title={editField.title}
            value={String(profile[editField.key] || '')}
            placeholder={editField.placeholder}
            hint={editField.hint}
            multiline={editField.multiline}
            maxLength={editField.maxLength}
            onClose={() => setEditField(null)}
            onSave={val => saveField(editField.key, val)}
          />
        )}
      </AnimatePresence>

      {/* 性别选择 */}
      <AnimatePresence>
        {showGender && (
          <GenderPicker
            value={profile.gender}
            onClose={() => setShowGender(false)}
            onSelect={val => saveField('gender', val)}
          />
        )}
      </AnimatePresence>

      {/* 地区选择 */}
      <AnimatePresence>
        {showRegion && (
          <RegionPicker
            value={profile.region}
            onClose={() => setShowRegion(false)}
            onSelect={val => saveField('region', val)}
          />
        )}
      </AnimatePresence>

      {/* 头像选择 */}
      <AnimatePresence>
        {showAvatar && (
          <AvatarPicker
            onClose={() => setShowAvatar(false)}
            onSelect={async (val) => {
              // 先即刻本地 + 全局广播，让个人资料页、侧边栏、聊天页等其他场景
              // 头像立即刷新（无需等后端返回）。后端保存后会以同名事件再刷新一次。
              setProfile(prev => ({ ...prev, avatar: val }));
              syncCurrentUserProfile({ avatar: val });
              await saveField('avatar', val);
            }}
          />
        )}
      </AnimatePresence>

      {/* 二维码 */}
      <AnimatePresence>
        {showQR && <QRCardModal onClose={() => setShowQR(false)} />}
      </AnimatePresence>
    </motion.div>
  );
}
