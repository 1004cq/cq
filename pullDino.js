import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_TOKEN = '7984062998:AAFGOjbrFJkabz7YqAUXGYob0hU7RcdvZYU';
const CACHE_DIR = path.join(__dirname, 'cqim', 'cache', 'tg_stickers');

function callTelegramAPI(method, params = {}) {
  return new Promise((resolve, reject) => {
    const queryString = new URLSearchParams(params).toString();
    const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/' + method + '?' + queryString;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok) resolve(json.result);
          else reject(new Error('API Error: ' + json.description));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function downloadFile(fileId, filename) {
  const fileInfo = await callTelegramAPI('getFile', { file_id: fileId });
  const downloadUrl = 'https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + fileInfo.file_path;
  const localPath = path.join(CACHE_DIR, filename);
  return new Promise((resolve, reject) => {
    https.get(downloadUrl, (res) => {
      const fileStream = fs.createWriteStream(localPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(localPath);
      });
      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchSet(setName) {
  console.log('拉取贴纸包: ' + setName);
  try {
    const set = await callTelegramAPI('getStickerSet', { name: setName });
    console.log('找到贴纸包: ' + set.title + ' (' + set.stickers.length + '个)');
    if (fs.existsSync(CACHE_DIR) === false) fs.mkdirSync(CACHE_DIR, { recursive: true });
    for (let i = 0; i < set.stickers.length; i++) {
      const s = set.stickers[i];
      const ext = s.is_animated ? '.tgs' : (s.is_video ? '.webm' : '.webp');
      const name = setName + '_' + i + ext;
      await downloadFile(s.file_id, name);
      console.log('  已下载: ' + name);
    }
  } catch (e) {
    console.error('失败: ' + setName, e.message);
  }
}

async function run() {
  await fetchSet('DinoKuning');
  await fetchSet('Dino_Green');
}
run();