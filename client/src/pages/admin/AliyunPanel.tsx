import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CloudCog, KeyRound, FileText, MessageSquare, FlaskConical, RefreshCw, Check,
  CheckCircle2, XCircle, SendHorizonal, Eye, EyeOff, Plus, Trash2, Save,
  ToggleLeft, ToggleRight, AlertTriangle, ShieldCheck,
} from 'lucide-react';

const API_BASE = '/api/admin';

async function api(path: string, options?: RequestInit) {
  const token = localStorage.getItem('admin_token');
  const csrfToken = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))?.split('=')[1] || '';
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    throw new Error('会话已过期，请重新登录');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function AliyunPanel() {
  type AliyunTab = 'config' | 'signatures' | 'templates' | 'test';
  const [activeTab, setActiveTab] = useState<AliyunTab>('config');

  // 配置状态
  type SmsTemplate = { name: string; code: string; content: string };
  type SmsSignName = { name: string; status: string };
  interface AliyunConfig {
    accessKeyId: string;
    accessKeySecret: string;
    smsSignName: string;
    smsSignNames: SmsSignName[];
    smsTemplates: Record<string, SmsTemplate>;
    smsEnabled: boolean;
    phoneAuthEnabled: boolean;
  }

  const defaultConfig: AliyunConfig = {
    accessKeyId: '', accessKeySecret: '', smsSignName: '',
    smsSignNames: [], smsTemplates: {},
    smsEnabled: false, phoneAuthEnabled: false,
  };

  const [config, setConfig] = useState<AliyunConfig>(defaultConfig);
  const [testHistory, setTestHistory] = useState<Array<{ id: string; phone: string; signName?: string; templateCode?: string; status: string; message: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // 测试状态
  const [testPhone, setTestPhone] = useState('');
  const [testSignName, setTestSignName] = useState('');
  const [testTemplateKey, setTestTemplateKey] = useState('login');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 新增签名
  const [newSignName, setNewSignName] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgData, histData] = await Promise.all([
        api('/aliyun-config'),
        api('/aliyun-sms-test-history'),
      ]);
      const c = { ...defaultConfig, ...cfgData.config };
      if (!c.smsSignNames) c.smsSignNames = [];
      if (!c.smsTemplates) c.smsTemplates = {};
      setConfig(c);
      setTestHistory(histData.history || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api('/aliyun-config', { method: 'PUT', body: JSON.stringify(config) });
      setSaveMsg('配置已保存');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim()) return;
    setTesting(true);
    setTestResult(null);
    const tpl = config.smsTemplates[testTemplateKey];
    try {
      const res = await api('/aliyun-sms-test', {
        method: 'POST',
        body: JSON.stringify({
          phone: testPhone,
          signName: testSignName || config.smsSignName,
          templateCode: tpl?.code || '',
        }),
      });
      setTestResult({ ok: true, message: res.message });
      fetchAll();
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message });
    } finally { setTesting(false); }
  };

  // 签名管理
  const addSignName = () => {
    if (!newSignName.trim()) return;
    const exists = config.smsSignNames.some(s => s.name === newSignName.trim());
    if (exists) return;
    setConfig({
      ...config,
      smsSignNames: [...config.smsSignNames, { name: newSignName.trim(), status: 'pending' }],
    });
    setNewSignName('');
  };

  const removeSignName = (name: string) => {
    setConfig({
      ...config,
      smsSignNames: config.smsSignNames.filter(s => s.name !== name),
      smsSignName: config.smsSignName === name ? '' : config.smsSignName,
    });
  };

  const selectActiveSign = (name: string) => {
    setConfig({ ...config, smsSignName: name });
  };

  // 模板管理
  const updateTemplate = (key: string, field: keyof SmsTemplate, value: string) => {
    setConfig({
      ...config,
      smsTemplates: {
        ...config.smsTemplates,
        [key]: { ...config.smsTemplates[key], [field]: value },
      },
    });
  };

  const inputCls = 'w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500/50 transition-colors';
  const labelCls = 'text-xs text-slate-400 mb-1.5 block';

  const tabs: Array<{ id: AliyunTab; label: string; icon: React.ElementType }> = [
    { id: 'config', label: 'AccessKey', icon: KeyRound },
    { id: 'signatures', label: '签名管理', icon: FileText },
    { id: 'templates', label: '模板配置', icon: MessageSquare },
    { id: 'test', label: '发送测试', icon: FlaskConical },
  ];

  const templateKeys: Array<{ key: string; label: string; desc: string; color: string }> = [
    { key: 'login', label: '登录/注册模板', desc: '用户登录或注册时发送验证码', color: 'text-emerald-400' },
    { key: 'changePhone', label: '修改绑定手机号', desc: '用户修改已绑定手机号时发送验证码', color: 'text-blue-400' },
    { key: 'reset', label: '重置密码模板', desc: '用户重置密码时发送验证码', color: 'text-amber-400' },
    { key: 'bind', label: '绑定新手机号', desc: '用户绑定新手机号时发送验证码', color: 'text-violet-400' },
    { key: 'verifyPhone', label: '验证绑定手机号', desc: '验证已绑定手机号时发送验证码', color: 'text-pink-400' },
  ];

  const statusLabels: Record<string, { label: string; cls: string }> = {
    approved: { label: '已通过', cls: 'bg-emerald-500/20 text-emerald-300' },
    pending: { label: '待审核', cls: 'bg-amber-500/20 text-amber-300' },
    rejected: { label: '已拒绝', cls: 'bg-red-500/20 text-red-300' },
  };

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <CloudCog className="w-5 h-5 text-orange-400" />
          阿里云配置
        </h2>
        <div className="flex items-center gap-2">
          {saveMsg && (
            <motion.span initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="text-emerald-400 text-sm flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> {saveMsg}
            </motion.span>
          )}
          <button onClick={fetchAll} className="p-2 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 状态卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          config.smsEnabled ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/10'
        }`}>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.smsEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-sm text-slate-300">短信服务</span>
          <span className={`text-xs ml-auto ${config.smsEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
            {config.smsEnabled ? '已启用' : '未启用'}
          </span>
        </div>
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          config.phoneAuthEnabled ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/10'
        }`}>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.phoneAuthEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-sm text-slate-300">号码认证</span>
          <span className={`text-xs ml-auto ${config.phoneAuthEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
            {config.phoneAuthEnabled ? '已启用' : '未启用'}
          </span>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="flex gap-1 bg-white/5 rounded-xl p-1 min-w-max">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap active:scale-[0.97] ${
                activeTab === tab.id ? 'bg-orange-500/20 text-orange-300' : 'text-slate-400 hover:text-white'
              }`}>
              <tab.icon className="w-3.5 h-3.5 flex-shrink-0" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ===== AccessKey 配置 Tab ===== */}
          {activeTab === 'config' && (
            <div className="space-y-4">
              <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-orange-400" /> AccessKey 配置
                </h3>
                <p className="text-xs text-slate-500">请前往阿里云控制台 RAM 访问控制创建 AccessKey，建议使用子账号并仅授权短信/号码认证服务权限</p>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className={labelCls}>AccessKey ID</label>
                    <input className={inputCls} value={config.accessKeyId} onChange={e => setConfig({ ...config, accessKeyId: e.target.value })} placeholder="LTAI5t..." />
                  </div>
                  <div>
                    <label className={labelCls}>AccessKey Secret</label>
                    <div className="relative">
                      <input className={inputCls} type={showSecret ? 'text' : 'password'} value={config.accessKeySecret} onChange={e => setConfig({ ...config, accessKeySecret: e.target.value })} placeholder="输入 AccessKey Secret" />
                      <button onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 服务开关 */}
              <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-4">
                <h3 className="text-sm font-semibold text-white">服务开关</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button onClick={() => setConfig({ ...config, smsEnabled: !config.smsEnabled })}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all active:scale-[0.98] ${
                      config.smsEnabled ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}>
                    {config.smsEnabled ? <ToggleRight className="w-5 h-5 text-emerald-400 flex-shrink-0" /> : <ToggleLeft className="w-5 h-5 text-slate-500 flex-shrink-0" />}
                    <div className="text-left">
                      <div className="text-sm text-white">短信服务</div>
                      <div className="text-xs text-slate-500">验证码发送</div>
                    </div>
                  </button>
                  <button onClick={() => setConfig({ ...config, phoneAuthEnabled: !config.phoneAuthEnabled })}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all active:scale-[0.98] ${
                      config.phoneAuthEnabled ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}>
                    {config.phoneAuthEnabled ? <ToggleRight className="w-5 h-5 text-emerald-400 flex-shrink-0" /> : <ToggleLeft className="w-5 h-5 text-slate-500 flex-shrink-0" />}
                    <div className="text-left">
                      <div className="text-sm text-white">号码认证</div>
                      <div className="text-xs text-slate-500">一键登录</div>
                    </div>
                  </button>
                </div>
              </div>

              <button onClick={handleSave} disabled={saving}
                className="w-full py-2.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-xl text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <div className="w-4 h-4 border-2 border-orange-300/30 border-t-orange-300 rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          )}

          {/* ===== 签名管理 Tab ===== */}
          {activeTab === 'signatures' && (
            <div className="space-y-4">
              {/* 当前使用的签名 */}
              <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <SendHorizonal className="w-4 h-4 text-sky-400" /> 当前使用签名
                </h3>
                {config.smsSignName ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-sky-500/10 border border-sky-500/20 rounded-lg">
                    <Check className="w-4 h-4 text-sky-400" />
                    <span className="text-sm text-white font-medium">{config.smsSignName}</span>
                  </div>
                ) : (
                  <p className="text-xs text-amber-400">未选择签名，请从下方列表中选择一个签名作为默认发送签名</p>
                )}
              </div>

              {/* 签名列表 */}
              <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">签名列表</h3>
                {config.smsSignNames.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">暂无签名，请添加签名配置</p>
                ) : (
                  <div className="space-y-2">
                    {config.smsSignNames.map((sign, idx) => {
                      const st = statusLabels[sign.status] || statusLabels.pending;
                      const isActive = config.smsSignName === sign.name;
                      return (
                        <div key={idx} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                          isActive ? 'bg-sky-500/10 border-sky-500/20' : 'bg-white/5 border-white/10'
                        }`}>
                          <span className="text-sm text-white flex-1">{sign.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                          {!isActive && sign.status === 'approved' && (
                            <button onClick={() => selectActiveSign(sign.name)} className="text-xs text-sky-400 hover:text-sky-300 transition-colors">
                              设为默认
                            </button>
                          )}
                          {isActive && <span className="text-xs text-sky-400 font-medium">使用中</span>}
                          <button onClick={() => removeSignName(sign.name)} className="text-slate-500 hover:text-red-400 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 添加签名 */}
                <div className="flex gap-2 pt-2 border-t border-white/5">
                  <input className={inputCls + ' flex-1'} value={newSignName} onChange={e => setNewSignName(e.target.value)} placeholder="输入新签名名称" onKeyDown={e => e.key === 'Enter' && addSignName()} />
                  <button onClick={addSignName} disabled={!newSignName.trim()}
                    className="px-4 py-2 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 rounded-xl text-sm font-medium transition-all disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap">
                    <Plus className="w-3.5 h-3.5" /> 添加
                  </button>
                </div>
              </div>

              <button onClick={handleSave} disabled={saving}
                className="w-full py-2.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-xl text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <div className="w-4 h-4 border-2 border-orange-300/30 border-t-orange-300 rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          )}

          {/* ===== 模板配置 Tab ===== */}
          {activeTab === 'templates' && (
            <div className="space-y-4">
              <div className="bg-slate-800/50 rounded-lg p-3">
                <p className="text-xs text-slate-400">模板变量说明：模板内容中支持 <code className="text-orange-300">{'${code}'}</code> 和 <code className="text-orange-300">{'${min}'}</code> 变量，系统会自动替换为验证码和有效时间。</p>
              </div>

              {templateKeys.map(tpl => {
                const t = config.smsTemplates[tpl.key] || { name: tpl.label, code: '', content: '' };
                return (
                  <div key={tpl.key} className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${tpl.color.replace('text-', 'bg-')}`} />
                      <h3 className="text-sm font-semibold text-white">{tpl.label}</h3>
                      <span className="text-xs text-slate-500 ml-auto">{tpl.desc}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>模板名称</label>
                        <input className={inputCls} value={t.name} onChange={e => updateTemplate(tpl.key, 'name', e.target.value)} placeholder={tpl.label} />
                      </div>
                      <div>
                        <label className={labelCls}>模板 CODE</label>
                        <input className={inputCls} value={t.code} onChange={e => updateTemplate(tpl.key, 'code', e.target.value)} placeholder="SMS_xxxx 或数字编号" />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>模板内容（仅作备注记录，实际内容以阿里云控制台为准）</label>
                      <textarea className={inputCls + ' min-h-[60px] resize-none'} value={t.content} onChange={e => updateTemplate(tpl.key, 'content', e.target.value)} placeholder="模板内容..." />
                    </div>
                    {t.code && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Code:</span>
                        <code className="text-xs text-orange-300 bg-orange-500/10 px-2 py-0.5 rounded">{t.code}</code>
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={handleSave} disabled={saving}
                className="w-full py-2.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-xl text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <div className="w-4 h-4 border-2 border-orange-300/30 border-t-orange-300 rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          )}

          {/* ===== 发送测试 Tab ===== */}
          {activeTab === 'test' && (
            <div className="space-y-4">
              <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">发送测试短信</h3>
                <p className="text-xs text-slate-500">向指定手机号发送测试验证码 888888，可选择签名和模板进行测试。</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>测试手机号</label>
                    <input className={inputCls} type="tel" value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="输入手机号" />
                  </div>
                  <div>
                    <label className={labelCls}>使用签名</label>
                    <select className={inputCls} value={testSignName} onChange={e => setTestSignName(e.target.value)}>
                      <option value="">默认签名{config.smsSignName ? ` (${config.smsSignName})` : ''}</option>
                      {config.smsSignNames.filter(s => s.status === 'approved').map(s => (
                        <option key={s.name} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>使用模板</label>
                  <div className="grid grid-cols-3 gap-2">
                    {templateKeys.map(tpl => {
                      const t = config.smsTemplates[tpl.key];
                      const isSelected = testTemplateKey === tpl.key;
                      return (
                        <button key={tpl.key} onClick={() => setTestTemplateKey(tpl.key)}
                          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-left ${
                            isSelected ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'bg-white/5 text-slate-400 border border-white/10 hover:border-white/20'
                          }`}>
                          <div>{tpl.label}</div>
                          {t?.code && <div className="text-[10px] mt-0.5 opacity-60">Code: {t.code}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button onClick={handleSendTest} disabled={testing || !testPhone.trim()}
                  className="w-full py-2.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-xl text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {testing ? <div className="w-4 h-4 border-2 border-orange-300/30 border-t-orange-300 rounded-full animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
                  {testing ? '发送中...' : '发送测试短信'}
                </button>

                {testResult && (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    testResult.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'
                  }`}>
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {testResult.message}
                  </div>
                )}
              </div>

              {/* 测试历史 */}
              {testHistory.length > 0 && (
                <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-white">测试历史</h3>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {testHistory.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg">
                        <div className="flex items-center gap-2 min-w-0">
                          {item.status === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                          <span className="text-sm text-white">{item.phone}</span>
                          {item.signName && <span className="text-xs text-slate-500 truncate">[{item.signName}]</span>}
                          {item.templateCode && <code className="text-[10px] text-orange-300/60">{item.templateCode}</code>}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className={`text-xs ${item.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{item.message}</span>
                          <span className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
