/** 中国省市区（县）三级行政区划数据与工具 */

export type ChinaPca = Record<string, Record<string, string[]>>;

export interface ChinaRegionItem {
  /** 完整展示标签，如「中国 · 广东省 · 深圳市 · 南山区」 */
  label: string;
  province: string;
  city: string;
  area: string;
}

const MUNICIPALITIES = new Set(['北京市', '上海市', '天津市', '重庆市']);

let pcaCache: ChinaPca | null = null;
let indexCache: ChinaRegionItem[] | null = null;

/** 港澳台（国标数据中单独维护） */
export const CHINA_SPECIAL_REGIONS: ChinaRegionItem[] = [
  { label: '中国 · 香港特别行政区', province: '香港特别行政区', city: '', area: '' },
  { label: '中国 · 澳门特别行政区', province: '澳门特别行政区', city: '', area: '' },
  { label: '中国 · 台湾省', province: '台湾省', city: '', area: '' },
];

export function formatChinaRegion(province: string, city: string, area: string): string {
  if (!city && !area) return `中国 · ${province}`;
  if (MUNICIPALITIES.has(province) && city === '市辖区') {
    return `中国 · ${province} · ${area}`;
  }
  if (!area) return `中国 · ${province} · ${city}`;
  return `中国 · ${province} · ${city} · ${area}`;
}

export function parseChinaRegion(value: string): Pick<ChinaRegionItem, 'province' | 'city' | 'area'> | null {
  if (!value.startsWith('中国 · ')) return null;
  const parts = value.slice('中国 · '.length).split(' · ').filter(Boolean);
  if (parts.length === 1) {
    return { province: parts[0], city: '', area: '' };
  }
  if (parts.length === 2) {
    const [province, second] = parts;
    if (MUNICIPALITIES.has(province)) {
      return { province, city: '市辖区', area: second };
    }
    return { province, city: second, area: '' };
  }
  const [province, city, area] = parts;
  if (MUNICIPALITIES.has(province)) {
    return { province, city: '市辖区', area: city };
  }
  return { province, city, area };
}

export async function loadChinaPca(): Promise<ChinaPca> {
  if (pcaCache) return pcaCache;
  const res = await fetch('/data/china-pca.json');
  if (!res.ok) throw new Error('加载省市区数据失败');
  pcaCache = await res.json();
  return pcaCache!;
}

export async function buildChinaRegionIndex(): Promise<ChinaRegionItem[]> {
  if (indexCache) return indexCache;
  const pca = await loadChinaPca();
  const items: ChinaRegionItem[] = [...CHINA_SPECIAL_REGIONS];

  for (const [province, cities] of Object.entries(pca)) {
    for (const [city, areas] of Object.entries(cities)) {
      if (!areas.length) {
        items.push({
          label: formatChinaRegion(province, city, ''),
          province,
          city,
          area: '',
        });
        continue;
      }
      for (const area of areas) {
        items.push({
          label: formatChinaRegion(province, city, area),
          province,
          city,
          area,
        });
      }
    }
  }

  indexCache = items;
  return items;
}

export function getChinaProvinces(pca: ChinaPca): string[] {
  return Object.keys(pca).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function getChinaCities(pca: ChinaPca, province: string): string[] {
  return Object.keys(pca[province] || {}).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function getChinaAreas(pca: ChinaPca, province: string, city: string): string[] {
  return (pca[province]?.[city] || []).slice().sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function searchChinaRegions(items: ChinaRegionItem[], query: string, limit = 80): ChinaRegionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items
    .filter((item) => item.label.toLowerCase().includes(q))
    .slice(0, limit);
}

export function isMunicipality(province: string): boolean {
  return MUNICIPALITIES.has(province);
}
