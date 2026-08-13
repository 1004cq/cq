/**
 * DoveIM 音视频通话界面（响应式版本 v2）
 * 1v1 音频通话：微信风格 - 深色背景、头像居上（未接通时）、底部白色圆形按钮+红色挂断
 * 接通后：隐藏头像，仅显示计时和控制按钮
 * 手机（<768px）：全屏覆盖
 * 平板（768~1199px）：居中弹窗卡片
 * 电脑（>=1200px）：右侧固定面板
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { DoveAvatar } from '@/components/DoveAvatar';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PhoneOff, Mic, MicOff, Volume2, VolumeX,
  Video, VideoOff, Monitor, MonitorOff, Minimize2, Maximize2,
  Users, RotateCcw, Phone, Lock
} from 'lucide-react';
import { useTRTC } from '@/hooks/useTRTC';
import { CURRENT_USER } from '@/lib/store';
import { prepareCallMedia } from '@/lib/callCompat';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { toast } from 'sonner';

export default function CallScreen() {
  const { state, signalWs } = useApp();
  const { acceptCall: acceptCallState, endCall: endCallState } = useAppActions();
  const { call } = state;
  const breakpoint = useBreakpoint();

  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [callStatus, setCallStatus] = useState<'ringing' | 'connecting' | 'connected' | 'ended'>('connecting');

  const roomId = call.roomId || `room-${[CURRENT_USER.id, call.peerId || ''].sort().join('-')}-${Date.now()}`;

  const [翻转Rotating, set翻转Rotating] = useState(false);

  const {
    remotePeers,
    isConnected,
    isMuted,
    isVideoOff,
    isSpeaker,
    isScreenSharing,
    isFrontCamera,
    localVideoReady,
    toggleMute,
    toggleVideo,
    toggleSpeaker,
    toggleScreenShare,
    toggleCamera,
    endCall: rtcEndCall,
    joinRoom,
    signalReady,
    setLocalVideoContainer,
    setRemoteVideoContainer,
  } = useTRTC({
    userId: CURRENT_USER.id,
    roomId,
    callType: call.callType || 'audio',
    onPeerJoined: (peerId) => console.log('[CallScreen] Peer 加入:', peerId),
    onPeerLeft: (peerId) => console.log('[CallScreen] Peer 离开:', peerId),
    onCallEnded: () => endCallState(),
  });

  // ★ 同步 callStatus
  useEffect(() => {
    if (isConnected && callStatus !== 'connected') setCallStatus('connected');
  }, [isConnected]);

  useEffect(() => {
    if (call.status === 'connected' && callStatus !== 'connected') setCallStatus('connected');
  }, [call.status]);

  // 通话计时器
  useEffect(() => {
    if (isConnected || callStatus === 'connected') {
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isConnected, callStatus]);

  // 发起通话
  const callInitiatedRef = useRef(false);
  useEffect(() => {
    if (!call.isActive) { callInitiatedRef.current = false; return; }
    if (call.status === 'connecting' && !call.isIncoming && !callInitiatedRef.current) {
      callInitiatedRef.current = true;
      setCallStatus('connecting');
      const ws = signalWs?.current;
      if (ws && ws.readyState === WebSocket.OPEN && call.peerId) {
        ws.send(JSON.stringify({
          type: 'call_invite',
          from: CURRENT_USER.id,
          to: call.peerId,
          payload: {
            callType: call.callType || 'audio',
            roomId,
            callerName: CURRENT_USER.name || '未知',
            callerAvatar: CURRENT_USER.avatar || '',
          },
        }));
      }
      joinRoom();
    }
  }, [call.isActive, call.status, call.isIncoming]);

  // 来电超时自动挂断
  useEffect(() => {
    if (call.status === 'ringing' && call.isIncoming) {
      setCallStatus('ringing');
      const t = setTimeout(() => handleEndCall(), 30000);
      return () => clearTimeout(t);
    }
  }, [call.status, call.isIncoming]);

  // 接听
  const handleAcceptCall = useCallback(async () => {
    const prepared = await prepareCallMedia(call.callType || 'audio');
    if (!prepared.ok) {
      toast.error(prepared.message || '无法接听通话，请检查浏览器权限后重试');
      return;
    }
    setCallStatus('connecting');
    acceptCallState();
    joinRoom();
    const ws = signalWs?.current;
    if (ws && ws.readyState === WebSocket.OPEN && call.peerId) {
      ws.send(JSON.stringify({ type: 'call_accept', from: CURRENT_USER.id, to: call.peerId }));
    }
  }, [acceptCallState, joinRoom, signalWs, call.peerId, call.callType]);

  // 挂断
  const handleEndCall = useCallback(() => {
    const ws = signalWs?.current;
    if (ws && ws.readyState === WebSocket.OPEN && call.peerId) {
      const type = (call.isIncoming && call.status === 'ringing') ? 'call_reject' : 'call_end';
      ws.send(JSON.stringify({ type, from: CURRENT_USER.id, to: call.peerId }));
    }
    rtcEndCall();
    endCallState();
  }, [rtcEndCall, endCallState, signalWs, call.peerId, call.isIncoming, call.status]);

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  if (!call.isActive) return null;

  const isRinging = (call.status === 'ringing' && call.isIncoming) || callStatus === 'ringing';
  const isCallConnected = isConnected || callStatus === 'connected' || call.status === 'connected';
  const isConnecting = !isRinging && !isCallConnected;
  const isVideoCall = call.callType === 'video';

  // ============ 最小化悬浮窗（三端通用，位置根据断点调整） ============
  if (isMinimized) {
    // 电脑端：悬浮窗靠右侧面板区域
    const minimizedClass = breakpoint === 'desktop'
      ? "fixed bottom-8 right-8 z-[100] w-36 h-28 rounded-2xl overflow-hidden shadow-2xl cursor-pointer bg-dove-ink/90"
      : breakpoint === 'tablet'
      ? "fixed bottom-8 right-8 z-[100] w-34 h-26 rounded-2xl overflow-hidden shadow-2xl cursor-pointer bg-dove-ink/90"
      : "fixed bottom-24 right-4 z-[100] w-32 h-24 rounded-2xl overflow-hidden shadow-2xl cursor-pointer bg-dove-ink/90";

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={minimizedClass}
        onClick={() => setIsMinimized(false)}
      >
        {isVideoCall ? (
          <div
            ref={(el) => setLocalVideoContainer(el)}
            className="w-full h-full"
            style={{ background: '#000' }}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-dove-green/90 to-dove-ink/95 flex flex-col items-center justify-center gap-1">
            <DoveAvatar name={call.peerName || '?'} id={call.peerId || ''} size="sm" />
            <span className="text-white text-xs">{formatDuration(duration)}</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <Maximize2 size={20} className="text-white/60" />
        </div>
      </motion.div>
    );
  }

  // ============ 视频通话布局 ============
  const renderVideoLayout = () => {
    if (!isVideoCall) return null;
    const hasPeer = remotePeers.length > 0;
    const peer = remotePeers[0];

    // 电脑端：左右分屏（本地左，远端右）
    if (breakpoint === 'desktop' && hasPeer) {
      return (
        <div className="flex-1 relative w-full my-3 min-h-0 flex gap-2">
          {/* 远端视频（主画面） */}
          <div className="flex-1 rounded-xl overflow-hidden bg-dove-ink/80 relative">
            <div
              ref={(el) => setRemoteVideoContainer(peer.peerId, el)}
              className="w-full h-full"
              style={{ background: '#000' }}
            />
            {!peer.hasVideo && (
              <div className="absolute inset-0 flex items-center justify-center bg-dove-ink/80">
                <div className="flex flex-col items-center gap-2">
                  <DoveAvatar name={peer.peerName} id={peer.peerId} size="xl" className="!w-20 !h-20 !text-2xl !rounded-2xl" />
                  <p className="text-white/60 text-xs">视频加载中...</p>
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/50 text-white text-[10px]">{peer.peerName || '对方'}</div>
          </div>
          {/* 本地视频（副画面） */}
          <div className="w-28 rounded-xl overflow-hidden bg-dove-ink/80 relative flex-shrink-0">
            <div
              ref={(el) => setLocalVideoContainer(el)}
              className="w-full h-full"
              style={{ background: '#111' }}
            />
            {!localVideoReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <DoveAvatar name={CURRENT_USER.name} id={CURRENT_USER.id} size="sm" className="!w-10 !h-10 !text-sm !rounded-xl" />
              </div>
            )}
            <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-black/50 text-white text-[9px]">我</div>
          </div>
        </div>
      );
    }

    // 手机/平板：原有 PiP 布局
    return (
      <div className="flex-1 relative w-full my-4 min-h-0">
        <div className="w-full h-full rounded-2xl overflow-hidden bg-dove-ink/80">
          {hasPeer ? (
            <div className="w-full h-full relative">
              <div
                ref={(el) => setRemoteVideoContainer(peer.peerId, el)}
                className="w-full h-full"
                style={{ background: '#000' }}
              />
              {!peer.hasVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-dove-ink/80">
                  <div className="flex flex-col items-center gap-3">
                    <DoveAvatar name={peer.peerName} id={peer.peerId} size="xl" className="!w-24 !h-24 !text-3xl !rounded-2xl" />
                    <p className="text-white/60 text-sm">视频加载中...</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-full relative">
              <div
                ref={(el) => setLocalVideoContainer(el)}
                className="w-full h-full"
                style={{ background: '#000' }}
              />
              {!localVideoReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-dove-ink/80">
                  <div className="flex flex-col items-center gap-3">
                    <DoveAvatar name={CURRENT_USER.name} id={CURRENT_USER.id} size="xl" className="!w-24 !h-24 !text-3xl !rounded-2xl" />
                    <p className="text-white/60 text-sm">摄像头启动中...</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {hasPeer && (
          <div className="absolute bottom-3 right-3 w-24 h-32 rounded-xl overflow-hidden shadow-lg border border-white/20 bg-dove-ink/80">
            <div
              ref={(el) => setLocalVideoContainer(el)}
              className="w-full h-full"
              style={{ background: '#111' }}
            />
            {!localVideoReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <DoveAvatar name={CURRENT_USER.name} id={CURRENT_USER.id} size="sm" className="!w-10 !h-10 !text-sm !rounded-xl" />
              </div>
            )}
            <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-black/50 text-white text-[9px]">我</div>
          </div>
        )}
      </div>
    );
  };

  // ============ 1v1 音频通话主体（微信风格） ============
  const renderAudioCallContent = () => (
    <div className="relative z-10 w-full h-full flex flex-col">
      {/* 顶部操作栏 */}
      <div className="w-full flex items-center justify-between px-5 pt-10">
        <button
          onClick={() => setIsMinimized(true)}
          className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors"
        >
          <Minimize2 size={16} />
        </button>
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/8">
          <Lock size={10} className="text-white/40" />
          <span className="text-[10px] text-white/40">端到端加密</span>
        </div>
        <div className="w-9" />
      </div>

      {/* 中部：未接通时显示头像+名字，接通后隐藏 */}
      <AnimatePresence>
        {!isCallConnected && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center gap-3 mt-16 px-6"
          >
            {/* 头像 */}
            <div className="relative">
              {(isRinging || isConnecting) && (
                <>
                  <motion.div
                    animate={{ scale: [1, 1.7], opacity: [0.25, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity }}
                    className="absolute inset-0 rounded-2xl bg-white/20"
                  />
                  <motion.div
                    animate={{ scale: [1, 1.4], opacity: [0.15, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, delay: 0.6 }}
                    className="absolute inset-0 rounded-2xl bg-white/10"
                  />
                </>
              )}
              <DoveAvatar
                name={call.peerName || '未知'}
                id={call.peerId || 'unknown'}
                avatar={call.peerAvatar || ''}
                size="xl"
                className="!w-20 !h-20 !text-2xl !rounded-2xl"
              />
            </div>
            {/* 名字 */}
            <p className="text-white text-xl font-medium tracking-wide">{call.peerName || '未知'}</p>
            {/* 状态点动画 */}
            <div className="flex items-center gap-1.5 mt-1">
              {[0, 0.3, 0.6].map((delay, i) => (
                <motion.div
                  key={i}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay }}
                  className="w-2 h-2 rounded-full bg-white/60"
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 接通后：居中显示计时 */}
      {isCallConnected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-1 flex flex-col items-center justify-center gap-2"
        >
          <p className="text-white/50 text-sm">{call.peerName || '未知'}</p>
          <p className="text-white text-3xl font-light tracking-widest">{formatDuration(duration)}</p>
        </motion.div>
      )}

      {/* 弹性空间（未接通时撑开底部） */}
      {!isCallConnected && <div className="flex-1" />}

      {/* 底部控制区 */}
      <div className="w-full pb-12 px-6">
        {isRinging && call.isIncoming ? (
          // ===== 来电界面：拒绝 + 接听 =====
          <div className="flex items-end justify-around">
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleEndCall}
                className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-xl active:scale-95 transition-transform"
              >
                <PhoneOff size={26} className="text-white" />
              </button>
              <span className="text-white/60 text-xs">拒绝</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleAcceptCall}
                className="w-16 h-16 rounded-full bg-dove-green flex items-center justify-center shadow-xl active:scale-95 transition-transform"
              >
                <Phone size={26} className="text-white" />
              </button>
              <span className="text-white/60 text-xs">接听</span>
            </div>
          </div>
        ) : (
          // ===== 通话中：白色功能按钮 + 红色挂断 =====
          <>
            {/* 第一行：三个白色功能按钮 */}
            <div className="flex items-center justify-around mb-6">
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={toggleMute}
                  className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                >
                  {isMuted
                    ? <MicOff size={26} className="text-gray-800" />
                    : <Mic size={26} className="text-gray-800" />}
                </button>
                <span className="text-white/70 text-xs">{isMuted ? '麦克风已关' : '麦克风已开'}</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={toggleSpeaker}
                  className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                >
                  {isSpeaker
                    ? <Volume2 size={26} className="text-gray-800" />
                    : <VolumeX size={26} className="text-gray-800" />}
                </button>
                <span className="text-white/70 text-xs">{isSpeaker ? '扬声器已开' : '扬声器已关'}</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={toggleVideo}
                  className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                >
                  {isVideoOff
                    ? <VideoOff size={26} className="text-gray-800" />
                    : <Video size={26} className="text-gray-800" />}
                </button>
                <span className="text-white/70 text-xs">{isVideoOff ? '摄像头已关' : '摄像头已开'}</span>
              </div>
            </div>
            {/* 第二行：左侧占位 + 中间红色挂断 + 右侧翻转 */}
            <div className="flex items-center justify-around">
              <div className="w-14" />
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={handleEndCall}
                  className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-xl active:scale-95 transition-transform"
                >
                  <PhoneOff size={26} className="text-white" />
                </button>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={async () => {
                    set翻转Rotating(true);
                    await toggleCamera();
                    setTimeout(() => set翻转Rotating(false), 400);
                  }}
                  className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <RotateCcw
                    size={22}
                    className={`text-white transition-transform duration-400 ${翻转Rotating ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ============ 视频通话内容主体（三端共用） ============
  const renderCallContent = () => (
    <div className="relative z-10 w-full h-full flex flex-col items-center justify-between py-10 px-6">
      {/* 顶部操作栏 */}
      <div className="w-full flex items-center justify-between">
        <button
          onClick={() => setIsMinimized(true)}
          className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-white/80 hover:bg-white/25 transition-colors"
        >
          <Minimize2 size={16} />
        </button>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10">
          <Lock size={11} className="text-white/60" />
          <span className="text-[10px] text-white/60">端到端加密通话</span>
        </div>
        {remotePeers.length > 0 ? (
          <button
            onClick={() => setShowParticipants(!showParticipants)}
            className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-white/80 relative hover:bg-white/25 transition-colors"
          >
            <Users size={16} />
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-dove-green text-white text-[9px] flex items-center justify-center">
              {remotePeers.length + 1}
            </span>
          </button>
        ) : <div className="w-9" />}
      </div>

      {/* 视频区域 */}
      {renderVideoLayout()}

      {/* 视频通话时的状态文字 */}
      <div className="text-center mb-2">
        <p className="text-white/80 text-sm">
          {isRinging ? (call.isIncoming ? `${call.peerName || '对方'} 来电...` : '等待接听...') :
           isConnecting ? '正在建立加密信道...' :
           formatDuration(duration)}
        </p>
      </div>

      {/* 底部控制区 */}
      {isRinging && call.isIncoming ? (
        <div className="w-full flex items-center justify-around pb-4">
          <div className="flex flex-col items-center gap-2">
            <button onClick={handleEndCall} className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors">
              <PhoneOff size={28} className="text-white" />
            </button>
            <span className="text-white/70 text-xs">拒绝</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button onClick={handleAcceptCall} className="w-16 h-16 rounded-full bg-dove-green flex items-center justify-center shadow-lg hover:bg-dove-green/80 transition-colors">
              <Phone size={28} className="text-white" />
            </button>
            <span className="text-white/70 text-xs">接听</span>
          </div>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-4 pb-4">
          <div className="flex items-center justify-around w-full">
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={toggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-white/20' : 'bg-white/10'} hover:bg-white/25`}>
                {isMuted ? <MicOff size={22} className="text-white" /> : <Mic size={22} className="text-white" />}
              </button>
              <span className="text-white/60 text-[10px]">静音</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={toggleSpeaker} className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isSpeaker ? 'bg-white/20' : 'bg-white/10'} hover:bg-white/25`}>
                {isSpeaker ? <Volume2 size={22} className="text-white" /> : <VolumeX size={22} className="text-white" />}
              </button>
              <span className="text-white/60 text-[10px]">扬声器</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={toggleVideo} className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-white/20' : 'bg-white/10'} hover:bg-white/25`}>
                {isVideoOff ? <VideoOff size={22} className="text-white" /> : <Video size={22} className="text-white" />}
              </button>
              <span className="text-white/60 text-[10px]">摄像头</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={toggleScreenShare} className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? 'bg-white/20' : 'bg-white/10'} hover:bg-white/25`}>
                {isScreenSharing ? <MonitorOff size={22} className="text-white" /> : <Monitor size={22} className="text-white" />}
              </button>
              <span className="text-white/60 text-[10px]">共享屏幕</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={async () => { set翻转Rotating(true); await toggleCamera(); setTimeout(() => set翻转Rotating(false), 400); }}
                className="w-14 h-14 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/25 transition-colors"
              >
                <RotateCcw size={22} className={`text-white transition-transform duration-400 ${翻转Rotating ? 'rotate-180' : ''}`} />
              </button>
              <span className="text-white/60 text-[10px]">{isFrontCamera ? '前置' : '后置'}</span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <button onClick={handleEndCall} className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors">
              <PhoneOff size={28} className="text-white" />
            </button>
            <span className="text-white/70 text-xs">挂断</span>
          </div>
        </div>
      )}
    </div>
  );

  // ============ 背景色 ============
  // 音频通话：深色渐变（类微信风格，从深红棕到纯黑）
  // 视频通话：纯黑（有视频流时）或深色渐变
  const bgClass = isVideoCall && isCallConnected && remotePeers.length > 0
    ? 'bg-dove-ink'
    : isVideoCall
    ? 'bg-gradient-to-b from-dove-green/90 to-dove-ink/95'
    : 'bg-[radial-gradient(ellipse_at_top,_#3d0a0a_0%,_#1a0505_40%,_#000000_100%)]';

  // ============ 手机端：全屏覆盖 ============
  if (breakpoint === 'mobile') {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100]"
        >
          <div className={`absolute inset-0 ${bgClass}`} />
          {isVideoCall ? renderCallContent() : renderAudioCallContent()}
        </motion.div>
      </AnimatePresence>
    );
  }

  // ============ 平板端：居中弹窗卡片 ============
  if (breakpoint === 'tablet') {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          {/* 半透明遮罩 */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          {/* 弹窗卡片 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className={`relative z-10 w-[560px] rounded-3xl overflow-hidden shadow-2xl ${bgClass}`}
            style={{ height: '80vh', maxHeight: '700px' }}
          >
            {isVideoCall ? renderCallContent() : renderAudioCallContent()}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // ============ 电脑端：右侧固定面板 ============
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 420 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 420 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`fixed top-0 right-0 bottom-0 z-[100] w-[420px] shadow-2xl overflow-hidden ${bgClass}`}
        style={{ borderRadius: '0' }}
      >
        {isVideoCall ? renderCallContent() : renderAudioCallContent()}
      </motion.div>
    </AnimatePresence>
  );
}
