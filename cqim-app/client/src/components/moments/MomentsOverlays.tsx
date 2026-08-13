import React, { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '@/lib/authFetch';

const PublishActionSheet: React.FC<{
  onClose: () => void;
  onSelect: (mode: 'photo' | 'camera' | 'video' | 'text') => void;
}> = ({ onClose, onSelect }) => {
  const items: { mode: 'photo' | 'camera' | 'video' | 'text'; label: string; bgColor: string; icon: React.ReactNode }[] = [
    {
      mode: 'photo', label: '从相册选图片', bgColor: '#07C160',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><polyline points="8 14 11 10 14 14" /><polyline points="14 12 16 10 19 14" /><circle cx="8" cy="8" r="1.5" fill="#fff" stroke="none" /></svg>,
    },
    {
      mode: 'camera', label: '拍一张照片', bgColor: '#2196F3',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>,
    },
    {
      mode: 'video', label: '选择视频', bgColor: '#F44336',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><rect x="2" y="4" width="15" height="16" rx="2" ry="2" /><polygon points="22 6 17 12 22 18 22 6" fill="#fff" stroke="none" /></svg>,
    },
    {
      mode: 'text', label: '仅文字', bgColor: '#FF9800',
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
    },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 480, background: "#fff", borderRadius: "16px 16px 0 0", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "8px 0" }}>
          {items.map((item, idx) => (
            <button
              key={item.mode}
              onClick={() => onSelect(item.mode)}
              style={{
                width: "100%", padding: "16px 20px", background: "none", border: "none",
                borderBottom: idx < items.length - 1 ? "0.5px solid #f0f0f0" : "none",
                fontSize: 16, color: "#282828", cursor: "pointer", display: "flex", alignItems: "center", gap: 16,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 10, background: item.bgColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {item.icon}
              </div>
              <span style={{ flex: 1, textAlign: "left", fontSize: 16, fontWeight: 400 }}>{item.label}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          ))}
        </div>
        <div style={{ height: 8, background: "#f5f5f5" }} />
        <button onClick={onClose} style={{ width: "100%", padding: "16px", background: "none", border: "none", fontSize: 16, color: "#888", cursor: "pointer" }}>取消</button>
        <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
      </div>
    </div>
  );
};

// ============ 设置底部菜单 ============
const SettingsActionSheet: React.FC<{
  onClose: () => void;
  onSortMoments: () => void;
  userId: string;
}> = ({ onClose, onSortMoments }) => {
  const handleProfileSettings = () => {
    onClose();
    window.location.hash = '#/profile/settings';
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 480, background: "#fff", borderRadius: "16px 16px 0 0", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "8px 0" }}>
          <button
            onClick={onSortMoments}
            style={{ width: "100%", padding: "16px", background: "none", border: "none", borderBottom: "0.5px solid #f0f0f0", fontSize: 16, color: "#282828", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#576b95" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            排序动态
          </button>
          <button
            onClick={handleProfileSettings}
            style={{ width: "100%", padding: "16px", background: "none", border: "none", borderBottom: "0.5px solid #f0f0f0", fontSize: 16, color: "#282828", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#576b95" strokeWidth={2}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
            个人设置
          </button>
        </div>
        <div style={{ height: 8, background: "#f5f5f5" }} />
        <button onClick={onClose} style={{ width: "100%", padding: "16px", background: "none", border: "none", fontSize: 16, color: "#888", cursor: "pointer" }}>取消</button>
        <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
      </div>
    </div>
  );
};

// ============ 动态管理页面（拖拽排序、删除、编辑） ============
interface MyMoment {
  id: string; content: string; visibility: string; location?: string;
  isPinned: boolean; sortOrder: number; createdAt: number;
  media: { type: string; url: string }[];
  likeCount: number; commentCount: number;
}

const MomentsManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [moments, setMoments] = useState<MyMoment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editVisibility, setEditVisibility] = useState('public');
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const touchStartY = useRef(0);
  const touchItemIdx = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchMyMoments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authApi('/api/moments/my', undefined, 'GET');
      setMoments(data?.moments || []);
    } catch (err) {
      console.error('[moments-manager] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMyMoments(); }, [fetchMyMoments]);

  const handleDragStart = (idx: number) => { dragItem.current = idx; setDragIdx(idx); };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; };
  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      const items = [...moments];
      const [removed] = items.splice(dragItem.current, 1);
      items.splice(dragOverItem.current, 0, removed);
      setMoments(items);
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDragIdx(null);
  };

  const handleTouchStart = (idx: number, e: React.TouchEvent) => {
    touchItemIdx.current = idx;
    touchStartY.current = e.touches[0].clientY;
    setDragIdx(idx);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchItemIdx.current === null || !listRef.current) return;
    const currentY = e.touches[0].clientY;
    const items = listRef.current.querySelectorAll('[data-drag-item]');
    let targetIdx = touchItemIdx.current;
    items.forEach((item, idx) => {
      const rect = item.getBoundingClientRect();
      if (currentY > rect.top && currentY < rect.bottom) targetIdx = idx;
    });
    if (targetIdx !== touchItemIdx.current) {
      const arr = [...moments];
      const [removed] = arr.splice(touchItemIdx.current, 1);
      arr.splice(targetIdx, 0, removed);
      setMoments(arr);
      touchItemIdx.current = targetIdx;
    }
  };
  const handleTouchEnd = () => { touchItemIdx.current = null; setDragIdx(null); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await authApi('/api/moments/reorder', { ids: moments.map(m => m.id) }, 'PUT');
      onClose();
    } catch (err) {
      console.error('[moments-manager] 保存排序失败:', err);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条动态吗？')) return;
    try {
      await authApi(`/api/moments/${id}`, undefined, 'DELETE');
      setMoments(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      console.error('[moments-manager] 删除失败:', err);
      alert('删除失败');
    }
  };

  const startEdit = (m: MyMoment) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditVisibility(m.visibility);
  };
  const handleEditSave = async () => {
    if (!editingId) return;
    try {
      await authApi(`/api/moments/${editingId}`, { content: editContent, visibility: editVisibility }, 'PUT');
      setMoments(prev => prev.map(m => m.id === editingId ? { ...m, content: editContent, visibility: editVisibility } : m));
      setEditingId(null);
    } catch (err) {
      console.error('[moments-manager] 编辑失败:', err);
      alert('编辑失败');
    }
  };

  const getThumb = (m: MyMoment) => {
    if (m.media.length === 0) return null;
    return m.media[0];
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "#f5f5f5", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 56, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: "0.5px solid #e8e8e8", flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 14, color: "#888", cursor: "pointer" }}>取消</button>
        <span style={{ fontSize: 17, fontWeight: 600, color: "#282828" }}>拖拽排序</span>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{ background: "#07C160", color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 14, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>加载中...</div>
        ) : moments.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>暂无动态</div>
        ) : (
          moments.map((m, idx) => (
            <div
              key={m.id}
              data-drag-item
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={e => e.preventDefault()}
              style={{
                background: dragIdx === idx ? "#e8f4fd" : "#fff",
                margin: "0 12px 8px", borderRadius: 8, padding: "12px",
                display: "flex", alignItems: "center", gap: 12,
                boxShadow: dragIdx === idx ? "0 4px 12px rgba(0,0,0,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
                transition: "box-shadow 0.2s, background 0.2s", cursor: "grab", userSelect: "none",
              }}
            >
              <div
                onTouchStart={e => handleTouchStart(idx, e)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{ flexShrink: 0, cursor: "grab", padding: "4px 0", touchAction: "none" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth={2}>
                  <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </div>

              <div style={{ width: 56, height: 56, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {getThumb(m) ? (
                  getThumb(m)!.type === 'video' ? (
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                      <video src={getThumb(m)!.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline preload="metadata" />
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      </div>
                    </div>
                  ) : (
                    <img src={getThumb(m)!.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={1.5}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "#282828", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.content || '[图片/视频]'}
                </div>
                <div style={{ fontSize: 12, color: "#999", marginTop: 4, display: "flex", gap: 8 }}>
                  <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                  <span style={{ color: m.visibility === 'public' ? '#07C160' : m.visibility === 'friends' ? '#576b95' : '#999' }}>
                    {m.visibility === 'public' ? '公开' : m.visibility === 'friends' ? '好友' : '私密'}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={e => { e.stopPropagation(); startEdit(m); }}
                  style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "4px 10px", fontSize: 12, color: "#576b95", cursor: "pointer" }}
                >编辑</button>
                <button
                  onClick={e => { e.stopPropagation(); void handleDelete(m.id); }}
                  style={{ background: "none", border: "1px solid #fdd", borderRadius: 4, padding: "4px 10px", fontSize: 12, color: "#ff4d4f", cursor: "pointer" }}
                >删除</button>
              </div>
            </div>
          ))
        )}
      </div>

      {editingId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setEditingId(null)}>
          <div style={{ width: "90%", maxWidth: 400, background: "#fff", borderRadius: 12, padding: 20 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600, color: "#282828" }}>编辑动态</h3>
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{ width: "100%", height: 120, border: "1px solid #ddd", borderRadius: 8, padding: 12, fontSize: 14, resize: "none", outline: "none", boxSizing: "border-box" }}
              autoFocus
            />
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "#888" }}>可见性：</span>
              <select
                value={editVisibility}
                onChange={e => setEditVisibility(e.target.value)}
                style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 8px", fontSize: 13, outline: "none" }}
              >
                <option value="public">公开</option>
                <option value="friends">好友可见</option>
                <option value="private">仅自己</option>
              </select>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button onClick={() => setEditingId(null)} style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "8px 20px", fontSize: 14, color: "#888", cursor: "pointer" }}>取消</button>
              <button onClick={() => void handleEditSave()} style={{ background: "#07C160", color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontSize: 14, cursor: "pointer" }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { PublishActionSheet, SettingsActionSheet, MomentsManager };
