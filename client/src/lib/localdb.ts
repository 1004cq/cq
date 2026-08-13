import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import type { Chat, Message } from './store';

export interface GroupMessageLike {
  id: string;
  seq: number;
  senderId: string;
  senderName?: string;
  msgType: string;
  content: string;
  replyToId?: string;
  extra?: any;
  timestamp: number;
  isRevoked?: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'failed';
  direction?: 'inbound' | 'outbound';
  decryptionStatus?: 'decrypted' | 'ciphertext' | 'failed' | 'legacy';
}

type ChatDoc = Chat & {
  lastMessageTime: number;
  membersJson: string;
};

type PrivateMessageDoc = Message & {
  ownerId: string;
  direction: 'inbound' | 'outbound';
  decryptionStatus: 'decrypted' | 'ciphertext' | 'failed' | 'legacy';
  reactionsJson: string;
  mentionsJson?: string;
  voiceWaveformJson?: string;
  locationDataJson?: string;
  linkPreviewJson?: string;
};

type GroupMessageDoc = GroupMessageLike & {
  ownerId: string;
  direction: 'inbound' | 'outbound';
  decryptionStatus: 'decrypted' | 'ciphertext' | 'failed' | 'legacy';
  groupId: string;
  extraJson?: string;
};

type SyncStateDoc = {
  id: string;
  scope: 'private' | 'group';
  ownerId: string;
  cursor?: string;
  updatedAt: number;
};

type CqimLocalDb = any;

const chatSchema: any = {
  title: 'cqim chat schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  additionalProperties: true,
  indexes: ['type', 'lastMessageTime', ['type', 'lastMessageTime']],
  required: ['id', 'type', 'name', 'avatar', 'unreadCount', 'isPinned', 'isMuted', 'lastMessageTime', 'membersJson'],
  properties: {
    id: { type: 'string', maxLength: 128 },
    type: { type: 'string', enum: ['private', 'group'] },
    name: { type: 'string' },
    avatar: { type: 'string' },
    lastMessage: { type: 'string' },
    lastMessageTime: { type: 'number', minimum: 0, maximum: 9999999999999 },
    unreadCount: { type: 'number', minimum: 0, maximum: 999999999 },
    isPinned: { type: 'boolean' },
    isMuted: { type: 'boolean' },
    membersJson: { type: 'string' },
    isTyping: { type: 'boolean' },
    isOfficial: { type: 'boolean' },
    isEncrypted: { type: 'boolean' },
    groupId: { type: 'string' },
    ephemeralTimer: { type: 'number' },
  },
} as const;

const privateMessageSchema: any = {
  title: 'cqim private message schema',
  version: 1,
  migrationStrategies: {
    1: (oldDoc: any) => ({
      ...oldDoc,
      ownerId: oldDoc.ownerId || 'legacy',
      direction: oldDoc.direction || 'inbound',
      decryptionStatus: oldDoc.decryptionStatus || (oldDoc.isEncrypted ? 'decrypted' : 'legacy'),
    }),
  },
  primaryKey: 'id',
  type: 'object',
  additionalProperties: true,
  indexes: ['ownerId', 'chatId', 'timestamp', ['ownerId', 'chatId', 'timestamp']],
  required: ['id', 'chatId', 'senderId', 'content', 'type', 'timestamp', 'isEncrypted', 'status', 'reactionsJson'],
  properties: {
    id: { type: 'string', maxLength: 128 },
    ownerId: { type: 'string', maxLength: 128 },
    chatId: { type: 'string', maxLength: 128 },
    senderId: { type: 'string', maxLength: 128 },
    content: { type: 'string' },
    type: { type: 'string' },
    timestamp: { type: 'number', minimum: 0, maximum: 9999999999999 },
    seq: { type: 'number' },
    cursor: { type: 'string' },
    direction: { type: 'string' },
    decryptionStatus: { type: 'string' },
    isEncrypted: { type: 'boolean' },
    status: { type: 'string' },
    replyTo: { type: 'string' },
    imageUrl: { type: 'string' },
    videoUrl: { type: 'string' },
    fileName: { type: 'string' },
    fileSize: { type: 'string' },
    duration: { type: 'number' },
    encryptedEnvelope: { type: 'object', additionalProperties: true },
    decryptedContent: { type: 'string' },
    burnAfterRead: { type: 'number' },
    readAt: { type: 'number' },
    isBurned: { type: 'boolean' },
    forwardRestricted: { type: 'boolean' },
    hmac: { type: 'string' },
    integrityStatus: { type: 'string' },
    voiceCiphertext: { type: 'string' },
    voiceIv: { type: 'string' },
    voiceKeyBase64: { type: 'string' },
    voiceMimeType: { type: 'string' },
    voiceUrl: { type: 'string' },
    locationShareId: { type: 'string' },
    locationDuration: { type: 'number' },
    locationExpiresAt: { type: 'number' },
    locationEnded: { type: 'boolean' },
    isRecalled: { type: 'boolean' },
    linkUrl: { type: 'string' },
    reactionsJson: { type: 'string' },
    mentionsJson: { type: 'string' },
    voiceWaveformJson: { type: 'string' },
    locationDataJson: { type: 'string' },
    linkPreviewJson: { type: 'string' },
  },
} as const;

const groupMessageSchema: any = {
  title: 'cqim group message schema',
  version: 1,
  migrationStrategies: {
    1: (oldDoc: any) => ({
      ...oldDoc,
      ownerId: oldDoc.ownerId || 'legacy',
      direction: oldDoc.direction || 'inbound',
      decryptionStatus: oldDoc.decryptionStatus || (oldDoc.msgType === 'mls_encrypted' ? 'decrypted' : 'legacy'),
    }),
  },
  primaryKey: 'id',
  type: 'object',
  additionalProperties: true,
  indexes: ['ownerId', 'groupId', 'seq', ['ownerId', 'groupId', 'seq']],
  required: ['id', 'groupId', 'seq', 'senderId', 'msgType', 'content', 'timestamp'],
  properties: {
    id: { type: 'string', maxLength: 128 },
    ownerId: { type: 'string', maxLength: 128 },
    groupId: { type: 'string', maxLength: 128 },
    seq: { type: 'number', minimum: 0, maximum: 9999999999999 },
    senderId: { type: 'string', maxLength: 128 },
    senderName: { type: 'string' },
    msgType: { type: 'string' },
    content: { type: 'string' },
    replyToId: { type: 'string' },
    extraJson: { type: 'string' },
    timestamp: { type: 'number', minimum: 0, maximum: 9999999999999 },
    direction: { type: 'string' },
    decryptionStatus: { type: 'string' },
    isRevoked: { type: 'boolean' },
    status: { type: 'string' },
  },
} as const;

const syncStateSchema: any = {
  title: 'cqim sync state schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  additionalProperties: true,
  indexes: ['scope', 'ownerId', ['scope', 'ownerId']],
  required: ['id', 'scope', 'ownerId', 'updatedAt'],
  properties: {
    id: { type: 'string', maxLength: 128 },
    scope: { type: 'string', enum: ['private', 'group'] },
    ownerId: { type: 'string', maxLength: 128 },
    cursor: { type: 'string' },
    updatedAt: { type: 'number', minimum: 0, maximum: 9999999999999 },
  },
} as const;

let dbPromise: Promise<CqimLocalDb> | null = null;

async function getDb(): Promise<CqimLocalDb> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await createRxDatabase({
        name: 'cqim_local',
        storage: getRxStorageDexie(),
        multiInstance: false,
        ignoreDuplicate: true,
      });

      await db.addCollections({
        chats: { schema: chatSchema },
        privateMessages: { schema: privateMessageSchema },
        groupMessages: { schema: groupMessageSchema },
        syncStates: { schema: syncStateSchema },
      });

      return db as unknown as CqimLocalDb;
    })();
  }

  return dbPromise;
}

function normalizeChat(chat: Chat): ChatDoc {
  return {
    ...chat,
    lastMessageTime: Number(chat.lastMessageTime || 0),
    membersJson: JSON.stringify(chat.members || []),
  };
}

function denormalizeChat(doc: ChatDoc): Chat {
  return {
    ...doc,
    lastMessageTime: Number(doc.lastMessageTime || 0),
    members: parseJson<string[]>(doc.membersJson, []),
  };
}

function normalizePrivateMessage(message: Message, ownerId: string): PrivateMessageDoc {
  return {
    ...message,
    ownerId,
    direction: message.direction || (message.senderId === ownerId ? 'outbound' : 'inbound'),
    decryptionStatus: message.decryptionStatus || (message.isEncrypted ? 'decrypted' : 'legacy'),
    timestamp: Number(message.timestamp || Date.now()),
    reactionsJson: JSON.stringify(message.reactions || {}),
    mentionsJson: message.mentions ? JSON.stringify(message.mentions) : undefined,
    voiceWaveformJson: message.voiceWaveform ? JSON.stringify(message.voiceWaveform) : undefined,
    locationDataJson: message.locationData ? JSON.stringify(message.locationData) : undefined,
    linkPreviewJson: message.linkPreview ? JSON.stringify(message.linkPreview) : undefined,
  };
}

function denormalizePrivateMessage(doc: PrivateMessageDoc): Message {
  return {
    ...doc,
    timestamp: Number(doc.timestamp || 0),
    seq: doc.seq,
    cursor: doc.cursor,
    direction: doc.direction,
    decryptionStatus: doc.decryptionStatus,
    reactions: parseJson<Record<string, number>>(doc.reactionsJson, {}),
    mentions: parseJson<string[] | undefined>(doc.mentionsJson, undefined),
    voiceWaveform: parseJson<number[] | undefined>(doc.voiceWaveformJson, undefined),
    locationData: parseJson<Message['locationData'] | undefined>(doc.locationDataJson, undefined),
    linkPreview: parseJson<Message['linkPreview'] | undefined>(doc.linkPreviewJson, undefined),
  };
}

function normalizeGroupMessage(ownerId: string, groupId: string, message: GroupMessageLike): GroupMessageDoc {
  return {
    ...message,
    ownerId,
    direction: message.direction || (message.senderId === ownerId ? 'outbound' : 'inbound'),
    decryptionStatus: message.decryptionStatus || (message.msgType === 'mls_encrypted' ? 'decrypted' : 'legacy'),
    groupId,
    timestamp: Number(message.timestamp || Date.now()),
    extraJson: message.extra === undefined ? undefined : JSON.stringify(message.extra),
  };
}

function denormalizeGroupMessage(doc: GroupMessageDoc): GroupMessageLike {
  return {
    id: doc.id,
    seq: Number(doc.seq || 0),
    direction: doc.direction,
    decryptionStatus: doc.decryptionStatus,
    senderId: doc.senderId,
    senderName: doc.senderName,
    msgType: doc.msgType,
    content: doc.content,
    replyToId: doc.replyToId,
    extra: parseJson<any>(doc.extraJson, undefined),
    timestamp: Number(doc.timestamp || 0),
    isRevoked: doc.isRevoked,
    status: doc.status,
  };
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function persistChats(chats: Chat[]) {
  const db = await getDb();
  for (const chat of chats) {
    await db.chats.upsert(normalizeChat(chat));
  }
}

const MAX_MESSAGES_PER_CONVERSATION = 500;

export async function persistPrivateMessages(messages: Message[], ownerId = 'legacy') {
  const db = await getDb();
  const byChat = new Map<string, Message[]>();
  for (const message of messages) {
    await db.privateMessages.upsert(normalizePrivateMessage(message, ownerId));
    const list = byChat.get(message.chatId) || [];
    list.push(message);
    byChat.set(message.chatId, list);
  }
  await Promise.all(Array.from(byChat.keys()).map(chatId => trimPrivateMessages(chatId, ownerId)));
}

export async function persistGroupMessages(groupId: string, messages: GroupMessageLike[], ownerId = 'legacy') {
  const db = await getDb();
  for (const message of messages) {
    await db.groupMessages.upsert(normalizeGroupMessage(ownerId, groupId, message));
  }
  await trimGroupMessages(groupId, ownerId);
}

export async function loadChatsFromLocalDb() {
  const db = await getDb();
  const docs = await db.chats.find().exec();
  return docs
    .map((doc: any) => denormalizeChat(doc.toJSON() as ChatDoc))
    .sort((a: Chat, b: Chat) => Number(b.lastMessageTime || 0) - Number(a.lastMessageTime || 0));
}

export async function loadPrivateMessagesFromLocalDb(chatId: string, ownerId = 'legacy') {
  const db = await getDb();
  const docs = await db.privateMessages.find({ selector: { chatId, ownerId } }).exec();
  return docs
    .map((doc: any) => denormalizePrivateMessage(doc.toJSON() as PrivateMessageDoc))
    .sort((a: Message, b: Message) => a.timestamp - b.timestamp);
}

export async function loadGroupMessagesFromLocalDb(groupId: string, ownerId = 'legacy') {
  const db = await getDb();
  const docs = await db.groupMessages.find({ selector: { groupId, ownerId } }).exec();
  return docs
    .map((doc: any) => denormalizeGroupMessage(doc.toJSON() as GroupMessageDoc))
    .sort((a: GroupMessageLike, b: GroupMessageLike) => a.seq - b.seq);
}

export async function updateSyncState(state: SyncStateDoc) {
  const db = await getDb();
  await db.syncStates.upsert(state);
}

export async function loadSyncState(id: string) {
  const db = await getDb();
  const doc = await db.syncStates.findOne(id).exec();
  return doc?.toJSON() as SyncStateDoc | null;
}

async function trimPrivateMessages(chatId: string, ownerId: string) {
  const db = await getDb();
  const docs = await db.privateMessages.find({ selector: { chatId, ownerId } }).exec();
  const stale = docs
    .map((doc: any) => doc.toJSON() as PrivateMessageDoc)
    .sort((a: PrivateMessageDoc, b: PrivateMessageDoc) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(MAX_MESSAGES_PER_CONVERSATION);
  await Promise.all(stale.map((doc: PrivateMessageDoc) => db.privateMessages.findOne(doc.id).remove()));
}

async function trimGroupMessages(groupId: string, ownerId: string) {
  const db = await getDb();
  const docs = await db.groupMessages.find({ selector: { groupId, ownerId } }).exec();
  const stale = docs
    .map((doc: any) => doc.toJSON() as GroupMessageDoc)
    .sort((a: GroupMessageDoc, b: GroupMessageDoc) => Number(b.seq || 0) - Number(a.seq || 0))
    .slice(MAX_MESSAGES_PER_CONVERSATION);
  await Promise.all(stale.map((doc: GroupMessageDoc) => db.groupMessages.findOne(doc.id).remove()));
}

export async function clearConversationLocalData(conversationId: string, ownerId: string) {
  const db = await getDb();
  await Promise.all([
    db.privateMessages.find({ selector: { chatId: conversationId, ownerId } }).remove(),
    db.groupMessages.find({ selector: { groupId: conversationId, ownerId } }).remove(),
    db.syncStates.find({ selector: { ownerId, id: { $regex: conversationId } } }).remove(),
  ]);
}

export async function clearDecryptedMessageCache(ownerId?: string) {
  const db = await getDb();
  const selector = ownerId ? { ownerId } : {};
  await Promise.all([
    db.privateMessages.find({ selector }).remove(),
    db.groupMessages.find({ selector }).remove(),
    db.syncStates.find({ selector }).remove(),
  ]);
}

export async function clearLocalMessagingData() {
  const db = await getDb();
  await Promise.all([
    db.chats.remove(),
    db.privateMessages.remove(),
    db.groupMessages.remove(),
    db.syncStates.remove(),
  ]);
}
