/**
 * TG 风格 Peer ID 生成与解析工具
 *
 * 完全复刻 Telegram Bot API 的 ID 划分规则：
 * - 用户 / 机器人：正数 (> 0)，如 123456789
 * - 普通群组：负数 (-1 ~ -999999999999)，如 -123456789
 * - 超级群 / 频道：-100 前缀 (<= -1000000000000)，如 -1001234567890
 *
 * 使用 BigInt 保证 64 位精度，避免 JS Number 溢出
 */

import crypto from 'crypto';

// ============ 类型定义 ============

export type PeerType = 'user' | 'bot' | 'group' | 'supergroup' | 'channel';

export interface PeerInfo {
  type: PeerType;
  isBot: boolean;
  /** 超级群/频道的内部ID（去掉 -100 前缀后的部分） */
  internalId?: bigint;
}

// ============ 序列号生成器 ============

/** 原子递增序列号（进程内唯一） */
let sequence = 0n;

/** 上一次生成 ID 的时间戳（ms） */
let lastTimestamp = 0n;

/**
 * 生成内部正数 ID（类雪花算法）
 *
 * 结构（53 位安全整数范围内）：
 * - 高 41 位：毫秒时间戳（相对 2024-01-01 的偏移，可用约 69 年）
 * - 中 4 位：随机值（防止多进程冲突）
 * - 低 8 位：递增序列号（同一毫秒内最多 256 个）
 *
 * 生成的 ID 范围：约 1~9007199254740991（Number.MAX_SAFE_INTEGER）
 */
function generateInternalId(): bigint {
  // 自定义纪元：2024-01-01 00:00:00 UTC
  const EPOCH = 1704067200000n;
  const now = BigInt(Date.now());
  const timestamp = now - EPOCH;

  if (timestamp === lastTimestamp) {
    sequence = (sequence + 1n) & 0xFFn; // 8 位序列号
    if (sequence === 0n) {
      // 同一毫秒内序列号溢出，等待下一毫秒
      // 实际生产中极少发生
      const wait = Number(lastTimestamp + EPOCH + 1n - BigInt(Date.now()));
      if (wait > 0) {
        // 简单自旋等待
        const end = Date.now() + wait;
        while (Date.now() < end) { /* spin */ }
      }
    }
  } else {
    sequence = 0n;
  }
  lastTimestamp = timestamp;

  const random = BigInt(crypto.randomInt(0, 16)); // 4 位随机

  // 组合：timestamp(41) | random(4) | sequence(8) = 53 位
  const id = (timestamp << 12n) | (random << 8n) | sequence;

  return id;
}

// ============ Dialog ID 生成 ============

/**
 * 生成 TG 风格 Dialog ID
 *
 * @param type - Peer 类型
 * @returns TG 风格的 Dialog ID（BigInt）
 *
 * 规则（与 Telegram Bot API 完全一致）：
 * - user / bot → 正数（直接使用内部 ID）
 * - group → 负数（取反）
 * - supergroup / channel → -1000000000000 - internalId（-100 前缀）
 */
export function generateDialogId(type: PeerType): bigint {
  const internalId = generateInternalId();

  switch (type) {
    case 'user':
    case 'bot':
      return internalId;
    case 'group':
      return -internalId;
    case 'supergroup':
    case 'channel':
      return -1000000000000n - internalId;
    default:
      throw new Error(`未知的 Peer 类型: ${type}`);
  }
}

/**
 * 为已有用户生成 Dialog ID（注册时调用）
 */
export function generateUserDialogId(isBot: boolean = false): bigint {
  return generateDialogId(isBot ? 'bot' : 'user');
}

/**
 * 为已有群组生成 Dialog ID（创建群时调用）
 */
export function generateGroupDialogId(isSupergroup: boolean = true): bigint {
  return generateDialogId(isSupergroup ? 'supergroup' : 'group');
}

// ============ ID 类型判断 ============

/**
 * 根据 Dialog ID 判断 Peer 类型
 *
 * 规则（与 Telegram Bot API 完全一致）：
 * - id > 0 → 用户或机器人（需查 peers 表确认 isBot）
 * - -1000000000000 < id < 0 → 普通群组
 * - id <= -1000000000000 → 超级群或频道
 */
export function getPeerType(dialogId: bigint | number | string): PeerInfo {
  const id = BigInt(dialogId);

  if (id > 0n) {
    return { type: 'user', isBot: false }; // isBot 需查库确认
  }
  if (id > -1000000000000n) {
    return { type: 'group', isBot: false };
  }
  return { type: 'supergroup', isBot: false, internalId: -(id + 1000000000000n) };
}

/**
 * 判断是否为用户 ID（正数）
 */
export function isUserId(dialogId: bigint | number | string): boolean {
  return BigInt(dialogId) > 0n;
}

/**
 * 判断是否为群组 ID（负数，非超级群）
 */
export function isGroupId(dialogId: bigint | number | string): boolean {
  const id = BigInt(dialogId);
  return id < 0n && id > -1000000000000n;
}

/**
 * 判断是否为超级群/频道 ID（-100 前缀）
 */
export function isSupergroupId(dialogId: bigint | number | string): boolean {
  return BigInt(dialogId) <= -1000000000000n;
}

/**
 * 判断是否为任意群组 ID（普通群 + 超级群）
 */
export function isAnyGroupId(dialogId: bigint | number | string): boolean {
  return BigInt(dialogId) < 0n;
}

// ============ 格式化 ============

/**
 * 将 Dialog ID 格式化为人类可读的字符串
 * 例如：
 * - 用户：123456789
 * - 普通群：-123456789
 * - 超级群：-1001234567890
 */
export function formatDialogId(dialogId: bigint | number | string): string {
  return BigInt(dialogId).toString();
}

/**
 * 将 Dialog ID 转为数据库存储用的字符串
 * SQLite 不支持原生 BigInt，需要以字符串形式存储
 */
export function dialogIdToString(dialogId: bigint): string {
  return dialogId.toString();
}

/**
 * 从数据库字符串恢复 Dialog ID
 */
export function stringToDialogId(str: string): bigint {
  return BigInt(str);
}

// ============ 邀请链接工具 ============

/**
 * 生成邀请链接 hash（22 位 URL 安全 base64）
 */
export function generateInviteHash(): string {
  return crypto.randomBytes(16).toString('base64url').slice(0, 22);
}

/**
 * 判断 slug 是否为邀请链接格式（以 + 开头）
 */
export function isInviteSlug(slug: string): boolean {
  return slug.startsWith('+') && slug.length > 1;
}

/**
 * 从邀请 slug 中提取 hash
 */
export function extractInviteHash(slug: string): string {
  return slug.startsWith('+') ? slug.slice(1) : slug;
}
