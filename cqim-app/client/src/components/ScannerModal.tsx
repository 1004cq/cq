/**
 * 扫一扫组件
 * 调用摄像头扫描二维码，识别 imim://user/{userId} 格式后跳转添加好友
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, FlipHorizontal } from 'lucide-react';
import jsQR from 'jsqr';
import { toast } from 'sonner';

interface ScannerModalProps {
  onClose: () => void;
  onScanResult: (userId: string) => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({ onClose, onScanResult }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [error, setError] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [scanned, setScanned] = useState(false);

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);
        setError('');
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('请允许访问摄像头权限');
      } else if (err.name === 'NotFoundError') {
        setError('未找到摄像头设备');
      } else {
        setError('摄像头启动失败：' + err.message);
      }
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, [facingMode, startCamera]);

  // 持续扫描帧
  useEffect(() => {
    if (!scanning || scanned) return;
    const scan = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(scan);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code) {
        const data = code.data;
        setScanned(true);
        // 识别 imim://user/{userId} 格式
        const match = data.match(/^imim:\/\/user\/(.+)$/);
        if (match) {
          const userId = match[1];
          toast.success('扫描成功，正在跳转...');
          setTimeout(() => {
            onScanResult(userId);
            onClose();
          }, 600);
        } else if (data.startsWith('http')) {
          // 普通 URL
          toast(`识别到链接：${data.slice(0, 40)}...`, {
            action: { label: '打开', onClick: () => window.open(data, '_blank') },
          });
          setTimeout(() => setScanned(false), 2000);
        } else {
          toast(`识别到内容：${data.slice(0, 60)}`);
          setTimeout(() => setScanned(false), 2000);
        }
      }
      if (!scanned) {
        rafRef.current = requestAnimationFrame(scan);
      }
    };
    rafRef.current = requestAnimationFrame(scan);
    return () => cancelAnimationFrame(rafRef.current);
  }, [scanning, scanned, onScanResult, onClose]);

  const flipCamera = () => {
    setFacingMode(m => m === 'environment' ? 'user' : 'environment');
    setScanning(false);
    setScanned(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black flex flex-col"
      >
        {/* 顶部栏 */}
        <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3 z-10">
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X size={20} className="text-white" />
          </button>
          <h2 className="text-white font-medium text-base">扫一扫</h2>
          <button
            onClick={flipCamera}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <FlipHorizontal size={18} className="text-white" />
          </button>
        </div>

        {/* 摄像头预览 */}
        <div className="flex-1 relative overflow-hidden">
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8">
              <Camera size={48} className="text-white/30" />
              <p className="text-white/70 text-sm text-center">{error}</p>
              <button
                onClick={() => startCamera(facingMode)}
                className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-medium"
              >
                重试
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                playsInline
                muted
              />
              {/* 扫描框遮罩 */}
              <div className="absolute inset-0 flex items-center justify-center">
                {/* 四角遮罩 */}
                <div className="absolute inset-0 bg-black/50" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, 12% 25%, 88% 25%, 88% 75%, 12% 75%, 12% 25%)' }} />
                {/* 扫描框 */}
                <div className="relative w-64 h-64">
                  {/* 四个角 */}
                  {[['top-0 left-0', 'border-t-2 border-l-2'],
                    ['top-0 right-0', 'border-t-2 border-r-2'],
                    ['bottom-0 left-0', 'border-b-2 border-l-2'],
                    ['bottom-0 right-0', 'border-b-2 border-r-2']].map(([pos, border], i) => (
                    <div key={i} className={`absolute ${pos} w-6 h-6 ${border} border-emerald-400 rounded-sm`} />
                  ))}
                  {/* 扫描线动画 */}
                  {scanning && !scanned && (
                    <motion.div
                      className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
                      animate={{ top: ['8px', '248px', '8px'] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                    />
                  )}
                  {scanned && (
                    <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20 rounded-lg">
                      <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* 底部提示 */}
        <div className="pb-safe pb-8 pt-4 flex flex-col items-center gap-1">
          <p className="text-white/60 text-sm">将二维码放入框内，即可自动扫描</p>
          <p className="text-white/30 text-xs">支持 imim 好友二维码</p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
