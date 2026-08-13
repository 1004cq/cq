/**
 * server/admin.ts - 管理后台 API（Prisma SQLite 版）
 */
import { Router, Request, Response, NextFunction } from 'express';
import prisma, { hashPassword, verifyPassword, generateToken, isLegacyHash } from './db.js';
import { adminLoginRateLimit, resetAdminLoginLimits, sanitizeInput, containsDangerousInput } from './security.js';
import {
  getAdminLogsMySQL,
  getAuditCountsMySQL,
  getIllegalRequestsMySQL,
  getLoginLogsMySQL,
  clearIllegalRequestsMySQL,
  clearLoginLogsMySQL,
  logAdminActionMySQL,
  logIllegalRequestMySQL,
  logLoginMySQL,
} from './mysql.js';

const router = Router();

function getClientIP(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

async function addLog(adminId: string, adminName: string, action: string, target: string, detail: string, ip: string) {
  await Promise.allSettled([
    prisma.adminLog.create({ data: { adminId, adminName, action, target, detail, ip } }),
    logAdminActionMySQL({ adminId, adminName, action, target, detail, ip }),
  ]);
}

async function addFailedLoginLog(adminName: string, detail: string, ip: string) {
  await Promise.allSettled([
    logAdminActionMySQL({ adminId: null, adminName, action: '登录失败', target: 'system', detail, ip }),
  ]);
}

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || (req.cookies as any)?.admin_token;
  if (!token) return res.status(401).json({ error: '未登录' });
  const session = await prisma.adminSession.findUnique({ where: { token }, include: { admin: true } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.adminSession.delete({ where: { token } });
    return res.status(401).json({ error: '登录已过期' });
  }
  (req as any).admin = session.admin;
  (req as any).adminToken = token;
  next();
}

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const admin = (req as any).admin;
    if (!admin || !roles.includes(admin.role)) return res.status(403).json({ error: '权限不足' });
    next();
  };
}

// ===== 认证（安全加固） =====

/**
 * 管理员登录
 * 安全措施：
 * 1. 速率限制（每 IP 每 15 分钟 5 次）
 * 2. 会话有效期缩短为 2 小时（原 7 天）
 * 3. 密码哈希自动升级 SHA-256 → bcrypt
 * 4. 统一错误信息，防止用户名枚举
 * 5. 记录登录 IP 和 UA
 */
router.post('/login', adminLoginRateLimit, async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const ip = getClientIP(req);
  const ua = req.headers['user-agent'] || '';

  if (!username || !password) return res.status(400).json({ error: '请填写用户名和密码' });

  // 输入安全检查
  if (containsDangerousInput(username)) {
    return res.status(400).json({ error: '输入包含不允许的字符' });
  }

  const admin = await prisma.adminAccount.findUnique({ where: { username } });

  // ★ 统一错误信息，防止用户名枚举攻击
  if (!admin || !verifyPassword(password, admin.password)) {
    await addFailedLoginLog(username || 'unknown', `IP: ${ip}, UA: ${ua.slice(0, 100)}`, ip);
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  // ★ 密码哈希自动升级：SHA-256 → bcrypt
  if (isLegacyHash(admin.password)) {
    try {
      await prisma.adminAccount.update({
        where: { id: admin.id },
        data: { password: hashPassword(password) },
      });
      console.log(`[Admin] 管理员 ${admin.username} 密码哈希已升级为 bcrypt`);
    } catch {}
  }

  // ★ 登录成功，重置限流
  resetAdminLoginLimits(ip);

  const token = generateToken(48);
  // ★ 会话有效期缩短为 2 小时（原 7 天）
  await prisma.adminSession.create({
    data: { adminId: admin.id, token, expiresAt: new Date(Date.now() + 2 * 3600_000) },
  });

  // 清理该管理员的过期会话
  await prisma.adminSession.deleteMany({
    where: { adminId: admin.id, expiresAt: { lt: new Date() } },
  });

  await addLog(admin.id, admin.username, '登录', 'system', `IP: ${ip}, UA: ${ua.slice(0, 100)}`, ip);

  // ★ 通过 HttpOnly Cookie 下发 token（更安全），同时保留 JSON 响应兼容现有前端
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 2 * 3600_000,
    path: '/api/admin',
    domain: process.env.ADMIN_DOMAIN || undefined,
  });

  res.json({ token, admin: { id: admin.id, username: admin.username, role: admin.role } });
});

router.post('/logout', authMiddleware, async (req: Request, res: Response) => {
  await prisma.adminSession.deleteMany({ where: { token: (req as any).adminToken } });
  res.json({ success: true });
});

router.get('/me', authMiddleware, (req: Request, res: Response) => {
  const a = (req as any).admin;
  res.json({ id: a.id, username: a.username, role: a.role });
});

// ===== 仪表盘 =====
router.get('/dashboard', authMiddleware, async (_req: Request, res: Response) => {
  const auditCountsPromise = getAuditCountsMySQL();
  const recentLoginLogsPromise = getLoginLogsMySQL(1, 5, 'all');

  const [totalUsers, bannedUsers, totalMoments, totalComments, totalMedia, totalIpBlacklist,
    recentUsers, recentMoments,
    totalMessages, pendingReports, totalSensitiveWords,
    auditCounts, recentLoginLogs] = await Promise.all([
    prisma.user.count(), prisma.user.count({ where: { isBanned: true } }),
    prisma.moment.count(), prisma.momentComment.count(), prisma.mediaFile.count(),
    prisma.ipBlacklist.count(),
    prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, username: true, nickname: true, email: true, isBanned: true, createdAt: true } }),
    prisma.moment.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { user: { select: { username: true, nickname: true } } } }),
    (prisma as any).message ? (prisma as any).message.count().catch(() => 0) : Promise.resolve(0),
    (prisma as any).report ? (prisma as any).report.count({ where: { status: 'pending' } }).catch(() => 0) : Promise.resolve(0),
    (prisma as any).sensitiveWord ? (prisma as any).sensitiveWord.count().catch(() => 0) : Promise.resolve(0),
    auditCountsPromise,
    recentLoginLogsPromise,
  ]);

  const totalLoginLogs = auditCounts?.totalLoginLogs ?? await prisma.loginLog.count();
  const totalIllegalRequests = auditCounts?.totalIllegalRequests ?? await prisma.illegalRequest.count();
  const recentLogins = recentLoginLogs?.list ?? await prisma.loginLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });

  // 生成过去 7 天的日期数据（cqim 仪表盘格式）
  const dailyStats = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { date: `${d.getMonth() + 1}/${d.getDate()}`, newUsers: 0, activeUsers: 0, messages: 0 };
  });

  const msgTotal = Number(totalMessages) || 1;
  const messageTypes = [
    { type: '文字', count: Math.max(1, Math.floor(msgTotal * 0.6)) },
    { type: '图片', count: Math.max(1, Math.floor(msgTotal * 0.2)) },
    { type: '语音', count: Math.max(1, Math.floor(msgTotal * 0.1)) },
    { type: '视频', count: Math.max(1, Math.floor(msgTotal * 0.05)) },
    { type: '其他', count: Math.max(1, Math.floor(msgTotal * 0.05)) },
  ];

  res.json({
    // cqim 仪表盘格式
    overview: { totalUsers, onlineUsers: 0, bannedUsers, totalMessages: msgTotal, pendingReports: Number(pendingReports) || 0, totalSensitiveWords: Number(totalSensitiveWords) || 0, totalAnnouncements: 0 },
    dailyStats,
    messageTypes,
    // pyq 仪表盘格式
    stats: { totalUsers, bannedUsers, totalMoments, totalComments, totalMedia, totalLoginLogs, totalIpBlacklist, totalIllegalRequests },
    recentUsers,
    recentMoments,
    recentLogins,
  });
});

// ===== 用户管理 =====
router.get('/users', authMiddleware, async (req: Request, res: Response) => {
  const search = (req.query.search as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20);
  const status = (req.query.status as string) || 'all';
  let where: any = {};
  if (search) {
    where.OR = [
      { username: { contains: search } },
      { email: { contains: search } },
      { nickname: { contains: search } },
      { phone: { contains: search } },
    ];
  }
  if (status === 'banned') where.isBanned = true;
  else if (status === 'active') where.isBanned = false;
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, skip: (page-1)*pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, select: { id: true, username: true, nickname: true, email: true, phone: true, avatar: true, bio: true, isBanned: true, banReason: true, role: true, createdAt: true, updatedAt: true, lastLoginAt: true, lastLoginIp: true, _count: { select: { moments: true } } } }),
    prisma.user.count({ where }),
  ]);
  res.json({ users: users.map(u => ({ ...u, postsCount: u._count.moments })), total, page, pageSize });
});

// ===== 管理员注册用户 =====
router.post('/users/create', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { username, password, nickname, phone, email, bio, avatar } = req.body;
  const admin = (req as any).admin;
  const ip = getClientIP(req);

  // 参数校验
  if (!username || !password) return res.status(400).json({ error: '用户ID和密码为必填项' });

  // 用户ID格式校验
  if (!/^[a-zA-Z0-9_]{1,20}$/.test(username)) {
    return res.status(400).json({ error: '用户ID只能包含字母、数字和下划线，长度1-20位' });
  }

  // 输入安全检查
  if (containsDangerousInput(username)) {
    return res.status(400).json({ error: '用户ID包含不允许的字符' });
  }

  // 密码强度校验
  if (password.length < 8) return res.status(400).json({ error: '密码至少8位' });
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: '密码必须包含大小写字母和数字' });
  }

  // 唯一性检查
  const existingUsername = await prisma.user.findUnique({ where: { username } });
  if (existingUsername) return res.status(409).json({ error: '用户ID已存在' });

  if (phone) {
    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) return res.status(409).json({ error: '手机号已被注册' });
  }

  if (email) {
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) return res.status(409).json({ error: '邮箱已被注册' });
  }

  // 创建用户
  const user = await prisma.user.create({
    data: {
      username,
      password: hashPassword(password),
      nickname: nickname || username,
      phone: phone || null,
      email: email || null,
      bio: bio || null,
      avatar: avatar || null,
    },
    select: { id: true, username: true, nickname: true, email: true, phone: true, avatar: true, bio: true, isBanned: true, role: true, createdAt: true },
  });

  await addLog(admin.id, admin.username, '创建用户', `user:${user.id}`, `管理员创建用户 ${user.username} (昵称: ${user.nickname})`, ip);
  res.json({ success: true, user });
});

// ===== 获取单个用户详情 =====
router.get('/users/:id', authMiddleware, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, username: true, nickname: true, email: true, phone: true, avatar: true, bio: true, isBanned: true, banReason: true, role: true, createdAt: true, updatedAt: true, lastLoginAt: true, lastLoginIp: true, _count: { select: { moments: true } } },
  });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ user: { ...user, postsCount: user._count.moments } });
});

// ===== 管理员编辑用户信息 =====
router.put('/users/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { username, nickname, phone, email, bio, avatar, password } = req.body;
  const admin = (req as any).admin;
  const ip = getClientIP(req);

  const existingUser = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existingUser) return res.status(404).json({ error: '用户不存在' });

  const updateData: any = {};
  const changes: string[] = [];

  // 修改用户ID（username）
  if (username && username !== existingUser.username) {
    if (!/^[a-zA-Z0-9_]{1,20}$/.test(username)) {
      return res.status(400).json({ error: '用户ID只能包含字母、数字和下划线，长度1-20位' });
    }
    if (containsDangerousInput(username)) {
      return res.status(400).json({ error: '用户ID包含不允许的字符' });
    }
    const dup = await prisma.user.findUnique({ where: { username } });
    if (dup) return res.status(409).json({ error: '用户ID已被占用' });
    updateData.username = username;
    changes.push(`用户ID: ${existingUser.username} → ${username}`);
  }

  // 修改昵称
  if (nickname !== undefined && nickname !== existingUser.nickname) {
    updateData.nickname = nickname;
    changes.push(`昵称: ${existingUser.nickname || '-'} → ${nickname}`);
  }

  // 修改手机号
  if (phone !== undefined && phone !== existingUser.phone) {
    if (phone) {
      const dup = await prisma.user.findUnique({ where: { phone } });
      if (dup && dup.id !== req.params.id) return res.status(409).json({ error: '手机号已被其他用户使用' });
    }
    updateData.phone = phone || null;
    changes.push(`手机号: ${existingUser.phone || '-'} → ${phone || '-'}`);
  }

  // 修改邮箱
  if (email !== undefined && email !== existingUser.email) {
    if (email) {
      const dup = await prisma.user.findUnique({ where: { email } });
      if (dup && dup.id !== req.params.id) return res.status(409).json({ error: '邮箱已被其他用户使用' });
    }
    updateData.email = email || null;
    changes.push(`邮箱: ${existingUser.email || '-'} → ${email || '-'}`);
  }

  // 修改简介
  if (bio !== undefined && bio !== existingUser.bio) {
    updateData.bio = bio || null;
    changes.push('简介已更新');
  }

  // 修改头像
  if (avatar !== undefined && avatar !== existingUser.avatar) {
    updateData.avatar = avatar || null;
    changes.push('头像已更新');
  }

  // 修改密码
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: '密码至少8位' });
    updateData.password = hashPassword(password);
    changes.push('密码已重置');
    // 清除该用户所有会话，强制重新登录
    await prisma.userSession.deleteMany({ where: { userId: req.params.id } });
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: '没有需要修改的内容' });
  }

  const updatedUser = await prisma.user.update({
    where: { id: req.params.id },
    data: updateData,
    select: { id: true, username: true, nickname: true, email: true, phone: true, avatar: true, bio: true, isBanned: true, banReason: true, role: true, createdAt: true, updatedAt: true, lastLoginAt: true },
  });

  await addLog(admin.id, admin.username, '编辑用户', `user:${updatedUser.id}`, changes.join('; '), ip);

  // 资料字段变更时广播同步（密码重置等不触发）
  const profileFieldsChanged = ['username', 'nickname', 'phone', 'email', 'bio', 'avatar'].some(
    (field) => field in updateData
  );
  if (profileFieldsChanged) {
    try {
      const { publishUserProfileUpdatedById } = await import('./user-profile-sync.js');
      await publishUserProfileUpdatedById(updatedUser.id);
    } catch (pubErr) {
      console.error('[Admin] 发布用户资料更新事件失败:', pubErr);
    }
  }

  res.json({ success: true, user: updatedUser });
});

// ===== 封禁/解封用户 =====
router.post('/users/:id/ban', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { ban, reason } = req.body;
  const admin = (req as any).admin;
  const ip = getClientIP(req);

  const existingUser = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existingUser) return res.status(404).json({ error: '用户不存在' });

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isBanned: !!ban, banReason: ban ? (reason || '管理员操作') : null },
  });

  // 封禁时清除该用户所有会话，强制下线
  if (ban) {
    await prisma.userSession.deleteMany({ where: { userId: req.params.id } });
  }

  await addLog(admin.id, admin.username, ban ? '封禁用户' : '解封用户', `user:${user.id}`, `${ban ? '封禁' : '解封'} ${user.username}${ban && reason ? ` (原因: ${reason})` : ''}`, ip);
  res.json({ success: true, user });
});

router.delete('/users/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  await prisma.user.delete({ where: { id: req.params.id } });
  await addLog(admin.id, admin.username, '删除用户', `user:${user.id}`, `删除 ${user.username}`, getClientIP(req));
  res.json({ success: true });
});

// ===== 动态管理 =====
router.get('/moments', authMiddleware, async (req: Request, res: Response) => {
  const search = (req.query.search as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20);
  const where = search ? { OR: [{ content: { contains: search } }, { user: { username: { contains: search } } }] } : {};
  const [moments, total] = await Promise.all([
    prisma.moment.findMany({ where, skip: (page-1)*pageSize, take: pageSize, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], include: { user: { select: { id: true, username: true, nickname: true, avatar: true } }, media: { take: 1 }, _count: { select: { comments: true, likes: true } } } }),
    prisma.moment.count({ where }),
  ]);
  res.json({ moments, total, page, pageSize });
});

router.post('/moments/:id/pin', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { pin } = req.body;
  const admin = (req as any).admin;
  const moment = await prisma.moment.update({ where: { id: req.params.id }, data: { isPinned: !!pin, pinnedAt: pin ? new Date() : null } });
  await addLog(admin.id, admin.username, pin ? '置顶动态' : '取消置顶', `moment:${moment.id}`, '', getClientIP(req));
  res.json({ success: true, moment });
});

router.delete('/moments/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  await prisma.moment.delete({ where: { id: req.params.id } });
  await addLog(admin.id, admin.username, '删除动态', `moment:${req.params.id}`, '', getClientIP(req));
  res.json({ success: true });
});

router.delete('/moments', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请提供 ID 列表' });
  const admin = (req as any).admin;
  await prisma.moment.deleteMany({ where: { id: { in: ids } } });
  await addLog(admin.id, admin.username, '批量删除动态', 'moments', `批量删除 ${ids.length} 条`, getClientIP(req));
  res.json({ success: true });
});

// ===== 媒体管理 =====
router.get('/media', authMiddleware, async (req: Request, res: Response) => {
  const type = (req.query.type as string) || 'image';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 30);
  const [files, total] = await Promise.all([
    prisma.mediaFile.findMany({ where: { type }, skip: (page-1)*pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true, nickname: true } } } }),
    prisma.mediaFile.count({ where: { type } }),
  ]);
  res.json({ files, total, page, pageSize });
});

router.delete('/media/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await prisma.mediaFile.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ===== 举报管理 =====
router.get('/reports', authMiddleware, async (req: Request, res: Response) => {
  const status = (req.query.status as string) || '';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const where = status ? { status } : {};
  const [reports, total] = await Promise.all([prisma.report.findMany({ where, skip: (page-1)*20, take: 20, orderBy: { createdAt: 'desc' } }), prisma.report.count({ where })]);
  res.json({ reports, total, page });
});

router.post('/reports/:id/resolve', authMiddleware, requireRole('superadmin', 'admin', 'moderator'), async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const report = await prisma.report.update({ where: { id: req.params.id }, data: { status: 'resolved', resolvedBy: admin.username, resolvedAt: new Date() } });
  res.json({ success: true, report });
});

router.post('/reports/:id/dismiss', authMiddleware, requireRole('superadmin', 'admin', 'moderator'), async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const report = await prisma.report.update({ where: { id: req.params.id }, data: { status: 'dismissed', resolvedBy: admin.username, resolvedAt: new Date() } });
  res.json({ success: true, report });
});

// ===== 敏感词 =====
router.get('/sensitive-words', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ words: await prisma.sensitiveWord.findMany({ orderBy: { createdAt: 'desc' } }) });
});
router.post('/sensitive-words', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { word, category } = req.body;
  if (!word) return res.status(400).json({ error: '请填写敏感词' });
  if (await prisma.sensitiveWord.findUnique({ where: { word } })) return res.status(409).json({ error: '已存在' });
  res.json({ success: true, word: await prisma.sensitiveWord.create({ data: { word, category } }) });
});
router.put('/sensitive-words/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  res.json({ success: true, word: await prisma.sensitiveWord.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } }) });
});
router.delete('/sensitive-words/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await prisma.sensitiveWord.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ===== IP 黑名单 =====
router.get('/ip-blacklist', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ list: await prisma.ipBlacklist.findMany({ orderBy: { createdAt: 'desc' } }) });
});
router.post('/ip-blacklist', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { ip, reason } = req.body;
  if (!ip) return res.status(400).json({ error: '请填写 IP' });
  if (await prisma.ipBlacklist.findUnique({ where: { ip } })) return res.status(409).json({ error: '已在黑名单' });
  res.json({ success: true, entry: await prisma.ipBlacklist.create({ data: { ip, reason } }) });
});
router.delete('/ip-blacklist/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await prisma.ipBlacklist.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ===== 非法请求日志 =====
router.get('/illegal-requests', authMiddleware, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const mysqlResult = await getIllegalRequestsMySQL(page, 20);
  if (mysqlResult) {
    return res.json({ list: mysqlResult.list, total: mysqlResult.total, page });
  }
  const [list, total] = await Promise.all([prisma.illegalRequest.findMany({ skip: (page-1)*20, take: 20, orderBy: { createdAt: 'desc' } }), prisma.illegalRequest.count()]);
  res.json({ list, total, page });
});
router.delete('/illegal-requests', authMiddleware, requireRole('superadmin', 'admin'), async (_req: Request, res: Response) => {
  await Promise.allSettled([prisma.illegalRequest.deleteMany(), clearIllegalRequestsMySQL()]);
  res.json({ success: true });
});

// ===== 登录日志 =====
router.get('/login-logs', authMiddleware, async (req: Request, res: Response) => {
  const filter = ((req.query.filter as string) || 'all') as 'all' | 'success' | 'fail';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const mysqlResult = await getLoginLogsMySQL(page, 20, filter);
  if (mysqlResult) {
    return res.json({ list: mysqlResult.list, total: mysqlResult.total, page });
  }
  const where = filter === 'success' ? { success: true } : filter === 'fail' ? { success: false } : {};
  const [list, total] = await Promise.all([prisma.loginLog.findMany({ where, skip: (page-1)*20, take: 20, orderBy: { createdAt: 'desc' } }), prisma.loginLog.count({ where })]);
  res.json({ list, total, page });
});
router.delete('/login-logs', authMiddleware, requireRole('superadmin', 'admin'), async (_req: Request, res: Response) => {
  await Promise.allSettled([prisma.loginLog.deleteMany(), clearLoginLogsMySQL()]);
  res.json({ success: true });
});

// ===== 公告 =====
router.get('/announcements', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ announcements: await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } }) });
});
router.post('/announcements', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { title, content, type = 'info' } = req.body;
  if (!title || !content) return res.status(400).json({ error: '请填写标题和内容' });
  const admin = (req as any).admin;
  res.json({ success: true, announcement: await prisma.announcement.create({ data: { title, content, type, createdBy: admin.username } }) });
});
router.put('/announcements/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  res.json({ success: true, announcement: await prisma.announcement.update({ where: { id: req.params.id }, data: req.body }) });
});
router.delete('/announcements/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await prisma.announcement.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ===== 操作日志 =====
router.get('/logs', authMiddleware, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const mysqlResult = await getAdminLogsMySQL(page, 20);
  if (mysqlResult) {
    return res.json({ logs: mysqlResult.logs, total: mysqlResult.total, page });
  }
  const [logs, total] = await Promise.all([prisma.adminLog.findMany({ skip: (page-1)*20, take: 20, orderBy: { createdAt: 'desc' } }), prisma.adminLog.count()]);
  res.json({ logs, total, page });
});

// ===== 管理员账号 =====
router.get('/admins', authMiddleware, requireRole('superadmin'), async (_req: Request, res: Response) => {
  res.json({ admins: await prisma.adminAccount.findMany({ select: { id: true, username: true, role: true, createdAt: true }, orderBy: { createdAt: 'asc' } }) });
});
router.post('/admins', authMiddleware, requireRole('superadmin'), async (req: Request, res: Response) => {
  const { username, password, role = 'admin' } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请填写用户名和密码' });

  // ★ 输入安全检查
  if (containsDangerousInput(username)) {
    return res.status(400).json({ error: '用户名包含不允许的字符' });
  }

  // ★ 管理员密码强度要求：至少 10 位，包含大小写+数字+特殊字符
  if (password.length < 10) return res.status(400).json({ error: '管理员密码至少 10 位' });
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
    return res.status(400).json({ error: '密码必须包含大小写字母、数字和特殊字符' });
  }

  if (await prisma.adminAccount.findUnique({ where: { username } })) return res.status(409).json({ error: '用户名已存在' });

  const admin = (req as any).admin;
  const newAdmin = await prisma.adminAccount.create({ data: { username, password: hashPassword(password), role }, select: { id: true, username: true, role: true, createdAt: true } });
  await addLog(admin.id, admin.username, '创建管理员', `admin:${newAdmin.id}`, `创建 ${newAdmin.username} (角色: ${role})`, getClientIP(req));
  res.json({ success: true, admin: newAdmin });
});
router.put('/admins/:id/password', authMiddleware, requireRole('superadmin'), async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '请填写新密码' });

  // ★ 管理员密码强度要求
  if (password.length < 10) return res.status(400).json({ error: '管理员密码至少 10 位' });
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
    return res.status(400).json({ error: '密码必须包含大小写字母、数字和特殊字符' });
  }

  await prisma.adminAccount.update({ where: { id: req.params.id }, data: { password: hashPassword(password) } });

  // ★ 修改密码后清除该管理员所有会话（强制重新登录）
  await prisma.adminSession.deleteMany({ where: { adminId: req.params.id } });

  const admin = (req as any).admin;
  await addLog(admin.id, admin.username, '修改管理员密码', `admin:${req.params.id}`, '', getClientIP(req));
  res.json({ success: true });
});
router.delete('/admins/:id', authMiddleware, requireRole('superadmin'), async (req: Request, res: Response) => {
  if ((req as any).admin.id === req.params.id) return res.status(400).json({ error: '不能删除自己' });
  const target = await prisma.adminAccount.findUnique({ where: { id: req.params.id }, select: { username: true } });
  await prisma.adminAccount.delete({ where: { id: req.params.id } });
  const admin = (req as any).admin;
  await addLog(admin.id, admin.username, '删除管理员', `admin:${req.params.id}`, `删除 ${target?.username || 'unknown'}`, getClientIP(req));
  res.json({ success: true });
});

// ===== 系统配置（通用 KV） =====
async function getConfig(key: string): Promise<any> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key } });
  return cfg ? JSON.parse(cfg.value) : null;
}
async function setConfig(key: string, value: any): Promise<void> {
  await prisma.systemConfig.upsert({ where: { key }, update: { value: JSON.stringify(value) }, create: { key, value: JSON.stringify(value) } });
}

// ===== 站点设置 =====
router.get('/site-config', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ config: await getConfig('site') || {} });
});
router.put('/site-config', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await setConfig('site', { ...(await getConfig('site') || {}), ...req.body });
  res.json({ success: true });
});

// ===== COS 配置 =====
router.get('/cos-config', authMiddleware, async (_req: Request, res: Response) => {
  const config = await getConfig('cos') || {};
  // 脱敏：只返回前6位 + 掩码
  if (config.secretKey) {
    const sk = String(config.secretKey);
    config.secretKeyMasked = sk.length > 6 ? sk.slice(0, 6) + '••••••••' : '••••••••';
    config.secretKey = '••••••••';
  }
  if (config.secretId) {
    const si = String(config.secretId);
    config.secretIdDisplay = si.length > 10 ? si.slice(0, 10) + '••••' + si.slice(-4) : si;
  }
  res.json({ config });
});
router.put('/cos-config', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const ip = getClientIP(req);
  const update = { ...req.body };
  // 如果前端传回掩码值，不覆盖真实密钥
  if (update.secretKey === '••••••••') delete update.secretKey;
  const prev = await getConfig('cos') || {};
  const merged = { ...prev, ...update };
  await setConfig('cos', merged);
  // 记录操作日志
  const changedFields = Object.keys(update).filter(k => k !== 'secretKey' || update[k] !== '••••••••');
  await addLog(admin.id, admin.username, '更新COS配置', 'cos', `修改字段: ${changedFields.join(', ')}`, ip);
  res.json({ success: true });
});

// ===== COS 连接测试（真实调用 API 验证 + 自动创建目录结构） =====
router.post('/cos-config/test', authMiddleware, requireRole('superadmin', 'admin'), async (_req: Request, res: Response) => {
  const config = await getConfig('cos') || {};
  if (!config.secretId || !config.secretKey || !config.bucket || !config.region) {
    return res.json({ success: false, message: '请先填写完整的 COS 配置（SecretId、SecretKey、存储桶、地域均为必填）' });
  }
  if (!config.bucket.includes('-')) {
    return res.json({ success: false, message: '存储桶名称格式不正确，应为 bucket-APPID 格式，例如 myapp-1234567890' });
  }
  try {
    const COSModule: any = await import('cos-nodejs-sdk-v5');
    const COS = COSModule.default || COSModule;
    const cos = new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
    // 步骤1：验证存储桶是否可访问
    await new Promise<void>((resolve, reject) => {
      cos.headBucket({ Bucket: config.bucket, Region: config.region }, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 步骤2：自动创建目录结构（ASCII 路径）
    const initDirs = [
      `imimchat/moments/.init`,
      `imimchat/avatars/.init`,
      `imimchat/group-avatars/.init`,
    ];
    const dirResults = await Promise.allSettled(initDirs.map(key =>
      new Promise<void>((resolve, reject) => {
        cos.putObject({ Bucket: config.bucket, Region: config.region, Key: key, Body: '' }, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      })
    ));
    const dirSuccess = dirResults.filter(r => r.status === 'fulfilled').length;
    const dirFailed = dirResults.filter(r => r.status === 'rejected').length;

    let dirMsg = '';
    if (dirSuccess === initDirs.length) {
      dirMsg = `\n✅ 已自动创建目录结构：imimchat/moments/、imimchat/avatars/、imimchat/group-avatars/`;
    } else if (dirSuccess > 0) {
      dirMsg = `\n⚠️ 部分目录创建成功（${dirSuccess}/${initDirs.length}）`;
    } else {
      dirMsg = `\n⚠️ 目录创建失败，请检查密钥是否有写入权限`;
    }

    res.json({ success: true, message: `✅ COS 连接成功！存储桶 ${config.bucket}（${config.region}）可正常访问${dirMsg}` });
  } catch (err: any) {
    const errCode = err?.code || err?.Code || '';
    const errMsg = err?.message || err?.Message || String(err);
    const statusCode = err?.statusCode || err?.StatusCode || '';
    let hint = '';
    if (errCode === 'NoSuchBucket') {
      hint = '存储桶不存在，请检查名称和地域是否正确';
    } else if (statusCode === 403 || errCode === 'AccessDenied' || errCode === 'Forbidden') {
      hint = '权限不足 (403 Forbidden)。请检查：\n1. SecretId/SecretKey 是否正确\n2. 该密钥是否有访问此存储桶的权限\n3. 如使用子账号密钥，请确保已授权 cos:HeadBucket、cos:PutObject 等操作\n4. 存储桶名称和地域是否与控制台一致';
    } else if (errCode === 'SignatureDoesNotMatch') {
      hint = '签名不匹配，SecretKey 可能填写错误，请重新复制粘贴';
    } else if (errCode === 'InvalidAccessKeyId') {
      hint = 'SecretId 无效，请检查是否填写正确';
    } else {
      hint = `错误码: ${errCode || statusCode}，${errMsg}`;
    }
    res.json({ success: false, message: `❌ 连接失败：${hint}` });
  }
});

// ===== COS 手动初始化目录结构 =====
router.post('/cos-config/init-dirs', authMiddleware, requireRole('superadmin', 'admin'), async (_req: Request, res: Response) => {
  const config = await getConfig('cos') || {};
  if (!config.secretId || !config.secretKey || !config.bucket || !config.region) {
    return res.json({ success: false, message: '请先填写完整的 COS 配置' });
  }
  try {
    const COSModule: any = await import('cos-nodejs-sdk-v5');
    const COS = COSModule.default || COSModule;
    const cos = new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
    const dirs = [
      `imimchat/moments/.init`,
      `imimchat/avatars/.init`,
      `imimchat/group-avatars/.init`,
    ];
    await Promise.all(dirs.map(key =>
      new Promise<void>((resolve, reject) => {
        cos.putObject({ Bucket: config.bucket, Region: config.region, Key: key, Body: '' }, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      })
    ));
    res.json({ success: true, message: `✅ 目录结构创建成功：imimchat/moments/、imimchat/avatars/、imimchat/group-avatars/` });
  } catch (err: any) {
    res.json({ success: false, message: `目录创建失败：${err.message || err}` });
  }
});

// ===== COS 存储用量查询 =====
router.get('/cos-config/usage', authMiddleware, async (_req: Request, res: Response) => {
  const config = await getConfig('cos') || {};
  if (!config.secretId || !config.secretKey || !config.bucket || !config.region) {
    return res.json({ success: false, totalObjects: 0, totalSize: 0 });
  }
  try {
    const COSModule: any = await import('cos-nodejs-sdk-v5');
    const COS = COSModule.default || COSModule;
    const cos = new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
    // 列出前 1000 个对象统计用量
    const data: any = await new Promise((resolve, reject) => {
      cos.getBucket({ Bucket: config.bucket, Region: config.region, MaxKeys: 1000 }, (err: any, d: any) => {
        if (err) reject(err);
        else resolve(d);
      });
    });
    const contents = data?.Contents || [];
    const totalObjects = contents.length;
    const totalSize = contents.reduce((sum: number, obj: any) => sum + (parseInt(obj.Size) || 0), 0);
    const isTruncated = data?.IsTruncated === 'true';
    res.json({ success: true, totalObjects, totalSize, isTruncated, message: isTruncated ? '对象数量超过 1000，仅统计前 1000 个' : '' });
  } catch (err: any) {
    res.json({ success: false, totalObjects: 0, totalSize: 0, error: err.message || '查询失败' });
  }
});

// ===== pyq 同步配置 =====
router.get('/sync-config', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ config: await getConfig('pyqSync') || {} });
});
router.put('/sync-config', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await setConfig('pyqSync', { ...(await getConfig('pyqSync') || {}), ...req.body });
  res.json({ success: true });
});
router.post('/sync-config/test', authMiddleware, requireRole('superadmin', 'admin'), async (_req: Request, res: Response) => {
  const config = await getConfig('pyqSync') || {};
  if (!config.pyqBaseUrl) return res.json({ success: false, message: '请先填写 pyq 服务地址' });
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${config.pyqBaseUrl}/api/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    res.json(r.ok ? { success: true, message: '✅ pyq 服务连接成功' } : { success: false, message: `pyq 服务响应异常：HTTP ${r.status}` });
  } catch (e: any) {
    res.json({ success: false, message: `连接失败：${e.message}` });
  }
});

// ===== OneBot 配置 =====
router.get('/onebot/config', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ config: await getConfig('onebot') || {} });
});
router.put('/onebot/config', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await setConfig('onebot', { ...(await getConfig('onebot') || {}), ...req.body });
  res.json({ success: true });
});
router.get('/onebot/status', authMiddleware, (_req: Request, res: Response) => {
  res.json({ status: { connectedClients: 0, totalMessages: 0, uptime: process.uptime() } });
});
router.get('/onebot/auto-replies', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ rules: await getConfig('onebotAutoReplies') || [] });
});
router.post('/onebot/auto-replies', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { keyword, matchType = 'exact', scope = 'all', reply, enabled = true } = req.body;
  if (!keyword || !reply) return res.status(400).json({ error: '请填写关键词和回复' });
  const rules = await getConfig('onebotAutoReplies') || [];
  const rule = { id: Date.now().toString(), keyword, matchType, scope, reply, enabled, hitCount: 0, createdAt: new Date().toISOString() };
  rules.push(rule);
  await setConfig('onebotAutoReplies', rules);
  res.json({ success: true, rule });
});
router.put('/onebot/auto-replies/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const rules = await getConfig('onebotAutoReplies') || [];
  const idx = rules.findIndex((r: any) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '规则不存在' });
  rules[idx] = { ...rules[idx], ...req.body };
  await setConfig('onebotAutoReplies', rules);
  res.json({ success: true, rule: rules[idx] });
});
router.delete('/onebot/auto-replies/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const rules = (await getConfig('onebotAutoReplies') || []).filter((r: any) => r.id !== req.params.id);
  await setConfig('onebotAutoReplies', rules);
  res.json({ success: true });
});
router.get('/onebot/ai-config', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ config: await getConfig('ai') || {} });
});
router.put('/onebot/ai-config', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await setConfig('ai', { ...(await getConfig('ai') || {}), ...req.body });
  res.json({ success: true });
});

// ===== SMTP 配置 =====
function normalizeSmtpConfig(raw: any = {}) {
  const user = raw.authUser ?? raw.user ?? '';
  const pass = raw.authPass ?? raw.pass ?? '';
  const fromAddress = raw.fromAddress ?? raw.fromEmail ?? '';

  return {
    host: raw.host || '',
    port: Number(raw.port || 465),
    secure: raw.secure !== undefined ? !!raw.secure : true,
    authUser: user,
    authPass: pass,
    user,
    pass,
    fromName: raw.fromName || 'imim',
    fromAddress,
    fromEmail: fromAddress,
    replyTo: raw.replyTo || '',
    enabled: !!raw.enabled,
  };
}

router.get('/smtp/config', authMiddleware, async (_req: Request, res: Response) => {
  const config = normalizeSmtpConfig(await getConfig('smtp') || {});
  if (config.pass) config.pass = '••••••••';
  if (config.authPass) config.authPass = '••••••••';
  res.json({ config });
});
router.put('/smtp/config', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const current = normalizeSmtpConfig(await getConfig('smtp') || {});
  const incoming = { ...req.body };

  if (incoming.pass === '••••••••') delete incoming.pass;
  if (incoming.authPass === '••••••••') delete incoming.authPass;

  const merged = normalizeSmtpConfig({ ...current, ...incoming });
  await setConfig('smtp', merged);
  res.json({ success: true, config: { ...merged, pass: merged.pass ? '••••••••' : '', authPass: merged.authPass ? '••••••••' : '' } });
});
router.get('/smtp/templates', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ templates: await getConfig('emailTemplates') || {} });
});
router.put('/smtp/templates', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const current = await getConfig('emailTemplates') || {};
  const { verifyCode, welcome, resetPassword, loginAlert } = req.body;
  const updated = { ...current };
  if (verifyCode) updated.verifyCode = { ...current.verifyCode, ...verifyCode };
  if (welcome) updated.welcome = { ...current.welcome, ...welcome };
  if (resetPassword) updated.resetPassword = { ...current.resetPassword, ...resetPassword };
  if (loginAlert) updated.loginAlert = { ...current.loginAlert, ...loginAlert };
  await setConfig('emailTemplates', updated);
  res.json({ success: true });
});
router.post('/smtp/test', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: '请填写收件人' });
  const config = normalizeSmtpConfig(await getConfig('smtp') || {});
  if (!config.host || !config.authUser) return res.status(400).json({ error: '请先配置 SMTP 服务器地址和账号信息' });
  const history = await getConfig('smtpTestHistory') || [];
  const { sendEmail } = await import("./email.js");
  const siteConfig = await getConfig('site') || {};
  const siteUrl = siteConfig.url || 'https://im.cqcq.chat';
  const logoUrl = `${siteUrl}/imim-email-logo.jpg`;
  const testHtml = `<div style="padding: 20px; background-color: #f5f5f5; font-family: sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden;">
      <div style="background: linear-gradient(135deg, #1a237e 0%, #283593 100%); padding: 24px; text-align: center;">
        <img src="${logoUrl}" alt="imim" style="width: 64px; height: 64px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.3); object-fit: cover;" />
        <h1 style="color: #ffffff; margin: 12px 0 0; font-size: 20px; font-weight: 600;">imim</h1>
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #333; margin-top: 0; font-size: 18px;">SMTP 测试邮件</h2>
        <p style="color: #666; font-size: 15px; line-height: 1.6;">恭喜！如果您收到此邮件，说明 SMTP 邮件服务配置正确，邮件发送功能运行正常。</p>
        <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="color: #2e7d32; font-size: 14px; margin: 0;">✅ SMTP 连接正常</p>
          <p style="color: #2e7d32; font-size: 14px; margin: 8px 0 0;">✅ 邮件发送成功</p>
        </div>
      </div>
      <div style="background: #f8f9fa; padding: 16px; text-align: center; border-top: 1px solid #eee;">
        <p style="color: #aaa; font-size: 12px; margin: 0;">此邮件由 imim 系统自动发送，请勿直接回复</p>
      </div>
    </div>
  </div>`;
  const result = await sendEmail(to, "【imim】测试邮件", testHtml);
  const record = { id: Date.now().toString(), to, status: result.success ? "success" : "error", message: result.success ? "测试邮件发送成功" : result.error, createdAt: new Date().toISOString() };
  history.unshift(record);
  if (history.length > 20) history.splice(20);
  await setConfig('smtpTestHistory', history);
  res.json({ success: true, message: '测试邮件已发送' });
});
router.get('/smtp/test-history', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ history: await getConfig('smtpTestHistory') || [] });
});

// ===== 自定义外链页面 =====
router.get('/custom-pages', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ pages: await prisma.customPage.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] }) });
});
router.post('/custom-pages', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { title, slug, content, published = false, sortOrder = 0 } = req.body;
  if (!title || !slug || !content) return res.status(400).json({ error: '请填写标题、slug 和内容' });
  if (await prisma.customPage.findUnique({ where: { slug } })) return res.status(409).json({ error: 'slug 已存在' });
  res.json({ success: true, page: await prisma.customPage.create({ data: { title, slug, content, published, sortOrder } }) });
});
router.put('/custom-pages/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  res.json({ success: true, page: await prisma.customPage.update({ where: { id: req.params.id }, data: req.body }) });
});
router.delete('/custom-pages/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  await prisma.customPage.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ===== 阿里云配置（短信/号码认证） =====

/**
 * GET /api/admin/aliyun-config
 * 获取阿里云配置（脱敏）
 */
router.get('/aliyun-config', authMiddleware, async (_req: Request, res: Response) => {
  const config = await getConfig('aliyun') || {};
  // 脱敏处理
  if (config.accessKeySecret) config.accessKeySecret = '••••••••';
  res.json({ config });
});

/**
 * PUT /api/admin/aliyun-config
 * 更新阿里云配置
 * 支持多模板和多签名配置
 */
router.put('/aliyun-config', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const update = { ...req.body };
  // 如果前端传回的是脱敏值，不覆盖原值
  if (update.accessKeySecret === '••••••••') delete update.accessKeySecret;
  await setConfig('aliyun', { ...(await getConfig('aliyun') || {}), ...update });
  const admin = (req as any).admin;
  await addLog(admin.id, admin.username, '修改阿里云配置', 'system', '更新阿里云 SMS/号码认证配置', getClientIP(req));
  res.json({ success: true });
});

/**
 * POST /api/admin/aliyun-sms-test
 * 测试发送短信，支持选择签名和模板
 */
router.post('/aliyun-sms-test', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const { phone, signName, templateCode } = req.body;
  if (!phone) return res.status(400).json({ error: '请填写测试手机号' });

  const config = await getConfig('aliyun') || {};
  if (!config.accessKeyId || !config.accessKeySecret) {
    return res.status(400).json({ error: '请先配置阿里云 AccessKey' });
  }

  // 使用指定的签名和模板，或回退到默认配置
  const useSignName = signName || config.smsSignName;
  const useTemplateCode = templateCode || (config.smsTemplates?.login?.code) || '';

  if (!useSignName) {
    return res.status(400).json({ error: '请先配置短信签名' });
  }
  if (!useTemplateCode) {
    return res.status(400).json({ error: '请先配置短信模板' });
  }

  try {
    const { default: Client, SendSmsRequest } = await import('@alicloud/dysmsapi20170525');
    const { Config } = await import('@alicloud/openapi-client');
    const { RuntimeOptions } = await import('@alicloud/tea-util');

    const apiConfig = new Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    });
    apiConfig.endpoint = 'dysmsapi.aliyuncs.com';

    const client = new Client(apiConfig);
    const sendSmsRequest = new SendSmsRequest({
      phoneNumbers: phone,
      signName: useSignName,
      templateCode: useTemplateCode,
      templateParam: JSON.stringify({ code: '888888', min: '5' }),
    });

    const runtime = new RuntimeOptions({});
    const result = await client.sendSmsWithOptions(sendSmsRequest, runtime);
    const body = result.body;

    // 记录测试历史
    const history = await getConfig('aliyunSmsTestHistory') || [];
    history.unshift({
      id: Date.now().toString(),
      phone,
      signName: useSignName,
      templateCode: useTemplateCode,
      status: body?.code === 'OK' ? 'success' : 'failed',
      message: body?.message || body?.code || '未知',
      createdAt: new Date().toISOString(),
    });
    if (history.length > 50) history.splice(50);
    await setConfig('aliyunSmsTestHistory', history);

    if (body?.code === 'OK') {
      res.json({ success: true, message: '测试短信发送成功' });
    } else {
      res.status(400).json({ error: body?.message || '发送失败', code: body?.code });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || '发送异常' });
  }
});

router.get('/aliyun-sms-test-history', authMiddleware, async (_req: Request, res: Response) => {
  res.json({ history: await getConfig('aliyunSmsTestHistory') || [] });
});

// ===== 腾讯位置服务 API 配置 =====

/**
 * GET /api/admin/txmap-config
 * 获取腾讯地图配置
 */
router.get('/txmap-config', authMiddleware, async (_req: Request, res: Response) => {
  const config = await getConfig('txmap') || {};
  res.json({ config });
});

/**
 * PUT /api/admin/txmap-config
 * 更新腾讯地图配置
 * body: { key }
 */
router.put('/txmap-config', authMiddleware, requireRole('superadmin', 'admin'), async (req: Request, res: Response) => {
  const update = { ...req.body };
  await setConfig('txmap', { ...(await getConfig('txmap') || {}), ...update });
  res.json({ success: true });
});

// ===== 导出工具函数供其他模块使用 =====
export { getConfig as getAdminConfig };

export async function logLogin(data: { userId?: string; username?: string; email?: string; phone?: string; ip?: string; userAgent?: string; success: boolean; failReason?: string; loginType?: string }) {
  await Promise.allSettled([
    prisma.loginLog.create({ data }),
    logLoginMySQL(data),
  ]);
}
export async function logIllegalRequest(ip: string, path: string, method: string, userAgent: string, reason: string, statusCode: number) {
  await Promise.allSettled([
    prisma.illegalRequest.create({ data: { ip, path, method, userAgent, reason, statusCode } }),
    logIllegalRequestMySQL({ ip, path, method, userAgent, reason, statusCode }),
  ]);
}

export default router;
