/**
 * MLSCrypto.ts — MLS (Messaging Layer Security) 底层密码学工具
 *
 * 基于 Web Crypto API 实现 MLS RFC 9420 核心密码学原语：
 * 1. HPKE (Hybrid Public Key Encryption) 简化版
 * 2. TreeKEM 密钥树操作
 * 3. AES-256-GCM 对称加密
 * 4. HKDF-SHA256 密钥派生
 * 5. ECDH P-256 密钥交换
 *
 * 设计目标：支持万人群 O(log N) 密钥更新
 */

// ============================================================
// 基础类型
// ============================================================

export interface MLSKeyPair {
  publicKey: string;   // Base64 编码的 ECDH 公钥 (raw format)
  privateKey: string;  // Base64 编码的 ECDH 私钥 (pkcs8 format)
}

export interface MLSEncryptedPayload {
  ciphertext: string;  // Base64
  iv: string;          // Base64
  tag: string;         // Base64 (GCM auth tag embedded in ciphertext)
}

/** TreeKEM 树节点 */
export interface TreeNode {
  /** 节点公钥（Base64），null 表示空节点 */
  publicKey: string | null;
  /** 节点私钥（仅本地持有，不上传） */
  privateKey?: string | null;
  /** 节点哈希（用于验证树完整性） */
  hash?: string;
  /** 未合并的叶子节点列表（用于 blank 节点处理） */
  unmergedLeaves?: number[];
}

/** MLS Epoch 状态 */
export interface MLSEpochState {
  epoch: number;
  groupId: string;
  /** 当前 epoch 的群密钥（对称密钥，Base64） */
  groupSecret: string;
  /** 应用密钥（用于消息加密，Base64） */
  applicationSecret: string;
  /** 确认密钥（用于 Commit 确认，Base64） */
  confirmationKey: string;
  /** 成员密钥（用于成员认证，Base64） */
  membershipKey: string;
  /** 初始化密钥（用于 init secret，Base64） */
  initSecret: string;
  /** TreeKEM 树 */
  tree: TreeNode[];
  /** 本节点在树中的叶子索引 */
  myLeafIndex: number;
  /** 成员列表 (userId -> leafIndex) */
  members: Record<string, number>;
  /** 创建时间 */
  createdAt: number;
}

/** MLS KeyPackage（用于加入群组） */
export interface MLSKeyPackage {
  version: number;
  cipherSuite: number;
  /** HPKE init key（Base64 公钥） */
  initKey: string;
  /** 叶子节点公钥（Base64） */
  leafKey: string;
  /** 签名（Base64） */
  signature: string;
  /** 用户 ID */
  userId: string;
  /** 创建时间 */
  createdAt: number;
  /** 过期时间 */
  expiresAt: number;
}

/** MLS Welcome 消息（邀请新成员加入） */
export interface MLSWelcome {
  groupId: string;
  epoch: number;
  /** 加密的群状态（用新成员的 initKey 加密） */
  encryptedGroupInfo: MLSEncryptedPayload;
  /** 新成员的叶子索引 */
  leafIndex: number;
  /** 当前树的公钥快照（不含私钥） */
  treeSnapshot: TreeNode[];
  /** 成员列表 */
  members: Record<string, number>;
}

/** MLS Commit 消息（密钥更新） */
export interface MLSCommit {
  groupId: string;
  epoch: number;
  /** 提交者的叶子索引 */
  senderLeafIndex: number;
  /** 更新路径上的加密节点密钥 */
  updatePath: Array<{
    nodeIndex: number;
    publicKey: string;
    /** 对每个需要此密钥的子树成员加密的节点私钥 */
    encryptedPathSecrets: Array<{
      leafIndex: number;
      ciphertext: MLSEncryptedPayload;
    }>;
  }>;
  /** Commit 确认值 */
  confirmationTag: string;
}

/** MLS 应用消息（加密的群消息） */
export interface MLSApplicationMessage {
  groupId: string;
  epoch: number;
  senderLeafIndex: number;
  /** 加密的消息内容 */
  ciphertext: MLSEncryptedPayload;
  /** 消息序号（用于防重放） */
  generation: number;
}

// ============================================================
// 常量
// ============================================================

const MLS_VERSION = 1;
const CIPHER_SUITE_MLS_128_DHKEMP256_AES128GCM_SHA256 = 0x0001;

// ============================================================
// 基础密码学函数
// ============================================================

/** 生成 ECDH P-256 密钥对 */
export async function generateMLSKeyPair(): Promise<MLSKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  return {
    publicKey: bufToBase64(pubRaw),
    privateKey: bufToBase64(privPkcs8),
  };
}

/** ECDH 密钥交换 */
export async function mlsECDH(privateKeyB64: string, publicKeyB64: string): Promise<ArrayBuffer> {
  const privKey = await crypto.subtle.importKey(
    'pkcs8',
    base64ToBuf(privateKeyB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
  const pubKey = await crypto.subtle.importKey(
    'raw',
    base64ToBuf(publicKeyB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: pubKey },
    privKey,
    256
  );
}

/** HKDF-SHA256 密钥派生 */
export async function mlsHKDF(
  ikm: ArrayBuffer,
  salt: ArrayBuffer | null,
  info: ArrayBuffer,
  length: number
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    ikm,
    'HKDF',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt || new ArrayBuffer(32),
      info,
    },
    key,
    length * 8
  );
}

/** HKDF-Expand-Label (MLS 风格) */
export async function mlsExpandLabel(
  secret: ArrayBuffer,
  label: string,
  context: ArrayBuffer,
  length: number
): Promise<ArrayBuffer> {
  const labelBytes = strToBuf(`mls10 ${label}`);
  const info = concatBufs(
    new Uint8Array([0, length]),
    new Uint8Array([labelBytes.byteLength]),
    labelBytes,
    new Uint8Array([context.byteLength]),
    context
  );
  return mlsHKDF(secret, null, info, length);
}

/** AES-256-GCM 加密 */
export async function mlsEncrypt(
  plaintext: ArrayBuffer,
  keyBytes: ArrayBuffer,
  aad?: ArrayBuffer
): Promise<MLSEncryptedPayload> {
  // 使用 AES-128-GCM（与 cipher suite 一致）或 AES-256-GCM
  const keyLen = keyBytes.byteLength;
  const algoKey = await crypto.subtle.importKey(
    'raw',
    keyLen > 16 ? keyBytes.slice(0, 32) : keyBytes.slice(0, 16),
    'AES-GCM',
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad || new ArrayBuffer(0),
      tagLength: 128,
    },
    algoKey,
    plaintext
  );
  // Web Crypto 把 auth tag 附在 ciphertext 后面
  return {
    ciphertext: bufToBase64(encrypted),
    iv: bufToBase64(iv.buffer),
    tag: '', // tag is embedded in ciphertext by Web Crypto
  };
}

/** AES-256-GCM 解密 */
export async function mlsDecrypt(
  payload: MLSEncryptedPayload,
  keyBytes: ArrayBuffer,
  aad?: ArrayBuffer
): Promise<ArrayBuffer> {
  const keyLen = keyBytes.byteLength;
  const algoKey = await crypto.subtle.importKey(
    'raw',
    keyLen > 16 ? keyBytes.slice(0, 32) : keyBytes.slice(0, 16),
    'AES-GCM',
    false,
    ['decrypt']
  );
  const iv = base64ToBuf(payload.iv);
  const ciphertext = base64ToBuf(payload.ciphertext);
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(iv),
      additionalData: aad || new ArrayBuffer(0),
      tagLength: 128,
    },
    algoKey,
    ciphertext
  );
}

/** SHA-256 哈希 */
export async function mlsSHA256(data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', data);
}

// ============================================================
// TreeKEM 树操作
// ============================================================

/**
 * 计算树的大小（完全二叉树节点总数）
 * n 个叶子节点需要 2n-1 个总节点
 */
export function treeSize(leafCount: number): number {
  if (leafCount === 0) return 0;
  return 2 * leafCount - 1;
}

/** 叶子索引转树节点索引 */
export function leafToNodeIndex(leafIndex: number): number {
  return 2 * leafIndex;
}

/** 获取父节点索引 */
export function parentIndex(nodeIndex: number, totalNodes: number): number {
  if (nodeIndex >= totalNodes) return -1;
  // 在完全二叉树中，节点 x 的父节点
  const level = nodeLevel(nodeIndex);
  const step = 1 << (level + 1);
  const parentStep = 1 << (level + 2);
  // 计算父节点
  if ((nodeIndex >> (level + 1)) & 1) {
    return nodeIndex - step / 2;
  } else {
    return nodeIndex + step / 2;
  }
}

/** 获取节点层级 */
function nodeLevel(index: number): number {
  let level = 0;
  let x = index;
  while ((x & 1) === 1) {
    x >>= 1;
    level++;
  }
  return level;
}

/** 获取左子节点 */
export function leftChild(nodeIndex: number): number {
  const level = nodeLevel(nodeIndex);
  if (level === 0) return -1; // 叶子节点没有子节点
  return nodeIndex - (1 << (level - 1));
}

/** 获取右子节点 */
export function rightChild(nodeIndex: number): number {
  const level = nodeLevel(nodeIndex);
  if (level === 0) return -1;
  return nodeIndex + (1 << (level - 1));
}

/** 获取兄弟节点 */
export function siblingIndex(nodeIndex: number, totalNodes: number): number {
  const parent = parentIndex(nodeIndex, totalNodes);
  if (parent === -1) return -1;
  const left = leftChild(parent);
  const right = rightChild(parent);
  return nodeIndex === left ? right : left;
}

/**
 * 获取从叶子到根的直接路径（不含叶子本身）
 * 返回节点索引数组
 */
export function directPath(leafIndex: number, leafCount: number): number[] {
  const total = treeSize(leafCount);
  const path: number[] = [];
  let current = leafToNodeIndex(leafIndex);
  while (true) {
    const parent = parentIndex(current, total);
    if (parent === -1 || parent === current) break;
    path.push(parent);
    current = parent;
    if (current === total - 1 && leafCount > 1) break; // 到达根节点
  }
  return path;
}

/**
 * 获取共路径（copath）— 直接路径上每个节点的兄弟节点
 * 这些节点的密钥需要用来加密路径密钥
 */
export function copath(leafIndex: number, leafCount: number): number[] {
  const total = treeSize(leafCount);
  const path = directPath(leafIndex, leafCount);
  return path.map(nodeIdx => siblingIndex(nodeIdx, total)).filter(idx => idx !== -1);
}

/**
 * 获取某个节点的子树中的所有叶子索引
 */
export function subtreeLeaves(nodeIndex: number, leafCount: number): number[] {
  const level = nodeLevel(nodeIndex);
  if (level === 0) {
    // 叶子节点
    return [nodeIndex / 2];
  }
  const left = leftChild(nodeIndex);
  const right = rightChild(nodeIndex);
  return [...subtreeLeaves(left, leafCount), ...subtreeLeaves(right, leafCount)];
}

/**
 * 找到两个叶子的最低公共祖先 (LCA)
 */
export function lowestCommonAncestor(leaf1: number, leaf2: number, leafCount: number): number {
  const total = treeSize(leafCount);
  let a = leafToNodeIndex(leaf1);
  let b = leafToNodeIndex(leaf2);
  while (a !== b) {
    if (nodeLevel(a) <= nodeLevel(b)) {
      a = parentIndex(a, total);
    } else {
      b = parentIndex(b, total);
    }
  }
  return a;
}

// ============================================================
// MLS 密钥调度 (Key Schedule)
// ============================================================

/**
 * 从 commit_secret 和 init_secret 派生 epoch 密钥
 * 遵循 MLS RFC 9420 Section 8
 */
export async function deriveEpochSecrets(
  commitSecret: ArrayBuffer,
  initSecret: ArrayBuffer,
  groupContext: ArrayBuffer
): Promise<{
  groupSecret: ArrayBuffer;
  joinerSecret: ArrayBuffer;
  welcomeSecret: ArrayBuffer;
  applicationSecret: ArrayBuffer;
  confirmationKey: ArrayBuffer;
  membershipKey: ArrayBuffer;
  newInitSecret: ArrayBuffer;
}> {
  // joiner_secret = HKDF-Expand-Label(commit_secret, "joiner", group_context, 32)
  const joinerSecret = await mlsExpandLabel(commitSecret, 'joiner', groupContext, 32);

  // epoch_secret = HKDF-Extract(joiner_secret, init_secret)
  const epochSecret = await mlsHKDF(joinerSecret, initSecret, strToBuf('epoch'), 32);

  // 从 epoch_secret 派生各种密钥
  const emptyCtx = new ArrayBuffer(0);
  const groupSecret = await mlsExpandLabel(epochSecret, 'group', emptyCtx, 32);
  const welcomeSecret = await mlsExpandLabel(epochSecret, 'welcome', emptyCtx, 32);
  const applicationSecret = await mlsExpandLabel(epochSecret, 'app', emptyCtx, 32);
  const confirmationKey = await mlsExpandLabel(epochSecret, 'confirm', emptyCtx, 32);
  const membershipKey = await mlsExpandLabel(epochSecret, 'membership', emptyCtx, 32);
  const newInitSecret = await mlsExpandLabel(epochSecret, 'init', emptyCtx, 32);

  return {
    groupSecret,
    joinerSecret,
    welcomeSecret,
    applicationSecret,
    confirmationKey,
    membershipKey,
    newInitSecret,
  };
}

/**
 * 从 application_secret 派生消息加密密钥
 * 使用 generation 计数器实现前向安全
 */
export async function deriveMessageKey(
  applicationSecret: ArrayBuffer,
  generation: number
): Promise<{ key: ArrayBuffer; nonce: ArrayBuffer }> {
  const genBuf = new ArrayBuffer(4);
  new DataView(genBuf).setUint32(0, generation, false);

  const key = await mlsExpandLabel(applicationSecret, 'app-key', genBuf, 16);
  const nonce = await mlsExpandLabel(applicationSecret, 'app-nonce', genBuf, 12);
  return { key, nonce };
}

// ============================================================
// 工具函数
// ============================================================

export function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function strToBuf(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

export function bufToStr(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

export function concatBufs(...buffers: (ArrayBuffer | Uint8Array)[]): ArrayBuffer {
  let totalLen = 0;
  const arrays = buffers.map(b => {
    const arr = b instanceof Uint8Array ? b : new Uint8Array(b);
    totalLen += arr.length;
    return arr;
  });
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result.buffer;
}

export function randomBytes(length: number): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(length)).buffer;
}

export { MLS_VERSION, CIPHER_SUITE_MLS_128_DHKEMP256_AES128GCM_SHA256 };
