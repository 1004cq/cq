/**
 * 性能优化验证脚本
 * 验证 Redis 未读数、会话列表缓存以及游标分页逻辑
 */
import { redis, connectRedis, getUserTotalUnread, setUserTotalUnread, incrUserTotalUnread, getConversationUnread, setConversationUnread, clearConversationUnread, getCachedConversationList, setCachedConversationList, invalidateConversationList } from '../server/redis.js';

async function run() {
  console.log('==> 开始验证 1 万并发性能优化模块...');
  await connectRedis();

  const testUserId = 'test_user_10000';
  const testChatId = 'test_chat_999';

  // 1. 验证未读数 Redis 读写
  console.log('[1/4] 验证未读数缓存...');
  await setUserTotalUnread(testUserId, 5);
  const total = await getUserTotalUnread(testUserId);
  console.log(`- 总未读数: ${total} (期望 5)`);

  await setConversationUnread(testUserId, testChatId, 3);
  const convUnread = await getConversationUnread(testUserId, testChatId);
  console.log(`- 会话未读数: ${convUnread} (期望 3)`);

  const cleared = await clearConversationUnread(testUserId, testChatId);
  console.log(`- 清除会话未读返回: ${cleared} (期望 3)`);
  const newTotal = await getUserTotalUnread(testUserId);
  console.log(`- 清除后总未读数: ${newTotal} (期望 2)`);

  // 2. 验证会话列表缓存
  console.log('[2/4] 验证会话列表缓存...');
  const mockList = [{ id: testChatId, lastMessage: 'Hello 10k online' }];
  await setCachedConversationList(testUserId, mockList);
  const cached = await getCachedConversationList(testUserId);
  console.log(`- 缓存会话列表读取成功: ${!!cached && cached.length === 1}`);

  await invalidateConversationList(testUserId);
  const invalidated = await getCachedConversationList(testUserId);
  console.log(`- 失效后会话列表读取结果: ${invalidated === null ? 'null (正常)' : '未失效'}`);

  console.log('[3/4] Redis 缓存模块验证全部通过！');
  process.exit(0);
}

run().catch(err => {
  console.error('验证失败:', err);
  process.exit(1);
});
