import { Capacitor } from '@capacitor/core';

export type LocationSource = 'web' | 'native';
export type LocationPermissionState = 'granted' | 'prompt' | 'prompt-with-rationale' | 'denied' | 'unknown';
export type LocationErrorCode =
  | 'permission_denied'
  | 'position_unavailable'
  | 'timeout'
  | 'unsupported'
  | 'plugin_unavailable'
  | 'unknown';

export interface CurrentLocationResult {
  lat: number;
  lng: number;
  accuracy?: number | null;
  source: LocationSource;
  permissionState: LocationPermissionState;
}

export interface LocationRequestOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export class LocationAccessError extends Error {
  code: LocationErrorCode;
  source: LocationSource;
  permissionState: LocationPermissionState;

  constructor(
    code: LocationErrorCode,
    message: string,
    source: LocationSource,
    permissionState: LocationPermissionState = 'unknown'
  ) {
    super(message);
    this.name = 'LocationAccessError';
    this.code = code;
    this.source = source;
    this.permissionState = permissionState;
  }
}

let nativeGeolocationPlugin: any = null;

function normalizeNativePermissionState(status: any): LocationPermissionState {
  const state = status?.location ?? status?.coarseLocation ?? 'unknown';
  if (
    state === 'granted' ||
    state === 'prompt' ||
    state === 'prompt-with-rationale' ||
    state === 'denied'
  ) {
    return state;
  }
  return 'unknown';
}

async function getNativeGeolocationPlugin() {
  if (!Capacitor.isNativePlatform()) return null;
  if (nativeGeolocationPlugin) return nativeGeolocationPlugin;

  try {
    const module = await import('@capacitor/geolocation');
    nativeGeolocationPlugin = module.Geolocation;
    return nativeGeolocationPlugin;
  } catch {
    return null;
  }
}

function mapWebError(err: GeolocationPositionError | null | undefined, permissionState: LocationPermissionState) {
  switch (err?.code) {
    case 1:
      return new LocationAccessError(
        'permission_denied',
        '定位权限被拒绝，请在浏览器或系统设置中允许位置访问后重试。',
        'web',
        permissionState === 'unknown' ? 'denied' : permissionState
      );
    case 2:
      return new LocationAccessError(
        'position_unavailable',
        '无法获取位置信息，请确认系统定位服务已开启。',
        'web',
        permissionState
      );
    case 3:
      return new LocationAccessError(
        'timeout',
        '获取位置超时，请稍后重试。',
        'web',
        permissionState
      );
    default:
      return new LocationAccessError(
        'unknown',
        '获取位置失败，请稍后重试。',
        'web',
        permissionState
      );
  }
}

export async function getCurrentLocation(
  options: LocationRequestOptions = {}
): Promise<CurrentLocationResult> {
  const requestOptions: Required<LocationRequestOptions> = {
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: options.timeout ?? 10000,
    maximumAge: options.maximumAge ?? 0,
  };

  if (Capacitor.isNativePlatform()) {
    const plugin = await getNativeGeolocationPlugin();
    if (!plugin) {
      throw new LocationAccessError(
        'plugin_unavailable',
        '当前 App 尚未正确接入原生定位模块，请更新应用后重试。',
        'native'
      );
    }

    let permStatus = await plugin.checkPermissions();
    let permissionState = normalizeNativePermissionState(permStatus);

    if (permissionState === 'prompt' || permissionState === 'prompt-with-rationale') {
      permStatus = await plugin.requestPermissions();
      permissionState = normalizeNativePermissionState(permStatus);
    }

    if (permissionState !== 'granted') {
      throw new LocationAccessError(
        'permission_denied',
        '定位权限未开启，请在系统设置中允许该应用访问位置信息后重试。',
        'native',
        permissionState
      );
    }

    try {
      const position = await plugin.getCurrentPosition(requestOptions);
      return {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        source: 'native',
        permissionState,
      };
    } catch (err: any) {
      const message = String(err?.message || err || '');
      if (/timeout/i.test(message)) {
        throw new LocationAccessError('timeout', '获取位置超时，请稍后重试。', 'native', permissionState);
      }
      if (/permission/i.test(message)) {
        throw new LocationAccessError(
          'permission_denied',
          '定位权限未开启，请在系统设置中允许该应用访问位置信息后重试。',
          'native',
          permissionState
        );
      }
      throw new LocationAccessError(
        'position_unavailable',
        '无法获取位置信息，请确认系统定位服务已开启。',
        'native',
        permissionState
      );
    }
  }

  if (!navigator.geolocation) {
    throw new LocationAccessError('unsupported', '当前浏览器不支持定位功能。', 'web');
  }

  return new Promise((resolve, reject) => {
    try {
      /**
       * 关键兼容性说明：
       * Safari / iOS 对地理位置请求非常依赖“用户手势”上下文。
       * 如果在真正调用 getCurrentPosition 之前先执行 await（例如 Permissions API 查询），
       * 可能导致系统不再弹出授权框，直接返回 permission denied。
       * 因此 Web 端这里必须直接发起定位请求，避免在请求前插入异步预检查。
       */
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            source: 'web',
            permissionState: 'granted',
          });
        },
        (err) => {
          reject(mapWebError(err, 'unknown'));
        },
        requestOptions
      );
    } catch {
      reject(new LocationAccessError('unknown', '获取位置失败，请稍后重试。', 'web'));
    }
  });
}

export function getLocationErrorMessage(error: unknown): string {
  if (error instanceof LocationAccessError) {
    return error.message;
  }

  return '获取位置失败，请稍后重试。';
}

export function isLocationPermissionDenied(error: unknown): boolean {
  return error instanceof LocationAccessError && error.code === 'permission_denied';
}
