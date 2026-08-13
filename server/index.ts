import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import https from "https";
import { promisify } from "util";
import adminRouter, { getAdminConfig } from "./admin";
import momentsRouter from "./moments";
import authRouter, { optionalAuth, userAuth } from "./auth";
import { initDatabase, checkDatabaseHealth } from "./db";
import prisma from "./db";
import {
  connectRedis,
  setUserOnline,
  setUserOffline,
  refreshUserOnline,
  isUserOnline,
  getOnlineUsers,
  publishMessage,
  subscribeChannel,
  parseUserAgent,
  setUserDevice,
  removeUserDevice,
  getUserDevices,
  getUserLastSeen,
} from "./redis";
import {
  securityHeaders,
  globalRateLimit,
  loginRateLimit,
  codeRateLimit,
  adminLoginRateLimit,
  adminIpWhitelist,
  csrfTokenGenerate,
  csrfTokenVerify,
  errorHandler,
  getClientIP,
} from "./security";
import { connectMySQL } from "./mysql";
import cryptoRouter from "./crypto";
import mlsRouter from "./mls-group";
import burnRouter, { startBurnCleanupCron } from "./burn-message";
import privateChatRouter from "./private-chat";
import homeRouter from "./home";
import friendRouter from "./friend";
import qrRouter from "./qr";
import fcmRouter from "./fcm";
import getuiRouter from "./getui";
import apnsRouter from "./apns";
import jpushRouter from "./jpush";
import cookieParser from "cookie-parser";
import compression from "compression";
import stickerRouter, { STICKER_STATIC_PREFIX, STICKER_FILES_DIR, ensureStickerStore } from "./sticker";
import groupRouter, {
  registerConnection,
  unregisterConnection,
  joinGroupOnline,
  leaveGroupOnline,
  getGroupOnlineMembers,
  sendGroupMessage,
  pullGroupMessages,
  ackGroupMessages,
} from "./group-message";
import { avatarToProxy } from "./cos-signer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getSystemConfig<T = any>(key: string): Promise<T | null> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key } }).catch(() => null);
  if (!cfg?.value) return null;
  try {
    return JSON.parse(cfg.value) as T;
  } catch {
    return null;
  }
}

// ============ 真实 IP 解析 ============

/**
 * 按优先级顺序获取客户端真实 IP
 * 优先级： CF-Connecting-IP > X-Real-IP > X-Forwarded-For (最左) > socket.remoteAddress
 */
function getRealClientIP(req: express.Request): string {
  // 优先级 1: Cloudflare 专用头（无法被客户端伪造）
  let ip: string | undefined =
    (req.headers['cf-connecting-ip'] as string) ||
    // 优先级 2: 其他 CDN/代理常用真实 IP 头
    (req.headers['x-real-ip'] as string) ||
    // 优先级 3: X-Forwarded-For 取最左侧（最早的客户端 IP）
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    // 优先级 4: Express 内置（需配合 trust proxy）
    req.ip ||
    // 底底：直接连接 socket IP
    req.socket?.remoteAddress;

  // 清理 IPv6 映射的 IPv4（如 ::ffff:192.168.1.1 → 192.168.1.1）
  if (ip?.includes('::ffff:')) {
    ip = ip.split('::ffff:')[1];
  }

  // 本地回射地址处理
  if (!ip || ip === '::1' || ip === '127.0.0.1') {
    return '127.0.0.1';
  }

  return ip;
}

/**
 * 通过 ip-api.com 查询 IP 地理位置（免费，无需 API Key）
 * 返回格式："中国 · 上海" 或 "Hong Kong"
 */
async function getIPLocation(ip: string): Promise<string> {
  // 本地 IP 直接返回
  if (ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return '内网地址';
  }

  return new Promise((resolve) => {
    // 使用 ip-api.com 免费接口（每分钟 45 次请求限制）
    const url = `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,query&lang=zh-CN`;
    const req = require('http').get(url, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'success') {
            // 中文地名格式："中国 · 北京"
            const parts = [json.country, json.city || json.regionName].filter(Boolean);
            resolve(parts.join(' · ') || '未知地点');
          } else {
            resolve('未知地点');
          }
        } catch {
          resolve('未知地点');
        }
      });
    });
    req.on('error', () => resolve('未知地点'));
    req.setTimeout(3000, () => { req.destroy(); resolve('未知地点'); });
  });
}

// ============ OneBot v11 适配层 ============

/** OneBot v11 消息段 */
interface OneBotSegment {
  type: 'text' | 'image' | 'at' | 'face' | 'video' | 'record';
  data: Record<string, string>;
}

/** OneBot v11 事件基类 */
interface OneBotEvent {
  time: number;
  self_id: number;
  post_type: 'message' | 'notice' | 'request' | 'meta_event';
  [key: string]: any;
}

/** OneBot v11 动作请求（通过 WS 发来） */
interface OneBotAction {
  action: string;
  params: Record<string, any>;
  echo?: string;
}

/** imim BOT 的自定义 self_id（类似 QQ号） */
const BOT_SELF_ID = 10000;

/** 已连接的 AstrBot 客户端（反向 WS） */
const onebotClients = new Set<WebSocket>();

/** 已知群组信息（群ID -> 群名称/成员） */
const groupRegistry = new Map<number, { name: string; memberIds: string[] }>();

/** 已知用户信息（userId -> 昵称） */
const userRegistry = new Map<string, string>();
// 个人资料存储（内存，后续可迁移到 Prisma）
const userProfiles = new Map<string, Record<string, any>>();

// 初始化预设群组数据（对应 MOCK_CHATS 中的群聊）
function initGroupRegistry() {
  // c3 灵鸽开发组 -> group_id: 3
  groupRegistry.set(3, { name: '灵鸽开发组', memberIds: ['me', 'u2', 'u3', 'u4', 'u5'] });
  // c5 老同学群 -> group_id: 5
  groupRegistry.set(5, { name: '老同学群', memberIds: ['me', 'u1', 'u3', 'u6'] });

  // 用户昵称映射
  userRegistry.set('me', '清风');
  userRegistry.set('u1', '林小溪');
  userRegistry.set('u2', '陈墨白');
  userRegistry.set('u3', '苏清和');
  userRegistry.set('u4', '王竹韵');
  userRegistry.set('u5', '周清漪');
  userRegistry.set('u6', '李晨曦');
  userRegistry.set('BOT', 'imim AI');
  userRegistry.set('official', 'imim 官方');
}

/**
 * 将 imim 消息内容转换为 OneBot v11 消息段数组
 */
function contentToSegments(content: string): OneBotSegment[] {
  if (!content) return [{ type: 'text', data: { text: '' } }];
  // 简单处理：全部作为文本（后续可扩展图片、@ 解析）
  return [{ type: 'text', data: { text: content } }];
}

/**
 * 将 OneBot 消息段数组转换为纯文本
 */
function segmentsToText(segments: OneBotSegment[] | string, rawMessage?: string): string {
  if (typeof segments === 'string') return segments;
  let text = '';
  let hasOther = false;
  
  if (Array.isArray(segments)) {
    segments.forEach(seg => {
      if (seg.type === 'text') {
        text += seg.data.text || '';
      } else if (seg.type === 'at') {
        text += `@${seg.data.qq || seg.data.name || ''}`;
      } else {
        hasOther = true;
      }
    });
  }
  
  // 增强：如果解析数组没拿到文字，但有 rawMessage (通常是 CQ 码字符串)，尝试从中提取文字
  if (!text.trim() && rawMessage) {
    // 移除所有 CQ 码 [CQ:...]
    text = rawMessage.replace(/\[CQ:[^\]]+\]/g, '').trim();
  }
  
  // 如果没有任何文字但有其他片段（如纯图片），则返回占位符
  if (!text.trim() && hasOther) {
    const hasImage = Array.isArray(segments) && segments.some(s => s.type === 'image');
    if (hasImage) return '[图片]';
    return '';
  }
  
  return text.trim();
}

/** 语音文件存储目录 */
const VOICE_DIR = path.resolve(__dirname, '..', 'data', 'voice');
if (!fs.existsSync(VOICE_DIR)) {
  fs.mkdirSync(VOICE_DIR, { recursive: true });
}

/**
 * 从 OneBot 消息段数组中提取 record 消息段信息
 * 返回 { file, url } 或 null
 */
function extractRecordSegment(segments: OneBotSegment[] | string): { file?: string; url?: string } | null {
  if (typeof segments === 'string') {
    // CQ 码格式: [CQ:record,file=xxx,url=yyy]
    const match = segments.match(/\[CQ:record,([^\]]+)\]/);
    if (match) {
      const params: Record<string, string> = {};
      match[1].split(',').forEach(pair => {
        const [k, ...v] = pair.split('=');
        params[k] = v.join('=');
      });
      return { file: params.file, url: params.url };
    }
    return null;
  }
  const seg = segments.find(s => s.type === 'record');
  if (!seg) return null;
  return { file: seg.data.file, url: seg.data.url };
}

/**
 * 下载/保存语音文件到本地，返回本地文件名
 * 支持: URL 下载、base64 解码、本地文件路径复制
 */
async function downloadVoiceFile(record: { file?: string; url?: string }): Promise<{ localFile: string; publicUrl: string } | null> {
  try {
    const fileName = `voice_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.ogg`;
    const localPath = path.join(VOICE_DIR, fileName);

    // 优先使用 url 字段
    const source = record.url || record.file || '';

    if (source.startsWith('http://') || source.startsWith('https://')) {
      // URL 下载
      const response = await fetch(source);
      if (!response.ok) throw new Error(`下载失败: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(localPath, buffer);
    } else if (source.startsWith('base64://')) {
      // base64 解码
      const b64 = source.replace('base64://', '');
      const buffer = Buffer.from(b64, 'base64');
      fs.writeFileSync(localPath, buffer);
    } else if (source.startsWith('file:///') || (source.startsWith('/') && fs.existsSync(source))) {
      // 本地文件路径
      const srcPath = source.replace('file://', '');
      fs.copyFileSync(srcPath, localPath);
    } else if (source) {
      // 尝试作为 base64 解码
      try {
        const buffer = Buffer.from(source, 'base64');
        if (buffer.length > 100) {
          fs.writeFileSync(localPath, buffer);
        } else {
          console.warn('[Voice] 无法识别语音文件来源:', source.slice(0, 80));
          return null;
        }
      } catch {
        console.warn('[Voice] 无法解析语音文件:', source.slice(0, 80));
        return null;
      }
    } else {
      return null;
    }

    const publicUrl = `/api/voice/${fileName}`;
    console.log(`[Voice] 语音文件已保存: ${localPath} -> ${publicUrl}`);
    return { localFile: fileName, publicUrl };
  } catch (err) {
    console.error('[Voice] 下载语音文件失败:', err);
    return null;
  }
}

const BOT_TTS_ENABLED = process.env.BOT_TTS_ENABLED !== '0';
const BOT_TTS_MODEL = process.env.BOT_TTS_MODEL || 'tts-1';
const BOT_TTS_VOICE = process.env.BOT_TTS_VOICE || 'alloy';
const BOT_TTS_FORMAT = (process.env.BOT_TTS_FORMAT || 'mp3').toLowerCase();
const BOT_TTS_EDGE_VOICE = process.env.BOT_TTS_EDGE_VOICE || 'zh-CN-XiaoxiaoNeural';
const execFileAsync = promisify(execFile);
const BOT_TTS_EXT_MAP: Record<string, string> = {
  mp3: '.mp3',
  wav: '.wav',
  opus: '.opus',
  aac: '.aac',
  flac: '.flac',
  pcm: '.pcm',
};

function normalizeBotTtsText(raw: string): string {
  const text = String(raw || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[>*_`#~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';
  if (!/[A-Za-z0-9\u3400-\u9FFF]/.test(text)) return '';
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function estimateBotVoiceDuration(text: string): number {
  const normalized = normalizeBotTtsText(text);
  if (!normalized) return 0;
  const cjkCount = (normalized.match(/[\u3400-\u9FFF]/g) || []).length;
  const latinWordCount = normalized
    .replace(/[\u3400-\u9FFF]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .length;
  const seconds = Math.max(2, Math.round(cjkCount / 4 + latinWordCount / 2));
  return Math.min(seconds, 60);
}

function createBotVoiceFileTarget(format: string = BOT_TTS_FORMAT) {
  const ext = BOT_TTS_EXT_MAP[format] || '.mp3';
  const fileName = `bot_voice_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  const localPath = path.join(VOICE_DIR, fileName);
  if (!localPath.startsWith(VOICE_DIR)) {
    throw new Error('invalid bot voice path');
  }
  return {
    fileName,
    localPath,
    voiceUrl: `/api/voice/${fileName}`,
  };
}

async function synthesizeBotVoiceWithOpenAI(normalized: string): Promise<{ voiceUrl: string; duration: number } | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: BOT_TTS_MODEL,
        voice: BOT_TTS_VOICE,
        input: normalized,
        response_format: BOT_TTS_FORMAT,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[BOT TTS] OpenAI 语音合成失败:', response.status, detail.slice(0, 300));
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;

    const target = createBotVoiceFileTarget(BOT_TTS_FORMAT);
    fs.writeFileSync(target.localPath, buffer);
    const duration = estimateBotVoiceDuration(normalized);
    console.log(`[BOT TTS] OpenAI 机器人语音已生成: ${target.voiceUrl}`);
    return { voiceUrl: target.voiceUrl, duration };
  } catch (err) {
    console.error('[BOT TTS] OpenAI 语音合成异常:', err);
    return null;
  }
}

async function synthesizeBotVoiceWithEdgeTts(normalized: string): Promise<{ voiceUrl: string; duration: number } | null> {
  const target = createBotVoiceFileTarget('mp3');

  try {
    await execFileAsync('python3', [
      '-m',
      'edge_tts',
      '--text',
      normalized,
      '--write-media',
      target.localPath,
      '--voice',
      BOT_TTS_EDGE_VOICE,
    ], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    const stat = fs.statSync(target.localPath);
    if (!stat.size) {
      return null;
    }

    const duration = estimateBotVoiceDuration(normalized);
    console.log(`[BOT TTS] Edge TTS 机器人语音已生成: ${target.voiceUrl}`);
    return { voiceUrl: target.voiceUrl, duration };
  } catch (err) {
    console.error('[BOT TTS] Edge TTS 语音合成异常:', err);
    return null;
  }
}

async function synthesizeBotVoice(text: string): Promise<{ voiceUrl: string; duration: number } | null> {
  if (!BOT_TTS_ENABLED) return null;

  const normalized = normalizeBotTtsText(text);
  if (!normalized) return null;

  const openAiResult = await synthesizeBotVoiceWithOpenAI(normalized);
  if (openAiResult) {
    return openAiResult;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[BOT TTS] 未检测到 OPENAI_API_KEY，切换到 Edge TTS 后备通道');
  } else {
    console.warn('[BOT TTS] OpenAI 通道不可用，切换到 Edge TTS 后备通道');
  }

  return synthesizeBotVoiceWithEdgeTts(normalized);
}

/**
 * 向所有已连接的 AstrBot 客户端推送 OneBot 事件
 */
function pushOneBotEvent(event: OneBotEvent) {
  const payload = JSON.stringify(event);
  let pushed = 0;
  for (const ws of onebotClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      pushed++;
    }
  }
  if (pushed > 0) {
    console.log(`[OneBot] 推送事件 post_type=${event.post_type} 给 ${pushed} 个客户端`);
  }
}

/**
 * 推送群消息事件给 AstrBot
 */
function pushGroupMessage(params: {
  groupId: number;
  userId: string;
  content: string;
  messageId: string;
  nickname?: string;
}) {
  const { groupId, userId, content, messageId, nickname } = params;
  pushOneBotEvent({
    time: Math.floor(Date.now() / 1000),
    self_id: BOT_SELF_ID,
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: messageId,
    group_id: groupId,
    user_id: userId,
    anonymous: null,
    message: contentToSegments(content),
    raw_message: content,
    font: 0,
    sender: {
      user_id: userId,
      nickname: nickname || userRegistry.get(userId) || userId,
      card: '',
      sex: 'unknown',
      age: 0,
      area: '',
      level: '1',
      role: 'member',
      title: '',
    },
  });
}

/**
 * 推送私聊消息事件给 AstrBot
 */
function pushPrivateMessage(params: {
  userId: string;
  content: string;
  messageId: string;
  nickname?: string;
}) {
  const { userId, content, messageId, nickname } = params;
  pushOneBotEvent({
    time: Math.floor(Date.now() / 1000),
    self_id: BOT_SELF_ID,
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: messageId,
    user_id: userId,
    message: contentToSegments(content),
    raw_message: content,
    font: 0,
    sender: {
      user_id: userId,
      nickname: nickname || userRegistry.get(userId) || userId,
      sex: 'unknown',
      age: 0,
    },
  });
}

// ============ WebRTC 信令类型 ============

interface SignalClient {
  ws: WebSocket;
  userId: string;
  roomId?: string;
}

interface SignalMessage {
  type:
    | "join"        // 加入房间
    | "leave"       // 离开房间
    | "offer"       // SDP Offer
    | "answer"      // SDP Answer
    | "ice"         // ICE Candidate
    | "call_invite" // 发起通话邀请
    | "call_accept" // 接受通话
    | "call_reject" // 拒绝通话
    | "call_end"    // 结束通话
    | "room_info"   // 房间成员信息
    // ===== 万人群消息信令 =====
    | "group_join"         // 加入群在线列表
    | "group_leave"        // 离开群在线列表
    | "group_send"         // 发送群消息
    | "group_pull"         // 拉取群历史消息
    | "group_ack"          // 确认已读
    | "group_message"      // 服务器推送群消息
    | "group_message_batch" // 服务器批量推送群消息
    // ===== 位置共享信令 =====
    | "location_share_start"   // 发起位置共享
    | "location_share_join"    // 加入位置共享
    | "location_share_update"  // 位置更新
    | "location_share_stop"    // 停止共享
    | "location_share_started" // 共享已创建（广播给聊天室）
    | "location_share_ended"   // 共享已结束（广播给参与者）
    | "location_share_info"   // 共享房间信息
    // ===== 私聊消息信令 =====
    | "private_send"       // 发送私聊消息
    | "private_message"    // 服务器推送私聊消息
    | "private_typing"     // 正在输入状态
    // ===== 已读回执信令 =====
    | "read_receipt"       // 已读回执（私聊）
    // ===== 在线状态信令 =====
    | "friend_online"      // 好友上线
    | "friend_offline"     // 好友下线
    | "heartbeat"          // 应用层心跳
    // ===== 消息撤回信令 =====
    | "recall"             // 撤回私聊消息（发送方发起）
    | "recall_notify"      // 撤回通知（推送给对方）
    | "group_recall"       // 撤回群聊消息
    | "group_recall_notify" // 群聊撤回通知（广播给群成员）
    // ===== MLS 端到端加密信令 =====
    | "mls_add_member"     // MLS 添加成员（Welcome + Commit）
    | "mls_remove_member"  // MLS 移除成员（Commit）
    | "mls_update_keys"    // MLS 密钥更新（Commit）
    | "mls_welcome"        // MLS Welcome 消息推送
    | "mls_commit"         // MLS Commit 消息推送
    // ===== 频道信令 =====
    | "channel_send"       // 发送频道消息（仅管理员）
    | "channel_message"    // 频道消息推送
    | "channel_subscribe"  // 订阅频道在线列表
    | "channel_leave"      // 离开频道在线列表
    // ===== 用户资料同步 =====
    | "user_profile_updated";  // 用户资料更新（广播给好友/群成员）
  from?: string;
  to?: string;
  roomId?: string;
  payload?: any;
}

// ============ 信令服务器状态 ============

/** userId -> SignalClient */
const clients = new Map<string, SignalClient>();
/** roomId -> Set<userId> */
const rooms = new Map<string, Set<string>>();

/** WebSocket 背压阈值（字节）：超过此值跳过推送，避免慢消费者阻塞 */
const WS_BACKPRESSURE_LIMIT = 65536;

/** 预序列化缓存：避免同一消息对万人群重复 JSON.stringify */
const _serializeCache = new WeakMap<object, string>();

function sendTo(userId: string, msg: SignalMessage) {
  const client = clients.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) return;
  // 背压检测：发送缓冲区积压过多时跳过，客户端可通过 pull 补偿
  if (client.ws.bufferedAmount > WS_BACKPRESSURE_LIMIT) return;
  // 使用预序列化缓存：同一对象只 stringify 一次
  let payload = _serializeCache.get(msg);
  if (!payload) {
    payload = JSON.stringify(msg);
    _serializeCache.set(msg, payload);
  }
  client.ws.send(payload);
}

/** 发送预序列化字符串（跳过 JSON.stringify） */
function sendRaw(userId: string, raw: string) {
  const client = clients.get(userId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) return;
  if (client.ws.bufferedAmount > WS_BACKPRESSURE_LIMIT) return;
  client.ws.send(raw);
}

function broadcastToRoom(roomId: string, msg: SignalMessage, excludeUserId?: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  // ★ 预序列化：广播消息只 stringify 一次，所有成员共享同一字符串
  const payload = JSON.stringify(msg);
  room.forEach((uid) => {
    if (uid !== excludeUserId) sendRaw(uid, payload);
  });
}

/** 向多个用户广播消息（用于用户资料更新等场景） */
function broadcastToUsers(userIds: string[], msg: SignalMessage, excludeUserId?: string) {
  const payload = JSON.stringify(msg);
  for (const uid of userIds) {
    if (uid !== excludeUserId) sendRaw(uid, payload);
  }
}

async function handleMessage(client: SignalClient, raw: string) {
  let msg: SignalMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  console.log(`[Signal] ${msg.type} from=${client.userId} to=${msg.to || msg.roomId || "*"}`);

  switch (msg.type) {
    case "join": {
      const roomId = msg.roomId || `room-${msg.to || client.userId}`;
      client.roomId = roomId;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId)!;
      const existingMembers = Array.from(room);
      room.add(client.userId);

      // 通知已有成员有新人加入
      broadcastToRoom(roomId, {
        type: "room_info",
        from: client.userId,
        roomId,
        payload: { event: "peer_joined", peerId: client.userId, members: Array.from(room) },
      }, client.userId);

      // 告知新加入者当前房间成员
      sendTo(client.userId, {
        type: "room_info",
        roomId,
        payload: { event: "joined", members: existingMembers },
      });
      break;
    }

    case "leave": {
      const roomId = client.roomId;
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          room.delete(client.userId);
          if (room.size === 0) rooms.delete(roomId);
          else {
          broadcastToRoom(roomId, {
            type: "room_info",
            from: client.userId,
            roomId,
            payload: { event: "peer_left", peerId: client.userId, members: Array.from(room) },
          });
          }
        }
        client.roomId = undefined;
      }
      break;
    }

    case "offer":
    case "answer":
    case "ice": {
      // 点对点信令转发
      if (msg.to) {
        sendTo(msg.to, { ...msg, from: client.userId });
      }
      break;
    }

    case "call_invite": {
      if (msg.to) {
        // 先尝试通过 WebSocket 转发
        sendTo(msg.to, { ...msg, from: client.userId });

        // 如果被叫方离线，发送来电推送通知
        const calleeOnline = await isUserOnline(msg.to);
        if (!calleeOnline) {
          const callerUser = await prisma.user.findUnique({
            where: { id: client.userId },
            select: { nickname: true, username: true, avatar: true },
          });
          const callerName = msg.payload?.callerName || callerUser?.nickname || callerUser?.username || '有人';
          const callerAvatarPath = avatarToProxy(callerUser?.avatar);
          const callerAvatarUrl = callerAvatarPath ? `https://wed.imim.chat${callerAvatarPath}` : '';
          const callType = msg.payload?.callType || 'audio';
          const callRoomId = msg.payload?.roomId || '';
          const callTitle = callType === 'video' ? `${callerName} 发起了视频通话` : `${callerName} 发起了语音通话`;
          const callBody = '点击接听';

          // 查询被叫方的推送 Token
          const calleeUser = await prisma.user.findUnique({
            where: { id: msg.to },
            select: { fcmToken: true },
          });

          const callPushPayload = {
            type: 'call_invite',
            call_id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            caller_id: client.userId,
            caller_name: callerName,
            caller_avatar: callerAvatarUrl,
            call_type: callType,
            room_id: callRoomId,
          };

          // 优先使用自建 APNs VoIP Push（iOS 来电），其次个推，最后 FCM
          const { parseAPNsToken } = await import('./apns.js');
          if (parseAPNsToken(calleeUser?.fcmToken)) {
            // 自建 APNs 通道：来电走 VoIP Push
            const { sendVoIPPush } = await import('./apns.js');
            await sendVoIPPush({
              toUserId: msg.to,
              callerName,
              callId: callPushPayload.call_id,
              callerId: client.userId,
              callerAvatar: callerAvatarUrl,
              callType: callType as 'audio' | 'video',
              roomId: callRoomId,
            }).catch((e: any) => console.error('[APNs] VoIP 来电推送异常:', e));
          } else {
            const { parseJPushToken, sendJPushPush } = await import('./jpush.js');
            if (parseJPushToken(calleeUser?.fcmToken)) {
              await sendJPushPush({
                toUserId: msg.to,
                title: callTitle,
                body: callBody,
                extras: {
                  type: 'call_invite',
                  chatId: callPushPayload.call_id,
                  callerId: client.userId,
                },
              }).catch((e: any) => console.error('[JPush] 来电推送异常:', e));
            } else {
            const { parseGetuiToken } = await import('./getui.js');
            if (parseGetuiToken(calleeUser?.fcmToken)) {
              const { sendGetuiPush } = await import('./getui.js');
              await sendGetuiPush({
                toUserId: msg.to,
                title: callTitle,
                body: callBody,
                senderAvatar: callerAvatarUrl,
                payload: JSON.stringify(callPushPayload),
              }).catch((e: any) => console.error('[个推] 来电推送异常:', e));
            } else if (calleeUser?.fcmToken) {
              const { sendFCMPush } = await import('./fcm.js');
              await sendFCMPush({
                toUserId: msg.to,
                title: callTitle,
                body: callBody,
                data: callPushPayload,
              }).catch((e: any) => console.error('[FCM] 来电推送异常:', e));
            }
            }
          }
          console.log(`[CallSignal] 被叫方 ${msg.to} 离线，已发送来电推送`);
        }
      }
      break;
    }
    case "call_accept":
    case "call_reject":
    case "call_end": {
      if (msg.to) {
        sendTo(msg.to, { ...msg, from: client.userId });
      }
      break;
    }

    // ===== 万人群消息信令处理 =====
    case "group_join": {
      const { groupId } = msg.payload || {};
      if (groupId) {
        joinGroupOnline(groupId, client.userId);
        console.log(`[GroupSignal] ${client.userId} 加入群在线: ${groupId}`);
      }
      break;
    }

    case "group_leave": {
      const { groupId } = msg.payload || {};
      if (groupId) {
        leaveGroupOnline(groupId, client.userId);
        console.log(`[GroupSignal] ${client.userId} 离开群在线: ${groupId}`);
      }
      break;
    }

    case "group_send": {
      const { groupId, content, msgType, senderName, replyToId, extra, localId } = msg.payload || {};
      if (groupId && content) {
        // 强制 MLS：业务消息必须是 mls_encrypted，拒绝明文 text
        const effectiveMsgType = msgType || 'mls_encrypted';
        if (effectiveMsgType !== 'mls_encrypted' && effectiveMsgType !== 'system') {
          sendTo(client.userId, {
            type: 'group_message' as any,
            payload: { ack: true, groupId, seq: -1, timestamp: Date.now(), localId: localId || '', error: '群聊强制要求 MLS 端到端加密，禁止发送明文业务消息' },
          });
          return;
        }

        // 异步查询发送者头像
        const senderUser = await prisma.user.findUnique({
          where: { id: client.userId },
          select: { avatar: true, nickname: true, username: true },
        }).catch(() => null);
        sendGroupMessage({
          groupId,
          senderId: client.userId,
          senderName: senderName || senderUser?.nickname || senderUser?.username || userRegistry.get(client.userId) || client.userId,
          senderAvatar: avatarToProxy(senderUser?.avatar),
          msgType: effectiveMsgType,
          content,
          replyToId,
          extra,
        }).then(result => {
          // 返回 ACK 给发送者（包含 localId 用于前端匹配乐观消息）
          sendTo(client.userId, {
            type: 'group_message' as any,
            payload: { ack: true, groupId, seq: result.seq, timestamp: result.timestamp, localId: localId || '' },
          });
        }).catch(err => {
          console.error(`[GroupSignal] 发送失败:`, err);
          // 发送失败通知给发送者
          sendTo(client.userId, {
            type: 'group_message' as any,
            payload: { ack: true, groupId, seq: -1, timestamp: Date.now(), localId: localId || '', error: err.message },
          });
        });
      }
      break;
    }

    case "group_pull": {
      const { groupId, afterSeq, lastSeq, beforeSeq, limit } = msg.payload || {};
      // lastSeq 是重连协议的语义名称；afterSeq 保留用于旧客户端兼容
      const resumeSeq = lastSeq !== undefined ? Number(lastSeq) : afterSeq;
      if (groupId) {
        pullGroupMessages({
          groupId,
          userId: client.userId,
          afterSeq: resumeSeq,
          beforeSeq,
          limit,
        }).then(result => {
          sendTo(client.userId, {
            type: 'group_message' as any,
            payload: { pull: true, groupId, ...result },
          });
        }).catch(err => {
          console.error(`[GroupSignal] 拉取失败:`, err);
        });
      }
      break;
    }

    case "group_ack": {
      const { groupId, lastAckSeq } = msg.payload || {};
      if (groupId && lastAckSeq !== undefined) {
        ackGroupMessages({ groupId, userId: client.userId, lastAckSeq }).catch(err => {
          console.error(`[GroupSignal] ACK失败:`, err);
        });
      }
      break;
    }

    // ===== 频道消息信令 =====
    case "channel_send": {
      const { channelId, content, msgType, senderName, replyToId, extra, localId } = msg.payload || {};
      if (channelId && content) {
        // 权限验证：仅 owner/admin 可发布
        const member = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId: channelId, userId: client.userId } },
          select: { role: true },
        }).catch(() => null);

        if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
          sendTo(client.userId, {
            type: 'channel_message' as any,
            payload: { ack: true, channelId, localId: localId || '', error: '仅频道管理员可发布消息' },
          });
          break;
        }

        const senderUser = await prisma.user.findUnique({
          where: { id: client.userId },
          select: { avatar: true, nickname: true, username: true },
        }).catch(() => null);

        sendGroupMessage({
          groupId: channelId,
          senderId: client.userId,
          senderName: senderName || senderUser?.nickname || senderUser?.username || client.userId,
          senderAvatar: avatarToProxy(senderUser?.avatar),
          msgType: msgType || 'text',
          content,
          replyToId,
          extra,
        }).then(result => {
          sendTo(client.userId, {
            type: 'channel_message' as any,
            payload: { ack: true, channelId, seq: result.seq, timestamp: result.timestamp, localId: localId || '' },
          });
        }).catch(err => {
          console.error(`[ChannelSignal] 发送失败:`, err);
          sendTo(client.userId, {
            type: 'channel_message' as any,
            payload: { ack: true, channelId, seq: -1, timestamp: Date.now(), localId: localId || '', error: err.message },
          });
        });
      }
      break;
    }

    case "channel_subscribe": {
      const { channelId } = msg.payload || {};
      if (channelId) {
        const { joinGroupOnline } = await import('./group-message.js');
        joinGroupOnline(channelId, client.userId);
        console.log(`[ChannelSignal] ${client.userId} 订阅频道在线: ${channelId}`);
      }
      break;
    }

    case "channel_leave": {
      const { channelId } = msg.payload || {};
      if (channelId) {
        const { leaveGroupOnline } = await import('./group-message.js');
        leaveGroupOnline(channelId, client.userId);
        console.log(`[ChannelSignal] ${client.userId} 离开频道在线: ${channelId}`);
      }
      break;
    }

    // ===== MLS 端到端加密信令处理 =====
    case "mls_add_member": {
      const { groupId, targetUserId, welcome, commit, senderIdentityKey } = msg.payload || {};
      if (groupId && targetUserId && welcome && commit) {
        console.log(`[MLS] ${client.userId} 添加成员 ${targetUserId} 到群 ${groupId}`);
        // 转发 Welcome 给目标用户
        sendTo(targetUserId, {
          type: 'mls_welcome' as any,
          groupId,
          welcome,
          senderIdentityKey,
        });
        // 广播 Commit 给所有在线群成员（排除发送者和新成员）
        const addOnlineMembers = getGroupOnlineMembers(groupId);
        if (addOnlineMembers) {
          for (const uid of addOnlineMembers) {
            if (uid !== client.userId && uid !== targetUserId) {
              sendTo(uid, {
                type: 'mls_commit' as any,
                groupId,
                commit,
              });
            }
          }
        }
        // 存储 Welcome 和 Commit 到服务器（离线用户上线后拉取）
        fetch(`http://localhost:${process.env.PORT || 3000}/api/mls/send-welcome`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, targetUserId, welcome, senderIdentityKey }),
        }).catch(err => console.error('[MLS] 存储 Welcome 失败:', err));
        fetch(`http://localhost:${process.env.PORT || 3000}/api/mls/broadcast-commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, commit, commitType: 'add' }),
        }).catch(err => console.error('[MLS] 存储 Commit 失败:', err));
        // 更新服务端群组 MLS 状态
        fetch(`http://localhost:${process.env.PORT || 3000}/api/mls/update-group-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, epoch: commit.epoch, members: welcome.members, commitType: 'add' }),
        }).catch(err => console.error('[MLS] 更新群状态失败:', err));
      }
      break;
    }

    case "mls_remove_member": {
      const { groupId, targetUserId, commit } = msg.payload || {};
      if (groupId && targetUserId && commit) {
        console.log(`[MLS] ${client.userId} 移除成员 ${targetUserId} 从群 ${groupId}`);
        // 广播 Commit 给所有在线群成员
        const removeOnlineMembers = getGroupOnlineMembers(groupId);
        if (removeOnlineMembers) {
          for (const uid of removeOnlineMembers) {
            if (uid !== client.userId) {
              sendTo(uid, {
                type: 'mls_commit' as any,
                groupId,
                commit,
              });
            }
          }
        }
        fetch(`http://localhost:${process.env.PORT || 3000}/api/mls/broadcast-commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, commit, commitType: 'remove' }),
        }).catch(err => console.error('[MLS] 存储 Commit 失败:', err));
        fetch(`http://localhost:${process.env.PORT || 3000}/api/mls/update-group-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, epoch: commit.epoch, commitType: 'remove' }),
        }).catch(err => console.error('[MLS] 更新群状态失败:', err));
      }
      break;
    }

    case "mls_update_keys": {
      const { groupId, commit } = msg.payload || {};
      if (groupId && commit) {
        console.log(`[MLS] ${client.userId} 更新密钥, 群 ${groupId}, epoch=${commit.epoch}`);
        // 广播 Commit 给所有在线群成员
        const updateOnlineMembers = getGroupOnlineMembers(groupId);
        if (updateOnlineMembers) {
          for (const uid of updateOnlineMembers) {
            if (uid !== client.userId) {
              sendTo(uid, {
                type: 'mls_commit' as any,
                groupId,
                commit,
              });
            }
          }
        }
        fetch(`http://localhost:${process.env.PORT || 3000}/api/mls/broadcast-commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, commit, commitType: 'update' }),
        }).catch(err => console.error('[MLS] 存储 Commit 失败:', err));
        fetch(`http://localhost:${process.env.PORT || 3000}/api/mls/update-group-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, epoch: commit.epoch, commitType: 'update' }),
        }).catch(err => console.error('[MLS] 更新群状态失败:', err));
      }
      break;
    }

    // ===== 位置共享信令处理 =====
    case "location_share_start": {
      // payload: { chatId, duration (s), initiatorName }
      const { chatId, duration = 3600, initiatorName } = msg.payload || {};
      const shareId = `lshare_${chatId}_${Date.now()}`;
      const expiresAt = Date.now() + duration * 1000;

      // 创建共享房间，发起人加入
      if (!rooms.has(shareId)) rooms.set(shareId, new Set());
      rooms.get(shareId)!.add(client.userId);

      // 存储共享会话元数据
      locationShares.set(shareId, {
        chatId,
        initiatorId: client.userId,
        expiresAt,
        duration,
        positions: new Map(),
        timer: setTimeout(() => endLocationShare(shareId), duration * 1000),
      });

      // 告知发起人共享已创建
      sendTo(client.userId, {
        type: "location_share_info",
        payload: { shareId, expiresAt, members: [client.userId] },
      });

      // 广播给聊天室内所有成员（包含发起人）
      broadcastToRoom(chatId, {
        type: "location_share_started",
        from: client.userId,
        payload: { shareId, initiatorId: client.userId, initiatorName, expiresAt, duration, chatId },
      });
      console.log(`[LocationShare] 共享已创建: shareId=${shareId} chatId=${chatId} duration=${duration}s`);
      break;
    }

    case "location_share_join": {
      // payload: { shareId }
      const { shareId: joinShareId } = msg.payload || {};
      const shareSession = locationShares.get(joinShareId);
      if (!shareSession) {
        sendTo(client.userId, {
          type: "location_share_info",
          payload: { shareId: joinShareId, error: 'share_not_found' },
        });
        break;
      }
      if (Date.now() > shareSession.expiresAt) {
        sendTo(client.userId, {
          type: "location_share_info",
          payload: { shareId: joinShareId, error: 'share_expired' },
        });
        break;
      }
      // 加入共享房间
      if (!rooms.has(joinShareId)) rooms.set(joinShareId, new Set());
      rooms.get(joinShareId)!.add(client.userId);

      // 广播给已在共享房间的成员
      broadcastToRoom(joinShareId, {
        type: "location_share_info",
        from: client.userId,
        payload: { shareId: joinShareId, event: 'member_joined', memberId: client.userId, members: Array.from(rooms.get(joinShareId)!) },
      }, client.userId);

      // 告知新加入者当前共享状态
      const currentPositions: Record<string, any> = {};
      shareSession.positions.forEach((pos, uid) => { currentPositions[uid] = pos; });
      sendTo(client.userId, {
        type: "location_share_info",
        payload: {
          shareId: joinShareId,
          event: 'joined',
          expiresAt: shareSession.expiresAt,
          members: Array.from(rooms.get(joinShareId)!),
          positions: currentPositions,
        },
      });
      break;
    }

    case "location_share_update": {
      // payload: { shareId, lat, lng, accuracy?, heading?, speed? }
      const { shareId: updateShareId, lat, lng, accuracy, heading, speed } = msg.payload || {};
      const session = locationShares.get(updateShareId);
      if (!session || Date.now() > session.expiresAt) break;

      // 更新位置缓存
      const posData = { lat, lng, accuracy, heading, speed, timestamp: Date.now(), userId: client.userId };
      session.positions.set(client.userId, posData);

      // 广播给共享房间内其他成员
      broadcastToRoom(updateShareId, {
        type: "location_share_update",
        from: client.userId,
        payload: posData,
      }, client.userId);
      break;
    }

    case "location_share_stop": {
      // payload: { shareId }
      const { shareId: stopShareId } = msg.payload || {};
      endLocationShare(stopShareId);
      break;
    }

    // ===== 已读回执 =====
    case "read_receipt": {
      // payload: { chatId, messageIds: string[] }
      // 发送方收到已读回执后更新消息状态
      const { chatId: rcChatId, messageIds } = msg.payload || {};
      if (msg.to && Array.isArray(messageIds)) {
        sendTo(msg.to, {
          type: 'read_receipt',
          from: client.userId,
          payload: { chatId: rcChatId, messageIds },
        });
      }
      break;
    }

    // ===== 私聊消息信令处理 =====
    case "private_send": {
      // payload: { chatId, content, msgType, replyToId, extra, tempId, burnAfterRead, hmac }
      const { chatId: pChatId, content: pContent, msgType: pMsgType, replyToId: pReplyToId, extra: rawPExtra, tempId, burnAfterRead: pBurnAfterRead, hmac: pHmac } = msg.payload || {};

      // 强制 P0：私聊必须加密，禁止明文发送
      if (pMsgType !== 'encrypted') {
        sendTo(client.userId, {
          type: 'private_message' as any,
          payload: { ack: true, error: '私聊强制要求端到端加密，请发送加密消息', tempId },
        });
        break;
      }

      // 安全处理 extra：如果客户端传入了字符串，尝试解析为对象
      let pExtra = rawPExtra;
      if (typeof rawPExtra === 'string') {
        try { pExtra = JSON.parse(rawPExtra); } catch { pExtra = undefined; }
      }
      if (pChatId && pContent) {
        // 存储消息到数据库
        (async () => {
          try {
            const chat = await prisma.chat.findUnique({ where: { id: pChatId } });
            if (!chat) return;
            // 验证发送者是会话参与者
            if (chat.participantA !== client.userId && chat.participantB !== client.userId) return;

            // 解析阅后即焚参数（合法值：5, 10, 30, 60, 300, 3600, 86400, 604800）
            const validBurnTimers = [5, 10, 30, 60, 300, 3600, 86400, 604800];
            const burnSeconds = (typeof pBurnAfterRead === 'number' && validBurnTimers.includes(pBurnAfterRead)) ? burnAfterRead : null;

            const message = await prisma.privateMessage.create({
              data: {
                chatId: pChatId,
                senderId: client.userId,
                msgType: 'encrypted',
                content: pContent || '', // 存储加密信封 JSON
                replyToId: pReplyToId || null,
                extra: pExtra ? JSON.stringify(pExtra) : null,
                status: 'sent',
                burnAfterRead: burnSeconds,
                hmac: (typeof pHmac === 'string' && /^[a-f0-9]{64}$/i.test(pHmac)) ? pHmac : null,
              },
            });

            // 更新会话最后消息
            const preview = '🔒 [加密消息]';

            await prisma.chat.update({
              where: { id: pChatId },
              data: { lastMessage: preview, lastMessageAt: message.createdAt },
            });

            const msgPayload: any = {
              id: message.id,
              chatId: message.chatId,
              senderId: message.senderId,
              msgType: message.msgType,
              content: message.content,
              replyToId: message.replyToId,
              isRevoked: false,
              status: 'sent',
              extra: pExtra || undefined,
              createdAt: message.createdAt.getTime(),
              tempId,
            };
            // 阅后即焚消息带上 burnAfterRead 字段
            if (burnSeconds) {
              msgPayload.burnAfterRead = burnSeconds;
            }
            // 消息防篡改：带上 HMAC 签名
            if (message.hmac) {
              msgPayload.hmac = message.hmac;
            }

            // 发送确认给发送者
            sendTo(client.userId, {
              type: 'private_message' as any,
              payload: { ack: true, ...msgPayload },
            });

            // 推送给对方
            const peerId = chat.participantA === client.userId ? chat.participantB : chat.participantA;
            sendTo(peerId, {
              type: 'private_message' as any,
              payload: msgPayload,
            });

            console.log(`[PrivateChat] 消息已发送: from=${client.userId} to=${peerId} chatId=${pChatId}`);

            // 如果对方离线，发送推送通知（个推优先，FCM 备选）
            const peerOnline = await isUserOnline(peerId);
            if (!peerOnline) {
              const senderUser = await prisma.user.findUnique({
                where: { id: client.userId },
                select: { nickname: true, username: true, avatar: true },
              });
              const senderName = senderUser?.nickname || senderUser?.username || '有人';
              // 获取发送者头像的完整 URL（用于推送通知显示）
              const senderAvatarPath = avatarToProxy(senderUser?.avatar);
              const senderAvatarUrl = senderAvatarPath ? `https://wed.imim.chat${senderAvatarPath}` : '';
              const previewText = '🔒 [加密消息]';
              // 查询接收方的推送 Token 类型
              const peerUser = await prisma.user.findUnique({
                where: { id: peerId },
                select: { fcmToken: true },
              });
              // 优先使用自建 APNs，其次个推，最后 FCM
              const { parseAPNsToken: parseAPNs } = await import('./apns.js');
              if (parseAPNs(peerUser?.fcmToken)) {
                const { sendAPNsPush } = await import('./apns.js');
                await sendAPNsPush({
                  toUserId: peerId,
                  title: senderName,
                  body: previewText,
                  senderAvatar: senderAvatarUrl,
                  customData: { chatId: pChatId, senderId: client.userId, sender_name: senderName },
                }).catch((e: any) => console.error('[APNs] 推送异常:', e));
              } else {
                const { parseJPushToken, sendJPushPush } = await import('./jpush.js');
                if (parseJPushToken(peerUser?.fcmToken)) {
                  await sendJPushPush({
                    toUserId: peerId,
                    title: senderName,
                    body: previewText,
                    extras: {
                      chatId: pChatId,
                      senderId: client.userId,
                    },
                  }).catch((e: any) => console.error('[JPush] 推送异常:', e));
                } else {
                const { parseGetuiToken: parseGT } = await import('./getui.js');
                if (parseGT(peerUser?.fcmToken)) {
                  // 使用个推推送（国内高到达率）
                  const { sendGetuiPush } = await import('./getui.js');
                  await sendGetuiPush({
                    toUserId: peerId,
                    title: senderName,
                    body: previewText,
                    senderAvatar: senderAvatarUrl,
                    payload: JSON.stringify({ chatId: pChatId, senderId: client.userId, senderAvatar: senderAvatarUrl }),
                  }).catch((e: any) => console.error('[个推] 推送异常:', e));
                } else {
                  // 使用 FCM 推送（海外/GMS 设备）
                  const { sendFCMPush } = await import('./fcm.js');
                  await sendFCMPush({
                    toUserId: peerId,
                    title: senderName,
                    body: previewText,
                    data: { chatId: pChatId, senderId: client.userId, sender_avatar: senderAvatarUrl },
                  }).catch((e: any) => console.error('[FCM] 推送异常:', e));
                }
                }
              }
            }
          } catch (err) {
            console.error('[PrivateChat] 发送失败:', err);
          }
        })();
      }
      break;
    }

    case "private_typing": {
      // payload: { chatId }
      const { chatId: typingChatId } = msg.payload || {};
      if (typingChatId && msg.to) {
        sendTo(msg.to, {
          type: 'private_typing' as any,
          from: client.userId,
          payload: { chatId: typingChatId },
        });
      }
      break;
    }

    // ===== 应用层心跳（刷新 Redis 在线状态 TTL） =====
    case "heartbeat": {
      if (client.userId) {
        refreshUserOnline(client.userId).catch(() => {});
      }
      // 回复心跳 ACK，客户端可用于检测连通性
      client.ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
      break;
    }

    // ===== 私聊消息撤回 =====
    case "recall": {
      // payload: { chatId, messageId }
      const { chatId: recallChatId, messageId: recallMsgId } = msg.payload || {};
      if (msg.to && recallMsgId) {
        // 推送撤回通知给对方
        sendTo(msg.to, {
          type: 'recall_notify',
          from: client.userId,
          payload: { chatId: recallChatId, messageId: recallMsgId },
        });
        console.log(`[Recall] 私聊撤回: from=${client.userId} to=${msg.to} msgId=${recallMsgId}`);
      }
      break;
    }

    // ===== 阅后即焚：接收方标记消息已读，启动倒计时 =====
    case "burn_read" as any: {
      // payload: { chatId, messageId }
      const { chatId: brChatId, messageId: brMsgId } = msg.payload || {};
      if (brChatId && brMsgId) {
        (async () => {
          try {
            const burnMsg = await prisma.privateMessage.findUnique({ where: { id: brMsgId } });
            if (!burnMsg || !burnMsg.burnAfterRead || burnMsg.burnReadAt) return;
            // 只有接收方才能标记已读（非发送者）
            if (burnMsg.senderId === client.userId) return;
            const now = new Date();
            const expireAt = new Date(now.getTime() + burnMsg.burnAfterRead * 1000);
            await prisma.privateMessage.update({
              where: { id: brMsgId },
              data: { burnReadAt: now, burnExpireAt: expireAt, status: 'read' },
            });
            // 通知发送方：消息已被阅读，开始倒计时
            sendTo(burnMsg.senderId, {
              type: 'burn_read' as any,
              from: client.userId,
              payload: { chatId: brChatId, messageId: brMsgId, readAt: now.getTime(), burnAfterRead: burnMsg.burnAfterRead },
            });
            console.log(`[BurnAfterRead] 消息已读: msgId=${brMsgId} burnAfterRead=${burnMsg.burnAfterRead}s expireAt=${expireAt.toISOString()}`);
          } catch (err) {
            console.error('[BurnAfterRead] 标记已读失败:', err);
          }
        })();
      }
      break;
    }

    // ===== 阅后即焚：客户端通知服务器消息已销毁 =====
    case "burn_delete" as any: {
      // payload: { chatId, messageId }
      const { chatId: bdChatId, messageId: bdMsgId } = msg.payload || {};
      if (bdChatId && bdMsgId) {
        (async () => {
          try {
            // 从数据库彻底删除消息
            await prisma.privateMessage.delete({ where: { id: bdMsgId } }).catch(() => {});
            // 通知对方也删除
            if (msg.to) {
              sendTo(msg.to, {
                type: 'burn_delete' as any,
                from: client.userId,
                payload: { chatId: bdChatId, messageId: bdMsgId },
              });
            }
            console.log(`[BurnAfterRead] 消息已销毁: msgId=${bdMsgId}`);
          } catch (err) {
            console.error('[BurnAfterRead] 删除失败:', err);
          }
        })();
      }
      break;
    }

    // ===== 群聊消息撤回 =====
    case "group_recall": {
      // payload: { groupId, messageId, seq }
      const { groupId: recallGroupId, messageId: recallGroupMsgId, seq: recallSeq } = msg.payload || {};
      if (recallGroupId && recallGroupMsgId) {
        // 尝试在数据库标记为已撤回
        prisma.groupMessage.updateMany({
          where: { id: recallGroupMsgId },
          data: { isRevoked: true },
        }).catch(err => console.error('[GroupRecall] DB更新失败:', err));
        // 广播撤回通知给群内在线成员
        const recallNotify: SignalMessage = {
          type: 'group_recall_notify',
          from: client.userId,
          payload: { groupId: recallGroupId, messageId: recallGroupMsgId, seq: recallSeq },
        };
        broadcastToRoom(recallGroupId, recallNotify);
        console.log(`[GroupRecall] 群聊撤回: from=${client.userId} group=${recallGroupId} msgId=${recallGroupMsgId}`);
      }
      break;
    }
  }
}

// ===== 位置共享会话存储 =====
interface LocationShareSession {
  chatId: string;
  initiatorId: string;
  expiresAt: number;
  duration: number;
  positions: Map<string, any>;
  timer: ReturnType<typeof setTimeout>;
}
const locationShares = new Map<string, LocationShareSession>();

function endLocationShare(shareId: string) {
  const session = locationShares.get(shareId);
  if (!session) return;
  clearTimeout(session.timer);
  // 广播结束事件给共享房间内所有成员
  broadcastToRoom(shareId, {
    type: "location_share_ended",
    payload: { shareId, chatId: session.chatId },
  });
  // 清理房间和会话
  rooms.delete(shareId);
  locationShares.delete(shareId);
  console.log(`[LocationShare] 共享已结束: shareId=${shareId}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.locals.sendTo = sendTo;

  // 信任上游代理（仅信任 Docker 内网和本地回环）
  app.set('trust proxy', ['loopback', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);

  // ============ 安全中间件层 ============

  // Cookie 解析（CSRF 双重提交模式需要）
  app.use(cookieParser());

  // gzip/deflate 响应压缩（API 与静态资源同时受益）
  // - 仅压缩可压缩内容（HTML/JSON/JS/CSS 等），跳过已压缩格式（图片/视频）
  // - threshold=1KB，避免对极小响应做无意义的 CPU 开销
  app.use(compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
  }));

  // 安全响应头：HSTS / CSP / X-Frame-Options / X-Content-Type-Options
  app.use(securityHeaders);

  // 全局 API 速率限制：每 IP 每分钟 120 次
  app.use('/api/', globalRateLimit);

  // 解析 JSON 请求体
  app.use(express.json({ limit: '10mb' }));

  // 语音上传路由使用更大的请求体限制
  app.use('/api/voice', express.json({ limit: '50mb' }));
  app.use('/api/media/upload', express.json({ limit: '50mb' }));

  // ============ 管理员后台 API（安全加固） ============
  // IP 白名单 → CSRF 防护 → 路由
  app.use('/api/admin', adminIpWhitelist);
  app.use('/api/admin', csrfTokenGenerate);
  app.use('/api/admin', csrfTokenVerify);
  app.use('/api/admin', adminRouter);

  // ============ 用户认证 API ============
  app.use('/api/auth', authRouter);

  // ============ 朋友圈 API ============
  app.use('/api/moments', momentsRouter);

  // ============ 万人群消息 API ============
  app.use('/api/group', groupRouter);

  // ============ E2EE 加密 API ============
  app.use('/api/crypto', cryptoRouter);

  // ============ MLS 群组 E2EE API ============
  app.use('/api/mls', mlsRouter);

  // ============ 阅后即焚 API ============
  app.use('/api/group', burnRouter);

  // 启动阅后即焚定期清理任务（每 60 秒清理一次过期消息）
  startBurnCleanupCron(60000);

  // ============ 私聊消息 API ============
  app.use("/api/chat", privateChatRouter);
app.use("/api/home", homeRouter);

  // 好友关系 API
  app.use('/api/friend', friendRouter);

  // 二维码校验
  app.use('/api/qr', qrRouter);

  // FCM 推送 Token 管理
  app.use('/api/fcm', fcmRouter);
  app.use('/api/getui', getuiRouter);
  app.use('/api/apns', apnsRouter);
  app.use('/api/jpush', jpushRouter);

  // ============ 贴纸 API ============
  // 注册 TGS 和 WebP 的正确 MIME 类型，确保浏览器能正确处理
  express.static.mime.define({ 'application/x-tgsticker': ['tgs'] });
  express.static.mime.define({ 'image/webp': ['webp'] });
  app.use(STICKER_STATIC_PREFIX, express.static(STICKER_FILES_DIR, {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      // 为贴纸静态文件设置正确的缓存头
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      // TGS 文件设置正确的 Content-Type
      if (filePath.endsWith('.tgs')) {
        res.setHeader('Content-Type', 'application/x-tgsticker');
      }
      // 允跨域访问贴纸文件（如果存在跨域需求）
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  }));
  app.use('/api/stickers', stickerRouter);
  ensureStickerStore();

  // ============ 频道 API ============
  const { default: channelRouter } = await import('./channel.js');
  app.use('/api/channel', channelRouter);

  // ============ TRTC UserSig 生成接口 ============

  /**
   * GET /api/trtc/usersig
   * 为当前登录用户生成腾讯云 TRTC 所需的 UserSig
   * 需要 Bearer Token 认证
   */
  app.get('/api/trtc/usersig', optionalAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) {
        return res.status(401).json({ error: '未登录' });
      }

      const TRTC_SDK_APPID = Number(process.env.TRTC_SDK_APP_ID) || 1600136830;
      const TRTC_SECRET_KEY = process.env.TRTC_SECRET_KEY || '';
      if (!TRTC_SECRET_KEY) {
        return res.status(500).json({ error: 'TRTC 未配置' });
      }
      const EXPIRE = 86400; // 24 小时

      // 使用与腾讯云官方 tls-sig-api-v2 完全一致的算法生成 UserSig
      const userId = String(user.id);
      const currTime = Math.floor(Date.now() / 1000);

      // Step 1: HMAC-SHA256 签名
      let contentToBeSigned = 'TLS.identifier:' + userId + '\n';
      contentToBeSigned += 'TLS.sdkappid:' + TRTC_SDK_APPID + '\n';
      contentToBeSigned += 'TLS.time:' + currTime + '\n';
      contentToBeSigned += 'TLS.expire:' + EXPIRE + '\n';

      const hmac = crypto.createHmac('sha256', TRTC_SECRET_KEY);
      const sig = hmac.update(contentToBeSigned).digest('base64');

      // Step 2: 构建 sigDoc
      const sigDoc: Record<string, any> = {
        'TLS.ver': '2.0',
        'TLS.identifier': userId,
        'TLS.sdkappid': Number(TRTC_SDK_APPID),
        'TLS.time': Number(currTime),
        'TLS.expire': Number(EXPIRE),
        'TLS.sig': sig,
      };

      // Step 3: zlib 压缩 + base64url 编码
      const { deflateSync } = await import('zlib');
      const compressed = deflateSync(Buffer.from(JSON.stringify(sigDoc))).toString('base64');
      // base64url escape: + -> *, / -> -, = -> _
      const userSig = compressed.replace(/\+/g, '*').replace(/\//g, '-').replace(/=/g, '_');

      res.json({
        sdkAppId: TRTC_SDK_APPID,
        userId,
        userSig,
        expireTime: EXPIRE,
      });
    } catch (err) {
      console.error('[TRTC] UserSig 生成失败:', err);
      res.status(500).json({ error: 'UserSig 生成失败' });
    }
  });


  // ============ 登录信息接口 ============

  /**
   * GET /api/login-info
   * 返回客户端真实 IP 和地理位置，用于登录安全通知
   */
  app.get('/api/login-info', async (req, res) => {
    try {
      const ip = getRealClientIP(req);
      const location = await getIPLocation(ip);

      // 记录日志（生产环境可写入数据库）
      console.log(`[LoginInfo] IP: ${ip} | 地点: ${location} | UA: ${req.headers['user-agent']?.slice(0, 80)}`);

      res.json({
        ip,
        location,
        // ★ 安全优化：生产环境不返回调试信息，防止内部架构泄露
        ...(process.env.NODE_ENV !== 'production' ? {
          _debug: {
            cfConnectingIp: req.headers['cf-connecting-ip'] || null,
            xRealIp: req.headers['x-real-ip'] || null,
            xForwardedFor: req.headers['x-forwarded-for'] || null,
            remoteAddress: req.socket?.remoteAddress || null,
          },
        } : {}),
      });
    } catch (err) {
      console.error('[LoginInfo] 错误:', err);
      res.json({ ip: 'unknown', location: '未知地点' });
    }
  });

  /**
   * GET /api/site-config-public
   * 返回可公开的站点配置子集（不含敏感字段）
   * 供前端渲染阶段读取（例如朋友圈视频是否自动播放）
   */
  app.get('/api/site-config-public', async (_req, res) => {
    try {
      const site = (await getSystemConfig<any>('site')) || {};
      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        name: site.name || 'CQIM',
        description: site.description || '',
        url: site.url || '',
        logo: site.logo || '',
        icp: site.icp || '',
        policeIcp: site.policeIcp || '',
        copyright: site.copyright || '',
        autoPlayVideo: !!site.autoPlayVideo,
      });
    } catch (err) {
      console.error('[site-config-public] error:', err);
      res.json({ name: 'CQIM', autoPlayVideo: false });
    }
  });

  // ============ AI 聊天接口 ============

  /**
   * POST /api/ai-chat
   * 代理 OpenAI API，实现 BOT 聊天回复
   * Body: { messages: [{ role: 'user'|'assistant', content: string }] }
   */
  app.post('/api/ai-chat', async (req, res) => {
    try {
      const { messages } = req.body as {
        messages: Array<{ role: string; content: string }>;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: '无效的消息格式' });
      }

      // 使用环境变量中的 OpenAI API Key
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'AI 服务未配置' });
      }

      // 调用 OpenAI 兼容 API
      const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const model = process.env.AI_MODEL || 'gpt-4.1-mini';

      const payload = JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是 imim AI，一个友好、智能、专业的聊天助手。你可以回答问题、帮助写作、翻译、分析代码等。回答简洁清晰，默认使用中文回复。',
          },
          ...messages.slice(-20), // 保留最近 20 条消息作为上下文
        ],
        max_tokens: 1000,
        temperature: 0.7,
      });

      const response = await new Promise<string>((resolve, reject) => {
        const url = new URL(`${baseUrl}/chat/completions`);
        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(payload),
          },
        };

        const httpModule = url.protocol === 'https:' ? https : require('http');
        const reqHttp = httpModule.request(options, (apiRes: any) => {
          let data = '';
          apiRes.on('data', (chunk: any) => { data += chunk; });
          apiRes.on('end', () => resolve(data));
        });
        reqHttp.on('error', reject);
        reqHttp.setTimeout(30000, () => { reqHttp.destroy(); reject(new Error('AI 请求超时')); });
        reqHttp.write(payload);
        reqHttp.end();
      });

      const json = JSON.parse(response);
      const reply = json.choices?.[0]?.message?.content?.trim();

      if (!reply) {
        return res.status(500).json({ error: 'AI 返回空内容' });
      }

      console.log(`[AI Chat] 回复长度: ${reply.length} 字符`);
      return res.json({ reply });
    } catch (err) {
      console.error('[AI Chat] 错误:', err);
      return res.status(500).json({ error: '服务内部错误' });
    }
  });

  // ============ OneBot v11 反向 WebSocket 服务 ============

  /**
   * AstrBot 连接到 /onebot/v11/ws 进行反向 WS 通信
   * AstrBot 配置：连接方式=反向 WS，地址=ws://your-server/onebot/v11/ws
   */
  const onebotWss = new WebSocketServer({ noServer: true });

  onebotWss.on('connection', (ws, req) => {
    // 鉴权检查（可选，通过 Authorization 头或 access_token 查询参数）
    const url = new URL(req.url || '/', 'http://localhost');
    const token = url.searchParams.get('access_token') ||
      (req.headers.authorization as string)?.replace('Bearer ', '');
    const configuredToken = process.env.ONEBOT_ACCESS_TOKEN;
    if (configuredToken && token !== configuredToken) {
      ws.close(1008, 'Unauthorized');
      console.warn('[OneBot] 拒绝未授权连接');
      return;
    }

    onebotClients.add(ws);
    console.log(`[OneBot] AstrBot 已连接 (当前客户端数: ${onebotClients.size})`);

    // 发送生命周期事件
    ws.send(JSON.stringify({
      time: Math.floor(Date.now() / 1000),
      self_id: BOT_SELF_ID,
      post_type: 'meta_event',
      meta_event_type: 'lifecycle',
      sub_type: 'connect',
    }));

    // 处理 AstrBot 发来的动作（通过 WS 发送的 API 调用）
    ws.on('message', (data) => {
      try {
        const action = JSON.parse(data.toString()) as OneBotAction;
        handleOneBotAction(ws, action);
      } catch (e) {
        console.error('[OneBot] 无法解析动作:', e);
      }
    });

    ws.on('close', () => {
      onebotClients.delete(ws);
      console.log(`[OneBot] AstrBot 断开 (剩余: ${onebotClients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[OneBot] WS 错误:', err.message);
    });
  });

  // 心跳包：每 30 秒向所有 AstrBot 客户端发送心跳
  setInterval(() => {
    if (onebotClients.size === 0) return;
    pushOneBotEvent({
      time: Math.floor(Date.now() / 1000),
      self_id: BOT_SELF_ID,
      post_type: 'meta_event',
      meta_event_type: 'heartbeat',
      status: { online: true, good: true },
      interval: 30000,
    });
  }, 30000);

  // ============ OneBot v11 HTTP API 接口 ============

  /**
   * 处理 AstrBot 通过 WS 发送的动作请求
   */
  function handleOneBotAction(ws: WebSocket, action: OneBotAction) {
    const { action: actionName, params, echo } = action;
    if (actionName === 'send_msg' || actionName === 'send_private_msg' || actionName === 'send_group_msg') {
      console.log(`[OneBot] 收到消息动作: ${actionName}, 原始消息体:`, JSON.stringify(params.message));
    } else {
      console.log(`[OneBot] 动作: ${actionName}`, JSON.stringify(params).slice(0, 100));
    }

    const respond = (data: any, retcode = 0) => {
      ws.send(JSON.stringify({
        status: retcode === 0 ? 'ok' : 'failed',
        retcode,
        data,
        echo: echo || null,
      }));
    };

    switch (actionName) {
      case 'send_group_msg': {
        const groupId = Number(params.group_id);
        const msgId = `ob-${Date.now()}`;
        const recordSeg = extractRecordSegment(params.message);
        const text = segmentsToText(params.message);
        console.log(`[OneBot] 解析文本结果: "${text}" | 是否有语音: ${!!recordSeg}`);

        if (recordSeg) {
          downloadVoiceFile(recordSeg).then(voiceResult => {
            if (voiceResult) {
              // 关键修复：确保 text 被正确广播，不使用 BOT_VOICE_LABEL 覆盖
              broadcastBotMessageToGroup(groupId, text || '', { voiceUrl: voiceResult.publicUrl });
            } else {
              broadcastBotMessageToGroup(groupId, text || '', { voiceUrl: 'error' });
            }
          });
        } else {
          broadcastBotMessageToGroup(groupId, text);
          synthesizeAndBroadcastBotVoiceToGroup(groupId, text);
        }
        respond({ message_id: msgId });
        break;
      }

      case 'send_private_msg': {
        const userId = String(params.user_id);
        const msgId = `ob-${Date.now()}`;
        const recordSeg = extractRecordSegment(params.message);
        const text = segmentsToText(params.message);
        console.log(`[OneBot] 解析文本结果: "${text}" | 是否有语音: ${!!recordSeg}`);

        if (recordSeg) {
          downloadVoiceFile(recordSeg).then(voiceResult => {
            if (voiceResult) {
              broadcastBotMessageToUser(userId, text || '', { voiceUrl: voiceResult.publicUrl });
            } else {
              broadcastBotMessageToUser(userId, text || '', { voiceUrl: 'error' });
            }
          });
        } else {
          broadcastBotMessageToUser(userId, text);
          synthesizeAndBroadcastBotVoiceToUser(userId, text);
        }
        respond({ message_id: msgId });
        break;
      }

      case 'send_msg': {
        const msgType = params.message_type;
        const msgId = `ob-${Date.now()}`;
        console.log('[OneBot] send_msg 完整 params:', JSON.stringify(params));
        const recordSeg = extractRecordSegment(params.message);
        // 增强：传入 raw_message 辅助提取文字
        const text = segmentsToText(params.message, params.raw_message);
        console.log(`[OneBot] send_msg 解析文本结果: "${text}" | 是否有语音: ${!!recordSeg}`);

        if (recordSeg) {
          downloadVoiceFile(recordSeg).then(voiceResult => {
            if (msgType === 'group') {
              const groupId = Number(params.group_id);
              if (voiceResult) {
                broadcastBotMessageToGroup(groupId, text || '', { 
                  voiceUrl: voiceResult.publicUrl,
                  duration: (voiceResult as any).duration
                });
              } else {
                broadcastBotMessageToGroup(groupId, text || '', { voiceUrl: 'error' });
              }
            } else {
              const userId = String(params.user_id);
              if (voiceResult) {
                broadcastBotMessageToUser(userId, text || '', { 
                  voiceUrl: voiceResult.publicUrl,
                  duration: (voiceResult as any).duration
                });
              } else {
                broadcastBotMessageToUser(userId, text || '', { voiceUrl: 'error' });
              }
            }
          });
        } else {
          // 关键修复：合并发送。不再立即 broadcast 纯文字，而是交给合成函数，合成完发一条带文字+语音的消息。
          if (msgType === 'group') {
            const groupId = Number(params.group_id);
            synthesizeAndBroadcastBotVoiceToGroup(groupId, text);
          } else {
            const userId = String(params.user_id);
            synthesizeAndBroadcastBotVoiceToUser(userId, text);
          }
        }
        respond({ message_id: msgId });
        break;
      }

      case 'delete_msg': {
        // 模拟撤回（前端暂时无法实时撤回，返回成功）
        respond(null);
        break;
      }

      case 'get_login_info': {
        respond({ user_id: BOT_SELF_ID, nickname: 'imim AI' });
        break;
      }

      case 'get_group_info': {
        const groupId = Number(params.group_id);
        const group = groupRegistry.get(groupId);
        if (group) {
          respond({
            group_id: groupId,
            group_name: group.name,
            member_count: group.memberIds.length,
            max_member_count: 200,
          });
        } else {
          respond(null, 100);
        }
        break;
      }

      case 'get_group_list': {
        const list = Array.from(groupRegistry.entries()).map(([id, g]) => ({
          group_id: id,
          group_name: g.name,
          member_count: g.memberIds.length,
        }));
        respond(list);
        break;
      }

      case 'get_group_member_list': {
        const groupId = Number(params.group_id);
        const group = groupRegistry.get(groupId);
        if (group) {
          const members = group.memberIds.map(uid => ({
            group_id: groupId,
            user_id: uid,
            nickname: userRegistry.get(uid) || uid,
            card: '',
            sex: 'unknown',
            age: 0,
            area: '',
            join_time: Math.floor(Date.now() / 1000) - 86400 * 30,
            last_sent_time: Math.floor(Date.now() / 1000),
            level: '1',
            role: uid === 'me' ? 'owner' : 'member',
            unfriendly: false,
            title: '',
            title_expire_time: 0,
            card_changeable: true,
          }));
          respond(members);
        } else {
          respond([], 100);
        }
        break;
      }

      case 'get_group_member_info': {
        const groupId = Number(params.group_id);
        const userId = String(params.user_id);
        respond({
          group_id: groupId,
          user_id: userId,
          nickname: userRegistry.get(userId) || userId,
          card: '',
          role: userId === 'me' ? 'owner' : 'member',
        });
        break;
      }

      case 'get_stranger_info':
      case 'get_friend_info': {
        const userId = String(params.user_id);
        respond({
          user_id: userId,
          nickname: userRegistry.get(userId) || userId,
          sex: 'unknown',
          age: 0,
        });
        break;
      }

      case 'get_friend_list': {
        const friends = Array.from(userRegistry.entries())
          .filter(([id]) => id !== 'BOT' && id !== 'official')
          .map(([id, name]) => ({ user_id: id, nickname: name, remark: '' }));
        respond(friends);
        break;
      }

      case 'get_status': {
        respond({ online: true, good: true });
        break;
      }

      case 'get_version_info': {
        respond({
          app_name: 'imim',
          app_version: '2.0.0',
          protocol_version: 'v11',
        });
        break;
      }

      default: {
        console.warn(`[OneBot] 未知动作: ${actionName}`);
        respond(null, 1404);
      }
    }
  }

  const BOT_VOICE_LABEL = 'AI 语音回复';
  const BOT_VOICE_GENERATION_FAILED_TEXT = '语音暂时生成失败，请先查看上方文字回复';
  const BOT_VOICE_LOAD_FAILED_TEXT = '语音暂时加载失败，请稍后重试';

  /**
   * 将 BOT 回复广播到群里所有在线用户
   * 通过现有的 IM 信令 WebSocket（clients Map）推送
   */
  function broadcastBotMessageToGroup(groupId: number, text: string, voiceData?: { voiceUrl: string; duration?: number }) {
    const group = groupRegistry.get(groupId);
    const chatId = `c${groupId}`; // c3, c5 等
    const msg: any = {
      type: 'bot_message',
      chatId,
      senderId: 'BOT',
      content: text,
      messageId: `bot-${Date.now()}`,
      timestamp: Date.now(),
    };
    // 如果包含语音数据，添加语音字段
    if (voiceData) {
      msg.msgType = 'voice';
      msg.voiceUrl = voiceData.voiceUrl;
      msg.duration = voiceData.duration || 0;
    }
    // 向群成员推送
    if (group) {
      group.memberIds.forEach(uid => {
        const client = clients.get(uid);
        if (client && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(msg));
        }
      });
    }
    console.log(`[OneBot] BOT 群消息已推送到 chatId=${chatId}${voiceData ? ' [语音]' : ''}`);
  }

  /**
   * 将 BOT 回复推送给指定用户
   */
  function broadcastBotMessageToUser(userId: string, text: string, voiceData?: { voiceUrl: string; duration?: number }) {
    const client = clients.get(userId);
    const msg: any = {
      type: 'bot_message',
      chatId: 'cBOT',
      senderId: 'BOT',
      content: text,
      messageId: `bot-${Date.now()}`,
      timestamp: Date.now(),
    };
    // 如果包含语音数据，添加语音字段
    if (voiceData) {
      msg.msgType = 'voice';
      msg.voiceUrl = voiceData.voiceUrl;
      msg.duration = voiceData.duration || 0;
    }
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
    console.log(`[OneBot] BOT 私聊已推送到 userId=${userId}${voiceData ? ' [语音]' : ''}`);
  }

  function broadcastBotVoiceLoadFailureToGroup(groupId: number) {
    broadcastBotMessageToGroup(groupId, BOT_VOICE_LOAD_FAILED_TEXT);
  }

  function broadcastBotVoiceLoadFailureToUser(userId: string) {
    broadcastBotMessageToUser(userId, BOT_VOICE_LOAD_FAILED_TEXT);
  }

  function synthesizeAndBroadcastBotVoiceToGroup(groupId: number, text: string) {
    void synthesizeBotVoice(text).then((voiceData) => {
      if (voiceData) {
        // 关键修复：合成语音时保留原始文字
        broadcastBotMessageToGroup(groupId, text, voiceData);
      } else {
        // 如果语音合成失败，只发送文字
        broadcastBotMessageToGroup(groupId, text);
      }
    });
  }

  function synthesizeAndBroadcastBotVoiceToUser(userId: string, text: string) {
    void synthesizeBotVoice(text).then((voiceData) => {
      if (voiceData) {
        // 关键修复：合成语音时保留原始文字
        broadcastBotMessageToUser(userId, text, voiceData);
      } else {
        // 如果语音合成失败，只发送文字
        broadcastBotMessageToUser(userId, text);
      }
    });
  }

  // ============ OneBot v11 HTTP API 备用接口（兼容 HTTP POST 方式） ============

  app.post('/send_group_msg', async (req, res) => {
    const p = req.body.params || req.body;
    console.log('[OneBot] 收到群聊原始消息:', JSON.stringify(p.message));
    const groupId = Number(p.group_id);
    const recordSeg = extractRecordSegment(p.message);
    if (recordSeg) {
      const voiceResult = await downloadVoiceFile(recordSeg);
      const text = segmentsToText(p.message);
      if (voiceResult) {
        // 关键修复：绝对不使用 BOT_VOICE_LABEL 覆盖真实 text
        broadcastBotMessageToGroup(groupId, text || '', { 
          voiceUrl: voiceResult.publicUrl,
          duration: (voiceResult as any).duration
        });
      } else {
        broadcastBotMessageToGroup(groupId, text || '', { voiceUrl: 'error' });
      }
    } else {
      const text = segmentsToText(p.message);
      synthesizeAndBroadcastBotVoiceToGroup(groupId, text);
    }
    res.json({ status: 'ok', retcode: 0, data: { message_id: `ob-${Date.now()}` } });
  });

  app.post('/send_private_msg', async (req, res) => {
    const p = req.body.params || req.body;
    console.log('[OneBot] 收到私聊原始消息:', JSON.stringify(p.message));
    const userId = String(p.user_id);
    const recordSeg = extractRecordSegment(p.message);
    if (recordSeg) {
      const voiceResult = await downloadVoiceFile(recordSeg);
      const text = segmentsToText(p.message);
      if (voiceResult) {
        // 关键修复：绝对不使用 BOT_VOICE_LABEL 覆盖真实 text
        broadcastBotMessageToUser(userId, text || '', { 
          voiceUrl: voiceResult.publicUrl,
          duration: (voiceResult as any).duration
        });
      } else {
        broadcastBotMessageToUser(userId, text || '', { voiceUrl: 'error' });
      }
    } else {
      const text = segmentsToText(p.message);
      synthesizeAndBroadcastBotVoiceToUser(userId, text);
    }
    res.json({ status: 'ok', retcode: 0, data: { message_id: `ob-${Date.now()}` } });
  });

  app.post('/send_msg', async (req, res) => {
    const p = req.body.params || req.body;
    const recordSeg = extractRecordSegment(p.message);
    const text = segmentsToText(p.message);
    console.log(`[OneBot] HTTP send_msg 解析结果: text="${text}", hasVoice=${!!recordSeg}`);

    if (recordSeg) {
      const voiceResult = await downloadVoiceFile(recordSeg);
      if (p.message_type === 'group') {
        const groupId = Number(p.group_id);
        if (voiceResult) {
          broadcastBotMessageToGroup(groupId, text || '', { 
            voiceUrl: voiceResult.publicUrl,
            duration: (voiceResult as any).duration
          });
        } else {
          broadcastBotMessageToGroup(groupId, text || '', { voiceUrl: 'error' });
        }
      } else {
        const userId = String(p.user_id);
        if (voiceResult) {
          broadcastBotMessageToUser(userId, text || '', { 
            voiceUrl: voiceResult.publicUrl,
            duration: (voiceResult as any).duration
          });
        } else {
          broadcastBotMessageToUser(userId, text || '', { voiceUrl: 'error' });
        }
      }
    } else {
      if (p.message_type === 'group') {
        const groupId = Number(p.group_id);
        synthesizeAndBroadcastBotVoiceToGroup(groupId, text);
      } else {
        const userId = String(p.user_id);
        synthesizeAndBroadcastBotVoiceToUser(userId, text);
      }
    }
    res.json({ status: 'ok', retcode: 0, data: { message_id: `ob-${Date.now()}` } });
  });

  app.post('/delete_msg', (_req, res) => {
    res.json({ status: 'ok', retcode: 0, data: null });
  });

  app.get('/get_login_info', (_req, res) => {
    res.json({ status: 'ok', retcode: 0, data: { user_id: BOT_SELF_ID, nickname: 'imim AI' } });
  });

  app.get('/get_group_list', (_req, res) => {
    const list = Array.from(groupRegistry.entries()).map(([id, g]) => ({
      group_id: id, group_name: g.name, member_count: g.memberIds.length,
    }));
    res.json({ status: 'ok', retcode: 0, data: list });
  });

  app.get('/get_group_info', (req, res) => {
    const groupId = Number(req.query.group_id);
    const group = groupRegistry.get(groupId);
    if (group) {
      res.json({ status: 'ok', retcode: 0, data: { group_id: groupId, group_name: group.name, member_count: group.memberIds.length } });
    } else {
      res.json({ status: 'failed', retcode: 100, data: null });
    }
  });

  app.get('/get_group_member_list', (req, res) => {
    const groupId = Number(req.query.group_id);
    const group = groupRegistry.get(groupId);
    const members = (group?.memberIds || []).map(uid => ({
      group_id: groupId, user_id: uid,
      nickname: userRegistry.get(uid) || uid, role: uid === 'me' ? 'owner' : 'member',
    }));
    res.json({ status: 'ok', retcode: 0, data: members });
  });

  app.get('/get_status', (_req, res) => {
    res.json({ status: 'ok', retcode: 0, data: { online: true, good: true } });
  });

  app.get('/get_version_info', (_req, res) => {
    res.json({ status: 'ok', retcode: 0, data: { app_name: 'imim', app_version: '2.0.0', protocol_version: 'v11' } });
  });

  // 初始化群组注册表
  initGroupRegistry();

  // ============ 语音文件服务 ============

  /**
   * GET /api/voice/:filename
   * 静态服务机器人语音文件
   */
  app.use('/api/voice', express.static(VOICE_DIR, {
    setHeaders: (res) => {
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Access-Control-Allow-Origin', '*');
    },
  }));

  /**
   * POST /api/voice/upload
   * 前端上传用户语音文件（用于推送给 AstrBot 进行 STT 识别）
   * Body: { audioBase64: string, mimeType?: string }
   * Returns: { ok: true, voiceUrl: string, fileName: string }
   */
  app.post('/api/voice/upload', (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/ogg' } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ ok: false, error: '缺少 audioBase64 参数' });
      }

      // ★ MIME 类型白名单校验（仅允许音频格式）
      const extMap: Record<string, string> = {
        'audio/ogg': '.ogg',
        'audio/webm': '.webm',
        'audio/mp3': '.mp3',
        'audio/mpeg': '.mp3',
        'audio/wav': '.wav',
        'audio/mp4': '.m4a',
        'audio/webm;codecs=opus': '.webm',
        'audio/ogg;codecs=opus': '.ogg',
      };
      const ext = extMap[mimeType];
      if (!ext) {
        return res.status(400).json({ ok: false, error: '不支持的音频格式' });
      }

      const buffer = Buffer.from(audioBase64, 'base64');

      // ★ 文件大小限制：最大 10MB
      const MAX_VOICE_SIZE = 10 * 1024 * 1024;
      if (buffer.length > MAX_VOICE_SIZE) {
        return res.status(400).json({ ok: false, error: '语音文件过大，最大 10MB' });
      }

      // ★ 安全文件名：仅使用随机字符，防止路径遍历
      const fileName = `user_voice_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      const localPath = path.join(VOICE_DIR, fileName);

      // ★ 确保写入路径在 VOICE_DIR 内（防路径遍历）
      if (!localPath.startsWith(VOICE_DIR)) {
        return res.status(400).json({ ok: false, error: '无效的文件路径' });
      }

      fs.writeFileSync(localPath, buffer);

      const voiceUrl = `/api/voice/${fileName}`;
      console.log(`[Voice] 用户语音已上传: ${localPath} (${buffer.length} bytes)`);

      return res.json({ ok: true, voiceUrl, fileName });
    } catch (err: any) {
      console.error('[Voice] 上传失败:', err);
      // ★ 不暴露内部错误详情
      return res.status(500).json({ ok: false, error: '上传失败' });
    }
  });

  // ===== 媒体文件上传（图片/视频） =====
  const MEDIA_DIR = path.resolve(__dirname, '..', 'data', 'media');
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }

  // 静态文件服务
  app.use('/api/media/files', express.static(MEDIA_DIR, {
    setHeaders: (res) => {
      res.set('Cache-Control', 'public, max-age=86400');
    },
  }));

  /**
   * GET /api/cos/sts
   * 为前端直传 COS 生成临时密钥，上传目录按用户 ID 隔离
   */
  app.get('/api/cos/sts', userAuth, async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser?.id) {
      return res.status(401).json({ error: '请先登录' });
    }

    const cosConfig = await getSystemConfig<any>('cos') || {};
    const secretId = cosConfig.secretId || process.env.COS_SECRET_ID;
    const secretKey = cosConfig.secretKey || process.env.COS_SECRET_KEY;
    const bucket = cosConfig.bucket || process.env.COS_BUCKET;
    const region = cosConfig.region || process.env.COS_REGION || 'ap-guangzhou';
    const enabled = cosConfig.enabled !== false;

    if (!enabled) {
      return res.status(503).json({ error: 'COS 上传功能已禁用' });
    }
    if (!secretId || !secretKey || !bucket || !region) {
      return res.status(503).json({ error: 'COS 未配置，请先在管理后台完成配置' });
    }

    try {
      const STSModule: any = await import('qcloud-cos-sts');
      const STS = STSModule.default || STSModule;
      const appId = bucket.substring(bucket.lastIndexOf('-') + 1);
      // 按用户名分类存储（用户名为空时回退 cuid）
      const userDir = currentUser.username || currentUser.id;
      // 权限：ASCII 别名路径（避免中文跳过 EdgeOne 时出错） + 保留旧中文路径以兼容历史资源
      const policy = {
        version: '2.0',
        statement: [
          {
            action: [
              'name/cos:PutObject',
              'name/cos:PostObject',
              'name/cos:InitiateMultipartUpload',
              'name/cos:ListMultipartUploads',
              'name/cos:ListParts',
              'name/cos:UploadPart',
              'name/cos:CompleteMultipartUpload',
            ],
            effect: 'allow',
            principal: { qcs: ['*'] },
            resource: [
              `qcs::cos:${region}:uid/${appId}:${bucket}/imimchat/moments/${userDir}/*`,
              `qcs::cos:${region}:uid/${appId}:${bucket}/imimchat/avatars/${userDir}/*`,
              `qcs::cos:${region}:uid/${appId}:${bucket}/imimchat/朋友圈/${userDir}/*`,
              `qcs::cos:${region}:uid/${appId}:${bucket}/imimchat/头像/${userDir}/*`,
            ],
          },
        ],
      };

      const credential = await new Promise<any>((resolve, reject) => {
        STS.getCredential(
          {
            secretId,
            secretKey,
            region,
            durationSeconds: 1800,
            policy,
          },
          (err: any, cred: any) => {
            if (err) reject(err);
            else resolve(cred);
          }
        );
      });

      const customDomain = cosConfig.domain || process.env.COS_DOMAIN;
      const baseUrl = customDomain
        ? String(customDomain).replace(/\/$/, '')
        : `https://${bucket}.cos.${region}.myqcloud.com`;

      return res.json({
        credentials: {
          tmpSecretId: credential.credentials.tmpSecretId,
          tmpSecretKey: credential.credentials.tmpSecretKey,
          sessionToken: credential.credentials.sessionToken,
        },
        expiredTime: credential.expiredTime,
        bucket,
        region,
        baseUrl,
        userId: currentUser.id,
        username: currentUser.username || null,
        userDir,
        // 从此新上传均使用纯 ASCII 路径，避免 EdgeOne 回源时中文路径被 raw 字节化导致 Node 400
        momentsFolder: `imimchat/moments/${userDir}`,
        avatarFolder: `imimchat/avatars/${userDir}`,
      });
    } catch (error: any) {
      console.error('[COS] STS 获取失败:', error);
      return res.status(500).json({ error: '获取上传凭证失败' });
    }
  });

  /**
   * GET /api/cos/proxy/*
   * COS 服务端代理（优化后）：
   *   - 图片、贴纸等小文件走 302 重定向到签名 URL（由浏览器直接从 COS 拉）
   *   - 视频 / 音频等大文件采用"服务端流式转发 + 支持 Range"，让 Nginx 能缓存 mp4 分片，
   *     同时避免 "302 跳转后后续需要重新 TLS 握手" 以及 项目上传后签名 URL 过期问题。
   * 支持透传处理参数（imageMogr2 / ci-process 等）。
   */
  app.get('/api/cos/proxy/*', async (req, res) => {
    try {
      const cosKey = decodeURIComponent(req.params[0] || '');
      if (!cosKey) {
        return res.status(400).json({ error: '缺少 COS 文件路径' });
      }
      const queryString = req.url.includes('?') ? req.url.split('?').slice(1).join('?') : '';

      // 检测是否为视频 / 音频类大文件（用于决定签名有效期）
      const isStreamMedia = /\.(mp4|mov|m4v|webm|mkv|3gp|m4a|mp3|aac|wav|ogg)(\?|$)/i.test(cosKey);

      const { getSignedUrl } = await import('./cos-signer.js');
      // 视频签发 6 天有效期，避免上游缓存中的 URL 过期
      const finalUrl = await getSignedUrl(cosKey, queryString, isStreamMedia);
      if (!finalUrl) {
        return res.status(503).json({ error: 'COS 未配置' });
      }

      // 统一使用服务端流式转发（避免 302 重定向被 EdgeOne CDN 拦截导致图片 400）
      // 服务端转发，透传 Range
      const upstreamHeaders: Record<string, string> = {};
      const range = req.headers.range;
      if (range) upstreamHeaders['Range'] = range;
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch) upstreamHeaders['If-None-Match'] = String(ifNoneMatch);
      const ifModifiedSince = req.headers['if-modified-since'];
      if (ifModifiedSince) upstreamHeaders['If-Modified-Since'] = String(ifModifiedSince);

      let upstream: Response | undefined;
      try {
        upstream = await (globalThis as any).fetch(finalUrl, { headers: upstreamHeaders });
      } catch (e: any) {
        console.error('[COS Proxy] upstream fetch 失败:', e?.message || e);
        return res.status(502).json({ error: '上游拉取失败' });
      }
      if (!upstream) return res.status(502).json({ error: '上游无响应' });

      res.status(upstream.status as any);
      // 透传关键响应头
      const passHeaders = [
        'content-type', 'content-length', 'content-range', 'accept-ranges',
        'etag', 'last-modified', 'expires',
      ];
      for (const h of passHeaders) {
        const v = (upstream.headers as any).get(h);
        if (v) res.setHeader(h, v);
      }
      // 允许 Nginx / CDN 缓存 7 天，并允许跨域。
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

      const body: any = (upstream as any).body;
      if (!body) {
        return res.end();
      }
      // Web ReadableStream → Node Readable 转换
      try {
        const { Readable } = await import('node:stream');
        const nodeStream: any = (Readable as any).fromWeb(body);
        req.on('close', () => { try { nodeStream.destroy(); } catch { /* ignore */ } });
        nodeStream.on('error', (err: any) => {
          console.error('[COS Proxy] stream 错误:', err?.message || err);
          try { res.end(); } catch { /* ignore */ }
        });
        nodeStream.pipe(res);
      } catch (e: any) {
        // 降级为 buffer 一次性返回
        const buf = Buffer.from(await (upstream as any).arrayBuffer());
        res.end(buf);
      }
    } catch (err: any) {
      if (err.statusCode === 404 || err.code === 'NoSuchKey') {
        return res.status(404).json({ error: '文件不存在' });
      }
      console.error('[COS Proxy] 处理失败:', err.message || err);
      return res.status(500).json({ error: '获取文件失败' });
    }
  });

  /**
   * GET /api/cos/refresh-sign?url=<原 COS URL 或代理 URL>
   * 用于前端 video onError 时拿一条新的可访问 URL 来重新加载。
   * 返回：{ url: string } — 优先返回站内代理 URL，避免同样问题重复发生。
   */
  app.get('/api/cos/refresh-sign', async (req, res) => {
    try {
      const raw = String(req.query.url || '');
      if (!raw) return res.status(400).json({ error: '缺少 url 参数' });

      // 情况 1：传入的已是代理 URL → 原样返回（带上 cache buster）
      if (raw.startsWith('/api/cos/proxy/') || raw.startsWith('http') && raw.includes('/api/cos/proxy/')) {
        const sep = raw.includes('?') ? '&' : '?';
        return res.json({ url: `${raw}${sep}_t=${Date.now()}` });
      }

      // 情况 2：传入 COS 直链 → 转为代理 URL（优先）或重新签名
      const { cosUrlToProxy, isCosUrl, parseCosUrl, getSignedUrl } = await import('./cos-signer.js');
      if (isCosUrl(raw)) {
        const proxy = cosUrlToProxy(raw);
        if (proxy && proxy.startsWith('/api/cos/proxy/')) {
          return res.json({ url: `${proxy}${proxy.includes('?') ? '&' : '?'}_t=${Date.now()}` });
        }
        const parsed = parseCosUrl(raw);
        if (parsed) {
          const signed = await getSignedUrl(parsed.cosKey, parsed.processQuery, true);
          if (signed) return res.json({ url: signed });
        }
      }
      return res.status(400).json({ error: '不支持的 URL' });
    } catch (err: any) {
      console.error('[COS Refresh] 失败:', err?.message || err);
      return res.status(500).json({ error: '刷新失败' });
    }
  });

  /**
   * POST /api/media/upload
   * 上传图片或视频文件
   * 聊天文件始终使用本地存储，朋友圈文件走COS（imimchat/朋友圈/用户ID/照片|视频/）
   * Body: { dataBase64: string, mimeType: string, mediaType: 'image' | 'video', userId?: string, source?: 'chat' | 'moments' | 'avatar' }
   * Returns: { ok: true, url: string, fileName: string, storage: 'cos' | 'local' }
   */
  app.post('/api/media/upload', async (req, res) => {
    try {
      const { dataBase64, mimeType, mediaType = 'image', userId } = req.body;
      if (!dataBase64) {
        return res.status(400).json({ ok: false, error: '缺少 dataBase64 参数' });
      }

      // MIME 类型白名单
      const imageExtMap: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/bmp': '.bmp',
        'image/svg+xml': '.svg',
      };
      const videoExtMap: Record<string, string> = {
        'video/mp4': '.mp4',
        'video/webm': '.webm',
        'video/quicktime': '.mov',
        'video/x-msvideo': '.avi',
        'video/3gpp': '.3gp',
      };

      const extMap = mediaType === 'video' ? videoExtMap : imageExtMap;
      const ext = extMap[mimeType];
      if (!ext) {
        return res.status(400).json({ ok: false, error: `不支持的${mediaType === 'video' ? '视频' : '图片'}格式: ${mimeType}` });
      }

      const buffer = Buffer.from(dataBase64, 'base64');

      // 文件大小限制：图片 20MB，视频 100MB
      const MAX_SIZE = mediaType === 'video' ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
      if (buffer.length > MAX_SIZE) {
        return res.status(400).json({ ok: false, error: `文件过大，最大 ${mediaType === 'video' ? '100MB' : '20MB'}` });
      }

      const fileName = `${mediaType}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;

      // 根据 source 决定存储方式：朋友圈和头像走COS，聊天文件走本地
      const { source } = req.body;
      const cosConfig = await getSystemConfig<any>('cos') || {};
      const cosSecretId = cosConfig.secretId || process.env.COS_SECRET_ID;
      const cosSecretKey = cosConfig.secretKey || process.env.COS_SECRET_KEY;
      const cosBucket = cosConfig.bucket || process.env.COS_BUCKET;
      const cosRegion = cosConfig.region || process.env.COS_REGION || 'ap-guangzhou';
      const cosEnabled = cosConfig.enabled !== false;

      if ((source === 'moments' || source === 'avatar') && cosEnabled && cosSecretId && cosSecretKey && cosBucket && cosRegion) {
        try {
          const COSModule: any = await import('cos-nodejs-sdk-v5');
          const COS = COSModule.default || COSModule;
          const cos = new COS({ SecretId: cosSecretId, SecretKey: cosSecretKey });
          // 优先使用用户名作为目录名，空时回退到 userId/anonymous
          let userDir: string = 'anonymous';
          if (userId) {
            try {
              const u = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
              userDir = u?.username || userId;
            } catch { userDir = userId; }
          }
          let cosKey: string;
          if (source === 'avatar') {
            // 头像目录结构：imimchat/avatars/{username}/{fileName}。
            // 使用 ASCII 路径避免 EdgeOne 回源时中文 → raw UTF-8 导致 Node 400
            cosKey = `imimchat/avatars/${userDir}/${fileName}`;
          } else {
            // 朋友圈目录结构：imimchat/moments/{username}/photos|videos/{fileName}
            const subDir = mediaType === 'video' ? 'videos' : 'photos';
            cosKey = `imimchat/moments/${userDir}/${subDir}/${fileName}`;
          }
          await new Promise<void>((resolve, reject) => {
            cos.putObject({
              Bucket: cosBucket,
              Region: cosRegion,
              Key: cosKey,
              Body: buffer,
              ContentType: mimeType,
            }, (err: any) => {
              if (err) reject(err);
              else resolve();
            });
          });
          const customDomain = cosConfig.domain || process.env.COS_DOMAIN;
          const baseUrl = customDomain
            ? String(customDomain).replace(/\/$/, '')
            : `https://${cosBucket}.cos.${cosRegion}.myqcloud.com`;
          const cosUrl = `${baseUrl}/${cosKey}`;
          console.log(`[Media] ${source}/${mediaType} 已上传到 COS: ${cosKey} (${buffer.length} bytes)`);
          return res.json({ ok: true, url: cosUrl, fileName, storage: 'cos' });
        } catch (cosErr: any) {
          console.error('[Media] COS 上传失败，回退到本地存储:', cosErr.message || cosErr);
        }
      }

      // 回退：本地存储
      const localPath = path.join(MEDIA_DIR, fileName);
      if (!localPath.startsWith(MEDIA_DIR)) {
        return res.status(400).json({ ok: false, error: '无效的文件路径' });
      }
      fs.writeFileSync(localPath, buffer);
      const url = `/api/media/files/${fileName}`;
      console.log(`[Media] ${mediaType} 已上传到本地: ${localPath} (${buffer.length} bytes)`);
      return res.json({ ok: true, url, fileName, storage: 'local' });
    } catch (err: any) {
      console.error('[Media] 上传失败:', err);
      return res.status(500).json({ ok: false, error: '上传失败' });
    }
  });

  /**
   * POST /api/media/upload-form
   * 使用 FormData 上传文件（避免 base64 膨胀，支持大文件上传和进度监控）
   * FormData fields: file (File), mediaType ('image'|'video'), source ('moments'|'avatar'|'chat')
   * Returns: { ok: true, url: string, fileName: string, storage: 'cos' | 'local' }
   */
  app.post('/api/media/upload-form', async (req, res) => {
    try {
      // 使用 busboy 解析 multipart/form-data
      const busboy = (await import('busboy')).default;
      const bb = busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB 限制

      let fileBuffer: Buffer | null = null;
      let fileName = '';
      let fileMimeType = '';
      let mediaType = 'image';
      let source = 'moments';
      let fileTruncated = false;

      bb.on('file', (_fieldname: string, fileStream: any, info: any) => {
        const { filename, mimeType } = info;
        fileName = filename || 'upload';
        fileMimeType = mimeType || 'application/octet-stream';
        const chunks: Buffer[] = [];
        fileStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        fileStream.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });
        fileStream.on('limit', () => {
          fileTruncated = true;
        });
      });

      bb.on('field', (fieldname: string, val: string) => {
        if (fieldname === 'mediaType') mediaType = val;
        if (fieldname === 'source') source = val;
      });

      bb.on('finish', async () => {
        try {
          if (fileTruncated) {
            return res.status(400).json({ ok: false, error: '文件过大，最大 200MB' });
          }
          if (!fileBuffer || fileBuffer.length === 0) {
            return res.status(400).json({ ok: false, error: '缺少文件' });
          }

          // MIME 类型白名单
          const imageExtMap: Record<string, string> = {
            'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
            'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
            'image/svg+xml': '.svg', 'image/heic': '.heic', 'image/heif': '.heif',
          };
          const videoExtMap: Record<string, string> = {
            'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
            'video/x-msvideo': '.avi', 'video/3gpp': '.3gp', 'video/x-matroska': '.mkv',
            'video/mp2t': '.ts', 'video/x-m4v': '.m4v',
          };

          const extMap = mediaType === 'video' ? videoExtMap : imageExtMap;
          let ext = extMap[fileMimeType];
          // 如果 MIME 不在白名单，尝试从文件名提取扩展名
          if (!ext) {
            const fileExt = fileName.split('.').pop()?.toLowerCase();
            if (fileExt && (mediaType === 'video'
              ? ['mp4', 'webm', 'mov', 'avi', '3gp', 'mkv', 'ts', 'm4v'].includes(fileExt)
              : ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'].includes(fileExt))) {
              ext = '.' + fileExt;
            } else {
              return res.status(400).json({ ok: false, error: `不支持的${mediaType === 'video' ? '视频' : '图片'}格式: ${fileMimeType}` });
            }
          }

          const MAX_SIZE = mediaType === 'video' ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
          if (fileBuffer.length > MAX_SIZE) {
            return res.status(400).json({ ok: false, error: `文件过大，最大 ${mediaType === 'video' ? '200MB' : '20MB'}` });
          }

          const savedFileName = `${mediaType}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;

          // 根据 source 决定存储方式
          const cosConfig = await getSystemConfig<any>('cos') || {};
          const cosSecretId = cosConfig.secretId || process.env.COS_SECRET_ID;
          const cosSecretKey = cosConfig.secretKey || process.env.COS_SECRET_KEY;
          const cosBucket = cosConfig.bucket || process.env.COS_BUCKET;
          const cosRegion = cosConfig.region || process.env.COS_REGION || 'ap-guangzhou';
          const cosEnabled = cosConfig.enabled !== false;

          // 从认证头获取用户 ID 与用户名
          let userId = 'anonymous';
          let userDir: string = 'anonymous';
          const token = req.headers['authorization']?.replace('Bearer ', '');
          if (token) {
            try {
              const session = await prisma.userSession.findUnique({ where: { token }, include: { user: true } });
              if (session?.user?.id) {
                userId = session.user.id;
                userDir = session.user.username || session.user.id;
              }
            } catch {}
          }

          if ((source === 'moments' || source === 'avatar') && cosEnabled && cosSecretId && cosSecretKey && cosBucket && cosRegion) {
            try {
              const COSModule: any = await import('cos-nodejs-sdk-v5');
              const COS = COSModule.default || COSModule;
              const cos = new COS({ SecretId: cosSecretId, SecretKey: cosSecretKey });
              let cosKey: string;
              if (source === 'avatar') {
                // ASCII 路径，避免中文 → EdgeOne raw UTF-8 → Node 400
                cosKey = `imimchat/avatars/${userDir}/${savedFileName}`;
              } else {
                const subDir = mediaType === 'video' ? 'videos' : 'photos';
                cosKey = `imimchat/moments/${userDir}/${subDir}/${savedFileName}`;
              }
              await new Promise<void>((resolve, reject) => {
                cos.putObject({
                  Bucket: cosBucket,
                  Region: cosRegion,
                  Key: cosKey,
                  Body: fileBuffer!,
                  ContentType: fileMimeType,
                }, (err: any) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
              const customDomain = cosConfig.domain || process.env.COS_DOMAIN;
              const baseUrl = customDomain
                ? String(customDomain).replace(/\/$/, '')
                : `https://${cosBucket}.cos.${cosRegion}.myqcloud.com`;
              const cosUrl = `${baseUrl}/${cosKey}`;
              console.log(`[Media-Form] ${source}/${mediaType} 已上传到 COS: ${cosKey} (${fileBuffer!.length} bytes)`);
              return res.json({ ok: true, url: cosUrl, fileName: savedFileName, storage: 'cos' });
            } catch (cosErr: any) {
              console.error('[Media-Form] COS 上传失败，回退到本地存储:', cosErr.message || cosErr);
            }
          }

          // 回退：本地存储
          const localPath = path.join(MEDIA_DIR, savedFileName);
          if (!localPath.startsWith(MEDIA_DIR)) {
            return res.status(400).json({ ok: false, error: '无效的文件路径' });
          }
          fs.writeFileSync(localPath, fileBuffer!);
          const url = `/api/media/files/${savedFileName}`;
          console.log(`[Media-Form] ${mediaType} 已上传到本地: ${localPath} (${fileBuffer!.length} bytes)`);
          return res.json({ ok: true, url, fileName: savedFileName, storage: 'local' });
        } catch (err: any) {
          console.error('[Media-Form] 处理上传失败:', err);
          return res.status(500).json({ ok: false, error: '上传失败' });
        }
      });

      bb.on('error', (err: any) => {
        console.error('[Media-Form] busboy 解析错误:', err);
        return res.status(400).json({ ok: false, error: '文件解析失败' });
      });

      req.pipe(bb);
    } catch (err: any) {
      console.error('[Media-Form] 上传失败:', err);
      return res.status(500).json({ ok: false, error: '上传失败' });
    }
  });

  /**
   * POST /api/push-to-onebot
   * 前端发送消息时，主动将消息推送给 AstrBot
   * Body: { chatId, senderId, content, nickname, isGroup, groupId, voiceUrl?, isVoice? }
   */
  app.post('/api/push-to-onebot', (req, res) => {
    if (onebotClients.size === 0) {
      return res.json({ ok: false, reason: 'no_astrbot_connected' });
    }

    const { chatId, senderId, content, nickname, isGroup, groupId, voiceUrl, isVoice } = req.body;
    const msgId = `im-${Date.now()}`;

    if (isVoice && voiceUrl) {
      // 语音消息：构造包含 record 消息段的 OneBot 事件
      // 生成完整的语音文件 URL（包含服务器地址）
      const fullVoiceUrl = voiceUrl.startsWith('http') ? voiceUrl : `http://localhost:${process.env.PORT || 3000}${voiceUrl}`;
      const voiceSegments: OneBotSegment[] = [{ type: 'record', data: { file: fullVoiceUrl, url: fullVoiceUrl } }];

      if (isGroup && groupId) {
        const numGroupId = Number(groupId) || parseInt(chatId?.replace('c', '') || '0');
        pushOneBotEvent({
          time: Math.floor(Date.now() / 1000),
          self_id: BOT_SELF_ID,
          post_type: 'message',
          message_type: 'group',
          sub_type: 'normal',
          message_id: msgId,
          group_id: numGroupId,
          user_id: senderId,
          anonymous: null,
          message: voiceSegments,
          raw_message: '[CQ:record,file=' + fullVoiceUrl + ']',
          font: 0,
          sender: {
            user_id: senderId,
            nickname: nickname || userRegistry.get(senderId) || senderId,
            card: '', sex: 'unknown', age: 0, area: '', level: '1', role: 'member', title: '',
          },
        });
      } else {
        pushOneBotEvent({
          time: Math.floor(Date.now() / 1000),
          self_id: BOT_SELF_ID,
          post_type: 'message',
          message_type: 'private',
          sub_type: 'friend',
          message_id: msgId,
          user_id: senderId,
          message: voiceSegments,
          raw_message: '[CQ:record,file=' + fullVoiceUrl + ']',
          font: 0,
          sender: {
            user_id: senderId,
            nickname: nickname || userRegistry.get(senderId) || senderId,
            sex: 'unknown', age: 0,
          },
        });
      }
      console.log(`[OneBot] 用户语音已推送给 AstrBot: ${fullVoiceUrl}`);
    } else {
      // 普通文本消息
      if (isGroup && groupId) {
        const numGroupId = Number(groupId) || parseInt(chatId?.replace('c', '') || '0');
        pushGroupMessage({ groupId: numGroupId, userId: senderId, content, messageId: msgId, nickname });
      } else {
        pushPrivateMessage({ userId: senderId, content, messageId: msgId, nickname });
      }
    }

    return res.json({ ok: true, messageId: msgId });
  });

  /**
   * GET /api/onebot-status
   * 返回当前 OneBot 连接状态
   */
  app.get('/api/onebot-status', (_req, res) => {
    res.json({
      connected: onebotClients.size > 0,
      clients: onebotClients.size,
      groups: Array.from(groupRegistry.entries()).map(([id, g]) => ({ id, name: g.name })),
    });
  });

  // ============ WebSocket 信令服务 ============
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  // ★ 手动处理 HTTP Upgrade，根据路径分发给不同的 WebSocketServer
  // 避免多个 WebSocketServer 绑定同一 server 时互相 abort 连接
  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const pathname = url.pathname;
    if (pathname === '/signal') {
      // ★ WebSocket 鉴权增强：支持 URL 参数中的 token 验证
      const wsToken = url.searchParams.get('token');
      if (wsToken) {
        try {
          const session = await prisma.userSession.findUnique({ where: { token: wsToken }, select: { userId: true, expiresAt: true, user: { select: { isBanned: true } } } });
          if (!session || session.expiresAt < new Date() || session.user?.isBanned) {
            console.warn(`[Signal] WebSocket 鉴权失败: token 无效或已过期`);
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
        } catch (err) {
          console.error('[Signal] WebSocket 鉴权异常:', err);
          // 鉴权异常时不拒绝连接，回退到 userId 参数方式
        }
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (pathname === '/onebot/v11/ws') {
      onebotWss.handleUpgrade(request, socket, head, (ws) => {
        onebotWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // ★ 心跳检测：30s 无 pong 回应则断开死连接，释放资源
  const HEARTBEAT_INTERVAL = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const [userId, client] of clients) {
      if (!(client as any)._alive) {
        // 上次心跳未回应，断开连接
        client.ws.terminate();
        clients.delete(userId);
        unregisterConnection(userId);
        setUserOffline(userId).catch(() => {});
        continue;
      }
      (client as any)._alive = false;
      client.ws.ping();
      // 心跳正常，刷新 Redis 在线状态 TTL
      refreshUserOnline(userId).catch(() => {});
    }
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(heartbeatTimer));

  // ★ 朋友圈实时事件推送：订阅 Redis 频道，将点赞/评论通知推送给在线用户
  subscribeChannel('moment_events', (message: any) => {
    const { type, targetUserId, payload } = message || {};
    if (!type || !targetUserId) return;
    const targetClient = clients.get(targetUserId);
    if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
      targetClient.ws.send(JSON.stringify({ type, payload }));
      console.log(`[Moments] 推送 ${type} 给用户 ${targetUserId}`);
    }
  });

  // ★ 用户资料实时同步：订阅 Redis 频道，将头像/昵称更新推送给好友和群成员
  subscribeChannel('user_profile_updated', (message: any) => {
    const { userId, nickname, avatar, username, bio, backgroundUrl, updatedAt, targetFriendIds, targetGroupIds } = message || {};
    if (!userId) return;

    const profilePayload = { userId, nickname, avatar, username, bio, backgroundUrl, updatedAt };

    // 1. 通知好友：在线的好友会立即收到更新
    if (Array.isArray(targetFriendIds) && targetFriendIds.length > 0) {
      broadcastToUsers(targetFriendIds, {
        type: 'user_profile_updated',
        from: userId,
        payload: profilePayload,
      }, userId); // 排除自己
    }

    // 2. 通知群成员：用户在的所有群，广播给群内在线成员
    if (Array.isArray(targetGroupIds) && targetGroupIds.length > 0) {
      for (const groupId of targetGroupIds) {
        const groupRoom = rooms.get(groupId);
        if (groupRoom) {
          const payload = JSON.stringify({
            type: 'user_profile_updated',
            from: userId,
            payload: profilePayload,
          });
          groupRoom.forEach((uid) => {
            if (uid !== userId) sendRaw(uid, payload);
          });
        }
      }
    }

    console.log(`[Profile] 用户 ${userId} 资料已更新，通知 ${targetFriendIds?.length || 0} 个好友和 ${targetGroupIds?.length || 0} 个群`);
  });

  wss.on("connection", (ws, req) => {
    // 从 URL 参数获取 userId，例如 /signal?userId=me
    const url = new URL(req.url || "/", "http://localhost");
    const userId = url.searchParams.get("userId") || `user-${Date.now()}`;

    const client: SignalClient = { ws, userId };
    (client as any)._alive = true;
    clients.set(userId, client);
    // 注册到万人群消息系统的连接池
    registerConnection(userId, ws);
    // Redis 在线状态
    setUserOnline(userId).catch(() => {});
    // 解析设备信息并存入 Redis
    const rawUA = req.headers['user-agent'] || '';
    const clientIP = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
    const deviceInfo = parseUserAgent(rawUA, clientIP);
    const deviceId = `${userId}_${Date.now()}`;
    setUserDevice(userId, deviceId, deviceInfo).catch(() => {});
    (client as any)._deviceId = deviceId;
    console.log(`[Signal] 用户连接: ${userId} (${deviceInfo.os} · ${deviceInfo.browser}) (总在线: ${clients.size})`);
    // ★ 推送当前所有在线用户列表给新连接的用户
    const currentOnlineIds = Array.from(clients.keys()).filter(id => id !== userId);
    if (currentOnlineIds.length > 0) {
      ws.send(JSON.stringify({
        type: 'online_users_list',
        payload: { userIds: currentOnlineIds },
      }));
    }

    // 广播好友上线事件给所有在线用户
    for (const [onlineId, onlineClient] of clients) {
      if (onlineId !== userId && onlineClient.ws.readyState === WebSocket.OPEN) {
        onlineClient.ws.send(JSON.stringify({
          type: 'friend_online',
          from: userId,
          payload: { userId },
        }));
      }
    }

    // ★ pong 回调：标记连接存活
    ws.on('pong', () => { (client as any)._alive = true; });

    ws.on("message", (data) => {
      (client as any)._alive = true; // 收到消息也视为存活
      handleMessage(client, data.toString());
    });

    ws.on("close", () => {
      // 离开房间
      if (client.roomId) {
        const room = rooms.get(client.roomId);
        if (room) {
          room.delete(userId);
          if (room.size === 0) rooms.delete(client.roomId);
          else {
            broadcastToRoom(client.roomId, {
              type: "room_info",
              from: userId,
              roomId: client.roomId,
              payload: { event: "peer_left", peerId: userId, members: Array.from(room) },
            });
          }
        }
      }
      clients.delete(userId);
      // 从万人群消息系统注销
      unregisterConnection(userId);
      // 清除 Redis 在线状态，记录设备下线和最后在线时间
      setUserOffline(userId).catch(() => {});
      const _deviceId = (client as any)._deviceId;
      if (_deviceId) removeUserDevice(userId, _deviceId).catch(() => {});
      console.log(`[Signal] 用户断开: ${userId} (总在线: ${clients.size})`);
      // 广播好友下线事件给所有在线用户
      for (const [onlineId, onlineClient] of clients) {
        if (onlineId !== userId && onlineClient.ws.readyState === WebSocket.OPEN) {
          onlineClient.ws.send(JSON.stringify({
            type: 'friend_offline',
            from: userId,
            payload: { userId },
          }));
        }
      }
    });

    ws.on("error", (err) => {
      console.error(`[Signal] 错误 (${userId}):`, err.message);
    });
  });

  // ============ 个人资料 API ============

  /**
   * GET /api/profile
   * 获取当前用户个人资料（前端本地存储，通过 userId 参数区分）
   */
  // ===== 腾讯地图 API 公开配置接口（不需登录，供前端位置共享页面使用） =====
  app.get('/api/txmap-config', async (_req, res) => {
    try {
      const config = await getAdminConfig('txmap') || {};
      res.json({
        key: config.key || '',
        enabled: !!(config.key),
      });
    } catch {
      res.json({ key: '', enabled: false });
    }
  });

  // ===== 腾讯地图逆地理编码代理（坐标→地址，后端代理避免 Key 泄露和跨域） =====
  app.get('/api/txmap/geocoder/reverse', async (req, res) => {
    try {
      const { lat, lng } = req.query as { lat: string; lng: string };
      if (!lat || !lng) { res.status(400).json({ error: '缺少 lat/lng 参数' }); return; }
      const config = await getAdminConfig('txmap') || {};
      const key = (config as any).key || '';
      if (!key) { res.status(503).json({ error: '腾讯地图 Key 未配置' }); return; }
      const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${key}&get_poi=0`;
      const response = await fetch(url);
      const data = await response.json() as any;
      if (data.status === 0) {
        res.json({
          address: data.result?.address || '',
          formatted_address: data.result?.formatted_addresses?.recommend || data.result?.address || '',
          province: data.result?.address_component?.province || '',
          city: data.result?.address_component?.city || '',
          district: data.result?.address_component?.district || '',
        });
      } else {
        res.status(500).json({ error: data.message || '逆地理编码失败', code: data.status });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || '服务器错误' });
    }
  });

  // ===== 腾讯地图静态地图代理（消息气泡缩略图） =====
  app.get('/api/txmap/staticmap', async (req, res) => {
    try {
      const { lat, lng, zoom = '15', width = '300', height = '150' } = req.query as Record<string, string>;
      if (!lat || !lng) { res.status(400).send('缺少 lat/lng 参数'); return; }
      const config = await getAdminConfig('txmap') || {};
      const key = (config as any).key || '';
      if (!key) { res.status(503).send('Key 未配置'); return; }
      const url = `https://apis.map.qq.com/ws/staticmap/v2/?center=${lat},${lng}&zoom=${zoom}&size=${width}*${height}&markers=size:large|color:red|label:A|${lat},${lng}&key=${key}`;
      const response = await fetch(url);
      if (!response.ok) { res.status(response.status).send('静态地图请求失败'); return; }
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'image/png';
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      res.status(500).send(e.message || '服务器错误');
    }
  });

  app.get('/api/profile', optionalAuth, async (req, res) => {
    let userId = (req.query.userId as string) || 'me';
    // 若 userId=me 且请求携带有效 token，则从 token 中解析真实用户 ID
    const tokenUser = (req as any).user;
    if ((userId === 'me' || !userId) && tokenUser) {
      userId = tokenUser.id;
    }
    // 优先从数据库读取真实资料，支持用 cuid 或 username 查询
    let dbUser: {
      id: string;
      username: string;
      nickname: string | null;
      avatar: string | null;
      backgroundUrl: string | null;
      bio: string | null;
      phone: string | null;
      email: string | null;
    } | null = null;
    try {
      dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, username: true, nickname: true, avatar: true, backgroundUrl: true,
          bio: true, phone: true, email: true, gender: true, region: true, birthday: true,
        },
      });
      if (!dbUser) {
        dbUser = await prisma.user.findUnique({
          where: { username: userId },
          select: {
            id: true, username: true, nickname: true, avatar: true, backgroundUrl: true,
            bio: true, phone: true, email: true, gender: true, region: true, birthday: true,
          },
        });
      }
    } catch {}
    const profileKey = dbUser?.id || userId;
    const memProfile = userProfiles.get(profileKey) || userProfiles.get(userId) || {};
    const displayName = dbUser?.nickname || (memProfile as any).name || (memProfile as any).nickname || dbUser?.username || userRegistry.get(profileKey) || userRegistry.get(userId) || userId;
    const profile = {
      id: profileKey,
      username: dbUser?.username || (memProfile as any).wechatId || userId,
      // 数据库昵称优先于内存缓存
      name: displayName,
      nickname: dbUser?.nickname || (memProfile as any).nickname || displayName,
      gender: dbUser?.gender || (memProfile as any).gender || '',
      region: dbUser?.region || (memProfile as any).region || '',
      // 优先从数据库读取 phone/email（仅当请求者是本人时才返回）
      phone: dbUser?.phone || (memProfile as any).phone || '',
      email: dbUser?.email || (memProfile as any).email || '',
      wechatId: dbUser?.username || (memProfile as any).wechatId || userId,
      bio: dbUser?.bio ?? (memProfile as any).bio ?? '',
      avatar: avatarToProxy(dbUser?.avatar || (memProfile as any).avatar || ''),
      backgroundUrl: dbUser?.backgroundUrl || (memProfile as any).backgroundUrl || '',
      birthday: dbUser?.birthday || (memProfile as any).birthday || '',
    };
    res.json({ profile });
  });

  /**
   * PUT /api/profile
   * 更新当前用户个人资料
   */
  app.put('/api/profile', optionalAuth, async (req, res) => {
    let { userId = 'me', name, nickname, gender, region, phone, wechatId, bio, avatar, backgroundUrl, birthday } = req.body;
    // 若 userId=me 且请求携带有效 token，则从 token 中解析真实用户 ID
    const tokenUser = (req as any).user;
    if ((userId === 'me' || !userId) && tokenUser) {
      userId = tokenUser.id;
    }

    let dbUser: { id: string; username: string; nickname: string | null } | null = null;
    try {
      dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, nickname: true },
      });
      if (!dbUser) {
        dbUser = await prisma.user.findUnique({
          where: { username: userId },
          select: { id: true, username: true, nickname: true },
        });
      }
    } catch {}

    const profileKey = dbUser?.id || userId;
    const currentUsername = dbUser?.username || userId;
    const nextUsername = typeof wechatId === 'string' ? wechatId.trim() : currentUsername;

    if (nextUsername && !/^[a-zA-Z0-9_]{1,20}$/.test(nextUsername)) {
      return res.status(400).json({ error: '账号ID只能包含字母、数字和下划线，长度1-20位' });
    }

    if (dbUser && nextUsername !== currentUsername) {
      const duplicate = await prisma.user.findUnique({ where: { username: nextUsername } });
      if (duplicate && duplicate.id !== dbUser.id) {
        return res.status(409).json({ error: '该账号ID已被使用' });
      }
    }

    const existing = userProfiles.get(profileKey) || userProfiles.get(userId) || {};
    const updated = {
      ...existing,
      id: profileKey,
      name: name || nickname || existing.name || dbUser?.nickname || currentUsername,
      nickname: nickname || name || existing.nickname || dbUser?.nickname || currentUsername,
      gender: gender ?? existing.gender ?? '',
      region: region ?? existing.region ?? '',
      phone: phone ?? existing.phone ?? '',
      wechatId: nextUsername || existing.wechatId || currentUsername,
      bio: bio ?? existing.bio ?? '',
      avatar: avatarToProxy(avatar ?? existing.avatar ?? ''),
      backgroundUrl: backgroundUrl ?? existing.backgroundUrl ?? '',
      birthday: birthday ?? existing.birthday ?? '',
    };

    userProfiles.set(profileKey, updated);
    if (userId !== profileKey) {
      userProfiles.delete(userId);
    }

    // 同步更新 userRegistry 昵称
    if (updated.name) {
      userRegistry.set(profileKey, updated.name);
      if (currentUsername) userRegistry.set(currentUsername, updated.name);
      if (updated.wechatId) userRegistry.set(updated.wechatId, updated.name);
    }

    // 同步写入数据库（支持修改 username）
    let dbUpdatedAt: number | undefined;
    try {
      const dbUpdate: Record<string, any> = {};
      if (updated.nickname || updated.name) dbUpdate.nickname = updated.nickname || updated.name;
      if (updated.bio !== undefined) dbUpdate.bio = updated.bio;
      if (updated.avatar !== undefined) dbUpdate.avatar = updated.avatar;
      if (updated.backgroundUrl !== undefined) dbUpdate.backgroundUrl = updated.backgroundUrl || null;
      if (updated.gender !== undefined) dbUpdate.gender = updated.gender || null;
      if (updated.region !== undefined) dbUpdate.region = updated.region || null;
      if (updated.birthday !== undefined) dbUpdate.birthday = updated.birthday || null;
      if (dbUser && updated.wechatId && updated.wechatId !== currentUsername) dbUpdate.username = updated.wechatId;

      if (Object.keys(dbUpdate).length > 0) {
        const syncUserId = dbUser?.id || profileKey;
        if (dbUser) {
          const row = await prisma.user.update({
            where: { id: dbUser.id },
            data: dbUpdate,
            select: { updatedAt: true },
          });
          dbUpdatedAt = row.updatedAt.getTime();
        } else {
          const byId = await prisma.user.updateMany({ where: { id: userId }, data: dbUpdate });
          if (byId.count === 0) {
            await prisma.user.updateMany({ where: { username: userId }, data: dbUpdate });
          }
        }

        try {
          const { publishUserProfileUpdatedById } = await import('./user-profile-sync.js');
          await publishUserProfileUpdatedById(syncUserId);
        } catch (pubErr) {
          console.error('[profile] 发布用户资料更新事件失败:', pubErr);
        }
      }
    } catch (e: any) {
      const message = e?.code === 'P2002' ? '该账号ID已被使用' : '资料更新失败';
      console.error('[profile] 数据库更新失败:', e);
      return res.status(e?.code === 'P2002' ? 409 : 500).json({ error: message });
    }

    res.json({
      success: true,
      profile: {
        ...updated,
        id: profileKey,
        username: updated.wechatId,
        wechatId: updated.wechatId,
        ...(dbUpdatedAt !== undefined ? { updatedAt: dbUpdatedAt } : {}),
      },
    });
  });

  // ============ 用户搜索 API ============

  /**
   * GET /api/users/search?q=搜索关键词
   * 通过用户ID、手机号、邮箱精确搜索用户（添加好友用）
   */
  app.get('/api/users/search', async (req, res) => {
    const { q } = req.query as { q: string };
    if (!q || q.trim().length < 1) {
      return res.status(400).json({ error: '请输入至少1个字符' });
    }
    const keyword = q.trim();
    try {
      const users = await prisma.user.findMany({
        where: {
          isBanned: false,
          OR: [
            { id: keyword },
            { username: keyword },
            { phone: keyword },
            { email: keyword },
          ],
        },
        select: { id: true, username: true, nickname: true, avatar: true, bio: true, backgroundUrl: true },
        take: 10,
      });
      res.json({
        users: users.map(u => ({
          id: u.id,
          username: u.username,
          nickname: u.nickname || u.username,
          avatar: avatarToProxy(u.avatar),
          bio: u.bio || '',
        })),
      });
    } catch (e) {
      res.status(500).json({ error: '搜索失败' });
    }
  });

  /**
   * GET /api/users/:userId — 通过 ID 获取用户公开信息
   */
  app.get('/api/users/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
      if (userId === 'official') {
        return res.json({
          id: 'official',
          username: 'admin',
          nickname: 'imim 官方',
          avatar: '/imim-official-avatar.jpg',
          bio: 'imim 官方账号',
          online: true,
          lastSeen: null,
          devices: [{ deviceType: 'server', browser: 'System', os: 'imim Cloud' }],
        });
      }
      if (userId === 'BOT') {
        return res.json({
          id: 'BOT',
          username: 'BOT',
          nickname: 'imim AI',
          avatar: '/imim-ai-avatar.jpg',
          bio: 'imim AI 助手',
          online: true,
          lastSeen: null,
          devices: [{ deviceType: 'server', browser: 'AI Runtime', os: 'imim Cloud' }],
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, nickname: true, avatar: true, bio: true, backgroundUrl: true },
      });
      if (!user) return res.status(404).json({ error: '用户不存在' });
      // 附带在线状态和最后在线时间
      const online = await isUserOnline(userId);
      const lastSeen = online ? null : await getUserLastSeen(userId);
      const devices = online ? await getUserDevices(userId) : [];
      res.json({
        id: user.id,
        username: user.username,
        nickname: user.nickname || user.username,
        avatar: avatarToProxy(user.avatar),
        bio: user.bio || '',
        backgroundUrl: user.backgroundUrl || '',
        online,
        lastSeen,
        devices,
      });
    } catch (e) {
      res.status(500).json({ error: '服务器错误' });
    }
  });

  // GET /api/users/:userId/presence - 获取用户在线状态、设备信息、最后在线时间
  app.get('/api/users/:userId/presence', async (req, res) => {
    const { userId } = req.params;
    try {
      if (userId === 'official') {
        return res.json({
          userId,
          online: true,
          lastSeen: null,
          devices: [{ deviceType: 'server', browser: 'System', os: 'imim Cloud' }],
        });
      }
      if (userId === 'BOT') {
        return res.json({
          userId,
          online: true,
          lastSeen: null,
          devices: [{ deviceType: 'server', browser: 'AI Runtime', os: 'imim Cloud' }],
        });
      }
      const online = await isUserOnline(userId);
      const lastSeen = online ? null : await getUserLastSeen(userId);
      const devices = online ? await getUserDevices(userId) : [];
      res.json({ userId, online, lastSeen, devices });
    } catch (e) {
      res.status(500).json({ error: '服务器错误' });
    }
  });

   // ============ 链接预览 API ============

  /**
   * GET /api/link-preview?url=<encoded_url>
   * 抓取目标页面的 OG/meta 元数据，返回链接预览卡片数据
   * 支持：og:title, og:description, og:image, og:site_name, twitter:card 等
   */
  app.get('/api/link-preview', async (req, res) => {
    const { url } = req.query as { url: string };
    if (!url) return res.status(400).json({ error: '缺少 url 参数' });

    // 基本 URL 格式校验
    let targetUrl: URL;
    try {
      targetUrl = new URL(url);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        return res.status(400).json({ error: '仅支持 http/https 链接' });
      }
    } catch {
      return res.status(400).json({ error: '无效的 URL 格式' });
    }

    try {
      // 使用 fetch 抓取页面 HTML（超时 8 秒）
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(targetUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; imim-LinkPreview/1.0; +https://imim.app)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });
      clearTimeout(timer);

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        // 非 HTML 资源（如图片、PDF），直接返回基本信息
        return res.json({
          url: targetUrl.toString(),
          title: targetUrl.hostname,
          description: '',
          image: '',
          siteName: targetUrl.hostname,
          favicon: `https://www.google.com/s2/favicons?domain=${targetUrl.hostname}&sz=64`,
        });
      }

      const html = await response.text();

      // 解析 meta 标签的辅助函数
      const getMeta = (property: string): string => {
        // 匹配 property="og:xxx" 或 name="twitter:xxx"
        const patterns = [
          new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
          new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'),
          new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
          new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${property}["']`, 'i'),
        ];
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match?.[1]) return match[1].trim();
        }
        return '';
      };

      // 提取 <title> 标签
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const htmlTitle = titleMatch?.[1]?.trim() || '';

      // 按优先级提取各字段
      const title = getMeta('og:title') || getMeta('twitter:title') || htmlTitle || targetUrl.hostname;
      const description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description') || '';
      const image = getMeta('og:image') || getMeta('twitter:image') || getMeta('og:image:url') || '';
      const siteName = getMeta('og:site_name') || targetUrl.hostname;
      const favicon = `https://www.google.com/s2/favicons?domain=${targetUrl.hostname}&sz=64`;

      // 处理相对路径图片 URL
      let absoluteImage = image;
      if (image && !image.startsWith('http')) {
        try {
          absoluteImage = new URL(image, targetUrl.origin).toString();
        } catch {
          absoluteImage = '';
        }
      }

      // HTML 实体解码（简单处理常见实体）
      const decode = (s: string) => s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');

      res.json({
        url: targetUrl.toString(),
        title: decode(title).slice(0, 120),
        description: decode(description).slice(0, 300),
        image: absoluteImage,
        siteName: decode(siteName).slice(0, 60),
        favicon,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: '请求超时' });
      }
      console.error('[LinkPreview] 抓取失败:', err.message);
      // 降级返回基本信息
      res.json({
        url: targetUrl.toString(),
        title: targetUrl.hostname,
        description: '',
        image: '',
        siteName: targetUrl.hostname,
        favicon: `https://www.google.com/s2/favicons?domain=${targetUrl.hostname}&sz=64`,
      });
    }
  });

  // ============ 朋友圈外链 API ============
  /**
   * GET /api/q/profile/:userId
   * 获取用户公开信息（外链页面用，无需登录）
   */
  app.get('/api/q/profile/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, nickname: true, avatar: true, backgroundUrl: true, bio: true, _count: { select: { moments: true } } },
      });
      if (!user) return res.status(404).json({ error: '用户不存在' });
      res.json({ profile: { id: user.id, name: user.nickname || user.username, avatar: avatarToProxy(user.avatar), backgroundUrl: user.backgroundUrl, bio: user.bio, momentCount: user._count.moments } });
    } catch (e) {
      res.status(500).json({ error: '服务器错误' });
    }
  });

  // ============ 用户投诉 API ============
  app.post('/api/report', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '未登录' });
    const session = await prisma.userSession.findFirst({ where: { token, expiresAt: { gt: new Date() } } });
    if (!session) return res.status(401).json({ error: '登录已过期' });
    const { targetType, targetId, reason } = req.body;
    if (!targetType || !targetId || !reason) return res.status(400).json({ error: '参数不完整' });
    try {
      const report = await prisma.report.create({
        data: { reporterId: session.userId, targetType, targetId, reason },
      });
      res.json({ success: true, reportId: report.id });
    } catch (e) {
      res.status(500).json({ error: '提交失败' });
    }
  });

  // ============ 外链解析 API（TG 风格：添加好友 / 加入群组 / 邀请链接） ============

  /**
   * GET /api/im/resolve/:slug
   * 公开接口，无需登录。支持三种格式：
   * 1. +hash — 私人邀请链接（类似 TG t.me/+hash）
   * 2. username — 公开用户名（查用户或群组）
   * 3. id — 内部 ID（兼容旧版）
   * 返回: { type: 'user' | 'group' | 'invite', data: {...} }
   */
  app.get('/api/im/resolve/:slug', async (req, res) => {
    const { slug } = req.params;
    if (!slug || slug.trim().length < 1) {
      return res.status(400).json({ error: '无效的链接' });
    }
    try {
      // “+hash” 格式：私人邀请链接
      if (slug.startsWith('+')) {
        const hash = slug.slice(1);
        const link = await prisma.inviteLink.findUnique({
          where: { hash },
          include: { group: { select: { id: true, dialogId: true, name: true, username: true, avatar: true, memberCount: true, type: true } } },
        });
        if (!link) return res.status(404).json({ error: '邀请链接不存在' });
        if (link.isRevoked) return res.status(410).json({ error: '邀请链接已被撤销' });
        if (link.expireAt && new Date() > link.expireAt) return res.status(410).json({ error: '邀请链接已过期' });
        if (link.maxUses > 0 && link.usedCount >= link.maxUses) return res.status(410).json({ error: '邀请链接已达到最大使用次数' });

        return res.json({
          type: 'invite',
          data: {
            hash: link.hash,
            groupId: link.group.id,
            groupName: link.group.name,
            groupUsername: link.group.username || null,
            groupAvatar: avatarToProxy(link.group.avatar),
            memberCount: link.group.memberCount,
            groupType: link.group.type,
          },
        });
      }

      // 优先查询用户（按 username 精确匹配）
      const user = await prisma.user.findUnique({
        where: { username: slug },
        select: { id: true, dialogId: true, username: true, nickname: true, avatar: true, bio: true, backgroundUrl: true, isBanned: true, isBot: true },
      });
      if (user && !user.isBanned) {
        return res.json({
          type: 'user',
          data: {
            id: user.id,
            username: user.username,
            nickname: user.nickname || user.username,
            avatar: avatarToProxy(user.avatar),
            bio: user.bio || '',
            backgroundUrl: user.backgroundUrl || '',
            isBot: user.isBot || false,
          },
        });
      }

      // 查询群组（按 username 精确匹配）
      const groupByUsername = await prisma.group.findUnique({
        where: { username: slug },
        select: { id: true, dialogId: true, username: true, name: true, avatar: true, memberCount: true, type: true, isPublic: true },
      });
      if (groupByUsername) {
        return res.json({
          type: 'group',
          data: {
            id: groupByUsername.id,
            username: groupByUsername.username,
            name: groupByUsername.name,
            avatar: avatarToProxy(groupByUsername.avatar),
            memberCount: groupByUsername.memberCount,
            groupType: groupByUsername.type,
            isPublic: groupByUsername.isPublic,
          },
        });
      }

      // 兼容旧版：按内部 id 查询群组
      const group = await prisma.group.findUnique({
        where: { id: slug },
        select: { id: true, dialogId: true, username: true, name: true, avatar: true, memberCount: true, type: true, isPublic: true },
      });
      if (group) {
        return res.json({
          type: 'group',
          data: {
            id: group.id,
            username: group.username || null,
            name: group.name,
            avatar: avatarToProxy(group.avatar),
            memberCount: group.memberCount,
            groupType: group.type,
            isPublic: group.isPublic,
          },
        });
      }

      // 按 dialogId 查询（TG 风格数字 ID）
      const userByDialog = await prisma.user.findUnique({
        where: { dialogId: slug },
        select: { id: true, dialogId: true, username: true, nickname: true, avatar: true, bio: true, isBanned: true, isBot: true },
      });
      if (userByDialog && !userByDialog.isBanned) {
        return res.json({
          type: 'user',
          data: {
            id: userByDialog.id,
            username: userByDialog.username,
            nickname: userByDialog.nickname || userByDialog.username,
            avatar: avatarToProxy(userByDialog.avatar),
            bio: userByDialog.bio || '',
            isBot: userByDialog.isBot || false,
          },
        });
      }

      const groupByDialog = await prisma.group.findUnique({
        where: { dialogId: slug },
        select: { id: true, dialogId: true, username: true, name: true, avatar: true, memberCount: true, type: true, isPublic: true },
      });
      if (groupByDialog) {
        return res.json({
          type: 'group',
          data: {
            id: groupByDialog.id,
            username: groupByDialog.username || null,
            name: groupByDialog.name,
            avatar: avatarToProxy(groupByDialog.avatar),
            memberCount: groupByDialog.memberCount,
            groupType: groupByDialog.type,
            isPublic: groupByDialog.isPublic,
          },
        });
      }

      return res.status(404).json({ error: '未找到用户或群组' });
    } catch (e) {
      console.error('[InviteLink] resolve 失败:', e);
      res.status(500).json({ error: '服务器错误' });
    }
  });

  // ============ 健康检查 ============
  app.get('/api/health', async (_req, res) => {
    try {
      await checkDatabaseHealth();
      res.json({
        ok: true,
        service: 'cqim',
        env: process.env.NODE_ENV || 'development',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        service: 'cqim',
        error: 'database_unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ============ 静态文件服务 ============
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");
  const oneYearInSeconds = 31536000;
  const setNoCacheHtmlHeaders = (res: express.Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  app.use(express.static(staticPath, {
    index: false,
    etag: true,
    immutable: true,
    maxAge: `${oneYearInSeconds}s`,
    setHeaders: (res, filePath) => {
      const fileName = path.basename(filePath);
      // PWA图标和manifest不强缓存，以便更新后立即生效
      const noCachePwaFiles = [
        'manifest.json', 'apple-touch-icon.png', 'favicon.ico',
        'favicon-16.png', 'favicon-32.png',
        'icon-128.png', 'icon-192.png', 'icon-256.png', 'icon-384.png', 'icon-512.png',
        'logo.png', 'logo.jpg', 'icon-master.png',
        'apple-touch-icon-precomposed.png',
        'apple-touch-icon-180x180.png', 'apple-touch-icon-180x180-precomposed.png',
        'apple-touch-icon-152x152.png', 'apple-touch-icon-152x152-precomposed.png',
        'apple-touch-icon-120x120.png', 'apple-touch-icon-120x120-precomposed.png',
        'apple-touch-icon-76x76.png', 'apple-touch-icon-76x76-precomposed.png',
        'apple-touch-icon-60x60.png', 'apple-touch-icon-60x60-precomposed.png',
      ];
      if (filePath.endsWith('.html') || noCachePwaFiles.includes(fileName)) {
        setNoCacheHtmlHeaders(res);
        return;
      }
      res.setHeader('Cache-Control', `public, max-age=${oneYearInSeconds}, immutable`);
    },
  }));

  /**
   * GET /im/:slug — 外链落地页（添加好友 / 加入群组）
   * 服务端注入 OG 元标签，支持社交分享预览卡片
   * 必须在 SPA 通配路由之前注册
   */
  app.get('/im/:slug', async (req, res) => {
    const { slug } = req.params;
    const indexPath = path.join(staticPath, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    try {
      const siteName = '灵鸽 IM';
      const escHtml = (s: string) => s.replace(/[<>"'&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c] || c));
      let ogTitle = `加入 ${siteName}`;
      let ogDescription = '点击链接添加好友或加入群组';
      let ogImage = '';
      let ogType = 'website';

      // 邀请链接格式：/im/+hash
      if (slug.startsWith('+')) {
        const hash = slug.slice(1);
        const link = await prisma.inviteLink.findUnique({
          where: { hash },
          include: { group: { select: { name: true, avatar: true, memberCount: true } } },
        });
        if (link && !link.isRevoked) {
          ogTitle = `加入群组「${escHtml(link.group.name)}」— ${siteName}`;
          ogDescription = `${link.group.memberCount} 名成员 · 通过邀请链接加入群聊`;
          ogImage = avatarToProxy(link.group.avatar);
        }
      } else {
        // 优先查用户
        const user = await prisma.user.findUnique({
          where: { username: slug },
          select: { id: true, username: true, nickname: true, avatar: true, bio: true, isBanned: true },
        });
        if (user && !user.isBanned) {
          const displayName = user.nickname || user.username;
          ogTitle = `添加 ${escHtml(displayName)} 为好友 — ${siteName}`;
          ogDescription = user.bio ? escHtml(user.bio) : `点击添加 ${escHtml(displayName)} 为好友`;
          ogImage = avatarToProxy(user.avatar);
          ogType = 'profile';
        } else {
          // 查群组（按 username 或 id）
          const group = await prisma.group.findUnique({
            where: { username: slug },
            select: { id: true, name: true, avatar: true, memberCount: true },
          }) || await prisma.group.findUnique({
            where: { id: slug },
            select: { id: true, name: true, avatar: true, memberCount: true },
          });
          if (group) {
            ogTitle = `加入群组「${escHtml(group.name)}」— ${siteName}`;
            ogDescription = `${group.memberCount} 名成员 · 点击加入群聊`;
            ogImage = avatarToProxy(group.avatar);
            ogType = 'website';
          }
        }
      }

      const pageUrl = `https://wed.imim.chat/im/${encodeURIComponent(slug)}`;
      let html = fs.readFileSync(indexPath, 'utf-8');
      const ogTags = [
        `<meta property="og:type" content="${ogType}" />`,
        `<meta property="og:title" content="${escHtml(ogTitle)}" />`,
        `<meta property="og:description" content="${escHtml(ogDescription)}" />`,
        `<meta property="og:url" content="${pageUrl}" />`,
        `<meta property="og:site_name" content="${siteName}" />`,
        ogImage ? `<meta property="og:image" content="${ogImage}" />` : '',
        `<meta name="twitter:card" content="summary" />`,
        `<meta name="twitter:title" content="${escHtml(ogTitle)}" />`,
        `<meta name="twitter:description" content="${escHtml(ogDescription)}" />`,
        ogImage ? `<meta name="twitter:image" content="${ogImage}" />` : '',
        `<title>${escHtml(ogTitle)}</title>`,
      ].filter(Boolean).join('\n    ');

      html = html.replace(/<title>[^<]*<\/title>/, '');
      html = html.replace('</head>', `    ${ogTags}\n  </head>`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      setNoCacheHtmlHeaders(res);
      res.send(html);
    } catch (e) {
      setNoCacheHtmlHeaders(res);
      res.sendFile(path.join(staticPath, 'index.html'));
    }
  });

  /**
   * GET /pyq/:userId — 朋友圈外链页面（服务端注入 OG 元标签，支持社交分享预览卡片）
   * 必须在 SPA 通配路由之前注册，优先处理 /pyq/ 路径
   */
  app.get('/q/:userId', async (req, res) => {
    return res.redirect(301, `/pyq/${encodeURIComponent(req.params.userId)}`);
  });

  app.get('/pyq/:userId', async (req, res) => {
    const { userId } = req.params;
    const indexPath = path.join(staticPath, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    try {
      // 查询用户公开信息
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar: true,
          bio: true,
          _count: { select: { moments: { where: { visibility: 'public' } } } },
        },
      });
      const displayName = user ? (user.nickname || user.username) : '朋友圈';
      const bio = (user?.bio || '').replace(/[<>"'&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c] || c));
      const safeDisplayName = displayName.replace(/[<>"'&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c] || c));
      const avatarUrl = avatarToProxy(user?.avatar);
      const momentCount = user ? user._count.moments : 0;
      const pageUrl = `${req.protocol}://${req.get('host')}/pyq/${userId}`;
      const siteName = '灵鸽 IM';
      const description = bio
        ? `${bio}${momentCount > 0 ? `（共 ${momentCount} 条动态）` : ''}`
        : `查看 ${safeDisplayName} 的朋友圈动态${momentCount > 0 ? `，共 ${momentCount} 条` : ''}`;

      // 读取 index.html 并注入 OG 元标签
      let html = fs.readFileSync(indexPath, 'utf-8');
      const ogTags = [
        `<meta property="og:type" content="profile" />`,
        `<meta property="og:title" content="${safeDisplayName} 的朋友圈 — ${siteName}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:url" content="${pageUrl}" />`,
        `<meta property="og:site_name" content="${siteName}" />`,
        avatarUrl ? `<meta property="og:image" content="${avatarUrl}" />` : '',
        `<meta name="twitter:card" content="summary" />`,
        `<meta name="twitter:title" content="${safeDisplayName} 的朋友圈 — ${siteName}" />`,
        `<meta name="twitter:description" content="${description}" />`,
        avatarUrl ? `<meta name="twitter:image" content="${avatarUrl}" />` : '',
        `<title>${safeDisplayName} 的朋友圈 — ${siteName}</title>`,
      ].filter(Boolean).join('\n    ');

      // 替换原有 <title> 并在 </head> 前注入 OG 标签
      html = html.replace(/<title>[^<]*<\/title>/, '');
      html = html.replace('</head>', `    ${ogTags}\n  </head>`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      setNoCacheHtmlHeaders(res);
      res.send(html);
    } catch (e) {
      // 降级：直接返回 index.html
      setNoCacheHtmlHeaders(res);
      res.sendFile(indexPath);
    }
  });

  app.get("*", (req, res) => {
    if (path.extname(req.path)) {
      return res.status(404).send('Not Found');
    }
    setNoCacheHtmlHeaders(res);
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`Signal WebSocket: ws://localhost:${port}/signal`);
    console.log(`OneBot v11 WS:    ws://localhost:${port}/onebot/v11/ws`);
    console.log(`OneBot HTTP API:  http://localhost:${port}/send_group_msg`);
    // 启动反向 WS 客户端，主动连接 AstrBot
    startReverseWsClient(handleOneBotAction);

    // ===== 阅后即焚：定时清理过期消息（每 30 秒执行一次） =====
    setInterval(async () => {
      try {
        const now = new Date();
        const expired = await prisma.privateMessage.findMany({
          where: {
            burnExpireAt: { not: null, lte: now },
          },
          select: { id: true, chatId: true, senderId: true },
          take: 100,
        });
        if (expired.length > 0) {
          // 通知在线用户删除这些消息
          for (const msg of expired) {
            const chat = await prisma.chat.findUnique({ where: { id: msg.chatId } });
            if (chat) {
              const participants = [chat.participantA, chat.participantB];
              for (const uid of participants) {
                sendTo(uid, {
                  type: 'burn_delete' as any,
                  payload: { chatId: msg.chatId, messageId: msg.id },
                });
              }
            }
          }
          // 批量删除过期消息
          const deleted = await prisma.privateMessage.deleteMany({
            where: { id: { in: expired.map(m => m.id) } },
          });
          console.log(`[BurnAfterRead] 定时清理: 删除 ${deleted.count} 条过期消息`);
        }
      } catch (err) {
        console.error('[BurnAfterRead] 定时清理失败:', err);
      }
    }, 30000);
  });
}

// ============ 反向 WebSocket 客户端（主动连接 AstrBot） ============
/**
 * 启动反向 WS 客户端，主动连接到 AstrBot 的 WS 服务端
 * AstrBot 配置：反向 WebSocket 主机=0.0.0.0，端口=6199，令牌=imimchat
 * cqim 作为客户端连接到 ws://bot.djy.cq.cn:6199
 */
function startReverseWsClient(handleOneBotAction: (ws: WebSocket, action: OneBotAction) => void) {
  const ASTRBOT_WS_URL = process.env.ASTRBOT_WS_URL || 'ws://127.0.0.1:6199/ws';
  const token = process.env.ONEBOT_ACCESS_TOKEN;
  if (!token) {
    console.log('[ReverseWS] ONEBOT_ACCESS_TOKEN 未设置，跳过 AstrBot 连接');
    return;
  }
  let reconnectDelay = 3000;
  const MAX_RECONNECT_DELAY = 60000;

  function connect() {
    console.log(`[ReverseWS] 正在连接 AstrBot: ${ASTRBOT_WS_URL}`);
    const ws = new WebSocket(ASTRBOT_WS_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Self-ID': String(BOT_SELF_ID),
        'X-Client-Role': 'Universal',
        'User-Agent': 'cqim/1.0 OneBot/11',
      },
    });

    ws.on('open', () => {
      console.log(`[ReverseWS] 已连接到 AstrBot (${ASTRBOT_WS_URL})`);
      reconnectDelay = 3000;
      // 将此连接加入 onebotClients，复用现有推送逻辑
      onebotClients.add(ws);
      // 发送生命周期连接事件
      ws.send(JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        self_id: BOT_SELF_ID,
        post_type: 'meta_event',
        meta_event_type: 'lifecycle',
        sub_type: 'connect',
      }));
    });

    ws.on('message', (data) => {
      try {
        const action = JSON.parse(data.toString()) as OneBotAction;
        // 复用现有的 handleOneBotAction 处理逻辑
        handleOneBotAction(ws, action);
      } catch (e) {
        console.error('[ReverseWS] 无法解析动作:', e);
      }
    });

    ws.on('close', (code, reason) => {
      onebotClients.delete(ws);
      console.log(`[ReverseWS] 连接断开 code=${code} reason=${reason?.toString() || ''}，${reconnectDelay / 1000}s 后重连...`);
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay);
    });

    ws.on('error', (err) => {
      console.error(`[ReverseWS] 连接错误: ${err.message}`);
      // close 事件会在 error 后自动触发，重连逻辑在 close 中处理
    });
  }

  connect();
}

initDatabase()
  .then(() => Promise.allSettled([connectRedis(), connectMySQL()]))
  .then(() => startServer())
  .catch(console.error);
