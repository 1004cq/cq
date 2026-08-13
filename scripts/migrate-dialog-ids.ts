/**
 * 数据迁移脚本：为现有用户和群组生成 TG 风格 Dialog ID
 * 运行方式：npx tsx scripts/migrate-dialog-ids.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  generateUserDialogId,
  generateGroupDialogId,
  dialogIdToString,
} from '../server/utils/peerId.js';

const prisma = new PrismaClient();

async function main() {
  console.log('=== 开始迁移 Dialog ID ===\n');

  // 1. 为没有 dialogId 的用户生成
  const usersWithoutDialogId = await prisma.user.findMany({
    where: { dialogId: null },
    select: { id: true, username: true, isBot: true },
  });

  console.log(`发现 ${usersWithoutDialogId.length} 个用户需要生成 dialogId`);

  for (const user of usersWithoutDialogId) {
    const dialogId = generateUserDialogId(user.isBot);
    const dialogIdStr = dialogIdToString(dialogId);
    await prisma.user.update({
      where: { id: user.id },
      data: { dialogId: dialogIdStr },
    });
    console.log(`  用户 ${user.username} (${user.id}) → dialogId: ${dialogIdStr}`);
  }

  // 2. 为没有 dialogId 的群组生成
  const groupsWithoutDialogId = await prisma.group.findMany({
    where: { dialogId: null },
    select: { id: true, name: true, type: true, maxMembers: true },
  });

  console.log(`\n发现 ${groupsWithoutDialogId.length} 个群组需要生成 dialogId`);

  for (const group of groupsWithoutDialogId) {
    const isSupergroup = group.type === 'super' || group.type === 'channel' || group.maxMembers > 200;
    const dialogId = generateGroupDialogId(isSupergroup);
    const dialogIdStr = dialogIdToString(dialogId);
    await prisma.group.update({
      where: { id: group.id },
      data: { dialogId: dialogIdStr },
    });
    console.log(`  群组 "${group.name}" (${group.id}) → dialogId: ${dialogIdStr} [${isSupergroup ? '超级群' : '普通群'}]`);
  }

  console.log('\n=== 迁移完成 ===');

  // 3. 统计结果
  const totalUsers = await prisma.user.count();
  const usersWithDialog = await prisma.user.count({ where: { dialogId: { not: null } } });
  const totalGroups = await prisma.group.count();
  const groupsWithDialog = await prisma.group.count({ where: { dialogId: { not: null } } });

  console.log(`\n统计：`);
  console.log(`  用户: ${usersWithDialog}/${totalUsers} 已有 dialogId`);
  console.log(`  群组: ${groupsWithDialog}/${totalGroups} 已有 dialogId`);
}

main()
  .catch((e) => {
    console.error('迁移失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
