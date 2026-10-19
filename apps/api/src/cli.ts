import { prisma } from './db.js';
import { generatePassword, hashPassword } from './auth.js';
import { auditDirect } from './audit.js';

async function resetPassword(username: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No user named "${username}".`);
    process.exitCode = 1;
    return;
  }
  const password = generatePassword(20);
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lastFailedAt: null,
        lockedUntil: null,
      },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  await auditDirect({
    actorUserId: null,
    action: 'user.password_reset_cli',
    entityType: 'user',
    entityId: user.id,
    after: { username: user.username, mustChangePassword: true, sessionsRevoked: true },
    reason: 'Password reset from command line',
  });

  console.log(`Password reset for ${user.username}.`);
  console.log(`Temporary password: ${password}`);
  console.log('This password is shown once. The user must change it at next sign-in.');
}

async function main(): Promise<void> {
  const [command, username] = process.argv.slice(2);
  if (command === 'reset-password' && username) {
    await resetPassword(username);
    return;
  }
  console.error('Usage: node dist/cli.js reset-password <username>');
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
