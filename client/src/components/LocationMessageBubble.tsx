/**
 * LocationMessageBubble.tsx
 * 位置消息气泡组件
 * - 显示静态地图缩略图（通过后端代理）
 * - 显示逆地理编码地址（通过后端代理）
 * - 点击打开实时位置共享页面（实时共享）或外部地图（单次位置）
 */
import { useState, useEffect } from 'react';
import { MapPin, Navigation, Loader2, ExternalLink } from 'lucide-react';

export interface LocationMessageData {
  lat: number;
  lng: number;
  /** 消息类型：'location'=单次位置，'location_share'=实时共享邀请 */
  locationType: 'location' | 'location_share';
  /** 预存的地址（发送时通过逆地理编码获取） */
  address?: string;
  /** 实时共享 ID（locationType=location_share 时有值） */
  shareId?: string;
  /** 共享时长（分钟） */
  duration?: number;
  /** 共享结束时间戳 */
  expiresAt?: number;
}

interface LocationMessageBubbleProps {
  data: LocationMessageData;
  isSelf: boolean;
  /** 点击实时共享邀请时的回调 */
  onJoinShare?: (shareId: string) => void;
}

export default function LocationMessageBubble({ data, isSelf, onJoinShare }: LocationMessageBubbleProps) {
  const [address, setAddress] = useState(data.address || '');
  const [loadingAddr, setLoadingAddr] = useState(!data.address);
  const [imgError, setImgError] = useState(false);

  // 如果没有预存地址，通过后端代理逆地理编码获取
  useEffect(() => {
    if (data.address || !data.lat || !data.lng) return;
    setLoadingAddr(true);
    fetch(`/api/txmap/geocoder/reverse?lat=${data.lat}&lng=${data.lng}`)
      .then(r => r.json())
      .then(d => {
        if (d.formatted_address || d.address) {
          setAddress(d.formatted_address || d.address);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAddr(false));
  }, [data.lat, data.lng, data.address]);

  const staticMapUrl = `/api/txmap/staticmap?lat=${data.lat}&lng=${data.lng}&zoom=15&width=280&height=140`;

  const isShareExpired = data.expiresAt ? Date.now() > data.expiresAt : false;
  const isShareActive = data.locationType === 'location_share' && !isShareExpired;

  const handleClick = () => {
    if (data.locationType === 'location_share' && data.shareId && !isShareExpired && onJoinShare) {
      onJoinShare(data.shareId);
    } else {
      // 打开腾讯地图外部链接
      window.open(`https://map.qq.com/?type=marker&isopeninfowin=1&markertype=1&pointx=${data.lng}&pointy=${data.lat}&name=${encodeURIComponent(address || '位置')}&ref=qqmap`, '_blank');
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`group relative overflow-hidden rounded-2xl border transition-all active:scale-95 ${
        isSelf
          ? 'border-green-400/30 bg-green-500/10 hover:bg-green-500/20'
          : 'border-white/10 bg-white/5 hover:bg-white/10'
      }`}
      style={{ width: 240, maxWidth: '100%' }}
    >
      {/* 静态地图缩略图 */}
      <div className="relative w-full" style={{ height: 120 }}>
        {!imgError ? (
          <img
            src={staticMapUrl}
            alt="位置地图"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          // 地图加载失败时的占位背景
          <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center">
            <MapPin size={32} className="text-slate-500" />
          </div>
        )}

        {/* 实时共享标识 */}
        {isShareActive && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-green-500/90 backdrop-blur-sm rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-white text-xs font-medium">实时共享</span>
          </div>
        )}

        {/* 已过期标识 */}
        {data.locationType === 'location_share' && isShareExpired && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white/70 text-xs">共享已结束</span>
          </div>
        )}

        {/* 悬停遮罩 */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <ExternalLink size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
        </div>
      </div>

      {/* 地址信息区 */}
      <div className="px-3 py-2.5 flex items-start gap-2">
        <div className={`mt-0.5 flex-shrink-0 ${isSelf ? 'text-green-400' : 'text-blue-400'}`}>
          {data.locationType === 'location_share' ? (
            <Navigation size={14} />
          ) : (
            <MapPin size={14} />
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          {loadingAddr ? (
            <div className="flex items-center gap-1.5">
              <Loader2 size={12} className="text-white/40 animate-spin" />
              <span className="text-white/40 text-xs">获取地址中...</span>
            </div>
          ) : (
            <p className="text-white/80 text-xs leading-relaxed line-clamp-2">
              {address || `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`}
            </p>
          )}
          {data.locationType === 'location_share' && !isShareExpired && (
            <p className="text-green-400 text-xs mt-0.5 font-medium">点击加入实时位置共享</p>
          )}
          {data.locationType === 'location_share' && isShareExpired && (
            <p className="text-white/30 text-xs mt-0.5">共享已结束</p>
          )}
        </div>
      </div>
    </button>
  );
}
