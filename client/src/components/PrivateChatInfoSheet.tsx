/**
 * 私聊聊天详情页（微信风格全屏 Sheet）
 * 对应截图中的"聊天详情"页面：
 * - 顶部成员头像区（点击跳转到用户资料页）
 * - 查找聊天内容
 * - 消息免打扰 / 置顶聊天 / 聊天密码 / 消息回执 开关
 * - 设置当前聊天背景
 * - 消息通知设置
 * - 投诉
 * - 清空聊天记录
 */
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DoveAvatar } from '@/components/DoveAvatar';
import { toast } from 'sonner';
import { authApi } from '@/lib/authFetch';

/* ====== 微信风格 Toggle 开关 ====== */
const WxToggle: React.FC<{ on: boolean; onTap: () => void }> = ({ on, onTap }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={(e) => { e.stopPropagation(); onTap(); }}
    style={{
      position: 'relative',
      width: 51,
      minWidth: 51,
      height: 31,
      borderRadius: 16,
      backgroundColor: on ? '#34c759' : '#e5e5ea',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      transition: 'background-color 0.2s',
      flexShrink: 0,
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: 2,
        left: on ? 22 : 2,
        width: 27,
        height: 27,
        borderRadius: '50%',
        backgroundColor: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        transition: 'left 0.2s',
      }}
    />
  </button>
);

/* ====== 设置行 ====== */
const SettingRow: React.FC<{
  label: string;
  value?: string;
  hasArrow?: boolean;
  onClick?: () => void;
  toggle?: { value: boolean; onChange: () => void };
  isLast?: boolean;
  labelColor?: string;
  center?: boolean;
  desc?: string;
}> = ({ label, value, hasArrow, onClick, toggle, isLast, labelColor, center, desc }) => (
  <div>
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: center ? 'center' : 'space-between',
        padding: '13px 16px',
        borderBottom: isLast && !desc ? 'none' : desc ? 'none' : '1px solid rgba(0,0,0,0.05)',
        cursor: onClick ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
        minHeight: 44,
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      <span style={{
        fontSize: 15,
        color: labelColor || '#1c1c1e',
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {toggle ? (
        <WxToggle on={toggle.value} onTap={toggle.onChange} />
      ) : !center ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12, minWidth: 0 }}>
          {value && (
            <span style={{
              fontSize: 15,
              color: '#8e8e93',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 180,
            }}>
              {value}
            </span>
          )}
          {hasArrow && <ChevronRight size={18} color="#c7c7cc" style={{ flexShrink: 0 }} />}
        </div>
      ) : null}
    </div>
    {desc && (
      <div style={{
        padding: '0 16px 10px',
        fontSize: 12,
        color: '#8e8e93',
        lineHeight: 1.4,
        borderBottom: isLast ? 'none' : '1px solid rgba(0,0,0,0.05)',
      }}>
        {desc}
      </div>
    )}
  </div>
);

interface PrivateChatInfoSheetProps {
  chatId: string;
  chatName: string;
  chatAvatar?: string;
  otherUserId: string;
  isMuted: boolean;
  isPinned: boolean;
  onClose: () => void;
  onToggleMute: () => void;
  onTogglePin: () => void;
  onClearMessages: () => void;
  onShowProfile: (userId: string) => void;
}

export const PrivateChatInfoSheet: React.FC<PrivateChatInfoSheetProps> = ({
  chatId,
  chatName,
  chatAvatar,
  otherUserId,
  isMuted,
  isPinned,
  onClose,
  onToggleMute,
  onTogglePin,
  onClearMessages,
  onShowProfile,
}) => {
  // 本地开关状态（聊天密码、消息回执 — 后端暂未支持，仅前端 toggle）
  const [chatPassword, setChatPassword] = useState(false);
  const [readReceipt, setReadReceipt] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // 投诉
  const handleReport = async () => {
    const reason = prompt('请输入投诉原因：');
    if (!reason || !reason.trim()) return;
    try {
      await authApi('/api/report', {
        targetType: 'user',
        targetId: otherUserId,
        reason: reason.trim(),
      });
      toast.success('投诉已提交，我们会尽快处理');
    } catch (e: any) {
      toast.error(e.message || '投诉提交失败');
    }
  };

  const content = (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0, 0.67, 0] }}
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 200,
          background: '#f2f2f7',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 顶部导航栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          paddingTop: 'max(env(safe-area-inset-top, 12px), 12px)',
          background: '#f2f2f7',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', gap: 2,
              color: '#1c1c1e', fontSize: 14, fontWeight: 500,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0,
            }}
          >
            <ChevronLeft size={24} color="#1c1c1e" />
          </button>
          <span style={{ fontSize: 17, fontWeight: 600, color: '#1c1c1e' }}>
            聊天详情
          </span>
          <div style={{ width: 24 }} />
        </div>

        {/* 内容区域 */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}>
          {/* ========== 成员头像区 ========== */}
          <div style={{
            background: '#fff',
            padding: '20px 16px',
            marginTop: 0,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              flexWrap: 'wrap',
            }}>
              {/* 对方头像 - 点击跳转到用户资料页 */}
              <div
                onClick={() => onShowProfile(otherUserId)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  cursor: 'pointer',
                  width: 56,
                }}
              >
                <DoveAvatar
                  name={chatName}
                  avatar={chatAvatar}
                  size={48}
                />
                <span style={{
                  fontSize: 12, color: '#8e8e93',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', width: '100%', textAlign: 'center',
                }}>
                  {chatName}
                </span>
              </div>

              {/* + 按钮（创建群聊/邀请成员） */}
              <div
                onClick={() => toast('创建群聊功能开发中')}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  cursor: 'pointer',
                  width: 56,
                }}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 8,
                  border: '1.5px dashed #c7c7cc',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Plus size={22} color="#c7c7cc" />
                </div>
              </div>
            </div>
          </div>

          {/* ========== 查找聊天内容 ========== */}
          <div style={{ background: '#fff', marginTop: 10 }}>
            <SettingRow
              label="查找聊天内容"
              hasArrow
              isLast
              onClick={() => toast('查找聊天内容功能开发中')}
            />
          </div>

          {/* ========== 消息免打扰 + 置顶聊天 + 聊天密码 + 消息回执 ========== */}
          <div style={{ background: '#fff', marginTop: 10 }}>
            <SettingRow
              label="消息免打扰"
              toggle={{ value: isMuted, onChange: onToggleMute }}
            />
            <SettingRow
              label="置顶聊天"
              toggle={{ value: isPinned, onChange: onTogglePin }}
            />
            <SettingRow
              label="聊天密码"
              toggle={{
                value: chatPassword,
                onChange: () => {
                  setChatPassword(!chatPassword);
                  toast(chatPassword ? '聊天密码已关闭' : '聊天密码已开启');
                },
              }}
            />
            <SettingRow
              label="消息回执"
              isLast
              toggle={{
                value: readReceipt,
                onChange: () => {
                  setReadReceipt(!readReceipt);
                  toast(readReceipt ? '消息回执已关闭' : '消息回执已开启');
                },
              }}
              desc="开启后，发送的聊天信息会提示已读未读情况"
            />
          </div>

          {/* ========== 设置当前聊天背景 ========== */}
          <div style={{ background: '#fff', marginTop: 10 }}>
            <SettingRow
              label="设置当前聊天背景"
              hasArrow
              isLast
              onClick={() => toast('设置聊天背景功能开发中')}
            />
          </div>

          {/* ========== 消息通知设置 + 投诉 ========== */}
          <div style={{ background: '#fff', marginTop: 10 }}>
            <SettingRow
              label="消息通知设置"
              hasArrow
              onClick={() => toast('消息通知设置功能开发中')}
            />
            <SettingRow
              label="投诉"
              hasArrow
              isLast
              onClick={handleReport}
            />
          </div>

          {/* ========== 清空聊天记录 ========== */}
          <div style={{ background: '#fff', marginTop: 10 }}>
            <SettingRow
              label="清空聊天记录"
              labelColor="#ff3b30"
              center
              isLast
              onClick={() => setShowClearConfirm(true)}
            />
          </div>

          {/* 底部安全间距 */}
          <div style={{ height: 'max(env(safe-area-inset-bottom, 20px), 20px)' }} />
        </div>

        {/* 清空聊天记录确认弹窗 */}
        <AnimatePresence>
          {showClearConfirm && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 250 }}
                onClick={() => setShowClearConfirm(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                style={{
                  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  zIndex: 251, background: '#fff', borderRadius: 14, width: 270,
                  overflow: 'hidden', textAlign: 'center',
                }}
              >
                <div style={{ padding: '20px 16px 16px' }}>
                  <p style={{ fontSize: 17, fontWeight: 600, color: '#1c1c1e' }}>清空聊天记录</p>
                  <p style={{ fontSize: 13, color: '#8e8e93', marginTop: 8 }}>
                    确定要清空与 {chatName} 的所有聊天记录吗？此操作不可恢复。
                  </p>
                </div>
                <div style={{ display: 'flex', borderTop: '0.5px solid rgba(0,0,0,0.1)' }}>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    style={{ flex: 1, padding: '12px 0', fontSize: 17, color: '#007AFF', background: 'none', border: 'none', borderRight: '0.5px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}
                  >取消</button>
                  <button
                    onClick={() => {
                      onClearMessages();
                      setShowClearConfirm(false);
                      toast.success('聊天记录已清空');
                    }}
                    style={{ flex: 1, padding: '12px 0', fontSize: 17, fontWeight: 600, color: '#ff3b30', background: 'none', border: 'none', cursor: 'pointer' }}
                  >确定</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );

  return ReactDOM.createPortal(content, document.body);
};
