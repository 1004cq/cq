/**
 * useJPush - 极光推送（Capacitor 原生）
 * 文档: https://docs.jiguang.cn/jpush/quickstart/iOS_quick
 * 插件: capacitor-plugin-jpush
 */
import { useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

async function registerJPushOnServer(registrationId: string, platform: 'ios' | 'android') {
  const userToken = localStorage.getItem('user_token') || localStorage.getItem('auth_token');
  if (!userToken) {
    console.log('[JPush] 用户未登录，跳过 registrationId 上报');
    return;
  }

  try {
    const res = await fetch('/api/jpush/registration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ registrationId, platform }),
    });
    if (res.ok) {
      console.log('[JPush] registrationId 上报成功');
    } else {
      console.warn('[JPush] registrationId 上报失败:', res.status);
    }
  } catch (err) {
    console.error('[JPush] registrationId 上报异常:', err);
  }
}

async function bindJPushAlias(userId: string) {
  try {
    const { JPush } = await import('capacitor-plugin-jpush');
    await JPush.setAlias({ alias: userId });
    console.log('[JPush] 别名已绑定:', userId);
  } catch (err) {
    console.warn('[JPush] 绑定别名失败:', err);
  }
}

function extractChatId(data: any): string | undefined {
  const extras = data?.rawData?.extras || data?.rawData || data?.extras || {};
  return extras.chatId || extras.chat_id;
}

/**
 * 初始化极光推送（仅 Native）
 */
export function useJPush(isLoggedIn: boolean) {
  const syncRegistration = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { JPush } = await import('capacitor-plugin-jpush');
      const { registrationId } = await JPush.getRegistrationID();
      if (!registrationId) return;
      localStorage.setItem('jpush_registration_id', registrationId);
      const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
      await registerJPushOnServer(registrationId, platform);
      const userId = localStorage.getItem('user_id');
      if (userId) await bindJPushAlias(userId);
    } catch (err) {
      console.warn('[JPush] 同步 registrationId 失败:', err);
    }
  }, []);

  const initJPush = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const { JPush } = await import('capacitor-plugin-jpush');

      await JPush.addListener('notificationReceived', (data) => {
        console.log('[JPush] 前台收到推送:', data);
        const chatId = extractChatId(data);
        if (chatId) {
          window.dispatchEvent(new CustomEvent('cqim:fcm-notification', {
            detail: { title: data.title, body: data.content, chatId },
          }));
        }
      });

      await JPush.addListener('notificationOpened', (data) => {
        console.log('[JPush] 点击通知:', data);
        const chatId = extractChatId(data);
        if (chatId) {
          window.dispatchEvent(new CustomEvent('cqim:open-chat-from-notification', {
            detail: { chatId },
          }));
        }
      });

      const start = async () => {
        await JPush.startJPush();
        if (import.meta.env.DEV) {
          await JPush.setDebugMode(true);
        }
        // registrationId 可能稍后才就绪，轮询几次
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const { registrationId } = await JPush.getRegistrationID();
          if (registrationId) {
            localStorage.setItem('jpush_registration_id', registrationId);
            break;
          }
        }
      };

      const { permission } = await JPush.checkPermissions();
      if (permission !== 'granted') {
        const req = await JPush.requestPermissions();
        if (req.permission === 'granted') {
          await start();
        } else {
          console.warn('[JPush] 通知权限被拒绝');
          await start();
        }
      } else {
        await start();
      }
    } catch (err) {
      console.error('[JPush] 初始化失败:', err);
    }
  }, []);

  useEffect(() => {
    void initJPush();
    return () => {
      if (!Capacitor.isNativePlatform()) return;
      import('capacitor-plugin-jpush')
        .then(({ JPush }) => JPush.removeListeners())
        .catch(() => {});
    };
  }, [initJPush]);

  useEffect(() => {
    if (!isLoggedIn) return;
    void syncRegistration();
  }, [isLoggedIn, syncRegistration]);
}
