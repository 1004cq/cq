/**
 * DoveIM E2EE 加密模拟层
 * 模拟 Signal Protocol 的 Double Ratchet 算法
 * 前端演示用，展示加密流程和密钥管理概念
 */

// 模拟 X3DH 密钥交换
export interface KeyBundle {
  identityKey: string;
  signedPreKey: string;
  oneTimePreKey: string;
  ephemeralKey: string;
}

export interface EncryptedMessage {
  ciphertext: string;
  header: {
    senderRatchetKey: string;
    previousChainLength: number;
    messageNumber: number;
  };
  timestamp: number;
}

// 简单的 XOR 加密（演示用）
function xorEncrypt(text: string, key: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(
      text.charCodeAt(i) ^ key.charCodeAt(i % key.length)
    );
  }
  return btoa(result);
}

function xorDecrypt(encoded: string, key: string): string {
  const decoded = atob(encoded);
  let result = '';
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(
      decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length)
    );
  }
  return result;
}

// 生成随机密钥
function generateKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// 模拟 Safety Number 生成
export function generateSafetyNumber(userId1: string, userId2: string): string {
  const combined = [userId1, userId2].sort().join('');
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const num = Math.abs(hash).toString().padStart(12, '0');
  return `${num.slice(0, 4)} ${num.slice(4, 8)} ${num.slice(8, 12)}`;
}

// E2EE 会话管理器
export class E2EESession {
  private sessionKey: string;
  private messageCounter: number = 0;
  private ratchetKey: string;

  constructor(peerId: string) {
    this.sessionKey = generateKey();
    this.ratchetKey = generateKey();
  }

  encrypt(plaintext: string): EncryptedMessage {
    this.messageCounter++;
    // 模拟棘轮前进
    this.ratchetKey = generateKey();

    return {
      ciphertext: xorEncrypt(plaintext, this.sessionKey),
      header: {
        senderRatchetKey: this.ratchetKey.slice(0, 8) + '...',
        previousChainLength: this.messageCounter - 1,
        messageNumber: this.messageCounter,
      },
      timestamp: Date.now(),
    };
  }

  decrypt(encrypted: EncryptedMessage): string {
    return xorDecrypt(encrypted.ciphertext, this.sessionKey);
  }

  getSessionInfo() {
    return {
      sessionKey: this.sessionKey.slice(0, 8) + '...',
      messageCount: this.messageCounter,
      ratchetKey: this.ratchetKey.slice(0, 8) + '...',
    };
  }
}

// 全局会话存储
const sessions = new Map<string, E2EESession>();

export function getOrCreateSession(peerId: string): E2EESession {
  if (!sessions.has(peerId)) {
    sessions.set(peerId, new E2EESession(peerId));
  }
  return sessions.get(peerId)!;
}
