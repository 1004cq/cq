/**
 * DoveIM 全局状态管理
 * 「清风徐来」设计 — 东方极简自然主义
 * 使用 React Context + useReducer 实现轻量状态管理
 */

// ============ 类型定义 ============

export interface UserPrivacySettings {
  /** 是否允许通过账号ID搜索添加 */
  allowSearchById: boolean;
  /** 是否允许通过手机号搜索添加 */
  allowSearchByPhone: boolean;
  /** 是否允许通过邮箱搜索添加 */
  allowSearchByEmail: boolean;
}

export interface User {
  id: string;
  /** 账号ID（唯一，最短1位，用户可自定义） */
  uniqueId: string;
  name: string;
  avatar: string;
  status: 'online' | 'offline' | 'busy';
  bio?: string;
  phone?: string;
  email?: string;
  letter?: string; // 通讯录首字母
  privacy?: UserPrivacySettings;
  /** 是否为官方账号 */
  isOfficial?: boolean;
  /** 是否为认证账号（蓝色徽章） */
  isVerified?: boolean;
  /** 是否为机器人账号 */
  isBot?: boolean;
  /** 机器人类型：'AI' | 'service' | 'notify' */
  botType?: 'AI' | 'service' | 'notify';
  /** 在线设备标签，如 "Windows · Chrome"（在线时有值） */
  deviceLabel?: string | null;
  /** 最后在线时间（Unix ms，离线时有值） */
  lastSeen?: number | null;
  /** 资料最后更新时间（Unix ms，用于多端合并去重） */
  profileUpdatedAt?: number;
}

/** 好友请求 */
export interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromUniqueId: string;
  toId: string;
  message?: string;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: number;
  searchMethod: 'id' | 'phone' | 'email';
}

// 阅后即焚定时选项
export type BurnAfterReadTimer =
  | 5        // 5秒
  | 10       // 10秒
  | 30       // 30秒
  | 60       // 1分钟
  | 300      // 5分钟
  | 3600     // 1小时
  | 86400    // 1天
  | 604800;  // 1周

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'file' | 'voice' | 'system' | 'call' | 'location' | 'location_share' | 'sticker';
  timestamp: number;
  /** 服务端顺序号或游标（私聊可为空，群聊使用 seq） */
  seq?: number;
  cursor?: string;
  /** 本地缓存方向，不参与服务器协议 */
  direction?: 'inbound' | 'outbound';
  /** 解密缓存状态，不记录到服务器 */
  decryptionStatus?: 'decrypted' | 'ciphertext' | 'failed' | 'legacy';
  isEncrypted: boolean;
  reactions: Record<string, number>;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  replyTo?: string;
  imageUrl?: string;
  /** 视频消息 URL */
  videoUrl?: string;
  fileName?: string;
  fileSize?: string;
  duration?: number; // 语音时长(秒)
  encryptedEnvelope?: any; // E2EE Signal Protocol 加密信封
  decryptedContent?: string; // 解密后的明文内容

  // ===== 隐私安全扩展字段 =====
  /** 阅后即焚：消息被阅读后多少秒后销毁（undefined 表示不自毁） */
  burnAfterRead?: BurnAfterReadTimer;
  /** 阅后即焚：消息被阅读的时间戳（开始倒计时的起点） */
  readAt?: number;
  /** 阅后即焚：消息是否已被销毁（用于动画触发） */
  isBurned?: boolean;
  /** 防转发/防复制：是否限制二次传播 */
  forwardRestricted?: boolean;

  // ===== 消息防篡改字段 =====
  /** HMAC-SHA256 签名（hex 编码，覆盖 content + senderId + chatId + msgType + timestamp） */
  hmac?: string;
  /** 消息完整性验证状态：verified=已验证 | tampered=已篡改 | unverified=未验证 */
  integrityStatus?: 'verified' | 'tampered' | 'unverified';

  // ===== 加密语音消息字段 =====
  /** AES-256-GCM 加密后的音频数据（Base64） */
  voiceCiphertext?: string;
  /** 加密 IV（Base64） */
  voiceIv?: string;
  /** 加密密钥（Base64，演示用；生产环境应通过 Signal 会话密钥派生） */
  voiceKeyBase64?: string;
  /** 音频 MIME 类型 */
  voiceMimeType?: string;
  /** 波形数据（归一化 0-1，40 个采样点） */
  voiceWaveform?: number[];

  // ===== 机器人语音消息字段 =====
  /** 机器人语音消息 URL（非加密，直接播放） */
  voiceUrl?: string;

  // ===== 位置共享字段 =====
  /** 位置共享会话 ID */
  locationShareId?: string;
  /** 位置共享时长（秒） */
  locationDuration?: number;
  /** 位置共享过期时间戳 */
  locationExpiresAt?: number;
  /** 位置共享是否已结束 */
  locationEnded?: boolean;
  /** 位置消息数据（单次位置和实时共享都用此字段） */
  locationData?: {
    lat: number;
    lng: number;
    locationType: 'location' | 'location_share';
    address?: string;
    shareId?: string;
    duration?: number;
    expiresAt?: number;
  };

  // ===== 消息撤回字段 =====
  /** 消息是否已被撤回 */
  isRecalled?: boolean;
  // ===== 贴纸消息字段 =====
  /** 贴纸 Lottie JSON URL 或内联 JSON 数据路径 */
  stickerUrl?: string;
  /** 贴纸关联的 emoji */
  stickerEmoji?: string;
  /** 贴纸集合名称 */
  stickerSetName?: string;
  // ===== 群聊 @ 提及字段 =====
  /** 被 @ 的用户 ID 列表 */
  mentions?: string[];
  // ===== 链接预览字段 =====
  /** 消息中包含的链接 URL（自动检测并展示预览卡片） */
  linkUrl?: string;
  /** 预先加载的链接预览数据（避免重复请求） */
  linkPreview?: {
    url: string;
    title: string;
    description: string;
    image: string;
    siteName: string;
    favicon: string;
  };
}

export interface Chat {
  id: string;
  type: 'private' | 'group';
  name: string;
  avatar: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  members?: string[];
  isTyping?: boolean;
  /** 是否为官方会话，用于展示认证/官方标识 */
  isOfficial?: boolean;
  /** 会话最近一条消息是否为加密消息，用于会话列表图标提示 */
  isEncrypted?: boolean;
  /** 群聊的数据库 groupId（用于群消息撤回匹配） */
  groupId?: string;
  /** 私聊对方资料版本时间戳（Unix ms） */
  peerProfileUpdatedAt?: number;
  // ===== 消失消息模式 =====
  /** 消失消息模式：会话级别的自动销毁定时器（秒），undefined 表示未开启 */
  ephemeralTimer?: BurnAfterReadTimer;
}

export interface MomentPost {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  images: string[];
  timestamp: number;
  likes: { userId: string; userName: string }[];
  comments: { id: string; userId: string; userName: string; content: string; timestamp: number; replyTo?: string }[];
  visibility: 'public' | 'friends' | 'private';
}

export interface CallState {
  isActive: boolean;
  callId?: string;
  /** 共享房间ID：主叫方生成，通过 call_invite 传给被叫方，确保双方进入同一个 TRTC 房间 */
  roomId?: string;
  peerId?: string;
  peerName?: string;
  peerAvatar?: string;
  callType?: 'audio' | 'video';
  status?: 'ringing' | 'connecting' | 'connected' | 'ended';
  isIncoming?: boolean;
  isMuted?: boolean;
  isSpeaker?: boolean;
  isVideoOff?: boolean;
  duration?: number;
}

// ============ 模拟数据 ============

/** 动态读取 localStorage 中的登录用户信息，登录后自动更新 */
function getStoredUser(): User {
  try {
    const id = localStorage.getItem('user_id') || 'me';
    const nickname = localStorage.getItem('user_nickname') || '用户';
    const username = localStorage.getItem('user_username') || id;
    const avatar = localStorage.getItem('user_avatar') || '';
    const bio = localStorage.getItem('user_bio') || '';
    const profileUpdatedAtRaw = localStorage.getItem('user_profile_updated_at');
    const profileUpdatedAt = profileUpdatedAtRaw ? Number(profileUpdatedAtRaw) : undefined;
    return {
      id,
      uniqueId: username,
      name: nickname,
      avatar,
      status: 'online',
      bio,
      ...(profileUpdatedAt && !Number.isNaN(profileUpdatedAt) ? { profileUpdatedAt } : {}),
      privacy: {
        allowSearchById: true,
        allowSearchByPhone: true,
        allowSearchByEmail: true,
      },
    };
  } catch {
    return {
      id: 'me',
      uniqueId: 'user',
      name: '用户',
      avatar: '',
      status: 'online',
      privacy: { allowSearchById: true, allowSearchByPhone: true, allowSearchByEmail: true },
    };
  }
}

export const CURRENT_USER: User = getStoredUser();

export interface CurrentUserProfileSyncPayload {
  nickname?: string;
  username?: string;
  uniqueId?: string;
  avatar?: string;
  bio?: string;
  phone?: string;
  email?: string;
  profileUpdatedAt?: number;
}

export function syncCurrentUserProfile(payload: CurrentUserProfileSyncPayload) {
  const nextUniqueId = payload.uniqueId || payload.username;

  if (payload.nickname !== undefined) {
    CURRENT_USER.name = payload.nickname;
    localStorage.setItem('user_nickname', payload.nickname);
  }
  if (nextUniqueId !== undefined) {
    CURRENT_USER.uniqueId = nextUniqueId;
    localStorage.setItem('user_username', nextUniqueId);
  }
  if (payload.avatar !== undefined) {
    CURRENT_USER.avatar = payload.avatar;
    localStorage.setItem('user_avatar', payload.avatar);
  }
  if (payload.bio !== undefined) {
    CURRENT_USER.bio = payload.bio;
    localStorage.setItem('user_bio', payload.bio);
  }
  if (payload.phone !== undefined) {
    CURRENT_USER.phone = payload.phone;
  }
  if (payload.email !== undefined) {
    CURRENT_USER.email = payload.email;
  }
  if (payload.profileUpdatedAt !== undefined) {
    CURRENT_USER.profileUpdatedAt = payload.profileUpdatedAt;
    localStorage.setItem('user_profile_updated_at', String(payload.profileUpdatedAt));
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cqim:user-profile-updated', {
      detail: {
        id: CURRENT_USER.id,
        uniqueId: CURRENT_USER.uniqueId,
        username: CURRENT_USER.uniqueId,
        nickname: CURRENT_USER.name,
        avatar: CURRENT_USER.avatar,
        bio: CURRENT_USER.bio || '',
        phone: CURRENT_USER.phone || '',
        email: CURRENT_USER.email || '',
        profileUpdatedAt: CURRENT_USER.profileUpdatedAt,
      },
    }));
  }
}

/** 官方账号 */
export const OFFICIAL_ACCOUNT: User = {
  id: 'official',
  uniqueId: 'admin',
  name: 'imim 官方',
  avatar: '/imim-official-avatar.jpg',
  status: 'online',
  bio: '安全 · 简约 · 畅聊无限 — imim 官方账号，发布系统公告、版本更新、安全提示等重要信息。',
  isOfficial: true,
  isVerified: true,
  privacy: {
    allowSearchById: true,
    allowSearchByPhone: false,
    allowSearchByEmail: false,
  },
};

/** AI 机器人账号 */
export const BOT_ACCOUNT: User = {
  id: 'BOT',
  uniqueId: 'BOT',
  name: 'imim AI',
  avatar: '/imim-ai-avatar.jpg',
  status: 'online',
  bio: '我是 imim 内置 AI 助手，基于 GPT-4 构建。可以回答问题、写作、翻译、分析代码——随时随地，全天候。',
  isOfficial: true,
  isVerified: true,
  isBot: true,
  botType: 'AI',
  privacy: {
    allowSearchById: true,
    allowSearchByPhone: false,
    allowSearchByEmail: false,
  },
};

export const MOCK_USERS: User[] = [];

/** 好友请求数据 */
export const MOCK_FRIEND_REQUESTS: FriendRequest[] = [];

export const MOCK_CHATS: Chat[] = [
  {
    id: 'c0',
    type: 'private',
    name: 'imim 官方',
    avatar: '/imim-official-avatar.jpg',
    lastMessage: '欢迎使用 imim！点击查看新手指南 →',
    lastMessageTime: Date.now() - 10000,
    unreadCount: 1,
    isPinned: true,
    isMuted: false,
    isOfficial: true,
    isEncrypted: false,
    members: ['me', 'official'],
  },
  {
    id: 'cBOT',
    type: 'private',
    name: 'imim AI',
    avatar: '/imim-ai-avatar.jpg',
    lastMessage: '你好，我是 imim AI，请直接告诉我你的问题。',
    lastMessageTime: Date.now() - 5000,
    unreadCount: 1,
    isPinned: true,
    isMuted: false,
    isOfficial: true,
    isEncrypted: false,
    members: ['me', 'BOT'],
  },
];

export const MOCK_MESSAGES: Record<string, Message[]> = {
  c0: [
    { id: 'mo1', chatId: 'c0', senderId: 'official', content: '🎉 欢迎来到 imim！', type: 'system', timestamp: Date.now() - 86400000 * 3, isEncrypted: false, reactions: {}, status: 'read' },
    { id: 'mo2', chatId: 'c0', senderId: 'official', content: '你好！我是 imim 官方账号。\n\nimim 是一款注重隐私与安全的即时通讯应用，采用 Signal Protocol 端到端加密，确保你的消息只有你和对方能看到。', type: 'text', timestamp: Date.now() - 86400000 * 3 + 1000, isEncrypted: false, reactions: {}, status: 'read' },
    { id: 'mo3', chatId: 'c0', senderId: 'official', content: '📋 新手指南\n\n1. 发送消息：在聊天界面输入消息后点击发送\n2. 语音消息：按住麦克风按钮录制加密语音\n3. 阅后即焚：点击🔥按钮设置消息自动销毁时间\n4. 音视频通话：点击顶部📞或📹按钮发起通话\n5. 添加好友：通讯录 → 右上角 + → 搜索账号ID/手机号/邮箱', type: 'text', timestamp: Date.now() - 86400000 * 2, isEncrypted: false, reactions: {}, status: 'read' },
    { id: 'mo4', chatId: 'c0', senderId: 'official', content: '🔒 安全提示\n\nimim 的所有私聊消息均采用 Signal Protocol 端到端加密。服务器无法读取你的消息内容。建议定期在「账号与安全」中验证联系人安全码，防止中间人攻击。', type: 'text', timestamp: Date.now() - 86400000, isEncrypted: false, reactions: {}, status: 'read' },
    { id: 'mo5', chatId: 'c0', senderId: 'official', content: '🚀 imim v2.0 正式发布！\n\n新功能亮点：\n• 阅后即焚消息（支持5秒~1周）\n• 消失消息模式\n• 端到端加密语音消息\n• 音视频通话（WebRTC）\n• 扫码加好友（E2EE 二维码）\n• 520位安全码验证\n\n感谢你的使用与支持！', type: 'text', timestamp: Date.now() - 10000, isEncrypted: false, reactions: { '🎉': 8, '❤️': 12 }, status: 'delivered' },
  ],
  cBOT: [
    { id: 'bot1', chatId: 'cBOT', senderId: 'BOT', content: '你好，我是 imim AI。\n我可以帮你问答、写作、翻译和代码分析。\n请直接告诉我你的问题。', type: 'text', timestamp: Date.now() - 5000, isEncrypted: false, reactions: {}, status: 'delivered' },
  ],
};

export const MOCK_MOMENTS: MomentPost[] = [];

// ============ 工具函数 ============

export function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const date = new Date(timestamp);
  const today = new Date();

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;

  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }

  if (date.getFullYear() === today.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function formatChatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function getInitials(name: string): string {
  return name.charAt(0);
}

export function getUserById(id: string): User | undefined {
  if (id === 'me') return CURRENT_USER;
  if (id === 'BOT') return BOT_ACCOUNT;
  if (id === 'official') return OFFICIAL_ACCOUNT;
  return MOCK_USERS.find(u => u.id === id);
}

// 生成头像颜色
const AVATAR_COLORS = [
  'oklch(0.55 0.12 155)', // 橄榄绿
  'oklch(0.55 0.10 200)', // 青蓝
  'oklch(0.55 0.18 25)',  // 朱砂
  'oklch(0.55 0.10 80)',  // 赭石
  'oklch(0.55 0.08 280)', // 藤紫
  'oklch(0.55 0.12 120)', // 竹青
  'oklch(0.55 0.10 40)',  // 琥珀
  'oklch(0.55 0.08 320)', // 丁香
];

export function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ============ 阅后即焚工具函数 ============

/** 将秒数格式化为可读文字 */
export function formatBurnTimer(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${seconds / 60}分钟`;
  if (seconds < 86400) return `${seconds / 3600}小时`;
  if (seconds < 604800) return `${seconds / 86400}天`;
  return `${seconds / 604800}周`;
}

/** 阅后即焚定时选项列表 */
export const BURN_TIMER_OPTIONS: { label: string; value: BurnAfterReadTimer }[] = [
  { label: '5秒', value: 5 },
  { label: '10秒', value: 10 },
  { label: '30秒', value: 30 },
  { label: '1分钟', value: 60 },
  { label: '5分钟', value: 300 },
  { label: '1小时', value: 3600 },
  { label: '1天', value: 86400 },
  { label: '1周', value: 604800 },
];
