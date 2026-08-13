/** 海外地区选项（中国省市区见 china-region.ts + china-pca.json） */
export interface RegionGroup {
  label: string;
  regions: string[];
}

export const OVERSEAS_REGION_GROUPS: RegionGroup[] = [
  {
    label: '亚洲',
    regions: ['日本', '韩国', '新加坡', '泰国', '马来西亚', '印度尼西亚', '越南', '菲律宾', '印度'],
  },
  {
    label: '欧美及其他',
    regions: [
      '美国', '加拿大', '英国', '德国', '法国', '意大利', '西班牙',
      '荷兰', '瑞士', '澳大利亚', '新西兰', '俄罗斯', '巴西', '其他',
    ],
  },
];

/** @deprecated 使用 OVERSEAS_REGION_GROUPS；中国地区请用 ChinaRegionPicker */
export const REGION_GROUPS = OVERSEAS_REGION_GROUPS;

export const ALL_REGIONS = OVERSEAS_REGION_GROUPS.flatMap((g) => g.regions);

export function filterRegionGroups(query: string): RegionGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return OVERSEAS_REGION_GROUPS;
  return OVERSEAS_REGION_GROUPS
    .map((group) => ({
      ...group,
      regions: group.regions.filter((region) => region.toLowerCase().includes(q)),
    }))
    .filter((group) => group.regions.length > 0);
}
