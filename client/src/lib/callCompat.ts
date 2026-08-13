export type CallMediaType = 'audio' | 'video';

interface CallPreparationResult {
  ok: boolean;
  message?: string;
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function getCallEnvironmentIssue(): string | null {
  if (typeof window === 'undefined') return '当前环境暂不支持音视频通话';
  if (!navigator.mediaDevices?.getUserMedia) {
    return '当前浏览器不支持麦克风/摄像头调用，请使用最新版 Chrome、Edge 或 Safari';
  }
  if (!window.isSecureContext && !isLocalhost(window.location.hostname)) {
    return '音视频通话仅支持在 HTTPS 或 localhost 环境下使用，请先检查站点证书';
  }
  return null;
}

export function getMediaPermissionError(error: unknown, type: CallMediaType): string {
  const mediaLabel = type === 'video' ? '麦克风和摄像头' : '麦克风';
  const err = error as DOMException | undefined;
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return `请先在浏览器中允许${mediaLabel}权限后再发起通话`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return type === 'video'
        ? '未检测到可用的麦克风或摄像头设备'
        : '未检测到可用的麦克风设备';
    case 'NotReadableError':
    case 'TrackStartError':
      return `${mediaLabel}当前正被其他应用占用，请关闭占用后重试`;
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return '当前设备不支持默认采集参数，已建议切换到系统默认摄像头后重试';
    case 'SecurityError':
      return '浏览器安全策略阻止了音视频采集，请确认当前站点已启用 HTTPS';
    case 'AbortError':
      return '浏览器中断了本次音视频采集，请重试';
    default:
      return `无法打开${mediaLabel}，请检查浏览器权限和设备状态后重试`;
  }
}

export async function prepareCallMedia(type: CallMediaType): Promise<CallPreparationResult> {
  const envIssue = getCallEnvironmentIssue();
  if (envIssue) {
    return { ok: false, message: envIssue };
  }

  const constraints: MediaStreamConstraints = type === 'video'
    ? {
        audio: true,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
      }
    : {
        audio: true,
        video: false,
      };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach(track => track.stop());
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: getMediaPermissionError(error, type),
    };
  }
}
