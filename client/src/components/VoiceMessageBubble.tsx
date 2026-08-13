/**
 * VoiceMessageBubble — 加密语音消息气泡组件（精致升级版）
 * 统一 dove 主题色彩、精致圆角与阴影
 */

import React, { useState, useRef, useCallback } from 'react';
import { Play, Pause, Lock, Volume2 } from 'lucide-react';
import type { VoiceEncryptedPayload, PlaybackState } from '@/hooks/useVoiceMessage';

interface VoiceMessageBubbleProps {
  messageId: string;
  payload: VoiceEncryptedPayload;
  isSelf: boolean;
  playbackState?: PlaybackState;
  onPlay: (messageId: string, payload: VoiceEncryptedPayload) => void;
  onStop: (messageId: string) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const VoiceMessageBubble: React.FC<VoiceMessageBubbleProps> = ({
  messageId,
  payload,
  isSelf,
  playbackState,
  onPlay,
  onStop,
}) => {
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);

  const isPlaying = playbackState?.isPlaying ?? false;
  const progress = playbackState?.progress ?? 0;
  const currentTime = playbackState?.currentTime ?? 0;
  const totalDuration = playbackState?.totalDuration ?? payload.duration;

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      onStop(messageId);
    } else {
      onPlay(messageId, payload);
    }
  }, [isPlaying, messageId, payload, onPlay, onStop]);

  const cycleSpeed = useCallback(() => {
    setSpeed(s => s === 1 ? 1.5 : s === 1.5 ? 2 : 1);
  }, []);

  const waveform = payload.waveform.length > 0 ? payload.waveform : Array(40).fill(0.3);
  const barCount = waveform.length;

  return (
    <div
      className={`voice-bubble flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl min-w-[180px] max-w-[260px] select-none transition-all ${
        isSelf
          ? 'bg-gradient-to-br from-dove-green to-dove-bamboo text-white shadow-soft-sm'
          : 'bg-white/90 text-dove-ink border border-border/30 shadow-soft-sm backdrop-blur-sm'
      }`}
    >
      {/* 播放/暂停按钮 */}
      <button
        onClick={handlePlayPause}
        className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 ${
          isSelf
            ? 'bg-white/20 hover:bg-white/30'
            : 'bg-dove-green/8 hover:bg-dove-green/15'
        }`}
        aria-label={isPlaying ? '暂停' : '播放'}
      >
        {isPlaying ? (
          <Pause size={15} className={isSelf ? 'text-white' : 'text-dove-green'} />
        ) : (
          <Play size={15} className={`ml-0.5 ${isSelf ? 'text-white' : 'text-dove-green'}`} />
        )}
      </button>

      {/* 波形 + 进度条区域 */}
      <div className="flex-1 flex flex-col gap-1">
        {/* 波形可视化 */}
        <div className="flex items-center gap-[1.5px] h-8">
          {waveform.map((amplitude, i) => {
            const barProgress = i / barCount;
            const isActive = barProgress <= progress;
            const height = Math.max(3, Math.round(amplitude * 28));

            return (
              <div
                key={i}
                className="rounded-full flex-shrink-0 transition-all duration-100"
                style={{
                  width: '2px',
                  height: `${height}px`,
                  backgroundColor: isSelf
                    ? isActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)'
                    : isActive ? 'var(--dove-green)' : 'var(--dove-warm-gray)',
                }}
              />
            );
          })}
        </div>

        {/* 时长 + 加密标识行 */}
        <div className="flex items-center justify-between">
          <span className={`text-[11px] font-mono tabular-nums ${isSelf ? 'text-white/80' : 'text-muted-foreground/50'}`}>
            {isPlaying ? formatDuration(currentTime) : formatDuration(totalDuration)}
          </span>

          <div className="flex items-center gap-1">
            {isPlaying && (
              <button
                onClick={cycleSpeed}
                className={`text-[10px] font-bold px-1 rounded transition-all ${
                  isSelf ? 'text-white/70 hover:text-white' : 'text-muted-foreground/40 hover:text-dove-ink/60'
                }`}
              >
                {speed}x
              </button>
            )}

            <div
              className={`flex items-center gap-0.5 text-[10px] ${
                isSelf ? 'text-white/50' : 'text-muted-foreground/40'
              }`}
              title="AES-256-GCM 端到端加密语音"
            >
              <Lock size={9} />
              <span>加密</span>
            </div>
          </div>
        </div>
      </div>

      {/* 音量图标（装饰） */}
      {!isPlaying && (
        <Volume2
          size={14}
          className={`flex-shrink-0 ${isSelf ? 'text-white/30' : 'text-muted-foreground/25'}`}
        />
      )}
    </div>
  );
};

// ============================================================
// 录音中预览组件（按住录音时显示）
// ============================================================

interface RecordingPreviewProps {
  duration: number;
  liveWaveform: number[];
  onCancel: () => void;
}

export const RecordingPreview: React.FC<RecordingPreviewProps> = ({
  duration,
  liveWaveform,
  onCancel,
}) => {
  const normalized = liveWaveform.length > 0
    ? liveWaveform.map(v => Math.abs(v) / 128)
    : Array(32).fill(0.2);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-dove-seal/5 border-t border-dove-seal/10">
      {/* 录音指示灯 */}
      <div className="w-2.5 h-2.5 rounded-full bg-dove-seal animate-pulse flex-shrink-0 shadow-[0_0_6px_rgba(var(--dove-seal-rgb,220,60,60),0.4)]" />

      {/* 实时波形 */}
      <div className="flex-1 flex items-center gap-[2px] h-7 overflow-hidden">
        {normalized.slice(0, 40).map((amp, i) => (
          <div
            key={i}
            className="rounded-full bg-dove-seal/60 flex-shrink-0 transition-all duration-75"
            style={{
              width: '2px',
              height: `${Math.max(3, amp * 26)}px`,
            }}
          />
        ))}
      </div>

      {/* 时长 */}
      <span className="text-dove-seal text-sm font-mono tabular-nums flex-shrink-0">
        {formatDuration(duration)}
      </span>

      {/* 取消按钮 */}
      <button
        onClick={onCancel}
        className="text-muted-foreground/50 hover:text-dove-seal text-xs flex-shrink-0 transition-colors font-medium"
      >
        取消
      </button>
    </div>
  );
};
