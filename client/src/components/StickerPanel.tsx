/**
 * StickerPanel — 贴纸面板壳
 * 数据加载、分类状态、网格和资源预览均拆到 components/sticker，贴纸选择仍由聊天页负责加密发送。
 */
import React, { lazy, Suspense, useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Image as ImageIcon, Loader2, Plus, RefreshCw, Search, SmilePlus, Sparkles, Sticker, X } from 'lucide-react';
import type { MediaCategory, StickerItem, StickerPanelProps } from './sticker/types';
import { useStickerPacks } from './sticker/useStickerPacks';
import PackBar from './sticker/PackBar';
import StickerGrid from './sticker/StickerGrid';
import StickerPreview from './sticker/StickerPreview';

const AddStickerSheet = lazy(() => import('@/components/AddStickerSheet'));

export type { MediaCategory, StickerItem, StickerSet } from './sticker/types';

const StickerPanel: React.FC<StickerPanelProps> = ({ onStickerSelect, onClose }) => {
  const [showAddSheet, setShowAddSheet] = useState(false);
  const {
    panelTab,
    setPanelTab,
    searchQuery,
    setSearchQuery,
    loading,
    loadError,
    fetchSets,
    stickerSets,
    memeSets,
    activeCollections,
    activeCollectionId,
    activeCollectionName,
    activeContentCount,
    currentMediaItems,
    displayEmojis,
    groupedRecentMemes,
    activeMemeSetId,
    handleCollectionChange,
    handleStickerPackChange,
    selectAndNotify,
    selectEmojiAndNotify,
  } = useStickerPacks();

  const handlePackInstalled = useCallback(async (packId: string) => {
    await fetchSets();
    setPanelTab('sticker');
    if (packId) handleStickerPackChange(packId);
    setShowAddSheet(false);
  }, [fetchSets, handleStickerPackChange, setPanelTab]);

  const searchPlaceholder = panelTab === 'gif' ? '搜索 GIF 动图...' : panelTab === 'meme' ? '搜索表情包...' : panelTab === 'emoji' ? '搜索表情...' : '搜索贴纸...';
  const contentViewKey = `${panelTab}-${activeCollectionId || 'default'}-${searchQuery ? 'search' : 'browse'}`;
  const selectItem = useCallback((item: StickerItem) => selectAndNotify(item, onStickerSelect), [onStickerSelect, selectAndNotify]);
  const selectEmoji = useCallback((emoji: string) => selectEmojiAndNotify(emoji, onStickerSelect), [onStickerSelect, selectEmojiAndNotify]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      className="relative flex flex-col overflow-hidden rounded-t-[28px] border-t border-border/30 bg-white/96 shadow-[0_-14px_40px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:bg-slate-900/96"
      style={{ height: 'min(460px, calc(100dvh - 188px))', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
    >
      <div className="border-b border-border/15 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full bg-dove-warm-gray/45 px-3 dark:bg-slate-800/70">
            <Search size={14} className="flex-shrink-0 text-muted-foreground/65" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm text-dove-ink outline-none placeholder:text-muted-foreground/55 dark:text-slate-200"
              aria-label={searchPlaceholder}
            />
          </div>
          {panelTab === 'sticker' && (
            <>
              <button type="button" onClick={() => setShowAddSheet(true)} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-dove-warm-gray/55 dark:hover:bg-slate-800/70" title="添加表情包" aria-label="添加表情包"><Plus size={16} /></button>
              <button type="button" onClick={() => void fetchSets()} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-dove-warm-gray/55 dark:hover:bg-slate-800/70" title="刷新表情包" aria-label="刷新表情包">{loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}</button>
            </>
          )}
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-dove-warm-gray/60 dark:hover:bg-slate-800/70" title="关闭" aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground/80">
          <span className="font-medium text-dove-ink/80 dark:text-slate-200/80">{activeCollectionName}</span>
          <span>{activeContentCount} 项</span>
        </div>
      </div>

      {loadError && panelTab === 'sticker' && <div className="px-3 pt-2 text-[11px] text-amber-600 dark:text-amber-400">当前使用本地回退表情包：{loadError}</div>}

      <AnimatePresence mode="wait">
        <motion.div key={contentViewKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16 }} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
          {panelTab === 'sticker' && loading && activeContentCount === 0 ? (
            <div className="grid grid-cols-4 gap-2.5 py-3 sm:grid-cols-5">
              {Array.from({ length: 15 }, (_, index) => <div key={index} className="flex aspect-square items-center justify-center rounded-[22px] bg-dove-warm-gray/18 dark:bg-slate-800/50"><div className="h-12 w-12 rounded-2xl skeleton-enhanced" /></div>)}
            </div>
          ) : activeContentCount === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-muted-foreground/50"><Sparkles size={24} className="mb-2 opacity-40" /><span className="text-xs">{searchQuery ? '未找到匹配内容' : panelTab === 'gif' ? '还没有使用过 GIF' : panelTab === 'meme' ? '还没有使用过表情包' : panelTab === 'emoji' ? '还没有使用过表情' : '还没有使用过贴纸'}</span><span className="mt-1 text-[10px]">切换分类或尝试搜索其他关键词</span></div>
          ) : panelTab === 'emoji' ? (
            <div className="grid grid-cols-8 gap-1.5">{displayEmojis.map((emoji) => <motion.button type="button" key={`emoji-${emoji}`} whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.86 }} onClick={() => selectEmoji(emoji)} className="flex h-10 w-10 items-center justify-center rounded-2xl text-[22px] transition-colors hover:bg-dove-warm-gray/40 dark:hover:bg-slate-700/50" title={emoji}>{emoji}</motion.button>)}</div>
          ) : panelTab === 'meme' && activeMemeSetId === 'recent' && !searchQuery.trim() ? (
            <div className="space-y-4">{groupedRecentMemes.map((section) => <section key={section.id} className="space-y-2"><div className="flex items-center justify-between px-1"><h4 className="text-xs font-medium text-dove-ink/80 dark:text-slate-200/80">{section.name}</h4><span className="text-[10px] text-muted-foreground/70">{section.items.length} 项</span></div><div className="grid grid-cols-4 gap-2">{section.items.map((item) => <button type="button" key={`${section.id}-${item.id}`} onClick={() => selectItem({ ...item, mediaType: 'meme' })} className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-[22px] bg-white/55 p-1 transition-colors hover:bg-dove-warm-gray/30 dark:bg-slate-800/20 dark:hover:bg-slate-700/40" title={`${item.emoji} ${item.name}`}><StickerPreview sticker={item} /><div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent px-2 pb-1.5 pt-4 opacity-90"><div className="truncate text-[10px] font-medium text-white/92">{item.name}</div></div></button>)}</div></section>)}</div>
          ) : (
            <StickerGrid items={currentMediaItems} panelTab={panelTab as 'sticker' | 'meme' | 'gif'} onSelect={selectItem} />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="border-t border-border/15 bg-white/82 px-2 pt-2 dark:bg-slate-900/82">
        <PackBar panelTab={panelTab} collections={activeCollections} activeCollectionId={activeCollectionId} stickerSets={stickerSets} memeSets={memeSets} onChange={handleCollectionChange} />
        <div className="mx-auto grid w-full max-w-md grid-cols-4 gap-1 rounded-full bg-black/5 p-1 dark:bg-white/5">
          {([
            ['sticker', <Sticker size={15} />, '贴纸'],
            ['gif', <ImageIcon size={15} />, 'GIF动图'],
            ['meme', <ImageIcon size={15} />, '表情包'],
            ['emoji', <SmilePlus size={15} />, '表情'],
          ] as const).map(([tab, icon, label]) => <button type="button" key={tab} onClick={() => { setPanelTab(tab); setSearchQuery(''); }} className={`flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 py-2 text-xs transition-all sm:px-3 sm:text-sm ${panelTab === tab ? 'bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900' : 'text-muted-foreground hover:text-foreground'}`}>{icon}<span className="truncate">{label}</span></button>)}
        </div>
      </div>

      {showAddSheet && <Suspense fallback={<div className="fixed inset-0 z-[70] bg-black/20" />}><AddStickerSheet open onClose={() => setShowAddSheet(false)} onInstalled={handlePackInstalled} /></Suspense>}
    </motion.div>
  );
};

export default StickerPanel;
