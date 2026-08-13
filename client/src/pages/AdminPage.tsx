/**
 * imim 管理员后台
 * 完整的后台管理系统，包含：仪表盘、用户管理、举报管理、敏感词、IP黑名单、公告、操作日志、OneBot 配置
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, Shield, FileWarning, MessageSquareWarning,
  Globe, Megaphone, ScrollText, LogOut, ChevronLeft, Search,
  Ban, UserCheck, Volume2, UserX, Plus, Trash2, Check, X,
  AlertTriangle, Eye, RefreshCw, Settings, Lock, ChevronDown,
  TrendingUp, Activity, BarChart3, PieChart, Clock, Filter,
  Bot, Wifi, WifiOff, Zap, MessageSquare, Brain, ToggleLeft, ToggleRight,
  Save, RotateCcw, ChevronRight, Hash, AtSign, Repeat,
  Mail, Server, KeyRound, SendHorizonal, FlaskConical, FileText, CheckCircle2, XCircle,
  Link2, Image, Video, BarChart2, UserCog, Newspaper, Database, SlidersHorizontal,
  ShieldAlert, ShieldOff, AlertOctagon, CloudCog, Rss, ExternalLink, Copy,
  Menu, Edit3, UserPlus, HardDrive, Upload, Power, EyeOff, FolderOpen, Info,
} from 'lucide-react';

const AliyunPanel = React.lazy(() => import('./admin/AliyunPanel'));

// ============ API 工具函数 ============

const API_BASE = '/api/admin';

/**
 * 安全 API 调用封装
 * 1. 携带 Bearer Token 和 CSRF Token
 * 2. 启用 credentials: 'include' 支持 HttpOnly Cookie
 * 3. 401 响应自动清除会话
 */
async function api(path: string, options?: RequestInit) {
  const token = localStorage.getItem('admin_token');
  // 从 Cookie 中读取 CSRF Token
  const csrfToken = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))?.split('=')[1] || '';
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',  // ★ 携带 HttpOnly Cookie
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),  // ★ CSRF 防护
      ...options?.headers,
    },
  });
  // ★ 会话过期自动清除
  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    throw new Error(path === '/login' ? '用户名或密码错误' : '会话已过期，请重新登录');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ============ 类型定义 ============

interface AdminInfo {
  id: string;
  username: string;
  role: string;
  lastLoginAt?: number;
}

interface DashboardData {
  overview: {
    totalUsers: number;
    onlineUsers: number;
    bannedUsers: number;
    totalMessages: number;
    pendingReports: number;
    totalSensitiveWords: number;
    totalAnnouncements: number;
  };
  dailyStats: Array<{ date: string; newUsers: number; activeUsers: number; messages: number }>;
  messageTypes: Array<{ type: string; count: number }>;
}

type NavItem = 'dashboard' | 'users' | 'reports' | 'sensitive-words' | 'ip-blacklist' | 'announcements' | 'logs' | 'admins' | 'onebot' | 'smtp' | 'amap' | 'pyq' | 'aliyun' | 'cos';

// ============ 格式化工具 ============

function formatTime(ts: number | string | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '-';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

// ============ 登录页面 ============

function AdminLoginPage({ onLogin }: { onLogin: (admin: AdminInfo) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem('admin_token', data.token);
      onLogin(data.admin);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-wenkai)' }}>
              imim 管理后台
            </h1>
            <p className="text-slate-400 text-sm mt-2">安全管理 · 数据洞察 · 高效运维</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">管理员账号</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                placeholder="请输入管理员账号"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                placeholder="请输入密码"
              />
            </div>

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  登录管理后台
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-white/5">
            <p className="text-xs text-slate-500 text-center">
              仅限授权管理员访问
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============ 仪表盘 ============

function DashboardPanel() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/dashboard').then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!data) return <div className="text-slate-400 text-center py-20">加载失败</div>;

  const { overview, dailyStats, messageTypes } = data;
  const maxMsg = Math.max(...dailyStats.map(d => d.messages));

  const statCards = [
    { label: '总用户数', value: overview.totalUsers, icon: Users, color: 'bg-blue-500/10 text-blue-400', iconBg: 'bg-blue-500/20' },
    { label: '在线用户', value: overview.onlineUsers, icon: Activity, color: 'bg-emerald-500/10 text-emerald-400', iconBg: 'bg-emerald-500/20' },
    { label: '封禁用户', value: overview.bannedUsers, icon: Ban, color: 'bg-red-500/10 text-red-400', iconBg: 'bg-red-500/20' },
    { label: '消息总量', value: formatNumber(overview.totalMessages), icon: BarChart3, color: 'bg-purple-500/10 text-purple-400', iconBg: 'bg-purple-500/20' },
    { label: '待处理举报', value: overview.pendingReports, icon: FileWarning, color: 'bg-amber-500/10 text-amber-400', iconBg: 'bg-amber-500/20' },
    { label: '敏感词库', value: overview.totalSensitiveWords, icon: Shield, color: 'bg-cyan-500/10 text-cyan-400', iconBg: 'bg-cyan-500/20' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white flex items-center gap-2">
        <LayoutDashboard className="w-5 h-5 text-emerald-400" />
        数据仪表盘
      </h2>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`${card.color} rounded-xl p-4 border border-white/5`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 ${card.iconBg} rounded-lg flex items-center justify-center`}>
                <card.icon className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="text-2xl font-bold text-white">{card.value}</div>
            <div className="text-xs text-slate-400 mt-1">{card.label}</div>
          </motion.div>
        ))}
      </div>

      {/* 7天趋势图 */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          近7天消息趋势
        </h3>
        <div className="flex items-end gap-2 h-40">
          {dailyStats.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-slate-500">{d.messages}</span>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${(d.messages / maxMsg) * 100}%` }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="w-full bg-emerald-500/30 rounded-t-md min-h-[4px] relative group"
              >
                <div className="absolute inset-0 bg-emerald-500/50 rounded-t-md opacity-0 group-hover:opacity-100 transition-opacity" />
              </motion.div>
              <span className="text-xs text-slate-500">{d.date}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 消息类型分布 + 活跃用户 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white/5 rounded-xl border border-white/10 p-5">
          <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-purple-400" />
            消息类型分布
          </h3>
          <div className="space-y-3">
            {messageTypes.map((mt, i) => {
              const total = messageTypes.reduce((s, m) => s + m.count, 0);
              const pct = ((mt.count / total) * 100).toFixed(1);
              const colors = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-slate-500'];
              return (
                <div key={mt.type} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-8">{mt.type}</span>
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ delay: i * 0.1, duration: 0.6 }}
                      className={`h-full ${colors[i]} rounded-full`}
                    />
                  </div>
                  <span className="text-xs text-slate-500 w-12 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white/5 rounded-xl border border-white/10 p-5">
          <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            近7天活跃用户
          </h3>
          <div className="flex items-end gap-2 h-32">
            {dailyStats.map((d, i) => {
              const maxActive = Math.max(...dailyStats.map(s => s.activeUsers));
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-slate-500">{d.activeUsers}</span>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(d.activeUsers / maxActive) * 100}%` }}
                    transition={{ delay: i * 0.08, duration: 0.5 }}
                    className="w-full bg-blue-500/30 rounded-t-md min-h-[4px]"
                  />
                  <span className="text-xs text-slate-500">{d.date}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ 用户管理 ============

function UsersPanel() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState('');
  // 注册用户弹窗
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', nickname: '', phone: '', email: '', bio: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  // 编辑用户弹窗
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ username: '', nickname: '', phone: '', email: '', bio: '', password: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [editUserId, setEditUserId] = useState('');
  // 封禁弹窗
  const [showBanModal, setShowBanModal] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [banUserId, setBanUserId] = useState('');
  const [banUserName, setBanUserName] = useState('');
  const [banLoading, setBanLoading] = useState(false);
  // 删除用户弹窗
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState('');
  const [deleteUserName, setDeleteUserName] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/users?search=${encodeURIComponent(search)}&status=${statusFilter}`);
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // 封禁用户（弹窗输入原因）
  const openBanModal = (userId: string, userName: string) => {
    setBanUserId(userId);
    setBanUserName(userName);
    setBanReason('');
    setShowBanModal(true);
  };

  const handleBan = async () => {
    setBanLoading(true);
    try {
      await api(`/users/${banUserId}/ban`, { method: 'POST', body: JSON.stringify({ ban: true, reason: banReason || '管理员操作' }) });
      setShowBanModal(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBanLoading(false);
    }
  };

  // 删除用户（弹窗确认）
  const openDeleteModal = (userId: string, userName: string) => {
    setDeleteUserId(userId);
    setDeleteUserName(userName);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await api(`/users/${deleteUserId}`, { method: 'DELETE' });
      setShowDeleteModal(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  // 解封用户
  const handleUnban = async (userId: string) => {
    setActionLoading(`${userId}-unban`);
    try {
      await api(`/users/${userId}/ban`, { method: 'POST', body: JSON.stringify({ ban: false }) });
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  };

  // 注册用户
  const handleCreate = async () => {
    setCreateError('');
    if (!createForm.username || !createForm.password) { setCreateError('用户ID和密码为必填项'); return; }
    if (!/^[a-zA-Z0-9_]{1,20}$/.test(createForm.username)) { setCreateError('用户ID只能包含字母、数字和下划线，长度1-20位'); return; }
    if (createForm.password.length < 8) { setCreateError('密码至少8位'); return; }
    setCreateLoading(true);
    try {
      await api('/users/create', { method: 'POST', body: JSON.stringify(createForm) });
      setShowCreateModal(false);
      setCreateForm({ username: '', password: '', nickname: '', phone: '', email: '', bio: '' });
      fetchUsers();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  // 打开编辑弹窗
  const openEditModal = (user: any) => {
    setEditUserId(user.id);
    setEditForm({
      username: user.username || '',
      nickname: user.nickname || '',
      phone: user.phone || '',
      email: user.email || '',
      bio: user.bio || '',
      password: '',
    });
    setEditError('');
    setShowEditModal(true);
  };

  // 保存编辑
  const handleEdit = async () => {
    setEditError('');
    if (editForm.username && !/^[a-zA-Z0-9_]{1,20}$/.test(editForm.username)) { setEditError('用户ID只能包含字母、数字和下划线，长度1-20位'); return; }
    if (editForm.password && editForm.password.length < 8) { setEditError('密码至少8位'); return; }
    setEditLoading(true);
    try {
      const body: any = {};
      if (editForm.username) body.username = editForm.username;
      if (editForm.nickname !== undefined) body.nickname = editForm.nickname;
      if (editForm.phone !== undefined) body.phone = editForm.phone;
      if (editForm.email !== undefined) body.email = editForm.email;
      if (editForm.bio !== undefined) body.bio = editForm.bio;
      if (editForm.password) body.password = editForm.password;
      await api(`/users/${editUserId}`, { method: 'PUT', body: JSON.stringify(body) });
      setShowEditModal(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  };

  const statusBadge = (isBanned: boolean) => {
    if (isBanned) return <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">已封禁</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400">正常</span>;
  };

  const inputClass = "w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 transition-all";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-400" />
          用户管理
          <span className="text-sm font-normal text-slate-400">({total})</span>
        </h2>
        <button
          onClick={() => { setCreateForm({ username: '', password: '', nickname: '', phone: '', email: '', bio: '' }); setCreateError(''); setShowCreateModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <UserPlus className="w-4 h-4" /> 注册用户
        </button>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索用户ID、昵称、邮箱、手机号..."
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 transition-all"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500/50 appearance-none cursor-pointer"
        >
          <option value="all" className="bg-slate-800">全部状态</option>
          <option value="active" className="bg-slate-800">正常</option>
          <option value="banned" className="bg-slate-800">已封禁</option>
        </select>
      </div>

      {/* 用户列表 */}
      {loading ? <LoadingSpinner /> : (
        <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="text-left px-4 py-3 font-medium">用户</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">用户ID</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">手机号</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">邮箱</th>
                  <th className="text-center px-4 py-3 font-medium">状态</th>
                  <th className="text-center px-4 py-3 font-medium hidden md:table-cell">动态数</th>
                  <th className="text-center px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">暂无用户数据</td></tr>
                ) : users.map(user => (
                  <tr key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.avatar ? (
                          <img src={user.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-sm font-medium">
                            {(user.nickname || user.username || '?')[0]}
                          </div>
                        )}
                        <div>
                          <span className="text-white font-medium">{user.nickname || user.username}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 hidden md:table-cell font-mono text-xs">{user.username}</td>
                    <td className="px-4 py-3 text-slate-400 hidden md:table-cell text-xs">{user.phone || '-'}</td>
                    <td className="px-4 py-3 text-slate-400 hidden lg:table-cell text-xs">{user.email || '-'}</td>
                    <td className="px-4 py-3 text-center">{statusBadge(user.isBanned)}</td>
                    <td className="px-4 py-3 text-center text-slate-400 hidden md:table-cell">{user.postsCount || 0}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white min-w-[36px] min-h-[36px] flex items-center justify-center"
                          title="查看详情"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditModal(user)}
                          className="p-2 hover:bg-blue-500/20 rounded-lg transition-colors text-slate-400 hover:text-blue-400 min-w-[36px] min-h-[36px] flex items-center justify-center"
                          title="编辑信息"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {!user.isBanned ? (
                          <button
                            onClick={() => openBanModal(user.id, user.nickname || user.username)}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-slate-400 hover:text-red-400 min-w-[36px] min-h-[36px] flex items-center justify-center"
                            title="封禁"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUnban(user.id)}
                            disabled={actionLoading === `${user.id}-unban`}
                            className="p-2 hover:bg-emerald-500/20 rounded-lg transition-colors text-slate-400 hover:text-emerald-400 min-w-[36px] min-h-[36px] flex items-center justify-center"
                            title="解封"
                          >
                            <UserCheck className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openDeleteModal(user.id, user.nickname || user.username)}
                          className="p-2 hover:bg-red-900/40 rounded-lg transition-colors text-slate-500 hover:text-red-400 min-w-[36px] min-h-[36px] flex items-center justify-center"
                          title="删除用户"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========== 用户详情弹窗 ========== */}
      <AnimatePresence>
        {selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setSelectedUser(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-800 rounded-2xl border border-white/10 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">用户详情</h3>
                <button onClick={() => setSelectedUser(null)} className="p-1 hover:bg-white/10 rounded-lg">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              {/* 头像和基本信息 */}
              <div className="flex items-center gap-4 mb-4">
                {selectedUser.avatar ? (
                  <img src={selectedUser.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-2xl font-bold">
                    {(selectedUser.nickname || selectedUser.username || '?')[0]}
                  </div>
                )}
                <div>
                  <div className="text-white font-bold text-lg">{selectedUser.nickname || selectedUser.username}</div>
                  <div className="text-slate-400 text-sm font-mono">@{selectedUser.username}</div>
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">用户ID</span><span className="text-white font-mono">{selectedUser.username}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">昵称</span><span className="text-white">{selectedUser.nickname || '-'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">手机号</span><span className="text-white">{selectedUser.phone || '-'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">邮箱</span><span className="text-white">{selectedUser.email || '-'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">简介</span><span className="text-white text-right max-w-[200px] truncate">{selectedUser.bio || '-'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">状态</span>{statusBadge(selectedUser.isBanned)}</div>
                <div className="flex justify-between"><span className="text-slate-400">动态数</span><span className="text-white">{selectedUser.postsCount || 0}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">注册时间</span><span className="text-white">{formatTime(selectedUser.createdAt)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">最后登录</span><span className="text-white">{selectedUser.lastLoginAt ? formatTime(selectedUser.lastLoginAt) : '-'}</span></div>
                {selectedUser.lastLoginIp && (
                  <div className="flex justify-between"><span className="text-slate-400">最后登录IP</span><span className="text-white font-mono text-xs">{selectedUser.lastLoginIp}</span></div>
                )}
                {selectedUser.banReason && (
                  <div className="flex justify-between"><span className="text-slate-400">封禁原因</span><span className="text-red-400">{selectedUser.banReason}</span></div>
                )}
              </div>
              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => { openEditModal(selectedUser); }}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm flex items-center justify-center gap-1"
                >
                  <Edit3 className="w-3.5 h-3.5" /> 编辑信息
                </button>
                {!selectedUser.isBanned ? (
                  <button
                    onClick={() => openBanModal(selectedUser.id, selectedUser.nickname || selectedUser.username)}
                    className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm flex items-center justify-center gap-1"
                  >
                    <Ban className="w-3.5 h-3.5" /> 封禁
                  </button>
                ) : (
                  <button
                    onClick={() => handleUnban(selectedUser.id)}
                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm flex items-center justify-center gap-1"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> 解封
                  </button>
                )}
                <button
                  onClick={() => openDeleteModal(selectedUser.id, selectedUser.nickname || selectedUser.username)}
                  className="py-2 px-3 bg-red-900/40 hover:bg-red-800/60 text-red-400 rounded-xl text-sm flex items-center justify-center gap-1 border border-red-800/30"
                >
                  <Trash2 className="w-3.5 h-3.5" /> 删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== 注册用户弹窗 ========== */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-800 rounded-2xl border border-white/10 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-emerald-400" /> 注册新用户
                </h3>
                <button onClick={() => setShowCreateModal(false)} className="p-1 hover:bg-white/10 rounded-lg">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">用户ID <span className="text-red-400">*</span></label>
                  <input type="text" value={createForm.username} onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))} placeholder="字母、数字、下划线，1-20位" className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">密码 <span className="text-red-400">*</span></label>
                  <input type="password" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="至少8位，包含大小写字母和数字" className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">昵称</label>
                  <input type="text" value={createForm.nickname} onChange={e => setCreateForm(f => ({ ...f, nickname: e.target.value }))} placeholder="留空则默认为用户ID" className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">手机号</label>
                  <input type="text" value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} placeholder="可选" className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">邮箱</label>
                  <input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} placeholder="可选" className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">简介</label>
                  <textarea value={createForm.bio} onChange={e => setCreateForm(f => ({ ...f, bio: e.target.value }))} placeholder="可选" rows={2} className={inputClass} />
                </div>
                {createError && <p className="text-red-400 text-sm">{createError}</p>}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setShowCreateModal(false)} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-sm transition-colors">取消</button>
                  <button onClick={handleCreate} disabled={createLoading} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1">
                    {createLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    {createLoading ? '创建中...' : '创建用户'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== 编辑用户弹窗 ========== */}
      <AnimatePresence>
        {showEditModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setShowEditModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-800 rounded-2xl border border-white/10 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-blue-400" /> 编辑用户信息
                </h3>
                <button onClick={() => setShowEditModal(false)} className="p-1 hover:bg-white/10 rounded-lg">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">用户ID</label>
                  <input type="text" value={editForm.username} onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))} placeholder="字母、数字、下划线，1-20位" className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">昵称</label>
                  <input type="text" value={editForm.nickname} onChange={e => setEditForm(f => ({ ...f, nickname: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">手机号</label>
                  <input type="text" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">邮箱</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">简介</label>
                  <textarea value={editForm.bio} onChange={e => setEditForm(f => ({ ...f, bio: e.target.value }))} rows={2} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">重置密码 <span className="text-slate-600">(留空不修改)</span></label>
                  <input type="password" value={editForm.password} onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} placeholder="输入新密码（至少8位）" className={inputClass} />
                </div>
                {editError && <p className="text-red-400 text-sm">{editError}</p>}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setShowEditModal(false)} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-sm transition-colors">取消</button>
                  <button onClick={handleEdit} disabled={editLoading} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1">
                    {editLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {editLoading ? '保存中...' : '保存修改'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== 删除用户弹窗 ========== */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setShowDeleteModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-800 rounded-2xl border border-red-800/40 p-6 w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Trash2 className="w-5 h-5 text-red-400" /> 删除用户
                </h3>
                <button onClick={() => setShowDeleteModal(false)} className="p-1 hover:bg-white/10 rounded-lg">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
                <p className="text-red-300 text-sm font-medium mb-1">⚠️ 此操作不可撤销</p>
                <p className="text-slate-300 text-sm">确认删除用户 <span className="text-white font-medium">{deleteUserName}</span>？删除后该用户的所有数据将被永久清除，无法恢复。</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-sm transition-colors">取消</button>
                <button onClick={handleDelete} disabled={deleteLoading} className="flex-1 py-2.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1">
                  {deleteLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {deleteLoading ? '处理中...' : '确认删除'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== 封禁用户弹窗 ========== */}
      <AnimatePresence>
        {showBanModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setShowBanModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-800 rounded-2xl border border-white/10 p-6 w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Ban className="w-5 h-5 text-red-400" /> 封禁用户
                </h3>
                <button onClick={() => setShowBanModal(false)} className="p-1 hover:bg-white/10 rounded-lg">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <p className="text-slate-300 text-sm mb-4">确认封禁用户 <span className="text-white font-medium">{banUserName}</span>？封禁后该用户将无法登录和使用系统。</p>
              <div className="mb-4">
                <label className="block text-sm text-slate-400 mb-1">封禁原因</label>
                <textarea
                  value={banReason}
                  onChange={e => setBanReason(e.target.value)}
                  placeholder="请输入封禁原因（可选）"
                  rows={3}
                  className={inputClass}
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowBanModal(false)} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-sm transition-colors">取消</button>
                <button onClick={handleBan} disabled={banLoading} className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1">
                  {banLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                  {banLoading ? '处理中...' : '确认封禁'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ 举报管理 ============

function ReportsPanel() {
  const [reports, setReports] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/reports?status=${statusFilter}`);
      setReports(data.reports);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const handleResolve = async (id: string, resolution: string, action?: string) => {
    try {
      await api(`/reports/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution, action }) });
      fetchReports();
    } catch (err: any) { alert(err.message); }
  };

  const handleDismiss = async (id: string) => {
    try {
      await api(`/reports/${id}/dismiss`, { method: 'POST' });
      fetchReports();
    } catch (err: any) { alert(err.message); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-amber-500/20 text-amber-400',
      resolved: 'bg-emerald-500/20 text-emerald-400',
      dismissed: 'bg-slate-500/20 text-slate-400',
    };
    const labels: Record<string, string> = { pending: '待处理', resolved: '已处理', dismissed: '已驳回' };
    return <span className={`px-2 py-0.5 rounded-full text-xs ${map[status]}`}>{labels[status]}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FileWarning className="w-5 h-5 text-amber-400" />
          举报管理
        </h2>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none appearance-none cursor-pointer"
        >
          <option value="all" className="bg-slate-800">全部</option>
          <option value="pending" className="bg-slate-800">待处理</option>
          <option value="resolved" className="bg-slate-800">已处理</option>
          <option value="dismissed" className="bg-slate-800">已驳回</option>
        </select>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="space-y-3">
          {reports.length === 0 ? (
            <div className="text-center py-16 text-slate-500">暂无举报记录</div>
          ) : reports.map(r => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 rounded-xl border border-white/10 p-4"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {statusBadge(r.status)}
                    <span className="text-xs text-slate-500">{formatTime(r.createdAt)}</span>
                  </div>
                  <div className="text-sm text-white">
                    <span className="text-slate-400">举报人：</span>{r.reporterName}
                    <span className="text-slate-600 mx-2">|</span>
                    <span className="text-slate-400">被举报：</span><span className="text-red-400">{r.targetName}</span>
                  </div>
                </div>
              </div>
              <div className="text-sm text-slate-300 mb-1">
                <span className="text-slate-500">原因：</span>{r.reason}
              </div>
              {r.detail && <div className="text-xs text-slate-500 mb-3">{r.detail}</div>}
              {r.resolution && <div className="text-xs text-emerald-400 mb-2">处理结果：{r.resolution} (by {r.resolvedBy})</div>}

              {r.status === 'pending' && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
                  <button
                    onClick={() => handleResolve(r.id, '已警告用户')}
                    className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg text-xs flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" /> 警告处理
                  </button>
                  <button
                    onClick={() => handleResolve(r.id, '已封禁用户', 'ban')}
                    className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-xs flex items-center gap-1"
                  >
                    <Ban className="w-3 h-3" /> 封禁用户
                  </button>
                  <button
                    onClick={() => handleDismiss(r.id)}
                    className="px-3 py-1.5 bg-slate-600/20 hover:bg-slate-600/30 text-slate-400 rounded-lg text-xs flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> 驳回
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 敏感词管理 ============

function SensitiveWordsPanel() {
  const [words, setWords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newCategory, setNewCategory] = useState('custom');
  const [newLevel, setNewLevel] = useState('block');

  const fetchWords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/sensitive-words');
      setWords(data.words);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWords(); }, [fetchWords]);

  const handleAdd = async () => {
    if (!newWord.trim()) return;
    try {
      await api('/sensitive-words', { method: 'POST', body: JSON.stringify({ word: newWord, category: newCategory, level: newLevel }) });
      setNewWord('');
      setShowAdd(false);
      fetchWords();
    } catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此敏感词？')) return;
    try {
      await api(`/sensitive-words/${id}`, { method: 'DELETE' });
      fetchWords();
    } catch (err: any) { alert(err.message); }
  };

  const categoryLabels: Record<string, string> = { politics: '政治', porn: '色情', violence: '暴力', spam: '垃圾信息', custom: '自定义' };
  const levelLabels: Record<string, { label: string; color: string }> = {
    block: { label: '拦截', color: 'bg-red-500/20 text-red-400' },
    warn: { label: '警告', color: 'bg-amber-500/20 text-amber-400' },
    review: { label: '审核', color: 'bg-blue-500/20 text-blue-400' },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <MessageSquareWarning className="w-5 h-5 text-cyan-400" />
          敏感词管理
          <span className="text-sm font-normal text-slate-400">({words.length})</span>
        </h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> 添加
        </button>
      </div>

      {/* 添加表单 */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
              <input
                type="text"
                value={newWord}
                onChange={e => setNewWord(e.target.value)}
                placeholder="输入敏感词..."
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                autoFocus
              />
              <div className="flex gap-3">
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm appearance-none">
                  <option value="custom" className="bg-slate-800">自定义</option>
                  <option value="spam" className="bg-slate-800">垃圾信息</option>
                  <option value="porn" className="bg-slate-800">色情</option>
                  <option value="violence" className="bg-slate-800">暴力</option>
                  <option value="politics" className="bg-slate-800">政治</option>
                </select>
                <select value={newLevel} onChange={e => setNewLevel(e.target.value)} className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm appearance-none">
                  <option value="block" className="bg-slate-800">拦截</option>
                  <option value="warn" className="bg-slate-800">警告</option>
                  <option value="review" className="bg-slate-800">审核</option>
                </select>
                <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm">
                  确认添加
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? <LoadingSpinner /> : (
        <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="text-left px-4 py-3 font-medium">敏感词</th>
                <th className="text-center px-4 py-3 font-medium">分类</th>
                <th className="text-center px-4 py-3 font-medium">级别</th>
                <th className="text-center px-4 py-3 font-medium hidden md:table-cell">添加人</th>
                <th className="text-center px-4 py-3 font-medium hidden md:table-cell">添加时间</th>
                <th className="text-center px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {words.map(w => (
                <tr key={w.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{w.word}</td>
                  <td className="px-4 py-3 text-center text-slate-400">{categoryLabels[w.category] || w.category}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${levelLabels[w.level]?.color}`}>{levelLabels[w.level]?.label}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-400 hidden md:table-cell">{w.addedBy}</td>
                  <td className="px-4 py-3 text-center text-slate-500 text-xs hidden md:table-cell">{formatTime(w.createdAt)}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleDelete(w.id)} className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ IP 黑名单 ============

function IPBlacklistPanel() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newIP, setNewIP] = useState('');
  const [newReason, setNewReason] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/ip-blacklist');
      setList(data.list);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleAdd = async () => {
    if (!newIP.trim()) return;
    try {
      await api('/ip-blacklist', { method: 'POST', body: JSON.stringify({ ip: newIP, reason: newReason }) });
      setNewIP('');
      setNewReason('');
      setShowAdd(false);
      fetchList();
    } catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定移除此 IP？')) return;
    try {
      await api(`/ip-blacklist/${id}`, { method: 'DELETE' });
      fetchList();
    } catch (err: any) { alert(err.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Globe className="w-5 h-5 text-red-400" />
          IP 黑名单
          <span className="text-sm font-normal text-slate-400">({list.length})</span>
        </h2>
        <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> 添加
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
              <input type="text" value={newIP} onChange={e => setNewIP(e.target.value)} placeholder="IP 地址（如 192.168.1.100）" className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50" autoFocus />
              <div className="flex gap-3">
                <input type="text" value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="封禁原因（可选）" className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50" />
                <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm">确认添加</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? <LoadingSpinner /> : list.length === 0 ? (
        <div className="text-center py-16 text-slate-500">暂无 IP 黑名单记录</div>
      ) : (
        <div className="space-y-2">
          {list.map(item => (
            <div key={item.id} className="bg-white/5 rounded-xl border border-white/10 p-4 flex items-center justify-between">
              <div>
                <div className="text-white font-mono text-sm">{item.ip}</div>
                <div className="text-xs text-slate-500 mt-1">{item.reason} · {item.addedBy} · {formatTime(item.createdAt)}</div>
              </div>
              <button onClick={() => handleDelete(item.id)} className="p-2 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 系统公告 ============

function AnnouncementsPanel() {
  const [anns, setAnns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState('info');

  const fetchAnns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/announcements');
      setAnns(data.announcements);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAnns(); }, [fetchAnns]);

  const handleAdd = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      await api('/announcements', { method: 'POST', body: JSON.stringify({ title: newTitle, content: newContent, type: newType }) });
      setNewTitle('');
      setNewContent('');
      setShowAdd(false);
      fetchAnns();
    } catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此公告？')) return;
    try {
      await api(`/announcements/${id}`, { method: 'DELETE' });
      fetchAnns();
    } catch (err: any) { alert(err.message); }
  };

  const typeIcons: Record<string, { icon: string; color: string }> = {
    info: { icon: 'i', color: 'bg-blue-500/20 text-blue-400' },
    warning: { icon: '!', color: 'bg-amber-500/20 text-amber-400' },
    update: { icon: 'U', color: 'bg-emerald-500/20 text-emerald-400' },
    maintenance: { icon: 'M', color: 'bg-purple-500/20 text-purple-400' },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-purple-400" />
          系统公告
        </h2>
        <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> 发布公告
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
              <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="公告标题" className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50" autoFocus />
              <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="公告内容..." rows={3} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 resize-none" />
              <div className="flex gap-3">
                <select value={newType} onChange={e => setNewType(e.target.value)} className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm appearance-none">
                  <option value="info" className="bg-slate-800">通知</option>
                  <option value="update" className="bg-slate-800">版本更新</option>
                  <option value="warning" className="bg-slate-800">警告</option>
                  <option value="maintenance" className="bg-slate-800">维护</option>
                </select>
                <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm">发布</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? <LoadingSpinner /> : anns.length === 0 ? (
        <div className="text-center py-16 text-slate-500">暂无公告</div>
      ) : (
        <div className="space-y-3">
          {anns.map(ann => {
            const t = typeIcons[ann.type] || typeIcons.info;
            return (
              <div key={ann.id} className="bg-white/5 rounded-xl border border-white/10 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${t.color}`}>{t.icon}</div>
                    <div>
                      <div className="text-white font-medium text-sm">{ann.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{ann.createdBy} · {formatTime(ann.createdAt)}</div>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(ann.id)} className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-slate-300 mt-3 pl-11">{ann.content}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ 操作日志 ============

function LogsPanel() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/logs?targetType=${typeFilter}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [typeFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const actionColors: Record<string, string> = {
    LOGIN: 'text-blue-400',
    LOGOUT: 'text-slate-400',
    BAN_USER: 'text-red-400',
    UNBAN_USER: 'text-emerald-400',
    MUTE_USER: 'text-amber-400',
    KICK_USER: 'text-orange-400',
    RESOLVE_REPORT: 'text-emerald-400',
    DISMISS_REPORT: 'text-slate-400',
    ADD_SENSITIVE_WORD: 'text-cyan-400',
    DELETE_SENSITIVE_WORD: 'text-red-400',
    ADD_IP_BLACKLIST: 'text-red-400',
    REMOVE_IP_BLACKLIST: 'text-emerald-400',
    CREATE_ANNOUNCEMENT: 'text-purple-400',
    DELETE_ANNOUNCEMENT: 'text-red-400',
    CREATE_ADMIN: 'text-blue-400',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-slate-400" />
          操作日志
          <span className="text-sm font-normal text-slate-400">({total})</span>
        </h2>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none appearance-none cursor-pointer">
          <option value="all" className="bg-slate-800">全部类型</option>
          <option value="user" className="bg-slate-800">用户操作</option>
          <option value="system" className="bg-slate-800">系统操作</option>
          <option value="content" className="bg-slate-800">内容操作</option>
          <option value="security" className="bg-slate-800">安全操作</option>
        </select>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="bg-white/5 rounded-xl border border-white/10 px-4 py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs font-mono font-bold ${actionColors[log.action] || 'text-slate-400'}`}>{log.action}</span>
                  <span className="text-xs text-slate-600">|</span>
                  <span className="text-xs text-slate-500">{log.adminName}</span>
                </div>
                <div className="text-sm text-slate-300 truncate">{log.detail}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs text-slate-500">{formatTime(log.timestamp)}</div>
                <div className="text-xs text-slate-600 font-mono">{log.ip}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 管理员管理 ============

function AdminsPanel() {
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('moderator');

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/admins');
      setAdmins(data.admins);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const handleAdd = async () => {
    if (!newUsername.trim() || !newPassword.trim()) return;
    try {
      await api('/admins', { method: 'POST', body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }) });
      setNewUsername('');
      setNewPassword('');
      setShowAdd(false);
      fetchAdmins();
    } catch (err: any) { alert(err.message); }
  };

  const roleLabels: Record<string, { label: string; color: string }> = {
    superadmin: { label: '超级管理员', color: 'bg-red-500/20 text-red-400' },
    admin: { label: '管理员', color: 'bg-blue-500/20 text-blue-400' },
    moderator: { label: '审核员', color: 'bg-emerald-500/20 text-emerald-400' },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-slate-400" />
          管理员管理
        </h2>
        <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> 添加管理员
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
              <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="用户名" className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50" autoFocus />
              <div className="flex gap-3">
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="密码" className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50" />
                <select value={newRole} onChange={e => setNewRole(e.target.value)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm appearance-none">
                  <option value="moderator" className="bg-slate-800">审核员</option>
                  <option value="admin" className="bg-slate-800">管理员</option>
                  <option value="superadmin" className="bg-slate-800">超级管理员</option>
                </select>
                <button onClick={handleAdd} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm">添加</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? <LoadingSpinner /> : (
        <div className="space-y-2">
          {admins.map(a => {
            const r = roleLabels[a.role] || roleLabels.moderator;
            return (
              <div key={a.id} className="bg-white/5 rounded-xl border border-white/10 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-white font-medium">
                    {(a.username || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-white font-medium text-sm">{a.username}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {a.lastLoginAt ? `最后登录: ${formatTime(a.lastLoginAt)}` : '从未登录'}
                    </div>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs ${r.color}`}>{r.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ 邮箱 SMTP 配置面板 ============

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  authUser: string;
  authPass: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  enabled: boolean;
}

interface EmailTemplates {
  verifyCode: { subject: string; body: string; expireMinutes: number };
  welcome: { subject: string; body: string; enabled: boolean };
  resetPassword: { subject: string; body: string; expireMinutes: number };
  loginAlert: { subject: string; body: string; enabled: boolean };
}

interface TestEmailRecord {
  id: string;
  to: string;
  status: 'success' | 'error' | string;
  message: string;
  createdAt: string;
}

const defaultSmtpConfig = (): SmtpConfig => ({
  host: '',
  port: 465,
  secure: true,
  authUser: '',
  authPass: '',
  fromName: 'imim',
  fromAddress: '',
  replyTo: '',
  enabled: false,
});

function normalizeSmtpConfig(input: Partial<SmtpConfig> & Record<string, any> = {}): SmtpConfig {
  return {
    host: input.host || '',
    port: Number(input.port || 465),
    secure: input.secure !== undefined ? !!input.secure : true,
    authUser: input.authUser ?? input.user ?? '',
    authPass: input.authPass ?? input.pass ?? '',
    fromName: input.fromName || 'imim',
    fromAddress: input.fromAddress ?? input.fromEmail ?? '',
    replyTo: input.replyTo || '',
    enabled: !!input.enabled,
  };
}

function SmtpPanel() {
  const [activeTab, setActiveTab] = useState<'server' | 'templates' | 'test'>('server');
  const [config, setConfig] = useState<SmtpConfig>(defaultSmtpConfig());
  const [templates, setTemplates] = useState<EmailTemplates | null>(null);
  const [testHistory, setTestHistory] = useState<TestEmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<'verifyCode' | 'welcome' | 'resetPassword' | 'loginAlert'>('verifyCode');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgData, tplData, histData] = await Promise.all([
        api('/smtp/config'),
        api('/smtp/templates'),
        api('/smtp/test-history'),
      ]);
      setConfig(normalizeSmtpConfig(cfgData.config));
      setTemplates(tplData.templates);
      setTestHistory(histData.history);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const payload = normalizeSmtpConfig(config);
      await api('/smtp/config', { method: 'PUT', body: JSON.stringify(payload) });
      setConfig(payload);
      setSaveMsg('配置已保存');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleSaveTemplates = async () => {
    if (!templates) return;
    setSaving(true);
    try {
      await api('/smtp/templates', { method: 'PUT', body: JSON.stringify(templates) });
      setSaveMsg('模板已保存');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleSendTest = async () => {
    if (!testTo.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api('/smtp/test', { method: 'POST', body: JSON.stringify({ to: testTo }) });
      setTestResult({ ok: true, message: res.message });
      fetchAll();
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message });
    } finally { setTesting(false); }
  };

  const presetProviders = [
    { label: 'QQ 邮箱', host: 'smtp.qq.com', port: 465, secure: true },
    { label: '163 邮箱', host: 'smtp.163.com', port: 465, secure: true },
    { label: '腾讯企业邮', host: 'smtp.exmail.qq.com', port: 465, secure: true },
    { label: 'Gmail', host: 'smtp.gmail.com', port: 587, secure: false },
    { label: 'Outlook', host: 'smtp.office365.com', port: 587, secure: false },
    { label: 'Zoho', host: 'smtp.zoho.com', port: 465, secure: true },
    { label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false },
    { label: '自建服务器', host: 'mail.example.com', port: 465, secure: true },
  ];

  const tabs = [
    { id: 'server' as const, label: '服务器配置', icon: Server },
    { id: 'templates' as const, label: '邮件模板', icon: FileText },
    { id: 'test' as const, label: '发送测试', icon: FlaskConical },
  ];

  const inputCls = 'w-full min-w-0 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-sky-500/50 transition-colors';
  const labelCls = 'text-xs text-slate-400 mb-1.5 block';

  const templateLabels = {
    verifyCode: { label: '验证码邮件', desc: '用户注册 / 登录验证码' },
    welcome: { label: '欢迎邮件', desc: '注册成功后发送' },
    resetPassword: { label: '重置密码', desc: '找回密码流程' },
    loginAlert: { label: '异地登录通知', desc: '检测到异地登录时发送' },
  };

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Mail className="w-5 h-5 text-sky-400" />
          邮箱 SMTP 配置
        </h2>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {saveMsg && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-emerald-400 text-sm flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" /> {saveMsg}
            </motion.span>
          )}
          <button onClick={fetchAll} className="p-2 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 状态卡片 */}
      <div className={`flex flex-col gap-3 px-4 py-3 rounded-xl border sm:flex-row sm:items-center ${
        config.enabled
          ? 'bg-emerald-500/10 border-emerald-500/20'
          : 'bg-white/5 border-white/10'
      }`}>
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          config.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
        }`} />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-medium ${
            config.enabled ? 'text-emerald-400' : 'text-slate-400'
          }`}>
            SMTP 服务 {config.enabled ? '已启用' : '未启用'}
          </span>
          {config.enabled && config.host && (
            <span className="text-xs text-slate-500 ml-2">{config.host}:{config.port}</span>
          )}
        </div>
        <button
          onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${
            config.enabled ? 'text-emerald-400' : 'text-slate-600'
          }`}
        >
          {config.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
        </button>
      </div>

      {/* Tab 导航 */}
      <div className="flex gap-1 overflow-x-auto bg-white/5 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-[108px] whitespace-nowrap flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
              activeTab === tab.id
                ? 'bg-sky-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {/* 服务器配置 Tab */}
            {activeTab === 'server' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)] gap-4 items-start">
                  <div className="space-y-4">
                    {/* 快捷选择服务商 */}
                    <div className="bg-white/5 rounded-xl border border-white/10 p-4 sm:p-5">
                  <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    快捷选择服务商
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {presetProviders.map(p => (
                      <button
                        key={p.label}
                        onClick={() => setConfig(c => ({ ...c, host: p.host, port: p.port, secure: p.secure }))}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                          config.host === p.host
                            ? 'bg-sky-600 border-sky-500 text-white'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                    </div>

                    {/* 服务器信息 */}
                    <div className="bg-white/5 rounded-xl border border-white/10 p-4 sm:p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <Server className="w-4 h-4 text-sky-400" />
                    SMTP 服务器
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label className={labelCls}>SMTP 服务器地址</label>
                      <input
                        type="text"
                        value={config.host}
                        onChange={e => setConfig(c => ({ ...c, host: e.target.value }))}
                        className={inputCls}
                        placeholder="smtp.example.com"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>端口</label>
                      <input
                        type="number"
                        value={config.port}
                        onChange={e => setConfig(c => ({ ...c, port: Number(e.target.value) }))}
                        className={inputCls}
                        placeholder="465"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4 py-3 border-t border-white/5">
                    <div>
                      <div className="text-sm text-white">SSL/TLS 加密</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {config.secure ? '使用 SSL/TLS（端口 465）' : '使用 STARTTLS（端口 587）或明文'}
                      </div>
                    </div>
                    <button
                      onClick={() => setConfig(c => ({ ...c, secure: !c.secure, port: !c.secure ? 465 : 587 }))}
                      className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${config.secure ? 'text-emerald-400' : 'text-slate-600'}`}
                    >
                      {config.secure ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                    </button>
                  </div>
                    </div>
                  </div>

                  <div className="space-y-4 xl:sticky xl:top-4">
                    {/* 身份验证 */}
                    <div className="bg-white/5 rounded-xl border border-white/10 p-4 sm:p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-amber-400" />
                    身份验证
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>账号（邮箱地址）</label>
                      <input
                        type="text"
                        value={config.authUser}
                        onChange={e => setConfig(c => ({ ...c, authUser: e.target.value }))}
                        className={inputCls}
                        placeholder="user@example.com"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>授权码 / 密码</label>
                      <div className="relative">
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={config.authPass}
                          onChange={e => setConfig(c => ({ ...c, authPass: e.target.value }))}
                          className={inputCls + ' pr-10'}
                          placeholder="密码或应用授权码"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                    </div>

                    {/* 发件人信息 */}
                    <div className="bg-white/5 rounded-xl border border-white/10 p-4 sm:p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-sky-400" />
                    发件人信息
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>发件人名称</label>
                      <input
                        type="text"
                        value={config.fromName}
                        onChange={e => setConfig(c => ({ ...c, fromName: e.target.value }))}
                        className={inputCls}
                        placeholder="imim"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>发件人地址</label>
                      <input
                        type="email"
                        value={config.fromAddress}
                        onChange={e => setConfig(c => ({ ...c, fromAddress: e.target.value }))}
                        className={inputCls}
                        placeholder="noreply@example.com"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelCls}>Reply-To 地址（可选）</label>
                      <input
                        type="email"
                        value={config.replyTo}
                        onChange={e => setConfig(c => ({ ...c, replyTo: e.target.value }))}
                        className={inputCls}
                        placeholder="support@example.com"
                      />
                    </div>
                  </div>

                    <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4 space-y-2">
                      <div className="text-sm font-medium text-white">填写建议</div>
                      <p className="text-xs leading-6 text-slate-300">
                        建议将“账号”填写为完整发信邮箱地址，将“授权码 / 密码”填写为邮箱服务商生成的 SMTP 授权码；保存后密码会以掩码展示，但实际已保留。
                      </p>
                      <p className="text-xs leading-6 text-slate-400">
                        如果使用 QQ、163、企业邮等服务，通常需要先在邮箱后台开启 SMTP/IMAP 并生成独立授权码。
                      </p>
                    </div>
                  </div>
                </div>
              </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="w-full sm:w-auto justify-center px-5 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-xl text-sm flex items-center gap-2 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? '保存中...' : '保存配置'}
                  </button>
                </div>
              </div>
            )}

            {/* 邮件模板 Tab */}
            {activeTab === 'templates' && templates && (
                <div className="space-y-4">
                  {/* 模板选择 */}
                  <div className="flex gap-2 overflow-x-auto pb-1">

                  {(Object.keys(templateLabels) as Array<keyof typeof templateLabels>).map(key => (
                    <button
                      key={key}
                      onClick={() => setActiveTemplate(key)}
                        className={`flex-1 min-w-[140px] px-3 py-2 rounded-xl text-xs border transition-all ${

                        activeTemplate === key
                          ? 'bg-sky-600 border-sky-500 text-white'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="font-medium">{templateLabels[key].label}</div>
                      <div className="opacity-70 mt-0.5 hidden sm:block">{templateLabels[key].desc}</div>
                    </button>
                  ))}
                </div>

                {/* 验证码模板 */}
                {activeTemplate === 'verifyCode' && (
                  <div className="bg-white/5 rounded-xl border border-white/10 p-5 space-y-4">
                    <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3">
                      <p className="text-sky-300 text-xs leading-relaxed">
                        可用变量：
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}username{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}code{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}expire{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}login_time{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}device_info{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}ip_address{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}security_center_url{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}appName{'}'}{'}'}</code>
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>邮件主题</label>
                      <input
                        type="text"
                        value={templates.verifyCode.subject}
                        onChange={e => setTemplates(t => t ? { ...t, verifyCode: { ...t.verifyCode, subject: e.target.value } } : t)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>有效期（分钟）</label>
                      <input
                        type="number"
                        value={templates.verifyCode.expireMinutes}
                        onChange={e => setTemplates(t => t ? { ...t, verifyCode: { ...t.verifyCode, expireMinutes: Number(e.target.value) } } : t)}
                        className={inputCls}
                        min={1} max={60}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>邮件正文（HTML）</label>
                      <textarea
                        value={templates.verifyCode.body}
                        onChange={e => setTemplates(t => t ? { ...t, verifyCode: { ...t.verifyCode, body: e.target.value } } : t)}
                        rows={10}
                        className={inputCls + ' resize-y font-mono text-xs leading-relaxed'}
                      />
                    </div>
                  </div>
                )}

                {/* 欢迎模板 */}
                {activeTemplate === 'welcome' && (
                  <div className="bg-white/5 rounded-xl border border-white/10 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-white">启用欢迎邮件</div>
                        <div className="text-xs text-slate-500 mt-0.5">用户注册成功后自动发送</div>
                      </div>
                      <button
                        onClick={() => setTemplates(t => t ? { ...t, welcome: { ...t.welcome, enabled: !t.welcome.enabled } } : t)}
                        className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${templates.welcome.enabled ? 'text-emerald-400' : 'text-slate-600'}`}
                      >
                        {templates.welcome.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                      </button>
                    </div>
                    <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3">
                      <p className="text-sky-300 text-xs">
                        可用变量：
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}username{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}appName{'}'}{'}'}</code>
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>邮件主题</label>
                      <input
                        type="text"
                        value={templates.welcome.subject}
                        onChange={e => setTemplates(t => t ? { ...t, welcome: { ...t.welcome, subject: e.target.value } } : t)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>邮件正文（HTML）</label>
                      <textarea
                        value={templates.welcome.body}
                        onChange={e => setTemplates(t => t ? { ...t, welcome: { ...t.welcome, body: e.target.value } } : t)}
                        rows={10}
                        className={inputCls + ' resize-y font-mono text-xs leading-relaxed'}
                      />
                    </div>
                  </div>
                )}

                {/* 重置密码模板 */}
                {activeTemplate === 'resetPassword' && (
                  <div className="bg-white/5 rounded-xl border border-white/10 p-5 space-y-4">
                    <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3">
                      <p className="text-sky-300 text-xs">
                        可用变量：
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}username{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}link{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}expire{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}appName{'}'}{'}'}</code>
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>邮件主题</label>
                      <input
                        type="text"
                        value={templates.resetPassword.subject}
                        onChange={e => setTemplates(t => t ? { ...t, resetPassword: { ...t.resetPassword, subject: e.target.value } } : t)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>有效期（分钟）</label>
                      <input
                        type="number"
                        value={templates.resetPassword.expireMinutes}
                        onChange={e => setTemplates(t => t ? { ...t, resetPassword: { ...t.resetPassword, expireMinutes: Number(e.target.value) } } : t)}
                        className={inputCls}
                        min={5} max={1440}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>邮件正文（HTML）</label>
                      <textarea
                        value={templates.resetPassword.body}
                        onChange={e => setTemplates(t => t ? { ...t, resetPassword: { ...t.resetPassword, body: e.target.value } } : t)}
                        rows={10}
                        className={inputCls + ' resize-y font-mono text-xs leading-relaxed'}
                      />
                    </div>
                  </div>
                )}

                {/* 异地登录通知模板 */}
                {activeTemplate === 'loginAlert' && templates.loginAlert && (
                  <div className="bg-white/5 rounded-xl border border-white/10 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-white">启用异地登录通知</div>
                        <div className="text-xs text-slate-500 mt-0.5">检测到异地登录时自动发送提醒邮件</div>
                      </div>
                      <button
                        onClick={() => setTemplates(t => t ? { ...t, loginAlert: { ...t.loginAlert, enabled: !t.loginAlert.enabled } } : t)}
                        className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${templates.loginAlert.enabled ? 'text-emerald-400' : 'text-slate-600'}`}
                      >
                        {templates.loginAlert.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                      </button>
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                      <p className="text-amber-300 text-xs leading-relaxed">
                        可用变量：
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}username{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}login_time{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}login_city{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}ip_address{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}device_info{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}last_login_time{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}last_login_city{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}last_login_ip{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}last_login_device{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}confirm_url{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}reject_url{'}'}{'}'}</code>
                        <code className="mx-1 bg-white/10 px-1.5 py-0.5 rounded">{'{'}{'{'}appName{'}'}{'}'}</code>
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>邮件主题</label>
                      <input
                        type="text"
                        value={templates.loginAlert.subject}
                        onChange={e => setTemplates(t => t ? { ...t, loginAlert: { ...t.loginAlert, subject: e.target.value } } : t)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>邮件正文（HTML）</label>
                      <textarea
                        value={templates.loginAlert.body}
                        onChange={e => setTemplates(t => t ? { ...t, loginAlert: { ...t.loginAlert, body: e.target.value } } : t)}
                        rows={14}
                        className={inputCls + ' resize-y font-mono text-xs leading-relaxed'}
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveTemplates}
                    disabled={saving}
                    className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-xl text-sm flex items-center gap-2 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? '保存中...' : '保存模板'}
                  </button>
                </div>
              </div>
            )}

            {/* 发送测试 Tab */}
            {activeTab === 'test' && (
              <div className="space-y-4">
                <div className="bg-white/5 rounded-xl border border-white/10 p-4 sm:p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-sky-400" />
                    发送测试邮件
                  </h3>
                  {!config.enabled && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-4">
                      <p className="text-amber-400 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        SMTP 尚未启用，请先在「服务器配置」中启用并保存。
                      </p>
                    </div>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="email"
                      value={testTo}
                      onChange={e => setTestTo(e.target.value)}
                      placeholder="输入收件人邮箱地址"
                      className={inputCls + ' flex-1'}
                      onKeyDown={e => e.key === 'Enter' && handleSendTest()}
                    />
                    <button
                      onClick={handleSendTest}
                      disabled={testing || !config.enabled}
                      className="w-full sm:w-auto justify-center px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-xl text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                    >
                      <SendHorizonal className="w-4 h-4" />
                      {testing ? '发送中...' : '发送测试'}
                    </button>
                  </div>

                  {testResult && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`mt-3 flex items-start gap-2 p-3 rounded-xl border text-sm ${
                        testResult.ok
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/10 border-red-500/20 text-red-400'
                      }`}
                    >
                      {testResult.ok
                        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                      {testResult.message}
                    </motion.div>
                  )}
                </div>

                {/* 发送历史 */}
                <div className="bg-white/5 rounded-xl border border-white/10 p-4 sm:p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    最近发送记录
                  </h3>
                  {testHistory.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <Mail className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">暂无发送记录</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {testHistory.map((r) => {
                        const ok = r.status === 'success';
                        return (
                          <div key={r.id} className="flex flex-col gap-2 py-2 border-b border-white/5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-2">
                              {ok
                                ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                              <div className="min-w-0">
                                <div className="text-sm text-white truncate">{r.to}</div>
                                <div className={`text-xs ${ok ? 'text-emerald-300/80' : 'text-red-300/80'}`}>{r.message}</div>
                              </div>
                            </div>
                            <span className="text-xs text-slate-500 sm:pl-4">{formatTime(r.createdAt)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

// ============ OneBot v11 配置面板 ============

interface OneBotConfig {
  botId: number;
  nickname: string;
  accessToken: string;
  heartbeatInterval: number;
  wsEnabled: boolean;
  httpEnabled: boolean;
  httpPort: number;
  wsPath: string;
  enableLog: boolean;
}

interface AutoReplyRule {
  id: string;
  keyword: string;
  matchType: 'exact' | 'contains' | 'regex';
  reply: string;
  scope: 'all' | 'group' | 'private';
  isActive: boolean;
  createdAt: number;
  hitCount: number;
}

interface AIConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  enableAI: boolean;
  triggerPrefix: string;
}

interface OneBotStats {
  connectedClients: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  uptimeSeconds: number;
  lastConnectedAt?: number;
}

function OneBotPanel() {
  const [activeTab, setActiveTab] = useState<'status' | 'config' | 'auto-reply' | 'ai'>('status');
  const [config, setConfig] = useState<OneBotConfig | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [stats, setStats] = useState<OneBotStats | null>(null);
  const [autoReplies, setAutoReplies] = useState<AutoReplyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // 新增自动回复表单
  const [showAddRule, setShowAddRule] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newMatchType, setNewMatchType] = useState<'exact' | 'contains' | 'regex'>('contains');
  const [newReply, setNewReply] = useState('');
  const [newScope, setNewScope] = useState<'all' | 'group' | 'private'>('all');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgData, statsData, arData, aiData] = await Promise.all([
        api('/onebot/config'),
        api('/onebot/status'),
        api('/onebot/auto-replies'),
        api('/onebot/ai-config'),
      ]);
      setConfig(cfgData.config);
      setStats(statsData);
      setAutoReplies(arData.rules);
      setAiConfig(aiData.config);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api('/onebot/config', { method: 'PUT', body: JSON.stringify(config) });
      setSaveMsg('配置已保存');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleSaveAI = async () => {
    if (!aiConfig) return;
    setSaving(true);
    try {
      await api('/onebot/ai-config', { method: 'PUT', body: JSON.stringify(aiConfig) });
      setSaveMsg('AI 配置已保存');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleAddRule = async () => {
    if (!newKeyword.trim() || !newReply.trim()) return;
    try {
      await api('/onebot/auto-replies', {
        method: 'POST',
        body: JSON.stringify({ keyword: newKeyword, matchType: newMatchType, reply: newReply, scope: newScope }),
      });
      setNewKeyword(''); setNewReply('');
      setShowAddRule(false);
      fetchAll();
    } catch (err: any) { alert(err.message); }
  };

  const handleToggleRule = async (rule: AutoReplyRule) => {
    try {
      await api(`/onebot/auto-replies/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      fetchAll();
    } catch (err: any) { alert(err.message); }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('确认删除该自动回复规则？')) return;
    try {
      await api(`/onebot/auto-replies/${id}`, { method: 'DELETE' });
      fetchAll();
    } catch (err: any) { alert(err.message); }
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}小时 ${m}分钟`;
    if (m > 0) return `${m}分钟 ${s}秒`;
    return `${s}秒`;
  };

  const tabs = [
    { id: 'status' as const, label: '实时状态', icon: Activity },
    { id: 'config' as const, label: '基础配置', icon: Settings },
    { id: 'auto-reply' as const, label: '自动回复', icon: Repeat },
    { id: 'ai' as const, label: 'AI 设置', icon: Brain },
  ];

  const inputCls = 'w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/50 transition-colors';
  const labelCls = 'text-xs text-slate-400 mb-1.5 block';

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Bot className="w-5 h-5 text-violet-400" />
          OneBot v11 机器人配置
        </h2>
        <div className="flex items-center gap-2">
          {saveMsg && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-emerald-400 text-sm flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" /> {saveMsg}
            </motion.span>
          )}
          <button onClick={fetchAll} className="p-2 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 连接状态卡片 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              {stats.connectedClients > 0
                ? <Wifi className="w-4 h-4 text-emerald-400" />
                : <WifiOff className="w-4 h-4 text-slate-500" />}
              <span className="text-xs text-slate-400">连接状态</span>
            </div>
            <div className={`text-lg font-bold ${stats.connectedClients > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
              {stats.connectedClients > 0 ? '已连接' : '未连接'}
            </div>
            <div className="text-xs text-slate-500 mt-1">{stats.connectedClients} 个客户端</div>
          </div>
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-slate-400">已发消息</span>
            </div>
            <div className="text-lg font-bold text-white">{stats.totalMessagesSent}</div>
            <div className="text-xs text-slate-500 mt-1">本次运行期间</div>
          </div>
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-slate-400">已收消息</span>
            </div>
            <div className="text-lg font-bold text-white">{stats.totalMessagesReceived}</div>
            <div className="text-xs text-slate-500 mt-1">来自用户</div>
          </div>
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-slate-400">运行时长</span>
            </div>
            <div className="text-lg font-bold text-white">{formatUptime(stats.uptimeSeconds)}</div>
            <div className="text-xs text-slate-500 mt-1">服务器运行中</div>
          </div>
        </div>
      )}

      {/* Tab 导航 */}
      <div className="flex flex-wrap gap-1 bg-white/5 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-[70px] flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
              activeTab === tab.id
                ? 'bg-violet-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {/* 实时状态 Tab */}
            {activeTab === 'status' && (
              <div className="space-y-4">
                <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-violet-400" />
                    AstrBot 连接指南
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-violet-400 text-xs font-bold">1</span>
                      </div>
                      <div>
                        <div className="text-white font-medium">打开 AstrBot WebUI</div>
                        <div className="text-slate-400 mt-0.5">导航至 Bots 页面，点击新建 Bot</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-violet-400 text-xs font-bold">2</span>
                      </div>
                      <div>
                        <div className="text-white font-medium">选择 OneBot v11 适配器</div>
                        <div className="text-slate-400 mt-0.5">连接方式选择「反向 WebSocket（Reverse WS）」</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-violet-400 text-xs font-bold">3</span>
                      </div>
                      <div>
                        <div className="text-white font-medium">填写连接地址</div>
                        <div className="text-slate-400 mt-0.5">
                          <code className="bg-white/10 px-2 py-0.5 rounded text-violet-300 text-xs">
                            ws://&lt;你的服务器地址&gt;{config?.wsPath || '/onebot/v11/ws'}
                          </code>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-violet-400 text-xs font-bold">4</span>
                      </div>
                      <div>
                        <div className="text-white font-medium">填写 Self ID</div>
                        <div className="text-slate-400 mt-0.5">
                          <code className="bg-white/10 px-2 py-0.5 rounded text-violet-300 text-xs">
                            {config?.botId || 10000}
                          </code>
                          （imim 预设的 BOT 账号 ID）
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3 h-3 text-emerald-400" />
                      </div>
                      <div>
                        <div className="text-white font-medium">保存并启用</div>
                        <div className="text-slate-400 mt-0.5">连接成功后，AstrBot 所有插件将自动在 imim 中生效</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 端点信息 */}
                <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-blue-400" />
                    可用端点
                  </h3>
                  <div className="space-y-2">
                    {[
                      { label: 'OneBot WS 端点', value: config?.wsPath || '/onebot/v11/ws', color: 'text-violet-300', enabled: config?.wsEnabled },
                      { label: 'HTTP API 端点', value: '/send_group_msg, /send_private_msg', color: 'text-blue-300', enabled: config?.httpEnabled },
                      { label: '消息推送接口', value: '/api/push-to-onebot', color: 'text-emerald-300', enabled: true },
                      { label: '状态查询', value: '/api/onebot-status', color: 'text-amber-300', enabled: true },
                    ].map(ep => (
                      <div key={ep.label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${ep.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          <span className="text-xs text-slate-400">{ep.label}</span>
                        </div>
                        <code className={`text-xs ${ep.color} bg-white/5 px-2 py-0.5 rounded`}>{ep.value}</code>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 基础配置 Tab */}
            {activeTab === 'config' && config && (
              <div className="space-y-4">
                <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <Bot className="w-4 h-4 text-violet-400" />
                    BOT 基本信息
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>BOT ID</label>
                      <input
                        type="number"
                        value={config.botId}
                        onChange={e => setConfig({ ...config, botId: Number(e.target.value) })}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>BOT 昵称</label>
                      <input
                        type="text"
                        value={config.nickname}
                        onChange={e => setConfig({ ...config, nickname: e.target.value })}
                        className={inputCls}
                        placeholder="imim AI"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Access Token（留空则不验证）</label>
                      <input
                        type="password"
                        value={config.accessToken}
                        onChange={e => setConfig({ ...config, accessToken: e.target.value })}
                        className={inputCls}
                        placeholder="可选，用于身份验证"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>心跳间隔（毫秒）</label>
                      <input
                        type="number"
                        value={config.heartbeatInterval}
                        onChange={e => setConfig({ ...config, heartbeatInterval: Number(e.target.value) })}
                        className={inputCls}
                        min={5000}
                        step={1000}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                  <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-blue-400" />
                    连接设置
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-white">WebSocket 反向连接</div>
                        <div className="text-xs text-slate-500 mt-0.5">允许 AstrBot 通过 WS 反向连接</div>
                      </div>
                      <button
                        onClick={() => setConfig({ ...config, wsEnabled: !config.wsEnabled })}
                        className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${config.wsEnabled ? 'text-emerald-400' : 'text-slate-600'}`}
                      >
                        {config.wsEnabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                      </button>
                    </div>
                    <div>
                      <label className={labelCls}>WebSocket 路径</label>
                      <input
                        type="text"
                        value={config.wsPath}
                        onChange={e => setConfig({ ...config, wsPath: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-white">HTTP API 接口</div>
                        <div className="text-xs text-slate-500 mt-0.5">允许通过 HTTP POST 发送消息</div>
                      </div>
                      <button
                        onClick={() => setConfig({ ...config, httpEnabled: !config.httpEnabled })}
                        className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${config.httpEnabled ? 'text-emerald-400' : 'text-slate-600'}`}
                      >
                        {config.httpEnabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-white">启用详细日志</div>
                        <div className="text-xs text-slate-500 mt-0.5">在控制台输出 OneBot 相关日志</div>
                      </div>
                      <button
                        onClick={() => setConfig({ ...config, enableLog: !config.enableLog })}
                        className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${config.enableLog ? 'text-emerald-400' : 'text-slate-600'}`}
                      >
                        {config.enableLog ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm flex items-center gap-2 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? '保存中...' : '保存配置'}
                  </button>
                </div>
              </div>
            )}

            {/* 自动回复 Tab */}
            {activeTab === 'auto-reply' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400">共 {autoReplies.length} 条规则</p>
                  <button
                    onClick={() => setShowAddRule(!showAddRule)}
                    className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> 添加规则
                  </button>
                </div>

                <AnimatePresence>
                  {showAddRule && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-violet-500/10 rounded-xl border border-violet-500/20 p-4 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className={labelCls}>关键词</label>
                            <input
                              type="text"
                              value={newKeyword}
                              onChange={e => setNewKeyword(e.target.value)}
                              placeholder="输入触发关键词"
                              className={inputCls}
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className={labelCls}>匹配方式</label>
                            <select
                              value={newMatchType}
                              onChange={e => setNewMatchType(e.target.value as any)}
                              className={inputCls + ' appearance-none'}
                            >
                              <option value="contains" className="bg-slate-800">包含</option>
                              <option value="exact" className="bg-slate-800">精确匹配</option>
                              <option value="regex" className="bg-slate-800">正则表达式</option>
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>生效范围</label>
                            <select
                              value={newScope}
                              onChange={e => setNewScope(e.target.value as any)}
                              className={inputCls + ' appearance-none'}
                            >
                              <option value="all" className="bg-slate-800">全部</option>
                              <option value="group" className="bg-slate-800">仅群聊</option>
                              <option value="private" className="bg-slate-800">仅私聊</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className={labelCls}>回复内容</label>
                          <textarea
                            value={newReply}
                            onChange={e => setNewReply(e.target.value)}
                            placeholder="输入自动回复的内容"
                            rows={3}
                            className={inputCls + ' resize-none'}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setShowAddRule(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">取消</button>
                          <button onClick={handleAddRule} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm transition-colors">添加</button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-2">
                  {autoReplies.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                      <Repeat className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p>暂无自动回复规则</p>
                    </div>
                  ) : autoReplies.map(rule => (
                    <motion.div
                      key={rule.id}
                      layout
                      className={`bg-white/5 rounded-xl border p-4 transition-colors ${
                        rule.isActive ? 'border-white/10' : 'border-white/5 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <Hash className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
                            <span className="text-white font-medium text-sm">{rule.keyword}</span>
                            <span className="px-1.5 py-0.5 rounded text-xs bg-white/10 text-slate-400">
                              {rule.matchType === 'exact' ? '精确' : rule.matchType === 'contains' ? '包含' : '正则'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-xs bg-white/10 text-slate-400">
                              {rule.scope === 'all' ? '全部' : rule.scope === 'group' ? '群聊' : '私聊'}
                            </span>
                          </div>
                          <p className="text-slate-400 text-xs leading-relaxed line-clamp-2 pl-5">{rule.reply}</p>
                          <div className="flex items-center gap-3 mt-2 pl-5">
                            <span className="text-xs text-slate-600">命中 {rule.hitCount} 次</span>
                            <span className="text-xs text-slate-600">{formatTime(rule.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleToggleRule(rule)}
                            className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${rule.isActive ? 'text-emerald-400' : 'text-slate-600'}`}
                          >
                            {rule.isActive ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="text-slate-600 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* AI 设置 Tab */}
            {activeTab === 'ai' && aiConfig && (
              <div className="space-y-4">
                <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-white flex items-center gap-2">
                      <Brain className="w-4 h-4 text-violet-400" />
                      AI 智能回复
                    </h3>
                    <button
                      onClick={() => setAiConfig({ ...aiConfig, enableAI: !aiConfig.enableAI })}
                      className={`min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${aiConfig.enableAI ? 'text-emerald-400' : 'text-slate-600'}`}
                    >
                      {aiConfig.enableAI ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                    </button>
                  </div>
                  {!aiConfig.enableAI && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-4">
                      <p className="text-amber-400 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        AI 智能回复当前已禁用。启用后，用户发送含有触发前缀的消息将由 AI 自动回复。
                      </p>
                    </div>
                  )}
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>AI 模型</label>
                        <select
                          value={aiConfig.model}
                          onChange={e => setAiConfig({ ...aiConfig, model: e.target.value })}
                          className={inputCls + ' appearance-none'}
                        >
                          <option value="gpt-4o-mini" className="bg-slate-800">GPT-4o Mini</option>
                          <option value="gpt-4o" className="bg-slate-800">GPT-4o</option>
                          <option value="gpt-4.1-mini" className="bg-slate-800">GPT-4.1 Mini</option>
                          <option value="gpt-4.1" className="bg-slate-800">GPT-4.1</option>
                          <option value="gemini-2.5-flash" className="bg-slate-800">Gemini 2.5 Flash</option>
                          <option value="claude-3-5-haiku" className="bg-slate-800">Claude 3.5 Haiku</option>
                          <option value="custom" className="bg-slate-800">自定义</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>触发前缀</label>
                        <input
                          type="text"
                          value={aiConfig.triggerPrefix}
                          onChange={e => setAiConfig({ ...aiConfig, triggerPrefix: e.target.value })}
                          className={inputCls}
                          placeholder="@AI"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>温度（创造力）{aiConfig.temperature}</label>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.1}
                          value={aiConfig.temperature}
                          onChange={e => setAiConfig({ ...aiConfig, temperature: Number(e.target.value) })}
                          className="w-full accent-violet-500"
                        />
                        <div className="flex justify-between text-xs text-slate-600 mt-1">
                          <span>严谨</span>
                          <span>平衡</span>
                          <span>创意</span>
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>最大 Token 数</label>
                        <input
                          type="number"
                          value={aiConfig.maxTokens}
                          onChange={e => setAiConfig({ ...aiConfig, maxTokens: Number(e.target.value) })}
                          className={inputCls}
                          min={128}
                          max={8192}
                          step={128}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>系统提示词（System Prompt）</label>
                      <textarea
                        value={aiConfig.systemPrompt}
                        onChange={e => setAiConfig({ ...aiConfig, systemPrompt: e.target.value })}
                        rows={5}
                        className={inputCls + ' resize-none leading-relaxed'}
                        placeholder="输入 AI 的系统提示词..."
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveAI}
                    disabled={saving}
                    className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm flex items-center gap-2 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? '保存中...' : '保存 AI 配置'}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

// ============ 腾讯位置服务 API 配置面板 ============

function AmapPanel() {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/txmap-config').then(r => {
      setKey(r.config?.key || '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api('/txmap-config', { method: 'PUT', body: JSON.stringify({ key }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-2xl">🗺️</span>
          腾讯位置服务 API 配置
        </h2>
        <p className="text-slate-400 text-sm mt-1">配置腾讯地图 JS API Key，用于实时位置共享功能。</p>
      </div>

      {/* 申请指引 */}
      <div className="bg-slate-800/60 rounded-xl p-4 mb-6 border border-slate-700/50">
        <h3 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 inline-block"></span>
          如何申请 API Key
        </h3>
        <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
          <li>访问 <a href="https://lbs.qq.com/" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">https://lbs.qq.com/</a> 登录腾讯位置服务控制台</li>
          <li>我的应用 → 创建应用 → 添加 Key</li>
          <li>服务选择：<strong className="text-white">WebServiceAPI</strong>（用于地图显示和定位）</li>
          <li>获得 <strong className="text-white">Key</strong> 并填入下方</li>
        </ol>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 py-8 justify-center">
          <RefreshCw size={16} className="animate-spin" />
          <span>加载中...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              API Key <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="请输入腾讯位置服务 API Key"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-teal-500 font-mono"
            />
            <p className="text-xs text-slate-500 mt-1">格式示例：OB4BZ-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX（20 位大写字母+数字）</p>
          </div>

          {/* Key 格式验证提示 */}
          {key && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
              /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key)
                ? 'bg-teal-900/30 text-teal-400 border border-teal-800'
                : 'bg-amber-900/30 text-amber-400 border border-amber-800'
            }`}>
              {/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key) ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key) ? 'Key 格式正确' : 'Key 格式应为 OB4BZ-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX'}
            </div>
          )}

          {/* 保存按鈕 */}
          <button
            onClick={handleSave}
            disabled={saving || !key}
            className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saving ? '保存中...' : saved ? '已保存！' : '保存配置'}
          </button>
        </div>
      )}

      {/* 安全提示 */}
      <div className="mt-6 bg-teal-900/20 border border-teal-800/40 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-teal-400 mb-2 flex items-center gap-1.5">
          <AlertTriangle size={14} />
          使用说明
        </h3>
        <ul className="text-xs text-teal-300/80 space-y-1 list-disc list-inside">
          <li>Key 存储在服务端数据库，不会暴露在前端代码中</li>
          <li>建议在腾讯位置服务控制台设置域名白名单，限制 Key 使用范围</li>
          <li>Key 每日免费额度为 10000 次，超出后地图将无法显示</li>
        </ul>
      </div>
    </div>
  );
}

// ============ 外链朋友圈管理面板 ============

// pyqApi 已合并到主 api 函数
// 外链朋友圈管理直接复用 api() 函数访问 /api/admin/*

type PyqTab = 'dashboard' | 'users' | 'posts' | 'media' | 'site-config' | 'cos' | 'login-logs' | 'ip-blacklist' | 'illegal-requests' | 'sync';

function PyqPanel() {
  const [activeTab, setActiveTab] = useState<PyqTab>('dashboard');

  const tabs: Array<{ id: PyqTab; label: string; icon: React.ElementType; color: string }> = [
    { id: 'dashboard', label: '仪表盘', icon: BarChart2, color: 'text-emerald-400' },
    { id: 'users', label: '用户管理', icon: UserCog, color: 'text-blue-400' },
    { id: 'posts', label: '动态管理', icon: Newspaper, color: 'text-amber-400' },
    { id: 'media', label: '媒体管理', icon: Image, color: 'text-pink-400' },
    { id: 'site-config', label: '站点设置', icon: SlidersHorizontal, color: 'text-purple-400' },
    { id: 'cos', label: '云存储配置', icon: CloudCog, color: 'text-cyan-400' },
    { id: 'login-logs', label: '登录日志', icon: ScrollText, color: 'text-slate-400' },
    { id: 'ip-blacklist', label: 'IP 黑名单', icon: ShieldOff, color: 'text-red-400' },
    { id: 'illegal-requests', label: '非法请求', icon: AlertOctagon, color: 'text-orange-400' },
    { id: 'sync', label: '同步配置', icon: Rss, color: 'text-violet-400' },
  ];

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard': return <PyqDashboardTab />;
      case 'users': return <PyqUsersTab />;
      case 'posts': return <PyqPostsTab />;
      case 'media': return <PyqMediaTab />;
      case 'site-config': return <PyqSiteConfigTab />;
      case 'cos': return <PyqCosTab />;
      case 'login-logs': return <PyqLoginLogsTab />;
      case 'ip-blacklist': return <PyqIpBlacklistTab />;
      case 'illegal-requests': return <PyqIllegalRequestsTab />;
      case 'sync': return <PyqSyncTab />;
      default: return <PyqDashboardTab />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
          <Rss className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">外链朋友圈管理</h2>
          <p className="text-sm text-slate-400">管理外链朋友圈用户、动态、媒体、自定义页面和系统配置</p>
        </div>
      </div>

      {/* Tab 导航 - 移动端优化横向滚动 */}
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="flex gap-1 bg-slate-800/50 rounded-xl p-1 min-w-max">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap active:scale-[0.97] ${
                activeTab === tab.id
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <tab.icon className={`w-3.5 h-3.5 flex-shrink-0 ${activeTab === tab.id ? tab.color : ''}`} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div>{renderTab()}</div>
    </div>
  );
}

// ---- 仪表盘 Tab ----
function PyqDashboardTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/dashboard').then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!data) return <div className="text-slate-400 text-center py-10">加载失败</div>;

  const { stats, recentUsers, recentMoments, recentLogins } = data;
  const recentPosts: any[] = recentMoments || [];

  const statCards = [
    { label: '总用户数', value: stats.totalUsers ?? 0, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: '封禁用户', value: stats.bannedUsers ?? 0, icon: Ban, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: '动态总数', value: stats.totalMoments ?? stats.totalPosts ?? 0, icon: Newspaper, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: '评论数量', value: stats.totalComments ?? 0, icon: Image, color: 'text-pink-400', bg: 'bg-pink-500/10' },
    { label: '媒体资源', value: stats.totalMedia ?? stats.totalImages ?? 0, icon: Video, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { label: '登录记录', value: stats.totalLoginLogs ?? 0, icon: ScrollText, color: 'text-slate-400', bg: 'bg-slate-500/10' },
    { label: 'IP 黑名单', value: stats.totalIpBlacklist ?? 0, icon: ShieldOff, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: '非法请求', value: stats.totalIllegalRequests ?? 0, icon: AlertOctagon, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map(s => (
          <div key={s.label} className="bg-slate-800/50 rounded-xl p-4 border border-white/5">
            <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon className={`w-4.5 h-4.5 ${s.color}`} />
            </div>
            <div className="text-2xl font-bold text-white">{s.value.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 最新用户 */}
        <div className="bg-slate-800/50 rounded-xl p-4 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">最新注册用户</h3>
          <div className="space-y-2">
            {recentUsers.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">{u.nickname || u.username}</p>
                  <p className="text-xs text-slate-400">{u.email}</p>
                </div>
                <div className="text-right">
                  {u.isBanned && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">封禁</span>}
                  <p className="text-xs text-slate-500">{new Date(u.createdAt).toLocaleDateString('zh-CN')}</p>
                </div>
              </div>
            ))}
            {recentUsers.length === 0 && <p className="text-xs text-slate-500 text-center py-4">暂无用户</p>}
          </div>
        </div>

        {/* 最新动态 */}
        <div className="bg-slate-800/50 rounded-xl p-4 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">最新动态</h3>
          <div className="space-y-2">
            {recentPosts.map((p: any) => (
              <div key={p.id} className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{p.nickname || p.username}</p>
                  <p className="text-xs text-slate-400 truncate">{p.content || (p.hasImages ? '[图片]' : '[视频]')}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-500">{new Date(p.createdAt).toLocaleDateString('zh-CN')}</p>
                  <p className="text-xs text-slate-500">❤{p.likesCount} 💬{p.commentsCount}</p>
                </div>
              </div>
            ))}
            {recentPosts.length === 0 && <p className="text-xs text-slate-500 text-center py-4">暂无动态</p>}
          </div>
        </div>

        {/* 最近登录 */}
        <div className="bg-slate-800/50 rounded-xl p-4 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-3">最近登录记录</h3>
          <div className="space-y-2">
            {recentLogins.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">{l.username || '未知用户'}</p>
                  <p className="text-xs text-slate-400">{l.ip || '-'}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${l.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {l.success ? '成功' : '失败'}
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">{new Date(l.createdAt).toLocaleDateString('zh-CN')}</p>
                </div>
              </div>
            ))}
            {recentLogins.length === 0 && <p className="text-xs text-slate-500 text-center py-4">暂无记录</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- 用户管理 Tab ----
function PyqUsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`);
      setUsers(d.users || []);
      setTotal(d.total || 0);
    } catch {}
    setLoading(false);
  }, [search, page]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const toggleBan = async (id: string, isBanned: boolean) => {
    if (!confirm(isBanned ? '确认解封该用户？' : '确认封禁该用户？')) return;
    await api(`/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ ban: !isBanned }) });
    fetchUsers();
  };

  const deleteUser = async (id: string) => {
    if (!confirm('确认删除该用户及其所有数据？此操作不可恢复！')) return;
    await api(`/users/${id}`, { method: 'DELETE' });
    fetchUsers();
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜索用户名/邮箱/昵称..."
            className="w-full bg-slate-800/50 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <span className="text-xs text-slate-400">共 {total} 名用户</span>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="bg-slate-800/50 rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/30 border-b border-white/5">
              <tr>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">用户</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">邮箱</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">动态数</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">状态</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">注册时间</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{u.nickname || u.username}</p>
                    <p className="text-xs text-slate-400">@{u.username}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-slate-300">{u.postsCount}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.isBanned ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {u.isBanned ? '已封禁' : '正常'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(u.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          const link = `${window.location.origin}/q/${u.id}`;
                          navigator.clipboard.writeText(link).then(() => alert(`外链已复制：${link}`));
                        }}
                        className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                        title={`复制外链: /q/${u.id}`}
                      >
                        复制外链
                      </button>
                      <button
                        onClick={() => toggleBan(u.id, u.isBanned)}
                        className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                          u.isBanned
                            ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                            : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                        }`}
                      >
                        {u.isBanned ? '解封' : '封禁'}
                      </button>
                      <button
                        onClick={() => deleteUser(u.id)}
                        className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <div className="text-center py-10 text-slate-400">暂无用户</div>}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                p === page ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 动态管理 Tab ----
function PyqPostsTab() {
  const [posts, setPosts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 20;

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/posts?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`);
      setPosts(d.posts || []);
      setTotal(d.total || 0);
    } catch {}
    setLoading(false);
  }, [search, page]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const togglePin = async (id: string) => {
    await api(`/posts/${id}/pin`, { method: 'POST' });
    fetchPosts();
  };

  const deletePost = async (id: string) => {
    if (!confirm('确认删除该动态？')) return;
    await api(`/posts/${id}`, { method: 'DELETE' });
    fetchPosts();
  };

  const batchDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`确认删除选中的 ${selected.size} 条动态？`)) return;
    await api('/moments', { method: 'DELETE', body: JSON.stringify({ ids: Array.from(selected) }) });
    setSelected(new Set());
    fetchPosts();
  };

  const toggleSelect = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜索动态内容/用户名..."
            className="w-full bg-slate-800/50 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        {selected.size > 0 && (
          <button
            onClick={batchDelete}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-500/20 text-red-400 rounded-xl text-sm hover:bg-red-500/30 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            批量删除 ({selected.size})
          </button>
        )}
        <span className="text-xs text-slate-400">共 {total} 条动态</span>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="bg-slate-800/50 rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/30 border-b border-white/5">
              <tr>
                <th className="px-4 py-3 w-8"></th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">用户</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">内容</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">互动</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">状态</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">时间</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {posts.map(p => (
                <tr key={p.id} className={`hover:bg-white/5 transition-colors ${selected.has(p.id) ? 'bg-white/5' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)}
                      className="w-4 h-4 rounded accent-emerald-500" />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white text-sm">{p.nickname || p.username}</p>
                    <p className="text-xs text-slate-400">@{p.username}</p>
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    <p className="text-slate-300 text-xs truncate">{p.content || (p.images?.length ? `[${p.images.length}张图片]` : '[视频]')}</p>
                    {p.location && <p className="text-xs text-slate-500">📍{p.location}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">❤{p.likesCount} 💬{p.commentsCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {p.isPinned && <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded w-fit">📌置顶</span>}
                      <span className={`text-xs px-1.5 py-0.5 rounded w-fit ${
                        p.visibility === 'public' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400'
                      }`}>{p.visibility === 'public' ? '公开' : '私密'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(p.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => togglePin(p.id)}
                        className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                          p.isPinned ? 'bg-slate-500/20 text-slate-400 hover:bg-slate-500/30' : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                        }`}
                      >{p.isPinned ? '取消置顶' : '置顶'}</button>
                      <button
                        onClick={() => deletePost(p.id)}
                        className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                      >删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {posts.length === 0 && <div className="text-center py-10 text-slate-400">暂无动态</div>}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                p === page ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 媒体管理 Tab ----
function PyqMediaTab() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalImages, setTotalImages] = useState(0);
  const [totalVideos, setTotalVideos] = useState(0);
  const [mediaType, setMediaType] = useState<'images' | 'videos'>('images');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 24;

  const fetchMedia = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/media?type=${mediaType}&page=${page}&pageSize=${pageSize}`);
      setItems(d.items || []);
      setTotal(d.total || 0);
      setTotalImages(d.totalImages || 0);
      setTotalVideos(d.totalVideos || 0);
    } catch {}
    setLoading(false);
  }, [mediaType, page]);

  useEffect(() => { fetchMedia(); }, [fetchMedia]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex bg-slate-800/50 rounded-xl p-1">
          <button
            onClick={() => { setMediaType('images'); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              mediaType === 'images' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Image className="w-4 h-4" />
            图片 ({totalImages})
          </button>
          <button
            onClick={() => { setMediaType('videos'); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              mediaType === 'videos' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Video className="w-4 h-4" />
            视频 ({totalVideos})
          </button>
        </div>
        <span className="text-xs text-slate-400">共 {total} 个{mediaType === 'images' ? '图片' : '视频'}</span>
      </div>

      {loading ? <LoadingSpinner /> : (
        items.length > 0 ? (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {items.map((item: any) => (
              <div key={item.id} className="bg-slate-800/50 rounded-xl overflow-hidden border border-white/5 group">
                {mediaType === 'images' ? (
                  <div className="aspect-square bg-slate-700/50 flex items-center justify-center overflow-hidden">
                    <img src={item.url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                ) : (
                  <div className="aspect-square bg-slate-700/50 flex items-center justify-center">
                    <Video className="w-8 h-8 text-slate-400" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-xs text-slate-400 truncate">{item.nickname || item.username}</p>
                  <p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</p>
                </div>
                <div className="px-2 pb-2">
                  <a href={item.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                    <ExternalLink className="w-3 h-3" />
                    查看原图
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-slate-400">暂无{mediaType === 'images' ? '图片' : '视频'}媒体</div>
        )
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                p === page ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 站点设置 Tab ----
function PyqSiteConfigTab() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api('/site-config').then(d => setConfig(d.config)).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api('/site-config', { method: 'PUT', body: JSON.stringify(config) });
      setMsg({ type: 'success', text: '保存成功' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '保存失败' });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  };

  if (!config) return <LoadingSpinner />;

  const field = (label: string, key: string, placeholder?: string, type = 'text') => (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
      <input
        type={type}
        value={config[key] || ''}
        onChange={e => setConfig({ ...config, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
      />
    </div>
  );

  const toggle = (label: string, desc: string, key: string) => (
    <div className="flex items-center justify-between py-3 border-b border-white/5">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
      </div>
      <button
        onClick={() => setConfig({ ...config, [key]: !config[key] })}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          config[key] ? 'bg-emerald-500' : 'bg-slate-600'
        }`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          config[key] ? 'translate-x-6' : 'translate-x-1'
        }`} />
      </button>
    </div>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5 space-y-4">
        <h3 className="text-sm font-semibold text-white">基本信息</h3>
        {field('站点名称', 'siteName', '朋友圈')}
        {field('站点描述', 'siteDesc', '分享你的生活点滴')}
        {field('站点关键词', 'siteKeywords', '朋友圈,社交,分享')}
        {field('站点 URL', 'siteUrl', 'https://pyq.example.com')}
        {field('Logo URL', 'logoUrl', 'https://example.com/logo.png')}
        {field('Favicon URL', 'faviconUrl', 'https://example.com/favicon.ico')}
      </div>

      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5 space-y-4">
        <h3 className="text-sm font-semibold text-white">备案信息</h3>
        {field('ICP 备案号', 'icpNumber', '例：粤ICP备XXXXXXXXX号')}
        {field('公安备案号', 'policeNumber', '例：粤公网安备 XXXXXXXXXXXXXX号')}
        {field('公安备案图标 URL', 'policeIconUrl', 'https://beian.mps.gov.cn/img/logo_img.d7b176d0.png')}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">版权信息</label>
          <textarea
            value={config.copyrightText || ''}
            onChange={e => setConfig({ ...config, copyrightText: e.target.value })}
            placeholder="Copyright © 2025 All Rights Reserved"
            rows={2}
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 resize-none"
          />
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-3">功能设置</h3>
        {toggle('允许注册', '开启后新用户可以自行注册账号', 'allowRegister')}
        {toggle('需要审核', '开启后新注册用户需管理员审核才能使用', 'requireApproval')}
        {toggle('视频自动播放', '开启后朋友圈页面视频将自动静音播放', 'autoPlayVideo')}
      </div>

      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-sm ${
          msg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        }`}>{msg.text}</div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
      >
        <Save className="w-4 h-4" />
        {saving ? '保存中...' : '保存设置'}
      </button>
    </div>
  );
}

// ---- 云存储配置 Tab ----
function PyqCosTab() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const REGIONS = [
    { value: 'ap-guangzhou', label: '广州' }, { value: 'ap-shanghai', label: '上海' },
    { value: 'ap-beijing', label: '北京' }, { value: 'ap-chengdu', label: '成都' },
    { value: 'ap-chongqing', label: '重庆' }, { value: 'ap-hongkong', label: '香港' },
    { value: 'ap-singapore', label: '新加坡' }, { value: 'na-ashburn', label: '弗吉尼亚' },
  ];

  useEffect(() => {
    api('/cos-config').then(d => setConfig(d.config)).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api('/cos-config', { method: 'PUT', body: JSON.stringify(config) });
      setMsg({ type: 'success', text: '保存成功' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '保存失败' });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const d = await api('/cos-config/test', { method: 'POST' });
      setMsg({ type: d.success ? 'success' : 'error', text: d.message || d.error || '测试完成' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '测试失败' });
    }
    setTesting(false);
    setTimeout(() => setMsg(null), 5000);
  };

  if (!config) return <LoadingSpinner />;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5 space-y-4">
        <h3 className="text-sm font-semibold text-white">腾讯云 COS 配置</h3>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">SecretId <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={config.secretId || ''}
            onChange={e => setConfig({ ...config, secretId: e.target.value })}
            placeholder="AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">SecretKey <span className="text-red-400">*</span></label>
          <div className="relative">
            <input
              type={showSecretKey ? 'text' : 'password'}
              value={config.secretKey || ''}
              onChange={e => setConfig({ ...config, secretKey: e.target.value })}
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 pr-10 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
            />
            <button
              type="button"
              onClick={() => setShowSecretKey(!showSecretKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              <Eye className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">存储桶名称 <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={config.bucket || ''}
            onChange={e => setConfig({ ...config, bucket: e.target.value })}
            placeholder="your-bucket-1234567890"
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
          <p className="text-xs text-slate-500 mt-1">格式：存储桶名称-APPID，例如 pyq-1234567890</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">存储地域 <span className="text-red-400">*</span></label>
          <select
            value={config.region || 'ap-guangzhou'}
            onChange={e => setConfig({ ...config, region: e.target.value })}
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
          >
            {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label} ({r.value})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">自定义域名（可选）</label>
          <input
            type="text"
            value={config.domain || ''}
            onChange={e => setConfig({ ...config, domain: e.target.value })}
            placeholder="https://cdn.yourdomain.com"
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
          <p className="text-xs text-slate-500 mt-1">填写后图片将通过此域名访问（CDN 加速），留空使用默认 COS 域名</p>
        </div>
      </div>

      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-sm ${
          msg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        }`}>{msg.text}</div>
      )}

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存配置'}
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="flex items-center gap-2 px-4 py-2.5 border border-white/10 text-slate-300 rounded-xl text-sm hover:bg-white/5 disabled:opacity-50 transition-colors"
        >
          <FlaskConical className="w-4 h-4" />
          {testing ? '测试中...' : '连接测试'}
        </button>
      </div>
    </div>
  );
}

// ---- 登录日志 Tab ----
function PyqLoginLogsTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/login-logs?page=${page}&pageSize=${pageSize}${filter ? `&success=${filter}` : ''}`);
      setLogs(d.logs || []);
      setTotal(d.total || 0);
    } catch {}
    setLoading(false);
  }, [page, filter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const clearLogs = async () => {
    if (!confirm('确认清空所有登录日志？')) return;
    await api('/login-logs', { method: 'DELETE' });
    fetchLogs();
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-slate-800/50 rounded-xl p-1">
          {[['', '全部'], ['true', '成功'], ['false', '失败']].map(([val, label]) => (
            <button key={val} onClick={() => { setFilter(val); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === val ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
              }`}>{label}</button>
          ))}
        </div>
        <span className="text-xs text-slate-400 flex-1">共 {total} 条记录</span>
        <button
          onClick={clearLogs}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 rounded-xl text-sm hover:bg-red-500/30 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          清空日志
        </button>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="bg-slate-800/50 rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/30 border-b border-white/5">
              <tr>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">用户</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">IP 地址</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">状态</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">失败原因</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">设备</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map(l => (
                <tr key={l.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white text-sm">{l.username || '-'}</p>
                    <p className="text-xs text-slate-400">{l.email || ''}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs">{l.ip || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      l.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>{l.success ? '✓ 成功' : '✗ 失败'}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{l.failReason || '-'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-[160px] truncate">{l.userAgent || '-'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <div className="text-center py-10 text-slate-400">暂无登录记录</div>}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                p === page ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- IP 黑名单 Tab ----
function PyqIpBlacklistTab() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchList = async () => {
    setLoading(true);
    try {
      const d = await api('/ip-blacklist');
      setList(d.list || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchList(); }, []);

  const add = async () => {
    if (!newIp.trim()) { setMsg({ type: 'error', text: '请输入 IP 地址' }); return; }
    setAdding(true);
    try {
      await api('/ip-blacklist', { method: 'POST', body: JSON.stringify({ ip: newIp.trim(), reason: newReason.trim() }) });
      setMsg({ type: 'success', text: '已添加到黑名单' });
      setNewIp(''); setNewReason('');
      fetchList();
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '添加失败' });
    }
    setAdding(false);
    setTimeout(() => setMsg(null), 3000);
  };

  const remove = async (id: string) => {
    if (!confirm('确认从黑名单中移除此 IP？')) return;
    await api(`/ip-blacklist/${id}`, { method: 'DELETE' });
    setMsg({ type: 'success', text: '已移除' });
    fetchList();
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-4">添加 IP 黑名单</h3>
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={newIp}
            onChange={e => setNewIp(e.target.value)}
            placeholder="输入 IP 地址，如 192.168.1.1"
            className="flex-1 min-w-[180px] bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
          <input
            type="text"
            value={newReason}
            onChange={e => setNewReason(e.target.value)}
            placeholder="封禁原因（可选）"
            className="flex-1 min-w-[140px] bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
          <button
            onClick={add}
            disabled={adding}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-500/80 text-white rounded-xl text-sm hover:bg-red-500 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {adding ? '添加中...' : '添加'}
          </button>
        </div>
        {msg && (
          <div className={`mt-3 px-3 py-2 rounded-lg text-sm ${
            msg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>{msg.text}</div>
        )}
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="bg-slate-800/50 rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/30 border-b border-white/5">
              <tr>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">IP 地址</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">封禁原因</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">添加时间</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map(item => (
                <tr key={item.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white font-mono">{item.ip}</td>
                  <td className="px-4 py-3 text-slate-400 text-sm">{item.reason || '-'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(item.createdAt).toLocaleString('zh-CN')}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => remove(item.id)}
                      className="text-xs px-2 py-1 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                    >移除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="text-center py-10 text-slate-400">黑名单为空</div>}
        </div>
      )}
    </div>
  );
}

// ---- 非法请求日志 Tab ----
function PyqIllegalRequestsTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/illegal-requests?page=${page}&pageSize=${pageSize}`);
      setLogs(d.logs || []);
      setTotal(d.total || 0);
    } catch {}
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const clearLogs = async () => {
    if (!confirm('确认清空所有非法请求日志？')) return;
    await api('/illegal-requests', { method: 'DELETE' });
    fetchLogs();
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">共 {total} 条异常请求记录</span>
        <button
          onClick={clearLogs}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 rounded-xl text-sm hover:bg-red-500/30 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          清空记录
        </button>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="bg-slate-800/50 rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/30 border-b border-white/5">
              <tr>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">IP 地址</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">请求路径</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">方法</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">状态码</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">原因</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map(l => (
                <tr key={l.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white font-mono text-xs">{l.ip || '-'}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs max-w-[160px] truncate">{l.path || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                      l.method === 'GET' ? 'bg-blue-500/20 text-blue-400' :
                      l.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>{l.method || '-'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {l.statusCode && (
                      <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                        l.statusCode >= 500 ? 'bg-red-500/20 text-red-400' :
                        l.statusCode >= 400 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-slate-500/20 text-slate-400'
                      }`}>{l.statusCode}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{l.reason || '-'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <div className="text-center py-10 text-slate-400">暂无非法请求记录</div>}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                p === page ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 同步配置 Tab ----
function PyqSyncTab() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api('/sync-config').then(d => setConfig(d.config)).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api('/sync-config', { method: 'PUT', body: JSON.stringify(config) });
      setMsg({ type: 'success', text: '保存成功' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '保存失败' });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const d = await api('/sync-config/test', { method: 'POST' });
      setMsg({ type: d.success ? 'success' : 'error', text: d.message || d.error || '测试完成' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '连接失败' });
    }
    setTesting(false);
    setTimeout(() => setMsg(null), 5000);
  };

  const toggle = (key: string) => setConfig({ ...config, [key]: !config[key] });

  if (!config) return <LoadingSpinner />;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* 同步统计 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-slate-800/50 rounded-xl p-4 border border-white/5 text-center">
          <div className="text-2xl font-bold text-emerald-400">{config.syncSuccessCount}</div>
          <div className="text-xs text-slate-400 mt-1">同步成功</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-white/5 text-center">
          <div className="text-2xl font-bold text-red-400">{config.syncFailCount}</div>
          <div className="text-xs text-slate-400 mt-1">同步失败</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-white/5 text-center">
          <div className="text-sm font-medium text-slate-300">{config.lastSyncAt ? new Date(config.lastSyncAt).toLocaleString('zh-CN') : '从未'}</div>
          <div className="text-xs text-slate-400 mt-1">最后同步</div>
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">pyq 同步配置</h3>
          <button
            onClick={() => toggle('enabled')}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors min-w-[48px] ${
              config.enabled ? 'bg-emerald-500' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              config.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">pyq 服务地址</label>
          <input
            type="text"
            value={config.pyqBaseUrl || ''}
            onChange={e => setConfig({ ...config, pyqBaseUrl: e.target.value })}
            placeholder="https://pyq.example.com"
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">API Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={config.pyqApiToken || ''}
              onChange={e => setConfig({ ...config, pyqApiToken: e.target.value })}
              placeholder="pyq 服务的 API Token"
              className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 pr-10 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
            />
            <button type="button" onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              <Eye className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">pyq 用户名（发布到哪个账号）</label>
          <input
            type="text"
            value={config.pyqUsername || ''}
            onChange={e => setConfig({ ...config, pyqUsername: e.target.value })}
            placeholder="pyq 平台的用户名"
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
        </div>

        <div className="space-y-2 pt-2 border-t border-white/5">
          {[
            { key: 'syncOnPublish', label: '发布时自动同步', desc: '在 cqim 发布朋友圈动态时自动同步到 pyq' },
            { key: 'syncImages', label: '同步图片', desc: '将动态中的图片一并同步到 pyq' },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm text-white">{item.label}</p>
                <p className="text-xs text-slate-400">{item.desc}</p>
              </div>
              <button
                onClick={() => toggle(item.key)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  config[item.key] ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  config[item.key] ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-sm ${
          msg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        }`}>{msg.text}</div>
      )}

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存配置'}
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="flex items-center gap-2 px-4 py-2.5 border border-white/10 text-slate-300 rounded-xl text-sm hover:bg-white/5 disabled:opacity-50 transition-colors"
        >
          <FlaskConical className="w-4 h-4" />
          {testing ? '测试中...' : '连接测试'}
        </button>
      </div>
    </div>
  );
}

// ============ 加载动画 ============

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );
}

// ============ 主布局 ============

// ============ 腾讯云 COS 云存储配置面板 ============

function CosConfigPanel() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [showSecretId, setShowSecretId] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [usage, setUsage] = useState<{ totalObjects: number; totalSize: number; isTruncated?: boolean } | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const REGIONS = [
    { value: 'ap-guangzhou', label: '广州' }, { value: 'ap-shanghai', label: '上海' },
    { value: 'ap-beijing', label: '北京' }, { value: 'ap-chengdu', label: '成都' },
    { value: 'ap-chongqing', label: '重庆' }, { value: 'ap-nanjing', label: '南京' },
    { value: 'ap-hongkong', label: '香港' }, { value: 'ap-singapore', label: '新加坡' },
    { value: 'ap-mumbai', label: '孟买' }, { value: 'ap-jakarta', label: '雅加达' },
    { value: 'ap-seoul', label: '首尔' }, { value: 'ap-bangkok', label: '曼谷' },
    { value: 'ap-tokyo', label: '东京' }, { value: 'na-ashburn', label: '弗吉尼亚' },
    { value: 'na-siliconvalley', label: '硅谷' }, { value: 'eu-frankfurt', label: '法兰克福' },
  ];

  useEffect(() => {
    api('/cos-config').then(d => setConfig(d.config || {})).catch(() => setConfig({}));
  }, []);

  const fetchUsage = async () => {
    setLoadingUsage(true);
    try {
      const d = await api('/cos-config/usage');
      if (d.success) setUsage({ totalObjects: d.totalObjects, totalSize: d.totalSize, isTruncated: d.isTruncated });
      else setUsage(null);
    } catch { setUsage(null); }
    setLoadingUsage(false);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api('/cos-config', { method: 'PUT', body: JSON.stringify(config) });
      setMsg({ type: 'success', text: '配置已保存' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '保存失败' });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const d = await api('/cos-config/test', { method: 'POST' });
      setMsg({ type: d.success ? 'success' : 'error', text: d.message || '测试完成' });
      if (d.success) fetchUsage();
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '测试失败' });
    }
    setTesting(false);
    setTimeout(() => setMsg(null), 10000);
  };

  const initDirs = async () => {
    setMsg(null);
    try {
      const d = await api('/cos-config/init-dirs', { method: 'POST' });
      setMsg({ type: d.success ? 'success' : 'error', text: d.message || '操作完成' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '初始化失败' });
    }
    setTimeout(() => setMsg(null), 6000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!config) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-cyan-500/20 rounded-xl flex items-center justify-center">
          <Database className="w-5 h-5 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">腾讯云 COS 对象存储</h2>
          <p className="text-sm text-slate-400">配置云存储密钥，用于图片、视频等媒体文件的云端存储与分发</p>
        </div>
      </div>

      {/* 启用开关 */}
      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Power className="w-5 h-5 text-cyan-400" />
            <div>
              <p className="text-sm font-medium text-white">启用 COS 云存储</p>
              <p className="text-xs text-slate-500">启用后，朋友圈照片/视频和用户头像将存储到腾讯云 COS 的 imimchat 目录下，聊天文件使用本地存储</p>
            </div>
          </div>
          <button
            onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              config.enabled ? 'bg-emerald-500' : 'bg-slate-600'
            }`}
          >
            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              config.enabled ? 'translate-x-6' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      </div>

      {/* 密钥配置 */}
      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">API 密钥配置</h3>
        </div>
        <p className="text-xs text-slate-500 -mt-2">前往 <a href="https://console.cloud.tencent.com/cam/capi" target="_blank" rel="noopener" className="text-cyan-400 hover:underline">腾讯云控制台 - API 密钥管理</a> 获取密钥</p>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">SecretId <span className="text-red-400">*</span></label>
          <div className="relative">
            <input
              type={showSecretId ? 'text' : 'password'}
              value={config.secretId || ''}
              onChange={e => setConfig({ ...config, secretId: e.target.value })}
              placeholder="AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 pr-10 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
            <button
              type="button"
              onClick={() => setShowSecretId(!showSecretId)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              {showSecretId ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">SecretKey <span className="text-red-400">*</span></label>
          <div className="relative">
            <input
              type={showSecretKey ? 'text' : 'password'}
              value={config.secretKey || ''}
              onChange={e => setConfig({ ...config, secretKey: e.target.value })}
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 pr-10 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
            <button
              type="button"
              onClick={() => setShowSecretKey(!showSecretKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              {showSecretKey ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* 存储桶配置 */}
      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5 space-y-4">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">存储桶配置</h3>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">存储桶名称 (Bucket) <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={config.bucket || ''}
            onChange={e => setConfig({ ...config, bucket: e.target.value })}
            placeholder="your-bucket-1234567890"
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
          <p className="text-xs text-slate-500 mt-1">格式：存储桶名称-APPID，例如 imimchat-1234567890</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">存储地域 (Region) <span className="text-red-400">*</span></label>
          <select
            value={config.region || 'ap-guangzhou'}
            onChange={e => setConfig({ ...config, region: e.target.value })}
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          >
            {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label} ({r.value})</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">自定义域名 / CDN 加速（可选）</label>
          <input
            type="text"
            value={config.domain || ''}
            onChange={e => setConfig({ ...config, domain: e.target.value })}
            placeholder="https://cdn.yourdomain.com"
            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
          <p className="text-xs text-slate-500 mt-1">填写后媒体文件将通过此域名访问（CDN 加速），留空使用默认 COS 域名</p>
        </div>
      </div>

      {/* 目录结构说明 */}
      <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5 space-y-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">存储目录结构</h3>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4 font-mono text-xs text-slate-400 space-y-1">
          <p className="text-slate-300 font-sans text-sm font-medium mb-2">文件存储结构预览：</p>
          <p><span className="text-orange-400">imimchat</span>/</p>
          <p className="pl-4">├── <span className="text-cyan-400">朋友圈</span>/</p>
          <p className="pl-8">├── <span className="text-blue-400">用户ID_A</span>/</p>
          <p className="pl-12">├── <span className="text-emerald-400">照片</span>/ <span className="text-slate-600">(朋友圈图片)</span></p>
          <p className="pl-12">└── <span className="text-amber-400">视频</span>/ <span className="text-slate-600">(朋友圈视频)</span></p>
          <p className="pl-8">└── <span className="text-blue-400">用户ID_B</span>/</p>
          <p className="pl-12">├── <span className="text-emerald-400">照片</span>/</p>
          <p className="pl-12">└── <span className="text-amber-400">视频</span>/</p>
          <p className="pl-4">└── <span className="text-pink-400">头像</span>/</p>
          <p className="pl-8">├── <span className="text-blue-400">用户ID_A</span>/ <span className="text-slate-600">(用户头像文件)</span></p>
          <p className="pl-8">└── <span className="text-blue-400">用户ID_B</span>/</p>
          <p className="mt-2 text-slate-500 font-sans">聊天文件使用本地存储，不走 COS</p>
        </div>
      </div>

      {/* 存储用量 */}
      {usage && (
        <div className="bg-slate-800/50 rounded-xl p-5 border border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">存储用量</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-900/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-cyan-400">{usage.totalObjects}</p>
              <p className="text-xs text-slate-500 mt-1">文件数量{usage.isTruncated ? ' (1000+)' : ''}</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-emerald-400">{formatBytes(usage.totalSize)}</p>
              <p className="text-xs text-slate-500 mt-1">占用空间{usage.isTruncated ? ' (仅前1000个)' : ''}</p>
            </div>
          </div>
        </div>
      )}

      {/* 提示信息 */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm flex items-start gap-2 ${
          msg.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          <span className="whitespace-pre-wrap">{msg.text}</span>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-cyan-500 text-white rounded-xl text-sm font-medium hover:bg-cyan-600 disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存配置'}
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="flex items-center gap-2 px-4 py-2.5 border border-white/10 text-slate-300 rounded-xl text-sm hover:bg-white/5 disabled:opacity-50 transition-colors"
        >
          <FlaskConical className="w-4 h-4" />
          {testing ? '测试中...' : '连接测试'}
        </button>
        <button
          onClick={fetchUsage}
          disabled={loadingUsage}
          className="flex items-center gap-2 px-4 py-2.5 border border-white/10 text-slate-300 rounded-xl text-sm hover:bg-white/5 disabled:opacity-50 transition-colors"
        >
          <BarChart3 className="w-4 h-4" />
          {loadingUsage ? '查询中...' : '查询用量'}
        </button>
        <button
          onClick={initDirs}
          className="flex items-center gap-2 px-4 py-2.5 border border-white/10 text-slate-300 rounded-xl text-sm hover:bg-white/5 transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          初始化目录
        </button>
      </div>

      {/* 帮助信息 */}
      <div className="bg-slate-800/30 rounded-xl p-4 border border-white/5">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-slate-500 space-y-1">
            <p>• 启用 COS 后，朋友圈照片/视频和用户头像将自动上传到云端 imimchat 目录下，聊天文件使用本地存储</p>
            <p>• 建议开启 CDN 加速并配置自定义域名，提升访问速度</p>
            <p>• 密钥建议使用子账号密钥，仅授予 COS 读写权限，避免主账号密钥泄露风险</p>
            <p>• COS 不可用时，系统会自动回退到本地存储，不影响正常使用</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ 阿里云配置面板 ============

function AdminDashboard({ admin, onLogout }: { admin: AdminInfo; onLogout: () => void }) {
  const [activeNav, setActiveNav] = useState<NavItem>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ★ 角色名统一：后端使用 superadmin，前端同步
  const navItems: Array<{ id: NavItem; label: string; icon: React.ElementType; color: string }> = [
    { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard, color: 'text-emerald-400' },
    { id: 'users', label: '用户管理', icon: Users, color: 'text-blue-400' },
    { id: 'reports', label: '举报管理', icon: FileWarning, color: 'text-amber-400' },
    { id: 'sensitive-words', label: '敏感词', icon: MessageSquareWarning, color: 'text-cyan-400' },
    { id: 'ip-blacklist', label: 'IP 黑名单', icon: Globe, color: 'text-red-400' },
    { id: 'announcements', label: '系统公告', icon: Megaphone, color: 'text-purple-400' },
    { id: 'logs', label: '操作日志', icon: ScrollText, color: 'text-slate-400' },
    { id: 'onebot', label: 'OneBot 配置', icon: Bot, color: 'text-violet-400' },
    { id: 'smtp', label: '邮箱配置', icon: Mail, color: 'text-sky-400' },
    { id: 'amap', label: '地图服务', icon: Globe, color: 'text-teal-400' },
    { id: 'pyq', label: '外链朋友圈', icon: Rss, color: 'text-emerald-400' },
    { id: 'cos', label: '云存储 COS', icon: Database, color: 'text-cyan-400' },
    { id: 'aliyun', label: '阿里云配置', icon: CloudCog, color: 'text-orange-400' },
    ...(admin.role === 'superadmin' ? [{ id: 'admins' as NavItem, label: '管理员', icon: Settings, color: 'text-slate-400' }] : []),
  ];

  const renderPanel = () => {
    switch (activeNav) {
      case 'dashboard': return <DashboardPanel />;
      case 'users': return <UsersPanel />;
      case 'reports': return <ReportsPanel />;
      case 'sensitive-words': return <SensitiveWordsPanel />;
      case 'ip-blacklist': return <IPBlacklistPanel />;
      case 'announcements': return <AnnouncementsPanel />;
      case 'logs': return <LogsPanel />;
      case 'onebot': return <OneBotPanel />;
      case 'smtp': return <SmtpPanel />;
      case 'amap': return <AmapPanel />;
      case 'pyq': return <PyqPanel />;
      case 'cos': return <CosConfigPanel />;
      case 'aliyun': return <React.Suspense fallback={<LoadingSpinner />}><AliyunPanel /></React.Suspense>;
      case 'admins': return <AdminsPanel />;
      default: return <DashboardPanel />;
    }
  };

  // ★ 角色映射统一为后端值
  const roleLabels: Record<string, string> = { superadmin: '超级管理员', admin: '管理员', moderator: '审核员' };

  // 移动端导航切换
  const handleNavClick = (id: NavItem) => {
    setActiveNav(id);
    setMobileMenuOpen(false);
  };

  // ★ 检测屏幕尺寸，自动切换布局
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 桌面端默认展开侧边栏
  useEffect(() => {
    if (!isMobile) setSidebarOpen(true);
    else setSidebarOpen(false);
  }, [isMobile]);

  return (
    <div className="h-screen bg-slate-900 flex flex-col md:flex-row overflow-hidden">
      {/* ===== 移动端顶部导航栏 ===== */}
      {isMobile && (
        <header className="bg-slate-800/80 backdrop-blur-lg border-b border-white/5 flex items-center justify-between px-4 py-3 flex-shrink-0 z-30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-white font-bold text-sm" style={{ fontFamily: 'var(--font-wenkai)' }}>imim Admin</div>
              <div className="text-xs text-slate-500">{roleLabels[admin.role] || admin.role}</div>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-all active:scale-95"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </header>
      )}

      {/* ===== 移动端下拉菜单 ===== */}
      <AnimatePresence>
        {isMobile && mobileMenuOpen && (
          <>
            {/* 遮罩层 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            {/* 菜单内容 */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="fixed top-[57px] left-0 right-0 z-50 bg-slate-800 border-b border-white/10 shadow-2xl max-h-[70vh] overflow-y-auto"
            >
              <nav className="p-3 space-y-1">
                {navItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all active:scale-[0.98] ${
                      activeNav === item.id
                        ? 'bg-white/10 text-white'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <item.icon className={`w-5 h-5 flex-shrink-0 ${activeNav === item.id ? item.color : ''}`} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </nav>
              <div className="p-3 border-t border-white/5">
                <button
                  onClick={onLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all active:scale-[0.98]"
                >
                  <LogOut className="w-5 h-5 flex-shrink-0" />
                  <span>退出登录</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ===== 桌面端侧边栏 ===== */}
      {!isMobile && (
        <motion.aside
          initial={false}
          animate={{ width: sidebarOpen ? 240 : 64 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="bg-slate-800/50 border-r border-white/5 flex flex-col flex-shrink-0 overflow-hidden h-full"
        >
          {/* Logo */}
          <div className="p-4 border-b border-white/5 flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            {sidebarOpen && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0">
                <div className="text-white font-bold text-sm" style={{ fontFamily: 'var(--font-wenkai)' }}>imim Admin</div>
                <div className="text-xs text-slate-500 truncate">{roleLabels[admin.role] || admin.role}</div>
              </motion.div>
            )}
          </div>

          {/* 导航列表 */}
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                title={!sidebarOpen ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                  activeNav === item.id
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className={`w-4.5 h-4.5 flex-shrink-0 ${activeNav === item.id ? item.color : ''}`} />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            ))}
          </nav>

          {/* 底部操作 */}
          <div className="p-2 border-t border-white/5 space-y-1">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-all"
            >
              <ChevronLeft className={`w-4.5 h-4.5 flex-shrink-0 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} />
              {sidebarOpen && <span>收起侧栏</span>}
            </button>
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all"
            >
              <LogOut className="w-4.5 h-4.5 flex-shrink-0" />
              {sidebarOpen && <span>退出登录</span>}
            </button>
          </div>
        </motion.aside>
      )}

      {/* ===== 主内容区 ===== */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4 md:p-6 max-w-6xl mx-auto pb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeNav}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {renderPanel()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ============ 管理后台主入口 ============

export default function AdminPage() {
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      api('/me')
        .then(setAdmin)
        .catch(() => localStorage.removeItem('admin_token'))
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  const handleLogout = async () => {
    try { await api('/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('admin_token');
    setAdmin(null);
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!admin) {
    return <AdminLoginPage onLogin={setAdmin} />;
  }

  return <AdminDashboard admin={admin} onLogout={handleLogout} />;
}
