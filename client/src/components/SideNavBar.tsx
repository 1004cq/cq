/**
 * imim 桌面端侧边导航栏
 * 平板（768px+）：图标+文字竖向导航
 * 电脑（1200px+）：宽版侧边栏，含用户头像
 */
import React from 'react';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Users, Compass, Settings } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const TABS = [
  { path: '/chats', label: '消息', Icon: MessageSquare },
  { path: '/contacts', label: '通讯录', Icon: Users },
  { path: '/discover', label: '发现', Icon: Compass },
  { path: '/me', label: '设置', Icon: Settings },
];

export const SideNavBar: React.FC = () => {
  const { state } = useApp();
  const { setTab } = useAppActions();
  const activeTab = state.activeTab;
  const totalUnread = state.chats.reduce((sum, c) => sum + c.unreadCount, 0);
  // 订阅全局用户资料事件，让侧边头像在上传完成后立即刷新
  const currentUser = useCurrentUser();

  return (
    <nav className="side-nav">
      {/* 顶部 Logo / 用户头像（宽屏显示） */}
      <div className="side-nav-header">
        <div className="side-nav-logo">
          <img src="/imim-logo-formal.jpg" alt="imim" className="w-8 h-8 rounded-xl object-contain" />
          <span className="side-nav-logo-text">灵鸽</span>
        </div>
      </div>

      {/* 导航项 */}
      <div className="side-nav-items">
        {TABS.map(({ path, label, Icon }) => {
          const isActive = activeTab === path;
          const badge = path === '/chats' ? totalUnread : 0;
          return (
            <motion.button
              key={path}
              onClick={() => setTab(path)}
              className={`side-nav-item ${isActive ? 'side-nav-item-active' : ''}`}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            >
              <div className="relative">
                <motion.div
                  animate={{ scale: isActive ? 1.08 : 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                >
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.3 : 1.6}
                    className={`transition-colors duration-300 ${
                      isActive ? 'text-dove-green' : 'text-muted-foreground/60'
                    }`}
                    fill={isActive ? 'currentColor' : 'none'}
                  />
                </motion.div>
                {/* 未读角标 */}
                <AnimatePresence>
                  {badge > 0 && (
                    <motion.span
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                      className="dove-badge absolute -top-1.5 -right-2.5 text-[9px]"
                    >
                      {badge > 99 ? '99+' : badge}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <span
                className={`side-nav-label transition-colors duration-300 ${
                  isActive ? 'text-dove-green' : 'text-muted-foreground/50'
                }`}
                style={{ fontFamily: 'var(--font-wenkai)' }}
              >
                {label}
              </span>
              {/* 活跃指示器 */}
              <AnimatePresence>
                {isActive && (
                  <motion.div
                    className="side-nav-indicator"
                    initial={{ scaleY: 0, opacity: 0 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    exit={{ scaleY: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>

      {/* 底部用户头像（宽屏显示） */}
      <div className="side-nav-footer">
        <button
          onClick={() => setTab('/me')}
          className="side-nav-avatar-btn"
        >
          <DoveAvatar
            name={currentUser.name}
            id={currentUser.id}
            avatar={currentUser.avatar}
            size="sm"
          />
        </button>
      </div>
    </nav>
  );
};
