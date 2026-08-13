/**
 * DoveIM useWebRTC Hook
 * 封装真实 WebRTC 逻辑：RTCPeerConnection、getUserMedia、ICE 协商、多人 Mesh
 */
import { useEffect, useRef, useCallback, useState } from "react";

// ============ 类型定义 ============

export interface RemotePeer {
  peerId: string;
  peerName: string;
  stream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
}

export interface UseWebRTCOptions {
  userId: string;
  roomId: string;
  callType: "audio" | "video";
  onPeerJoined?: (peerId: string) => void;
  onPeerLeft?: (peerId: string) => void;
  onCallEnded?: () => void;
  onIncomingCall?: (from: string, callType: "audio" | "video", roomId: string) => void;
  onCallAccepted?: (peerId: string) => void;
  onCallRejected?: (peerId: string) => void;
}

export interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remotePeers: RemotePeer[];
  isConnected: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaker: boolean;
  isScreenSharing: boolean;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleSpeaker: () => void;
  toggleScreenShare: () => Promise<void>;
  startCall: (targetUserId: string, targetName: string, callType: "audio" | "video") => void;
  acceptCall: () => void;
  endCall: () => void;
  joinRoom: () => void;
  leaveRoom: () => void;
  signalReady: boolean;
}

// ============ STUN/TURN 配置 ============

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// ============ Hook 实现 ============

export function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn {
  const { userId, roomId, callType, onPeerJoined, onPeerLeft, onCallEnded, onIncomingCall, onCallAccepted, onCallRejected } = options;

  // WebSocket 信令连接
  const wsRef = useRef<WebSocket | null>(null);
  const [signalReady, setSignalReady] = useState(false);

  // 本地媒体流
  const localStreamRef = useRef<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // 远端 Peer 连接管理（peerId -> RTCPeerConnection）
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const remotePeerNamesRef = useRef<Map<string, string>>(new Map());

  // 通话状态
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // 待处理的 ICE candidates（在 remoteDescription 设置之前缓存）
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // ============ 信令发送 ============

  const sendSignal = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // ============ 创建 PeerConnection ============

  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // 添加本地媒体轨道
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // ICE candidate 事件
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          type: "ice",
          from: userId,
          to: peerId,
          payload: event.candidate,
        });
      }
    };

    // 连接状态变化
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] ${peerId} 连接状态: ${pc.connectionState}`);
      if (pc.connectionState === "connected") {
        setIsConnected(true);
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        removePeer(peerId);
      }
    };

    // 接收远端媒体流
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      setRemotePeers((prev) => {
        const existing = prev.find((p) => p.peerId === peerId);
        if (existing) {
          return prev.map((p) => p.peerId === peerId ? { ...p, stream } : p);
        }
        return [...prev, {
          peerId,
          peerName: remotePeerNamesRef.current.get(peerId) || peerId,
          stream,
          isMuted: false,
          isVideoOff: false,
        }];
      });
    };

    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  }, [userId, sendSignal]);

  // ============ 移除 Peer ============

  const removePeer = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    setRemotePeers((prev) => prev.filter((p) => p.peerId !== peerId));
    onPeerLeft?.(peerId);

    if (peerConnectionsRef.current.size === 0) {
      setIsConnected(false);
    }
  }, [onPeerLeft]);

  // ============ 处理来自信令服务器的消息 ============

  const handleSignalMessage = useCallback(async (data: string) => {
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }

    console.log(`[Signal] 收到: ${msg.type} from=${msg.from}`);

    switch (msg.type) {
      case "room_info": {
        const { event, members, peerId: joinedPeerId } = msg.payload;

        if (event === "joined") {
          // 我加入了房间，向已有成员发起 Offer
          for (const memberId of members) {
            if (memberId === userId) continue;
            const pc = createPeerConnection(memberId);
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              sendSignal({ type: "offer", from: userId, to: memberId, payload: offer });
            } catch (e) {
              console.error("[WebRTC] createOffer 失败:", e);
            }
          }
        } else if (event === "peer_joined") {
          // 新成员加入，等待对方的 Offer
          setRemotePeers((prev) => {
            if (prev.find((p) => p.peerId === joinedPeerId)) return prev;
            return [...prev, {
              peerId: joinedPeerId,
              peerName: remotePeerNamesRef.current.get(joinedPeerId) || joinedPeerId,
              stream: null,
              isMuted: false,
              isVideoOff: false,
            }];
          });
          onPeerJoined?.(joinedPeerId);
        } else if (event === "peer_left") {
          removePeer(joinedPeerId);
        }
        break;
      }

      case "offer": {
        const { from, payload: offer } = msg;
        let pc = peerConnectionsRef.current.get(from);
        if (!pc) pc = createPeerConnection(from);

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));

          // 应用缓存的 ICE candidates
          const pending = pendingCandidatesRef.current.get(from) || [];
          for (const c of pending) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          }
          pendingCandidatesRef.current.delete(from);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: "answer", from: userId, to: from, payload: answer });
        } catch (e) {
          console.error("[WebRTC] 处理 Offer 失败:", e);
        }
        break;
      }

      case "answer": {
        const { from, payload: answer } = msg;
        const pc = peerConnectionsRef.current.get(from);
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            // 应用缓存的 ICE candidates
            const pending = pendingCandidatesRef.current.get(from) || [];
            for (const c of pending) {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            }
            pendingCandidatesRef.current.delete(from);
          } catch (e) {
            console.error("[WebRTC] 处理 Answer 失败:", e);
          }
        }
        break;
      }

      case "ice": {
        const { from, payload: candidate } = msg;
        const pc = peerConnectionsRef.current.get(from);
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error("[WebRTC] 添加 ICE candidate 失败:", e);
          }
        } else {
          // 缓存，等 remoteDescription 设置后再添加
          const pending = pendingCandidatesRef.current.get(from) || [];
          pending.push(candidate);
          pendingCandidatesRef.current.set(from, pending);
        }
        break;
      }

      case "call_invite": {
        const { from, payload } = msg;
        onIncomingCall?.(from, payload?.callType || "audio", payload?.roomId || roomId);
        break;
      }

      case "call_accept": {
        onCallAccepted?.(msg.from);
        break;
      }

      case "call_reject": {
        onCallRejected?.(msg.from);
        break;
      }

      case "call_end": {
        removePeer(msg.from);
        onCallEnded?.();
        break;
      }
    }
  }, [userId, roomId, createPeerConnection, removePeer, sendSignal, onPeerJoined, onCallEnded, onIncomingCall, onCallAccepted, onCallRejected]);

  // ============ 连接信令服务器 ============

  const connectSignal = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/signal?userId=${encodeURIComponent(userId)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[Signal] 已连接");
      setSignalReady(true);
    };

    ws.onmessage = (event) => {
      handleSignalMessage(event.data);
    };

    ws.onclose = () => {
      console.log("[Signal] 连接断开");
      setSignalReady(false);
    };

    ws.onerror = (err) => {
      console.error("[Signal] 连接错误:", err);
      setSignalReady(false);
    };
  }, [userId, handleSignalMessage]);

  // ============ 获取本地媒体流 ============

  const getLocalStream = useCallback(async (type: "audio" | "video"): Promise<MediaStream | null> => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: type === "video" ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        } : false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (e) {
      console.error("[WebRTC] 获取媒体流失败:", e);
      // 降级：只获取音频
      if (type === "video") {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = audioStream;
          setLocalStream(audioStream);
          setIsVideoOff(true);
          return audioStream;
        } catch (e2) {
          console.error("[WebRTC] 获取音频流也失败:", e2);
        }
      }
      return null;
    }
  }, []);

  // ============ 加入房间 ============

  const joinRoom = useCallback(() => {
    sendSignal({ type: "join", from: userId, roomId });
  }, [userId, roomId, sendSignal]);

  // ============ 离开房间 ============

  const leaveRoom = useCallback(() => {
    sendSignal({ type: "leave", from: userId, roomId });
    // 关闭所有 PeerConnection
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    setRemotePeers([]);
    setIsConnected(false);
  }, [userId, roomId, sendSignal]);

  // ============ 发起通话 ============

  const startCall = useCallback(async (targetUserId: string, targetName: string, type: "audio" | "video") => {
    remotePeerNamesRef.current.set(targetUserId, targetName);
    await getLocalStream(type);
    connectSignal();
    // 等待信令连接后发送邀请
    setTimeout(() => {
      sendSignal({
        type: "call_invite",
        from: userId,
        to: targetUserId,
        payload: { callType: type, roomId },
      });
    }, 500);
  }, [userId, roomId, getLocalStream, connectSignal, sendSignal]);

  // ============ 接受通话 ============

  const acceptCall = useCallback(async () => {
    await getLocalStream(callType);
    if (!signalReady) connectSignal();
    setTimeout(() => {
      joinRoom();
    }, 300);
  }, [callType, getLocalStream, connectSignal, signalReady, joinRoom]);

  // ============ 结束通话 ============

  const endCall = useCallback(() => {
    // 通知所有 peer
    peerConnectionsRef.current.forEach((_, peerId) => {
      sendSignal({ type: "call_end", from: userId, to: peerId });
    });
    leaveRoom();
    // 停止本地媒体流
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setIsScreenSharing(false);
    // 关闭信令连接
    wsRef.current?.close();
    wsRef.current = null;
    setSignalReady(false);
    onCallEnded?.();
  }, [userId, leaveRoom, sendSignal, onCallEnded]);

  // ============ 媒体控制 ============

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((prev) => !prev);
  }, []);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsVideoOff((prev) => !prev);
  }, []);

  const toggleSpeaker = useCallback(() => {
    setIsSpeaker((prev) => !prev);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // 停止屏幕共享，恢复摄像头
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);

      // 恢复摄像头轨道
      if (localStreamRef.current) {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = cameraStream.getVideoTracks()[0];
        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          sender?.replaceTrack(videoTrack);
        });
        // 替换本地流中的视频轨道
        localStreamRef.current.getVideoTracks().forEach((t) => {
          localStreamRef.current!.removeTrack(t);
          t.stop();
        });
        localStreamRef.current.addTrack(videoTrack);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      }
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        // 替换所有 PeerConnection 的视频轨道
        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          sender?.replaceTrack(screenTrack);
        });

        // 更新本地预览
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => {
            localStreamRef.current!.removeTrack(t);
          });
          localStreamRef.current.addTrack(screenTrack);
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }

        setIsScreenSharing(true);

        // 屏幕共享停止时自动恢复
        screenTrack.onended = () => {
          setIsScreenSharing(false);
          screenStreamRef.current = null;
        };
      } catch (e) {
        console.error("[WebRTC] 屏幕共享失败:", e);
      }
    }
  }, [isScreenSharing]);

  // ============ 清理 ============

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      peerConnectionsRef.current.forEach((pc) => pc.close());
      wsRef.current?.close();
    };
  }, []);

  return {
    localStream,
    remotePeers,
    isConnected,
    isMuted,
    isVideoOff,
    isSpeaker,
    isScreenSharing,
    toggleMute,
    toggleVideo,
    toggleSpeaker,
    toggleScreenShare,
    startCall,
    acceptCall,
    endCall,
    joinRoom,
    leaveRoom,
    signalReady,
  };
}
