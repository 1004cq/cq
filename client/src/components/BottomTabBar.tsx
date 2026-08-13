/**
 * imim 底部 Tab 导航 — 精致升级版
 * 玻璃态背景、弹性动画、精致指示器
 */
import React from 'react';
import { useApp, useAppActions } from '@/contexts/AppContext';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Users, Compass, Settings } from 'lucide-react';

const TABS = [
  { path: '/chats', label: '消息', Icon: MessageSquare },
  { path: '/contacts', label: '通讯录', Icon: Users },
  { path: '/discover', label: '发现', Icon: Compass },
  { path: '/me', label: '设置', Icon: Settings },
];

export const BottomTabBar: React.FC = () => {
  const { state } = useApp();
  const { setTab } = useAppActions();
  const activeTab = state.activeTab;

  const totalUnread = state.chats.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <nav
      className="flex items-center glass-effect border-t border-border/30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {TABS.map(({ path, label, Icon }) => {
        const isActive = activeTab === path;
        const badge = path === '/chats' ? totalUnread : 0;

        return (
          <motion.button
            key={path}
            onClick={() => setTab(path)}
            className="flex-1 flex flex-col items-center py-2.5 relative"
            whileTap={{ scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            <div className="relative">
              <motion.div
                animate={{
                  scale: isActive ? 1.12 : 1,
                  y: isActive ? -2 : 0,
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              >
                <Icon
                  size={21}
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
                    className="dove-badge absolute -top-1.5 -right-3.5"
                  >
                    {badge > 99 ? '99+' : badge}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <motion.span
              className={`text-[10px] mt-1 font-medium transition-colors duration-300 ${
                isActive ? 'text-dove-green' : 'text-muted-foreground/50'
              }`}
              style={{ fontFamily: 'var(--font-wenkai)' }}
              animate={{ opacity: isActive ? 1 : 0.55 }}
            >
              {label}
            </motion.span>

            {/* 活跃指示器 — 精致圆点 */}
            <AnimatePresence>
              {isActive && (
                <motion.div
                  layoutId="tab-dot"
                  className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-dove-green rounded-full"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  style={{ boxShadow: '0 0 6px oklch(0.58 0.14 155 / 0.4)' }}
                />
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </nav>
  );
};
