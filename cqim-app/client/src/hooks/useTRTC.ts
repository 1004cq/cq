/**
 * DoveIM useTRTC Hook
 * 使用腾讯云 TRTC SDK v5 实现音视频通话
 *
 * v8 - 2026-04-12 全面修复版:
 * 1. 移除 getUserMedia 预请求（会导致设备被占用，TRTC 再采集时失败）
 * 2. enableAutoPlayDialog: true — 让 SDK 自己处理自动播放限制（最可靠）
 * 3. startLocalVideo/startRemoteVideo 直接传 div 容器（标准方案）
 * 4. 竞态处理：REMOTE_VIDEO_AVAILABLE 事件时，若容器未就绪则暂存
 * 5. 移除所有 getVideoTrack() + srcObject 手动绑定逻辑
 */
import { useEffect, useRef, useCallback, useState } from "react";
import TRTC from "trtc-sdk-v5";
import { authApi } from "@/lib/authFetch";
import { getCallEnvironmentIssue } from "@/lib/callCompat";

// ============ 类型定义 ============

export interface RemotePeer {
  peerId: string;
  peerName: string;
  hasVideo: boolean;
  hasAudio: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
}

export interface UseTRTCOptions {
  userId: string;
  roomId: string;
  callType: "audio" | "video";
  onPeerJoined?: (peerId: string) => void;
  onPeerLeft?: (peerId: string) => void;
  onCallEnded?: () => void;
}

export interface UseTRTCReturn {
  remotePeers: RemotePeer[];
  isConnected: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaker: boolean;
  isScreenSharing: boolean;
  /** 当前是否使用前置摄像头 */
  isFrontCamera: boolean;
  localVideoReady: boolean;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleSpeaker: () => void;
  toggleScreenShare: () => Promise<void>;
  /** 切换前/后摄像头（移动端） */
  toggleCamera: () => Promise<void>;
  endCall: () => void;
  joinRoom: () => void;
  leaveRoom: () => void;
  signalReady: boolean;
  /** CallScreen 传入本地视频容器 div */
  setLocalVideoContainer: (el: HTMLDivElement | null) => void;
  /** CallScreen 传入远端视频容器 div（按 peerId） */
  setRemoteVideoContainer: (peerId: string, el: HTMLDivElement | null) => void;
}

// ============ 工具函数 ============

function sanitizeRoomId(roomId: string): string {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

// ============ Hook 实现 ============

export function useTRTC(options: UseTRTCOptions): UseTRTCReturn {
  const { userId, roomId, callType, onPeerJoined, onPeerLeft, onCallEnded } = options;
  const safeRoomId = sanitizeRoomId(roomId);

  const trtcRef = useRef<InstanceType<typeof TRTC> | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const remotePeerNamesRef = useRef<Map<string, string>>(new Map());

  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [signalReady, setSignalReady] = useState(false);
  const [localVideoReady, setLocalVideoReady] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);

  const isJoinedRef = useRef(false);
  const isJoiningRef = useRef(false);

  // ★ 视频容器 div 的 ref（由 CallScreen 传入）
  const localContainerRef = useRef<HTMLDivElement | null>(null);
  const remoteContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // ★ 待渲染的远端视频（DOM 还没就绪时暂存）
  const pendingRemoteVideosRef = useRef<Map<string, { streamType: any }>>(new Map());

  // ============ 渲染远端视频到容器 ============

  const renderRemoteVideo = useCallback(async (
    trtc: InstanceType<typeof TRTC>,
    remoteUserId: string,
    streamType: any
  ) => {
    const container = remoteContainersRef.current.get(remoteUserId);
    if (!container) {
      console.log("[TRTC] 远端容器未就绪，暂存:", remoteUserId);
      pendingRemoteVideosRef.current.set(remoteUserId, { streamType });
      return;
    }
    try {
      console.log("[TRTC] startRemoteVideo:", remoteUserId, "view:", container);
      await trtc.startRemoteVideo({
        userId: remoteUserId,
        streamType,
        view: container,
      });
      console.log("[TRTC] ★ 远端视频渲染成功:", remoteUserId);
      setRemotePeers(prev =>
        prev.map(p => p.peerId === remoteUserId ? { ...p, hasVideo: true, isVideoOff: false } : p)
      );
    } catch (e) {
      console.error("[TRTC] startRemoteVideo 失败:", e, remoteUserId);
    }
  }, []);

  // ============ 设置 DOM 容器（由 CallScreen 调用） ============

  const setLocalVideoContainer = useCallback((el: HTMLDivElement | null) => {
    localContainerRef.current = el;
    const trtc = trtcRef.current;
    if (!el || !trtc || !isJoinedRef.current || callType !== 'video') return;
    // 进房后容器才就绪：调用 updateLocalVideo 更新渲染目标
    console.log("[TRTC] ★ 收到本地容器（进房后），更新渲染目标");
    trtc.updateLocalVideo({ view: el }).catch((e: any) => {
      console.warn("[TRTC] updateLocalVideo 失败，尝试 startLocalVideo:", e);
      trtc.startLocalVideo({
        view: el,
        option: { profile: "480p", useFrontCamera: true },
      }).then(() => setLocalVideoReady(true)).catch(console.error);
    });
    setLocalVideoReady(true);
  }, [callType]);

  const setRemoteVideoContainer = useCallback((peerId: string, el: HTMLDivElement | null) => {
    if (!el) {
      remoteContainersRef.current.delete(peerId);
      return;
    }
    remoteContainersRef.current.set(peerId, el);
    const trtc = trtcRef.current;
    if (!trtc) return;
    const pending = pendingRemoteVideosRef.current.get(peerId);
    if (pending) {
      console.log("[TRTC] ★ 收到远端容器，渲染待处理的视频:", peerId);
      pendingRemoteVideosRef.current.delete(peerId);
      renderRemoteVideo(trtc, peerId, pending.streamType);
    }
  }, [renderRemoteVideo]);

  // ============ 获取 UserSig ============

  const getUserSig = useCallback(async () => {
    try {
      return await authApi("/api/trtc/usersig");
    } catch (e) {
      console.error("[TRTC] 获取 UserSig 失败:", e);
      return null;
    }
  }, []);

  // ============ 初始化 TRTC ============

  const initTRTC = useCallback(() => {
    if (trtcRef.current) return trtcRef.current;
    const trtc = TRTC.create();
    trtcRef.current = trtc;

    trtc.on(TRTC.EVENT.REMOTE_USER_ENTER, (event: any) => {
      const remoteUserId = event.userId;
      console.log("[TRTC] 远端用户进房:", remoteUserId);
      setRemotePeers(prev => {
        if (prev.find(p => p.peerId === remoteUserId)) return prev;
        return [...prev, {
          peerId: remoteUserId,
          peerName: remotePeerNamesRef.current.get(remoteUserId) || remoteUserId,
          hasVideo: false, hasAudio: false, isMuted: false, isVideoOff: false,
        }];
      });
      onPeerJoined?.(remoteUserId);
    });

    trtc.on(TRTC.EVENT.REMOTE_USER_EXIT, (event: any) => {
      console.log("[TRTC] 远端用户退房:", event.userId);
      setRemotePeers(prev => prev.filter(p => p.peerId !== event.userId));
      remoteContainersRef.current.delete(event.userId);
      pendingRemoteVideosRef.current.delete(event.userId);
      onPeerLeft?.(event.userId);
    });

    trtc.on(TRTC.EVENT.REMOTE_AUDIO_AVAILABLE, (event: any) => {
      console.log("[TRTC] 远端音频可用:", event.userId);
      setRemotePeers(prev =>
        prev.map(p => p.peerId === event.userId ? { ...p, hasAudio: true, isMuted: false } : p)
      );
      // 确保远端音频不静音
      trtc.muteRemoteAudio(event.userId, false).catch(() => {});
    });

    trtc.on(TRTC.EVENT.REMOTE_AUDIO_UNAVAILABLE, (event: any) => {
      setRemotePeers(prev =>
        prev.map(p => p.peerId === event.userId ? { ...p, hasAudio: false, isMuted: true } : p)
      );
    });

    // ★ 远端视频可用：更新 peer 状态（触发 React 渲染容器），再渲染视频
    trtc.on(TRTC.EVENT.REMOTE_VIDEO_AVAILABLE, async (event: any) => {
      const remoteUserId = event.userId;
      const streamType = event.streamType;
      console.log("[TRTC] 远端视频可用:", remoteUserId, streamType);

      // 先更新 peer 状态，触发 React 渲染容器 div
      setRemotePeers(prev => {
        if (prev.find(p => p.peerId === remoteUserId)) {
          return prev.map(p => p.peerId === remoteUserId ? { ...p, hasVideo: false } : p);
        }
        return [...prev, {
          peerId: remoteUserId,
          peerName: remotePeerNamesRef.current.get(remoteUserId) || remoteUserId,
          hasVideo: false, hasAudio: false, isMuted: false, isVideoOff: false,
        }];
      });

      // 等一个 tick 让 React 渲染容器
      await new Promise(r => setTimeout(r, 50));

      // 渲染远端视频（容器已就绪则立即渲染，否则暂存）
      renderRemoteVideo(trtc, remoteUserId, streamType);
    });

    trtc.on(TRTC.EVENT.REMOTE_VIDEO_UNAVAILABLE, (event: any) => {
      setRemotePeers(prev =>
        prev.map(p => p.peerId === event.userId ? { ...p, hasVideo: false, isVideoOff: true } : p)
      );
    });

    trtc.on(TRTC.EVENT.CONNECTION_STATE_CHANGED, (event: any) => {
      console.log("[TRTC] 连接状态:", event.prevState, "->", event.state);
      if (event.state === "CONNECTED") { setIsConnected(true); setSignalReady(true); }
      else if (event.state === "DISCONNECTED") { setIsConnected(false); setSignalReady(false); }
    });

    // 让 SDK 自己处理自动播放弹窗（enableAutoPlayDialog: true 时 SDK 会自动弹窗）
    trtc.on(TRTC.EVENT.AUTOPLAY_FAILED, (event: any) => {
      console.warn("[TRTC] 自动播放受限，SDK 将显示弹窗:", event);
    });

    return trtc;
  }, [onPeerJoined, onPeerLeft, renderRemoteVideo]);

  // ============ 进入 TRTC 房间 ============

  const enterRoom = useCallback(async (type: "audio" | "video") => {
    if (isJoinedRef.current || isJoiningRef.current) return;
    const envIssue = getCallEnvironmentIssue();
    if (envIssue) {
      console.error("[TRTC] 当前环境不支持通话:", envIssue);
      return;
    }
    isJoiningRef.current = true;

    try {
      const sigData = await getUserSig();
      if (!sigData) { isJoiningRef.current = false; return; }

      const trtc = initTRTC();
      console.log("[TRTC] 进房:", { strRoomId: safeRoomId, userId: sigData.userId });

      // ★ enableAutoPlayDialog: true — 让 SDK 自动处理自动播放限制（移动端最可靠）
      await trtc.enterRoom({
        sdkAppId: sigData.sdkAppId,
        userId: sigData.userId,
        userSig: sigData.userSig,
        strRoomId: safeRoomId,
        scene: TRTC.TYPE.SCENE_RTC,
        enableAutoPlayDialog: true,
      });

      isJoinedRef.current = true;
      isJoiningRef.current = false;
      setSignalReady(true);
      setIsConnected(true);
      console.log("[TRTC] 进房成功");

      // 开启本地音频（TRTC 内部会请求麦克风权限）
      await trtc.startLocalAudio({ option: { profile: "standard" } });
      console.log("[TRTC] 本地音频已开启");

      if (type === "video") {
        await startLocalVideoWithFallback(trtc);
      }
    } catch (e: any) {
      console.error("[TRTC] 进房失败:", e?.message || e);
      isJoiningRef.current = false;
    }
  }, [safeRoomId, getUserSig, initTRTC]);

  // ============ 退出房间 ============

  const exitRoom = useCallback(async () => {
    const trtc = trtcRef.current;
    if (trtc) {
      try {
        await trtc.stopLocalAudio();
        await trtc.stopLocalVideo().catch(() => {});
        await trtc.exitRoom();
        trtc.destroy();
        trtcRef.current = null;
      } catch (e) { console.error("[TRTC] 退房失败:", e); }
    }
    isJoinedRef.current = false;
    isJoiningRef.current = false;
    setIsConnected(false);
    setSignalReady(false);
    setRemotePeers([]);
    setLocalVideoReady(false);
    localContainerRef.current = null;
    remoteContainersRef.current.clear();
    pendingRemoteVideosRef.current.clear();
  }, []);

  // ============ 公开接口 ============

  const joinRoom = useCallback(() => enterRoom(callType), [enterRoom, callType]);
  const leaveRoom = useCallback(() => exitRoom(), [exitRoom]);
  const endCall = useCallback(() => { exitRoom(); onCallEnded?.(); }, [exitRoom, onCallEnded]);

  const toggleMute = useCallback(() => {
    const trtc = trtcRef.current;
    if (trtc && isJoinedRef.current) {
      isMuted ? trtc.startLocalAudio({ option: { profile: "standard" } }) : trtc.stopLocalAudio();
    }
    setIsMuted(prev => !prev);
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const trtc = trtcRef.current;
    if (trtc && isJoinedRef.current) {
      if (isVideoOff) {
        const container = localContainerRef.current;
        trtc.startLocalVideo({
          view: container || undefined,
          option: { profile: "480p", useFrontCamera: true },
        }).then(() => {
          if (container) setLocalVideoReady(true);
        }).catch(console.error);
      } else {
        trtc.stopLocalVideo().catch(() => {});
        setLocalVideoReady(false);
      }
    }
    setIsVideoOff(prev => !prev);
  }, [isVideoOff]);

  const toggleSpeaker = useCallback(() => setIsSpeaker(prev => !prev), []);

  // ============ 开启本地视频（多层回退）============

  const startLocalVideoWithFallback = useCallback(async (trtc: InstanceType<typeof TRTC>) => {
    const container = localContainerRef.current;
    const baseOpts = { view: container || undefined };

    // 方案1：480p 前置摄像头
    try {
      await trtc.startLocalVideo({
        ...baseOpts,
        option: { profile: '480p', useFrontCamera: true },
      });
      console.log('[TRTC] ★ 本地视频已开启 (480p 前置)');
      if (container) setLocalVideoReady(true);
      return;
    } catch (e: any) {
      console.warn('[TRTC] 480p 前置失败，尝试降级:', e?.message);
    }

    // 方案2：360p 前置（部分低端设备不支持 480p）
    try {
      await trtc.startLocalVideo({
        ...baseOpts,
        option: { profile: '360p', useFrontCamera: true },
      });
      console.log('[TRTC] ★ 本地视频已开启 (360p 前置)');
      if (container) setLocalVideoReady(true);
      return;
    } catch (e: any) {
      console.warn('[TRTC] 360p 前置失败，尝试不指定摄像头:', e?.message);
    }

    // 方案3：不指定 useFrontCamera（让系统自动选择）
    try {
      await trtc.startLocalVideo({ ...baseOpts });
      console.log('[TRTC] ★ 本地视频已开启 (默认摄像头)');
      if (container) setLocalVideoReady(true);
      return;
    } catch (e: any) {
      console.warn('[TRTC] 默认摄像头失败，不开启视频继续通话:', e?.message);
      // 视频失败不影响音频通话，继续进行
    }
  }, []);

  // ============ 切换前/后摄像头 ============

  const toggleCamera = useCallback(async () => {
    const trtc = trtcRef.current;
    if (!trtc || !isJoinedRef.current) return;
    const nextFront = !isFrontCamera;

    // 方案1：updateLocalVideo（推荐，不中断推流）
    try {
      console.log('[TRTC] 切换摄像头 ->', nextFront ? '前置' : '后置');
      await trtc.updateLocalVideo({ option: { useFrontCamera: nextFront } });
      setIsFrontCamera(nextFront);
      console.log('[TRTC] ★ 摄像头切换成功 (updateLocalVideo)');
      return;
    } catch (e: any) {
      console.warn('[TRTC] updateLocalVideo 切换失败，尝试 stop+start:', e?.message);
    }

    // 方案2：stop 再 start（部分设备 updateLocalVideo 不支持 useFrontCamera）
    try {
      await trtc.stopLocalVideo();
      setLocalVideoReady(false);
      const container = localContainerRef.current;
      await trtc.startLocalVideo({
        view: container || undefined,
        option: { profile: '480p', useFrontCamera: nextFront },
      });
      setIsFrontCamera(nextFront);
      if (container) setLocalVideoReady(true);
      console.log('[TRTC] ★ 摄像头切换成功 (stop+start)');
      return;
    } catch (e: any) {
      console.warn('[TRTC] stop+start 切换失败，尝试 deviceId 枚举:', e?.message);
    }

    // 方案3：通过 getCameraList 枚举设备 ID 切换（华为等设备兼容）
    try {
      const cameraList = await TRTC.getCameraList();
      console.log('[TRTC] 摄像头列表:', cameraList.map((c: any) => c.label));
      // 找到前置/后置摄像头
      const target = cameraList.find((c: any) => {
        const label = (c.label || '').toLowerCase();
        return nextFront
          ? (label.includes('front') || label.includes('前') || label.includes('user') || label.includes('面'))
          : (label.includes('back') || label.includes('后') || label.includes('rear') || label.includes('environment'));
      }) || cameraList[nextFront ? 0 : cameraList.length - 1];

      if (target) {
        await trtc.stopLocalVideo();
        setLocalVideoReady(false);
        const container = localContainerRef.current;
        await trtc.startLocalVideo({
          view: container || undefined,
          option: { cameraId: target.deviceId },
        });
        setIsFrontCamera(nextFront);
        if (container) setLocalVideoReady(true);
        console.log('[TRTC] ★ 摄像头切换成功 (deviceId:', target.label, ')');
      }
    } catch (e: any) {
      console.error('[TRTC] 所有摄像头切换方案均失败:', e?.message);
    }
  }, [isFrontCamera]);

  const toggleScreenShare = useCallback(async () => {
    const trtc = trtcRef.current;
    if (!trtc) return;
    if (isScreenSharing) {
      await trtc.stopScreenShare();
      setIsScreenSharing(false);
    } else {
      try { await trtc.startScreenShare(); setIsScreenSharing(true); }
      catch (e) { console.error("[TRTC] 屏幕共享失败:", e); }
    }
  }, [isScreenSharing]);

  // ============ 清理 ============

  useEffect(() => {
    return () => {
      const trtc = trtcRef.current;
      if (trtc) {
        trtc.stopLocalAudio().catch(() => {});
        trtc.stopLocalVideo().catch(() => {});
        trtc.exitRoom().catch(() => {});
        trtc.destroy();
        trtcRef.current = null;
      }
    };
  }, []);

  return {
    remotePeers, isConnected, isMuted, isVideoOff, isSpeaker, isScreenSharing,
    isFrontCamera, localVideoReady, toggleMute, toggleVideo, toggleSpeaker,
    toggleScreenShare, toggleCamera,
    endCall, joinRoom, leaveRoom, signalReady,
    setLocalVideoContainer, setRemoteVideoContainer,
  };
}
