/**
 * 地区选择器：中国省市区（县）三级联动 + 海外地区
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronLeft, Loader2 } from 'lucide-react';
import {
  buildChinaRegionIndex,
  formatChinaRegion,
  getChinaAreas,
  getChinaCities,
  getChinaProvinces,
  isMunicipality,
  loadChinaPca,
  parseChinaRegion,
  searchChinaRegions,
  type ChinaPca,
  type ChinaRegionItem,
  CHINA_SPECIAL_REGIONS,
} from '@/lib/china-region';
import { filterRegionGroups } from '@/lib/region-data';

type Tab = 'china' | 'overseas';
type ChinaLevel = 'province' | 'city' | 'area';

export const RegionPicker: React.FC<{
  value: string;
  onClose: () => void;
  onSelect: (val: string) => void;
}> = ({ value, onClose, onSelect }) => {
  const [tab, setTab] = useState<Tab>(value.startsWith('中国 ·') || !value ? 'china' : 'overseas');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pca, setPca] = useState<ChinaPca | null>(null);
  const [index, setIndex] = useState<ChinaRegionItem[]>([]);
  const [level, setLevel] = useState<ChinaLevel>('province');
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pcaData, flatIndex] = await Promise.all([loadChinaPca(), buildChinaRegionIndex()]);
        if (cancelled) return;
        setPca(pcaData);
        setIndex(flatIndex);

        const parsed = parseChinaRegion(value);
        if (parsed?.province && pcaData[parsed.province]) {
          setProvince(parsed.province);
          if (parsed.city) {
            setCity(parsed.city);
            setLevel('area');
          } else {
            setLevel('city');
          }
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || '地区数据加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [value]);

  const overseasGroups = useMemo(() => filterRegionGroups(search), [search]);
  const chinaSearchResults = useMemo(
    () => (search.trim() ? searchChinaRegions(index, search) : []),
    [index, search],
  );

  const breadcrumb = useMemo(() => {
    const parts = ['中国'];
    if (province) parts.push(province);
    if (city && !(isMunicipality(province) && city === '市辖区')) parts.push(city);
    return parts;
  }, [province, city]);

  const handleSelectChina = (label: string) => {
    onSelect(label);
    onClose();
  };

  const goBack = () => {
    if (level === 'area') {
      setLevel('city');
      setCity('');
      return;
    }
    if (level === 'city') {
      setLevel('province');
      setProvince('');
      setCity('');
    }
  };

  const renderChinaList = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 size={22} className="animate-spin text-dove-green" />
          <span className="text-xs">加载省市区数据...</span>
        </div>
      );
    }
    if (loadError) {
      return <div className="py-10 text-center text-sm text-red-500">{loadError}</div>;
    }
    if (!pca) return null;

    if (search.trim()) {
      if (chinaSearchResults.length === 0) {
        return <div className="py-10 text-center text-sm text-muted-foreground">未找到匹配地区</div>;
      }
      return (
        <div className="settings-group">
          {chinaSearchResults.map((item) => (
            <button
              key={item.label}
              onClick={() => handleSelectChina(item.label)}
              className="settings-item w-full"
            >
              <span className="text-sm text-dove-ink text-left">{item.label}</span>
              {value === item.label && <Check size={16} className="text-dove-green flex-shrink-0" />}
            </button>
          ))}
        </div>
      );
    }

    if (level === 'province') {
      const provinces = getChinaProvinces(pca);
      return (
        <>
          <div className="px-1 py-1.5 text-[11px] text-muted-foreground/70 font-medium">港澳台</div>
          <div className="settings-group mb-3">
            {CHINA_SPECIAL_REGIONS.map((item) => (
              <button
                key={item.label}
                onClick={() => handleSelectChina(item.label)}
                className="settings-item w-full"
              >
                <span className="text-sm text-dove-ink">{item.province}</span>
                {value === item.label && <Check size={16} className="text-dove-green" />}
              </button>
            ))}
          </div>
          <div className="px-1 py-1.5 text-[11px] text-muted-foreground/70 font-medium">省份 / 直辖市 / 自治区</div>
          <div className="settings-group">
            {provinces.map((p) => (
              <button
                key={p}
                onClick={() => { setProvince(p); setLevel('city'); }}
                className="settings-item w-full"
              >
                <span className="text-sm text-dove-ink">{p}</span>
                <ChevronLeft size={14} className="text-muted-foreground rotate-180" />
              </button>
            ))}
          </div>
        </>
      );
    }

    if (level === 'city') {
      const cities = getChinaCities(pca, province);
      return (
        <div className="settings-group">
          {cities.map((c) => (
            <button
              key={c}
              onClick={() => {
                const areas = getChinaAreas(pca, province, c);
                if (areas.length === 0) {
                  handleSelectChina(formatChinaRegion(province, c, ''));
                  return;
                }
                if (areas.length === 1) {
                  handleSelectChina(formatChinaRegion(province, c, areas[0]));
                  return;
                }
                setCity(c);
                setLevel('area');
              }}
              className="settings-item w-full"
            >
              <span className="text-sm text-dove-ink">
                {isMunicipality(province) && c === '市辖区' ? '市辖区' : c}
              </span>
              <ChevronLeft size={14} className="text-muted-foreground rotate-180" />
            </button>
          ))}
        </div>
      );
    }

    const areas = getChinaAreas(pca, province, city);
    return (
      <div className="settings-group">
        {areas.map((a) => (
          <button
            key={a}
            onClick={() => handleSelectChina(formatChinaRegion(province, city, a))}
            className="settings-item w-full"
          >
            <span className="text-sm text-dove-ink">{a}</span>
            {value === formatChinaRegion(province, city, a) && (
              <Check size={16} className="text-dove-green" />
            )}
          </button>
        ))}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="dove-sheet-backdrop"
      style={{ maxWidth: '480px', margin: '0 auto' }}
    >
      <div className="dove-sheet-overlay" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="dove-sheet-content pb-8"
        style={{ maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dove-sheet-handle" />
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
          <button onClick={onClose} className="text-sm text-muted-foreground/60 font-medium">取消</button>
          <h3 className="text-sm font-semibold text-dove-ink" style={{ fontFamily: 'var(--font-wenkai)' }}>地区</h3>
          <button
            onClick={() => { onSelect(''); onClose(); }}
            className="text-sm text-dove-green font-medium"
          >
            清除
          </button>
        </div>

        <div className="px-4 pb-2 flex gap-2 flex-shrink-0">
          {(['china', 'overseas'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch(''); }}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                tab === t ? 'bg-dove-green text-white' : 'bg-dove-warm-gray text-dove-ink'
              }`}
            >
              {t === 'china' ? '中国' : '海外'}
            </button>
          ))}
        </div>

        <div className="px-4 pb-2 flex-shrink-0">
          <div className="search-bar">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'china' ? '搜索省、市、区县' : '搜索国家或地区'}
            />
          </div>
        </div>

        {tab === 'china' && !search.trim() && level !== 'province' && (
          <div className="px-5 pb-2 flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
            <button onClick={goBack} className="flex items-center gap-0.5 text-dove-green">
              <ChevronLeft size={14} />
              返回
            </button>
            <span className="mx-1">·</span>
            <span className="truncate">{breadcrumb.join(' · ')}</span>
          </div>
        )}

        <div className="overflow-y-auto flex-1 mx-4">
          {tab === 'china' ? renderChinaList() : (
            overseasGroups.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">未找到匹配地区</div>
            ) : (
              overseasGroups.map((group) => (
                <div key={group.label} className="mb-3">
                  <div className="px-1 py-1.5 text-[11px] text-muted-foreground/70 font-medium">{group.label}</div>
                  <div className="settings-group">
                    {group.regions.map((r) => (
                      <button
                        key={r}
                        onClick={() => handleSelectChina(r)}
                        className="settings-item w-full"
                      >
                        <span className="text-sm text-dove-ink">{r}</span>
                        {value === r && <Check size={16} className="text-dove-green" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default RegionPicker;
