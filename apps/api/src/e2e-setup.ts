import { DateTime } from 'luxon';
import { prisma } from './db.js';
import { hashPassword } from './auth.js';
import { APP_ZONE } from './time.js';

const E2E_PASSWORD = 'E2E-Password-123!';

async function ensureUser(username: string, displayName: string, role: 'SECURITY' | 'HR' | 'DEAN') {
  const passwordHash = await hashPassword(E2E_PASSWORD);
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        displayName,
        role,
        passwordHash,
        mustChangePassword: false,
        active: true,
        failedLoginCount: 0,
        lastFailedAt: null,
        lockedUntil: null,
      },
    });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      username,
      displayName,
      role,
      passwordHash,
      mustChangePassword: false,
      active: true,
    },
  });
  return created.id;
}

async function ensureVisualEmployee(
  code: string,
  first: string,
  last: string,
  department: string,
) {
  return prisma.employee.upsert({
    where: { code },
    update: { firstName: first, lastName: last, department, active: true },
    create: {
      code,
      firstName: first,
      lastName: last,
      department,
      category: 'staff',
      active: true,
    },
  });
}

async function ensureVisualVehicle(plate: string, employeeId: string) {
  const plateNorm = plate.replace(/\s/g, '').toUpperCase();
  const existing = await prisma.vehicle.findFirst({ where: { plateNorm, active: true } });
  if (existing) {
    return prisma.vehicle.update({
      where: { id: existing.id },
      data: { employeeId, active: true, plate },
    });
  }
  return prisma.vehicle.create({
    data: {
      plate,
      plateNorm,
      make: 'Visual',
      model: 'Fixture',
      colour: 'White',
      vehicleType: 'car',
      employeeId,
      active: true,
    },
  });
}

async function main(): Promise<void> {
  const securityId = await ensureUser('e2e.security', 'E2E Gate Officer', 'SECURITY');
  const hrId = await ensureUser('e2e.hr', 'E2E HR Officer', 'HR');
  await ensureUser('e2e.dean', 'E2E Dean', 'DEAN');

  const mohammad = await prisma.employee.findUnique({ where: { code: 'ALCHE007' } });
  if (!mohammad) throw new Error('Seed the demo data before running E2E setup.');
  await prisma.event.updateMany({
    where: {
      employeeId: mohammad.id,
      voidedAt: null,
      supersededById: null,
      occurredAt: { gt: new Date() },
    },
    data: {
      voidedAt: new Date(),
      voidedBy: securityId,
      voidReason: 'E2E reset: remove future fixture events',
    },
  });
  await prisma.event.create({
    data: {
      employeeId: mohammad.id,
      occurredAt: new Date(Date.now() - 1_000),
      direction: 'OUT',
      recordedBy: securityId,
      source: 'gate',
      note: 'E2E reset: set employee off campus',
    },
  });

  const visualOne = await ensureVisualEmployee(
    'VISUAL001',
    'Vera',
    'Visual',
    'Visual Department',
  );
  await ensureVisualVehicle('VIS 001', visualOne.id);
  await prisma.vehicle.deleteMany({
    where: { employeeId: visualOne.id, plate: { startsWith: 'E2E ' } },
  });

  await prisma.event.updateMany({
    where: {
      employeeId: visualOne.id,
      voidedAt: null,
    },
    data: {
      voidedAt: new Date(),
      voidedBy: hrId,
      voidReason: 'Visual fixture reset',
    },
  });

  const day = DateTime.fromISO('2026-09-10', { zone: APP_ZONE });
  await prisma.event.createMany({
    data: [
      {
        employeeId: visualOne.id,
        occurredAt: day.set({ hour: 8, minute: 3 }).toUTC().toJSDate(),
        direction: 'IN',
        recordedBy: hrId,
        source: 'gate',
        note: 'visual-fixture',
      },
      {
        employeeId: visualOne.id,
        occurredAt: day.set({ hour: 17, minute: 12 }).toUTC().toJSDate(),
        direction: 'OUT',
        recordedBy: hrId,
        source: 'gate',
        note: 'visual-fixture',
      },
    ],
  });

  console.log('E2E fixtures ready.');
  console.log(`  ${'e2e.security'.padEnd(14)} ${E2E_PASSWORD}`);
  console.log(`  ${'e2e.hr'.padEnd(14)} ${E2E_PASSWORD}`);
  console.log(`  ${'e2e.dean'.padEnd(14)} ${E2E_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
