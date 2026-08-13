export interface NotificationPreferences {
  enabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  previewEnabled: boolean;
  browserEnabled: boolean;
}

export interface BrowserNotificationPayload {
  chatId: string;
  title: string;
  body: string;
  icon?: string;
  tag?: string;
}

const STORAGE_KEY = 'cqim_notification_preferences';

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  previewEnabled: false,
  browserEnabled: true,
};

let audioContextRef: AudioContext | null = null;

function isBrowser() {
  return typeof window !== 'undefined';
}

function getAudioContext(): AudioContext | null {
  if (!isBrowser()) return null;

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (!audioContextRef) {
    audioContextRef = new AudioContextCtor();
  }

  return audioContextRef;
}

async function ensureAudioContextReady(ctx: AudioContext) {
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // ignore
    }
  }
}

function sanitizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (!isBrowser() || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

export function loadNotificationPreferences(): NotificationPreferences {
  if (!isBrowser()) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...parsed,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export function saveNotificationPreferences(preferences: NotificationPreferences) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function updateNotificationPreferences(patch: Partial<NotificationPreferences>) {
  const next = {
    ...loadNotificationPreferences(),
    ...patch,
  };
  saveNotificationPreferences(next);
  return next;
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isBrowser() || typeof Notification === 'undefined') {
    return 'unsupported';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function warmupNotificationAudio(): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  await ensureAudioContextReady(ctx);
  return ctx.state === 'running';
}

export async function playNotificationSound(volume = 0.035): Promise<boolean> {
  const preferences = loadNotificationPreferences();
  if (!preferences.enabled || !preferences.soundEnabled) {
    return false;
  }

  const ctx = getAudioContext();
  if (!ctx) return false;

  await ensureAudioContextReady(ctx);
  if (ctx.state !== 'running') return false;

  try {
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    master.connect(ctx.destination);

    const oscA = ctx.createOscillator();
    oscA.type = 'triangle';
    oscA.frequency.setValueAtTime(880, now);
    oscA.frequency.exponentialRampToValueAtTime(1174.66, now + 0.14);
    oscA.connect(master);

    const oscB = ctx.createOscillator();
    oscB.type = 'sine';
    oscB.frequency.setValueAtTime(1318.51, now + 0.08);
    oscB.connect(master);

    oscA.start(now);
    oscB.start(now + 0.06);
    oscA.stop(now + 0.24);
    oscB.stop(now + 0.38);

    return true;
  } catch {
    return false;
  }
}

export function triggerNotificationVibration(pattern: number | number[] = [70, 40, 70]): boolean {
  const preferences = loadNotificationPreferences();
  if (!preferences.enabled || !preferences.vibrationEnabled) {
    return false;
  }

  if (!isBrowser() || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }

  return navigator.vibrate(pattern);
}

export function formatMessagePreview(message: { type?: string; content?: string; fileName?: string; duration?: number }) {
  switch (message.type) {
    case 'image':
      return '[图片消息]';
    case 'video':
      return '[视频消息]';
    case 'voice':
      return message.duration ? `语音消息 · ${message.duration} 秒` : '语音消息';
    case 'file':
      return message.fileName ? `[文件] ${message.fileName}` : '[文件消息]';
    case 'call':
      return message.content || '[通话记录]';
    case 'location':
    case 'location_share':
      return '[位置信息]';
    case 'system':
      return message.content || '[系统消息]';
    case 'text':
    default: {
      const text = sanitizeText(message.content || '');
      return text.length > 72 ? `${text.slice(0, 72)}…` : text || '[新消息]';
    }
  }
}

export function showBrowserNotification(payload: BrowserNotificationPayload): Notification | null {
  const preferences = loadNotificationPreferences();
  if (!preferences.enabled || !preferences.browserEnabled) {
    return null;
  }

  if (!isBrowser() || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return null;
  }

  const body = preferences.previewEnabled ? payload.body : '你收到一条新消息';
  const notification = new Notification(payload.title, {
    body,
    tag: payload.tag || `cqim-chat-${payload.chatId}`,
    icon: payload.icon || '/favicon.ico',
    badge: '/favicon.ico',
    data: { chatId: payload.chatId },
  });

  notification.onclick = () => {
    try {
      window.focus();
      window.dispatchEvent(new CustomEvent('cqim:open-chat-from-notification', {
        detail: { chatId: payload.chatId },
      }));
    } finally {
      notification.close();
    }
  };

  return notification;
}

export function shouldShowBrowserNotification() {
  const preferences = loadNotificationPreferences();
  return preferences.enabled && preferences.browserEnabled && document.visibilityState === 'hidden';
}
