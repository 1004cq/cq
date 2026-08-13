/**
 * imim 登录/注册页 — 暗黑 UI 版（参考 X/Xchat 风格）
 * 纯黑背景 · 深色毛玻璃输入框 · 白色文字 · 绿色强调色
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAppActions } from '@/contexts/AppContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Shield, Phone, Mail, ArrowLeft, Eye, EyeOff, KeyRound, Sparkles, User } from 'lucide-react';

// ============ API 工具 ============

const AUTH_API = '/api/auth';

async function authApi(path: string, body?: any) {
  const token = localStorage.getItem('user_token');
  const res = await fetch(`${AUTH_API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ============ 密码强度检查 ============

function checkPasswordStrength(pw: string): { score: number; label: string; color: string; errors: string[] } {
  const errors: string[] = [];
  if (pw.length < 8) errors.push('至少 8 位');
  if (!/[a-z]/.test(pw)) errors.push('包含小写字母');
  if (!/[A-Z]/.test(pw)) errors.push('包含大写字母');
  if (!/[0-9]/.test(pw)) errors.push('包含数字');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pw)) errors.push('包含特殊字符');
  const score = 5 - errors.length;
  if (score <= 1) return { score, label: '很弱', color: '#ef4444', errors };
  if (score <= 2) return { score, label: '弱', color: '#f97316', errors };
  if (score <= 3) return { score, label: '中等', color: '#eab308', errors };
  if (score <= 4) return { score, label: '强', color: '#22c55e', errors };
  return { score, label: '很强', color: '#16a34a', errors };
}

// ============ 主组件 ============

export default function LoginPage() {
  const { login } = useAppActions();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [loginType, setLoginType] = useState<'password' | 'sms' | 'email'>('password');
  const [showContent, setShowContent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPhoneCode, setRegPhoneCode] = useState('');
  const [regNickname, setRegNickname] = useState('');
  const [regCountdown, setRegCountdown] = useState(0);

  const [resetAccount, setResetAccount] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetCountdown, setResetCountdown] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (countdown > 0) { const t = setTimeout(() => setCountdown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [countdown]);
  useEffect(() => {
    if (regCountdown > 0) { const t = setTimeout(() => setRegCountdown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [regCountdown]);
  useEffect(() => {
    if (resetCountdown > 0) { const t = setTimeout(() => setResetCountdown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [resetCountdown]);

  const clearError = () => setError('');

  const handleSendCode = async (target: string, type: string, channel: string, setCD: (v: number) => void) => {
    if (!target) { setError(channel === 'sms' ? '请输入手机号' : '请输入邮箱'); return; }
    setLoading(true);
    clearError();
    try {
      await authApi('/send-code', { target, type, channel });
      setCD(60);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    clearError();
    if (!account) { setError('请输入账号'); return; }
    if (loginType === 'password') {
      if (!password) { setError('请输入密码'); return; }
    } else {
      if (!code) { setError('请输入验证码'); return; }
    }
    setLoading(true);
    try {
      const res = await authApi('/login', {
        account,
        password: loginType === 'password' ? password : undefined,
        code: loginType !== 'password' ? code : undefined,
        loginType,
      });
      localStorage.setItem('user_token', res.token);
      const uid = res.user?.id ?? res.userId;
      const uname = res.user?.username ?? res.username;
      const unick = res.user?.nickname ?? res.nickname;
      const uavatar = res.user?.avatar ?? '';
      const ubio = res.user?.bio ?? '';
      localStorage.setItem('user_id', uid);
      localStorage.setItem('user_nickname', unick);
      localStorage.setItem('user_avatar', uavatar);
      localStorage.setItem('user_username', uname);
      localStorage.setItem('user_bio', ubio);
      login({ id: uid, username: uname, nickname: unick, avatar: uavatar, bio: ubio });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    clearError();
    if (!regUsername || !regPassword || !regConfirmPassword) { setError('请填写必填项'); return; }
    if (regPassword !== regConfirmPassword) { setError('两次密码不一致'); return; }
    const pwStrength = checkPasswordStrength(regPassword);
    if (pwStrength.errors.length > 0) { setError(`密码要求：${pwStrength.errors.join('、')}`); return; }
    if (!/^[a-zA-Z0-9_]{1,20}$/.test(regUsername)) { setError('用户ID格式不正确'); return; }
    setLoading(true);
    try {
      await authApi('/register', {
        username: regUsername,
        password: regPassword,
        nickname: regNickname || regUsername,
        phone: regPhone || undefined,
        phoneCode: regPhone && regPhoneCode ? regPhoneCode : undefined,
      });
      setError('注册成功，请登录');
      setTimeout(() => {
        setMode('login'); clearError();
        setRegUsername(''); setRegPassword(''); setRegConfirmPassword('');
        setRegPhone(''); setRegPhoneCode(''); setRegNickname('');
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    clearError();
    if (!resetAccount || !resetCode || !resetNewPassword) { setError('请填写完整信息'); return; }
    const pwStrength = checkPasswordStrength(resetNewPassword);
    if (pwStrength.errors.length > 0) { setError(`密码要求：${pwStrength.errors.join('、')}`); return; }
    setLoading(true);
    try {
      const channel = /^1[3-9]\d{9}$/.test(resetAccount) ? 'sms' : 'email';
      await authApi('/reset-password', { account: resetAccount, code: resetCode, newPassword: resetNewPassword, channel });
      setError('密码重置成功，请重新登录');
      setTimeout(() => { setMode('login'); clearError(); }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============ 暗黑主题样式 ============

  // 输入框：深色背景，白色文字，聚焦时绿色边框发光
  const inputCls = [
    'w-full px-4 py-3.5 rounded-xl text-sm text-white placeholder:text-white/30',
    'bg-white/[0.06] border border-white/10',
    'focus:outline-none focus:border-[#4ade80]/60 focus:bg-white/[0.09]',
    'focus:shadow-[0_0_0_3px_rgba(74,222,128,0.12)]',
    'transition-all duration-200',
  ].join(' ');

  // 主按钮：绿色渐变，带光晕
  const btnPrimaryCls = [
    'w-full py-3.5 rounded-xl text-sm font-semibold text-white',
    'bg-gradient-to-r from-[#22c55e] to-[#16a34a]',
    'shadow-[0_8px_24px_rgba(34,197,94,0.30)]',
    'hover:shadow-[0_8px_32px_rgba(34,197,94,0.45)]',
    'hover:from-[#4ade80] hover:to-[#22c55e]',
    'flex items-center justify-center gap-2',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    'transition-all duration-200 active:scale-[0.98]',
  ].join(' ');

  // 验证码按钮
  const btnCodeCls = [
    'px-4 py-3.5 rounded-xl text-xs font-semibold whitespace-nowrap',
    'bg-white/[0.06] border border-white/10 text-white/70',
    'hover:bg-white/[0.10] hover:text-white',
    'disabled:opacity-40 transition-all duration-200',
  ].join(' ');

  const labelCls = 'text-[11px] text-white/40 pl-1 mb-1.5 block font-medium uppercase tracking-wider';

  const loginTabs = [
    { id: 'password' as const, label: '密码', icon: KeyRound },
    { id: 'sms' as const, label: '短信', icon: Phone },
    { id: 'email' as const, label: '邮箱', icon: Mail },
  ];

  const LoadingSpinner = () => (
    <motion.div
      className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
    />
  );

  return (
    <div className="h-full flex flex-col relative overflow-hidden" style={{ background: '#0a0a0a' }}>

      {/* 背景光晕装饰 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* 顶部绿色光晕 */}
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full opacity-20"
          style={{ background: 'radial-gradient(ellipse, #22c55e 0%, transparent 70%)', filter: 'blur(60px)' }}
        />
        {/* 底部蓝色光晕 */}
        <div
          className="absolute -bottom-40 -right-20 w-[400px] h-[300px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(ellipse, #3b82f6 0%, transparent 70%)', filter: 'blur(80px)' }}
        />
        {/* 网格纹理 */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* 内容区 */}
      <div className="relative z-10 flex-1 flex flex-col justify-center px-6 overflow-y-auto py-8">

        {/* Logo + 品牌区 */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center mb-10"
        >
          {/* Logo 图标 */}
          <div className="relative mb-5">
            {/* 光圈 */}
            <div
              className="absolute inset-0 rounded-[22px] opacity-40"
              style={{ background: 'radial-gradient(circle, #22c55e 0%, transparent 70%)', filter: 'blur(16px)', transform: 'scale(1.3)' }}
            />
            <div className="relative w-20 h-20 rounded-[22px] overflow-hidden border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
              <img src="/imim-logo-formal.jpg" alt="imim" className="w-full h-full object-cover" />
            </div>
          </div>

          {/* 品牌名 */}
          <h1 className="text-3xl font-bold text-white tracking-[0.3em] mb-1.5">IMIM</h1>
          <p className="text-xs text-white/30 tracking-[0.2em]">安全 · 私密 · 端对端加密</p>

          {/* 加密徽章 */}
          <div className="flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded-full border border-[#22c55e]/20 bg-[#22c55e]/5">
            <Shield size={11} className="text-[#4ade80]" />
            <span className="text-[10px] text-[#4ade80]/80 font-medium">端对端加密通讯</span>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {showContent && (
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-sm mx-auto w-full space-y-5"
            >

              {/* 错误/成功提示 */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`text-center text-xs px-4 py-3 rounded-xl border ${
                      error.includes('成功')
                        ? 'bg-[#22c55e]/10 text-[#4ade80] border-[#22c55e]/20'
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ============ 登录表单 ============ */}
              {mode === 'login' && (
                <div className="space-y-5">
                  {/* Tab 切换 */}
                  <div className="flex border-b border-white/10">
                    {loginTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => { setLoginType(tab.id); clearError(); setAccount(''); setPassword(''); setCode(''); }}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-all relative ${
                          loginType === tab.id ? 'text-white' : 'text-white/30 hover:text-white/60'
                        }`}
                      >
                        <tab.icon size={12} />
                        {tab.label}
                        {loginType === tab.id && (
                          <motion.div
                            layoutId="tab-indicator"
                            className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#22c55e] rounded-full"
                          />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* 密码登录 */}
                  {loginType === 'password' && (
                    <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <div>
                        <label className={labelCls}>账号</label>
                        <input
                          className={inputCls}
                          value={account}
                          onChange={e => setAccount(e.target.value)}
                          placeholder="用户ID / 手机号 / 邮箱"
                          autoComplete="username"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>密码</label>
                        <div className="relative">
                          <input
                            className={inputCls + ' pr-11'}
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="请输入密码"
                            autoComplete="current-password"
                            onKeyDown={e => e.key === 'Enter' && handleLogin()}
                          />
                          <button
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors"
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* 短信登录 */}
                  {loginType === 'sms' && (
                    <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <div>
                        <label className={labelCls}>手机号</label>
                        <input className={inputCls} type="tel" value={account} onChange={e => setAccount(e.target.value)} placeholder="请输入手机号" />
                      </div>
                      <div>
                        <label className={labelCls}>验证码</label>
                        <div className="flex gap-2">
                          <input className={inputCls + ' flex-1'} value={code} onChange={e => setCode(e.target.value)} placeholder="6 位验证码" maxLength={6} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                          <button onClick={() => handleSendCode(account, 'login', 'sms', setCountdown)} disabled={countdown > 0 || loading} className={btnCodeCls}>
                            {countdown > 0 ? `${countdown}s` : '获取'}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* 邮箱登录 */}
                  {loginType === 'email' && (
                    <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <div>
                        <label className={labelCls}>邮箱</label>
                        <input className={inputCls} type="email" value={account} onChange={e => setAccount(e.target.value)} placeholder="请输入邮箱" />
                      </div>
                      <div>
                        <label className={labelCls}>验证码</label>
                        <div className="flex gap-2">
                          <input className={inputCls + ' flex-1'} value={code} onChange={e => setCode(e.target.value)} placeholder="6 位验证码" maxLength={6} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                          <button onClick={() => handleSendCode(account, 'login', 'email', setCountdown)} disabled={countdown > 0 || loading} className={btnCodeCls}>
                            {countdown > 0 ? `${countdown}s` : '获取'}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* 登录按钮 */}
                  <motion.button
                    onClick={handleLogin}
                    disabled={loading}
                    className={btnPrimaryCls}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? <LoadingSpinner /> : <><Lock size={14} />登录</>}
                  </motion.button>

                  {/* 底部链接 */}
                  <div className="flex items-center justify-between text-xs pt-1">
                    <button
                      onClick={() => { setMode('register'); clearError(); }}
                      className="text-[#4ade80] hover:text-[#22c55e] transition-colors font-medium"
                    >
                      注册新账号
                    </button>
                    <button
                      onClick={() => { setMode('reset'); clearError(); }}
                      className="text-white/25 hover:text-white/50 transition-colors"
                    >
                      忘记密码？
                    </button>
                  </div>
                </div>
              )}

              {/* ============ 注册表单 ============ */}
              {mode === 'register' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      onClick={() => { setMode('login'); clearError(); }}
                      className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                    >
                      <ArrowLeft size={15} />
                    </button>
                    <span className="text-base font-semibold text-white">注册新账号</span>
                  </div>

                  <div>
                    <label className={labelCls}>用户 ID <span className="text-red-400 normal-case">*</span></label>
                    <input className={inputCls} value={regUsername} onChange={e => setRegUsername(e.target.value)} placeholder="1-20位字母数字下划线" />
                  </div>
                  <div>
                    <label className={labelCls}>昵称</label>
                    <input className={inputCls} value={regNickname} onChange={e => setRegNickname(e.target.value)} placeholder="显示名称（可选）" />
                  </div>
                  <div>
                    <label className={labelCls}>密码 <span className="text-red-400 normal-case">*</span></label>
                    <input className={inputCls} type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} placeholder="至少8位，含大小写+数字" />
                  </div>
                  <div>
                    <label className={labelCls}>确认密码 <span className="text-red-400 normal-case">*</span></label>
                    <input className={inputCls} type="password" value={regConfirmPassword} onChange={e => setRegConfirmPassword(e.target.value)} placeholder="再次输入密码" />
                  </div>
                  <div>
                    <label className={labelCls}>手机号（可选）</label>
                    <input className={inputCls} type="tel" value={regPhone} onChange={e => setRegPhone(e.target.value)} placeholder="绑定手机号" />
                  </div>
                  {regPhone && (
                    <div>
                      <label className={labelCls}>手机验证码</label>
                      <div className="flex gap-2">
                        <input className={inputCls + ' flex-1'} value={regPhoneCode} onChange={e => setRegPhoneCode(e.target.value)} placeholder="6 位验证码" maxLength={6} />
                        <button onClick={() => handleSendCode(regPhone, 'register', 'sms', setRegCountdown)} disabled={regCountdown > 0 || loading} className={btnCodeCls}>
                          {regCountdown > 0 ? `${regCountdown}s` : '获取'}
                        </button>
                      </div>
                    </div>
                  )}

                  <motion.button
                    onClick={handleRegister}
                    disabled={loading}
                    className={btnPrimaryCls}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? <LoadingSpinner /> : <><Sparkles size={14} />创建账号</>}
                  </motion.button>
                </div>
              )}

              {/* ============ 重置密码表单 ============ */}
              {mode === 'reset' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      onClick={() => { setMode('login'); clearError(); }}
                      className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                    >
                      <ArrowLeft size={15} />
                    </button>
                    <span className="text-base font-semibold text-white">重置密码</span>
                  </div>

                  <div>
                    <label className={labelCls}>手机号 / 邮箱</label>
                    <input className={inputCls} value={resetAccount} onChange={e => setResetAccount(e.target.value)} placeholder="请输入手机号或邮箱" />
                  </div>
                  <div>
                    <label className={labelCls}>验证码</label>
                    <div className="flex gap-2">
                      <input className={inputCls + ' flex-1'} value={resetCode} onChange={e => setResetCode(e.target.value)} placeholder="6 位验证码" maxLength={6} />
                      <button
                        onClick={() => {
                          const channel = /^1[3-9]\d{9}$/.test(resetAccount) ? 'sms' : 'email';
                          handleSendCode(resetAccount, 'reset', channel, setResetCountdown);
                        }}
                        disabled={resetCountdown > 0 || loading}
                        className={btnCodeCls}
                      >
                        {resetCountdown > 0 ? `${resetCountdown}s` : '获取'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>新密码</label>
                    <input className={inputCls} type="password" value={resetNewPassword} onChange={e => setResetNewPassword(e.target.value)} placeholder="请输入新密码" />
                  </div>

                  <motion.button
                    onClick={handleResetPassword}
                    disabled={loading}
                    className={btnPrimaryCls}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? <LoadingSpinner /> : <><KeyRound size={14} />重置密码</>}
                  </motion.button>
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
