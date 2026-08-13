/**
 * 群二维码页面（微信风格全屏页面）
 * 功能：展示群二维码，支持保存、分享与复制链接
 * - 默认公开群：展示长期有效的公开链接二维码
 * - 默认群邀请：展示长期有效的默认邀请二维码
 * - 自定义邀请链接：支持展示过期时间与使用次数限制
 */
import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Loader2, Download, Share2, MessageCircle, Copy } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';

interface MemberAvatar {
  userId: string;
  name?: string;
  avatar?: string;
}

interface GroupQRCodePageProps {
  groupId: string;
  groupName: string;
  groupAvatar?: string;
  groupUsername?: string | null;
  members: MemberAvatar[];
  onClose: () => void;
  inviteUrl?: string;
  inviteExpireAt?: string | null;
  inviteMaxUses?: number;
  inviteUsedCount?: number;
  inviteLabel?: string;
}

const GroupAvatarGrid: React.FC<{ members: MemberAvatar[]; size?: number }> = ({ members, size = 80 }) => {
  const displayMembers = members.slice(0, 9);
  const count = displayMembers.length;

  let cols = 3;
  let cellSize = Math.floor(size / 3) - 2;
  if (count <= 1) {
    cols = 1;
    cellSize = size - 4;
  } else if (count <= 4) {
    cols = 2;
    cellSize = Math.floor(size / 2) - 2;
  }

  return (
    <div
      className="rounded-xl overflow-hidden bg-[#e5e5ea] dark:bg-[#3a3a3c] flex flex-wrap items-center justify-center"
      style={{ width: size, height: size, gap: 1, padding: 2 }}
    >
      {displayMembers.map((m, i) => (
        <div key={m.userId + i} style={{ width: cellSize, height: cellSize }} className="overflow-hidden rounded-sm">
          {m.avatar ? (
            <img src={m.avatar} alt={m.name || ''} className="w-full h-full object-cover" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-teal-500 text-white font-semibold"
              style={{ fontSize: Math.max(8, cellSize * 0.4) }}
            >
              {(m.name || '?').charAt(0)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const formatExpireDate = (expireAt: Date | null) => {
  if (!expireAt) return '';
  const month = expireAt.getMonth() + 1;
  const day = expireAt.getDate();
  const hour = String(expireAt.getHours()).padStart(2, '0');
  const minute = String(expireAt.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute}`;
};

export const GroupQRCodePage: React.FC<GroupQRCodePageProps> = ({
  groupId,
  groupName,
  groupAvatar,
  groupUsername,
  members,
  onClose,
  inviteUrl,
  inviteExpireAt,
  inviteMaxUses = 0,
  inviteUsedCount = 0,
  inviteLabel,
}) => {
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [displayUsername, setDisplayUsername] = useState('');
  const [footerText, setFooterText] = useState('');
  const [qrTargetUrl, setQrTargetUrl] = useState<string>('');

  const publicUrl = groupUsername ? `https://wed.imim.chat/im/${groupUsername}` : '';

  const drawCenterLogo = useCallback(async (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerSize = 44;
    const x = (canvas.width - centerSize) / 2;
    const y = (canvas.height - centerSize) / 2;
    const radius = 8;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + centerSize - radius, y);
    ctx.quadraticCurveTo(x + centerSize, y, x + centerSize, y + radius);
    ctx.lineTo(x + centerSize, y + centerSize - radius);
    ctx.quadraticCurveTo(x + centerSize, y + centerSize, x + centerSize - radius, y + centerSize);
    ctx.lineTo(x + radius, y + centerSize);
    ctx.quadraticCurveTo(x, y + centerSize, x, y + centerSize - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();

    try {
      const logoImg = new Image();
      logoImg.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        logoImg.onload = () => resolve();
        logoImg.onerror = () => reject(new Error('logo load failed'));
        logoImg.src = '/imim-qr-center-logo.png';
      });
      const padding = 4;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(logoImg, x + padding, y + padding, centerSize - padding * 2, centerSize - padding * 2);
    } catch {
      ctx.fillStyle = '#07C160';
      ctx.beginPath();
      ctx.arc(x + centerSize / 2, y + centerSize / 2, centerSize / 2 - 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${centerSize * 0.4}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('im', x + centerSize / 2, y + centerSize / 2);
    }
  }, []);

  const generateQR = useCallback(async () => {
    setLoading(true);
    try {
      let targetUrl = '';
      let expireAt: Date | null = inviteExpireAt ? new Date(inviteExpireAt) : null;
      let maxUses = inviteMaxUses || 0;
      let usedCount = inviteUsedCount || 0;
      let usernameText = groupUsername ? `@${groupUsername}` : '';
      let footer = '';

      if (inviteUrl) {
        targetUrl = inviteUrl;
        footer = inviteLabel || '自定义邀请链接';
      } else if (publicUrl) {
        targetUrl = publicUrl;
        footer = `公开群链接：${publicUrl}（长期有效）`;
      } else {
        try {
          const userId = localStorage.getItem('user_id') || '';
          const res = await fetch('/api/group/qrcode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, userId }),
          });
          const data = await res.json();
          if (data.ok && data.inviteLink) {
            targetUrl = data.inviteLink.fullUrl || `https://wed.imim.chat${data.inviteLink.url}`;
            expireAt = data.inviteLink.expireAt ? new Date(data.inviteLink.expireAt) : null;
            maxUses = Number(data.inviteLink.maxUses || 0);
            usedCount = Number(data.inviteLink.usedCount || 0);
          }
        } catch {
          // ignore and continue fallback
        }
      }

      if (!targetUrl) {
        targetUrl = `imim://group/${groupId}`;
      }

      if (!footer) {
        const parts: string[] = [];
        if (inviteUrl) {
          parts.push(inviteLabel || '自定义邀请链接');
        }
        if (expireAt) {
          parts.push(`将于 ${formatExpireDate(expireAt)} 失效`);
        }
        if (maxUses > 0) {
          const remaining = Math.max(0, maxUses - usedCount);
          parts.push(`最多可使用 ${maxUses} 次，剩余 ${remaining} 次`);
        }
        if (parts.length === 0) {
          footer = inviteUrl
            ? '该邀请链接长期有效，除非管理员主动撤销'
            : '该群二维码长期有效，除非管理员主动撤销或重置默认邀请链接';
        } else {
          footer = parts.join('，');
        }
      }

      if (inviteUrl && !usernameText) {
        usernameText = '';
      }

      const tempCanvas = document.createElement('canvas');
      await QRCode.toCanvas(tempCanvas, targetUrl, {
        width: 240,
        margin: 3,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'H',
      });

      await drawCenterLogo(tempCanvas);

      setDisplayUsername(usernameText);
      setFooterText(footer);
      setQrTargetUrl(targetUrl);
      setQrDataUrl(tempCanvas.toDataURL('image/png'));
    } catch (err) {
      console.error('[GroupQRCodePage] 生成二维码失败:', err);
      toast.error('生成二维码失败');
      setQrDataUrl('');
      setFooterText('二维码生成失败');
      setDisplayUsername('');
    } finally {
      setLoading(false);
    }
  }, [drawCenterLogo, groupId, groupUsername, inviteExpireAt, inviteLabel, inviteMaxUses, inviteUrl, inviteUsedCount, publicUrl]);

  useEffect(() => {
    generateQR();
  }, [generateQR]);

  const handleSave = useCallback(() => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${groupName}-群二维码.png`;
    a.click();
    toast.success('二维码已保存');
  }, [qrDataUrl, groupName]);

  const handleShare = useCallback(async () => {
    if (!qrDataUrl) return;
    if (navigator.share) {
      try {
        const blob = await (await fetch(qrDataUrl)).blob();
        const file = new File([blob], `${groupName}-群二维码.png`, { type: 'image/png' });
        await navigator.share({ files: [file], title: `${groupName} 群二维码` });
      } catch {
        handleSave();
      }
    } else {
      handleSave();
    }
  }, [qrDataUrl, groupName, handleSave]);

  const handleCopyLink = useCallback(async () => {
    const linkToCopy = inviteUrl || publicUrl || qrTargetUrl;
    if (!linkToCopy) {
      toast.error('暂无可复制链接');
      return;
    }
    try {
      await navigator.clipboard.writeText(linkToCopy);
      toast.success(inviteUrl ? '邀请链接已复制' : publicUrl ? '群公开链接已复制' : '群邀请链接已复制');
    } catch {
      toast.error('复制失败');
    }
  }, [inviteUrl, publicUrl, qrTargetUrl]);

  const content = (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0, 0.67, 0] }}
      className="fixed inset-0 z-[210] bg-[#ededed] dark:bg-[#1c1c1e] flex flex-col"
    >
      <div className="flex items-center justify-between px-4 pt-safe-top pb-3 bg-[#ededed] dark:bg-[#1c1c1e] border-b border-black/5 dark:border-white/10">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-[#007AFF] dark:text-[#0A84FF] text-sm font-medium"
        >
          <ChevronLeft size={20} />
          返回
        </button>
        <span className="text-base font-semibold text-[#1c1c1e] dark:text-white">群二维码</span>
        <div className="w-16" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="bg-[#4c4c4c]/80 dark:bg-[#3a3a3c] rounded-2xl px-8 py-6 flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-white" />
              <span className="text-sm text-white/90">正在加载</span>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-sm w-full max-w-[320px] px-6 pt-8 pb-6 flex flex-col items-center">
            {groupAvatar ? (
              <img
                src={groupAvatar}
                alt={groupName}
                className="w-16 h-16 rounded-xl object-cover mb-3"
              />
            ) : (
              <div className="mb-3">
                <GroupAvatarGrid members={members} size={64} />
              </div>
            )}

            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-base font-medium text-[#1c1c1e] dark:text-white">
                群聊：{groupName}
              </span>
              <MessageCircle size={16} className="text-[#007AFF] dark:text-[#0A84FF]" />
            </div>

            {displayUsername ? (
              <button
                onClick={handleCopyLink}
                className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-[#576b95] dark:text-[#8ab4ff]"
              >
                <span>{displayUsername}</span>
                <Copy size={13} />
              </button>
            ) : inviteUrl ? (
              <button
                onClick={handleCopyLink}
                className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-[#576b95] dark:text-[#8ab4ff]"
              >
                <span>复制邀请链接</span>
                <Copy size={13} />
              </button>
            ) : (
              <p className="mb-5 text-xs text-[#8e8e93] dark:text-[#98989d]">未设置群公开 ID</p>
            )}

            <div className="bg-white rounded-xl p-2 mb-4 shadow-sm">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={`${groupName} 群二维码`} className="block w-[240px] h-[240px] rounded-lg" />
              ) : (
                <div className="w-[240px] h-[240px] flex items-center justify-center text-sm text-[#8e8e93]">
                  二维码生成失败
                </div>
              )}
            </div>

            <p className="text-xs text-[#8e8e93] dark:text-[#98989d] text-center leading-5 break-all">
              {footerText}
            </p>
          </div>
        )}
      </div>

      {!loading && (
        <div className="flex gap-3 px-8 pb-8 pt-4">
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#f2f2f7] dark:bg-[#3a3a3c] text-sm font-medium text-[#1c1c1e] dark:text-white"
          >
            <Download size={16} />
            保存图片
          </button>
          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#07C160] text-sm font-medium text-white"
          >
            <Share2 size={16} />
            分享
          </button>
        </div>
      )}
    </motion.div>
  );

  return ReactDOM.createPortal(content, document.body);
};

export default GroupQRCodePage;
