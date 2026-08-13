/**
 * 我的二维码弹窗
 * 生成包含用户 ID 的二维码，支持长按/点击保存
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Share2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface QRCodeModalProps {
  userId: string;
  nickname: string;
  avatar?: string;
  onClose: () => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ userId, nickname, avatar, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrError, setQrError] = useState('');

  const qrContent = `imim://user/${userId}`;

  useEffect(() => {
    let cancelled = false;
    const generate = async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const QRCode = (await import('qrcode')).default;
        await QRCode.toCanvas(canvas, qrContent, {
          width: 220,
          margin: 2,
          color: { dark: '#1a1a1a', light: '#ffffff' },
          errorCorrectionLevel: 'H',
        });
        if (!cancelled) {
          setQrDataUrl(canvas.toDataURL('image/png'));
          setQrError('');
        }
      } catch (err) {
        console.error('QR 生成失败:', err);
        if (!cancelled) setQrError('二维码生成失败，请关闭后重试');
      }
    };
    generate();
    return () => { cancelled = true; };
  }, [qrContent]);

  const handleSave = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${nickname}-qrcode.png`;
    a.click();
    toast('二维码已保存');
  };

  const handleShare = async () => {
    if (!qrDataUrl) return;
    if (navigator.share) {
      try {
        const blob = await (await fetch(qrDataUrl)).blob();
        const file = new File([blob], `${nickname}-qrcode.png`, { type: 'image/png' });
        await navigator.share({ files: [file], title: `${nickname} 的二维码` });
      } catch {
        handleSave();
      }
    } else {
      handleSave();
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
          className="relative w-full max-w-sm bg-white rounded-t-3xl pb-safe overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* 顶部把手 */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-gray-200 rounded-full" />
          </div>

          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 py-3">
            <h3 className="text-base font-semibold text-gray-900">我的二维码</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <X size={16} className="text-gray-500" />
            </button>
          </div>

          {/* 二维码卡片 */}
          <div className="mx-5 mb-5 rounded-2xl bg-gradient-to-br from-slate-50 to-gray-100 p-6 flex flex-col items-center gap-4 shadow-inner">
            {/* 用户信息 */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-xl font-bold shadow-md">
                {avatar ? (
                  <img src={avatar} alt={nickname} className="w-full h-full rounded-full object-cover" />
                ) : (
                  nickname.charAt(0)
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-900">{nickname}</p>
                <p className="text-xs text-gray-400 mt-0.5">imim ID: {userId.slice(0, 12)}...</p>
              </div>
            </div>

            {/* 二维码 */}
            <div className="bg-white rounded-2xl p-3 shadow-sm min-h-[220px] flex items-center justify-center">
              {qrError ? (
                <div className="flex flex-col items-center gap-2 text-center px-4">
                  <AlertTriangle size={20} className="text-amber-500" />
                  <p className="text-xs text-gray-500">{qrError}</p>
                </div>
              ) : (
                <canvas ref={canvasRef} className="block" />
              )}
            </div>

            <p className="text-xs text-gray-400 text-center">扫描二维码，添加我为好友</p>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 px-5 pb-6">
            <button
              onClick={handleSave}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors text-sm font-medium text-gray-700"
            >
              <Download size={16} />
              保存图片
            </button>
            <button
              onClick={handleShare}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 transition-colors text-sm font-medium text-white"
            >
              <Share2 size={16} />
              分享
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
