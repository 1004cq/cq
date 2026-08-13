/**
 * imim 加密信息弹窗
 * 展示真实 E2EE 加密状态、Safety Number、密钥指纹、会话信息、加密日志
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, ShieldCheck, X, Fingerprint, Key, RefreshCw,
  Lock, Unlock, Terminal, ChevronDown, ChevronUp,
  CheckCircle2, AlertCircle, Database, Hash, Clock, QrCode
} from 'lucide-react';
import QRCode from 'qrcode';
import type { SessionInfo } from '@/lib/e2ee';

interface EncryptionInfoProps {
  isOpen: boolean;
  onClose: () => void;
  peerId: string;
  peerName: string;
  e2eeHook?: {
    isReady: boolean;
    status: any;
    getSafetyNumber: (peerId: string) => Promise<string>;
    getLocalFingerprint: () => Promise<string>;
    getRemoteFingerprint: (peerId: string) => Promise<string>;
    getSessionInfo: (peerId: string) => Promise<SessionInfo | null>;
    resetSession: (peerId: string) => Promise<void>;
  };
  encryptionLog?: string[];
  sessionEstablished?: boolean;
}

export const EncryptionInfo: React.FC<EncryptionInfoProps> = ({
  isOpen, onClose, peerId, peerName, e2eeHook, encryptionLog = [], sessionEstablished = false,
}) => {
  const [safetyNumber, setSafetyNumber] = useState('');
  const [localFingerprint, setLocalFingerprint] = useState('');
  const [remoteFingerprint, setRemoteFingerprint] = useState('');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [verified, setVerified] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  // 生成安全码二维码
  const generateQR = useCallback(async (sn: string, lf: string, rf: string) => {
    if (!qrCanvasRef.current || !sn) return;
    const payload = JSON.stringify({
      type: 'imim-safety-number',
      v: 1,
      safetyNumber: sn.replace(/\s/g, ''),
      localKey: lf,
      remoteKey: rf,
      peerId,
      peerName,
      ts: Date.now(),
    });
    try {
      await QRCode.toCanvas(qrCanvasRef.current, payload, {
        width: 200,
        margin: 2,
        color: { dark: '#1a2e1a', light: '#f5f5f0' },
        errorCorrectionLevel: 'M',
      });
    } catch (e) {
      console.error('QR generation failed', e);
    }
  }, [peerId, peerName]);

  useEffect(() => {
    if (!isOpen || !e2eeHook?.isReady) return;

    async function loadInfo() {
      const sn = await e2eeHook!.getSafetyNumber(peerId);
      setSafetyNumber(sn);

      const lf = await e2eeHook!.getLocalFingerprint();
      setLocalFingerprint(lf);

      const rf = await e2eeHook!.getRemoteFingerprint(peerId);
      setRemoteFingerprint(rf);

      const si = await e2eeHook!.getSessionInfo(peerId);
      setSessionInfo(si);

      // 预生成二维码（等 canvas 挂载后）
      setTimeout(() => generateQR(sn, lf, rf), 100);
    }

    loadInfo();
  }, [isOpen, peerId, e2eeHook, generateQR]);

  // showQR 展开时重新渲染 canvas
  useEffect(() => {
    if (showQR && safetyNumber) {
      setTimeout(() => generateQR(safetyNumber, localFingerprint, remoteFingerprint), 50);
    }
  }, [showQR, safetyNumber, localFingerprint, remoteFingerprint, generateQR]);

  const handleResetSession = async () => {
    if (e2eeHook) {
      await e2eeHook.resetSession(peerId);
      const si = await e2eeHook.getSessionInfo(peerId);
      setSessionInfo(si);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="w-full max-w-sm bg-dove-paper dark:bg-[#171b21] text-dove-ink dark:text-slate-100 rounded-2xl shadow-xl overflow-hidden max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between p-4 pb-2 border-b border-border/30 dark:border-white/10">
              <div className="flex items-center gap-2">
                {sessionEstablished ? (
                  <ShieldCheck size={20} className="text-dove-green" />
                ) : (
                  <Shield size={20} className="text-dove-green" />
                )}
                <div>
                  <h3 className="text-sm font-medium text-dove-ink dark:text-slate-100" style={{ fontFamily: 'var(--font-wenkai)' }}>
                    Signal Protocol 加密
                  </h3>
                  <p className="text-[10px] text-muted-foreground dark:text-slate-400">
                    {sessionEstablished ? '会话已建立 · 端到端加密' : '密钥就绪 · 等待首次通信'}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="w-7 h-7 rounded-full bg-dove-warm-gray dark:bg-white/8 flex items-center justify-center hover:bg-dove-warm-gray/80 dark:hover:bg-white/12">
                <X size={14} className="text-muted-foreground dark:text-slate-300" />
              </button>
            </div>

            {/* 可滚动内容 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 加密说明 */}
              <div className="bg-dove-green/5 dark:bg-emerald-500/10 rounded-xl p-3 border border-dove-green/10 dark:border-emerald-400/20">
                <p className="text-xs text-dove-ink/80 dark:text-slate-200 leading-relaxed">
                  你与 <span className="text-dove-green font-medium">{peerName}</span> 的消息使用
                  <span className="font-medium"> Signal Protocol </span>
                  端到端加密。消息在你的设备上加密，只有你们双方可以解读，服务器无法访问明文内容。
                </p>
              </div>

              {/* Safety Number */}
              <div className="bg-dove-mist dark:bg-[#1d232c] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Fingerprint size={14} className="text-dove-bamboo" />
                    <span className="text-xs font-medium text-dove-ink dark:text-slate-100">安全码 (Safety Number)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 二维码展开按钮 */}
                    <button
                      onClick={() => setShowQR(v => !v)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] transition-colors ${
                        showQR
                          ? 'bg-dove-green/20 text-dove-green'
                          : 'bg-dove-warm-gray dark:bg-white/8 text-muted-foreground dark:text-slate-300 hover:bg-dove-warm-gray/80 dark:hover:bg-white/12'
                      }`}
                    >
                      <QrCode size={11} />
                      <span>二维码</span>
                    </button>
                    {verified ? (
                      <span className="flex items-center gap-1 text-[10px] text-dove-green">
                        <CheckCircle2 size={10} /> 已验证
                      </span>
                    ) : (
                      <button
                        onClick={() => setVerified(true)}
                        className="text-[10px] text-dove-bamboo dark:text-emerald-300 hover:underline"
                      >
                        标记已验证
                      </button>
                    )}
                  </div>
                </div>

                {/* 数字安全码 */}
                <div className="text-center py-3">
                  {safetyNumber ? (
                    <span className="text-[9px] tracking-[0.12em] text-dove-ink dark:text-slate-100 font-mono leading-loose break-all">
                      {safetyNumber}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground dark:text-slate-400">等待会话建立...</span>
                  )}
                </div>

                {/* QR 二维码区域（可展开） */}
                <AnimatePresence>
                  {showQR && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col items-center gap-2 pt-2 pb-1 border-t border-border/20 dark:border-white/10">
                        {/* Canvas 二维码 */}
                        <div className="bg-white rounded-xl p-2 border-2 border-dove-green shadow-[0_0_0_4px_rgba(76,175,80,0.15)]">
                          <canvas
                            ref={qrCanvasRef}
                            className="block rounded-lg"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        </div>
                        {/* 说明文字 */}
                        <div className="text-center space-y-1">
                          <p className="text-[10px] font-medium text-dove-ink dark:text-slate-100">
                            让 {peerName} 扫描此二维码
                          </p>
                          <p className="text-[9px] text-muted-foreground dark:text-slate-400 leading-relaxed">
                            二维码包含安全码 + 双方公钥指纹<br />
                            扫描后比对一致即可确认无中间人攻击
                          </p>
                        </div>
                        {/* 原理说明 */}
                        <div className="w-full bg-dove-green/5 dark:bg-emerald-500/10 rounded-lg px-3 py-2 border border-dove-green/10 dark:border-emerald-400/20">
                          <p className="text-[9px] text-dove-green/80 dark:text-emerald-200 leading-relaxed">
                            <span className="font-medium">原理：</span>基于 Double Ratchet 协议，二维码包含公钥/身份信息，用于安全密钥交换。双方扫描或比对确认匹配，即可验证无中间人攻击。
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <p className="text-[10px] text-muted-foreground dark:text-slate-400 text-center mt-1">
                  520 位安全码（分 52 组 × 10 位）· 与对方当面核对，确认通讯未被中间人攻击
                </p>
              </div>

              {/* 密钥指纹 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Key size={12} className="text-dove-bamboo" />
                  <span className="text-xs font-medium text-dove-ink dark:text-slate-100">密钥指纹</span>
                </div>

                <div className="bg-dove-warm-gray/50 dark:bg-white/6 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground dark:text-slate-400">你的 Identity Key</span>
                    <span className="text-[10px] font-mono text-dove-ink dark:text-slate-100">
                      {localFingerprint || '加载中...'}
                    </span>
                  </div>
                  <div className="border-t border-border/30 dark:border-white/10" />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">{peerName} 的 Identity Key</span>
                    <span className="text-[10px] font-mono text-dove-ink dark:text-slate-100">
                      {remoteFingerprint || '加载中...'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 会话状态 */}
              {sessionInfo && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Database size={12} className="text-dove-bamboo" />
                    <span className="text-xs font-medium text-dove-ink">会话状态</span>
                  </div>

                  <div className="bg-dove-warm-gray/50 dark:bg-white/6 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground dark:text-slate-400">会话状态</span>
                      <span className={`text-[10px] font-medium ${sessionInfo.established ? 'text-dove-green' : 'text-yellow-500'}`}>
                        {sessionInfo.established ? '已建立' : '未建立'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground dark:text-slate-400">已发送加密消息</span>
                      <span className="text-[10px] text-dove-ink">{sessionInfo.messagesSent}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground dark:text-slate-400">已接收加密消息</span>
                      <span className="text-[10px] text-dove-ink">{sessionInfo.messagesReceived}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground dark:text-slate-400">最后更新</span>
                      <span className="text-[10px] text-dove-ink">
                        {new Date(sessionInfo.lastUpdated).toLocaleString('zh-CN', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 技术详情 */}
              <div>
                <button
                  onClick={() => setShowTechnical(!showTechnical)}
                  className="flex items-center gap-2 w-full py-1"
                >
                  <Hash size={12} className="text-dove-bamboo" />
                  <span className="text-xs font-medium text-dove-ink dark:text-slate-100">协议技术详情</span>
                  {showTechnical ? <ChevronUp size={12} className="ml-auto text-muted-foreground" /> : <ChevronDown size={12} className="ml-auto text-muted-foreground" />}
                </button>

                <AnimatePresence>
                  {showTechnical && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1.5 pt-2">
                        {[
                          { label: '协议', value: 'Signal Protocol' },
                          { label: '密钥交换', value: 'X3DH (Extended Triple DH)' },
                          { label: '消息加密', value: 'Double Ratchet Algorithm' },
                          { label: 'ECDH 曲线', value: 'NIST P-256 (secp256r1)' },
                          { label: '对称加密', value: 'AES-256-GCM' },
                          { label: '密钥派生', value: 'HKDF-SHA256' },
                          { label: '哈希函数', value: 'SHA-256' },
                          { label: '前向安全', value: '✓ Perfect Forward Secrecy' },
                          { label: '后泄露安全', value: '✓ Post-Compromise Security' },
                          { label: '密钥存储', value: 'IndexedDB (本地)' },
                          { label: 'Registration ID', value: e2eeHook?.status?.registrationId?.toString() || '-' },
                          { label: 'PreKey 剩余', value: e2eeHook?.status?.totalPreKeys?.toString() || '-' },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between px-3 py-1.5 bg-dove-warm-gray/30 dark:bg-white/6 rounded-lg">
                            <span className="text-[10px] text-muted-foreground dark:text-slate-400">{label}</span>
                            <span className="text-[10px] text-dove-ink dark:text-slate-100 font-mono">{value}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 加密日志 */}
              {encryptionLog.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowLog(!showLog)}
                    className="flex items-center gap-2 w-full py-1"
                  >
                    <Terminal size={12} className="text-dove-bamboo" />
                    <span className="text-xs font-medium text-dove-ink dark:text-slate-100">加密日志</span>
                    <span className="text-[10px] text-muted-foreground dark:text-slate-400 ml-1">({encryptionLog.length})</span>
                    {showLog ? <ChevronUp size={12} className="ml-auto text-muted-foreground" /> : <ChevronDown size={12} className="ml-auto text-muted-foreground" />}
                  </button>

                  <AnimatePresence>
                    {showLog && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="bg-dove-ink/95 rounded-xl p-3 mt-1 max-h-[200px] overflow-y-auto">
                          {encryptionLog.map((log, i) => (
                            <div key={i} className="text-[10px] font-mono text-green-400/80 leading-relaxed">
                              {log}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="space-y-2 pt-1">
                <button
                  onClick={handleResetSession}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-dove-warm-gray/50 dark:bg-white/6 rounded-xl text-xs text-muted-foreground dark:text-slate-300 hover:bg-dove-warm-gray dark:hover:bg-white/10 transition-colors"
                >
                  <RefreshCw size={12} />
                  重置加密会话
                </button>
              </div>
            </div>

            {/* 底部装饰 */}
            <div className="flex items-center justify-center gap-2 py-3 border-t border-border/20 dark:border-white/10">
              <Lock size={10} className="text-dove-green/40" />
              <span className="text-[9px] text-muted-foreground/50 dark:text-slate-500">imim · Signal Protocol · E2EE</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
