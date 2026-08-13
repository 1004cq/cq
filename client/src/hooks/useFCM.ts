/**
 * useFCM - 推送通知 Hook（支持个推 + FCM 双通道）
 *
 * 在 App（Capacitor 环境）中：
 * 1. 请求通知权限
 * 2. 获取 FCM Token（海外/GMS 设备）或个推 CID（国内设备）
 * 3. 将 Token/CID 上报给服务器
 * 4. 监听推送消息（前台收到时展示本地通知）
 *
 * 参考: https://github.com/firebase/quickstart-android/tree/master/messaging
 * 参考: https://docs.getui.com/getui/mobile/android/androidstudio/
 */

import { useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

// 动态导入，避免在 Web 环境中报错
let PushNotifications: any = null;

async function getPushNotifications() {
  if (!Capacitor.isNativePlatform()) return null;
  if (PushNotifications) return PushNotifications;
  try {
    const module = await import('@capacitor/push-notifications');
    PushNotifications = module.PushNotifications;
    return PushNotifications;
  } catch {
    return null;
  }
}

/**
 * 将 FCM Token 上报给服务器
 */
async function registerFCMTokenOnServer(token: string): Promise<void> {
  const userToken = localStorage.getItem('user_token');
  if (!userToken) {
    console.log('[FCM] 用户未登录，跳过 Token 上报');
    return;
  }

  try {
    const res = await fetch('/api/fcm/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        fcmToken: token,
        platform: Capacitor.getPlatform(),
      }),
    });
    if (res.ok) {
      console.log('[FCM] Token 上报成功');
    } else {
      console.warn('[FCM] Token 上报失败:', res.status);
    }
  } catch (err) {
    console.error('[FCM] Token 上报异常:', err);
  }
}

/**
 * 将个推 CID 上报给服务器
 * CID 由 Android 原生层（GetuiIntentService.onReceiveClientId）写入 SharedPreferences
 * 通过 Capacitor Preferences 插件读取
 */
function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function registerWebPushOnServer(subscription: PushSubscription): Promise<void> {
  const token = localStorage.getItem('user_token');
  if (!token) return;
  const response = await fetch('/api/web-push/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) throw new Error(`Web Push 订阅保存失败: ${response.status}`);
}

async function registerGetuiCIDOnServer(cid: string): Promise<void> {
  const userToken = localStorage.getItem('user_token');
  if (!userToken) {
    console.log('[个推] 用户未登录，跳过 CID 上报');
    return;
  }

  try {
    const res = await fetch('/api/getui/cid', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ cid }),
    });
    if (res.ok) {
      console.log('[个推] CID 上报成功:', cid.substring(0, 10) + '...');
    } else {
      console.warn('[个推] CID 上报失败:', res.status);
    }
  } catch (err) {
    console.error('[个推] CID 上报异常:', err);
  }
}

/**
 * 尝试从 Android 原生层读取个推 CID
 * 个推 SDK 初始化后会将 CID 写入 SharedPreferences("getui", "cid")
 * 通过 Capacitor 的 JavascriptInterface 或 Preferences 插件读取
 */
async function tryGetGetuiCID(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    // 方式1: 通过 Capacitor Preferences 插件读取（如果已安装）
    const { Preferences } = await import('@capacitor/preferences').catch(() => ({ Preferences: null }));
    if (Preferences) {
      const { value } = await Preferences.get({ key: 'getui_cid' });
      if (value) {
        console.log('[个推] 从 Preferences 读取到 CID');
        return value;
      }
    }
  } catch {
    // Preferences 插件未安装，忽略
  }

  // 方式2: 通过 window.GetuiBridge（需要 Android 原生注入）
  try {
    const bridge = (window as any).GetuiBridge;
    if (bridge && typeof bridge.getCID === 'function') {
      const cid = bridge.getCID();
      if (cid) {
        console.log('[个推] 从 GetuiBridge 读取到 CID');
        return cid;
      }
    }
  } catch {
    // GetuiBridge 未注入，忽略
  }

  return null;
}

/**
 * useFCM Hook
 * @param isLoggedIn 用户是否已登录
 */
export function useFCM(isLoggedIn: boolean) {
  const webPushCleanupRef = useRef<(() => void) | null>(null);
  /**
   * 初始化个推 CID 上报
   * 轮询等待 CID 就绪（SDK 初始化需要 1-3 秒）
   */
  const initGetuiCID = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    // 最多等待 10 秒，每 2 秒检查一次
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const cid = await tryGetGetuiCID();
      if (cid) {
        localStorage.setItem('getui_cid', cid);
        await registerGetuiCIDOnServer(cid);
        return;
      }
    }
    console.log('[个推] CID 未就绪，将在下次登录时重试');
  }, []);

  const initWebPush = useCallback(async () => {
    if (Capacitor.isNativePlatform()) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

    try {
      const keyResponse = await fetch('/api/web-push/public-key');
      if (!keyResponse.ok) return;
      const config = await keyResponse.json();
      if (!config.enabled || !config.publicKey) return;

      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        });
      await registerWebPushOnServer(subscription);

      const handleWorkerMessage = (event: MessageEvent) => {
        const data = event.data;
        if (data?.type !== 'cqim:open-chat-from-notification') return;
        window.dispatchEvent(new CustomEvent('cqim:open-chat-from-notification', {
          detail: { chatId: data.chatId },
        }));
      };
      navigator.serviceWorker.addEventListener('message', handleWorkerMessage);
      webPushCleanupRef.current = () => {
        navigator.serviceWorker.removeEventListener('message', handleWorkerMessage);
      };
    } catch (error) {
      console.warn('[WebPush] 初始化跳过:', error);
    }
  }, []);

  const initFCM = useCallback(async () => {
    // Native 推送由 JPush 接管（见 useJPush.ts）
    if (Capacitor.isNativePlatform()) {
      console.log('[FCM] Native 环境由 JPush 接管，跳过 Capacitor PushNotifications');
      void initGetuiCID();
      return;
    }

    const push = await getPushNotifications();
    if (!push) {
      console.log('[FCM] 非 Native 环境，跳过 FCM 初始化');
      return;
    }

    // 1. 请求通知权限
    let permStatus = await push.checkPermissions();
    if (permStatus.receive === 'prompt') {
      permStatus = await push.requestPermissions();
    }
    if (permStatus.receive !== 'granted') {
      console.warn('[FCM] 通知权限被拒绝');
      return;
    }
    console.log('[FCM] 通知权限已获取');

    // 2. 注册 FCM，获取 Token
    await push.register();

    // 3. 监听 Token 获取成功事件
    push.addListener('registration', (token: { value: string }) => {
      console.log('[FCM] 获取到 FCM Token:', token.value.substring(0, 20) + '...');
      // 保存到 localStorage 供其他地方使用
      localStorage.setItem('fcm_token', token.value);
      // 上报给服务器
      void registerFCMTokenOnServer(token.value);
    });

    // 4. 监听 Token 注册失败
    push.addListener('registrationError', (err: any) => {
      console.error('[FCM] Token 注册失败:', err);
      // FCM 注册失败时，尝试使用个推
      console.log('[个推] FCM 失败，尝试个推 CID...');
      void initGetuiCID();
    });

    // 5. 监听前台收到推送消息
    push.addListener('pushNotificationReceived', (notification: any) => {
      console.log('[FCM] 前台收到推送:', notification);
      // 前台收到时，触发自定义事件，让 AppContext 处理
      const chatId = notification.data?.chatId;
      if (chatId) {
        window.dispatchEvent(
          new CustomEvent('cqim:fcm-notification', {
            detail: {
              title: notification.title,
              body: notification.body,
              chatId,
            },
          })
        );
      }
    });

    // 6. 监听用户点击通知
    push.addListener('pushNotificationActionPerformed', (action: any) => {
      console.log('[FCM] 用户点击了通知:', action);
      const chatId = action.notification?.data?.chatId;
      if (chatId) {
        window.dispatchEvent(
          new CustomEvent('cqim:open-chat-from-notification', {
            detail: { chatId },
          })
        );
      }
    });
  }, [initGetuiCID]);

  useEffect(() => {
    if (!isLoggedIn) return;

    // 同时初始化 FCM 和个推 CID
    void initFCM();
    void initGetuiCID();
    void initWebPush();

    return () => {
      webPushCleanupRef.current?.();
      webPushCleanupRef.current = null;
      // 清理监听器
      getPushNotifications().then((push) => {
        if (push) {
          push.removeAllListeners().catch(() => {});
        }
      });
    };
  }, [isLoggedIn, initFCM, initGetuiCID, initWebPush]);
}
