/**
 * server/mls-group.ts — MLS 群组端到端加密服务端支持
 *
 * 服务端在 MLS 中扮演"哑管道"角色：
 * 1. 存储和分发 KeyPackage（加入群组的凭证）
 * 2. 转发 Welcome 消息（邀请新成员）
 * 3. 转发 Commit 消息（密钥更新）
 * 4. 存储群组 MLS 元数据（epoch、成员映射）
 * 5. 不接触任何私钥或明文消息
 *
 * 安全原则：
 * - 服务端永远不持有群密钥
 * - 所有加密操作在客户端完成
 * - 服务端只存储公钥和加密后的数据
 */

import { Router, Request, Response } from 'express';
import prisma from './db.js';

const mlsRouter = Router();

// ============================================================
// 1. KeyPackage 管理
// ============================================================

/**
 * POST /api/mls/upload-key-package
 * 客户端上传 MLS KeyPackage
 */
mlsRouter.post('/upload-key-package', async (req: Request, res: Response) => {
  const { userId, keyPackage } = req.body;

  if (!userId || !keyPackage) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    // 存储 KeyPackage（每个用户可以有多个）
    const key = `mls:keypackage:${userId}`;
    const existing = await prisma.systemConfig.findUnique({ where: { key } });

    let packages: any[] = [];
    if (existing?.value) {
      try {
        packages = JSON.parse(existing.value);
      } catch {}
    }

    // 添加新的 KeyPackage（保留最近 10 个）
    packages.push(keyPackage);
    if (packages.length > 10) {
      packages = packages.slice(-10);
    }

    await prisma.systemConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(packages) },
      create: { key, value: JSON.stringify(packages) },
    });

    console.log(`[MLS] 用户 ${userId} 上传 KeyPackage, 当前共 ${packages.length} 个`);
    res.json({ ok: true, count: packages.length });
  } catch (err: any) {
    console.error('[MLS] 上传 KeyPackage 失败:', err.message);
    res.status(500).json({ error: '上传失败' });
  }
});

/**
 * GET /api/mls/get-key-package?userId=xxx
 * 获取指定用户的 KeyPackage（消费一个）
 */
mlsRouter.get('/get-key-package', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId: string };

  if (!userId) {
    return res.status(400).json({ error: '缺少 userId' });
  }

  try {
    const key = `mls:keypackage:${userId}`;
    const config = await prisma.systemConfig.findUnique({ where: { key } });

    if (!config?.value) {
      return res.status(404).json({ error: '未找到 KeyPackage' });
    }

    let packages: any[] = [];
    try {
      packages = JSON.parse(config.value);
    } catch {
      return res.status(404).json({ error: 'KeyPackage 数据损坏' });
    }

    if (packages.length === 0) {
      return res.status(404).json({ error: '无可用 KeyPackage' });
    }

    // 消费第一个 KeyPackage
    const keyPackage = packages.shift();
    await prisma.systemConfig.update({
      where: { key },
      data: { value: JSON.stringify(packages) },
    });

    res.json({ keyPackage, remaining: packages.length });
  } catch (err: any) {
    console.error('[MLS] 获取 KeyPackage 失败:', err.message);
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * GET /api/mls/key-package-count?userId=xxx
 * 查询用户剩余 KeyPackage 数量
 */
mlsRouter.get('/key-package-count', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId: string };

  if (!userId) {
    return res.status(400).json({ error: '缺少 userId' });
  }

  try {
    const key = `mls:keypackage:${userId}`;
    const config = await prisma.systemConfig.findUnique({ where: { key } });

    let count = 0;
    if (config?.value) {
      try {
        count = JSON.parse(config.value).length;
      } catch {}
    }

    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: '查询失败' });
  }
});

// ============================================================
// 2. 群组 MLS 状态管理
// ============================================================

/**
 * POST /api/mls/enable-group
 * 为群组启用 MLS E2EE
 */
mlsRouter.post('/enable-group', async (req: Request, res: Response) => {
  const { groupId, userId, epoch, treeSnapshot, members } = req.body;

  if (!groupId || !userId) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    // 验证用户是群成员且有权限
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });

    if (!member) {
      return res.status(403).json({ error: '非群成员' });
    }

    // 存储群组 MLS 元数据
    const mlsKey = `mls:group:${groupId}`;
    const mlsState = {
      enabled: true,
      epoch: epoch || 0,
      creatorId: userId,
      treeSnapshot: treeSnapshot || [],
      members: members || {},
      enabledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await prisma.systemConfig.upsert({
      where: { key: mlsKey },
      update: { value: JSON.stringify(mlsState) },
      create: { key: mlsKey, value: JSON.stringify(mlsState) },
    });

    console.log(`[MLS] 群组 ${groupId} 已启用 MLS E2EE, epoch=${epoch}`);
    res.json({ ok: true, epoch });
  } catch (err: any) {
    console.error('[MLS] 启用群组 MLS 失败:', err.message);
    res.status(500).json({ error: '启用失败' });
  }
});

/**
 * GET /api/mls/group-state?groupId=xxx&userId=xxx
 * 获取群组 MLS 状态（用于新设备同步）
 */
mlsRouter.get('/group-state', async (req: Request, res: Response) => {
  const { groupId, userId } = req.query as { groupId: string; userId: string };

  if (!groupId) {
    return res.status(400).json({ error: '缺少 groupId' });
  }

  try {
    // 验证是群成员
    if (userId) {
      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!member) {
        return res.status(403).json({ error: '非群成员' });
      }
    }

    const mlsKey = `mls:group:${groupId}`;
    const config = await prisma.systemConfig.findUnique({ where: { key: mlsKey } });

    if (!config?.value) {
      return res.json({ enabled: false, epochState: null });
    }

    const mlsState = JSON.parse(config.value);
    res.json({
      enabled: mlsState.enabled,
      epoch: mlsState.epoch,
      members: mlsState.members,
      treeSnapshot: mlsState.treeSnapshot,
      enabledAt: mlsState.enabledAt,
    });
  } catch (err: any) {
    console.error('[MLS] 获取群组状态失败:', err.message);
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * POST /api/mls/update-group-state
 * 更新群组 MLS 状态（Commit 后调用）
 */
mlsRouter.post('/update-group-state', async (req: Request, res: Response) => {
  const { groupId, epoch, treeSnapshot, members, commitType } = req.body;

  if (!groupId || epoch === undefined) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    const mlsKey = `mls:group:${groupId}`;
    const existing = await prisma.systemConfig.findUnique({ where: { key: mlsKey } });

    let mlsState: any = {};
    if (existing?.value) {
      try {
        mlsState = JSON.parse(existing.value);
      } catch {}
    }

    mlsState.epoch = epoch;
    mlsState.updatedAt = new Date().toISOString();
    if (treeSnapshot) mlsState.treeSnapshot = treeSnapshot;
    if (members) mlsState.members = members;
    if (commitType) mlsState.lastCommitType = commitType;

    await prisma.systemConfig.upsert({
      where: { key: mlsKey },
      update: { value: JSON.stringify(mlsState) },
      create: { key: mlsKey, value: JSON.stringify(mlsState) },
    });

    res.json({ ok: true, epoch });
  } catch (err: any) {
    console.error('[MLS] 更新群组状态失败:', err.message);
    res.status(500).json({ error: '更新失败' });
  }
});

/**
 * GET /api/mls/is-enabled?groupId=xxx
 * 检查群组是否启用了 MLS
 */
mlsRouter.get('/is-enabled', async (req: Request, res: Response) => {
  const { groupId } = req.query as { groupId: string };

  if (!groupId) {
    return res.status(400).json({ error: '缺少 groupId' });
  }

  try {
    const mlsKey = `mls:group:${groupId}`;
    const config = await prisma.systemConfig.findUnique({ where: { key: mlsKey } });

    if (!config?.value) {
      return res.json({ enabled: false });
    }

    const mlsState = JSON.parse(config.value);
    res.json({
      enabled: !!mlsState.enabled,
      epoch: mlsState.epoch || 0,
      memberCount: Object.keys(mlsState.members || {}).length,
    });
  } catch (err: any) {
    res.json({ enabled: false });
  }
});

// ============================================================
// 3. MLS 消息转发（Welcome / Commit）
// ============================================================

/**
 * POST /api/mls/send-welcome
 * 转发 Welcome 消息给新成员
 */
mlsRouter.post('/send-welcome', async (req: Request, res: Response) => {
  const { groupId, targetUserId, welcome, senderIdentityKey } = req.body;

  if (!groupId || !targetUserId || !welcome) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    // 存储 Welcome 消息（新成员上线后拉取）
    const welcomeKey = `mls:welcome:${groupId}:${targetUserId}`;
    await prisma.systemConfig.upsert({
      where: { key: welcomeKey },
      update: {
        value: JSON.stringify({
          welcome,
          senderIdentityKey,
          createdAt: new Date().toISOString(),
        }),
      },
      create: {
        key: welcomeKey,
        value: JSON.stringify({
          welcome,
          senderIdentityKey,
          createdAt: new Date().toISOString(),
        }),
      },
    });

    console.log(`[MLS] Welcome 消息已存储, 群组=${groupId}, 目标用户=${targetUserId}`);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[MLS] 存储 Welcome 失败:', err.message);
    res.status(500).json({ error: '存储失败' });
  }
});

/**
 * GET /api/mls/pending-welcome?userId=xxx
 * 获取待处理的 Welcome 消息
 */
mlsRouter.get('/pending-welcome', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId: string };

  if (!userId) {
    return res.status(400).json({ error: '缺少 userId' });
  }

  try {
    // 查找所有发给该用户的 Welcome 消息
    const configs = await prisma.systemConfig.findMany({
      where: {
        key: { startsWith: `mls:welcome:` },
      },
    });

    const welcomes: any[] = [];
    for (const config of configs) {
      // key 格式: mls:welcome:{groupId}:{targetUserId}
      const parts = config.key.split(':');
      if (parts.length >= 4 && parts[3] === userId) {
        try {
          const data = JSON.parse(config.value);
          welcomes.push({
            groupId: parts[2],
            ...data,
          });
        } catch {}
      }
    }

    res.json({ welcomes });
  } catch (err: any) {
    console.error('[MLS] 获取 Welcome 失败:', err.message);
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * POST /api/mls/ack-welcome
 * 确认已处理 Welcome 消息
 */
mlsRouter.post('/ack-welcome', async (req: Request, res: Response) => {
  const { groupId, userId } = req.body;

  if (!groupId || !userId) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    const welcomeKey = `mls:welcome:${groupId}:${userId}`;
    await prisma.systemConfig.deleteMany({
      where: { key: welcomeKey },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: '确认失败' });
  }
});

/**
 * POST /api/mls/broadcast-commit
 * 存储 Commit 消息（供其他成员拉取）
 */
mlsRouter.post('/broadcast-commit', async (req: Request, res: Response) => {
  const { groupId, commit, commitType } = req.body;

  if (!groupId || !commit) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    // 存储最新的 Commit（覆盖旧的）
    const commitKey = `mls:commit:${groupId}:${commit.epoch}`;
    await prisma.systemConfig.upsert({
      where: { key: commitKey },
      update: {
        value: JSON.stringify({
          commit,
          commitType: commitType || 'update',
          createdAt: new Date().toISOString(),
        }),
      },
      create: {
        key: commitKey,
        value: JSON.stringify({
          commit,
          commitType: commitType || 'update',
          createdAt: new Date().toISOString(),
        }),
      },
    });

    // 清理旧的 Commit（只保留最近 50 个 epoch）
    const oldEpoch = commit.epoch - 50;
    if (oldEpoch > 0) {
      const oldKey = `mls:commit:${groupId}:${oldEpoch}`;
      await prisma.systemConfig.deleteMany({
        where: { key: oldKey },
      }).catch(() => {});
    }

    res.json({ ok: true, epoch: commit.epoch });
  } catch (err: any) {
    console.error('[MLS] 存储 Commit 失败:', err.message);
    res.status(500).json({ error: '存储失败' });
  }
});

/**
 * GET /api/mls/pending-commits?groupId=xxx&afterEpoch=xxx
 * 获取指定 epoch 之后的 Commit 消息
 */
mlsRouter.get('/pending-commits', async (req: Request, res: Response) => {
  const { groupId, afterEpoch } = req.query as { groupId: string; afterEpoch: string };

  if (!groupId) {
    return res.status(400).json({ error: '缺少 groupId' });
  }

  try {
    const configs = await prisma.systemConfig.findMany({
      where: {
        key: { startsWith: `mls:commit:${groupId}:` },
      },
    });

    const minEpoch = afterEpoch ? parseInt(afterEpoch) : 0;
    const commits: any[] = [];

    for (const config of configs) {
      const parts = config.key.split(':');
      const epoch = parseInt(parts[3] || '0');
      if (epoch > minEpoch) {
        try {
          const data = JSON.parse(config.value);
          commits.push({ epoch, ...data });
        } catch {}
      }
    }

    // 按 epoch 排序
    commits.sort((a, b) => a.epoch - b.epoch);
    res.json({ commits });
  } catch (err: any) {
    console.error('[MLS] 获取 Commits 失败:', err.message);
    res.status(500).json({ error: '获取失败' });
  }
});

// ============================================================
// 4. 身份密钥管理
// ============================================================

/**
 * POST /api/mls/register-identity
 * 注册 MLS 身份公钥
 */
mlsRouter.post('/register-identity', async (req: Request, res: Response) => {
  const { userId, identityKey } = req.body;

  if (!userId || !identityKey) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    const key = `mls:identity:${userId}`;
    await prisma.systemConfig.upsert({
      where: { key },
      update: {
        value: JSON.stringify({
          identityKey,
          updatedAt: new Date().toISOString(),
        }),
      },
      create: {
        key,
        value: JSON.stringify({
          identityKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      },
    });

    res.json({ ok: true });
  } catch (err: any) {
    console.error('[MLS] 注册身份密钥失败:', err.message);
    res.status(500).json({ error: '注册失败' });
  }
});

/**
 * GET /api/mls/get-identity?userId=xxx
 * 获取用户的 MLS 身份公钥
 */
mlsRouter.get('/get-identity', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId: string };

  if (!userId) {
    return res.status(400).json({ error: '缺少 userId' });
  }

  try {
    const key = `mls:identity:${userId}`;
    const config = await prisma.systemConfig.findUnique({ where: { key } });

    if (!config?.value) {
      return res.status(404).json({ error: '未找到身份密钥' });
    }

    const data = JSON.parse(config.value);
    res.json({ identityKey: data.identityKey });
  } catch (err: any) {
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * POST /api/mls/batch-get-identity
 * 批量获取用户身份公钥
 */
mlsRouter.post('/batch-get-identity', async (req: Request, res: Response) => {
  const { userIds } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: '缺少 userIds' });
  }

  try {
    const keys = userIds.map((id: string) => `mls:identity:${id}`);
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: keys } },
    });

    const result: Record<string, string> = {};
    for (const config of configs) {
      const userId = config.key.replace('mls:identity:', '');
      try {
        const data = JSON.parse(config.value);
        result[userId] = data.identityKey;
      } catch {}
    }

    res.json({ identityKeys: result });
  } catch (err: any) {
    res.status(500).json({ error: '批量获取失败' });
  }
});

// ============================================================
// 5. 统计与管理
// ============================================================

/**
 * GET /api/mls/stats?groupId=xxx
 * 获取群组 MLS 统计信息
 */
mlsRouter.get('/stats', async (req: Request, res: Response) => {
  const { groupId } = req.query as { groupId: string };

  if (!groupId) {
    return res.status(400).json({ error: '缺少 groupId' });
  }

  try {
    const mlsKey = `mls:group:${groupId}`;
    const config = await prisma.systemConfig.findUnique({ where: { key: mlsKey } });

    if (!config?.value) {
      return res.json({
        enabled: false,
        epoch: 0,
        memberCount: 0,
        treeSize: 0,
      });
    }

    const mlsState = JSON.parse(config.value);
    res.json({
      enabled: !!mlsState.enabled,
      epoch: mlsState.epoch || 0,
      memberCount: Object.keys(mlsState.members || {}).length,
      treeSize: (mlsState.treeSnapshot || []).length,
      enabledAt: mlsState.enabledAt,
      updatedAt: mlsState.updatedAt,
      lastCommitType: mlsState.lastCommitType,
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取统计失败' });
  }
});

export default mlsRouter;
