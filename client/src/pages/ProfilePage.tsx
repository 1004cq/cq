/**
 * imim 个人中心页面 — 精致升级版
 * 统一 dove 主题、精致卡片、优雅动画、集成 E2EE 密钥管理
 */
import React, { useState, useEffect } from 'react';
import { QRCardModal } from '@/components/QRCodeCard';
import ProfileSettingsPage from '@/pages/ProfileSettingsPage';
import { CURRENT_USER } from '@/lib/store';
import { authFetch } from '@/lib/authFetch';
import { DoveAvatar } from '@/components/DoveAvatar';
import { useAppActions } from '@/contexts/AppContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useE2EE } from '@/hooks/useE2EE';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, Shield, Bell, Moon, Sun, SunMoon, Palette, HelpCircle,
  Info, LogOut, QrCode, Bookmark, Settings, Globe, Database,
  Lock, Smartphone, Eye, Trash2, Download, MessageSquare, X,
  Volume2, Wifi, ShieldCheck, Key, Fingerprint, RefreshCw,
  CheckCircle2, AlertCircle, Hash, AtSign, Phone, Mail, Edit3,
  Plus, Unlink, ArrowLeftRight, Check
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPermissionState,
  loadNotificationPreferences,
  requestBrowserNotificationPermission,
  type NotificationPreferences,
  updateNotificationPreferences,
  warmupNotificationAudio,
} from '@/lib/notifications';

// ============ 账号设置弹窗 ============
const AccountSettingModal: React.FC<{
  type: 'id' | 'phone' | 'email';
  currentValue?: string;
  onClose: () => void;
  onSave: (val: string) => void;
}> = ({ type, currentValue, onClose, onSave }) => {
  const [step, setStep] = React.useState<'main' | 'edit' | 'verify' | 'new'>('main');
  const [inputVal, setInputVal] = React.useState('');
  const [verifyCode, setVerifyCode] = React.useState('');
  const [newVal, setNewVal] = React.useState('');
  const [codeSent, setCodeSent] = React.useState(false);
  const [countdown, setCountdown] = React.useState(0);

  React.useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [countdown]);

  const sendCode = () => {
    setCodeSent(true);
    setCountdown(60);
    toast('验证码已发送', { description: '演示模式，输入任意内容即可' });
  };

  const config = {
    id: { icon: AtSign, label: '账号ID', placeholder: '输入新的账号ID（最短1位）', hint: '账号ID全局唯一，区分大小写，设置后可更改', color: 'text-dove-green' },
    phone: { icon: Phone, label: '手机号', placeholder: '输入新手机号', hint: '换绑需验证原手机号', color: 'text-blue-500' },
    email: { icon: Mail, label: '邮箱', placeholder: '输入邮箱地址', hint: '邮箱可用于找回账号和搜索', color: 'text-purple-500' },
  }[type];
  const Icon = config.icon;

  const handleAction = (action: 'set' | 'change' | 'unbind') => {
    if (action === 'unbind') {
      toast(`${config.label}已解绑`);
      onSave('');
      onClose();
      return;
    }
    if (type === 'id') {
      setStep('edit');
    } else {
      if (currentValue && action === 'change') {
        setStep('verify');
      } else {
        setStep('new');
      }
    }
  };

  const handleVerifyConfirm = () => {
    if (!verifyCode.trim()) { toast.error('请输入验证码'); return; }
    setStep('new');
  };

  const handleSave = () => {
    const val = step === 'edit' ? inputVal : newVal;
    if (!val.trim()) { toast.error('内容不能为空'); return; }
    if (type === 'id' && val.trim().length < 1) { toast.error('ID最短1位'); return; }
    toast.success(`${config.label}已${currentValue ? '更新' : '设置'}`);
    onSave(val.trim());
    onClose();
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
        className="dove-sheet-content p-5 pb-8"
      >
        <div className="dove-sheet-handle mb-3" />
        {/* 标题 */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 rounded-xl bg-dove-warm-gray flex items-center justify-center">
            <Icon size={16} className={config.color} />
          </div>
          <h3 className="text-base font-semibold text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>
            {step === 'main' ? `管理${config.label}` :
             step === 'verify' ? `验证原${config.label}` :
             step === 'new' ? `设置新${config.label}` : `${currentValue ? '更改' : '设置'}${config.label}`}
          </h3>
          <button onClick={onClose} className="ml-auto dove-icon-btn w-7 h-7 bg-dove-warm-gray">
            <X size={14} className="text-dove-ink" />
          </button>
        </div>

        {/* 主操作页 */}
        {step === 'main' && (
          <div className="space-y-3">
            <div className="dove-card p-3.5 flex items-center gap-3">
              <Icon size={16} className={config.color} />
              <div className="flex-1">
                <p className="text-[10px] text-muted-foreground/60">{config.label}</p>
                <p className="text-sm font-medium text-dove-ink">{currentValue || '未设置'}</p>
              </div>
              {currentValue && <span className="text-[10px] text-dove-green bg-dove-green/8 px-2 py-0.5 rounded-full font-medium">已绑定</span>}
            </div>
            <p className="text-[10px] text-muted-foreground/50 px-1">{config.hint}</p>
            <div className="space-y-2 pt-1">
              <button
                onClick={() => handleAction(currentValue ? 'change' : 'set')}
                className="w-full flex items-center gap-3 px-4 py-3 bg-dove-green/8 rounded-xl hover:bg-dove-green/12 transition-colors"
              >
                {currentValue ? <ArrowLeftRight size={16} className="text-dove-green" /> : <Plus size={16} className="text-dove-green" />}
                <span className="text-sm text-dove-green font-medium">{currentValue ? `更改${config.label}` : `设置${config.label}`}</span>
              </button>
              {currentValue && type !== 'id' && (
                <button
                  onClick={() => handleAction('unbind')}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-dove-seal/8 rounded-xl hover:bg-dove-seal/12 transition-colors"
                >
                  <Unlink size={16} className="text-dove-seal" />
                  <span className="text-sm text-dove-seal font-medium">解绑{config.label}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 编辑ID页 */}
        {step === 'edit' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground/60 mb-1.5 block">新的账号ID</label>
              <input
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                placeholder="输入新ID（最短1位，全局唯一）"
                className="dove-input"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground/50 mt-1.5 px-1">区分大小写，只能包含字母、数字、下划线</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('main')} className="dove-btn-secondary flex-1 py-2.5">取消</button>
              <button onClick={handleSave} className="dove-btn-primary flex-1 py-2.5">保存</button>
            </div>
          </div>
        )}

        {/* 验证原手机号/邮箱 */}
        {step === 'verify' && (
          <div className="space-y-4">
            <div className="dove-card p-3 text-xs text-muted-foreground/70">
              为了安全，需要先验证原{config.label}：<span className="text-dove-ink font-medium">{currentValue}</span>
            </div>
            <div>
              <label className="text-xs text-muted-foreground/60 mb-1.5 block">验证码</label>
              <div className="flex gap-2">
                <input
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value)}
                  placeholder="输入验证码"
                  className="dove-input flex-1"
                />
                <button
                  onClick={sendCode}
                  disabled={countdown > 0}
                  className="px-3 py-2.5 bg-dove-green/8 rounded-xl text-xs text-dove-green disabled:opacity-50 whitespace-nowrap font-medium"
                >
                  {countdown > 0 ? `${countdown}s` : '发送验证码'}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('main')} className="dove-btn-secondary flex-1 py-2.5">取消</button>
              <button onClick={handleVerifyConfirm} className="dove-btn-primary flex-1 py-2.5">下一步</button>
            </div>
          </div>
        )}

        {/* 设置新值 */}
        {step === 'new' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground/60 mb-1.5 block">新的{config.label}</label>
              <input
                value={newVal}
                onChange={e => setNewVal(e.target.value)}
                placeholder={config.placeholder}
                type={type === 'phone' ? 'tel' : type === 'email' ? 'email' : 'text'}
                className="dove-input"
                autoFocus
              />
            </div>
            {type !== 'id' && (
              <div>
                <label className="text-xs text-muted-foreground/60 mb-1.5 block">验证码</label>
                <div className="flex gap-2">
                  <input
                    value={verifyCode}
                    onChange={e => setVerifyCode(e.target.value)}
                    placeholder="输入验证码"
                    className="dove-input flex-1"
                  />
                  <button
                    onClick={sendCode}
                    disabled={countdown > 0}
                    className="px-3 py-2.5 bg-dove-green/8 rounded-xl text-xs text-dove-green disabled:opacity-50 whitespace-nowrap font-medium"
                  >
                    {countdown > 0 ? `${countdown}s` : '发送验证码'}
                  </button>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setStep('main')} className="dove-btn-secondary flex-1 py-2.5">取消</button>
              <button onClick={handleSave} className="dove-btn-primary flex-1 py-2.5">确认保存</button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

interface MenuItem {
  icon: React.ElementType;
  label: string;
  desc?: string;
  color?: string;
  onClick?: () => void;
  toggle?: boolean;
  toggleValue?: boolean;
}

// 设置详情页 — 统一主题
const SettingDetail: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => {
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed inset-0 z-40 settings-page"
      style={{ maxWidth: '480px', margin: '0 auto' }}
    >
      <div className="flex items-center gap-2 px-3 py-3.5 glass-effect border-b border-border/30">
        <button onClick={onClose} className="dove-icon-btn">
          <ChevronRight size={20} className="text-dove-ink rotate-180" />
        </button>
        <h2 className="text-sm font-semibold text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>{title}</h2>
      </div>
      <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 56px)' }}>{children}</div>
    </motion.div>
  );
};

// E2EE 密钥管理页面
const KeyManagementPage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const e2ee = useE2EE();
  const [localFP, setLocalFP] = useState('');

  useEffect(() => {
    if (e2ee.isReady) {
      e2ee.getLocalFingerprint().then(setLocalFP);
    }
  }, [e2ee.isReady]);

  return (
    <SettingDetail title="密钥管理" onClose={onClose}>
      <div className="space-y-4">
        {/* E2EE 状态卡片 */}
        <div className="dove-card p-4 border border-dove-green/10 bg-dove-green/3">
          <div className="flex items-center gap-2.5 mb-3">
            {e2ee.isReady ? (
              <div className="w-8 h-8 rounded-lg bg-dove-green/10 flex items-center justify-center">
                <ShieldCheck size={18} className="text-dove-green" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <Shield size={18} className="text-amber-500" />
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-dove-ink">
                {e2ee.isReady ? 'Signal Protocol 已启用' : '正在初始化...'}
              </h3>
              <p className="text-[10px] text-muted-foreground/60">
                {e2ee.isReady ? '所有消息均使用端到端加密' : '密钥生成中，请稍候'}
              </p>
            </div>
          </div>

          {e2ee.status && (
            <div className="space-y-1.5 mt-3">
              {[
                { label: 'Registration ID', value: e2ee.status.registrationId },
                { label: 'Identity Key 指纹', value: localFP || '加载中...' },
                { label: '活跃会话', value: e2ee.status.totalSessions },
                { label: '剩余 PreKeys', value: e2ee.status.totalPreKeys },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-3 py-2 bg-white/70 rounded-lg">
                  <span className="text-[10px] text-muted-foreground/60">{label}</span>
                  <span className="text-[10px] font-mono text-dove-ink">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 协议技术详情 */}
        <div className="dove-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30">
            <h4 className="text-xs font-semibold text-dove-ink flex items-center gap-2">
              <Hash size={12} className="text-dove-bamboo" />
              加密协议详情
            </h4>
          </div>
          <div className="p-3 space-y-1.5">
            {[
              { label: '协议', value: 'Signal Protocol' },
              { label: '密钥交换', value: 'X3DH (Extended Triple DH)' },
              { label: '消息加密', value: 'Double Ratchet Algorithm' },
              { label: 'ECDH 曲线', value: 'NIST P-256' },
              { label: '对称加密', value: 'AES-256-GCM' },
              { label: '密钥派生', value: 'HKDF-SHA256' },
              { label: '前向安全', value: 'PFS' },
              { label: '后泄露安全', value: 'PCS' },
              { label: '密钥存储', value: 'IndexedDB (本地)' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-3 py-1.5 bg-dove-warm-gray/30 rounded-lg">
                <span className="text-[10px] text-muted-foreground/60">{label}</span>
                <span className="text-[10px] text-dove-ink font-mono">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Identity Key 导出 */}
        <div className="dove-card p-4">
          <h4 className="text-xs font-semibold text-dove-ink flex items-center gap-2 mb-3">
            <Key size={12} className="text-dove-bamboo" />
            Identity Key (公钥)
          </h4>
          <div className="bg-dove-ink/95 rounded-xl p-3.5">
            <p className="text-[9px] font-mono text-green-400/80 break-all leading-relaxed">
              {e2ee.status?.identityKey
                ? e2ee.status.identityKey.slice(0, 80) + '...'
                : '密钥加载中...'}
            </p>
          </div>
          <button
            onClick={() => {
              if (e2ee.status?.identityKey) {
                navigator.clipboard?.writeText(e2ee.status.identityKey);
                toast('Identity Key 已复制到剪贴板');
              }
            }}
            className="mt-2.5 w-full dove-btn-secondary py-2 text-[11px]"
          >
            复制公钥
          </button>
        </div>

        {/* 危险操作 */}
        <div className="dove-card p-4">
          <h4 className="text-xs font-semibold text-dove-seal flex items-center gap-2 mb-3">
            <AlertCircle size={12} />
            危险操作
          </h4>
          <p className="text-[10px] text-muted-foreground/60 mb-3 leading-relaxed">
            重置密钥将清除所有加密会话，需要与联系人重新建立加密连接。此操作不可撤销。
          </p>
          <button
            onClick={() => {
              toast('密钥已重置', { description: '所有加密会话已清除' });
            }}
            className="w-full py-2.5 bg-dove-seal/8 rounded-xl text-xs text-dove-seal hover:bg-dove-seal/12 transition-colors flex items-center justify-center gap-2 font-medium"
          >
            <RefreshCw size={12} />
            重置所有密钥
          </button>
        </div>
      </div>
    </SettingDetail>
  );
};

export default function ProfilePage() {
  const { logout } = useAppActions();
  const e2ee = useE2EE();
  const { theme, mode, toggleTheme, setMode } = useTheme();
  const darkMode = theme === 'dark';
  const [showQR, setShowQR] = useState(false);
  const [showSetting, setShowSetting] = useState<string | null>(null);
  const [showKeyMgmt, setShowKeyMgmt] = useState(false);
  // 字体大小：12-18px
  const [fontSize, setFontSize] = useState<number>(() => {
    return Number(localStorage.getItem('imim_font_size') || '14');
  });
  // 聊天背景
  const [chatBg, setChatBg] = useState<string>(() => {
    return localStorage.getItem('imim_chat_bg') || 'default';
  });
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => getNotificationPermissionState());
  const [accountModal, setAccountModal] = useState<'id' | 'phone' | 'email' | null>(null);
  const [userUniqueId, setUserUniqueId] = useState(CURRENT_USER.uniqueId || '');
  const [userPhone, setUserPhone] = useState(CURRENT_USER.phone || '');
  const [userEmail, setUserEmail] = useState(CURRENT_USER.email || '');
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [myDevices, setMyDevices] = useState<Array<{deviceType: string; browser: string; os: string; ip: string; connectedAt: number}>>([]);
  const [dynamicProfile, setDynamicProfile] = useState<{
    name: string;
    wechatId: string;
    avatar: string;
  } | null>(null);

  const fetchDynamicProfile = () => {
    authFetch(`/api/profile?userId=${CURRENT_USER.id || 'me'}`)
      .then(r => r.json())
      .then(d => {
        if (d.profile) {
          setDynamicProfile({
            name: d.profile.nickname || d.profile.name || CURRENT_USER.name,
            wechatId: d.profile.wechatId || d.profile.id || CURRENT_USER.uniqueId || CURRENT_USER.id,
            avatar: d.profile.avatar || '',
          });
          setUserUniqueId(d.profile.wechatId || d.profile.username || CURRENT_USER.uniqueId || '');
          setUserPhone(d.profile.phone || '');
          setUserEmail(d.profile.email || '');
        }
      })
      .catch(() => {});
  };

  // 加载当前登录设备列表
  const fetchMyDevices = () => {
    const userId = CURRENT_USER.id || localStorage.getItem('user_id');
    if (!userId) return;
    authFetch(`/api/users/${userId}/presence`)
      .then(r => r.json())
      .then(d => { if (d.devices) setMyDevices(d.devices); })
      .catch(() => {});
  };

  useEffect(() => {
    fetchDynamicProfile();
    fetchMyDevices();

    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ nickname?: string; uniqueId?: string; avatar?: string; phone?: string; email?: string }>).detail;
      setUserUniqueId(detail?.uniqueId || CURRENT_USER.uniqueId || '');
      setUserPhone(detail?.phone || CURRENT_USER.phone || '');
      setUserEmail(detail?.email || CURRENT_USER.email || '');
      // 注意：avatar 使用 detail 中明确传入的值（可能是新上传的头像 URL），
      // 仅在 detail.avatar === undefined 时才使用 prev/CURRENT_USER 作为兑底
      setDynamicProfile(prev => ({
        name: detail?.nickname || prev?.name || CURRENT_USER.name,
        wechatId: detail?.uniqueId || prev?.wechatId || CURRENT_USER.uniqueId || CURRENT_USER.id,
        avatar: (detail?.avatar !== undefined ? detail.avatar : (prev?.avatar ?? CURRENT_USER.avatar)) || '',
      }));
    };

    window.addEventListener('cqim:user-profile-updated', handleProfileUpdated as EventListener);
    return () => {
      window.removeEventListener('cqim:user-profile-updated', handleProfileUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    setNotificationPrefs(loadNotificationPreferences());
    setNotificationPermission(getNotificationPermissionState());
  }, []);

  const updatePrefs = (patch: Partial<NotificationPreferences>, successText = '设置已更新') => {
    const next = updateNotificationPreferences(patch);
    setNotificationPrefs(next);
    setNotificationPermission(getNotificationPermissionState());
    toast.success(successText);
  };

  const handleNotificationToggle = async (key: keyof NotificationPreferences, enabled: boolean, successText: string) => {
    if (key === 'enabled' && enabled) {
      await warmupNotificationAudio();
    }

    if (key === 'browserEnabled' && enabled) {
      const permission = await requestBrowserNotificationPermission();
      setNotificationPermission(permission);
      if (permission === 'denied') {
        toast.error('浏览器通知权限被拒绝，请在浏览器设置中手动开启');
        return;
      }
      if (permission === 'unsupported') {
        toast.error('当前浏览器环境不支持系统通知');
        return;
      }
    }

    if (key === 'soundEnabled' && enabled) {
      await warmupNotificationAudio();
    }

    updatePrefs({ [key]: enabled }, successText);
  };

  const menuGroups: MenuItem[][] = [
    [
      { icon: Shield, label: '账号与安全', desc: '密钥管理、Safety Number', color: 'text-dove-green',
        onClick: () => setShowSetting('security') },
      { icon: QrCode, label: '我的二维码', color: 'text-dove-bamboo',
        onClick: () => setShowQR(true) },
    ],
    [
      { icon: Bookmark, label: '收藏', color: 'text-amber-600',
        onClick: () => toast('收藏夹为空') },
      { icon: Settings, label: '通用设置', color: 'text-dove-ink',
        onClick: () => setShowSetting('general') },
      { icon: Bell, label: '消息通知', desc: notificationPrefs.enabled ? '已开启' : '已关闭', color: 'text-dove-seal',
        onClick: () => setShowSetting('notification') },
      { icon: Palette, label: '外观', desc: darkMode ? '深色模式' : '浅色模式', color: 'text-purple-600',
        onClick: () => setShowSetting('appearance') },
    ],
    [
      { icon: Database, label: '存储空间', desc: '23.5 MB', color: 'text-blue-500',
        onClick: () => toast('存储管理', { description: '聊天记录: 15.2 MB\n媒体文件: 8.3 MB' }) },
      { icon: Globe, label: '语言', desc: '简体中文', color: 'text-teal-600',
        onClick: () => toast('当前语言: 简体中文') },
      { icon: Lock, label: '隐私', color: 'text-rose-500',
        onClick: () => setShowSetting('privacy') },
    ],
    [
      { icon: HelpCircle, label: '帮助与反馈', color: 'text-dove-bamboo',
        onClick: () => toast('帮助中心', { description: '如有问题请联系客服' }) },
      { icon: Info, label: '关于 imim', desc: 'v2.0', color: 'text-muted-foreground',
        onClick: () => setShowSetting('about') },
    ],
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto settings-page">
      {/* 顶部个人信息卡片 */}
      <div className="bg-white shadow-soft-sm">
        <div className="px-5 pt-10 pb-5">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4"
          >
            {/* 头像 */}
            <button
              onClick={() => setShowProfileSettings(true)}
              className="relative flex-shrink-0 active:opacity-70 transition-opacity"
            >
              <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-soft-md ring-1 ring-black/5">
                <DoveAvatar name={dynamicProfile?.name || CURRENT_USER.name} id={CURRENT_USER.id} avatar={dynamicProfile?.avatar || CURRENT_USER.avatar} size="xl" />
              </div>
            </button>

            {/* 昵称 + 账号ID */}
            <button
              onClick={() => setShowProfileSettings(true)}
              className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
            >
              <h2 className="text-[22px] font-bold text-dove-ink leading-tight tracking-wide" style={{ fontFamily: 'var(--font-wenkai)' }}>
                {dynamicProfile?.name || CURRENT_USER.name}
              </h2>
              <div className="flex items-center gap-1 mt-1.5">
                <span className="text-[12px] text-muted-foreground/50">账号：</span>
                <span className="text-[12px] text-muted-foreground/70">{dynamicProfile?.wechatId || CURRENT_USER.uniqueId || CURRENT_USER.id || 'me'}</span>
                <ChevronRight size={13} className="text-muted-foreground/30 ml-0.5" />
              </div>
            </button>

            {/* 二维码图标 */}
            <button
              onClick={() => setShowQR(true)}
              className="dove-icon-btn flex-shrink-0"
            >
              <QrCode size={20} className="text-muted-foreground/50" />
            </button>
          </motion.div>

          {/* 状态按钮行 */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="flex items-center gap-3 mt-4"
          >
            <button
              onClick={() => toast('状态功能开发中')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-border/60 bg-white hover:bg-dove-mist transition-colors"
            >
              <Plus size={12} className="text-muted-foreground/60" />
              <span className="text-[11px] text-muted-foreground/70 font-medium">状态</span>
            </button>
            <button
              onClick={() => toast('在线状态设置开发中')}
              className="w-7 h-7 rounded-full border border-border/60 bg-white hover:bg-dove-mist transition-colors flex items-center justify-center"
            >
              <div className="w-2.5 h-2.5 rounded-full border-2 border-muted-foreground/40" />
            </button>
            <div className="flex items-center gap-1 ml-auto">
              {e2ee.isReady ? (
                <>
                  <ShieldCheck size={11} className="text-dove-green/70" />
                  <span className="text-[10px] text-dove-green/70 font-medium">E2EE</span>
                </>
              ) : (
                <span className="text-[10px] text-muted-foreground/40">加密初始化中</span>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* 菜单列表 */}
      <div className="px-4 space-y-3 pt-4 pb-8">
        {menuGroups.map((group, gi) => (
          <motion.div
            key={gi}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 + gi * 0.04 }}
            className="settings-group"
          >
            {group.map((item, i) => (
              <button
                key={item.label}
                onClick={() => item.onClick ? item.onClick() : toast('功能开发中', { description: '该功能将在后续版本中推出' })}
                className="settings-item w-full"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    item.color === 'text-dove-green' ? 'bg-dove-green/8' :
                    item.color === 'text-dove-bamboo' ? 'bg-amber-50' :
                    item.color === 'text-amber-600' ? 'bg-amber-50' :
                    item.color === 'text-dove-seal' ? 'bg-rose-50' :
                    item.color === 'text-purple-600' ? 'bg-purple-50' :
                    item.color === 'text-blue-500' ? 'bg-blue-50' :
                    item.color === 'text-teal-600' ? 'bg-teal-50' :
                    item.color === 'text-rose-500' ? 'bg-rose-50' :
                    'bg-dove-warm-gray/50'
                  }`}>
                    <item.icon size={16} className={item.color || 'text-dove-ink'} />
                  </div>
                  <span className="text-[14px] text-foreground">{item.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {item.desc && (
                    <span className="text-[11px] text-muted-foreground/50">{item.desc}</span>
                  )}
                  <ChevronRight size={14} className="text-muted-foreground/30" />
                </div>
              </button>
            ))}
          </motion.div>
        ))}

        {/* 退出登录 */}
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 py-3.5 settings-group hover:bg-dove-mist transition-colors"
        >
          <LogOut size={16} className="text-dove-seal" />
          <span className="text-sm text-dove-seal font-medium">退出登录</span>
        </motion.button>

        {/* 底部信息 */}
        <div className="text-center pt-6 pb-2 flex flex-col items-center gap-1.5">
          <img src="/imim-logo-formal.jpg" alt="imim" className="w-8 h-8 rounded-xl opacity-90 shadow-sm" />
          <p className="text-[10px] text-muted-foreground/30 font-medium" style={{ fontFamily: 'var(--font-wenkai)' }}>
            imim v2.0
          </p>
          <p className="text-[9px] text-muted-foreground/20 mt-0.5 tracking-wider">
            安全 · 简约 · 畅聊无限
          </p>
        </div>
      </div>

      {/* 二维码名片弹窗 */}
      <AnimatePresence>
        {showQR && <QRCardModal onClose={() => setShowQR(false)} />}
      </AnimatePresence>

      {/* 密钥管理页面 */}
      <AnimatePresence>
        {showKeyMgmt && <KeyManagementPage onClose={() => setShowKeyMgmt(false)} />}
      </AnimatePresence>

      {/* 设备管理弹窗 */}
      <AnimatePresence>
        {showDevices && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center"
            onClick={() => setShowDevices(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              className="w-full max-w-md bg-white rounded-t-2xl p-5 pb-8"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-dove-ink">当前登录设备</h3>
                <button onClick={() => setShowDevices(false)} className="text-muted-foreground p-1">
                  <X size={18} />
                </button>
              </div>
              {myDevices.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">暂无设备信息</div>
              ) : (
                <div className="space-y-3">
                  {myDevices.map((dev, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-dove-mist border border-dove-green/10">
                      <div className="w-9 h-9 rounded-xl bg-dove-green/10 flex items-center justify-center flex-shrink-0">
                        <Smartphone size={16} className="text-dove-green" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-dove-ink truncate">{dev.os} · {dev.browser}</div>
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {dev.deviceType === 'mobile' ? '移动设备' : dev.deviceType === 'tablet' ? '平板' : '桌面端'}
                          {dev.ip ? ` · ${dev.ip}` : ''}
                          {dev.connectedAt ? ` · 连接于 ${new Date(dev.connectedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}
                        </div>
                      </div>
                      <span className="text-[9px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200/50">在线</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground/40 text-center mt-4">仅显示当前已连接的设备</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 设置详情页 */}
      <AnimatePresence>
        {showSetting === 'security' && (
          <SettingDetail title="账号与安全" onClose={() => setShowSetting(null)}>
            <div className="space-y-3">
              <div className="dove-card p-3.5 border border-dove-green/10 bg-dove-green/3 mb-4">
                <div className="flex items-center gap-2.5">
                  {e2ee.isReady ? (
                    <div className="w-8 h-8 rounded-lg bg-dove-green/10 flex items-center justify-center">
                      <ShieldCheck size={16} className="text-dove-green" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                      <Shield size={16} className="text-yellow-500 animate-pulse" />
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-semibold text-dove-ink">
                      {e2ee.isReady ? 'Signal Protocol 已启用' : '加密初始化中...'}
                    </span>
                    {e2ee.status && (
                      <p className="text-[10px] text-muted-foreground/60">
                        ID: {e2ee.status.registrationId} · 会话: {e2ee.status.totalSessions} · PreKeys: {e2ee.status.totalPreKeys}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {[
                { icon: Key, label: '密钥管理', desc: '查看 Identity Key、PreKeys、加密协议详情', onClick: () => { setShowSetting(null); setTimeout(() => setShowKeyMgmt(true), 100); } },
                { icon: Fingerprint, label: 'Safety Number', desc: '验证联系人身份，防止中间人攻击', onClick: () => toast('Safety Number', { description: '请在聊天详情页中查看与特定联系人的安全码' }) },
                { icon: Smartphone, label: '设备管理', desc: `当前在线: ${myDevices.length || 1}台设备`, onClick: () => setShowDevices(true) },
                { icon: Eye, label: '登录记录', desc: '查看最近登录活动', onClick: () => toast('登录记录', { description: '最近登录: 刚刚' }) },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className="w-full flex items-center gap-3 px-4 py-3.5 settings-group hover:bg-dove-mist transition-colors"
                >
                  <div className="w-8 h-8 rounded-xl bg-dove-green/8 flex items-center justify-center">
                    <item.icon size={16} className="text-dove-green" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-sm text-foreground font-medium">{item.label}</span>
                    <p className="text-[10px] text-muted-foreground/50">{item.desc}</p>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground/30" />
                </button>
              ))}
            </div>
          </SettingDetail>
        )}

        {showSetting === 'general' && (
          <SettingDetail title="通用设置" onClose={() => setShowSetting(null)}>
            <div className="space-y-3">
              {[
                { icon: Globe, label: '语言', desc: '简体中文' },
                { icon: Download, label: '自动下载', desc: 'Wi-Fi 下自动下载' },
                { icon: Database, label: '聊天记录备份', desc: '上次备份: 今天' },
                { icon: Trash2, label: '清除缓存', desc: '23.5 MB' },
                { icon: Wifi, label: '网络诊断', desc: '检测连接状态' },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={() => toast(item.label, { description: '功能开发中' })}
                  className="w-full flex items-center gap-3 px-4 py-3.5 settings-group hover:bg-dove-mist transition-colors"
                >
                  <div className="w-8 h-8 rounded-xl bg-dove-warm-gray/50 flex items-center justify-center">
                    <item.icon size={16} className="text-dove-ink" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-sm text-foreground">{item.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 mr-1">{item.desc}</span>
                  <ChevronRight size={14} className="text-muted-foreground/30" />
                </button>
              ))}
            </div>
          </SettingDetail>
        )}

        {showSetting === 'notification' && (
          <SettingDetail title="消息通知" onClose={() => setShowSetting(null)}>
            <div className="space-y-3">
              <div className="px-4 py-3.5 settings-group border border-border/40 bg-white/70 rounded-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-foreground font-medium">浏览器通知权限</div>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {notificationPermission === 'granted'
                        ? '已授权，可在应用位于后台时显示系统通知'
                        : notificationPermission === 'denied'
                          ? '权限已被拒绝，请在浏览器设置中手动重新开启'
                          : notificationPermission === 'unsupported'
                            ? '当前环境不支持系统通知'
                            : '尚未授权，开启后会请求浏览器通知权限'}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      const permission = await requestBrowserNotificationPermission();
                      setNotificationPermission(permission);
                      if (permission === 'granted') {
                        updatePrefs({ browserEnabled: true }, '浏览器通知已启用');
                      } else if (permission === 'denied') {
                        toast.error('浏览器通知权限被拒绝，请在浏览器设置中手动开启');
                      } else if (permission === 'unsupported') {
                        toast.error('当前浏览器环境不支持系统通知');
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-dove-green/10 text-dove-green text-xs font-medium hover:bg-dove-green/15 transition-colors"
                  >
                    {notificationPermission === 'granted' ? '已授权' : '申请权限'}
                  </button>
                </div>
              </div>

              {[
                {
                  key: 'enabled' as const,
                  label: '新消息通知',
                  desc: '收到新消息时启用提醒能力',
                  enabled: notificationPrefs.enabled,
                },
                {
                  key: 'soundEnabled' as const,
                  label: '声音',
                  desc: '通知时播放轻提示音',
                  enabled: notificationPrefs.soundEnabled,
                },
                {
                  key: 'vibrationEnabled' as const,
                  label: '振动',
                  desc: '支持时触发设备振动提醒',
                  enabled: notificationPrefs.vibrationEnabled,
                },
                {
                  key: 'previewEnabled' as const,
                  label: '消息预览',
                  desc: '在系统通知中显示消息内容',
                  enabled: notificationPrefs.previewEnabled,
                },
                {
                  key: 'browserEnabled' as const,
                  label: '系统通知',
                  desc: '页面位于后台时显示浏览器通知',
                  enabled: notificationPrefs.browserEnabled,
                },
              ].map(item => {
                const disabled = !notificationPrefs.enabled && item.key !== 'enabled';
                return (
                  <div key={item.label} className={`flex items-center gap-3 px-4 py-3.5 settings-group ${disabled ? 'opacity-50' : ''}`}>
                    <div className="flex-1">
                      <span className="text-sm text-foreground">{item.label}</span>
                      <p className="text-[10px] text-muted-foreground/50">{item.desc}</p>
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={item.enabled}
                      className={`w-11 h-[26px] rounded-full relative transition-colors duration-200 ${
                        item.enabled ? 'bg-dove-green' : 'bg-muted-foreground/15'
                      } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                      onClick={() => {
                        void handleNotificationToggle(item.key, !item.enabled, `${item.label}已${item.enabled ? '关闭' : '开启'}`);
                      }}
                    >
                      <div className={`absolute top-[3px] w-5 h-5 bg-white rounded-full shadow-soft-sm transition-transform duration-200 ${
                        item.enabled ? 'translate-x-[22px]' : 'translate-x-[3px]'
                      }`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </SettingDetail>
        )}

        {showSetting === 'appearance' && (
          <SettingDetail title="外观" onClose={() => setShowSetting(null)}>
            <div className="space-y-4">
              {/* 外观模式三选项 */}
              <div className="px-4 py-3.5 settings-group">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    mode === 'dark' ? 'bg-indigo-900/50' : mode === 'system' ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-amber-50'
                  }`}>
                    {mode === 'dark' ? <Moon size={16} className="text-indigo-300" /> :
                     mode === 'light' ? <Sun size={16} className="text-amber-500" /> :
                     <SunMoon size={16} className="text-blue-500" />}
                  </div>
                  <div>
                    <span className="text-sm text-foreground">外观模式</span>
                    <p className="text-[10px] text-muted-foreground/50">
                      {mode === 'light' ? '亮色模式' : mode === 'dark' ? '暗色模式，减少眼睛疲劳' : '跟随系统自动切换'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'light' as const, label: '亮色', Icon: Sun, iconCls: 'text-amber-500', activeBg: 'bg-amber-50 dark:bg-amber-900/20', activeBorder: 'border-amber-400' },
                    { key: 'dark' as const, label: '暗色', Icon: Moon, iconCls: 'text-indigo-400', activeBg: 'bg-indigo-50 dark:bg-indigo-900/30', activeBorder: 'border-indigo-400' },
                    { key: 'system' as const, label: '跟随系统', Icon: SunMoon, iconCls: 'text-blue-500', activeBg: 'bg-blue-50 dark:bg-blue-900/20', activeBorder: 'border-blue-400' },
                  ].map(({ key, label, Icon, iconCls, activeBg, activeBorder }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setMode(key);
                        toast.success(key === 'light' ? '已切换亮色模式' : key === 'dark' ? '已切换暗色模式' : '已设置跟随系统');
                      }}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all ${
                        mode === key
                          ? `${activeBg} ${activeBorder}`
                          : 'border-border/30 bg-muted/30 hover:bg-muted/60'
                      }`}
                    >
                      <Icon size={20} className={iconCls} />
                      <span className={`text-[11px] font-medium ${
                        mode === key ? 'text-foreground' : 'text-muted-foreground'
                      }`}>{label}</span>
                      {mode === key && (
                        <div className="w-1.5 h-1.5 rounded-full bg-dove-green" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* 字体大小滑块 */}
              <div className="px-4 py-3.5 settings-group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-foreground">字体大小</span>
                  <span className="text-xs text-dove-green font-medium">{fontSize}px</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground/50" style={{ fontSize: '11px' }}>小</span>
                  <input
                    type="range"
                    min={12}
                    max={18}
                    step={1}
                    value={fontSize}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setFontSize(val);
                      localStorage.setItem('imim_font_size', String(val));
                      document.documentElement.style.setProperty('--imim-font-size', `${val}px`);
                      document.body.style.fontSize = `${val}px`;
                    }}
                    className="flex-1 accent-dove-green"
                    style={{ accentColor: 'oklch(0.58 0.14 155)' }}
                  />
                  <span className="text-sm text-muted-foreground/50" style={{ fontSize: '17px' }}>大</span>
                </div>
                {/* 预览文字 */}
                <p className="mt-2 text-muted-foreground/60 text-center" style={{ fontSize: `${fontSize}px` }}>预览：这是示例文字</p>
              </div>

              {/* 聊天背景选择 */}
              <div className="px-4 py-3.5 settings-group">
                <span className="text-sm text-foreground">聊天背景</span>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {[
                    { key: 'default', label: '默认', cls: darkMode ? 'bg-[oklch(0.12_0.008_240)]' : 'bg-dove-mist' },
                    { key: 'green', label: '清绿', cls: 'bg-dove-green-light' },
                    { key: 'warm', label: '暖黄', cls: 'bg-amber-50' },
                    { key: 'blue', label: '淡蓝', cls: 'bg-blue-50' },
                    { key: 'pink', label: '粉色', cls: 'bg-pink-50' },
                    { key: 'gray', label: '灰色', cls: 'bg-gray-100' },
                    { key: 'dark', label: '深色', cls: 'bg-gray-800' },
                    { key: 'purple', label: '紫色', cls: 'bg-purple-50' },
                  ].map(({ key, label, cls }) => (
                    <div key={key} className="flex flex-col items-center gap-1">
                      <div
                        className={`w-full aspect-square rounded-xl ${cls} border-2 ${
                          chatBg === key ? 'border-dove-green scale-95' : 'border-transparent'
                        } cursor-pointer transition-all hover:scale-95 active:scale-90`}
                        onClick={() => {
                          setChatBg(key);
                          localStorage.setItem('imim_chat_bg', key);
                          // 将背景色应用到聊天页面
                          const bgMap: Record<string, string> = {
                            default: '',
                            green: 'oklch(0.96 0.025 155)',
                            warm: 'oklch(0.98 0.02 80)',
                            blue: 'oklch(0.97 0.015 240)',
                            pink: 'oklch(0.97 0.015 350)',
                            gray: 'oklch(0.95 0.003 240)',
                            dark: 'oklch(0.20 0.008 240)',
                            purple: 'oklch(0.97 0.015 300)',
                          };
                          document.documentElement.style.setProperty('--imim-chat-bg', bgMap[key] || '');
                          toast.success(`聊天背景已改为「${label}」`);
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground/60">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SettingDetail>
        )}

        {showSetting === 'privacy' && (
          <SettingDetail title="隐私" onClose={() => setShowSetting(null)}>
            <div className="space-y-3">
              {[
                { label: '通讯录黑名单', desc: '0 人' },
                { label: '朋友圈权限', desc: '所有好友可见' },
                { label: '添加我的方式', desc: '手机号、二维码' },
                { label: '在线状态', desc: '对所有人可见' },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={() => toast(item.label, { description: '功能开发中' })}
                  className="w-full flex items-center gap-3 px-4 py-3.5 settings-group hover:bg-dove-mist transition-colors"
                >
                  <div className="flex-1 text-left">
                    <span className="text-sm text-foreground">{item.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 mr-1">{item.desc}</span>
                  <ChevronRight size={14} className="text-muted-foreground/30" />
                </button>
              ))}
            </div>
          </SettingDetail>
        )}

        {showSetting === 'about' && (
          <SettingDetail title="关于 imim" onClose={() => setShowSetting(null)}>
            <div className="flex flex-col items-center py-8">
              <img src="/imim-logo-formal.jpg" alt="imim" className="w-20 h-20 rounded-2xl shadow-soft-lg mb-4" />
              <h3 className="text-lg font-bold text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>
                imim
              </h3>
              <p className="text-xs text-muted-foreground/50 mt-1">版本 2.0.0</p>
              <p className="text-xs text-muted-foreground/40 mt-0.5 tracking-wider">安全 · 简约 · 畅聊无限</p>

              <div className="w-full mt-6 dove-card p-3.5 border border-dove-green/10 bg-dove-green/3">
                <div className="flex items-center gap-2 mb-1.5">
                  <ShieldCheck size={14} className="text-dove-green" />
                  <span className="text-xs font-semibold text-dove-ink">端到端加密</span>
                </div>
                <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                  imim 使用 Signal Protocol 实现端到端加密，包括 X3DH 密钥协商和 Double Ratchet 消息加密，
                  提供完美前向保密和后泄露安全性。所有密码学操作基于 Web Crypto API 原生实现。
                </p>
              </div>

              <div className="w-full mt-4 space-y-2">
                {[
                  { label: '功能介绍', desc: '' },
                  { label: '隐私政策', desc: '' },
                  { label: '用户协议', desc: '' },
                  { label: '开源许可', desc: 'Apache 2.0' },
                  { label: '检查更新', desc: '已是最新版本' },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => toast(item.label)}
                    className="w-full flex items-center gap-3 px-4 py-3 settings-group hover:bg-dove-mist transition-colors"
                  >
                    <span className="text-sm text-foreground flex-1 text-left">{item.label}</span>
                    {item.desc && <span className="text-[10px] text-muted-foreground/50">{item.desc}</span>}
                    <ChevronRight size={14} className="text-muted-foreground/30" />
                  </button>
                ))}
              </div>

              <p className="text-[9px] text-muted-foreground/25 mt-8 tracking-wider">
                Copyright 2024 imim. All rights reserved.
              </p>
            </div>
          </SettingDetail>
        )}
        {/* 个人资料设置页 */}
        {showProfileSettings && (
          <ProfileSettingsPage
            onClose={() => {
              setShowProfileSettings(false);
              // 关闭设置页后重新拉取最新昵称
              fetchDynamicProfile();
            }}
            onProfileUpdate={(p) => {
              setUserUniqueId(p.wechatId || CURRENT_USER.uniqueId || '');
              setUserPhone(p.phone || '');
              setUserEmail(p.email || '');
              setDynamicProfile({
                name: p.nickname || p.name,
                wechatId: p.wechatId || CURRENT_USER.uniqueId || p.id,
                avatar: p.avatar || '',
              });
            }}
          />
        )}
        {/* 账号设置弹窗 */}
        {accountModal && (
          <AccountSettingModal
            type={accountModal}
            currentValue={
              accountModal === 'id' ? userUniqueId :
              accountModal === 'phone' ? userPhone :
              userEmail
            }
            onClose={() => setAccountModal(null)}
            onSave={(val) => {
              if (accountModal === 'id') setUserUniqueId(val);
              else if (accountModal === 'phone') setUserPhone(val);
              else setUserEmail(val);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
