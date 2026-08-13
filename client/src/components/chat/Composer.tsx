import React, { lazy, Suspense, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, Clock, Flame, Image, Loader2, MapPin, Mic, Paperclip, Phone, Send, Smile, Sticker, Timer, Video, X } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { GoldVerifiedBadge } from '@/components/GoldVerifiedBadge';
import { RecordingPreview } from '@/components/VoiceMessageBubble';
import { formatBurnTimer, type BurnAfterReadTimer, type Message } from '@/lib/store';
import type { StickerItem } from '@/components/StickerPanel';

const StickerPanel = lazy(() => import('@/components/StickerPanel'));

const EMOJI_LIST = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👋','🤚','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💯','💢'];

export interface ComposerVoiceState {
  isRecording: boolean;
  recordDuration: number;
  liveWaveform: number[];
  isProcessing: boolean;
  cancelRecording: () => void;
}

export interface ComposerProps {
  inputText: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  voice: ComposerVoiceState;
  replyingTo?: Message | null;
  replyLabel?: string;
  effectiveBurnTimer?: BurnAfterReadTimer;
  ephemeralTimer?: BurnAfterReadTimer;
  forwardRestricted: boolean;
  mediaUploading: boolean;
  isOfficial: boolean;
  isBot: boolean;
  groupMembers: Array<{ id: string; name: string; avatar?: string }>;
  mentionQuery?: string | null;
  onInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onSendEmoji: (emoji: string) => void;
  onSendSticker: (sticker: StickerItem) => void;
  onVoicePressStart: () => void;
  onVoicePressEnd: () => void;
  onCancelReply: () => void;
  onMentionSelect: (member: { id: string; name: string }) => void;
  onSetBurnTimer: (timer: BurnAfterReadTimer | undefined) => void;
  onToggleForwardRestricted: () => void;
  onOpenEphemeral: () => void;
  onOpenLocation: () => void;
  onOpenLocationShare: () => void;
  onStartCall: (type: 'audio' | 'video') => void;
  onChooseImage: () => void;
  onChooseVideo: () => void;
  onClearPrivacy: () => void;
}

export const Composer = React.memo(function Composer({
  inputText,
  inputRef,
  placeholder,
  voice,
  replyingTo,
  replyLabel,
  effectiveBurnTimer,
  ephemeralTimer,
  forwardRestricted,
  mediaUploading,
  isOfficial,
  isBot,
  groupMembers,
  mentionQuery,
  onInputChange,
  onKeyDown,
  onSend,
  onSendEmoji,
  onSendSticker,
  onVoicePressStart,
  onVoicePressEnd,
  onCancelReply,
  onMentionSelect,
  onSetBurnTimer,
  onToggleForwardRestricted,
  onOpenEphemeral,
  onOpenLocation,
  onOpenLocationShare,
  onStartCall,
  onChooseImage,
  onChooseVideo,
  onClearPrivacy,
}: ComposerProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [showStickerPanel, setShowStickerPanel] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [showBurnSelector, setShowBurnSelector] = useState(false);

  const closePanels = () => {
    setShowEmoji(false);
    setShowStickerPanel(false);
    setShowExtra(false);
  };
  const filteredMembers = mentionQuery == null
    ? []
    : groupMembers.filter(member => member.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8);

  return (
    <div className="px-3 pt-2 bg-background/80 dark:bg-slate-950/70 backdrop-blur-sm" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}>
      <AnimatePresence>
        {voice.isRecording && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}><RecordingPreview duration={voice.recordDuration} liveWaveform={voice.liveWaveform} onCancel={voice.cancelRecording} /></motion.div>}
        {voice.isProcessing && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex items-center justify-center gap-2 py-2 bg-dove-green/5"><Loader2 size={14} className="text-dove-green animate-spin" /><span className="text-xs text-dove-green">正在加密语音...</span></motion.div>}
        {(effectiveBurnTimer || forwardRestricted) && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex items-center gap-2 px-4 py-1.5 bg-dove-seal/5 border-b border-dove-seal/10"><span className="flex items-center gap-1 text-[10px] text-dove-seal">{effectiveBurnTimer ? <><Flame size={10} />{ephemeralTimer ? '消失模式' : '阅后即焚'}：{formatBurnTimer(effectiveBurnTimer)}</> : <><Ban size={10} />防转发已开启</>}</span><button type="button" onClick={onClearPrivacy} className="ml-auto text-dove-seal/60 hover:text-dove-seal"><X size={12} /></button></motion.div>}
        {replyingTo && <motion.div initial={{ height: 0, opacity: 0, y: 6 }} animate={{ height: 'auto', opacity: 1, y: 0 }} exit={{ height: 0, opacity: 0, y: 6 }} className="mx-1 mb-2 overflow-hidden"><div className="rounded-2xl border border-dove-green/15 bg-dove-green/5 px-4 py-2.5 flex items-start gap-3 dark:bg-sky-400/10"><div className="mt-0.5 h-9 w-1 rounded-full bg-dove-green dark:bg-sky-300" /><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-dove-green dark:text-sky-300">回复 {replyLabel || '消息'}</div><div className="mt-0.5 truncate text-xs text-dove-ink/70 dark:text-slate-200/75">{replyingTo.content || '[加密消息]'}</div></div><button type="button" onClick={onCancelReply} className="flex h-7 w-7 items-center justify-center rounded-full text-dove-ink/45 hover:bg-black/5 dark:hover:bg-white/10"><X size={14} /></button></div></motion.div>}
      </AnimatePresence>

      {mentionQuery !== undefined && mentionQuery !== null && filteredMembers.length > 0 && (
        <div className="mx-3 mb-1 bg-background border border-border/40 rounded-2xl shadow-lg overflow-hidden max-h-[180px] overflow-y-auto">
          {filteredMembers.map(member => <button key={member.id} type="button" onMouseDown={(event) => { event.preventDefault(); onMentionSelect(member); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-dove-warm-gray/60 transition-colors text-left"><DoveAvatar name={member.name} id={member.id} avatar={member.avatar} size="sm" /><span className="text-sm text-dove-ink dark:text-slate-100">{member.name}</span></button>)}
        </div>
      )}

      {isOfficial && <div className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border-t border-blue-100 dark:border-blue-900"><GoldVerifiedBadge size={16} /><span className="text-xs font-medium text-blue-600 dark:text-blue-300">这是官方认证账号，仅发送系统通知，无法回复</span></div>}
      {!isOfficial && <>
        {isBot && <div className="flex items-center gap-2 px-4 py-1.5 bg-purple-50 dark:bg-purple-950/30 border-t border-purple-100 dark:border-purple-900"><div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" /><span className="text-[10px] font-medium text-purple-500">AI 助手正在待命，随时可以提问或发送语音</span></div>}
        <div className="flex items-end gap-1 sm:gap-2 px-1 py-2 w-full">
          <button type="button" onClick={() => { setShowExtra(value => !value); setShowEmoji(false); setShowBurnSelector(false); }} className={`tg-chat-icon-btn flex-shrink-0 active:scale-95 ${showExtra ? 'scale-95' : ''}`} aria-label="更多功能"><Paperclip size={20} /></button>
          <div className="tg-chat-composer flex-1"><textarea ref={inputRef} rows={1} value={inputText} onChange={onInputChange} onKeyDown={onKeyDown} placeholder={placeholder} className="flex-1 min-w-0 resize-none overflow-y-auto bg-transparent py-2 text-[16px] leading-5 text-dove-ink outline-none placeholder:text-black/35 dark:text-slate-100 dark:placeholder:text-white/35" style={{ minHeight: 40, maxHeight: 120 }} /><button type="button" className={`flex-shrink-0 p-1.5 hover:bg-black/5 rounded-lg transition-colors ${showEmoji ? 'text-dove-green' : 'text-black/35'}`} onClick={() => { setShowEmoji(value => !value); setShowStickerPanel(false); setShowExtra(false); }} aria-label="表情"><Smile size={20} /></button></div>
          <button type="button" className={`tg-chat-icon-btn flex-shrink-0 active:scale-95 ${showStickerPanel ? 'scale-95 text-dove-green dark:text-sky-300' : ''}`} onClick={() => { setShowStickerPanel(value => !value); setShowEmoji(false); setShowExtra(false); setShowBurnSelector(false); }} title="贴纸" aria-label="贴纸"><Sticker size={19} /></button>
          <div className="relative"><button type="button" onClick={() => { setShowBurnSelector(value => !value); setShowExtra(false); setShowEmoji(false); }} className={`tg-chat-icon-btn flex-shrink-0 active:scale-95 ${effectiveBurnTimer ? 'text-dove-seal dark:text-amber-300' : ''}`} title="阅后即焚" aria-label="阅后即焚"><Timer size={18} /></button>{showBurnSelector && !ephemeralTimer && <div className="absolute bottom-full right-0 mb-2 z-50 w-48 rounded-2xl border border-border bg-background p-2 shadow-xl"><button type="button" className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-muted" onClick={() => { onSetBurnTimer(undefined); setShowBurnSelector(false); }}>关闭</button>{[5, 10, 30, 60].map(seconds => <button key={seconds} type="button" className={`w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-muted ${effectiveBurnTimer === seconds ? 'text-dove-seal font-medium' : ''}`} onClick={() => { onSetBurnTimer(seconds as BurnAfterReadTimer); setShowBurnSelector(false); }}>{seconds} 秒后销毁</button>)}</div>}</div>
          {inputText.trim() ? <motion.button type="button" onClick={onSend} className="tg-chat-send-btn flex-shrink-0" whileTap={{ scale: 0.86 }} aria-label="发送"><Send size={17} /></motion.button> : <button type="button" className={`tg-chat-icon-btn flex-shrink-0 ${voice.isRecording ? 'bg-red-500 text-white scale-110' : voice.isProcessing ? 'bg-dove-green/20 text-dove-green' : ''}`} title="按住录音" onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => { event.preventDefault(); onVoicePressStart(); }} onPointerUp={(event) => { event.preventDefault(); onVoicePressEnd(); }} onPointerCancel={(event) => { event.preventDefault(); onVoicePressEnd(); }} onPointerLeave={() => { if (voice.isRecording) onVoicePressEnd(); }} aria-label="录音">{voice.isProcessing ? <Loader2 size={18} className="text-dove-green animate-spin" /> : <Mic size={20} />}</button>}
        </div>

        <AnimatePresence>
          {showEmoji && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="grid grid-cols-8 gap-1 px-4 py-3 max-h-[200px] overflow-y-auto">{EMOJI_LIST.map(emoji => <button key={emoji} type="button" onClick={() => onSendEmoji(emoji)} className="w-9 h-9 flex items-center justify-center text-xl hover:bg-dove-warm-gray rounded-lg transition-colors active:scale-90">{emoji}</button>)}</div></motion.div>}
          {showStickerPanel && <Suspense fallback={<div className="fixed inset-x-3 bottom-20 z-50 h-64 rounded-2xl bg-background/80 animate-pulse" />}><StickerPanel onStickerSelect={onSendSticker} onClose={() => setShowStickerPanel(false)} /></Suspense>}
          {showExtra && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="grid grid-cols-4 gap-4 px-6 py-4">{[
            { icon: Image, label: '图片', action: onChooseImage }, { icon: Video, label: '视频', action: onChooseVideo }, { icon: Phone, label: '语音通话', action: () => onStartCall('audio') }, { icon: Video, label: '视频通话', action: () => onStartCall('video') }, { icon: MapPin, label: '发送位置', action: onOpenLocation }, { icon: MapPin, label: '位置共享', action: onOpenLocationShare }, { icon: Ban, label: forwardRestricted ? '取消防转发' : '防转发', action: onToggleForwardRestricted }, { icon: Clock, label: '消失模式', action: onOpenEphemeral },
          ].map(({ icon: Icon, label, action }) => <button key={label} type="button" disabled={(label === '图片' || label === '视频') && mediaUploading} onClick={() => { action(); if (label !== '防转发' && label !== '取消防转发') closePanels(); }} className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"><div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center shadow-soft-sm"><Icon size={22} className="text-muted-foreground" /></div><span className="text-[10px] text-muted-foreground">{label}</span></button>)}
          </div></motion.div>}
        </AnimatePresence>
      </>}
      <div style={{ height: 'max(env(safe-area-inset-bottom, 0px), 4px)' }} />
    </div>
  );
});

export default Composer;
