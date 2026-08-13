/**
 * imim SignalStore — 基于 IndexedDB 的 Signal Protocol 密钥存储层
 *
 * 参考唐僧叨叨 TsddSignalStore 设计，使用 idb 库操作 IndexedDB，
 * 实现 Identity Key、Signed PreKey、One-Time PreKey、Session 的持久化存储。
 * 所有私钥永不离开浏览器。
 */
import { openDB, type IDBPDatabase } from 'idb';

// ============================================================
// 类型定义
// ============================================================

/** 密钥对（公钥 + 私钥，均为 Base64 编码） */
export interface KeyPairB64 {
  pubKey: string;
  privKey: string;
}

/** Identity Key 记录 */
export interface IdentityRecord {
  userId: string;
  identityKey: string;          // Base64 公钥
  trusted: boolean;
  addedAt: number;
}

/** Signed PreKey 记录 */
export interface SignedPreKeyRecord {
  id: number;
  keyPair: KeyPairB64;
  signature: string;            // Base64 签名
  createdAt: number;
}

/** One-Time PreKey 记录 */
export interface PreKeyRecord {
  id: number;
  keyPair: KeyPairB64;
}

/** Session 记录（序列化后的会话状态） */
export interface SessionRecord {
  peerId: string;
  sessionData: string;          // JSON 序列化的会话状态
  updatedAt: number;
}

/** 本地注册信息 */
export interface LocalRegistration {
  registrationId: number;
  identityKeyPair: KeyPairB64;
  createdAt: number;
}

// ============================================================
// 数据库 Schema
// ============================================================

const DB_NAME = 'imim-signal-store';
const DB_VERSION = 1;

const STORES = {
  LOCAL_REG: 'localRegistration',
  IDENTITY: 'identityKeys',
  SIGNED_PREKEY: 'signedPreKeys',
  PREKEY: 'preKeys',
  SESSION: 'sessions',
} as const;

// ============================================================
// SignalStore 类
// ============================================================

export class SignalStore {
  private db: IDBPDatabase | null = null;
  private static _instance: SignalStore | null = null;

  static shared(): SignalStore {
    if (!SignalStore._instance) {
      SignalStore._instance = new SignalStore();
    }
    return SignalStore._instance;
  }

  /** 初始化数据库连接 */
  async init(): Promise<void> {
    if (this.db) return;
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 本地注册信息（只存一条）
        if (!db.objectStoreNames.contains(STORES.LOCAL_REG)) {
          db.createObjectStore(STORES.LOCAL_REG, { keyPath: 'registrationId' });
        }
        // 对端 Identity Key
        if (!db.objectStoreNames.contains(STORES.IDENTITY)) {
          db.createObjectStore(STORES.IDENTITY, { keyPath: 'userId' });
        }
        // Signed PreKey
        if (!db.objectStoreNames.contains(STORES.SIGNED_PREKEY)) {
          db.createObjectStore(STORES.SIGNED_PREKEY, { keyPath: 'id' });
        }
        // One-Time PreKey
        if (!db.objectStoreNames.contains(STORES.PREKEY)) {
          db.createObjectStore(STORES.PREKEY, { keyPath: 'id' });
        }
        // Session
        if (!db.objectStoreNames.contains(STORES.SESSION)) {
          db.createObjectStore(STORES.SESSION, { keyPath: 'peerId' });
        }
      },
    });
  }

  private ensureDB(): IDBPDatabase {
    if (!this.db) throw new Error('SignalStore 尚未初始化，请先调用 init()');
    return this.db;
  }

  // --------------------------------------------------------
  // 本地注册信息
  // --------------------------------------------------------

  async saveLocalRegistration(reg: LocalRegistration): Promise<void> {
    const db = this.ensureDB();
    await db.put(STORES.LOCAL_REG, reg);
  }

  async getLocalRegistration(): Promise<LocalRegistration | undefined> {
    const db = this.ensureDB();
    const all = await db.getAll(STORES.LOCAL_REG);
    return all[0];
  }

  async clearLocalRegistration(): Promise<void> {
    const db = this.ensureDB();
    await db.clear(STORES.LOCAL_REG);
  }

  // --------------------------------------------------------
  // Identity Key
  // --------------------------------------------------------

  async saveIdentity(record: IdentityRecord): Promise<void> {
    const db = this.ensureDB();
    await db.put(STORES.IDENTITY, record);
  }

  async getIdentity(userId: string): Promise<IdentityRecord | undefined> {
    const db = this.ensureDB();
    return db.get(STORES.IDENTITY, userId);
  }

  async getAllIdentities(): Promise<IdentityRecord[]> {
    const db = this.ensureDB();
    return db.getAll(STORES.IDENTITY);
  }

  async removeIdentity(userId: string): Promise<void> {
    const db = this.ensureDB();
    await db.delete(STORES.IDENTITY, userId);
  }

  /** 验证对端 Identity Key 是否与已存储的一致（首次信任 TOFU） */
  async isTrustedIdentity(userId: string, identityKey: string): Promise<boolean> {
    const existing = await this.getIdentity(userId);
    if (!existing) return true; // 首次信任
    return existing.identityKey === identityKey;
  }

  // --------------------------------------------------------
  // Signed PreKey
  // --------------------------------------------------------

  async saveSignedPreKey(record: SignedPreKeyRecord): Promise<void> {
    const db = this.ensureDB();
    await db.put(STORES.SIGNED_PREKEY, record);
  }

  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord | undefined> {
    const db = this.ensureDB();
    return db.get(STORES.SIGNED_PREKEY, id);
  }

  async getAllSignedPreKeys(): Promise<SignedPreKeyRecord[]> {
    const db = this.ensureDB();
    return db.getAll(STORES.SIGNED_PREKEY);
  }

  async removeSignedPreKey(id: number): Promise<void> {
    const db = this.ensureDB();
    await db.delete(STORES.SIGNED_PREKEY, id);
  }

  // --------------------------------------------------------
  // One-Time PreKey
  // --------------------------------------------------------

  async savePreKey(record: PreKeyRecord): Promise<void> {
    const db = this.ensureDB();
    await db.put(STORES.PREKEY, record);
  }

  async getPreKey(id: number): Promise<PreKeyRecord | undefined> {
    const db = this.ensureDB();
    return db.get(STORES.PREKEY, id);
  }

  async getAllPreKeys(): Promise<PreKeyRecord[]> {
    const db = this.ensureDB();
    return db.getAll(STORES.PREKEY);
  }

  async removePreKey(id: number): Promise<void> {
    const db = this.ensureDB();
    await db.delete(STORES.PREKEY, id);
  }

  async getPreKeyCount(): Promise<number> {
    const db = this.ensureDB();
    return db.count(STORES.PREKEY);
  }

  // --------------------------------------------------------
  // Session
  // --------------------------------------------------------

  async saveSession(record: SessionRecord): Promise<void> {
    const db = this.ensureDB();
    await db.put(STORES.SESSION, record);
  }

  async getSession(peerId: string): Promise<SessionRecord | undefined> {
    const db = this.ensureDB();
    return db.get(STORES.SESSION, peerId);
  }

  async getAllSessions(): Promise<SessionRecord[]> {
    const db = this.ensureDB();
    return db.getAll(STORES.SESSION);
  }

  async removeSession(peerId: string): Promise<void> {
    const db = this.ensureDB();
    await db.delete(STORES.SESSION, peerId);
  }

  async removeAllSessions(): Promise<void> {
    const db = this.ensureDB();
    await db.clear(STORES.SESSION);
  }

  // --------------------------------------------------------
  // 全部清除（退出登录时调用）
  // --------------------------------------------------------

  async clearAll(): Promise<void> {
    const db = this.ensureDB();
    await Promise.all([
      db.clear(STORES.LOCAL_REG),
      db.clear(STORES.IDENTITY),
      db.clear(STORES.SIGNED_PREKEY),
      db.clear(STORES.PREKEY),
      db.clear(STORES.SESSION),
    ]);
  }
}
