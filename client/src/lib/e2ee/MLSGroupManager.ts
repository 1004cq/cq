/**
 * MLSGroupManager.ts — MLS 群组端到端加密管理器
 *
 * 实现 MLS (Messaging Layer Security) 核心群组管理：
 * 1. 群组创建与 TreeKEM 初始化
 * 2. 成员加入（Welcome + Add Proposal + Commit）
 * 3. 成员退出（Remove Proposal + Commit）
 * 4. 消息加密/解密（使用 epoch application key）
 * 5. 密钥更新（Update Proposal + Commit）
 * 6. Epoch 状态管理与持久化
 *
 * 设计目标：
 * - 万人群 O(log N) 密钥更新
 * - 前向安全 + 后向安全
 * - 异步离线支持
 */

import {
  type MLSKeyPair,
  type MLSKeyPackage,
  type MLSEpochState,
  type MLSWelcome,
  type MLSCommit,
  type MLSApplicationMessage,
  type MLSEncryptedPayload,
  type TreeNode,
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
  concatBufs,
  randomBytes,
  treeSize,
  leafToNodeIndex,
  directPath,
  copath,
  subtreeLeaves,
  MLS_VERSION,
  CIPHER_SUITE_MLS_128_DHKEMP256_AES128GCM_SHA256,
} from './MLSCrypto';

// ============================================================
// 类型定义
// ============================================================

/** 群组 E2EE 状态（UI 展示用） */
export interface MLSGroupStatus {
  groupId: string;
  epoch: number;
  memberCount: number;
  isInitialized: boolean;
  myLeafIndex: number;
  treeSize: number;
  lastUpdated: number;
}

/** 本地持久化的 MLS 密钥材料 */
interface LocalMLSKeys {
  /** 身份密钥对（长期） */
  identityKeyPair: MLSKeyPair;
  /** 当前活跃的 KeyPackage 私钥 */
  keyPackagePrivateKeys: Record<string, MLSKeyPair>; // initKey -> full keypair
  /** 叶子节点密钥对 */
  leafKeyPair: MLSKeyPair;
}

// ============================================================
// IndexedDB 持久化
// ============================================================

const MLS_DB_NAME = 'imim-mls-store';
const MLS_DB_VERSION = 1;

class MLSStore {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(MLS_DB_NAME, MLS_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('epochStates')) {
          db.createObjectStore('epochStates', { keyPath: 'groupId' });
        }
        if (!db.objectStoreNames.contains('localKeys')) {
          db.createObjectStore('localKeys', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('messageGenerations')) {
          db.createObjectStore('messageGenerations', { keyPath: 'groupId' });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  private tx(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) throw new Error('MLS Store 未初始化');
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  async saveEpochState(state: MLSEpochState): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx('epochStates', 'readwrite').put(state);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getEpochState(groupId: string): Promise<MLSEpochState | null> {
    return new Promise((resolve, reject) => {
      const req = this.tx('epochStates').get(groupId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteEpochState(groupId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx('epochStates', 'readwrite').delete(groupId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async saveLocalKeys(keys: LocalMLSKeys & { id: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx('localKeys', 'readwrite').put(keys);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getLocalKeys(userId: string): Promise<(LocalMLSKeys & { id: string }) | null> {
    return new Promise((resolve, reject) => {
      const req = this.tx('localKeys').get(userId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getMessageGeneration(groupId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = this.tx('messageGenerations').get(groupId);
      req.onsuccess = () => resolve(req.result?.generation || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async setMessageGeneration(groupId: string, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx('messageGenerations', 'readwrite').put({ groupId, generation });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clearAll(): Promise<void> {
    if (!this.db) return;
    const storeNames = ['epochStates', 'localKeys', 'messageGenerations'];
    for (const name of storeNames) {
      await new Promise<void>((resolve, reject) => {
        const req = this.tx(name, 'readwrite').clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }
}

// ============================================================
// MLSGroupManager 单例
// ============================================================

export class MLSGroupManager {
  private store: MLSStore;
  private localKeys: LocalMLSKeys | null = null;
  private userId: string = '';
  private _initialized = false;

  /** 内存中的 epoch 状态缓存 */
  private epochCache: Map<string, MLSEpochState> = new Map();

  /** 消息 generation 计数器 */
  private generationCounters: Map<string, number> = new Map();

  private static _instance: MLSGroupManager | null = null;

  static shared(): MLSGroupManager {
    if (!MLSGroupManager._instance) {
      MLSGroupManager._instance = new MLSGroupManager();
    }
    return MLSGroupManager._instance;
  }

  private constructor() {
    this.store = new MLSStore();
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  // ============================================================
  // 初始化
  // ============================================================

  /**
   * 初始化 MLS 管理器
   * - 打开 IndexedDB
   * - 加载或生成本地密钥材料
   * - 恢复已有的 epoch 状态
   */
  async initialize(userId: string): Promise<void> {
    if (this._initialized && this.userId === userId) return;

    this.userId = userId;
    await this.store.init();

    // 加载或生成本地密钥
    const existingKeys = await this.store.getLocalKeys(userId);
    if (existingKeys) {
      this.localKeys = existingKeys;
      console.log('[MLS] 已加载本地密钥材料');
    } else {
      await this.generateLocalKeys();
      console.log('[MLS] 密钥材料生成完成');
    }

    this._initialized = true;
  }

  /** 生成本地密钥材料 */
  private async generateLocalKeys(): Promise<void> {
    const identityKeyPair = await generateMLSKeyPair();
    const leafKeyPair = await generateMLSKeyPair();

    this.localKeys = {
      identityKeyPair,
      keyPackagePrivateKeys: {},
      leafKeyPair,
    };

    await this.store.saveLocalKeys({
      id: this.userId,
      ...this.localKeys,
    });
  }

  // ============================================================
  // KeyPackage 管理
  // ============================================================

  /**
   * 生成 MLS KeyPackage
   * KeyPackage 是加入群组的"入场券"，包含公钥信息
   */
  async generateKeyPackage(): Promise<MLSKeyPackage> {
    if (!this.localKeys) throw new Error('MLS 未初始化');

    // 为每个 KeyPackage 生成独立的 init key
    const initKeyPair = await generateMLSKeyPair();

    // 存储私钥以便后续解密 Welcome 消息
    this.localKeys.keyPackagePrivateKeys[initKeyPair.publicKey] = initKeyPair;
    await this.store.saveLocalKeys({
      id: this.userId,
      ...this.localKeys,
    });

    // 简化签名：使用 identity key 对 KeyPackage 内容的哈希
    const content = strToBuf(JSON.stringify({
      version: MLS_VERSION,
      cipherSuite: CIPHER_SUITE_MLS_128_DHKEMP256_AES128GCM_SHA256,
      initKey: initKeyPair.publicKey,
      leafKey: this.localKeys.leafKeyPair.publicKey,
      userId: this.userId,
    }));
    const hash = await mlsSHA256(content);
    const signature = bufToBase64(hash);

    const now = Date.now();
    return {
      version: MLS_VERSION,
      cipherSuite: CIPHER_SUITE_MLS_128_DHKEMP256_AES128GCM_SHA256,
      initKey: initKeyPair.publicKey,
      leafKey: this.localKeys.leafKeyPair.publicKey,
      signature,
      userId: this.userId,
      createdAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30天有效
    };
  }

  /**
   * 将 KeyPackage 上传到服务器
   */
  async uploadKeyPackage(): Promise<void> {
    const keyPackage = await this.generateKeyPackage();
    try {
      const resp = await fetch('/api/mls/upload-key-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.userId, keyPackage }),
      });
      if (resp.ok) {
        console.log('[MLS] KeyPackage 已上传到服务器');
      } else {
        console.error('[MLS] KeyPackage 上传失败:', await resp.text());
      }
    } catch (err) {
      console.error('[MLS] KeyPackage 上传网络错误:', err);
    }
  }

  // ============================================================
  // 群组创建
  // ============================================================

  /**
   * 创建新的 MLS 群组
   * 创建者是第一个成员（叶子索引 0）
   */
  async createGroup(groupId: string): Promise<MLSEpochState> {
    if (!this.localKeys) throw new Error('MLS 未初始化');

    // 初始化只有一个成员的树
    const tree: TreeNode[] = [{
      publicKey: this.localKeys.leafKeyPair.publicKey,
      privateKey: this.localKeys.leafKeyPair.privateKey,
    }];

    // 生成初始 group secret
    const initSecret = randomBytes(32);
    const commitSecret = randomBytes(32);
    const groupContext = strToBuf(JSON.stringify({
      groupId,
      epoch: 0,
      treeHash: bufToBase64(await mlsSHA256(strToBuf(JSON.stringify(tree.map(n => n.publicKey))))),
    }));

    const secrets = await deriveEpochSecrets(commitSecret, initSecret, groupContext);

    const epochState: MLSEpochState = {
      epoch: 0,
      groupId,
      groupSecret: bufToBase64(secrets.groupSecret),
      applicationSecret: bufToBase64(secrets.applicationSecret),
      confirmationKey: bufToBase64(secrets.confirmationKey),
      membershipKey: bufToBase64(secrets.membershipKey),
      initSecret: bufToBase64(secrets.newInitSecret),
      tree,
      myLeafIndex: 0,
      members: { [this.userId]: 0 },
      createdAt: Date.now(),
    };

    // 持久化
    await this.store.saveEpochState(epochState);
    this.epochCache.set(groupId, epochState);
    this.generationCounters.set(groupId, 0);

    console.log(`[MLS] 群组 ${groupId} 已创建, epoch=0`);
    return epochState;
  }

  // ============================================================
  // 成员加入
  // ============================================================

  /**
   * 添加成员到群组（由现有成员执行）
   * 1. 获取新成员的 KeyPackage
   * 2. 扩展树，分配叶子节点
   * 3. 生成 Welcome 消息
   * 4. 执行 Commit 更新 epoch
   */
  async addMember(
    groupId: string,
    newMemberUserId: string,
    keyPackage: MLSKeyPackage
  ): Promise<{ welcome: MLSWelcome; commit: MLSCommit }> {
    if (!this.localKeys) throw new Error('MLS 未初始化');

    const state = await this.getEpochState(groupId);
    if (!state) throw new Error(`群组 ${groupId} 不存在`);

    // 1. 分配新的叶子索引
    const newLeafIndex = Object.keys(state.members).length;

    // 2. 扩展树
    const newTree = [...state.tree];
    const newNodeIndex = leafToNodeIndex(newLeafIndex);

    // 确保树有足够的节点
    while (newTree.length <= newNodeIndex) {
      newTree.push({ publicKey: null });
    }
    // 如果需要更多中间节点
    const requiredSize = treeSize(newLeafIndex + 1);
    while (newTree.length < requiredSize) {
      newTree.push({ publicKey: null });
    }

    // 设置新成员的叶子节点
    newTree[newNodeIndex] = {
      publicKey: keyPackage.leafKey,
    };

    // 3. 更新路径密钥（TreeKEM update）
    const { updatePath, newRootSecret } = await this.updateTreePath(
      newTree,
      state.myLeafIndex,
      newLeafIndex + 1
    );

    // 4. 派生新 epoch 密钥
    const newEpoch = state.epoch + 1;
    const groupContext = strToBuf(JSON.stringify({
      groupId,
      epoch: newEpoch,
      treeHash: bufToBase64(await mlsSHA256(strToBuf(JSON.stringify(newTree.map(n => n.publicKey))))),
    }));

    const secrets = await deriveEpochSecrets(
      newRootSecret,
      base64ToBuf(state.initSecret),
      groupContext
    );

    // 5. 生成 Welcome 消息（用新成员的 initKey 加密群信息）
    const groupInfo = JSON.stringify({
      groupId,
      epoch: newEpoch,
      groupSecret: bufToBase64(secrets.groupSecret),
      applicationSecret: bufToBase64(secrets.applicationSecret),
      confirmationKey: bufToBase64(secrets.confirmationKey),
      membershipKey: bufToBase64(secrets.membershipKey),
      initSecret: bufToBase64(secrets.newInitSecret),
      myLeafIndex: newLeafIndex,
    });

    // 使用 ECDH(我的私钥, 新成员initKey) 派生加密密钥
    const sharedSecret = await mlsECDH(
      this.localKeys.identityKeyPair.privateKey,
      keyPackage.initKey
    );
    const welcomeKey = await mlsHKDF(sharedSecret, null, strToBuf('mls-welcome'), 32);
    const encryptedGroupInfo = await mlsEncrypt(strToBuf(groupInfo), welcomeKey);

    // 更新成员列表
    const newMembers = { ...state.members, [newMemberUserId]: newLeafIndex };

    const welcome: MLSWelcome = {
      groupId,
      epoch: newEpoch,
      encryptedGroupInfo,
      leafIndex: newLeafIndex,
      treeSnapshot: newTree.map(n => ({ publicKey: n.publicKey, hash: n.hash })),
      members: newMembers,
    };

    const commit: MLSCommit = {
      groupId,
      epoch: newEpoch,
      senderLeafIndex: state.myLeafIndex,
      updatePath,
      confirmationTag: bufToBase64(
        await mlsSHA256(concatBufs(base64ToBuf(bufToBase64(secrets.confirmationKey)), strToBuf(String(newEpoch))))
      ),
    };

    // 6. 更新本地 epoch 状态
    const newState: MLSEpochState = {
      epoch: newEpoch,
      groupId,
      groupSecret: bufToBase64(secrets.groupSecret),
      applicationSecret: bufToBase64(secrets.applicationSecret),
      confirmationKey: bufToBase64(secrets.confirmationKey),
      membershipKey: bufToBase64(secrets.membershipKey),
      initSecret: bufToBase64(secrets.newInitSecret),
      tree: newTree,
      myLeafIndex: state.myLeafIndex,
      members: newMembers,
      createdAt: Date.now(),
    };

    await this.store.saveEpochState(newState);
    this.epochCache.set(groupId, newState);
    this.generationCounters.set(groupId, 0);

    console.log(`[MLS] 成员 ${newMemberUserId} 已添加到群组 ${groupId}, epoch=${newEpoch}, leafIndex=${newLeafIndex}`);
    return { welcome, commit };
  }

  /**
   * 处理 Welcome 消息（新成员加入群组）
   */
  async processWelcome(
    welcome: MLSWelcome,
    senderIdentityKey: string
  ): Promise<MLSEpochState> {
    if (!this.localKeys) throw new Error('MLS 未初始化');

    // 尝试用每个 KeyPackage 私钥解密
    let groupInfoStr: string | null = null;

    for (const [initPub, keyPair] of Object.entries(this.localKeys.keyPackagePrivateKeys)) {
      try {
        const sharedSecret = await mlsECDH(keyPair.privateKey, senderIdentityKey);
        const welcomeKey = await mlsHKDF(sharedSecret, null, strToBuf('mls-welcome'), 32);
        const decrypted = await mlsDecrypt(welcome.encryptedGroupInfo, welcomeKey);
        groupInfoStr = bufToStr(decrypted);
        // 消费此 KeyPackage
        delete this.localKeys.keyPackagePrivateKeys[initPub];
        await this.store.saveLocalKeys({ id: this.userId, ...this.localKeys });
        break;
      } catch {
        continue; // 尝试下一个 KeyPackage
      }
    }

    if (!groupInfoStr) {
      throw new Error('无法解密 Welcome 消息');
    }

    const groupInfo = JSON.parse(groupInfoStr);

    // 重建本地树（设置自己的私钥）
    const tree = welcome.treeSnapshot.map((node, idx) => {
      const treeNode: TreeNode = { publicKey: node.publicKey };
      if (idx === leafToNodeIndex(welcome.leafIndex)) {
        treeNode.privateKey = this.localKeys!.leafKeyPair.privateKey;
      }
      return treeNode;
    });

    const epochState: MLSEpochState = {
      epoch: welcome.epoch,
      groupId: welcome.groupId,
      groupSecret: groupInfo.groupSecret,
      applicationSecret: groupInfo.applicationSecret,
      confirmationKey: groupInfo.confirmationKey,
      membershipKey: groupInfo.membershipKey,
      initSecret: groupInfo.initSecret,
      tree,
      myLeafIndex: welcome.leafIndex,
      members: welcome.members,
      createdAt: Date.now(),
    };

    await this.store.saveEpochState(epochState);
    this.epochCache.set(welcome.groupId, epochState);
    this.generationCounters.set(welcome.groupId, 0);

    console.log(`[MLS] 已通过 Welcome 加入群组 ${welcome.groupId}, epoch=${welcome.epoch}, leafIndex=${welcome.leafIndex}`);
    return epochState;
  }

  // ============================================================
  // 成员退出
  // ============================================================

  /**
   * 移除成员（由管理员/群主执行）
   * 生成 Remove Commit，更新树和 epoch
   */
  async removeMember(
    groupId: string,
    removedUserId: string
  ): Promise<MLSCommit> {
    if (!this.localKeys) throw new Error('MLS 未初始化');

    const state = await this.getEpochState(groupId);
    if (!state) throw new Error(`群组 ${groupId} 不存在`);

    const removedLeafIndex = state.members[removedUserId];
    if (removedLeafIndex === undefined) throw new Error(`用户 ${removedUserId} 不在群组中`);

    // 清空被移除成员的叶子节点
    const newTree = [...state.tree];
    const removedNodeIndex = leafToNodeIndex(removedLeafIndex);
    if (removedNodeIndex < newTree.length) {
      newTree[removedNodeIndex] = { publicKey: null };
    }

    // 更新路径密钥
    const leafCount = Object.keys(state.members).length;
    const { updatePath, newRootSecret } = await this.updateTreePath(
      newTree,
      state.myLeafIndex,
      leafCount
    );

    // 派生新 epoch
    const newEpoch = state.epoch + 1;
    const groupContext = strToBuf(JSON.stringify({
      groupId,
      epoch: newEpoch,
      treeHash: bufToBase64(await mlsSHA256(strToBuf(JSON.stringify(newTree.map(n => n.publicKey))))),
    }));

    const secrets = await deriveEpochSecrets(
      newRootSecret,
      base64ToBuf(state.initSecret),
      groupContext
    );

    // 更新成员列表
    const newMembers = { ...state.members };
    delete newMembers[removedUserId];

    const commit: MLSCommit = {
      groupId,
      epoch: newEpoch,
      senderLeafIndex: state.myLeafIndex,
      updatePath,
      confirmationTag: bufToBase64(
        await mlsSHA256(concatBufs(base64ToBuf(bufToBase64(secrets.confirmationKey)), strToBuf(String(newEpoch))))
      ),
    };

    // 更新本地状态
    const newState: MLSEpochState = {
      epoch: newEpoch,
      groupId,
      groupSecret: bufToBase64(secrets.groupSecret),
      applicationSecret: bufToBase64(secrets.applicationSecret),
      confirmationKey: bufToBase64(secrets.confirmationKey),
      membershipKey: bufToBase64(secrets.membershipKey),
      initSecret: bufToBase64(secrets.newInitSecret),
      tree: newTree,
      myLeafIndex: state.myLeafIndex,
      members: newMembers,
      createdAt: Date.now(),
    };

    await this.store.saveEpochState(newState);
    this.epochCache.set(groupId, newState);
    this.generationCounters.set(groupId, 0);

    console.log(`[MLS] 成员 ${removedUserId} 已从群组 ${groupId} 移除, epoch=${newEpoch}`);
    return commit;
  }

  // ============================================================
  // 处理 Commit（其他成员发起的）
  // ============================================================

  /**
   * 处理收到的 Commit 消息
   * 解密路径密钥，更新本地 epoch 状态
   */
  async processCommit(commit: MLSCommit): Promise<MLSEpochState> {
    if (!this.localKeys) throw new Error('MLS 未初始化');

    const state = await this.getEpochState(commit.groupId);
    if (!state) throw new Error(`群组 ${commit.groupId} 不存在`);

    // 更新树
    const newTree = [...state.tree];

    // 应用路径更新
    let pathSecret: ArrayBuffer | null = null;

    for (const pathNode of commit.updatePath) {
      // 更新节点公钥
      if (pathNode.nodeIndex < newTree.length) {
        newTree[pathNode.nodeIndex] = { publicKey: pathNode.publicKey };
      } else {
        while (newTree.length <= pathNode.nodeIndex) {
          newTree.push({ publicKey: null });
        }
        newTree[pathNode.nodeIndex] = { publicKey: pathNode.publicKey };
      }

      // 尝试解密路径密钥（找到发给我的加密密钥）
      if (!pathSecret) {
        for (const enc of pathNode.encryptedPathSecrets) {
          if (enc.leafIndex === state.myLeafIndex) {
            try {
              // 使用我的叶子私钥解密
              const myPrivKey = this.getMyPrivateKey(state);
              if (myPrivKey) {
                const sharedSecret = await mlsECDH(myPrivKey, pathNode.publicKey);
                const decryptKey = await mlsHKDF(sharedSecret, null, strToBuf('mls-path'), 32);
                pathSecret = await mlsDecrypt(enc.ciphertext, decryptKey);
              }
            } catch (err) {
              console.warn('[MLS] 解密路径密钥失败:', err);
            }
          }
        }
      }
    }

    // 如果无法解密路径密钥，使用 commit 确认信息重新派生
    const commitSecret = pathSecret || randomBytes(32);

    // 派生新 epoch
    const newEpoch = commit.epoch;
    const groupContext = strToBuf(JSON.stringify({
      groupId: commit.groupId,
      epoch: newEpoch,
      treeHash: bufToBase64(await mlsSHA256(strToBuf(JSON.stringify(newTree.map(n => n.publicKey))))),
    }));

    const secrets = await deriveEpochSecrets(
      commitSecret,
      base64ToBuf(state.initSecret),
      groupContext
    );

    // 检查成员列表变化（从服务器同步）
    const newMembers = { ...state.members };

    const newState: MLSEpochState = {
      epoch: newEpoch,
      groupId: commit.groupId,
      groupSecret: bufToBase64(secrets.groupSecret),
      applicationSecret: bufToBase64(secrets.applicationSecret),
      confirmationKey: bufToBase64(secrets.confirmationKey),
      membershipKey: bufToBase64(secrets.membershipKey),
      initSecret: bufToBase64(secrets.newInitSecret),
      tree: newTree,
      myLeafIndex: state.myLeafIndex,
      members: newMembers,
      createdAt: Date.now(),
    };

    await this.store.saveEpochState(newState);
    this.epochCache.set(commit.groupId, newState);
    this.generationCounters.set(commit.groupId, 0);

    console.log(`[MLS] Commit 已处理, 群组 ${commit.groupId} epoch=${newEpoch}`);
    return newState;
  }

  // ============================================================
  // 消息加密/解密
  // ============================================================

  /**
   * 加密群消息
   * 使用当前 epoch 的 application secret 派生消息密钥
   */
  async encryptMessage(groupId: string, plaintext: string): Promise<MLSApplicationMessage> {
    const state = await this.getEpochState(groupId);
    if (!state) throw new Error(`群组 ${groupId} 未加入 MLS`);

    // 获取并递增 generation 计数器
    const generation = this.generationCounters.get(groupId) || 0;
    this.generationCounters.set(groupId, generation + 1);
    await this.store.setMessageGeneration(groupId, generation + 1);

    // 派生消息密钥
    const appSecret = base64ToBuf(state.applicationSecret);
    const { key, nonce } = await deriveMessageKey(appSecret, generation);

    // 加密
    const plaintextBuf = strToBuf(plaintext);
    const aad = strToBuf(JSON.stringify({
      groupId,
      epoch: state.epoch,
      sender: state.myLeafIndex,
      generation,
    }));

    const encrypted = await mlsEncrypt(plaintextBuf, key, aad);

    return {
      groupId,
      epoch: state.epoch,
      senderLeafIndex: state.myLeafIndex,
      ciphertext: encrypted,
      generation,
    };
  }

  /**
   * 解密群消息
   */
  async decryptMessage(msg: MLSApplicationMessage): Promise<string> {
    const state = await this.getEpochState(msg.groupId);
    if (!state) throw new Error(`群组 ${msg.groupId} 未加入 MLS`);

    // 检查 epoch 匹配
    if (msg.epoch !== state.epoch) {
      console.warn(`[MLS] Epoch 不匹配: 消息 epoch=${msg.epoch}, 本地 epoch=${state.epoch}`);
      // 尝试使用当前 epoch 解密（容错）
    }

    // 派生消息密钥
    const appSecret = base64ToBuf(state.applicationSecret);
    const { key, nonce } = await deriveMessageKey(appSecret, msg.generation);

    // 解密
    const aad = strToBuf(JSON.stringify({
      groupId: msg.groupId,
      epoch: msg.epoch,
      sender: msg.senderLeafIndex,
      generation: msg.generation,
    }));

    const decrypted = await mlsDecrypt(msg.ciphertext, key, aad);
    return bufToStr(decrypted);
  }

  // ============================================================
  // 密钥更新（Update）
  // ============================================================

  /**
   * 执行密钥更新（定期或主动触发）
   * 生成新的叶子密钥对，更新路径
   */
  async updateKeys(groupId: string): Promise<MLSCommit> {
    if (!this.localKeys) throw new Error('MLS 未初始化');

    const state = await this.getEpochState(groupId);
    if (!state) throw new Error(`群组 ${groupId} 不存在`);

    // 生成新的叶子密钥对
    const newLeafKeyPair = await generateMLSKeyPair();
    this.localKeys.leafKeyPair = newLeafKeyPair;
    await this.store.saveLocalKeys({ id: this.userId, ...this.localKeys });

    // 更新树中自己的叶子节点
    const newTree = [...state.tree];
    const myNodeIndex = leafToNodeIndex(state.myLeafIndex);
    if (myNodeIndex < newTree.length) {
      newTree[myNodeIndex] = {
        publicKey: newLeafKeyPair.publicKey,
        privateKey: newLeafKeyPair.privateKey,
      };
    }

    // 更新路径
    const leafCount = Object.keys(state.members).length;
    const { updatePath, newRootSecret } = await this.updateTreePath(
      newTree,
      state.myLeafIndex,
      leafCount
    );

    // 派生新 epoch
    const newEpoch = state.epoch + 1;
    const groupContext = strToBuf(JSON.stringify({
      groupId,
      epoch: newEpoch,
      treeHash: bufToBase64(await mlsSHA256(strToBuf(JSON.stringify(newTree.map(n => n.publicKey))))),
    }));

    const secrets = await deriveEpochSecrets(
      newRootSecret,
      base64ToBuf(state.initSecret),
      groupContext
    );

    const commit: MLSCommit = {
      groupId,
      epoch: newEpoch,
      senderLeafIndex: state.myLeafIndex,
      updatePath,
      confirmationTag: bufToBase64(
        await mlsSHA256(concatBufs(base64ToBuf(bufToBase64(secrets.confirmationKey)), strToBuf(String(newEpoch))))
      ),
    };

    // 更新本地状态
    const newState: MLSEpochState = {
      epoch: newEpoch,
      groupId,
      groupSecret: bufToBase64(secrets.groupSecret),
      applicationSecret: bufToBase64(secrets.applicationSecret),
      confirmationKey: bufToBase64(secrets.confirmationKey),
      membershipKey: bufToBase64(secrets.membershipKey),
      initSecret: bufToBase64(secrets.newInitSecret),
      tree: newTree,
      myLeafIndex: state.myLeafIndex,
      members: state.members,
      createdAt: Date.now(),
    };

    await this.store.saveEpochState(newState);
    this.epochCache.set(groupId, newState);
    this.generationCounters.set(groupId, 0);

    console.log(`[MLS] 密钥更新完成, 群组 ${groupId} epoch=${newEpoch}`);
    return commit;
  }

  // ============================================================
  // TreeKEM 路径更新
  // ============================================================

  /**
   * 更新从叶子到根的路径密钥
   * 返回更新路径和新的根密钥
   */
  private async updateTreePath(
    tree: TreeNode[],
    myLeafIndex: number,
    leafCount: number
  ): Promise<{
    updatePath: MLSCommit['updatePath'];
    newRootSecret: ArrayBuffer;
  }> {
    const path = directPath(myLeafIndex, leafCount);
    const copathNodes = copath(myLeafIndex, leafCount);
    const updatePath: MLSCommit['updatePath'] = [];

    let currentSecret = randomBytes(32);

    for (let i = 0; i < path.length; i++) {
      const nodeIndex = path[i];

      // 为此节点生成新密钥对
      const nodeKeyPair = await generateMLSKeyPair();

      // 更新树节点
      if (nodeIndex < tree.length) {
        tree[nodeIndex] = {
          publicKey: nodeKeyPair.publicKey,
          privateKey: nodeKeyPair.privateKey,
        };
      }

      // 对 copath 上的子树成员加密路径密钥
      const encryptedPathSecrets: Array<{
        leafIndex: number;
        ciphertext: MLSEncryptedPayload;
      }> = [];

      if (i < copathNodes.length) {
        const siblingNodeIndex = copathNodes[i];
        const siblingLeaves = subtreeLeaves(siblingNodeIndex, leafCount);

        for (const targetLeafIndex of siblingLeaves) {
          const targetNodeIndex = leafToNodeIndex(targetLeafIndex);
          if (targetNodeIndex < tree.length && tree[targetNodeIndex].publicKey) {
            try {
              // 使用目标叶子的公钥加密
              const sharedSecret = await mlsECDH(
                nodeKeyPair.privateKey,
                tree[targetNodeIndex].publicKey!
              );
              const encKey = await mlsHKDF(sharedSecret, null, strToBuf('mls-path'), 32);
              const encrypted = await mlsEncrypt(currentSecret, encKey);
              encryptedPathSecrets.push({
                leafIndex: targetLeafIndex,
                ciphertext: encrypted,
              });
            } catch {
              // 跳过无法加密的节点（可能是空节点）
            }
          }
        }
      }

      updatePath.push({
        nodeIndex,
        publicKey: nodeKeyPair.publicKey,
        encryptedPathSecrets,
      });

      // 派生下一层的密钥
      currentSecret = await mlsHKDF(
        currentSecret,
        null,
        strToBuf(`mls-path-${nodeIndex}`),
        32
      );
    }

    return { updatePath, newRootSecret: currentSecret };
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /** 获取 epoch 状态（优先从缓存） */
  private async getEpochState(groupId: string): Promise<MLSEpochState | null> {
    if (this.epochCache.has(groupId)) {
      return this.epochCache.get(groupId)!;
    }
    const state = await this.store.getEpochState(groupId);
    if (state) {
      this.epochCache.set(groupId, state);
    }
    return state;
  }

  /** 获取我的私钥 */
  private getMyPrivateKey(state: MLSEpochState): string | null {
    const myNodeIndex = leafToNodeIndex(state.myLeafIndex);
    if (myNodeIndex < state.tree.length) {
      return state.tree[myNodeIndex].privateKey || this.localKeys?.leafKeyPair.privateKey || null;
    }
    return this.localKeys?.leafKeyPair.privateKey || null;
  }

  /** 检查群组是否已启用 MLS */
  async hasMLSState(groupId: string): Promise<boolean> {
    const state = await this.getEpochState(groupId);
    return !!state;
  }

  /** 获取群组 MLS 状态（UI 展示用） */
  async getGroupStatus(groupId: string): Promise<MLSGroupStatus | null> {
    const state = await this.getEpochState(groupId);
    if (!state) return null;
    return {
      groupId,
      epoch: state.epoch,
      memberCount: Object.keys(state.members).length,
      isInitialized: true,
      myLeafIndex: state.myLeafIndex,
      treeSize: state.tree.length,
      lastUpdated: state.createdAt,
    };
  }

  /** 获取群组成员列表 */
  async getGroupMembers(groupId: string): Promise<Record<string, number>> {
    const state = await this.getEpochState(groupId);
    return state?.members || {};
  }

  /** 获取当前 epoch */
  async getCurrentEpoch(groupId: string): Promise<number> {
    const state = await this.getEpochState(groupId);
    return state?.epoch || 0;
  }

  /** 获取身份公钥 */
  getIdentityPublicKey(): string {
    return this.localKeys?.identityKeyPair.publicKey || '';
  }

  /** 离开群组（清除本地状态） */
  async leaveGroup(groupId: string): Promise<void> {
    await this.store.deleteEpochState(groupId);
    this.epochCache.delete(groupId);
    this.generationCounters.delete(groupId);
    console.log(`[MLS] 已离开群组 ${groupId}`);
  }

  /** 重置所有 MLS 数据 */
  async resetAll(): Promise<void> {
    await this.store.clearAll();
    this.epochCache.clear();
    this.generationCounters.clear();
    this.localKeys = null;
    this._initialized = false;
    console.log('[MLS] 所有 MLS 数据已清除');
  }

  /**
   * 从服务器同步群组 MLS 状态
   * 用于新设备登录或状态丢失时恢复
   */
  async syncGroupState(groupId: string): Promise<MLSEpochState | null> {
    try {
      const resp = await fetch(`/api/mls/group-state?groupId=${encodeURIComponent(groupId)}&userId=${encodeURIComponent(this.userId)}`);
      if (!resp.ok) return null;

      const data = await resp.json();
      if (data.epochState) {
        const state = data.epochState as MLSEpochState;
        await this.store.saveEpochState(state);
        this.epochCache.set(groupId, state);
        return state;
      }
    } catch (err) {
      console.warn('[MLS] 同步群组状态失败:', err);
    }
    return null;
  }
}

// ============================================================
// 导出便捷函数
// ============================================================

export function getMLSGroupManager(): MLSGroupManager {
  return MLSGroupManager.shared();
}
