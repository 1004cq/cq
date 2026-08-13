/**
 * BotVoiceBubble — 机器人语音消息气泡组件（精致升级版）
 * 统一 dove 主题，紫色渐变保留 AI 特色
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Play, Pause, Volume2, Bot } from 'lucide-react';

interface BotVoiceBubbleProps {
  messageId: string;
  voiceUrl: string;
  duration?: number;
  isSelf?: boolean;
}

function formatDuration(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const m = Math.floor(safeSeconds / 60);
  const s = Math.floor(safeSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const BotVoiceBubble: React.FC<BotVoiceBubbleProps> = ({
  messageId,
  voiceUrl,
  duration = 0,
  isSelf = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [waveform] = useState(() => {
    const seed = messageId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return Array.from({ length: 40 }, (_, i) => {
      const x = Math.sin(seed * 0.1 + i * 0.3) * 0.3 + 0.5;
      return Math.max(0.15, Math.min(0.95, x + Math.sin(i * 0.7 + seed) * 0.2));
    });
  });

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const prog = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
    setProgress(prog);
    setCurrentTime(audio.currentTime);
    if (!audio.paused) {
      animFrameRef.current = requestAnimationFrame(updateProgress);
    }
  }, []);

  const handlePlayPause = useCallback(async () => {
    if (error) setError(null);

    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    if (!audioRef.current || audioRef.current.ended) {
      setIsLoading(true);
      const audio = new Audio(voiceUrl);
      audio.playbackRate = speed;
      audioRef.current = audio;
      audio.onloadedmetadata = () => {
        setTotalDuration(audio.duration);
        setIsLoading(false);
      };
      // 兼容某些浏览器 metadata 加载不全的情况
      audio.oncanplaythrough = () => {
        if (audio.duration && audio.duration !== Infinity) {
          setTotalDuration(audio.duration);
        }
      };
      audio.onended = () => {
        setIsPlaying(false);
        setProgress(0);
        setCurrentTime(0);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };
      audio.onerror = () => {
        setIsPlaying(false);
        setIsLoading(false);
        setError('语音播放失败，可重试或先查看上方文字回复');
        audioRef.current = null;
      };
    }

    try {
      audioRef.current.playbackRate = speed;
      await audioRef.current.play();
      setIsPlaying(true);
      animFrameRef.current = requestAnimationFrame(updateProgress);
    } catch (err) {
      setError('语音播放失败，可重试或先查看上方文字回复');
      setIsPlaying(false);
      setIsLoading(false);
    }
  }, [isPlaying, voiceUrl, speed, error, updateProgress]);

  const cycleSpeed = useCallback(() => {
    const newSpeed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(newSpeed);
    if (audioRef.current) audioRef.current.playbackRate = newSpeed;
  }, [speed]);

  const helperText = useMemo(() => {
    if (error) return error;
    if (isLoading) return '正在载入语音回复…';
    if (isPlaying) return '正在播放语音回复';
    return '轻点即可收听这条语音回复';
  }, [error, isLoading, isPlaying]);

  const barCount = waveform.length;

  return (
    <div
      className={`voice-bubble flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl min-w-[220px] max-w-[280px] select-none transition-all ${
        isSelf
          ? 'bg-gradient-to-br from-dove-green to-dove-bamboo text-white shadow-soft-sm'
          : 'bg-white/90 text-dove-ink border border-purple-100/50 shadow-soft-sm backdrop-blur-sm'
      }`}
    >
      <button
        onClick={handlePlayPause}
        disabled={isLoading}
        className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 ${
          isSelf
            ? 'bg-white/20 hover:bg-white/30'
            : 'bg-purple-500/8 hover:bg-purple-500/15'
        } ${isLoading ? 'opacity-50' : ''}`}
        aria-label={isPlaying ? '暂停' : '播放'}
      >
        {isLoading ? (
          <div className={`w-4 h-4 border-2 rounded-full animate-spin ${
            isSelf ? 'border-white/40 border-t-white' : 'border-purple-200 border-t-purple-500'
          }`} />
        ) : isPlaying ? (
          <Pause size={15} className={isSelf ? 'text-white' : 'text-purple-500'} />
        ) : (
          <Play size={15} className={`ml-0.5 ${isSelf ? 'text-white' : 'text-purple-500'}`} />
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-purple-600">
            <Bot size={11} className="flex-shrink-0" />
            <span>语音回复</span>
          </div>
          <span className={`text-[11px] font-mono tabular-nums ${isSelf ? 'text-white/80' : 'text-muted-foreground/60'}`}>
            {isPlaying ? formatDuration(currentTime) : formatDuration(totalDuration)}
          </span>
        </div>

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
                    : isActive ? '#a855f7' : '#f3e8ff',
                }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className={`text-[10px] leading-none ${error ? 'text-dove-seal/75' : isSelf ? 'text-white/70' : 'text-muted-foreground/55'}`}>
            {helperText}
          </span>
          <div className="flex items-center gap-1.5">
            {isPlaying && (
              <button
                onClick={cycleSpeed}
                className={`text-[10px] font-bold px-1 rounded transition-all ${
                  isSelf ? 'text-white/70 hover:text-white' : 'text-muted-foreground/50 hover:text-dove-ink/70'
                }`}
              >
                {speed}x
              </button>
            )}
            {!isPlaying && !isLoading && (
              <Volume2
                size={14}
                className={`flex-shrink-0 ${isSelf ? 'text-white/30' : 'text-purple-200/70'}`}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
