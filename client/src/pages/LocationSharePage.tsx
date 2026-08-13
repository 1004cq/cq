/**
 * LocationSharePage.tsx
 * 实时位置共享页面 - 使用腾讯地图 JS API GL
 * 功能：发起/加入共享、多人 Marker + 轨迹、限时/手动停止、距离显示
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, MapPin, Users, Clock, Navigation,
  Square, Loader2, AlertCircle, RefreshCw
} from 'lucide-react';
import { CURRENT_USER } from '../lib/store';
import {
  getCurrentLocation,
  getLocationErrorMessage,
  isLocationPermissionDenied,
} from '../lib/location';

// ─── 类型 ───────────────────────────────────────
interface ParticipantLocation {
  userId: string;
  nickname: string;
  lat: number;
  lng: number;
  timestamp: number;
  trail: Array<{ lat: number; lng: number }>;
}

interface ShareStartOptions {
  shareId: string;
  endAt: number;
  mode: 'start' | 'join';
}

export interface LocationSharePageProps {
  chatId: string;
  chatName: string;
  /** 加入模式传入已有 shareId */
  shareId?: string;
  onBack: () => void;
}

// ─── 腾讯地图动态加载 ───────────────────────────
let tmapLoadPromise: Promise<void> | null = null;
function loadTMap(key: string): Promise<void> {
  if ((window as any).TMap) return Promise.resolve();
  if (tmapLoadPromise) return tmapLoadPromise;
  tmapLoadPromise = new Promise((resolve, reject) => {
    const cb = '__tmapCb_' + Date.now();
    (window as any)[cb] = () => { delete (window as any)[cb]; resolve(); };
    const s = document.createElement('script');
    s.charset = 'utf-8';
    s.src = `https://map.qq.com/api/gljs?v=1.exp&key=${key}&callback=${cb}`;
    s.onerror = () => { tmapLoadPromise = null; reject(new Error('腾讯地图 API 加载失败')); };
    document.body.appendChild(s);
  });
  return tmapLoadPromise;
}

// ─── 工具函数 ───────────────────────────────────
const COLOR_POOL = ['#07C160', '#1677FF', '#FF6B35', '#9B59B6', '#E74C3C', '#F39C12', '#1ABC9C', '#E91E63'];
function getUserColor(uid: string) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = uid.charCodeAt(i) + ((h << 5) - h);
  return COLOR_POOL[Math.abs(h) % COLOR_POOL.length];
}
function calcDist(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDist(m: number) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }
function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ─── 主组件 ─────────────────────────────────────
export default function LocationSharePage({ chatId, chatName, shareId: initShareId, onBack }: LocationSharePageProps) {
  const [phase, setPhase] = useState<'loading' | 'select' | 'join_ready' | 'sharing' | 'ended' | 'error'>(initShareId ? 'join_ready' : 'select');
  const [errorMsg, setErrorMsg] = useState('');
  const [shareId, setShareId] = useState(initShareId || '');
  const [duration, setDuration] = useState(15);
  const [remaining, setRemaining] = useState(0);
  const [participants, setParticipants] = useState<Map<string, ParticipantLocation>>(new Map());
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [lastAction, setLastAction] = useState<'start' | 'join'>(initShareId ? 'join' : 'start');

  const mapContRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const polylinesRef = useRef<Map<string, any>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const watchRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const myTrailRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const endTimeRef = useRef(0);

  const cleanup = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (locIntervalRef.current) {
      clearInterval(locIntervalRef.current);
      locIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleLocationFailure = useCallback((error: unknown) => {
    setPermissionDenied(isLocationPermissionDenied(error));
    setErrorMsg(getLocationErrorMessage(error));
    setPhase('error');
  }, []);

  // ── 更新地图 Marker + 轨迹 ──
  const updateMarker = useCallback((uid: string, loc: ParticipantLocation) => {
    if (!mapRef.current) return;
    const TMap = (window as any).TMap;
    const color = getUserColor(uid);
    const pos = new TMap.LatLng(loc.lat, loc.lng);
    const label = uid === CURRENT_USER.id ? '我' : loc.nickname;
    const svgSrc = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44"><circle cx="18" cy="18" r="15" fill="${color}" stroke="white" stroke-width="3"/><text x="18" y="23" text-anchor="middle" fill="white" font-size="12" font-family="sans-serif" font-weight="bold">${label.charAt(0)}</text><polygon points="13,30 23,30 18,42" fill="${color}"/></svg>`
    )}`;
    if (!markersRef.current.has(uid)) {
      const marker = new TMap.MultiMarker({
        map: mapRef.current,
        styles: { dot: new TMap.MarkerStyle({ width: 36, height: 44, anchor: { x: 18, y: 42 }, src: svgSrc }) },
        geometries: [{ id: `m_${uid}`, styleId: 'dot', position: pos }],
      });
      markersRef.current.set(uid, marker);
    } else {
      markersRef.current.get(uid)!.updateGeometries([{ id: `m_${uid}`, styleId: 'dot', position: pos }]);
    }
    if (loc.trail.length >= 2) {
      const path = loc.trail.map(p => new TMap.LatLng(p.lat, p.lng));
      if (!polylinesRef.current.has(uid)) {
        const pl = new TMap.MultiPolyline({
          map: mapRef.current,
          styles: { trail: new TMap.PolylineStyle({ color: color + '99', width: 3, borderWidth: 1, borderColor: '#FFFFFF60', lineCap: 'round' }) },
          geometries: [{ id: `t_${uid}`, styleId: 'trail', paths: path }],
        });
        polylinesRef.current.set(uid, pl);
      } else {
        polylinesRef.current.get(uid)!.updateGeometries([{ id: `t_${uid}`, styleId: 'trail', paths: path }]);
      }
    }
  }, []);

  // ── 初始化地图 ──
  const initMap = useCallback(async (lat: number, lng: number) => {
    if (!mapContRef.current || mapRef.current) return;
    try {
      const resp = await fetch('/api/txmap-config');
      const cfg = await resp.json();
      if (!cfg.enabled || !cfg.key) {
        setErrorMsg('管理员尚未配置腾讯地图 API Key，请前往管理员后台 → 腾讯位置服务 中填写。');
        setPhase('error');
        return;
      }
      await loadTMap(cfg.key);
      const TMap = (window as any).TMap;
      mapRef.current = new TMap.Map(mapContRef.current, {
        center: new TMap.LatLng(lat, lng), zoom: 16, pitch: 0, rotation: 0,
      });
      setMapReady(true);
    } catch (e: any) {
      setErrorMsg(e.message || '地图加载失败');
      setPhase('error');
    }
  }, []);

  // ── WebSocket 连接 ──
  const connectWs = useCallback((sid: string, endAt: number) => {
    endTimeRef.current = endAt;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/signal`);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join_location_share', shareId: sid, userId: CURRENT_USER.id, nickname: CURRENT_USER.name }));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'location_update') {
          setParticipants(prev => {
            const next = new Map(prev);
            const ex = next.get(msg.userId);
            const trail = ex ? [...ex.trail, { lat: msg.lat, lng: msg.lng }].slice(-50) : [{ lat: msg.lat, lng: msg.lng }];
            const upd: ParticipantLocation = { userId: msg.userId, nickname: msg.nickname || msg.userId, lat: msg.lat, lng: msg.lng, timestamp: msg.timestamp || Date.now(), trail };
            next.set(msg.userId, upd);
            updateMarker(msg.userId, upd);
            return next;
          });
        } else if (msg.type === 'location_share_ended') {
          setPhase('ended');
          cleanup();
        }
      } catch {
        // ignore malformed ws payload
      }
    };
    timerRef.current = setInterval(() => {
      const rem = endTimeRef.current - Date.now();
      if (rem <= 0) {
        setPhase('ended');
        cleanup();
      } else {
        setRemaining(rem);
      }
    }, 1000);
  }, [cleanup, updateMarker]);

  // ── 开始连续定位 ──
  const startLocating = useCallback((sid: string) => {
    if (!navigator.geolocation) {
      setErrorMsg('浏览器不支持 GPS 定位');
      setPhase('error');
      return;
    }

    const send = (lat: number, lng: number) => {
      setMyLoc({ lat, lng });
      myTrailRef.current = [...myTrailRef.current, { lat, lng }].slice(-50);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'location_update', shareId: sid, userId: CURRENT_USER.id, nickname: CURRENT_USER.name, lat, lng, timestamp: Date.now() }));
      }
      const self: ParticipantLocation = { userId: CURRENT_USER.id, nickname: '我', lat, lng, timestamp: Date.now(), trail: myTrailRef.current };
      updateMarker(CURRENT_USER.id, self);
      if (mapRef.current && myTrailRef.current.length === 1) {
        const TMap = (window as any).TMap;
        mapRef.current.setCenter(new TMap.LatLng(lat, lng));
      }
    };

    const onWatchError = (err: GeolocationPositionError) => {
      if (err.code === 1) {
        setPermissionDenied(true);
      }
    };

    watchRef.current = navigator.geolocation.watchPosition(
      p => send(p.coords.latitude, p.coords.longitude),
      onWatchError,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    locIntervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        p => send(p.coords.latitude, p.coords.longitude),
        onWatchError,
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
      );
    }, 5000);
  }, [updateMarker]);

  const beginSharingSession = useCallback(async ({ shareId: sid, endAt, mode }: ShareStartOptions) => {
    cleanup();
    setLastAction(mode);
    setPermissionDenied(false);
    setErrorMsg('');
    setParticipants(new Map());
    setMyLoc(null);
    myTrailRef.current = [];
    setRemaining(Math.max(0, endAt - Date.now()));
    setPhase('loading');

    try {
      const pos = await getCurrentLocation({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });
      await initMap(pos.lat, pos.lng);
      setShareId(sid);
      setPhase('sharing');
      connectWs(sid, endAt);
      startLocating(sid);
    } catch (error) {
      handleLocationFailure(error);
    }
  }, [cleanup, connectWs, handleLocationFailure, initMap, startLocating]);

  // ── 发起共享 ──
  const startSharing = useCallback(() => {
    const sid = `share_${chatId}_${Date.now()}`;
    const endAt = Date.now() + duration * 60 * 1000;
    void beginSharingSession({ shareId: sid, endAt, mode: 'start' });
  }, [beginSharingSession, chatId, duration]);

  // ── 加入已有共享 ──
  const joinSharing = useCallback(() => {
    if (!initShareId) return;
    void beginSharingSession({
      shareId: initShareId,
      endAt: Date.now() + 60 * 60 * 1000,
      mode: 'join',
    });
  }, [beginSharingSession, initShareId]);

  const retryCurrentAction = useCallback(() => {
    if (lastAction === 'join' && initShareId) {
      joinSharing();
      return;
    }
    startSharing();
  }, [initShareId, joinSharing, lastAction, startSharing]);

  const stopSharing = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop_location_share', shareId, userId: CURRENT_USER.id }));
    }
    cleanup();
    setPhase('ended');
  }, [shareId, cleanup]);

  const centerOnMe = useCallback(() => {
    if (!mapRef.current || !myLoc) return;
    const TMap = (window as any).TMap;
    mapRef.current.setCenter(new TMap.LatLng(myLoc.lat, myLoc.lng));
  }, [myLoc]);

  const pList = Array.from(participants.values());

  return (
    <div className="fixed inset-0 bg-[#1a1a2e] flex flex-col z-50">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#16213e]/90 backdrop-blur-sm border-b border-white/10">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
          <ArrowLeft size={20} className="text-white" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">实时位置共享</p>
          <p className="text-white/50 text-xs truncate">{chatName}</p>
        </div>
        {phase === 'sharing' && (
          <div className="flex items-center gap-1.5 bg-green-500/20 border border-green-500/40 rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-xs font-medium">共享中</span>
          </div>
        )}
      </div>

      {/* 发起共享 */}
      {phase === 'select' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
            <MapPin size={36} className="text-green-400" />
          </div>
          <div className="text-center">
            <h2 className="text-white text-xl font-bold mb-1">发起实时位置共享</h2>
            <p className="text-white/50 text-sm">对方可以在地图上看到你的实时位置</p>
          </div>
          <div className="w-full max-w-xs">
            <p className="text-white/70 text-sm mb-3 text-center">共享时长</p>
            <div className="grid grid-cols-3 gap-2">
              {[15, 30, 60].map(m => (
                <button
                  key={m}
                  onClick={() => setDuration(m)}
                  className={`py-3 rounded-xl text-sm font-medium transition-all ${duration === m ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                >
                  {m < 60 ? `${m} 分钟` : '1 小时'}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={startSharing}
            className="w-full max-w-xs py-3.5 bg-green-500 hover:bg-green-400 active:bg-green-600 text-white rounded-2xl font-semibold text-base transition-colors shadow-lg shadow-green-500/30"
          >
            开始共享位置
          </button>
          <p className="text-white/30 text-xs text-center">需要位置权限，请在系统弹窗中点击「允许」</p>
        </div>
      )}

      {/* 加入共享：改为用户点击后再申请权限，兼容 iPhone Safari */}
      {phase === 'join_ready' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center">
            <Navigation size={36} className="text-blue-400" />
          </div>
          <div className="text-center">
            <h2 className="text-white text-xl font-bold mb-1">加入实时位置共享</h2>
            <p className="text-white/50 text-sm leading-relaxed">为了在地图上显示你的实时位置，需要先获取当前位置权限。</p>
          </div>
          <button
            onClick={joinSharing}
            className="w-full max-w-xs py-3.5 bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-white rounded-2xl font-semibold text-base transition-colors shadow-lg shadow-blue-500/30"
          >
            允许定位并加入
          </button>
          <p className="text-white/30 text-xs text-center">iPhone Safari 请在弹窗中选择「允许」，若之前拒绝过可在网页设置里重新开启。</p>
        </div>
      )}

      {/* 加载中 */}
      {phase === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 size={40} className="text-green-400 animate-spin" />
          <p className="text-white/70 text-sm">正在获取位置并加载地图...</p>
        </div>
      )}

      {/* 错误 */}
      {phase === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertCircle size={28} className="text-red-400" />
          </div>
          <p className="text-white font-semibold text-center">出现错误</p>
          <p className="text-white/50 text-sm text-center leading-relaxed">{errorMsg}</p>

          {permissionDenied && (
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-white/80 text-sm font-medium mb-1">iPhone / Safari 可这样开启权限</p>
              <p className="text-white/50 text-xs leading-6">
                点击地址栏左侧的页面设置按钮，进入“网站设置”，把“位置”改成“允许”，然后返回本页重新尝试。
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={retryCurrentAction}
              className="px-6 py-2.5 bg-green-500 hover:bg-green-400 text-white rounded-xl text-sm font-medium transition-colors"
            >
              {lastAction === 'join' ? '重新加入' : '重试'}
            </button>
            <button
              onClick={onBack}
              className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm transition-colors"
            >
              返回
            </button>
          </div>
        </div>
      )}

      {/* 已结束 */}
      {phase === 'ended' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-16 h-16 rounded-full bg-slate-500/20 flex items-center justify-center">
            <MapPin size={28} className="text-slate-400" />
          </div>
          <p className="text-white font-semibold">位置共享已结束</p>
          <p className="text-white/50 text-sm">共享时间到期或已被停止</p>
          <button onClick={onBack} className="px-6 py-2.5 bg-green-500 hover:bg-green-400 text-white rounded-xl text-sm font-medium transition-colors">返回聊天</button>
        </div>
      )}

      {/* 共享中：地图 + 底部面板 */}
      {phase === 'sharing' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative">
            <div ref={mapContRef} className="absolute inset-0" />
            {!mapReady && (
              <div className="absolute inset-0 bg-[#1a1a2e] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 size={32} className="text-green-400 animate-spin" />
                  <p className="text-white/60 text-sm">地图加载中...</p>
                </div>
              </div>
            )}
            <button
              onClick={centerOnMe}
              className="absolute right-3 bottom-3 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
            >
              <Navigation size={18} className="text-blue-500" />
            </button>
          </div>

          <div className="bg-[#16213e] border-t border-white/10 px-4 pt-3 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-green-400" />
                <span className="text-white/70 text-sm">
                  剩余 <span className="text-green-400 font-mono font-semibold">{fmtTime(remaining)}</span>
                </span>
              </div>
              <button
                onClick={stopSharing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 rounded-lg text-xs font-medium transition-colors"
              >
                <Square size={12} />
                停止共享
              </button>
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              <Users size={13} className="text-white/40" />
              <span className="text-white/40 text-xs">{pList.length} 人在共享</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pList.length === 0 ? (
                <div className="flex items-center gap-2 text-white/30 text-xs py-1">
                  <RefreshCw size={12} className="animate-spin" />
                  等待其他人加入...
                </div>
              ) : pList.map(p => {
                const dist = myLoc ? calcDist(myLoc.lat, myLoc.lng, p.lat, p.lng) : null;
                const color = getUserColor(p.userId);
                return (
                  <div key={p.userId} className="flex-shrink-0 flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/10">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: color }}>
                      {(p.userId === CURRENT_USER.id ? '我' : p.nickname).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white text-xs font-medium leading-none mb-0.5">{p.userId === CURRENT_USER.id ? '我' : p.nickname}</p>
                      {dist !== null && p.userId !== CURRENT_USER.id && (
                        <p className="text-white/40 text-xs leading-none">{fmtDist(dist)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
