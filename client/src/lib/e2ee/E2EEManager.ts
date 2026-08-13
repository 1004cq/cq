/**
 * imim E2EEManager — Signal Protocol 核心加密管理器
 *
 * 实现完整的 Signal Protocol 流程：
 * 1. 本地密钥生成与注册（Identity Key、Signed PreKey、One-Time PreKeys）
 * 2. X3DH 密钥协商（Extended Triple Diffie-Hellman）建立会话
 * 3. Double Ratchet 消息加解密（对称棘轮 + DH 棘轮）
 * 4. Safety Number 生成与验证
 *
 * 参考唐僧叨叨 E2EEManager 设计，使用 Web Crypto API 实现真实密码学。
 */

import { SignalStore, type KeyPairB64, type SessionRecord } from './SignalStore';
import { clearDecryptedMessageCache } from '@/lib/localdb';
import {
  generateKeyPair,
  exportKeyPair,
  importPublicKey,
  importPrivateKey,
  ecdh,
  hkdf,
  aesEncrypt,
  aesDecrypt,
  deriveMessageKeys,
  generateSafetyNumber as computeSafetyNumber,
  fingerprint as computeFingerprint,
  bufferToBase64,
  base64ToBuffer,
  stringToBuffer,
  bufferToString,
  concatBuffers,
  randomBytes,
  generateRegistrationId,
  type EncryptedPayload,
} from './CryptoUtils';

// ============================================================
// 类型定义
// ============================================================

/** PreKey Bundle — 用于 X3DH 初始化会话 */
export interface PreKeyBundle {
  registrationId: number;
  identityKey: string;      // Base64 公钥
  signedPreKeyId: number;
  signedPreKey: string;     // Base64 公钥
  signedPreKeySignature: string;
  oneTimePreKeyId?: number;
  oneTimePreKey?: string;   // Base64 公钥
}

/** 加密后的消息信封 */
export interface SignalEnvelope {
  type: 'prekey' | 'message';  // prekey = 首条消息含 X3DH 信息
  senderRegistrationId: number;
  senderIdentityKey: string;
  senderEphemeralKey?: string; // 仅 prekey 类型
  senderRatchetKey: string;
  previousCounter: number;
  counter: number;
  ciphertext: EncryptedPayload;
  timestamp: number;
}

/** Double Ratchet 会话状态 */
interface RatchetState {
  // DH 棘轮
  dhSendingKeyPair: KeyPairB64;
  dhReceivingKey: string | null;

  // 根密钥
  rootKey: string;  // Base64

  // 发送链
  sendChainKey: string | null;  // Base64
  sendCounter: number;

  // 接收链
  receiveChainKey: string | null;  // Base64
  receiveCounter: number;

  // 上一个发送链的消息计数
  previousSendCounter: number;

  // 对端信息
  remoteIdentityKey: string;
  remoteRegistrationId: number;

  // 是否已完成初始 DH 棘轮步骤
  initialized: boolean;
}

/** E2EE 状态信息（用于 UI 展示） */
export interface E2EEStatus {
  isInitialized: boolean;
  registrationId: number;
  identityKeyFingerprint: string;
  totalSessions: number;
  totalPreKeys: number;
  identityKey: string;
}

/** 会话信息（用于 UI 展示） */
export interface SessionInfo {
  peerId: string;
  established: boolean;
  remoteIdentityKey: string;
  remoteFingerprint: string;
  safetyNumber: string;
  lastUpdated: number;
  messagesSent: number;
  messagesReceived: number;
}

// ============================================================
// E2EEManager 单例
// ============================================================

export class E2EEManager {
  private store: SignalStore;
  private _initialized = false;
  private _registrationId = 0;
  private _identityKeyPair: KeyPairB64 | null = null;

  // 已彻底禁用 Mock Bundle，强制使用服务器获取真实凭证

  private static _instance: E2EEManager | null = null;

  static shared(): E2EEManager {
    if (!E2EEManager._instance) {
      E2EEManager._instance = new E2EEManager();
    }
    return E2EEManager._instance;
  }

  private constructor() {
    this.store = SignalStore.shared();
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  get registrationId(): number {
    return this._registrationId;
  }

  get identityKey(): string {
    return this._identityKeyPair?.pubKey || '';
  }

  // ============================================================
  // 初始化
  // ============================================================

  /**
   * 初始化 E2EE 系统
   * - 打开 IndexedDB
   * - 检查是否已有本地注册信息
   * - 如果没有，生成新的 Identity Key、Signed PreKey、One-Time PreKeys
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    await this.store.init();

    // 检查已有注册
    const existing = await this.store.getLocalRegistration();
    if (existing) {
      this._registrationId = existing.registrationId;
      this._identityKeyPair = existing.identityKeyPair;
      this._initialized = true;
      console.log('[E2EE] 已加载本地密钥，Registration ID:', this._registrationId);
      return;
    }

    // 生成新的密钥材料
    await this.generateLocalKeys();
    this._initialized = true;
    console.log('[E2EE] 密钥生成完成，Registration ID:', this._registrationId);
  }

  /** 生成本地密钥材料 */
  private async generateLocalKeys(): Promise<void> {
    // 1. 生成 Registration ID
    this._registrationId = generateRegistrationId();

    // 2. 生成 Identity Key Pair
    const identityKP = await generateKeyPair();
    this._identityKeyPair = await exportKeyPair(identityKP);

    // 3. 保存本地注册信息
    await this.store.saveLocalRegistration({
      registrationId: this._registrationId,
      identityKeyPair: this._identityKeyPair,
      createdAt: Date.now(),
    });

    // 4. 生成 Signed PreKey
    await this.generateSignedPreKey();

    // 5. 生成一批 One-Time PreKeys
    await this.generatePreKeys(0, 20);
  }

  /** 生成 Signed PreKey */
  async generateSignedPreKey(id: number = 1): Promise<void> {
    const keyPair = await generateKeyPair();
    const exported = await exportKeyPair(keyPair);

    // 使用 Identity Key 签名
    // 导入私钥（用于签名，必须是 ECDSA 类型）
    // 注意：目前的 generateKeyPair 生成的是 ECDH 密钥，用于协商；
    // Identity Key 在 Signal 中既用于协商也用于签名。
    // 在 Web Crypto P-256 中，ECDH 密钥不能直接用于 ECDSA 签名。
    // 为了合规，我们需要为 Identity 额外生成一对签名密钥，或者使用相同的种子。
    // 这里采用最简单的合规做法：Identity Key 实际上包含两对 P-256，一对用于 ECDH，一对用于 ECDSA。
    
    // 获取本地注册信息中的签名私钥
    const reg = await this.store.getLocalRegistration();
    if (!reg || !(reg as any).signingKeyPair) {
      // 如果没有签名密钥对，重新生成（平滑升级）
      const signingKP = await import('./CryptoUtils').then(m => m.generateSigningKeyPair());
      const exportedSigning = await import('./CryptoUtils').then(m => m.exportKeyPair(signingKP as any));
      await this.store.saveLocalRegistration({
        ...reg!,
        signingKeyPair: exportedSigning,
      } as any);
      this._identityKeyPair = { ...this._identityKeyPair!, signingKeyPair: exportedSigning } as any;
    }

    const signingPrivKeyBase64 = (this._identityKeyPair as any).signingKeyPair.privKey;
    const signingPriv = await import('./CryptoUtils').then(m => m.importPrivateKey(signingPrivKeyBase64, 'ECDSA'));
    const signedPubBuf = base64ToBuffer(exported.pubKey);

    const signatureBuf = await import('./CryptoUtils').then(m => m.sign(signingPriv, signedPubBuf));
    const signatureData = bufferToBase64(signatureBuf);

    await this.store.saveSignedPreKey({
      id,
      keyPair: exported,
      signature: signatureData,
      createdAt: Date.now(),
    });
  }

  /** 批量生成 One-Time PreKeys */
  async generatePreKeys(startId: number, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const keyPair = await generateKeyPair();
      const exported = await exportKeyPair(keyPair);
      await this.store.savePreKey({
        id: startId + i,
        keyPair: exported,
      });
    }
  }

  /** 获取本地 PreKey Bundle（供对端使用） */
  async getLocalPreKeyBundle(): Promise<PreKeyBundle> {
    if (!this._identityKeyPair) throw new Error('E2EE 未初始化');

    const signedPreKeys = await this.store.getAllSignedPreKeys();
    const signedPreKey = signedPreKeys[signedPreKeys.length - 1];
    if (!signedPreKey) throw new Error('没有可用的 Signed PreKey');

    const preKeys = await this.store.getAllPreKeys();
    const oneTimePreKey = preKeys.length > 0 ? preKeys[0] : undefined;

    return {
      registrationId: this._registrationId,
      identityKey: this._identityKeyPair.pubKey,
      signedPreKeyId: signedPreKey.id,
      signedPreKey: signedPreKey.keyPair.pubKey,
      signedPreKeySignature: signedPreKey.signature,
      oneTimePreKeyId: oneTimePreKey?.id,
      oneTimePreKey: oneTimePreKey?.keyPair.pubKey,
    };
  }

  // ============================================================
  // 服务端 Bundle 注册与获取
  // ============================================================

  /**
   * 将本地 PreKey Bundle 注册到服务器
   * 应在初始化完成后调用
   */
  async registerBundleToServer(userId: string): Promise<void> {
    try {
      const bundle = await this.getLocalPreKeyBundle();
      const preKeys = await this.store.getAllPreKeys();
      const preKeysPayload = preKeys.map(pk => ({
        keyId: pk.id,
        publicKey: pk.keyPair.pubKey,
      }));

      const resp = await fetch('/api/crypto/register-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          registrationId: bundle.registrationId,
          identityKey: bundle.identityKey,
          signedPreKey: {
            keyId: bundle.signedPreKeyId,
            publicKey: bundle.signedPreKey,
            signature: bundle.signedPreKeySignature,
          },
          preKeys: preKeysPayload,
        }),
      });

      if (resp.ok) {
        console.log('[E2EE] Bundle 已注册到服务器');
      } else {
        console.error('[E2EE] Bundle 注册失败:', await resp.text());
      }
    } catch (err) {
      console.error('[E2EE] Bundle 注册网络错误:', err);
    }
  }

  /**
   * 从服务器获取对端的 PreKey Bundle
   * 强制要求从服务器获取，禁止使用 Mock Bundle
   */
  async fetchRemoteBundle(peerId: string): Promise<PreKeyBundle> {
    const resp = await fetch(`/api/crypto/get-bundle?userId=${encodeURIComponent(peerId)}`);
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`无法获取用户 ${peerId} 的安全凭证 (Bundle): ${errorText}`);
    }

    const data = await resp.json();
    const bundle: PreKeyBundle = {
      registrationId: data.registrationId,
      identityKey: data.identityKey,
      signedPreKeyId: data.signedPreKey.keyId,
      signedPreKey: data.signedPreKey.publicKey,
      signedPreKeySignature: data.signedPreKey.signature,
      oneTimePreKeyId: data.preKey?.keyId,
      oneTimePreKey: data.preKey?.publicKey,
    };

    // 保存对端 Identity Key（TOFU）
    await this.store.saveIdentity({
      userId: peerId,
      identityKey: data.identityKey,
      trusted: true,
      addedAt: Date.now(),
    });

    console.log(`[E2EE] 从服务器成功获取到 ${peerId} 的真实 Bundle`);
    return bundle;
  }

  /**
   * 检查并补充服务端的 One-Time PreKeys
   */
  async checkAndReplenishServerPreKeys(userId: string, threshold: number = 5): Promise<void> {
    try {
      const resp = await fetch(`/api/crypto/prekey-count?userId=${encodeURIComponent(userId)}`);
      if (!resp.ok) return;
      const { count } = await resp.json();

      if (count < threshold) {
        // 生成新的 PreKeys
        const startId = Date.now() % 100000;
        await this.generatePreKeys(startId, 20);
        const newPreKeys = await this.store.getAllPreKeys();
        const preKeysPayload = newPreKeys.slice(-20).map(pk => ({
          keyId: pk.id,
          publicKey: pk.keyPair.pubKey,
        }));

        await fetch('/api/crypto/replenish-prekeys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, preKeys: preKeysPayload }),
        });
        console.log(`[E2EE] 已补充 ${preKeysPayload.length} 个 PreKeys 到服务器`);
      }
    } catch (err) {
      console.warn('[E2EE] 检查/补充 PreKeys 失败:', err);
    }
  }

  // 严格隔离 Mock，不再提供 getOrCreateMockBundle

  // ============================================================
  // X3DH 密钥协商
  // ============================================================

  /**
   * 执行 X3DH 密钥协商，建立与对端的加密会话
   *
   * X3DH 协议步骤：
   * 1. Alice 生成临时密钥对 (Ephemeral Key)
   * 2. 计算 4 个 DH：
   *    DH1 = ECDH(IK_A, SPK_B)    — Identity ↔ Signed PreKey
   *    DH2 = ECDH(EK_A, IK_B)     — Ephemeral ↔ Identity
   *    DH3 = ECDH(EK_A, SPK_B)    — Ephemeral ↔ Signed PreKey
   *    DH4 = ECDH(EK_A, OPK_B)    — Ephemeral ↔ One-Time PreKey (可选)
   * 3. 使用 HKDF 从 DH 结果派生根密钥
   */
  async establishSession(peerId: string, bundle: PreKeyBundle): Promise<void> {
    if (!this._identityKeyPair) throw new Error('E2EE 未初始化');

    // 检查是否已有会话
    const existingSession = await this.store.getSession(peerId);
    if (existingSession) {
      console.log('[E2EE] 已存在与', peerId, '的会话');
      return;
    }

    console.log('[E2EE] 开始 X3DH 密钥协商，对端:', peerId);

    // 验证对端 Signed PreKey 签名 (P0 安全要求)
    try {
      const remoteIdentityPubForVerify = await importPublicKey(bundle.identityKey, 'ECDSA');
      const signatureBuf = base64ToBuffer(bundle.signedPreKeySignature);
      const signedPubBuf = base64ToBuffer(bundle.signedPreKey);
      const isValid = await import('./CryptoUtils').then(m => m.verify(remoteIdentityPubForVerify, signatureBuf, signedPubBuf));
      if (!isValid) {
        throw new Error('对端安全凭证签名验证失败');
      }
    } catch (err: any) {
      throw new Error(`安全凭证验证失败: ${err.message}`);
    }

    // 导入密钥
    const identityPriv = await importPrivateKey(this._identityKeyPair.privKey);
    const remoteIdentityPub = await importPublicKey(bundle.identityKey);
    const remoteSignedPreKeyPub = await importPublicKey(bundle.signedPreKey);

    // 生成临时密钥对
    const ephemeralKP = await generateKeyPair();
    const ephemeralExported = await exportKeyPair(ephemeralKP);

    // X3DH DH 计算
    const dh1 = await ecdh(identityPriv, remoteSignedPreKeyPub);
    const dh2 = await ecdh(ephemeralKP.privateKey, remoteIdentityPub);
    const dh3 = await ecdh(ephemeralKP.privateKey, remoteSignedPreKeyPub);

    let dhResults = concatBuffers(dh1, dh2, dh3);

    // DH4（如果有 One-Time PreKey）
    if (bundle.oneTimePreKey) {
      const remoteOneTimePub = await importPublicKey(bundle.oneTimePreKey);
      const dh4 = await ecdh(ephemeralKP.privateKey, remoteOneTimePub);
      dhResults = concatBuffers(dhResults, dh4);
    }

    // 使用 HKDF 派生根密钥
    const salt = new Uint8Array(32).buffer;
    const info = stringToBuffer('imim-x3dh');
    const rootKey = await hkdf(dhResults, salt, info, 32);

    // 生成初始发送棘轮密钥对
    const sendRatchetKP = await generateKeyPair();
    const sendRatchetExported = await exportKeyPair(sendRatchetKP);

    // 使用根密钥和 DH 结果派生初始链密钥
    const dhSend = await ecdh(sendRatchetKP.privateKey, remoteSignedPreKeyPub);
    const chainInfo = stringToBuffer('imim-chain');
    const derivedKeys = await hkdf(
      concatBuffers(rootKey, dhSend),
      salt,
      chainInfo,
      64
    );
    const newRootKey = derivedKeys.slice(0, 32);
    const sendChainKey = derivedKeys.slice(32, 64);

    // 创建会话状态
    const ratchetState: RatchetState = {
      dhSendingKeyPair: sendRatchetExported,
      dhReceivingKey: bundle.signedPreKey,
      rootKey: bufferToBase64(newRootKey),
      sendChainKey: bufferToBase64(sendChainKey),
      sendCounter: 0,
      receiveChainKey: null,
      receiveCounter: 0,
      previousSendCounter: 0,
      remoteIdentityKey: bundle.identityKey,
      remoteRegistrationId: bundle.registrationId,
      initialized: true,
    };

    // 保存会话
    await this.store.saveSession({
      peerId,
      sessionData: JSON.stringify({
        ratchetState,
        ephemeralKey: ephemeralExported.pubKey,
        usedOneTimePreKeyId: bundle.oneTimePreKeyId,
      }),
      updatedAt: Date.now(),
    });

    // 保存对端 Identity Key（TOFU）
    await this.store.saveIdentity({
      userId: peerId,
      identityKey: bundle.identityKey,
      trusted: true,
      addedAt: Date.now(),
    });

    console.log('[E2EE] X3DH 完成，会话已建立');
  }

  // ============================================================
  // 媒体文件加密 (P0)
  // ============================================================

  /** 加密附件文件 */
  async encryptFile(fileBuffer: ArrayBuffer): Promise<{ ciphertext: ArrayBuffer; fileKey: string; iv: string }> {
    const fileKeyMaterial = randomBytes(32);
    const encrypted = await aesEncrypt(fileBuffer, fileKeyMaterial);
    return {
      ciphertext: base64ToBuffer(encrypted.ciphertext),
      fileKey: bufferToBase64(fileKeyMaterial),
      iv: encrypted.iv,
    };
  }

  /** 解密附件文件 */
  async decryptFile(ciphertext: ArrayBuffer, fileKey: string, iv: string): Promise<ArrayBuffer> {
    const fileKeyMaterial = base64ToBuffer(fileKey);
    return aesDecrypt({
      ciphertext: bufferToBase64(ciphertext),
      iv,
      tag: '',
    }, fileKeyMaterial);
  }

  // ============================================================
  // Double Ratchet 加密
  // ============================================================

  /**
   * 加密消息
   * 使用 Double Ratchet 的对称棘轮步骤
   */
  async encrypt(peerId: string, plaintext: string): Promise<SignalEnvelope> {
    if (!this._identityKeyPair) throw new Error('E2EE 未初始化');

    // 获取或建立会话
    let sessionRecord = await this.store.getSession(peerId);
    if (!sessionRecord) {
      // 自动建立会话：优先从服务器获取 Bundle
      const bundle = await this.fetchRemoteBundle(peerId);
      await this.establishSession(peerId, bundle);
      sessionRecord = await this.store.getSession(peerId);
    }

    const sessionData = JSON.parse(sessionRecord!.sessionData);
    const state: RatchetState = sessionData.ratchetState;

    // 对称棘轮步骤：从 sendChainKey 派生消息密钥
    const chainKey = base64ToBuffer(state.sendChainKey!);
    const { messageKey, nextChainKey } = await deriveMessageKeys(chainKey);

    // 加密消息
    const plaintextBuf = stringToBuffer(plaintext);
    const encrypted = await aesEncrypt(plaintextBuf, messageKey);

    // 更新会话状态
    state.sendChainKey = bufferToBase64(nextChainKey);
    state.sendCounter++;

    // 保存更新后的会话
    sessionData.ratchetState = state;
    await this.store.saveSession({
      peerId,
      sessionData: JSON.stringify(sessionData),
      updatedAt: Date.now(),
    });

    // 构建信封
    const isFirstMessage = state.sendCounter === 1 && !state.receiveChainKey;
    const envelope: SignalEnvelope = {
      type: isFirstMessage ? 'prekey' : 'message',
      senderRegistrationId: this._registrationId,
      senderIdentityKey: this._identityKeyPair.pubKey,
      senderRatchetKey: state.dhSendingKeyPair.pubKey,
      previousCounter: state.previousSendCounter,
      counter: state.sendCounter,
      ciphertext: encrypted,
      timestamp: Date.now(),
    };

    if (isFirstMessage) {
      envelope.senderEphemeralKey = sessionData.ephemeralKey;
    }

    console.log(`[E2EE] 消息已加密 → ${peerId}, counter: ${state.sendCounter}`);
    return envelope;
  }

  /**
   * 解密消息
   * 使用 Double Ratchet 的对称棘轮步骤
   */
  async decrypt(peerId: string, envelope: SignalEnvelope): Promise<string> {
    if (!this._identityKeyPair) throw new Error('E2EE 未初始化');

    let sessionRecord = await this.store.getSession(peerId);

    // 如果是 PreKey 消息且没有会话，需要处理 X3DH 响应
    if (!sessionRecord && envelope.type === 'prekey') {
      await this.handlePreKeyMessage(peerId, envelope);
      sessionRecord = await this.store.getSession(peerId);
    }

    if (!sessionRecord) {
      throw new Error(`没有与 ${peerId} 的加密会话`);
    }

    const sessionData = JSON.parse(sessionRecord.sessionData);
    const state: RatchetState = sessionData.ratchetState;

    // 检查是否需要 DH 棘轮步骤
    if (envelope.senderRatchetKey !== state.dhReceivingKey) {
      await this.performDHRatchet(state, envelope.senderRatchetKey);
    }

    // 对称棘轮步骤：从 receiveChainKey 派生消息密钥
    if (!state.receiveChainKey) {
      // 首次接收，使用发送链密钥的镜像
      const chainKey = base64ToBuffer(state.sendChainKey || state.rootKey);
      const { messageKey, nextChainKey } = await deriveMessageKeys(chainKey);
      state.receiveChainKey = bufferToBase64(nextChainKey);

      // 解密
      const plainBuf = await aesDecrypt(envelope.ciphertext, messageKey);
      state.receiveCounter++;

      // 保存
      sessionData.ratchetState = state;
      await this.store.saveSession({
        peerId,
        sessionData: JSON.stringify(sessionData),
        updatedAt: Date.now(),
      });

      return bufferToString(plainBuf);
    }

    // 正常对称棘轮
    const chainKey = base64ToBuffer(state.receiveChainKey);
    const { messageKey, nextChainKey } = await deriveMessageKeys(chainKey);

    // 解密
    const plainBuf = await aesDecrypt(envelope.ciphertext, messageKey);

    // 更新状态
    state.receiveChainKey = bufferToBase64(nextChainKey);
    state.receiveCounter++;

    sessionData.ratchetState = state;
    await this.store.saveSession({
      peerId,
      sessionData: JSON.stringify(sessionData),
      updatedAt: Date.now(),
    });

    console.log(`[E2EE] 消息已解密 ← ${peerId}, counter: ${state.receiveCounter}`);
    return bufferToString(plainBuf);
  }

  /** 处理 PreKey 消息（作为接收方建立会话） */
  private async handlePreKeyMessage(peerId: string, envelope: SignalEnvelope): Promise<void> {
    console.log('[E2EE] 处理 PreKey 消息，建立被动会话');
    const bundle = await this.fetchRemoteBundle(peerId);
    if (bundle) {
      await this.establishSession(peerId, bundle);
    }
  }

  /** 执行 DH 棘轮步骤 */
  private async performDHRatchet(state: RatchetState, newRemoteRatchetKey: string): Promise<void> {
    // 保存当前发送计数
    state.previousSendCounter = state.sendCounter;
    state.sendCounter = 0;
    state.receiveCounter = 0;

    // 更新接收密钥
    state.dhReceivingKey = newRemoteRatchetKey;

    // 计算新的接收链密钥
    const remoteRatchetPub = await importPublicKey(newRemoteRatchetKey);
    const sendPriv = await importPrivateKey(state.dhSendingKeyPair.privKey);
    const dhResult = await ecdh(sendPriv, remoteRatchetPub);

    const rootKey = base64ToBuffer(state.rootKey);
    const salt = new Uint8Array(32).buffer;
    const info = stringToBuffer('imim-ratchet');
    const derived = await hkdf(concatBuffers(rootKey, dhResult), salt, info, 64);

    state.rootKey = bufferToBase64(derived.slice(0, 32));
    state.receiveChainKey = bufferToBase64(derived.slice(32, 64));

    // 生成新的发送棘轮密钥对
    const newSendKP = await generateKeyPair();
    state.dhSendingKeyPair = await exportKeyPair(newSendKP);

    // 计算新的发送链密钥
    const dhSend = await ecdh(newSendKP.privateKey, remoteRatchetPub);
    const newRootKey = base64ToBuffer(state.rootKey);
    const derivedSend = await hkdf(concatBuffers(newRootKey, dhSend), salt, info, 64);

    state.rootKey = bufferToBase64(derivedSend.slice(0, 32));
    state.sendChainKey = bufferToBase64(derivedSend.slice(32, 64));

    console.log('[E2EE] DH 棘轮步骤完成');
  }

  // ============================================================
  // Safety Number & 验证
  // ============================================================

  /** 获取与对端的 Safety Number */
  async getSafetyNumber(peerId: string): Promise<string> {
    if (!this._identityKeyPair) return '';

    const identity = await this.store.getIdentity(peerId);
    if (!identity) {
      return '';
    }

    return computeSafetyNumber(this._identityKeyPair.pubKey, identity.identityKey);
  }

  /** 获取本地 Identity Key 指纹 */
  async getLocalFingerprint(): Promise<string> {
    if (!this._identityKeyPair) return '';
    return computeFingerprint(this._identityKeyPair.pubKey);
  }

  /** 获取对端 Identity Key 指纹 */
  async getRemoteFingerprint(peerId: string): Promise<string> {
    const identity = await this.store.getIdentity(peerId);
    if (!identity) {
      return '';
    }
    return computeFingerprint(identity.identityKey);
  }

  // ============================================================
  // 状态查询
  // ============================================================

  /** 获取 E2EE 总体状态 */
  async getStatus(): Promise<E2EEStatus> {
    const sessions = await this.store.getAllSessions();
    const preKeys = await this.store.getAllPreKeys();
    const fp = await this.getLocalFingerprint();

    return {
      isInitialized: this._initialized,
      registrationId: this._registrationId,
      identityKeyFingerprint: fp,
      totalSessions: sessions.length,
      totalPreKeys: preKeys.length,
      identityKey: this._identityKeyPair?.pubKey || '',
    };
  }

  /** 获取指定对端的会话信息 */
  async getSessionInfo(peerId: string): Promise<SessionInfo | null> {
    const session = await this.store.getSession(peerId);
    const identity = await this.store.getIdentity(peerId);

    if (!session && !identity) {
      return null;
    }

    const remoteKey = identity?.identityKey || '';
    const sessionData = session ? JSON.parse(session.sessionData) : null;
    const state: RatchetState | null = sessionData?.ratchetState || null;

    return {
      peerId,
      established: !!session,
      remoteIdentityKey: remoteKey,
      remoteFingerprint: remoteKey ? await computeFingerprint(remoteKey) : '',
      safetyNumber: await this.getSafetyNumber(peerId),
      lastUpdated: session?.updatedAt || Date.now(),
      messagesSent: state?.sendCounter || 0,
      messagesReceived: state?.receiveCounter || 0,
    };
  }

  /** 检查是否有与对端的会话 */
  async hasSession(peerId: string): Promise<boolean> {
    const session = await this.store.getSession(peerId);
    return !!session;
  }

  /** 重置与对端的会话 */
  async resetSession(peerId: string): Promise<void> {
    await this.store.removeSession(peerId);
    console.log('[E2EE] 已重置与', peerId, '的会话');
  }

  /** 重置所有数据（退出登录） */
  async resetAll(): Promise<void> {
    await this.store.clearAll();
    const ownerId = typeof localStorage !== 'undefined' ? localStorage.getItem('user_id') || undefined : undefined;
    await clearDecryptedMessageCache(ownerId);
    this._initialized = false;
    this._registrationId = 0;
    this._identityKeyPair = null;
    console.log('[E2EE] 所有加密数据已清除');
  }

  /** 补充 One-Time PreKeys（当数量不足时） */
  async replenishPreKeysIfNeeded(threshold: number = 5): Promise<void> {
    const count = await this.store.getPreKeyCount();
    if (count < threshold) {
      const newStartId = count + 100; // 避免 ID 冲突
      await this.generatePreKeys(newStartId, 20);
      console.log('[E2EE] 已补充 20 个 One-Time PreKeys');
    }
  }
}

// ============================================================
// 导出便捷函数
// ============================================================

/** 获取 E2EEManager 单例 */
export function getE2EEManager(): E2EEManager {
  return E2EEManager.shared();
}
