/**
 * imim CryptoUtils — 基于 Web Crypto API 的密码学原语
 *
 * 实现 Signal Protocol 所需的底层密码学操作：
 * - X25519 ECDH 密钥交换（使用 P-256 曲线模拟，浏览器原生支持）
 * - HKDF 密钥派生
 * - AES-256-GCM 对称加密
 * - HMAC-SHA256 签名
 * - 随机数生成
 *
 * 注意：浏览器 Web Crypto API 不直接支持 Curve25519，
 * 此处使用 NIST P-256 (secp256r1) 作为替代，提供等效安全级别。
 */

// ============================================================
// 编码工具
// ============================================================

/** ArrayBuffer → Base64 */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Base64 → ArrayBuffer */
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** ArrayBuffer → Hex */
export function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Hex → ArrayBuffer */
export function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

/** 字符串 → ArrayBuffer (UTF-8) */
export function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

/** ArrayBuffer → 字符串 (UTF-8) */
export function bufferToString(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

/** 合并多个 ArrayBuffer */
export function concatBuffers(...buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer;
}

// ============================================================
// 随机数
// ============================================================

/** 生成随机字节 */
export function randomBytes(length: number): ArrayBuffer {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes.buffer;
}

/** 生成随机注册 ID (1 ~ 16380) */
export function generateRegistrationId(): number {
  const array = new Uint16Array(1);
  crypto.getRandomValues(array);
  return (array[0] % 16380) + 1;
}

// ============================================================
// ECDH 密钥对（P-256 曲线）
// ============================================================

export interface ECKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface ExportedKeyPair {
  pubKey: string;   // Base64 of SPKI
  privKey: string;  // Base64 of PKCS8
}

/** 生成 ECDH 密钥对 */
export async function generateKeyPair(): Promise<ECKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

/** 导出密钥对为 Base64 */
export async function exportKeyPair(keyPair: ECKeyPair): Promise<ExportedKeyPair> {
  const pubRaw = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privRaw = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  return {
    pubKey: bufferToBase64(pubRaw),
    privKey: bufferToBase64(privRaw),
  };
}

/** 从 Base64 导入公钥 */
export async function importPublicKey(base64: string): Promise<CryptoKey> {
  const buffer = base64ToBuffer(base64);
  return crypto.subtle.importKey(
    'spki',
    buffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/** 从 Base64 导入私钥 */
export async function importPrivateKey(base64: string): Promise<CryptoKey> {
  const buffer = base64ToBuffer(base64);
  return crypto.subtle.importKey(
    'pkcs8',
    buffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
}

/** ECDH 密钥交换 — 派生共享密钥 */
export async function ecdh(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
}

// ============================================================
// ECDSA 签名（用于 Signed PreKey 签名验证）
// ============================================================

export interface ECSignKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

/** 生成 ECDSA 签名密钥对 */
export async function generateSigningKeyPair(): Promise<ECSignKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

/** ECDSA 签名 */
export async function sign(
  privateKey: CryptoKey,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  return crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    data
  );
}

/** ECDSA 验证签名 */
export async function verify(
  publicKey: CryptoKey,
  signature: ArrayBuffer,
  data: ArrayBuffer
): Promise<boolean> {
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signature,
    data
  );
}

// ============================================================
// HKDF 密钥派生
// ============================================================

/** HKDF-SHA256 密钥派生 */
export async function hkdf(
  inputKeyMaterial: ArrayBuffer,
  salt: ArrayBuffer,
  info: ArrayBuffer,
  length: number = 32
): Promise<ArrayBuffer> {
  // 导入 IKM 为 HKDF 密钥
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    inputKeyMaterial,
    'HKDF',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: info,
    },
    hkdfKey,
    length * 8
  );
}

/** 从共享密钥派生消息密钥（chain key → message key） */
export async function deriveMessageKeys(
  chainKey: ArrayBuffer
): Promise<{ messageKey: ArrayBuffer; nextChainKey: ArrayBuffer }> {
  const messageKeyInfo = stringToBuffer('MessageKey');
  const chainKeyInfo = stringToBuffer('ChainKey');
  const salt = new Uint8Array(32).buffer; // zero salt

  const messageKey = await hkdf(chainKey, salt, messageKeyInfo, 32);
  const nextChainKey = await hkdf(chainKey, salt, chainKeyInfo, 32);

  return { messageKey, nextChainKey };
}

// ============================================================
// AES-256-GCM 对称加密
// ============================================================

export interface EncryptedPayload {
  ciphertext: string;  // Base64
  iv: string;          // Base64
  tag: string;         // included in ciphertext for GCM
}

/** AES-256-GCM 加密 */
export async function aesEncrypt(
  plaintext: ArrayBuffer,
  keyMaterial: ArrayBuffer
): Promise<EncryptedPayload> {
  const iv = randomBytes(12); // 96-bit IV for GCM
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    'AES-GCM',
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    plaintext
  );

  return {
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv),
    tag: '', // GCM tag is appended to ciphertext
  };
}

/** AES-256-GCM 解密 */
export async function aesDecrypt(
  payload: EncryptedPayload,
  keyMaterial: ArrayBuffer
): Promise<ArrayBuffer> {
  const iv = base64ToBuffer(payload.iv);
  const ciphertext = base64ToBuffer(payload.ciphertext);
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    'AES-GCM',
    false,
    ['decrypt']
  );

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  );
}

// ============================================================
// HMAC-SHA256
// ============================================================

/** HMAC-SHA256 */
export async function hmacSha256(
  key: ArrayBuffer,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', hmacKey, data);
}

// ============================================================
// SHA-256 哈希
// ============================================================

/** SHA-256 哈希 */
export async function sha256(data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', data);
}

// ============================================================
// Safety Number 生成
// ============================================================

/**
 * 生成 Safety Number（安全码）
 * 基于双方 Identity Key 的指纹，用于线下验证防中间人攻击
 * 生成 520 位数字，分 52 组每组 10 位
 */
export async function generateSafetyNumber(
  localIdentityKey: string,
  remoteIdentityKey: string
): Promise<string> {
  const localBuf = base64ToBuffer(localIdentityKey);
  const remoteBuf = base64ToBuffer(remoteIdentityKey);

  // 按字典序排列确保双方生成相同结果
  const [first, second] = bufferToBase64(localBuf) < bufferToBase64(remoteBuf)
    ? [localBuf, remoteBuf]
    : [remoteBuf, localBuf];

  const combined = concatBuffers(first, second);

  // 多轮 SHA-256 迭代，每轮产生 32 字节 = 32 位数字
  // 需要 520 位 → 至少 ceil(520/32) = 17 轮，取前 520 位
  let current: ArrayBuffer = combined;
  let numStr = '';

  for (let round = 0; numStr.length < 520; round++) {
    // 每轮在输入中混入轮次计数，确保每轮输出不同
    const roundBuf = new Uint8Array(1);
    roundBuf[0] = round & 0xff;
    current = await sha256(concatBuffers(current, roundBuf.buffer));
    const bytes = new Uint8Array(current);
    for (let i = 0; i < bytes.length && numStr.length < 520; i++) {
      // 取每字节的十位和个位，确保均匀分布
      numStr += Math.floor(bytes[i] / 10 % 10).toString();
      if (numStr.length < 520) {
        numStr += (bytes[i] % 10).toString();
      }
    }
  }

  numStr = numStr.slice(0, 520);

  // 格式化为 52 组 × 10 位数字
  const groups: string[] = [];
  for (let i = 0; i < 520; i += 10) {
    groups.push(numStr.slice(i, i + 10));
  }
  return groups.join(' ');
}

// ============================================================
// 指纹（用于密钥标识）
// ============================================================

/** 生成密钥指纹（前 8 字节的 hex） */
export async function fingerprint(keyBase64: string): Promise<string> {
  const keyBuf = base64ToBuffer(keyBase64);
  const hash = await sha256(keyBuf);
  const hex = bufferToHex(hash);
  // 格式化为 XX:XX:XX:XX:XX:XX:XX:XX
  return hex.slice(0, 16).match(/.{2}/g)!.join(':').toUpperCase();
}
