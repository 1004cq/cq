/**
 * imim — 主应用入口（响应式版本）
 * 手机：底部 Tab 导航，全屏布局
 * 平板（768px+）：左侧侧边导航 + 右侧内容区
 * 电脑（1200px+）：左侧导航 + 中间会话列表 + 右侧聊天详情（三列布局）
 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppProvider, useApp, getAppStore } from "./contexts/AppContext";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import React, { lazy, Suspense, useRef, useState, useEffect, useLayoutEffect, useMemo } from "react";
import { pageTransitions, tgEaseOut, springPage } from "@/lib/animations";
import { getDevicePerformanceLevel, getAnimationConfig } from "@/lib/performance";
import { useBreakpoint } from "@/hooks/useBreakpoint";

// Lazy-loaded Pages
const LoginPage = lazy(() => import("./pages/LoginPage"));
const ChatsPage = lazy(() => import("./pages/ChatsPage"));
const ContactsPage = lazy(() => import("./pages/ContactsPage"));
const MomentsPage = lazy(() => import("./pages/MomentsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ChatDetailPage = lazy(() => import("./pages/ChatDetailPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const MomentsSharePage = lazy(() => import("./pages/MomentsSharePage"));
// ★ 通话界面：懒加载，通过条件渲染确保每次通话重新挂载
const CallScreen = lazy(() => import("./pages/CallScreen"));
const InviteLinkPage = lazy(() => import("./pages/InviteLinkPage"));

// Components
import { BottomTabBar } from "./components/BottomTabBar";
import { SideNavBar } from "./components/SideNavBar";
import { UserProfileSheet } from "./components/UserProfileSheet";

// 页面加载占位组件 — 骨架屏风格
const PageLoader = () => (
  <motion.div 
    className="h-full flex items-center justify-center gpu-accelerated"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.15 }}
  >
    <div className="flex flex-col items-center gap-3">
      <motion.div 
        className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full gpu-accelerated"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
      />
      <motion.span 
        className="text-[10px] text-slate-400 font-medium"
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        style={{ fontFamily: 'var(--font-wenkai)' }}
      >
        加载中...
      </motion.span>
    </div>
  </motion.div>
);

// 桌面端无动画变体（三列布局不需要滑动切换）
const desktopTabVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// Tab 页面过渡动画变体 — GPU 加速版（只用 transform + opacity）
const tabVariants: Variants = {
  initial: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 80 : -80,
  }),
  animate: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.3,
      ease: tgEaseOut,
    },
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -80 : 80,
    transition: {
      duration: 0.2,
      ease: [0.55, 0.055, 0.675, 0.19],
    },
  }),
};

// 聊天详情页进入动画（TG 风格从右侧滑入）
const chatDetailVariants: Variants = {
  initial: { opacity: 0, x: '100%' },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: tgEaseOut },
  },
  exit: {
    opacity: 0,
    x: '100%',
    transition: { duration: 0.22, ease: [0.55, 0.055, 0.675, 0.19] },
  },
};

function AppContent() {
  // React 19 useSyncExternalStore bug 修复：使用强制更新计数器触发重渲染
  const [, forceUpdate] = useState(0);
  const { state } = useApp();
  const prevTabRef = useRef(state.activeTab);
  const prevLoggedInRef = useRef(state.isLoggedIn);
  const [slideDirection, setSlideDirection] = useState(0);
  const breakpoint = useBreakpoint();
  const isTabletOrDesktop = breakpoint === 'tablet' || breakpoint === 'desktop';
  const isDesktop = breakpoint === 'desktop';
  
  // 订阅 Zustand store，当 state 变化时强制重渲染
  // 使用 useLayoutEffect 确保在 DOM 更新后同步注册订阅，避免错过 store 更新
  useLayoutEffect(() => {
    const store = getAppStore();
    // 注册订阅
    const unsubscribe = store.subscribe((newStoreState, prevStoreState) => {
      if (newStoreState.state !== prevStoreState.state) {
        forceUpdate(n => n + 1);
      }
    });
    // 立即检查当前 store 值是否与渲染时的 state 一致
    // 如果 AppProvider 在渲染期间更新了 store，此处会捕捉到
    const currentState = store.getState().state;
    if (currentState !== state) {
      forceUpdate(n => n + 1);
    }
    return unsubscribe;
  }, []);
  const performanceLevel = useMemo(() => getDevicePerformanceLevel(), []);
  const animConfig = useMemo(() => getAnimationConfig(performanceLevel), [performanceLevel]);

  const tabOrder = ['/chats', '/contacts', '/discover', '/me'];

  useEffect(() => {
    const prevIdx = tabOrder.indexOf(prevTabRef.current);
    const currIdx = tabOrder.indexOf(state.activeTab);
    setSlideDirection(currIdx > prevIdx ? 1 : -1);
    prevTabRef.current = state.activeTab;
  }, [state.activeTab]);

  // 管理后台路由：支持独立域名 admin.imim.chat 或路径 /admin（无需登录，优先判断）
  // ★ 后台管理不使用 app-shell 容器，使用全屏布局以支持桌面端和移动端
  const isAdminDomain = window.location.hostname === 'admin.imim.chat';
  if (isAdminDomain || window.location.pathname.startsWith('/admin')) {
    return (
      <div className="admin-shell">
        <Suspense fallback={<PageLoader />}>
          <AdminPage />
        </Suspense>
      </div>
    );
  }

  // 朋友圈外链页面（无需登录，优先判断）
  if (window.location.pathname.startsWith('/pyq/') || window.location.pathname.startsWith('/q/')) {
    return (
      <div className="app-shell">
        <Suspense fallback={<PageLoader />}>
          <MomentsSharePage />
        </Suspense>
      </div>
    );
  }

  // 外链落地页：/im/:slug（添加好友 / 加入群组，无需登录）
  if (window.location.pathname.startsWith('/im/')) {
    return (
      <Suspense fallback={<PageLoader />}>
        <InviteLinkPage />
      </Suspense>
    );
  }

  // 未登录 → 登录页
  if (!state.isLoggedIn) {
    return (
      <div className="app-shell">
        <Suspense fallback={<PageLoader />}>
          <LoginPage />
        </Suspense>
      </div>
    );
  }

  // 通话界面覆盖层
  const callOverlay = state.call?.isActive ? (
    <Suspense fallback={null}>
      <CallScreen />
    </Suspense>
  ) : null;

  // ===== 平板/电脑端响应式布局 =====
  if (isTabletOrDesktop) {
    return (
      <div className="responsive-shell">
        {/* 左侧导航栏 */}
        <SideNavBar />

        {/* 中间内容区（Tab 页面） */}
        <div className="responsive-content">
          <AnimatePresence mode="wait" custom={slideDirection}>
            <motion.div
              key={state.activeTab}
              custom={slideDirection}
              variants={desktopTabVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full overflow-hidden"
            >
              <Suspense fallback={<PageLoader />}>
                {state.activeTab === '/chats' && <ChatsPage />}
                {state.activeTab === '/contacts' && <ContactsPage />}
                {state.activeTab === '/discover' && <MomentsPage />}
                {state.activeTab === '/me' && <ProfilePage />}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 右侧聊天详情区（桌面端三列布局） */}
        {isDesktop && (
          <div className="responsive-chat-panel">
            {state.showChat && state.currentChatId ? (
              <Suspense fallback={<PageLoader />}>
                <ChatDetailPage />
              </Suspense>
            ) : (
              <div className="responsive-chat-empty">
                <div className="flex flex-col items-center gap-3 opacity-30">
                  <img src="/imim-logo-formal.jpg" alt="imim" className="w-16 h-16 rounded-2xl object-contain" />
                  <p className="text-sm text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>
                    选择一个会话开始聊天
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 平板端：聊天详情覆盖在内容区上方 */}
        {!isDesktop && state.showChat && state.currentChatId && (
          <div className="responsive-tablet-chat">
            <Suspense fallback={<PageLoader />}>
              <ChatDetailPage />
            </Suspense>
          </div>
        )}

        <UserProfileSheet />
        {callOverlay}
      </div>
    );
  }

  // ===== 手机端布局（原有逻辑） =====
  // 聊天详情页（全屏覆盖 + TG 风格滑入动画）
  if (state.showChat && state.currentChatId) {
    return (
      <div className="app-shell">
        <motion.div
          key={`chat-${state.currentChatId}`}
          variants={chatDetailVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="h-full page-transition-container"
        >
          <Suspense fallback={<PageLoader />}>
            <ChatDetailPage />
          </Suspense>
        </motion.div>
        <UserProfileSheet />
        {callOverlay}
      </div>
    );
  }
  // 主应用 - Tab 页面切换
  return (
    <div className="app-shell flex flex-col">
      <AnimatePresence mode="wait" custom={slideDirection}>
        <motion.div
          key={state.activeTab}
          custom={slideDirection}
          variants={tabVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex-1 overflow-hidden page-transition-container"
        >
          <Suspense fallback={<PageLoader />}>
            {state.activeTab === '/chats' && <ChatsPage />}
            {state.activeTab === '/contacts' && <ContactsPage />}
            {state.activeTab === '/discover' && <MomentsPage />}
            {state.activeTab === '/me' && <ProfilePage />}
          </Suspense>
        </motion.div>
      </AnimatePresence>

      {/* 底部 Tab 导航 */}
      <BottomTabBar />
      <UserProfileSheet />
      {callOverlay}
    </div>
  );
}

function AppRouter() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

// 应用已保存的外观设置
(function applyStoredAppearance() {
  const fontSize = localStorage.getItem('imim_font_size');
  if (fontSize) {
    document.body.style.fontSize = `${fontSize}px`;
    document.documentElement.style.setProperty('--imim-font-size', `${fontSize}px`);
  }
  const chatBg = localStorage.getItem('imim_chat_bg');
  if (chatBg && chatBg !== 'default') {
    const bgMap: Record<string, string> = {
      green: 'oklch(0.96 0.025 155)',
      warm: 'oklch(0.98 0.02 80)',
      blue: 'oklch(0.97 0.015 240)',
      pink: 'oklch(0.97 0.015 350)',
      gray: 'oklch(0.95 0.003 240)',
      dark: 'oklch(0.20 0.008 240)',
      purple: 'oklch(0.97 0.015 300)',
    };
    if (bgMap[chatBg]) {
      document.documentElement.style.setProperty('--imim-chat-bg', bgMap[chatBg]);
    }
  }
})();

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider>
          <AppRouter />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
