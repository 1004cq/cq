import Database from 'better-sqlite3';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const sqlitePath = process.argv[2] || process.env.SQLITE_PATH || path.resolve(process.cwd(), 'prisma/data/cqim.db');
const mongoUrl = process.argv[3] || process.env.MONGO_URL || process.env.DATABASE_URL;
const dbName = process.argv[4] || process.env.MONGO_DB_NAME || undefined;

if (!mongoUrl) {
  console.error('缺少 MongoDB 连接串。请通过第二个参数、MONGO_URL 或 DATABASE_URL 提供。');
  process.exit(1);
}

if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite 文件不存在: ${sqlitePath}`);
  process.exit(1);
}

const IGNORE_TABLES = new Set(['_prisma_migrations', 'sqlite_sequence']);
const ID_FIELD_OVERRIDES = new Map([
  ['SystemConfig', 'key'],
]);

function inferDatabaseName(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\//, '').trim();
    return pathname || 'cqim';
  } catch {
    return 'cqim';
  }
}

function normalizeDateLikeValue(column, value) {
  if (value == null) return value;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return value;
  if (!/(At|Time)$/i.test(column)) return value;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp);
}

function normalizeNumericLikeValue(column, value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  if (!/(Seq|Count|Attempts|Members|Duration)$/i.test(column)) return value;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

function transformRow(table, row) {
  const doc = {};
  for (const [key, raw] of Object.entries(row)) {
    let value = normalizeDateLikeValue(key, raw);
    value = normalizeNumericLikeValue(key, value);
    doc[key] = value;
  }

  const idField = ID_FIELD_OVERRIDES.get(table) || 'id';
  if (doc[idField]) {
    doc._id = String(doc[idField]);
    delete doc[idField];
  }

  return doc;
}

async function main() {
  const sqlite = new Database(sqlitePath, { readonly: true });
  const client = new MongoClient(mongoUrl);
  const mongoDbName = dbName || inferDatabaseName(mongoUrl);

  console.log(`[migrate] SQLite: ${sqlitePath}`);
  console.log(`[migrate] MongoDB: ${mongoDbName}`);

  await client.connect();
  const mongo = client.db(mongoDbName);

  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((item) => item.name)
    .filter((name) => !IGNORE_TABLES.has(name));

  for (const table of tables) {
    const rows = sqlite.prepare(`SELECT * FROM \"${table}\"`).all();
    const collection = mongo.collection(table);

    if (rows.length === 0) {
      console.log(`[migrate] 跳过空表 ${table}`);
      continue;
    }

    const documents = rows.map((row) => transformRow(table, row));
    for (const doc of documents) {
      await collection.updateOne(
        { _id: doc._id },
        { $set: doc },
        { upsert: true }
      );
    }

    console.log(`[migrate] ${table}: ${documents.length} 条`);
  }

  await client.close();
  sqlite.close();
  console.log('[migrate] SQLite -> MongoDB 迁移完成');
}

main().catch((error) => {
  console.error('[migrate] 迁移失败:', error);
  process.exit(1);
});
