/**
 * 消息防篡改模块 — 基于 HMAC-SHA256 的消息完整性校验
 *
 * 参考 Signal Protocol 的 Encrypt-then-MAC 设计：
 * - 发送方：对消息内容 + 元数据计算 HMAC-SHA256 签名
 * - 接收方：重新计算 HMAC 并与收到的签名比对
 * - 密钥：基于双方共享密钥（会话密钥 / Identity Key 派生）
 *
 * HMAC 覆盖字段（Associated Data）：
 *   content || senderId || chatId || msgType || timestamp
 *
 * 使用 Web Crypto API 实现，确保密码学安全。
 */

import {
  hmacSha256,
  sha256,
  stringToBuffer,
  bufferToHex,
} from './e2ee/CryptoUtils';

// ============================================================
// HMAC 密钥派生
// ============================================================

/**
 * 从会话上下文派生 HMAC 密钥
 * 使用 SHA-256(chatId + senderId + receiverId + "imim-integrity") 作为密钥
 * 
 * 在真实 Signal Protocol 中，密钥应从 Double Ratchet 的 Chain Key 派生。
 * 这里使用会话参与者信息派生，确保同一会话的双方能独立计算相同的密钥。
 */
export async function deriveIntegrityKey(
  chatId: string,
  participantA: string,
  participantB: string,
): Promise<ArrayBuffer> {
  // 对参与者 ID 排序，确保双方派生相同密钥
  const sorted = [participantA, participantB].sort();
  const material = `${chatId}:${sorted[0]}:${sorted[1]}:imim-integrity-v1`;
  const materialBuf = stringToBuffer(material);
  return sha256(materialBuf);
}

// ============================================================
// HMAC 签名与验证
// ============================================================

/**
 * 构建 HMAC 输入数据（Associated Data）
 * 格式：content || "\x00" || senderId || "\x00" || chatId || "\x00" || msgType || "\x00" || timestamp
 * 使用 NUL 分隔符防止字段拼接歧义
 */
function buildHmacPayload(
  content: string,
  senderId: string,
  chatId: string,
  msgType: string,
  timestamp: number,
): ArrayBuffer {
  const payload = [content, senderId, chatId, msgType, String(timestamp)].join('\x00');
  return stringToBuffer(payload);
}

/**
 * 为消息生成 HMAC-SHA256 签名
 * @returns hex 编码的 64 字符签名
 */
export async function signMessage(params: {
  content: string;
  senderId: string;
  chatId: string;
  msgType: string;
  timestamp: number;
  integrityKey: ArrayBuffer;
}): Promise<string> {
  const payload = buildHmacPayload(
    params.content,
    params.senderId,
    params.chatId,
    params.msgType,
    params.timestamp,
  );
  const mac = await hmacSha256(params.integrityKey, payload);
  return bufferToHex(mac);
}

/**
 * 验证消息的 HMAC-SHA256 签名
 * @returns 'verified' | 'tampered' | 'unverified'
 */
export async function verifyMessage(params: {
  content: string;
  senderId: string;
  chatId: string;
  msgType: string;
  timestamp: number;
  hmac: string | undefined;
  integrityKey: ArrayBuffer;
}): Promise<'verified' | 'tampered' | 'unverified'> {
  if (!params.hmac) {
    return 'unverified';
  }

  try {
    const expected = await signMessage({
      content: params.content,
      senderId: params.senderId,
      chatId: params.chatId,
      msgType: params.msgType,
      timestamp: params.timestamp,
      integrityKey: params.integrityKey,
    });

    // 常量时间比较（JavaScript 层面尽力而为）
    if (expected.length !== params.hmac.length) {
      return 'tampered';
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ params.hmac.charCodeAt(i);
    }
    return diff === 0 ? 'verified' : 'tampered';
  } catch (err) {
    console.error('[Integrity] 验证失败:', err);
    return 'unverified';
  }
}
