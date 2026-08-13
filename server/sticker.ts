import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { fileURLToPath } from 'url';
import { userAuth } from './auth.js';
import { preheatStickerPack, preheatUrls, getPreheatStatus, getPreheatHistory, isPreheatEnabled, preheatCdnResources } from './cdn-preheat.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STICKER_DIR = path.resolve(__dirname, '..', 'data', 'stickers');
const STICKER_FILES_DIR = path.join(STICKER_DIR, 'files');
const STICKER_MANIFEST_PATH = path.join(STICKER_DIR, 'manifest.json');
const STICKER_STATIC_PREFIX = '/api/stickers/files';

const MAX_DISCOVER_RESULTS = 24;

type StickerSourceType = 'remote' | 'local';

interface StickerItem {
  id: string;
  emoji: string;
  name: string;
  url?: string;
  file?: string;
  keywords?: string[];
  width?: number;
  height?: number;
  format?: 'json' | 'tgs' | 'webp' | 'png' | 'jpg' | 'jpeg' | 'gif';
  thumbUrl?: string;
}

interface StickerPack {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  sourceType?: StickerSourceType;
  shortName?: string;
  shareUrl?: string;
  keywords?: string[];
  stickers: StickerItem[];
}

interface StickerManifest {
  version: number;
  updatedAt: string;
  source: string;
  packs: StickerPack[];
}

function buildShareUrl(shortName?: string, packId?: string) {
  const slug = String(shortName || packId || '').trim();
  return slug ? `https://t.me/addstickers/${slug}` : '';
}

const DEFAULT_MANIFEST: StickerManifest = {
  version: 1,
  updatedAt: new Date().toISOString(),
  source: 'builtin-fallback',
  packs: [
    {
      id: 'emoji_animated',
      shortName: 'emoji_animated',
      shareUrl: buildShareUrl('emoji_animated'),
      name: '动态表情',
      icon: '😀',
      description: '默认动态表情贴纸集',
      keywords: ['默认', '动态', '情绪', '反应'],
      sourceType: 'remote',
      stickers: [
        { id: 's1', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '😀', name: '开心', format: 'json', keywords: ['开心', '笑脸', '高兴'] },
        { id: 's2', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '❤️', name: '爱心', format: 'json', keywords: ['爱心', '喜欢', '心动'] },
        { id: 's3', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '👍', name: '点赞', format: 'json', keywords: ['点赞', '支持', '好'] },
        { id: 's4', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🎉', name: '庆祝', format: 'json', keywords: ['庆祝', '派对', '礼花'] },
        { id: 's5', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '🔥', name: '火焰', format: 'json', keywords: ['火焰', '热烈', '燃'] },
        { id: 's6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '⭐', name: '星星', format: 'json', keywords: ['星星', '闪耀', '高光'] },
        { id: 's7', url: 'https://assets8.lottiefiles.com/packages/lf20_kkflmtur.json', emoji: '🎵', name: '音乐', format: 'json', keywords: ['音乐', '旋律', '音符'] },
        { id: 's8', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💬', name: '聊天', format: 'json', keywords: ['聊天', '对话', '消息'] },
      ],
    },
    {
      id: 'cute_animals',
      shortName: 'cute_animals',
      shareUrl: buildShareUrl('cute_animals'),
      name: '可爱动物',
      icon: '🐱',
      description: '默认可爱动物贴纸集',
      keywords: ['动物', '萌宠', '可爱'],
      sourceType: 'remote',
      stickers: [
        { id: 'a1', url: 'https://assets9.lottiefiles.com/packages/lf20_syqnfe7c.json', emoji: '🐱', name: '猫咪', format: 'json', keywords: ['猫咪', '可爱', '动物'] },
        { id: 'a2', url: 'https://assets3.lottiefiles.com/packages/lf20_gzl797gs.json', emoji: '🐶', name: '小狗', format: 'json', keywords: ['小狗', '狗狗', '宠物'] },
        { id: 'a3', url: 'https://assets3.lottiefiles.com/packages/lf20_gzl797gs.json', emoji: '🐼', name: '熊猫', format: 'json', keywords: ['熊猫', '国宝', '动物'] },
        { id: 'a4', url: 'https://assets6.lottiefiles.com/packages/lf20_OT15QW.json', emoji: '🦋', name: '蝴蝶', format: 'json', keywords: ['蝴蝶', '翅膀', '飞舞'] },
        { id: 'a5', url: 'https://assets6.lottiefiles.com/packages/lf20_OT15QW.json', emoji: '🐦', name: '小鸟', format: 'json', keywords: ['小鸟', '飞鸟', '动物'] },
        { id: 'a6', url: 'https://assets7.lottiefiles.com/packages/lf20_M9p23l.json', emoji: '🐠', name: '小鱼', format: 'json', keywords: ['小鱼', '海洋', '动物'] },
        { id: 'a7', url: 'https://assets4.lottiefiles.com/packages/lf20_jR229r.json', emoji: '🦊', name: '狐狸', format: 'json', keywords: ['狐狸', '萌', '动物'] },
        { id: 'a8', url: 'https://assets7.lottiefiles.com/packages/lf20_M9p23l.json', emoji: '🐰', name: '兔子', format: 'json', keywords: ['兔子', '可爱', '动物'] },
      ],
    },
    {
      id: 'gestures',
      shortName: 'gestures',
      shareUrl: buildShareUrl('gestures'),
      name: '手势动作',
      icon: '👋',
      description: '默认手势动作贴纸集',
      keywords: ['打招呼', '手势', '社交'],
      sourceType: 'remote',
      stickers: [
        { id: 'g1', url: 'https://assets4.lottiefiles.com/packages/lf20_jR229r.json', emoji: '👋', name: '挥手', format: 'json', keywords: ['挥手', '打招呼', '你好'] },
        { id: 'g2', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '👏', name: '鼓掌', format: 'json', keywords: ['鼓掌', '掌声', '支持'] },
        { id: 'g3', url: 'https://assets8.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '✌️', name: '胜利', format: 'json', keywords: ['胜利', '比耶', '成功'] },
        { id: 'g4', url: 'https://assets1.lottiefiles.com/packages/lf20_obhph3sh.json', emoji: '🤝', name: '握手', format: 'json', keywords: ['握手', '合作', '友好'] },
        { id: 'g5', url: 'https://assets3.lottiefiles.com/packages/lf20_touohxv0.json', emoji: '💪', name: '加油', format: 'json', keywords: ['加油', '力量', '努力'] },
        { id: 'g6', url: 'https://assets7.lottiefiles.com/packages/lf20_xlmz9xwm.json', emoji: '🙏', name: '祈祷', format: 'json', keywords: ['祈祷', '感谢', '拜托'] },
      ],
    },
    {
      id: 'love_romance',
      shortName: 'love_romance',
      shareUrl: buildShareUrl('love_romance'),
      name: '爱情浪漫',
      icon: '💕',
      description: '默认爱情浪漫贴纸集',
      keywords: ['爱情', '浪漫', '甜蜜'],
      sourceType: 'remote',
      stickers: [
        { id: 'l1', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '💖', name: '心跳', format: 'json', keywords: ['心跳', '浪漫', '爱心'] },
        { id: 'l2', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '😍', name: '花痴', format: 'json', keywords: ['花痴', '喜欢', '心动'] },
        { id: 'l3', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '💝', name: '礼物心', format: 'json', keywords: ['礼物', '惊喜', '爱心'] },
        { id: 'l4', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🥰', name: '甜蜜', format: 'json', keywords: ['甜蜜', '恋爱', '开心'] },
        { id: 'l5', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💌', name: '情书', format: 'json', keywords: ['情书', '告白', '爱意'] },
        { id: 'l6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '✨', name: '闪耀', format: 'json', keywords: ['闪耀', '高光', '浪漫'] },
      ],
    },
  ],
};

const DISCOVERY_CATALOG: StickerPack[] = [
  {
    id: 'office_boost',
    shortName: 'OfficeBoostLab',
    shareUrl: buildShareUrl('OfficeBoostLab'),
    name: '办公室能量',
    icon: '💼',
    description: '适合工作协作、日报反馈与团队庆祝的动态贴纸包。',
    keywords: ['办公', '工作', '会议', '效率', '团队'],
    sourceType: 'remote',
    stickers: [
      { id: 'ob-1', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '👏', name: '收到', format: 'json', keywords: ['收到', '确认', '办公'] },
      { id: 'ob-2', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '👍', name: '通过', format: 'json', keywords: ['通过', '同意', '赞成'] },
      { id: 'ob-3', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '🔥', name: '冲刺', format: 'json', keywords: ['冲刺', '加速', '项目'] },
      { id: 'ob-4', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🎉', name: '上线', format: 'json', keywords: ['上线', '庆祝', '发布'] },
      { id: 'ob-5', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💬', name: '同步', format: 'json', keywords: ['同步', '沟通', '反馈'] },
      { id: 'ob-6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '⭐', name: '里程碑', format: 'json', keywords: ['里程碑', '成果', '表扬'] },
    ],
  },
  {
    id: 'night_chill',
    shortName: 'NightChillVibes',
    shareUrl: buildShareUrl('NightChillVibes'),
    name: '深夜氛围',
    icon: '🌙',
    description: '适合深夜闲聊、晚安、音乐和放松场景的轻盈贴纸包。',
    keywords: ['深夜', '晚安', '放松', '音乐', '聊天'],
    sourceType: 'remote',
    stickers: [
      { id: 'nc-1', url: 'https://assets8.lottiefiles.com/packages/lf20_kkflmtur.json', emoji: '🎵', name: '播放中', format: 'json', keywords: ['音乐', '播放', '耳机'] },
      { id: 'nc-2', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '🙂', name: '微笑晚安', format: 'json', keywords: ['晚安', '微笑', '夜晚'] },
      { id: 'nc-3', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '🔥', name: '熬夜中', format: 'json', keywords: ['熬夜', '夜猫子', '加班'] },
      { id: 'nc-4', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '❤️', name: '晚安心动', format: 'json', keywords: ['晚安', '心动', '想你'] },
      { id: 'nc-5', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💬', name: '再聊一会', format: 'json', keywords: ['继续聊', '深夜话题', '沟通'] },
      { id: 'nc-6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '✨', name: '月光', format: 'json', keywords: ['月光', '闪烁', '氛围'] },
    ],
  },
  {
    id: 'meme_reactions',
    shortName: 'MemeReactionLab',
    shareUrl: buildShareUrl('MemeReactionLab'),
    name: '梗图反应',
    icon: '😂',
    description: '适合群聊高频情绪表达和轻松吐槽的动效贴纸包。',
    keywords: ['梗图', '吐槽', '搞笑', '群聊', '反应'],
    sourceType: 'remote',
    stickers: [
      { id: 'mr-1', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '😂', name: '笑疯了', format: 'json', keywords: ['大笑', '搞笑', '哈哈'] },
      { id: 'mr-2', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🥳', name: '整活成功', format: 'json', keywords: ['整活', '成功', '庆祝'] },
      { id: 'mr-3', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '🔥', name: '离谱但燃', format: 'json', keywords: ['离谱', '热梗', '火爆'] },
      { id: 'mr-4', url: 'https://assets1.lottiefiles.com/packages/lf20_obhph3sh.json', emoji: '🤝', name: '懂你', format: 'json', keywords: ['默契', '懂了', '好兄弟'] },
      { id: 'mr-5', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '✌️', name: '稳住', format: 'json', keywords: ['稳住', '淡定', '没事'] },
      { id: 'mr-6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '✨', name: '节目效果', format: 'json', keywords: ['节目效果', '高能', '精彩'] },
    ],
  },
  {
    id: 'pet_party_club',
    shortName: 'PetPartyClub',
    shareUrl: buildShareUrl('PetPartyClub'),
    name: '萌宠派对',
    icon: '🐾',
    description: '偏治愈和卖萌的贴纸包，适合轻聊天与日常表达。',
    keywords: ['萌宠', '治愈', '日常', '卖萌', '可爱'],
    sourceType: 'remote',
    stickers: [
      { id: 'pp-1', url: 'https://assets9.lottiefiles.com/packages/lf20_syqnfe7c.json', emoji: '🐱', name: '猫咪围观', format: 'json', keywords: ['猫咪', '围观', '可爱'] },
      { id: 'pp-2', url: 'https://assets3.lottiefiles.com/packages/lf20_gzl797gs.json', emoji: '🐶', name: '狗狗问好', format: 'json', keywords: ['狗狗', '问好', '打招呼'] },
      { id: 'pp-3', url: 'https://assets4.lottiefiles.com/packages/lf20_jR229r.json', emoji: '🦊', name: '狐狸偷看', format: 'json', keywords: ['狐狸', '偷看', '萌'] },
      { id: 'pp-4', url: 'https://assets7.lottiefiles.com/packages/lf20_M9p23l.json', emoji: '🐰', name: '兔兔蹦跶', format: 'json', keywords: ['兔子', '蹦跶', '活泼'] },
      { id: 'pp-5', url: 'https://assets6.lottiefiles.com/packages/lf20_OT15QW.json', emoji: '🦋', name: '蝴蝶飞舞', format: 'json', keywords: ['蝴蝶', '自然', '梦幻'] },
      { id: 'pp-6', url: 'https://assets7.lottiefiles.com/packages/lf20_M9p23l.json', emoji: '🐠', name: '小鱼游呀游', format: 'json', keywords: ['小鱼', '海洋', '治愈'] },
    ],
  },
  {
    id: 'love_confession',
    shortName: 'LoveConfessionKit',
    shareUrl: buildShareUrl('LoveConfessionKit'),
    name: '告白合集',
    icon: '💘',
    description: '适合恋爱聊天、告白和节日祝福的浪漫贴纸包。',
    keywords: ['恋爱', '告白', '心动', '浪漫', '节日'],
    sourceType: 'remote',
    stickers: [
      { id: 'lc-1', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '💘', name: '心动一下', format: 'json', keywords: ['心动', '告白', '爱意'] },
      { id: 'lc-2', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '😍', name: '好喜欢', format: 'json', keywords: ['喜欢', '爱慕', '甜蜜'] },
      { id: 'lc-3', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '🔥', name: '热恋中', format: 'json', keywords: ['热恋', '热情', '爱情'] },
      { id: 'lc-4', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💌', name: '发你一封情书', format: 'json', keywords: ['情书', '表白', '想你'] },
      { id: 'lc-5', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🎉', name: '官宣啦', format: 'json', keywords: ['官宣', '庆祝', '恋爱'] },
      { id: 'lc-6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '✨', name: '甜甜发光', format: 'json', keywords: ['甜蜜', '闪耀', '浪漫'] },
    ],
  },
];

function ensureStickerStore() {
  fs.mkdirSync(STICKER_DIR, { recursive: true });
  fs.mkdirSync(STICKER_FILES_DIR, { recursive: true });
  if (!fs.existsSync(STICKER_MANIFEST_PATH)) {
    fs.writeFileSync(STICKER_MANIFEST_PATH, JSON.stringify(DEFAULT_MANIFEST, null, 2), 'utf-8');
  }
}

function safeReadManifest(): StickerManifest {
  ensureStickerStore();
  try {
    const raw = fs.readFileSync(STICKER_MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StickerManifest>;
    const packs = Array.isArray(parsed.packs) ? parsed.packs : DEFAULT_MANIFEST.packs;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      source: typeof parsed.source === 'string' ? parsed.source : 'manifest',
      packs,
    };
  } catch {
    return DEFAULT_MANIFEST;
  }
}

function safeWriteManifest(manifest: StickerManifest) {
  ensureStickerStore();
  fs.writeFileSync(STICKER_MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
}

function normalizeStickerUrl(item: StickerItem): string {
  if (typeof item.url === 'string' && item.url.trim()) {
    return item.url;
  }
  if (typeof item.file === 'string' && item.file.trim()) {
    const safePath = item.file
      .split(/[\\/]+/)
      .filter(Boolean)
      .map(segment => encodeURIComponent(segment))
      .join('/');
    return `${STICKER_STATIC_PREFIX}/${safePath}`;
  }
  return '';
}

function inferFormat(item: StickerItem): StickerItem['format'] {
  const target = (item.url || item.file || '').toLowerCase();
  if (target.endsWith('.tgs')) return 'tgs';
  if (target.endsWith('.json')) return 'json';
  if (target.endsWith('.webp')) return 'webp';
  if (target.endsWith('.png')) return 'png';
  if (target.endsWith('.jpg')) return 'jpg';
  if (target.endsWith('.jpeg')) return 'jpeg';
  if (target.endsWith('.gif')) return 'gif';
  return 'webp';
}

function normalizeStickerItem(item: StickerItem): StickerItem {
  const format = item.format || inferFormat(item);
  return {
    id: item.id,
    emoji: item.emoji || '🙂',
    name: item.name || item.id,
    url: normalizeStickerUrl(item),
    file: item.file,
    keywords: Array.isArray(item.keywords) ? item.keywords : [],
    width: typeof item.width === 'number' ? item.width : undefined,
    height: typeof item.height === 'number' ? item.height : undefined,
    format,
    thumbUrl: typeof item.thumbUrl === 'string' ? item.thumbUrl : undefined,
  };
}

function normalizePack(pack: StickerPack): StickerPack {
  const stickers = Array.isArray(pack.stickers)
    ? pack.stickers.map(normalizeStickerItem).filter(item => !!item.url)
    : [];
  return {
    id: pack.id,
    name: pack.name || pack.id,
    icon: pack.icon || stickers[0]?.emoji || '🙂',
    description: pack.description || '',
    sourceType: pack.sourceType || (stickers.some(item => item.file) ? 'local' : 'remote'),
    shortName: typeof pack.shortName === 'string' && pack.shortName.trim() ? pack.shortName.trim() : pack.id,
    shareUrl: typeof pack.shareUrl === 'string' && pack.shareUrl.trim()
      ? pack.shareUrl.trim()
      : buildShareUrl(pack.shortName, pack.id),
    keywords: Array.isArray(pack.keywords) ? pack.keywords : [],
    stickers,
  };
}

function dedupePacks(packs: StickerPack[]) {
  const map = new Map<string, StickerPack>();
  packs.forEach(rawPack => {
    const pack = normalizePack(rawPack);
    if (!pack.id || map.has(pack.id)) return;
    map.set(pack.id, pack);
  });
  return Array.from(map.values());
}

function getManifest() {
  const manifest = safeReadManifest();
  const packs = dedupePacks(manifest.packs).filter(pack => pack.stickers.length > 0);
  const stickerCount = packs.reduce((sum, pack) => sum + pack.stickers.length, 0);
  return {
    ...manifest,
    packs,
    stats: {
      packCount: packs.length,
      stickerCount,
      hasLocalFiles: packs.some(pack => pack.sourceType === 'local'),
    },
  };
}

function summarizePack(pack: StickerPack, installedIds = new Set<string>()) {
  return {
    id: pack.id,
    shortName: pack.shortName || pack.id,
    shareUrl: pack.shareUrl || buildShareUrl(pack.shortName, pack.id),
    name: pack.name,
    icon: pack.icon || '🙂',
    description: pack.description || '',
    sourceType: pack.sourceType || 'remote',
    stickerCount: pack.stickers.length,
    cover: pack.stickers[0]?.thumbUrl || pack.stickers[0]?.url || '',
    installed: installedIds.has(pack.id),
  };
}

function parseStickerPackInput(input: string) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/addstickers\/([^/?#]+)/i);
  if (urlMatch?.[1]) return decodeURIComponent(urlMatch[1]).trim().toLowerCase();
  return trimmed.replace(/^@/, '').trim().toLowerCase();
}

function packMatchesQuery(pack: StickerPack, query: string) {
  if (!query) return true;
  const lowered = query.toLowerCase();
  const keywordHit = (Array.isArray(pack.keywords) ? pack.keywords : []).some(keyword => keyword.toLowerCase().includes(lowered));
  const stickerHit = pack.stickers.some(sticker => {
    const stickerKeywords = Array.isArray(sticker.keywords) ? sticker.keywords : [];
    return sticker.name.toLowerCase().includes(lowered) || stickerKeywords.some(keyword => keyword.toLowerCase().includes(lowered));
  });
  return (
    pack.id.toLowerCase().includes(lowered) ||
    pack.name.toLowerCase().includes(lowered) ||
    (pack.shortName || '').toLowerCase().includes(lowered) ||
    (pack.description || '').toLowerCase().includes(lowered) ||
    (pack.shareUrl || '').toLowerCase().includes(lowered) ||
    keywordHit ||
    stickerHit
  );
}

function getDiscoveryCatalog() {
  return dedupePacks([...DISCOVERY_CATALOG, ...DEFAULT_MANIFEST.packs]);
}

function findCatalogPack(input: string) {
  const slug = parseStickerPackInput(input);
  if (!slug) return null;
  const catalog = getDiscoveryCatalog();
  return catalog.find(pack => {
    const shortName = (pack.shortName || '').toLowerCase();
    return pack.id.toLowerCase() === slug || shortName === slug || pack.name.toLowerCase() === slug;
  }) || null;
}

router.use(userAuth);

router.get('/discover', (req: Request, res: Response) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '12'), 10) || 12, 1), MAX_DISCOVER_RESULTS);
  const manifest = getManifest();
  const installedIds = new Set(manifest.packs.map(pack => pack.id));
  const packs = getDiscoveryCatalog()
    .filter(pack => packMatchesQuery(pack, query))
    .sort((a, b) => {
      const aInstalled = installedIds.has(a.id) ? 1 : 0;
      const bInstalled = installedIds.has(b.id) ? 1 : 0;
      if (aInstalled !== bInstalled) return aInstalled - bInstalled;
      return a.name.localeCompare(b.name, 'zh-CN');
    })
    .slice(0, limit)
    .map(pack => summarizePack(pack, installedIds));

  res.json({
    success: true,
    query,
    packs,
    meta: {
      total: packs.length,
      installedCount: manifest.stats.packCount,
      source: 'builtin-catalog',
    },
  });
});

router.post('/install', (req: Request, res: Response) => {
  const rawInput = [req.body?.input, req.body?.shareUrl, req.body?.shortName, req.body?.packId]
    .map(value => String(value || '').trim())
    .find(Boolean);

  if (!rawInput) {
    return res.status(400).json({ success: false, error: '请提供贴纸包短名、链接或 packId' });
  }

  const candidate = findCatalogPack(rawInput);
  if (!candidate) {
    return res.status(404).json({ success: false, error: '暂未收录该贴纸包，请先输入推荐列表中的短链或名称' });
  }

  const currentManifest = safeReadManifest();
  const alreadyInstalled = currentManifest.packs.some(pack => pack.id === candidate.id || (pack.shortName || '').toLowerCase() === (candidate.shortName || '').toLowerCase());

  if (!alreadyInstalled) {
    currentManifest.packs = dedupePacks([candidate, ...currentManifest.packs]);
    currentManifest.updatedAt = new Date().toISOString();
    currentManifest.source = 'catalog-install';
    safeWriteManifest(currentManifest);
  }

  const manifest = getManifest();
  const installedIds = new Set(manifest.packs.map(pack => pack.id));
  const pack = manifest.packs.find(item => item.id === candidate.id) || candidate;

  // 异步触发 CDN 预热（不阻塞响应）
  if (!alreadyInstalled && isPreheatEnabled()) {
    preheatStickerPack(pack, { source: `install:${pack.id}` }).catch(err => {
      console.error(`[Sticker] CDN 预热失败 (${pack.id}):`, err);
    });
  }

  return res.json({
    success: true,
    alreadyInstalled,
    pack: summarizePack(pack, installedIds),
    meta: {
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      source: manifest.source,
      ...manifest.stats,
    },
  });
});

router.get('/packs', (_req: Request, res: Response) => {
  const includeStickers = String(_req.query.includeStickers || 'false') === 'true';
  const manifest = getManifest();
  const installedIds = new Set(manifest.packs.map(pack => pack.id));
  res.json({
    success: true,
    packs: includeStickers ? manifest.packs : manifest.packs.map(pack => summarizePack(pack, installedIds)),
    meta: {
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      source: manifest.source,
      ...manifest.stats,
    },
  });
});

router.get('/packs/:packId', (req: Request, res: Response) => {
  const manifest = getManifest();
  const pack = manifest.packs.find(item => item.id === req.params.packId);
  if (!pack) {
    return res.status(404).json({ success: false, error: '贴纸包不存在' });
  }
  return res.json({
    success: true,
    pack,
    meta: {
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      source: manifest.source,
    },
  });
});

router.get('/search', (req: Request, res: Response) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  if (!query) {
    return res.json({ success: true, query: '', results: [] });
  }

  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '60'), 10) || 60, 1), 200);
  const manifest = getManifest();
  const results = manifest.packs.flatMap(pack =>
    pack.stickers
      .filter(sticker => {
        const keywords = Array.isArray(sticker.keywords) ? sticker.keywords : [];
        return (
          sticker.name.toLowerCase().includes(query) ||
          sticker.emoji.includes(query) ||
          keywords.some(keyword => keyword.toLowerCase().includes(query)) ||
          pack.name.toLowerCase().includes(query)
        );
      })
      .map(sticker => ({
        ...sticker,
        packId: pack.id,
        packName: pack.name,
        packIcon: pack.icon || '🙂',
      }))
  ).slice(0, limit);

  return res.json({ success: true, query, results });
});

router.get('/status', (_req: Request, res: Response) => {
  const manifest = getManifest();
  const localFileCount = manifest.packs.reduce((sum, pack) => sum + pack.stickers.filter(item => !!item.file).length, 0);
  const remoteFileCount = manifest.stats.stickerCount - localFileCount;
  return res.json({
    success: true,
    status: {
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      source: manifest.source,
      stickerDir: STICKER_DIR,
      manifestPath: STICKER_MANIFEST_PATH,
      staticPrefix: STICKER_STATIC_PREFIX,
      packCount: manifest.stats.packCount,
      stickerCount: manifest.stats.stickerCount,
      localFileCount,
      remoteFileCount,
      hasLocalFiles: manifest.stats.hasLocalFiles,
    },
  });
});

router.post('/reload', (_req: Request, res: Response) => {
  const manifest = getManifest();

  // 异步触发全量 CDN 预热（不阻塞响应）
  if (isPreheatEnabled()) {
    const allUrls = manifest.packs.flatMap(pack =>
      pack.stickers.flatMap(s => [s.url, s.thumbUrl].filter(Boolean) as string[])
    );
    if (allUrls.length > 0) {
      preheatCdnResources(allUrls, { source: 'reload-all' }).catch(err => {
        console.error('[Sticker] reload 预热失败:', err);
      });
    }
  }

  return res.json({
    success: true,
    message: '贴纸 manifest 已重新加载（CDN 预热已触发）',
    meta: {
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      source: manifest.source,
      ...manifest.stats,
    },
  });
});

export {
  STICKER_DIR,
  STICKER_FILES_DIR,
  STICKER_MANIFEST_PATH,
  STICKER_STATIC_PREFIX,
  ensureStickerStore,
};

export default router;
