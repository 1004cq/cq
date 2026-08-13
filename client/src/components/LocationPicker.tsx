/**
 * LocationPicker.tsx
 * 位置选择器组件 - 全屏弹出式
 * 功能：
 * 1. 获取用户当前 GPS 位置
 * 2. 使用腾讯地图展示位置（带 Marker）
 * 3. 通过后端代理逆地理编码获取地址
 * 4. 支持拖动地图重新选择位置
 * 5. 确认后回调经纬度 + 地址
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, MapPin, Navigation, Loader2, Send, LocateFixed, AlertCircle
} from 'lucide-react';
import {
  getCurrentLocation,
  getLocationErrorMessage,
  isLocationPermissionDenied,
} from '../lib/location';

export interface LocationPickerResult {
  lat: number;
  lng: number;
  address: string;
}

interface LocationPickerProps {
  onConfirm: (result: LocationPickerResult) => void;
  onClose: () => void;
}

// 腾讯地图动态加载（复用 LocationSharePage 的加载逻辑）
let tmapLoadPromise: Promise<void> | null = null;
function loadTMap(key: string): Promise<void> {
  if ((window as any).TMap) return Promise.resolve();
  if (tmapLoadPromise) return tmapLoadPromise;
  tmapLoadPromise = new Promise((resolve, reject) => {
    const cb = '__tmapPickerCb_' + Date.now();
    (window as any)[cb] = () => { delete (window as any)[cb]; resolve(); };
    const s = document.createElement('script');
    s.charset = 'utf-8';
    s.src = `https://map.qq.com/api/gljs?v=1.exp&key=${key}&callback=${cb}`;
    s.onerror = () => { tmapLoadPromise = null; reject(new Error('腾讯地图 API 加载失败')); };
    document.body.appendChild(s);
  });
  return tmapLoadPromise;
}

export default function LocationPicker({ onConfirm, onClose }: LocationPickerProps) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [address, setAddress] = useState('');
  const [loadingAddr, setLoadingAddr] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const mapContRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 逆地理编码（通过后端代理）
  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setLoadingAddr(true);
    try {
      const resp = await fetch(`/api/txmap/geocoder/reverse?lat=${lat}&lng=${lng}`);
      const data = await resp.json();
      if (data.formatted_address || data.address) {
        setAddress(data.formatted_address || data.address);
      } else {
        setAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      }
    } catch {
      setAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    } finally {
      setLoadingAddr(false);
    }
  }, []);

  // 更新 Marker 位置
  const updateMarker = useCallback((lat: number, lng: number) => {
    if (!mapRef.current || !markerRef.current) return;
    const TMap = (window as any).TMap;
    markerRef.current.updateGeometries([{
      id: 'picker_marker',
      styleId: 'pin',
      position: new TMap.LatLng(lat, lng),
    }]);
  }, []);

  // 初始化地图
  const initMap = useCallback(async (lat: number, lng: number) => {
    if (!mapContRef.current || mapRef.current) return;
    try {
      const resp = await fetch('/api/txmap-config');
      const cfg = await resp.json();
      if (!cfg.enabled || !cfg.key) {
        setErrorMsg('管理员尚未配置腾讯地图 API Key，请前往管理后台 → 腾讯位置服务中填写。');
        setPhase('error');
        return;
      }
      await loadTMap(cfg.key);
      const TMap = (window as any).TMap;
      const map = new TMap.Map(mapContRef.current, {
        center: new TMap.LatLng(lat, lng),
        zoom: 16,
        pitch: 0,
        rotation: 0,
      });
      mapRef.current = map;

      // 创建 Marker
      const svgSrc = `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52"><defs><filter id="s" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#00000040"/></filter></defs><circle cx="20" cy="20" r="16" fill="#1a237e" stroke="white" stroke-width="3" filter="url(#s)"/><circle cx="20" cy="20" r="6" fill="white"/><polygon points="14,32 26,32 20,48" fill="#1a237e"/></svg>'
      )}`;
      markerRef.current = new TMap.MultiMarker({
        map,
        styles: {
          pin: new TMap.MarkerStyle({ width: 40, height: 52, anchor: { x: 20, y: 48 }, src: svgSrc }),
        },
        geometries: [{
          id: 'picker_marker',
          styleId: 'pin',
          position: new TMap.LatLng(lat, lng),
        }],
      });

      // 监听地图拖动结束事件 → 更新 Marker + 逆地理编码
      map.on('dragend', () => {
        const c = map.getCenter();
        const newLat = c.getLat();
        const newLng = c.getLng();
        setCenter({ lat: newLat, lng: newLng });
        updateMarker(newLat, newLng);
        if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
        geocodeTimerRef.current = setTimeout(() => {
          void reverseGeocode(newLat, newLng);
        }, 500);
      });

      setPhase('ready');
    } catch (e: any) {
      setErrorMsg(e.message || '地图加载失败');
      setPhase('error');
    }
  }, [reverseGeocode, updateMarker]);

  const loadCurrentLocation = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    setPermissionDenied(false);

    try {
      const result = await getCurrentLocation({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });

      const nextCenter = { lat: result.lat, lng: result.lng };
      setCenter(nextCenter);

      if (mapRef.current) {
        const TMap = (window as any).TMap;
        mapRef.current.setCenter(new TMap.LatLng(result.lat, result.lng));
        updateMarker(result.lat, result.lng);
        setPhase('ready');
      } else {
        await initMap(result.lat, result.lng);
      }

      await reverseGeocode(result.lat, result.lng);
    } catch (error) {
      setPermissionDenied(isLocationPermissionDenied(error));
      setErrorMsg(getLocationErrorMessage(error));
      setPhase('error');
    }
  }, [initMap, reverseGeocode, updateMarker]);

  useEffect(() => {
    return () => {
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    };
  }, []);

  // 回到当前位置
  const relocate = useCallback(() => {
    void loadCurrentLocation();
  }, [loadCurrentLocation]);

  // 确认发送
  const handleConfirm = useCallback(() => {
    if (!center) return;
    setSending(true);
    onConfirm({
      lat: center.lat,
      lng: center.lng,
      address: address || `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`,
    });
  }, [center, address, onConfirm]);

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="text-sm">取消</span>
        </button>
        <h1 className="text-base font-semibold text-foreground">发送位置</h1>
        <button
          onClick={handleConfirm}
          disabled={!center || sending || phase !== 'ready'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-all active:scale-95"
        >
          {sending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          <span>发送</span>
        </button>
      </div>

      <div className="flex-1 relative">
        {phase === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-muted/50 z-10 px-8">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <MapPin size={30} className="text-primary" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground mb-1">先允许定位，再选择位置</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                为兼容 Chrome 和 iPhone 浏览器，定位权限会在你点击按钮后再申请。
              </p>
            </div>
            <button
              onClick={() => { void loadCurrentLocation(); }}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
            >
              允许定位并获取当前位置
            </button>
          </div>
        )}

        {phase === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/50 z-10">
            <Loader2 size={32} className="text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">正在获取您的位置...</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-muted/50 z-10 px-8">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle size={32} className="text-destructive" />
            </div>
            <p className="text-sm text-muted-foreground text-center leading-relaxed">{errorMsg}</p>
            {permissionDenied && (
              <p className="max-w-sm text-xs text-muted-foreground text-center leading-6">
                Chrome 可在地址栏左侧的站点设置中，把“位置信息”改为“允许”；若是 iPhone 上的 Chrome，还需同时检查系统定位服务是否开启。
              </p>
            )}
            <button
              onClick={() => { void loadCurrentLocation(); }}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
            >
              重试
            </button>
          </div>
        )}

        <div ref={mapContRef} className="w-full h-full" />

        {phase === 'ready' && (
          <button
            onClick={relocate}
            className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-background shadow-lg border border-border flex items-center justify-center z-10 active:scale-95 transition-transform"
            title="回到当前位置"
          >
            <LocateFixed size={20} className="text-primary" />
          </button>
        )}
      </div>

      <div className="border-t border-border bg-background px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <MapPin size={16} className="text-primary" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-0.5">当前选择的位置</p>
            {loadingAddr ? (
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="text-muted-foreground animate-spin" />
                <span className="text-sm text-muted-foreground">正在获取地址...</span>
              </div>
            ) : (
              <p className="text-sm text-foreground font-medium leading-relaxed">
                {address || (center ? `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}` : '未获取位置')}
              </p>
            )}
            {center && (
              <p className="text-xs text-muted-foreground mt-1">
                <Navigation size={10} className="inline mr-1" />
                {center.lat.toFixed(6)}, {center.lng.toFixed(6)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
