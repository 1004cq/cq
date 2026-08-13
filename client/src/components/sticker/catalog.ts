import type { EmojiGroup, StickerItem, StickerSet } from './types';

export const FALLBACK_STICKER_SETS: StickerSet[] = [
  {
    id: 'emoji_animated',
    name: '动态表情',
    icon: '😀',
    sourceType: 'remote',
    mediaType: 'sticker',
    stickers: [
      { id: 's1', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '😀', name: '开心', format: 'json', mediaType: 'sticker' },
      { id: 's2', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '❤️', name: '爱心', format: 'json', mediaType: 'sticker' },
      { id: 's3', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '👍', name: '点赞', format: 'json', mediaType: 'sticker' },
      { id: 's4', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🎉', name: '庆祝', format: 'json', mediaType: 'sticker' },
      { id: 's5', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '🔥', name: '火焰', format: 'json', mediaType: 'sticker' },
      { id: 's6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '⭐', name: '星星', format: 'json', mediaType: 'sticker' },
      { id: 's7', url: 'https://assets8.lottiefiles.com/packages/lf20_kkflmtur.json', emoji: '🎵', name: '音乐', format: 'json', mediaType: 'sticker' },
      { id: 's8', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💬', name: '聊天', format: 'json', mediaType: 'sticker' },
    ],
  },
  {
    id: 'cute_animals',
    name: '可爱动物',
    icon: '🐱',
    sourceType: 'remote',
    mediaType: 'sticker',
    stickers: [
      { id: 'a1', url: 'https://assets9.lottiefiles.com/packages/lf20_syqnfe7c.json', emoji: '🐱', name: '猫咪', format: 'json', mediaType: 'sticker' },
      { id: 'a2', url: 'https://assets3.lottiefiles.com/packages/lf20_gzl797gs.json', emoji: '🐶', name: '小狗', format: 'json', mediaType: 'sticker' },
      { id: 'a3', url: 'https://assets3.lottiefiles.com/packages/lf20_gzl797gs.json', emoji: '🐼', name: '熊猫', format: 'json', mediaType: 'sticker' },
      { id: 'a4', url: 'https://assets6.lottiefiles.com/packages/lf20_OT15QW.json', emoji: '🦋', name: '蝴蝶', format: 'json', mediaType: 'sticker' },
      { id: 'a5', url: 'https://assets6.lottiefiles.com/packages/lf20_OT15QW.json', emoji: '🐦', name: '小鸟', format: 'json', mediaType: 'sticker' },
      { id: 'a6', url: 'https://assets7.lottiefiles.com/packages/lf20_M9p23l.json', emoji: '🐠', name: '小鱼', format: 'json', mediaType: 'sticker' },
      { id: 'a7', url: 'https://assets4.lottiefiles.com/packages/lf20_jR229r.json', emoji: '🦊', name: '狐狸', format: 'json', mediaType: 'sticker' },
      { id: 'a8', url: 'https://assets7.lottiefiles.com/packages/lf20_M9p23l.json', emoji: '🐰', name: '兔子', format: 'json', mediaType: 'sticker' },
    ],
  },
  {
    id: 'gestures',
    name: '手势动作',
    icon: '👋',
    sourceType: 'remote',
    mediaType: 'sticker',
    stickers: [
      { id: 'g1', url: 'https://assets4.lottiefiles.com/packages/lf20_jR229r.json', emoji: '👋', name: '挥手', format: 'json', mediaType: 'sticker' },
      { id: 'g2', url: 'https://assets3.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '👏', name: '鼓掌', format: 'json', mediaType: 'sticker' },
      { id: 'g3', url: 'https://assets8.lottiefiles.com/packages/lf20_uu0x8lqv.json', emoji: '✌️', name: '胜利', format: 'json', mediaType: 'sticker' },
      { id: 'g4', url: 'https://assets1.lottiefiles.com/packages/lf20_obhph3sh.json', emoji: '🤝', name: '握手', format: 'json', mediaType: 'sticker' },
      { id: 'g5', url: 'https://assets3.lottiefiles.com/packages/lf20_touohxv0.json', emoji: '💪', name: '加油', format: 'json', mediaType: 'sticker' },
      { id: 'g6', url: 'https://assets7.lottiefiles.com/packages/lf20_xlmz9xwm.json', emoji: '🙏', name: '祈祷', format: 'json', mediaType: 'sticker' },
    ],
  },
  {
    id: 'love_romance',
    name: '爱情浪漫',
    icon: '💕',
    sourceType: 'remote',
    mediaType: 'sticker',
    stickers: [
      { id: 'l1', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '💖', name: '心跳', format: 'json', mediaType: 'sticker' },
      { id: 'l2', url: 'https://assets2.lottiefiles.com/packages/lf20_x62chJ.json', emoji: '😍', name: '花痴', format: 'json', mediaType: 'sticker' },
      { id: 'l3', url: 'https://assets5.lottiefiles.com/packages/lf20_u4yrau.json', emoji: '💝', name: '礼物心', format: 'json', mediaType: 'sticker' },
      { id: 'l4', url: 'https://assets10.lottiefiles.com/packages/lf20_s2lryxtd.json', emoji: '🥰', name: '甜蜜', format: 'json', mediaType: 'sticker' },
      { id: 'l5', url: 'https://assets3.lottiefiles.com/packages/lf20_ydo1amjm.json', emoji: '💌', name: '情书', format: 'json', mediaType: 'sticker' },
      { id: 'l6', url: 'https://assets2.lottiefiles.com/packages/lf20_ysas4vcp.json', emoji: '✨', name: '闪耀', format: 'json', mediaType: 'sticker' },
    ],
  },
];

export const RAW_FALLBACK_GIF_SETS: StickerSet[] = [
  {
    id: 'gif_reactions',
    name: '热门反应',
    icon: '🔥',
    description: '高频情绪表达 GIF',
    sourceType: 'remote',
    mediaType: 'gif',
    stickers: [
      { id: 'gif-1', url: 'https://media.giphy.com/media/l0HlvtIPzPdt2usKs/giphy.gif', emoji: '😂', name: '开心大笑', format: 'gif', keywords: ['笑', '开心', '欢乐'], mediaType: 'gif' },
      { id: 'gif-2', url: 'https://media.giphy.com/media/l0HlvtIPzPdt2usKs/giphy.gif', emoji: '👏', name: '鼓掌', format: 'gif', keywords: ['鼓掌', '支持', '赞'], mediaType: 'gif' },
      { id: 'gif-3', url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', emoji: '🥳', name: '庆祝', format: 'gif', keywords: ['庆祝', '派对', '开心'], mediaType: 'gif' },
      { id: 'gif-4', url: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif', emoji: '❤️', name: '爱心', format: 'gif', keywords: ['爱心', '喜欢', '心动'], mediaType: 'gif' },
      { id: 'gif-5', url: 'https://media.giphy.com/media/3oz8xIsloV7zOmt81G/giphy.gif', emoji: '😮', name: '震惊', format: 'gif', keywords: ['震惊', '惊讶'], mediaType: 'gif' },
      { id: 'gif-6', url: 'https://media.giphy.com/media/9Y5BbDSkSTiY8/giphy.gif', emoji: '👍', name: '点赞', format: 'gif', keywords: ['点赞', '支持'], mediaType: 'gif' },
    ],
  },
  {
    id: 'gif_cute',
    name: '可爱日常',
    icon: '🐾',
    description: '适合聊天场景的萌系 GIF',
    sourceType: 'remote',
    mediaType: 'gif',
    stickers: [
      { id: 'gif-7', url: 'https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif', emoji: '🐱', name: '猫咪打滚', format: 'gif', keywords: ['猫', '可爱', '卖萌'], mediaType: 'gif' },
      { id: 'gif-8', url: 'https://media.giphy.com/media/13borq7Zo2kulO/giphy.gif', emoji: '🐶', name: '狗狗问好', format: 'gif', keywords: ['狗狗', '你好', '可爱'], mediaType: 'gif' },
      { id: 'gif-9', url: 'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif', emoji: '😴', name: '困困', format: 'gif', keywords: ['困', '睡觉', '晚安'], mediaType: 'gif' },
      { id: 'gif-10', url: 'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif', emoji: '🤗', name: '抱抱', format: 'gif', keywords: ['抱抱', '安慰'], mediaType: 'gif' },
      { id: 'gif-11', url: 'https://media.giphy.com/media/YTbZzCkRQCEJa/giphy.gif', emoji: '😘', name: '飞吻', format: 'gif', keywords: ['亲亲', '飞吻'], mediaType: 'gif' },
      { id: 'gif-12', url: 'https://media.giphy.com/media/QAsBwSjx9zVKoGp9nr/giphy.gif', emoji: '👋', name: '挥手', format: 'gif', keywords: ['挥手', '打招呼'], mediaType: 'gif' },
    ],
  },
  {
    id: 'gif_mood',
    name: '情绪状态',
    icon: '✨',
    description: '表达心情与状态的 GIF',
    sourceType: 'remote',
    mediaType: 'gif',
    stickers: [
      { id: 'gif-13', url: 'https://media.giphy.com/media/3orieTfp1MeFLiBQR2/giphy.gif', emoji: '🤦', name: '无语', format: 'gif', keywords: ['无语', '无奈'], mediaType: 'gif' },
      { id: 'gif-14', url: 'https://media.giphy.com/media/1BXa2alBjrCXC/giphy.gif', emoji: '😭', name: '哭哭', format: 'gif', keywords: ['哭', '难过'], mediaType: 'gif' },
      { id: 'gif-15', url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif', emoji: '🤩', name: '眼前一亮', format: 'gif', keywords: ['喜欢', '惊喜'], mediaType: 'gif' },
      { id: 'gif-16', url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif', emoji: '🙌', name: '太棒了', format: 'gif', keywords: ['太棒', '开心'], mediaType: 'gif' },
      { id: 'gif-17', url: 'https://media.giphy.com/media/3o6fJ1BM7R2EBRDnxK/giphy.gif', emoji: '😎', name: '酷', format: 'gif', keywords: ['酷', '得意'], mediaType: 'gif' },
      { id: 'gif-18', url: 'https://media.giphy.com/media/26BRuo6sLetdllPAQ/giphy.gif', emoji: '🤝', name: '安排', format: 'gif', keywords: ['安排', '合作', '成交'], mediaType: 'gif' },
    ],
  },
];

// 直接使用原始 Giphy CDN 地址，避免本地路径不存在导致 404
export const FALLBACK_GIF_SETS: StickerSet[] = RAW_FALLBACK_GIF_SETS;

export const FALLBACK_MEME_SETS: StickerSet[] = [
  {
    id: 'meme_daily',
    name: '日常回复',
    icon: '🤣',
    sourceType: 'local',
    mediaType: 'meme',
    stickers: [
      { id: 'meme-1', url: 'https://dummyimage.com/512x512/fef3c7/92400e.png&text=%E6%94%B6%E5%88%B0', emoji: '👌', name: '收到', format: 'png', keywords: ['收到', 'ok', '明白'], mediaType: 'meme' },
      { id: 'meme-2', url: 'https://dummyimage.com/512x512/dbeafe/1d4ed8.png&text=%E5%AE%89%E6%8E%92', emoji: '🤝', name: '安排', format: 'png', keywords: ['安排', '稳', '交给我'], mediaType: 'meme' },
      { id: 'meme-3', url: 'https://dummyimage.com/512x512/fee2e2/b91c1c.png&text=%E5%93%88%E5%93%88', emoji: '😂', name: '哈哈', format: 'png', keywords: ['哈哈', '笑死', '大笑'], mediaType: 'meme' },
      { id: 'meme-4', url: 'https://dummyimage.com/512x512/e9d5ff/7e22ce.png&text=%E6%88%91%E5%A4%AA%E9%9A%BE%E4%BA%86', emoji: '😭', name: '我太难了', format: 'png', keywords: ['太难了', '委屈', '崩溃'], mediaType: 'meme' },
    ],
  },
  {
    id: 'meme_mood',
    name: '情绪表达',
    icon: '🥹',
    sourceType: 'local',
    mediaType: 'meme',
    stickers: [
      { id: 'meme-5', url: 'https://dummyimage.com/512x512/dcfce7/166534.png&text=%E5%A4%AA%E6%A3%92%E4%BA%86', emoji: '🥳', name: '太棒了', format: 'png', keywords: ['太棒了', '庆祝', '开心'], mediaType: 'meme' },
      { id: 'meme-6', url: 'https://dummyimage.com/512x512/fce7f3/be185d.png&text=%E4%B8%8D%E8%A6%81%E5%95%8A', emoji: '😱', name: '不要啊', format: 'png', keywords: ['不要', '震惊', '拒绝'], mediaType: 'meme' },
      { id: 'meme-7', url: 'https://dummyimage.com/512x512/e0f2fe/0369a1.png&text=%E7%A8%8D%E7%AD%89', emoji: '⏳', name: '稍等', format: 'png', keywords: ['稍等', '等会', '马上'], mediaType: 'meme' },
      { id: 'meme-8', url: 'https://dummyimage.com/512x512/f3e8ff/6b21a8.png&text=%E7%BB%99%E4%BD%A0%E6%AF%94%E5%BF%83', emoji: '💜', name: '给你比心', format: 'png', keywords: ['比心', '喜欢', '爱你'], mediaType: 'meme' },
    ],
  },
];

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'recent',
    name: '最近',
    icon: '🕘',
    emojis: [],
  },
  {
    id: 'faces',
    name: '笑脸',
    icon: '😊',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲'],
  },
  {
    id: 'gestures',
    name: '手势',
    icon: '👍',
    emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👋','🤚','👏','🙌','🙏','💪','🫶','🤝'],
  },
  {
    id: 'hearts',
    name: '爱心',
    icon: '❤️',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💖','💘','💝','💞','💕','💓','💗'],
  },
  {
    id: 'moods',
    name: '情绪',
    icon: '🎉',
    emojis: ['🎉','🎊','🎁','🎈','🎀','🎵','🎶','🔥','⭐','✨','💯','💢','🤯','🥳','😭','😤'],
  },
];

export const RECENT_STICKERS_KEY = 'imim_recent_stickers';
export const RECENT_MEMES_KEY = 'imim_recent_memes';
export const RECENT_GIFS_KEY = 'imim_recent_gifs';
export const RECENT_EMOJIS_KEY = 'imim_recent_emojis';
export const MAX_RECENT = 24;
