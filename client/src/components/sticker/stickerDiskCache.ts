/**
 * StickerDiskCache — 贴纸磁盘缓存
 * 使用浏览器 Cache API 持久化存储贴纸二进制数据 (ArrayBuffer)
 */

const CACHE_NAME = 'cqim-stickers-v1';

export async function getStickerFromDisk(url: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    if (response) {
      return await response.arrayBuffer();
    }
  } catch (error) {
    console.warn('[StickerDiskCache] Read failed:', error);
  }
  return null;
}

export async function saveStickerToDisk(url: string, data: ArrayBuffer | Blob) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = new Response(data, {
      headers: {
        'Content-Type': /\.tgs(\?.*)?$/i.test(url) ? 'application/x-tgsticker' : 'application/json',
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    });
    await cache.put(url, response);
  } catch (error) {
    console.warn('[StickerDiskCache] Write failed:', error);
  }
}

export async function clearStickerDiskCache() {
  try {
    await caches.delete(CACHE_NAME);
  } catch (error) {
    console.error('[StickerDiskCache] Clear failed:', error);
  }
}
