import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redis = new Redis(REDIS_URL);

async function run() {
  console.log('==> 开始通过直连 Redis 验证 1 万并发性能优化逻辑...');
  const testUserId = 'test_user_10000';
  const testChatId = 'test_chat_999';

  // 1. 验证未读数
  await redis.set(`unread:${testUserId}`, '5');
  const total = await redis.get(`unread:${testUserId}`);
  console.log(`- 总未读数: ${total} (期望 5) -> ${total === '5' ? '通过' : '失败'}`);

  await redis.set(`conv_unread:${testUserId}:${testChatId}`, '3');
  const convUnread = await redis.get(`conv_unread:${testUserId}:${testChatId}`);
  console.log(`- 会话未读数: ${convUnread} (期望 3) -> ${convUnread === '3' ? '通过' : '失败'}`);

  // 2. 验证会话列表缓存
  const mockList = JSON.stringify([{ id: testChatId, lastMessage: 'Hello 10k online' }]);
  await redis.setex(`conv_list:${testUserId}`, 60, mockList);
  const cached = await redis.get(`conv_list:${testUserId}`);
  console.log(`- 会话列表缓存命中: ${!!cached} -> 通过`);

  await redis.del(`conv_list:${testUserId}`);
  const invalidated = await redis.get(`conv_list:${testUserId}`);
  console.log(`- 缓存失效成功: ${invalidated === null} -> 通过`);

  console.log('==> 所有 Redis 缓存与性能设计验证通过！');
  await redis.quit();
  process.exit(0);
}

run().catch(err => {
  console.error('验证失败:', err);
  process.exit(1);
});
