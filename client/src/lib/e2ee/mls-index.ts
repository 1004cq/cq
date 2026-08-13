/**
 * MLS E2EE 模块导出索引
 *
 * 提供 MLS 端到端加密的统一入口：
 * - MLSCrypto: 底层密码学工具
 * - MLSGroupManager: 群组管理器
 */

export {
  // 密码学原语
  generateMLSKeyPair,
  mlsECDH,
  mlsEncrypt,
  mlsDecrypt,
  mlsHKDF,
  mlsSHA256,
  mlsExpandLabel,
  deriveEpochSecrets,
  deriveMessageKey,
  bufToBase64,
  base64ToBuf,
  strToBuf,
  bufToStr,
  // TreeKEM
  treeSize,
  leafToNodeIndex,
  directPath,
  copath,
  subtreeLeaves,
  // 常量
  MLS_VERSION,
  CIPHER_SUITE_MLS_128_DHKEMP256_AES128GCM_SHA256,
} from './MLSCrypto';

export type {
  MLSKeyPair,
  MLSKeyPackage,
  MLSEpochState,
  MLSWelcome,
  MLSCommit,
  MLSApplicationMessage,
  MLSEncryptedPayload,
  TreeNode,
} from './MLSCrypto';

export {
  MLSGroupManager,
  getMLSGroupManager,
} from './MLSGroupManager';

export type {
  MLSGroupStatus,
} from './MLSGroupManager';
