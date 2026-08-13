/**
 * TUICallKit 集成组件
 *
 * 在用户登录后自动初始化 TUICallKit，并渲染通话 UI 组件。
 * TUICallKit 自带完整的来电弹窗、通话界面、摄像头预览等功能。
 *
 * 初始化时机：
 * 1. 页面刷新时：从 localStorage 读取 token 和用户信息，立即初始化
 * 2. 首次登录时：由 LoginPage 在登录成功后主动调用 initTUICallKit()
 */
import React, { useEffect, useRef } from 'react';
import { TUICallKit, TUICallKitAPI } from '@trtc/calls-uikit-react';

const TRTC_SDK_APP_ID = 1600136830;

// 全局初始化标志，避免重复初始化
let globalInitialized = false;
let globalInitializing = false;

/**
 * 对外暴露的初始化方法
 * 在登录成功后由 LoginPage 主动调用
 */
export async function initTUICallKit(token: string, userId: string, nickname: string, avatar: string): Promise<boolean> {
  if (globalInitialized) {
    console.log('[TUICallKit] 已初始化，跳过');
    return true;
  }
  if (globalInitializing) {
    console.log('[TUICallKit] 正在初始化中，跳过');
    return false;
  }
  globalInitializing = true;

  try {
    const res = await fetch('/api/trtc/usersig', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error('[TUICallKit] 获取 UserSig 失败:', res.status);
      globalInitializing = false;
      return false;
    }
    const data = await res.json();
    const { userSig, sdkAppId } = data;

    console.log('[TUICallKit] 开始初始化, userId:', userId, 'sdkAppId:', sdkAppId);

    await TUICallKitAPI.init({
      userID: String(userId),
      userSig,
      SDKAppID: sdkAppId || TRTC_SDK_APP_ID,
    });

    try {
      await TUICallKitAPI.setSelfInfo({
        nickName: nickname || String(userId),
        avatar: avatar || '',
      });
    } catch (e) {
      console.warn('[TUICallKit] setSelfInfo 失败:', e);
    }

    globalInitialized = true;
    globalInitializing = false;
    console.log('[TUICallKit] ✅ 初始化成功, userId:', userId);
    return true;
  } catch (err) {
    console.error('[TUICallKit] 初始化失败:', err);
    globalInitializing = false;
    return false;
  }
}

export function resetTUICallKit() {
  globalInitialized = false;
  globalInitializing = false;
}

export function isTUICallKitInitialized() {
  return globalInitialized;
}

/**
 * TUICallKitWrapper 组件
 * 始终渲染在 DOM 中，负责：
 * 1. 页面刷新时自动从 localStorage 初始化
 * 2. 提供 TUICallKit 组件挂载点
 */
export const TUICallKitWrapper: React.FC = () => {
  const initAttempted = useRef(false);

  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    // 页面刷新时，从 localStorage 读取已保存的登录信息
    const token = localStorage.getItem('user_token');
    const userId = localStorage.getItem('user_id');
    const nickname = localStorage.getItem('user_nickname') || localStorage.getItem('user_username') || '';
    const avatar = localStorage.getItem('user_avatar') || '';

    if (token && userId) {
      console.log('[TUICallKit] 页面刷新，从 localStorage 自动初始化, userId:', userId);
      initTUICallKit(token, userId, nickname, avatar);
    } else {
      console.log('[TUICallKit] 未登录，等待登录后初始化');
    }
  }, []);

  // TUICallKit 使用 createPortal 渲染到 document.body，不受容器样式影响
  // 容器本身设为 0x0 不占空间，pointer-events: none 确保不阻挡下层点击
  // TUICallKit 内部的通话 UI 通过 portal 渲染，不受此限制
  return (
    <div
      id="tuicallkit-root"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        overflow: 'visible',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      {/* TUICallKit 使用 portal 渲染，pointerEvents: auto 让通话 UI 可以正常接收点击 */}
      <div style={{ pointerEvents: 'auto' }}>
        <TUICallKit />
      </div>
    </div>
  );
};

export default TUICallKitWrapper;
