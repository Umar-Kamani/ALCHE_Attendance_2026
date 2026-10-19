import { config } from './config.js';
import { prisma } from './db.js';
import { auditDirect } from './audit.js';
import { hashPassword } from './auth.js';

export async function bootstrapAdmin(app: { log: { warn: (obj: unknown, msg: string) => void } }): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { username: config.ADMIN_USERNAME } });
  if (existing) {
    if (config.adminPasswordIsDefault) {
      app.log.warn(
        { username: config.ADMIN_USERNAME },
        'WARNING: ADMIN_INITIAL_PASSWORD is still the documented default. Change the password immediately.',
      );
    }
    return;
  }

  const passwordHash = await hashPassword(config.ADMIN_INITIAL_PASSWORD);
  const admin = await prisma.user.create({
    data: {
      username: config.ADMIN_USERNAME,
      displayName: config.ADMIN_DISPLAY_NAME,
      passwordHash,
      role: 'HR',
      active: true,
      mustChangePassword: true,
    },
    select: { id: true, username: true },
  });

  await auditDirect({
    actorUserId: admin.id,
    action: 'user.bootstrap',
    entityType: 'user',
    entityId: admin.id,
    after: { username: admin.username, role: 'HR', mustChangePassword: true },
    reason: 'Initial HR administrator created from environment configuration',
  });

  if (config.adminPasswordIsDefault) {
    app.log.warn(
      { username: config.ADMIN_USERNAME },
      'WARNING: the seeded HR administrator is using the documented default password. Change it now.',
    );
  }
}
