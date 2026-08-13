import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Link2, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
import LottieSticker from '@/components/LottieSticker';
import { authApi } from '@/lib/authFetch';

interface DiscoverPack {
  id: string;
  shortName?: string;
  shareUrl?: string;
  name: string;
  icon?: string;
  description?: string;
  sourceType?: 'remote' | 'local';
  stickerCount?: number;
  cover?: string;
  installed?: boolean;
}

interface AddStickerSheetProps {
  open: boolean;
  onClose: () => void;
  onInstalled: (packId: string) => void | Promise<void>;
}

const QUICK_DISCOVER_TAGS = ['热门', '动物', '爱心', '庆祝'];

function isAnimatedAsset(url?: string) {
  return !!url && (/\.json(\?.*)?$/i.test(url) || /\.tgs(\?.*)?$/i.test(url));
}

function normalizePack(item: any): DiscoverPack {
  return {
    id: String(item?.id || ''),
    shortName: typeof item?.shortName === 'string' ? item.shortName : undefined,
    shareUrl: typeof item?.shareUrl === 'string' ? item.shareUrl : undefined,
    name: String(item?.name || '未命名贴纸包'),
    icon: typeof item?.icon === 'string' ? item.icon : '🙂',
    description: typeof item?.description === 'string' ? item.description : '',
    sourceType: item?.sourceType === 'local' ? 'local' : 'remote',
    stickerCount: typeof item?.stickerCount === 'number' ? item.stickerCount : undefined,
    cover: typeof item?.cover === 'string' ? item.cover : '',
    installed: Boolean(item?.installed),
  };
}

async function loadDiscoverPacks(query: string) {
  const search = query.trim();
  const suffix = search ? `?q=${encodeURIComponent(search)}` : '';
  const data = await authApi(`/api/stickers/discover${suffix}`);
  if (!Array.isArray(data?.packs)) return [] as DiscoverPack[];
  return data.packs.map(normalizePack);
}

const PackCover: React.FC<{ pack: DiscoverPack }> = ({ pack }) => {
  if (isAnimatedAsset(pack.cover)) {
    return (
      <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-dove-warm-gray/35 dark:bg-slate-800/60">
        <div className="scale-[0.72]">
          <LottieSticker
            src={pack.cover!}
            width={54}
            height={54}
            fallbackEmoji={pack.icon || '🙂'}
          />
        </div>
      </div>
    );
  }

  if (pack.cover) {
    return (
      <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-dove-warm-gray/35 dark:bg-slate-800/60">
        <img
          src={pack.cover}
          alt={pack.name}
          className="h-12 w-12 object-contain select-none pointer-events-none"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-dove-warm-gray/35 text-2xl dark:bg-slate-800/60">
      {pack.icon || '🙂'}
    </div>
  );
};

const AddStickerSheet: React.FC<AddStickerSheetProps> = ({ open, onClose, onInstalled }) => {
  const [query, setQuery] = useState('');
  const [packs, setPacks] = useState<DiscoverPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submittingKey, setSubmittingKey] = useState('');
  const [submitError, setSubmitError] = useState('');

  const canInstallByInput = useMemo(() => query.trim().length > 0, [query]);

  const fetchPacks = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const next = await loadDiscoverPacks(search);
      setPacks(next);
      setError('');
    } catch (err) {
      console.error('[AddStickerSheet] 加载推荐贴纸包失败:', err);
      setPacks([]);
      setError(err instanceof Error ? err.message : '加载推荐贴纸包失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void fetchPacks(query);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fetchPacks, open, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setError('');
      setSubmitError('');
      setSubmittingKey('');
      setPacks([]);
    }
  }, [open]);

  const handleInstall = useCallback(async (input: string) => {
    const value = input.trim();
    if (!value) return;
    setSubmittingKey(value);
    setSubmitError('');
    try {
      const data = await authApi('/api/stickers/install', { input: value });
      const packId = typeof data?.pack?.id === 'string' ? data.pack.id : '';
      await onInstalled(packId);
      onClose();
    } catch (err) {
      console.error('[AddStickerSheet] 安装贴纸包失败:', err);
      setSubmitError(err instanceof Error ? err.message : '添加贴纸包失败');
    } finally {
      setSubmittingKey('');
    }
  }, [onClose, onInstalled]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18 }}
          className="absolute inset-0 z-30 flex flex-col bg-white/98 dark:bg-slate-950/98 backdrop-blur-2xl"
        >
          <div className="border-b border-border/15 px-4 pt-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-dove-ink dark:text-slate-100">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-dove-green/10 text-dove-green dark:bg-sky-400/10 dark:text-sky-300">
                    <Plus size={16} />
                  </div>
                  添加贴纸包
                </div>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  支持搜索推荐贴纸包，或直接粘贴 <span className="font-medium">t.me/addstickers/xxx</span> 链接。
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-dove-warm-gray/50 dark:hover:bg-slate-800/70"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="flex h-11 flex-1 items-center gap-2 rounded-2xl bg-dove-warm-gray/45 px-3 dark:bg-slate-800/70">
                <Search size={15} className="text-muted-foreground/70" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索贴纸包、短名或输入 addstickers 链接"
                  className="flex-1 bg-transparent text-sm text-dove-ink dark:text-slate-100 outline-none placeholder:text-muted-foreground/55"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleInstall(query)}
                disabled={!canInstallByInput || !!submittingKey}
                className="flex h-11 items-center gap-1.5 rounded-2xl bg-dove-green px-4 text-sm font-medium text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-500"
              >
                {submittingKey === query.trim() ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                添加
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {QUICK_DISCOVER_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setQuery(tag)}
                  className="rounded-full border border-border/20 bg-white/70 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-dove-green/30 hover:text-dove-green dark:bg-slate-900/60 dark:hover:border-sky-400/30 dark:hover:text-sky-300"
                >
                  #{tag}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setQuery('热门')}
                className="rounded-[20px] border border-border/20 bg-white/75 px-3 py-3 text-left shadow-sm transition-colors hover:border-dove-green/25 dark:bg-slate-900/70"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-dove-ink dark:text-slate-100">
                  <Sparkles size={14} className="text-dove-green dark:text-sky-300" />
                  继续发现贴纸包
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground/80">
                  快速查看热门、动物、爱心等精选分类，作为 wedA 面板里的“更多贴纸”入口。
                </p>
              </button>
              <div className="rounded-[20px] border border-dashed border-border/25 bg-dove-warm-gray/18 px-3 py-3 dark:bg-slate-900/50">
                <div className="flex items-center gap-2 text-sm font-medium text-dove-ink dark:text-slate-100">
                  <Link2 size={14} className="text-dove-green dark:text-sky-300" />
                  自定义导入
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground/80">
                  粘贴 <span className="font-medium">t.me/addstickers/短名</span> 即可安装外部贴纸包，无需离开当前会话。
                </p>
              </div>
            </div>

            {submitError && (
              <div className="mt-2 rounded-2xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {submitError}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/90">
                <Sparkles size={14} />
                {query.trim() ? '匹配结果' : '推荐贴纸包'}
              </div>
              <span className="text-[11px] text-muted-foreground/70">可直接加入当前面板</span>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-[24px] border border-border/15 bg-white/80 px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70"
                  >
                    <div className="h-14 w-14 rounded-2xl skeleton-enhanced" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-28 rounded-full skeleton-enhanced" />
                      <div className="h-3 w-full rounded-full skeleton-enhanced" />
                      <div className="h-3 w-20 rounded-full skeleton-enhanced" />
                    </div>
                    <div className="h-10 w-20 rounded-full skeleton-enhanced" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="rounded-[24px] border border-border/20 bg-dove-warm-gray/18 px-4 py-6 text-center text-sm text-muted-foreground/80 dark:bg-slate-900/60">
                {error}
              </div>
            ) : packs.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-border/30 px-4 py-8 text-center text-sm text-muted-foreground/75">
                暂未找到匹配的贴纸包，可以尝试输入更短的关键词或直接粘贴短链。
              </div>
            ) : (
              <div className="space-y-2">
                {packs.map((pack) => {
                  const installKey = pack.shortName || pack.id;
                  const isInstalling = submittingKey === installKey;
                  return (
                    <div
                      key={pack.id}
                      className="flex items-center gap-3 rounded-[24px] border border-border/15 bg-white/80 px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70"
                    >
                      <PackCover pack={pack} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-semibold text-dove-ink dark:text-slate-100">{pack.name}</h4>
                          {pack.installed && (
                            <span className="rounded-full bg-dove-green/10 px-2 py-0.5 text-[10px] font-medium text-dove-green dark:bg-sky-400/10 dark:text-sky-300">
                              已添加
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground/80">
                          {pack.description || '可直接加入当前贴纸面板的精选动态贴纸包。'}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
                          <span>{pack.stickerCount || 0} 项</span>
                          <span>{pack.shortName || pack.id}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleInstall(installKey)}
                        disabled={Boolean(pack.installed) || Boolean(submittingKey)}
                        className={`flex h-10 min-w-[76px] items-center justify-center gap-1 rounded-full px-3 text-xs font-medium transition-all ${
                          pack.installed
                            ? 'bg-black/5 text-muted-foreground dark:bg-white/10'
                            : 'bg-zinc-900 text-white hover:opacity-95 dark:bg-white dark:text-zinc-900'
                        } disabled:cursor-not-allowed disabled:opacity-70`}
                      >
                        {pack.installed ? (
                          <>
                            <Check size={14} />
                            已添加
                          </>
                        ) : isInstalling ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <>
                            <Plus size={14} />
                            添加
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AddStickerSheet;
