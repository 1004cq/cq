import * as Sentry from '@sentry/react';

const enabled = import.meta.env.PROD
  && String(import.meta.env.VITE_SENTRY_ENABLED || import.meta.env.SENTRY_ENABLED || '').toLowerCase() === 'true'
  && Boolean(import.meta.env.VITE_SENTRY_DSN);

function pseudoHash(value: unknown): string {
  const input = String(value || 'anonymous').slice(0, 160);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'unknown');
  const normalized = message.toLowerCase();
  if (normalized.includes('bundle') || normalized.includes('安全凭证')) return 'bundle_missing_or_invalid';
  if (normalized.includes('decrypt') || normalized.includes('解密')) return 'decrypt_failed';
  if (normalized.includes('encrypt') || normalized.includes('加密')) return 'encrypt_failed';
  if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('网络')) return 'network_error';
  if (normalized.includes('timeout') || normalized.includes('超时')) return 'timeout';
  return 'unknown_error';
}

export type TelemetryContext = {
  chatId?: string;
  groupId?: string;
  userId?: string;
  msgType?: string;
  error?: unknown;
  code?: string;
  direction?: 'inbound' | 'outbound';
  count?: number;
};

export function isTelemetryEnabled() {
  return enabled;
}

export function initTelemetry() {
  if (!enabled) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    enabled: true,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || undefined,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0),
    beforeSend(event) {
      // 防止异常对象、URL 或 Breadcrumb 意外携带业务正文。
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((value) => ({
          ...value,
          value: value.type || 'Unhandled client exception',
        }));
      }
      if (event.message) event.message = String(event.message).slice(0, 160);
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        const safeData: Record<string, unknown> = {};
        for (const key of ['event', 'code', 'chatId', 'groupId', 'msgType', 'direction', 'count']) {
          if (key in breadcrumb.data) safeData[key] = breadcrumb.data[key];
        }
        breadcrumb.data = safeData;
      }
      if (breadcrumb.message) breadcrumb.message = breadcrumb.message.slice(0, 160);
      return breadcrumb;
    },
  });
}

export function setTelemetryUser(userId?: string) {
  if (!enabled) return;
  Sentry.setUser(userId ? { id: pseudoHash(userId) } : null);
}

export function trackEvent(name: string, context: TelemetryContext = {}) {
  if (!enabled) return;
  const data = {
    event: name,
    chatId: context.chatId ? pseudoHash(context.chatId) : undefined,
    groupId: context.groupId ? pseudoHash(context.groupId) : undefined,
    userId: context.userId ? pseudoHash(context.userId) : undefined,
    msgType: context.msgType ? String(context.msgType).slice(0, 40) : undefined,
    direction: context.direction,
    count: typeof context.count === 'number' ? context.count : undefined,
    code: context.code || (context.error ? safeErrorCode(context.error) : undefined),
  };
  Sentry.addBreadcrumb({ category: 'cqim.business', level: 'info', message: name, data });
  Sentry.captureMessage(name, { level: 'info', contexts: { cqim: data } });
}

export function trackException(name: string, context: TelemetryContext = {}) {
  if (!enabled) return;
  const data = {
    event: name,
    chatId: context.chatId ? pseudoHash(context.chatId) : undefined,
    groupId: context.groupId ? pseudoHash(context.groupId) : undefined,
    userId: context.userId ? pseudoHash(context.userId) : undefined,
    msgType: context.msgType ? String(context.msgType).slice(0, 40) : undefined,
    direction: context.direction,
    code: context.code || safeErrorCode(context.error),
  };
  Sentry.captureException(new Error(name), { contexts: { cqim: data }, tags: { cqim_event: name } });
}

export function trackE2EEFailure(kind: 'encrypt' | 'decrypt' | 'bundle', context: Omit<TelemetryContext, 'error'> & { error?: unknown }) {
  const event = kind === 'encrypt' ? 'e2ee_encrypt_failed' : kind === 'decrypt' ? 'e2ee_decrypt_failed' : 'e2ee_bundle_missing';
  trackException(event, context);
}

export { Sentry };
