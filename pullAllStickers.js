#!/usr/bin/env node

/**
 * Telegram 贴纸全量拉取脚本
 * 用途：从 Telegram Bot API 批量拉取热门贴纸包，并缓存到本地
 * 执行：node pullAllStickers.js
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置
const BOT_TOKEN = '7984062998:AAFGOjbrFJkabz7YqAUXGYob0hU7RcdvZYU';
const CACHE_DIR = path.join(__dirname, 'cqim', 'cache', 'tg_stickers');
const METADATA_FILE = path.join(CACHE_DIR, 'metadata.json');

// 热门贴纸包列表（基于 Telegram 官方推荐）
const POPULAR_STICKER_SETS = [
  'AnimatedEmojies',
  'TelegramAnimated',
  'iOS13',
  'Premium',
  'Cat',
  'Dogs',
  'Memes',
  'Food',
  'Travel',
  'Sports',
  'Nature',
  'Cute',
  'Anime',
  'Gaming',
  'Music',
  'Emoji',
  'Smileys',
  'Reactions',
  'Stickers',
  'Flags',
];

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 创建缓存目录
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    log(`✓ 创建缓存目录: ${CACHE_DIR}`, 'green');
  }
}

// 调用 Telegram Bot API
function callTelegramAPI(method, params = {}) {
  return new Promise((resolve, reject) => {
    const queryString = new URLSearchParams(params).toString();
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}?${queryString}`;

    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) {
              resolve(json.result);
            } else {
              reject(new Error(`API Error: ${json.description}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

// 下载文件
function downloadFile(fileId, filename) {
  return new Promise((resolve, reject) => {
    callTelegramAPI('getFile', { file_id: fileId })
      .then((fileInfo) => {
        const filePath = fileInfo.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        const localPath = path.join(CACHE_DIR, filename);

        https
          .get(downloadUrl, (res) => {
            const fileStream = fs.createWriteStream(localPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close();
              resolve(localPath);
            });
            fileStream.on('error', reject);
          })
          .on('error', reject);
      })
      .catch(reject);
  });
}

// 拉取单个贴纸包
async function fetchStickerSet(setName) {
  try {
    log(`📦 正在拉取贴纸包: ${setName}...`, 'blue');

    const stickerSet = await callTelegramAPI('getStickerSet', { name: setName });

    if (!stickerSet) {
      log(`✗ 贴纸包不存在: ${setName}`, 'red');
      return null;
    }

    log(`  ✓ 获取成功，包含 ${stickerSet.stickers.length} 个贴纸`, 'green');

    // 下载贴纸
    const stickers = [];
    for (let i = 0; i < stickerSet.stickers.length; i++) {
      const sticker = stickerSet.stickers[i];
      const fileId = sticker.file_id;
      const fileExtension = sticker.is_animated ? '.tgs' : sticker.is_video ? '.webm' : '.webp';
      const filename = `${setName}_${i}${fileExtension}`;

      try {
        const localPath = await downloadFile(fileId, filename);
        const fileSize = fs.statSync(localPath).size;
        stickers.push({
          index: i,
          fileId,
          filename,
          localPath,
          fileSize,
          isAnimated: sticker.is_animated,
          isVideo: sticker.is_video,
          emoji: sticker.emoji || '',
        });
        log(`  ✓ [${i + 1}/${stickerSet.stickers.length}] 已下载: ${filename} (${(fileSize / 1024).toFixed(2)}KB)`, 'green');
      } catch (err) {
        log(`  ✗ [${i + 1}/${stickerSet.stickers.length}] 下载失败: ${err.message}`, 'red');
      }

      // 避免请求过快被限流
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      name: stickerSet.name,
      title: stickerSet.title,
      isAnimated: stickerSet.is_animated,
      isVideo: stickerSet.is_video,
      stickers,
      totalCount: stickers.length,
      totalSize: stickers.reduce((sum, s) => sum + s.fileSize, 0),
    };
  } catch (err) {
    log(`✗ 拉取失败: ${setName} - ${err.message}`, 'red');
    return null;
  }
}

// 主函数
async function main() {
  log('🚀 开始拉取 Telegram 贴纸...', 'blue');
  log(`📍 缓存目录: ${CACHE_DIR}`, 'blue');
  log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 10)}...`, 'blue');
  log('');

  ensureCacheDir();

  const results = [];
  let totalSize = 0;
  let totalStickers = 0;

  for (const setName of POPULAR_STICKER_SETS) {
    const result = await fetchStickerSet(setName);
    if (result) {
      results.push(result);
      totalSize += result.totalSize;
      totalStickers += result.totalCount;
      log(`  📊 总计: ${result.totalCount} 个贴纸，${(result.totalSize / 1024 / 1024).toFixed(2)}MB`, 'yellow');
    }
    log('');

    // 避免请求过快
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // 保存元数据
  const metadata = {
    timestamp: new Date().toISOString(),
    totalSets: results.length,
    totalStickers,
    totalSize,
    stickerSets: results,
  };

  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  log(`✓ 元数据已保存: ${METADATA_FILE}`, 'green');

  // 统计信息
  log('', 'reset');
  log('═══════════════════════════════════════════', 'blue');
  log('📊 拉取完成统计', 'blue');
  log('═══════════════════════════════════════════', 'blue');
  log(`✓ 成功拉取贴纸包: ${results.length}/${POPULAR_STICKER_SETS.length}`, 'green');
  log(`✓ 总贴纸数: ${totalStickers}`, 'green');
  log(`✓ 总大小: ${(totalSize / 1024 / 1024).toFixed(2)}MB`, 'green');
  log(`✓ 缓存目录: ${CACHE_DIR}`, 'green');
  log('═══════════════════════════════════════════', 'blue');
}

// 运行
main().catch((err) => {
  log(`❌ 错误: ${err.message}`, 'red');
  process.exit(1);
});
