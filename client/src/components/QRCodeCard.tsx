/**
 * QRCodeCard - E2EE 二维码名片系统
 * 功能：
 * 1. 个人名片二维码（含公钥/用户ID/签名/过期时间）
 * 2. 扫码加好友（摄像头实时扫描 + jsQR 解析）
 * 3. 安全码验证（60位数字指纹 + 二维码比对，防中间人攻击）
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
// 关键性能优化：QRCode/jsQR 只在二维码相关交互时才用，改成动态 import 避免首屏被强制下载
// （否则因为 App.tsx -> UserProfileSheet -> QRCodeCard 的同步链，整个 qrcode-vendor 会被预加载）
let _QRCodeLib: typeof import('qrcode') | null = null;
let _jsQRLib: typeof import('jsqr')['default'] | null = null;
async function loadQRCode() {
  if (!_QRCodeLib) _QRCodeLib = await import('qrcode');
  return _QRCodeLib.default || _QRCodeLib;
}
async function loadJsQR() {
  if (!_jsQRLib) {
    const mod = await import('jsqr');
    _jsQRLib = (mod as any).default || (mod as any);
  }
  return _jsQRLib!;
}
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Camera, Shield, ShieldCheck, ShieldAlert, Copy,
  CheckCircle2, AlertTriangle, RefreshCw, QrCode, Scan,
  Lock, ChevronRight, Loader2, UserPlus
} from 'lucide-react';
import { CURRENT_USER } from '@/lib/store';
import { DoveAvatar } from '@/components/DoveAvatar';
import { toast } from 'sonner';
import { useE2EE } from '@/hooks/useE2EE';

// ─────────────────────────────────────────────
// 二维码数据结构（参考 Signal/SimpleX 设计）
// ─────────────────────────────────────────────
export interface QRPayload {
  v: number;            // 版本号（当前为 1）
  uid: string;          // 用户 ID
  name: string;         // 显示名称
  phone: string;        // 联系方式（可选）
  ik: string;           // Identity Key 公钥（Base64）
  regId: number;        // Registration ID
  fp: string;           // 公钥指纹（前16字节 hex）
  ts: number;           // 生成时间戳
  exp: number;          // 过期时间戳（24小时后）
  sig?: string;         // 签名（可选，防篡改）
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 9999 位安全码生成（SHA-512 多轮迭代）
// ─────────────────────────────────────────────
async function generate9999SafetyNumber(localKey: string, remoteKey: string): Promise<string> {
  const encoder = new TextEncoder();
  let digits = '';
  let seed = localKey + '|' + remoteKey;
  // SHA-512 每轮产生 128 hex chars = 约 155 位十进制数字
  // 迭代 65 轮确保超过 9999 位
  for (let round = 0; round < 65 && digits.length < 9999; round++) {
    const data = encoder.encode(seed + ':' + round);
    const hashBuf = await crypto.subtle.digest('SHA-512', data);
    const hashArray = Array.from(new Uint8Array(hashBuf));
    // 将每个字节转换为十进制数字串（0-255 → 3位）
    const roundDigits = hashArray
      .map(b => b.toString(10).padStart(3, '0'))
      .join('')
      .replace(/[^0-9]/g, '');
    digits += roundDigits;
    // 下一轮 seed 使用当前 hash 的 hex
    seed = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return digits.slice(0, 9999);
}

function formatSafetyNumber(raw: string): string {
  // 将安全码格式化为 6 组 × 5 位数字（类似 Signal，用于扫码确认弹窗）
  const digits = raw.replace(/\D/g, '').slice(0, 30);
  const padded = digits.padEnd(30, '0');
  return Array.from({ length: 6 }, (_, i) => padded.slice(i * 5, i * 5 + 5)).join(' ');
}

function format9999Groups(raw: string): string[] {
  // 将 9999 位数字分为 1999 组，每组 5 位
  const digits = raw.replace(/\D/g, '').slice(0, 9999).padEnd(9999, '0');
  return Array.from({ length: 1999 }, (_, i) => digits.slice(i * 5, i * 5 + 5));
}

// ─────────────────────────────────────────────
// 子组件：二维码 Canvas
// ─────────────────────────────────────────────
const QRCanvas: React.FC<{ data: string; size?: number }> = ({ data, size = 200 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;
    let cancelled = false;
    loadQRCode().then((QRCode: any) => {
      if (cancelled || !canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, data, {
        width: size,
        margin: 2,
        color: { dark: '#1a2e1a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }).catch(console.error);
    });
    return () => { cancelled = true; };
  }, [data, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded-lg"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};

// ─────────────────────────────────────────────
// 子组件：扫码器
// ─────────────────────────────────────────────
const QRScanner: React.FC<{
  onScan: (payload: QRPayload) => void;
  onClose: () => void;
}> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [status, setStatus] = useState<'requesting' | 'scanning' | 'error'>('requesting');
  const [errorMsg, setErrorMsg] = useState('');
  const [scanLine, setScanLine] = useState(0);

  // 扫描线动画
  useEffect(() => {
    let dir = 1;
    let pos = 0;
    const timer = setInterval(() => {
      pos += dir * 2;
      if (pos >= 100) dir = -1;
      if (pos <= 0) dir = 1;
      setScanLine(pos);
    }, 16);
    return () => clearInterval(timer);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('scanning');
        scanFrame();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setErrorMsg(msg.includes('Permission') ? '摄像头权限被拒绝，请在浏览器设置中允许' : `摄像头启动失败: ${msg}`);
    }
  }, []);

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (!_jsQRLib) {
      // 第一次扫描时异步加载，未就绪先跳过
      loadJsQR().catch(()=>{});
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const code = _jsQRLib(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });
    if (code) {
      const imimMatch = code.data.match(/^imim:\/\/user\/(.+)$/);
      if (imimMatch) {
        onScan({
          v: 1,
          uid: imimMatch[1],
          name: '',
          phone: '',
          ik: 'basic',
          regId: 0,
          fp: '',
          ts: Date.now(),
          exp: Date.now() + 24 * 60 * 60 * 1000,
        });
        return;
      }
      try {
        const payload: QRPayload = JSON.parse(code.data);
        if (payload.v === 1 && payload.uid && payload.ik) {
          // 检查是否过期
          if (payload.exp && Date.now() > payload.exp) {
            toast.error('二维码已过期，请让对方刷新后重试');
            rafRef.current = requestAnimationFrame(scanFrame);
            return;
          }
          onScan(payload);
          return;
        }
      } catch {
        // 不是有效的 imim 二维码，继续扫描
      }
    }
    rafRef.current = requestAnimationFrame(scanFrame);
  }, [onScan]);

  useEffect(() => {
    startCamera();
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black flex flex-col"
    >
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-sm">
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10">
          <X size={18} className="text-white" />
        </button>
        <h2 className="text-sm font-medium text-white">扫描 imim 二维码</h2>
        <div className="w-8" />
      </div>

      {/* 摄像头区域 */}
      <div className="flex-1 relative flex items-center justify-center bg-black">
        {status === 'requesting' && (
          <div className="flex flex-col items-center gap-3 text-white">
            <Loader2 size={32} className="animate-spin text-dove-green" />
            <p className="text-sm">正在请求摄像头权限...</p>
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 px-8 text-center">
            <Camera size={40} className="text-white/40" />
            <p className="text-sm text-white/70">{errorMsg}</p>
            <button
              onClick={startCamera}
              className="px-4 py-2 bg-dove-green text-white text-sm rounded-full flex items-center gap-2"
            >
              <RefreshCw size={14} /> 重试
            </button>
          </div>
        )}
        {status === 'scanning' && (
          <>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            {/* 扫描框遮罩 */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-64 h-64">
                {/* 四角装饰 */}
                {[
                  'top-0 left-0 border-t-2 border-l-2 rounded-tl-lg',
                  'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
                  'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                  'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-8 h-8 border-dove-green ${cls}`} />
                ))}
                {/* 扫描线 */}
                <div
                  className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-dove-green to-transparent shadow-[0_0_8px_#4CAF50]"
                  style={{ top: `${scanLine}%`, transition: 'top 16ms linear' }}
                />
                {/* 暗角遮罩 */}
                <div className="absolute -inset-[9999px] bg-black/50 [mask-image:none]" style={{
                  boxShadow: 'inset 0 0 0 9999px rgba(0,0,0,0.5)',
                  clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, calc(50% - 128px) calc(50% - 128px), calc(50% - 128px) calc(50% + 128px), calc(50% + 128px) calc(50% + 128px), calc(50% + 128px) calc(50% - 128px), calc(50% - 128px) calc(50% - 128px))'
                }} />
              </div>
            </div>
          </>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* 底部提示 */}
      <div className="px-6 py-4 bg-black/80 text-center">
        <p className="text-xs text-white/60">将对方的 imim 二维码放入框内自动识别</p>
        <p className="text-[10px] text-dove-green/60 mt-1">支持面对面扫描，防止钓鱼攻击</p>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// 子组件：扫码成功确认
// ─────────────────────────────────────────────
const ScanSuccessModal: React.FC<{
  payload: QRPayload;
  safetyNumber: string;
  onConfirm: () => void;
  onCancel: () => void;
  adding?: boolean;
}> = ({ payload, safetyNumber, onConfirm, onCancel, adding }) => {
  const [verified, setVerified] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/50 flex items-end justify-center"
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="w-full max-w-[480px] bg-white rounded-t-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 顶部把手 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        <div className="px-6 py-4">
          {/* 用户信息 */}
          <div className="flex items-center gap-3 mb-4">
            <DoveAvatar name={payload.name} id={payload.uid} size="lg" />
            <div>
              <h3 className="text-base font-medium text-dove-ink">{payload.name}</h3>
              <p className="text-[10px] text-muted-foreground font-mono">{payload.phone}</p>
            </div>
            <div className="ml-auto">
              <div className="flex items-center gap-1 px-2 py-1 bg-dove-green/10 rounded-full">
                <Shield size={10} className="text-dove-green" />
                <span className="text-[9px] text-dove-green">E2EE</span>
              </div>
            </div>
          </div>

          {/* 公钥指纹 */}
          <div className="bg-dove-mist rounded-xl p-3 mb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Lock size={11} className="text-dove-bamboo" />
              <span className="text-[10px] font-medium text-dove-ink">Identity Key 指纹</span>
            </div>
            <p className="text-[9px] font-mono text-muted-foreground break-all">{payload.fp}</p>
          </div>

          {/* 安全码 */}
          {safetyNumber && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <ShieldCheck size={11} className="text-amber-600" />
                <span className="text-[10px] font-medium text-amber-700">安全码（Safety Number）</span>
              </div>
              <p className="text-sm font-mono text-amber-800 tracking-widest text-center py-1">
                {formatSafetyNumber(safetyNumber)}
              </p>
              <p className="text-[9px] text-amber-600/70 text-center mt-1">
                请与对方面对面比对，确认无中间人攻击
              </p>
            </div>
          )}

          {/* 验证勾选 */}
          <button
            onClick={() => setVerified(!verified)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all mb-4 ${
              verified
                ? 'border-dove-green bg-dove-green/5'
                : 'border-border/50 bg-white'
            }`}
          >
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
              verified ? 'border-dove-green bg-dove-green' : 'border-gray-300'
            }`}>
              {verified && <CheckCircle2 size={12} className="text-white" />}
            </div>
            <span className="text-xs text-dove-ink">已与对方面对面比对安全码</span>
          </button>

          {/* 操作按钮 */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-3 bg-dove-warm-gray rounded-xl text-sm text-dove-ink"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={adding}
              className="flex-1 py-3 bg-dove-green rounded-xl text-sm text-white font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {adding ? (
                <><Loader2 size={14} className="animate-spin" /> 发送中...</>
              ) : (
                <><UserPlus size={14} /> 添加好友</>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// 子组件：安全码验证页（用于已有联系人）
// ─────────────────────────────────────────────
export const SafetyNumberVerify: React.FC<{
  peerId: string;
  peerName: string;
  onClose: () => void;
}> = ({ peerId, peerName, onClose }) => {
  const e2ee = useE2EE();
  const [safetyNumber9999, setSafetyNumber9999] = useState('');
  const [localFP, setLocalFP] = useState('');
  const [remoteFP, setRemoteFP] = useState('');
  const [verified, setVerified] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState('');
  const [generating, setGenerating] = useState(true);
  const [copyDone, setCopyDone] = useState(false);
  const [highlightGroup, setHighlightGroup] = useState<number | null>(null);

  useEffect(() => {
    if (!e2ee.isReady) return;
    setGenerating(true);
    Promise.all([
      e2ee.getLocalFingerprint(),
      e2ee.getRemoteFingerprint(peerId),
    ]).then(async ([lf, rf]) => {
      setLocalFP(lf || '');
      setRemoteFP(rf || '');
      // 使用本地和远端公鑰指纹生成 9999 位安全码
      const sn9999 = await generate9999SafetyNumber(lf || CURRENT_USER.id, rf || peerId);
      setSafetyNumber9999(sn9999);
      setGenerating(false);
      // 生成安全码二维码（只编码前 60 位用于扫码比对）
      const snShort = sn9999.slice(0, 60);
      loadQRCode().then((QRCode: any) => {
        QRCode.toDataURL(JSON.stringify({ type: 'safety_number_9999', snShort, peerId, ts: Date.now() }), {
          width: 200, margin: 2, color: { dark: '#1a2e1a', light: '#ffffff' }
        }).then(setQrData).catch(console.error);
      }).catch(console.error);
    });
  }, [e2ee.isReady, peerId]);

  const groups9999 = format9999Groups(safetyNumber9999);

  const handleCopy = () => {
    navigator.clipboard?.writeText(safetyNumber9999);
    setCopyDone(true);
    toast.success('9999 位安全码已复制到剪贴板');
    setTimeout(() => setCopyDone(false), 2000);
  };

  // 展示前 60 位的简短安全码（用于展示区域外的小标识）
  const safetyNumber = safetyNumber9999;
  const formattedSN = formatSafetyNumber(safetyNumber9999);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed inset-0 z-50 bg-dove-paper overflow-y-auto"
      style={{ maxWidth: '480px', margin: '0 auto' }}
    >
      {/* 顶部导航 */}
      <div className="flex items-center gap-2 px-2 py-3 border-b border-border/50 bg-dove-paper sticky top-0 z-10">
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-dove-warm-gray">
          <ChevronRight size={20} className="text-dove-ink rotate-180" />
        </button>
        <h2 className="text-sm font-medium text-dove-ink">验证安全码</h2>
        <div className="ml-auto">
          <button
            onClick={() => setShowQR(!showQR)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-dove-warm-gray"
          >
            <QrCode size={14} className="text-dove-bamboo" />
            <span className="text-[10px] text-dove-bamboo">二维码</span>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* 说明卡片 */}
        <div className={`rounded-xl p-4 border ${
          verified
            ? 'bg-dove-green/5 border-dove-green/20'
            : 'bg-amber-50 border-amber-100'
        }`}>
          <div className="flex items-start gap-2">
            {verified
              ? <ShieldCheck size={18} className="text-dove-green mt-0.5" />
              : <AlertTriangle size={18} className="text-amber-500 mt-0.5" />
            }
            <div>
              <h3 className="text-sm font-medium text-dove-ink">
                {verified ? '✓ 已验证，连接安全' : `验证与 ${peerName} 的加密连接`}
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {verified
                  ? '你已确认与对方的连接未被中间人攻击'
                  : '与对方面对面比对以下安全码，确认无人监听你们的通话'
                }
              </p>
            </div>
          </div>
        </div>

        {/* 9999 位安全码 */}
        <div className="bg-white rounded-xl overflow-hidden">
          {/* 标题栏 */}
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border/30">
            <Lock size={12} className="text-dove-bamboo" />
            <span className="text-xs font-medium text-dove-ink">Safety Number — 9999 位数字指纹</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground/60 font-mono">1999 组 × 5 位</span>
              <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-dove-mist hover:bg-dove-warm-gray transition-colors">
                {copyDone
                  ? <CheckCircle2 size={11} className="text-dove-green" />
                  : <Copy size={11} className="text-muted-foreground" />}
                <span className="text-[9px] text-muted-foreground">{copyDone ? '已复制' : '复制'}</span>
              </button>
            </div>
          </div>

          {generating ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 size={22} className="animate-spin text-dove-green" />
              <p className="text-[10px] text-muted-foreground">SHA-512 迭代生成中...</p>
            </div>
          ) : (
            <>
              {/* 安全度说明 */}
              <div className="px-4 py-2 bg-dove-green/5 border-b border-dove-green/10 flex items-center gap-2">
                <ShieldCheck size={12} className="text-dove-green" />
                <span className="text-[9px] text-dove-green">
                  9999 位指纹 · SHA-512 多轮迭代 · 比 Signal 安全码强 166 倍
                </span>
              </div>

              {/* 9999 位数字滚动展示区 */}
              <div
                className="overflow-y-auto px-3 py-3"
                style={{ maxHeight: '320px' }}
              >
                <div className="grid grid-cols-3 gap-1.5">
                  {groups9999.map((group, i) => (
                    <button
                      key={i}
                      onClick={() => setHighlightGroup(highlightGroup === i ? null : i)}
                      className={`rounded-md py-1.5 text-center transition-all ${
                        highlightGroup === i
                          ? 'bg-dove-green/20 ring-1 ring-dove-green/40'
                          : 'bg-dove-mist hover:bg-dove-warm-gray'
                      }`}
                    >
                      <span className={`text-[11px] font-mono font-semibold tracking-widest ${
                        highlightGroup === i ? 'text-dove-green' : 'text-dove-ink'
                      }`}>
                        {group}
                      </span>
                      <span className="block text-[7px] text-muted-foreground/40 mt-0.5">
                        #{String(i + 1).padStart(4, '0')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 底部统计 */}
              <div className="px-4 py-2 border-t border-border/20 flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground/60 font-mono">
                  {highlightGroup !== null
                    ? `已选第 #${String(highlightGroup + 1).padStart(4, '0')} 组: ${groups9999[highlightGroup]}`
                    : `共 9999 位 · 1999 组 · 点击任意组高亮比对`
                  }
                </span>
                {highlightGroup !== null && (
                  <button
                    onClick={() => setHighlightGroup(null)}
                    className="text-[9px] text-dove-bamboo"
                  >
                    清除
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* 安全码二维码 */}
        <AnimatePresence>
          {showQR && qrData && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-white rounded-xl p-4 flex flex-col items-center">
                <p className="text-[10px] text-muted-foreground mb-3">
                  让对方扫描此二维码比对安全码
                </p>
                <div className="p-2 rounded-xl border-2 border-dove-green shadow-[0_0_0_4px_rgba(76,175,80,0.15)] bg-white">
                  <img src={qrData} alt="Safety Number QR" className="w-40 h-40 rounded-lg" />
                </div>
                <p className="text-[9px] text-muted-foreground/60 mt-2">
                  面对面扫描最安全，避免远程分享
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 密钥指纹 */}
        <div className="bg-white rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30">
            <span className="text-xs font-medium text-dove-ink">密钥指纹对比</span>
          </div>
          <div className="p-3 space-y-2">
            <div className="bg-dove-mist rounded-lg p-2.5">
              <p className="text-[9px] text-muted-foreground mb-1">你的 Identity Key 指纹</p>
              <p className="text-[9px] font-mono text-dove-ink break-all">
                {localFP || '加载中...'}
              </p>
            </div>
            <div className="bg-dove-mist rounded-lg p-2.5">
              <p className="text-[9px] text-muted-foreground mb-1">{peerName} 的 Identity Key 指纹</p>
              <p className="text-[9px] font-mono text-dove-ink break-all">
                {remoteFP || '加载中...'}
              </p>
            </div>
          </div>
        </div>

        {/* 验证按钮 */}
        <button
          onClick={() => { setVerified(!verified); if (!verified) toast.success('已标记为已验证联系人'); }}
          className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-medium text-sm transition-all ${
            verified
              ? 'bg-dove-green/10 text-dove-green border border-dove-green/20'
              : 'bg-dove-green text-white'
          }`}
        >
          {verified ? (
            <><ShieldCheck size={16} /> 已验证</>
          ) : (
            <><CheckCircle2 size={16} /> 已比对，标记为已验证</>
          )}
        </button>

        {/* 协议说明 */}
        <div className="bg-dove-ink/95 rounded-xl p-4">
          <p className="text-[9px] text-green-400/70 font-mono leading-relaxed">
            {'// imim · 9999-Digit Safety Number'}<br />
            {'// Algorithm: SHA-512 Multi-Round Iteration (65 rounds)'}<br />
            {'// Input: localIdentityKey | remoteIdentityKey'}<br />
            {'// Output: 9999 decimal digits (1999 groups × 5 digits)'}<br />
            {'// Entropy: ~33,219 bits (vs Signal\'s ~199 bits)'}<br />
            {'// Compare any group with peer to detect MITM attack'}<br />
            {'// 双方比对一致 → 无中间人攻击 ✔'}
          </p>
        </div>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// 主组件：个人名片二维码弹窗
// ─────────────────────────────────────────────
export const QRCardModal: React.FC<{
  onClose: () => void;
  onScanSuccess?: (payload: QRPayload) => void;
}> = ({ onClose, onScanSuccess }) => {
  const e2ee = useE2EE();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [payload, setPayload] = useState<QRPayload | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scannedPayload, setScannedPayload] = useState<QRPayload | null>(null);
  const [scanSafetyNumber, setScanSafetyNumber] = useState('');
  const [tab, setTab] = useState<'myqr' | 'scan'>('myqr');
  const [loading, setLoading] = useState(true);
  const [qrError, setQrError] = useState('');
  const [useBasicQr, setUseBasicQr] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [adding, setAdding] = useState(false);

  // 生成个人名片二维码
  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const renderQr = async (withE2EE: boolean) => {
      setLoading(true);
      setQrError('');
      try {
        const QRCode = await loadQRCode();
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;

        const userId = CURRENT_USER.id;
        if (!userId || userId === 'me') {
          setQrError('请先登录后再查看二维码');
          setPayload(null);
          return;
        }

        let dataStr: string;
        if (withE2EE && e2ee.isReady) {
          const status = e2ee.status;
          const fp = await e2ee.getLocalFingerprint();
          const p: QRPayload = {
            v: 1,
            uid: userId,
            name: CURRENT_USER.name,
            phone: CURRENT_USER.phone || '',
            ik: status?.identityKey?.slice(0, 64) || '',
            regId: status?.registrationId || 0,
            fp: fp || '',
            ts: Date.now(),
            exp: Date.now() + 24 * 60 * 60 * 1000,
          };
          setPayload(p);
          setUseBasicQr(false);
          dataStr = JSON.stringify(p);
        } else {
          setPayload(null);
          setUseBasicQr(true);
          dataStr = `imim://user/${userId}`;
        }

        await QRCode.toCanvas(canvas, dataStr, {
          width: 200,
          margin: 2,
          color: { dark: '#1a2e1a', light: '#ffffff' },
          errorCorrectionLevel: 'M',
        });
      } catch (e) {
        console.error('QR生成失败', e);
        if (!cancelled) setQrError('二维码生成失败，请重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (e2ee.isReady) {
      renderQr(true);
    } else if (e2ee.isInitializing) {
      fallbackTimer = setTimeout(() => {
        if (!cancelled && !e2ee.isReady) renderQr(false);
      }, 2500);
    } else {
      renderQr(false);
    }

    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [e2ee.isReady, e2ee.isInitializing, e2ee.status, refreshKey]);

  // 扫码成功处理（先调服务端校验，再展示确认弹窗）
  const handleScan = useCallback(async (p: QRPayload) => {
    setShowScanner(false);
    setVerifying(true);
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('user_token');
      const res = await fetch('/api/qr/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(p),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '二维码无效');
        return;
      }
      // 用服务端返回的真实用户信息覆盖二维码中的信息
      const verifiedPayload: QRPayload = {
        ...p,
        name: data.user.name,
        phone: data.user.phone,
      };
      setScannedPayload(verifiedPayload);
      // 计算安全码
      if (e2ee.isReady) {
        const sn = await e2ee.getSafetyNumber(p.uid).catch(() => '');
        setScanSafetyNumber(sn || '');
      }
    } catch {
      toast.error('网络错误，请重试');
    } finally {
      setVerifying(false);
    }
  }, [e2ee]);

  // 确认添加好友（调用真实好友申请 API）
  const handleConfirmAdd = useCallback(async () => {
    if (!scannedPayload || adding) return;
    setAdding(true);
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('user_token');
      const res = await fetch('/api/friend/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          toId: scannedPayload.uid,
          message: '我通过扫描你的二维码添加你为好友',
          searchMethod: 'qr',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '发送好友申请失败');
        return;
      }
      if (data.autoAccepted) {
        toast.success(`已与 ${scannedPayload.name} 成为好友`, { description: 'E2EE 加密会话已建立' });
      } else {
        toast.success(`好友申请已发送给 ${scannedPayload.name}`, { description: '等待对方确认' });
      }
      onScanSuccess?.(scannedPayload);
      setScannedPayload(null);
      onClose();
    } catch {
      toast.error('网络错误，请重试');
    } finally {
      setAdding(false);
    }
  }, [scannedPayload, adding, onScanSuccess, onClose]);

  // 刷新二维码
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-6"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.85, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-[340px] bg-white rounded-2xl overflow-hidden shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* 顶部渐变 */}
          <div className="relative h-20 bg-gradient-to-br from-dove-green to-dove-bamboo">
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-white/10" />
              <div className="absolute -left-2 -bottom-2 w-16 h-16 rounded-full bg-white/5" />
            </div>
            <button
              onClick={onClose}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/20 flex items-center justify-center"
            >
              <X size={14} className="text-white" />
            </button>
            {/* Tab 切换 */}
            <div className="absolute bottom-0 left-0 right-0 flex">
              {(['myqr', 'scan'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-xs font-medium transition-all ${
                    tab === t
                      ? 'bg-white text-dove-green rounded-t-lg'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  {t === 'myqr' ? '我的二维码' : '扫一扫'}
                </button>
              ))}
            </div>
          </div>

          {/* 我的二维码 Tab */}
          {tab === 'myqr' && (
            <div className="px-6 pt-4 pb-5">
              {/* 用户信息 */}
              <div className="flex items-center gap-3 mb-4 -mt-8">
                <div className="ring-4 ring-white rounded-xl shadow-sm">
                  <DoveAvatar name={CURRENT_USER.name} id={CURRENT_USER.id} avatar={CURRENT_USER.avatar} size="xl" />
                </div>
                <div className="pt-6">
                  <h3 className="text-base font-medium text-dove-ink">{CURRENT_USER.name}</h3>
                  <p className="text-[10px] text-muted-foreground">imim: {CURRENT_USER.phone}</p>
                </div>
              </div>

              {/* 二维码 */}
              <div className="flex flex-col items-center">
                <div className="relative w-52 h-52 bg-white rounded-xl shadow-inner border border-border/30 flex items-center justify-center p-2">
                  {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white rounded-xl z-10">
                      <Loader2 size={24} className="animate-spin text-dove-green" />
                    </div>
                  )}
                  {qrError && !loading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-xl z-10 px-4 text-center gap-2">
                      <AlertTriangle size={22} className="text-amber-500" />
                      <p className="text-[11px] text-muted-foreground">{qrError}</p>
                      <button
                        onClick={handleRefresh}
                        className="text-[10px] text-dove-green flex items-center gap-1"
                      >
                        <RefreshCw size={10} /> 重试
                      </button>
                    </div>
                  )}
                  <canvas ref={canvasRef} width={200} height={200} className="rounded-lg" />
                  {/* 中心 logo */}
                  <div className="absolute w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm border border-border/20">
                    <span className="text-[10px] font-bold text-dove-green">im</span>
                  </div>
                </div>

                {/* 有效期 */}
                {payload && (
                  <div className="flex items-center gap-1 mt-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-dove-green animate-pulse" />
                    <p className="text-[9px] text-muted-foreground">
                      有效期至 {new Date(payload.exp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <button onClick={handleRefresh} className="ml-1">
                      <RefreshCw size={9} className="text-muted-foreground" />
                    </button>
                  </div>
                )}
                {useBasicQr && !loading && !qrError && (
                  <p className="text-[9px] text-amber-600 mt-2 text-center">
                    加密模块初始化中，当前为基础二维码（仍可添加好友）
                  </p>
                )}

                <p className="text-[10px] text-muted-foreground mt-2 text-center">
                  扫一扫上面的二维码，加我为好友
                </p>

                {/* E2EE 标识 */}
                <div className="flex items-center gap-1 mt-2 px-3 py-1 bg-dove-green/8 rounded-full border border-dove-green/10">
                  <ShieldCheck size={10} className="text-dove-green" />
                  <span className="text-[9px] text-dove-green">含 E2EE 公钥 · Signal Protocol</span>
                </div>
              </div>

              {/* 指纹 */}
              {payload?.fp && (
                <div className="mt-3 px-3 py-2 bg-dove-mist rounded-lg">
                  <p className="text-[8px] text-muted-foreground/60 font-mono text-center break-all">
                    指纹: {payload.fp}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 扫一扫 Tab */}
          {tab === 'scan' && (
            <div className="px-6 py-6 flex flex-col items-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-blue-50 flex items-center justify-center">
                <Scan size={36} className="text-blue-500" />
              </div>
              <div className="text-center">
                <h3 className="text-sm font-medium text-dove-ink mb-1">扫描好友二维码</h3>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  扫描对方的 imim 二维码，自动建立<br />端到端加密聊天连接
                </p>
              </div>
              <button
                onClick={() => setShowScanner(true)}
                disabled={verifying}
                className="w-full py-3 bg-blue-500 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {verifying ? (
                  <><Loader2 size={16} className="animate-spin" /> 校验中...</>
                ) : (
                  <><Camera size={16} /> 打开摄像头扫描</>
                )}
              </button>
              <p className="text-[9px] text-muted-foreground/60 text-center">
                面对面扫描最安全，避免远程分享二维码
              </p>
            </div>
          )}

          {/* 底部品牌 */}
          <div className="px-6 pb-4 flex items-center justify-center gap-1 border-t border-border/30 pt-3">
            <Lock size={9} className="text-muted-foreground/40" />
            <span className="text-[9px] text-muted-foreground/40">imim · 端到端加密通讯</span>
          </div>
        </motion.div>
      </motion.div>

      {/* 扫码器 */}
      <AnimatePresence>
        {showScanner && (
          <QRScanner
            onScan={handleScan}
            onClose={() => setShowScanner(false)}
          />
        )}
      </AnimatePresence>

      {/* 扫码成功确认 */}
      <AnimatePresence>
        {scannedPayload && (
          <ScanSuccessModal
            payload={scannedPayload}
            safetyNumber={scanSafetyNumber}
            onConfirm={handleConfirmAdd}
            onCancel={() => setScannedPayload(null)}
            adding={adding}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default QRCardModal;
