import nodemailer from 'nodemailer';
import { getAdminConfig } from './admin.js';

// 荷取并跄范化 SMTP 配置
async function getSmtpConfig() {
  const raw = await getAdminConfig('smtp') || {};
  const user = raw.authUser ?? raw.user ?? '';
  const pass = raw.authPass ?? raw.pass ?? '';
  const fromAddress = raw.fromAddress ?? raw.fromEmail ?? '';

  return {
    host: raw.host || '',
    port: Number(raw.port || 465),
    secure: raw.secure !== undefined ? !!raw.secure : true,
    authUser: user,
    authPass: pass,
    fromName: raw.fromName || 'imim',
    fromAddress,
    enabled: !!raw.enabled,
  };
}

// 发送邮件
export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const config = await getSmtpConfig();

    if (!config.host || !config.authUser || !config.authPass) {
      console.error('[Email] SMTP 配羮不完整，无法发送邮件');
      return { success: false, error: 'SMTP 配羮不完整' };
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.authUser,
        pass: config.authPass,
      },
    });

    const from = config.fromName ? `\"${config.fromName}\" <${config.fromAddress || config.authUser}>` : (config.fromAddress || config.authUser);

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
    });

    console.log(`[Email] 邮件发送成功: ${info.messageId} -> ${to}`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error('[Email] 邮件发送失贩:', error);
    return { success: false, error: error.message || '邮件发送失贩' };
  }
}
