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

async function endActiveSessionForVehicle(vehicleId: string, userId: string) {
  await prisma.parkingSession.updateMany({
    where: { vehicleId, endedAt: null },
    data: {
      endedAt: new Date(),
      endedBy: userId,
      endReason: 'hr',
      note: 'E2E reset',
    },
  });
}

async function endActiveSessionsForBay(code: string, userId: string) {
  const bay = await prisma.parkingBay.findFirst({ where: { code } });
  if (!bay) return;
  await prisma.parkingSession.updateMany({
    where: { bayId: bay.id, endedAt: null },
    data: {
      endedAt: new Date(),
      endedBy: userId,
      endReason: 'hr',
      note: 'E2E reset',
    },
  });
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
  const vehicle = await prisma.vehicle.findFirst({
    where: { employee: { code: 'ALCHE007' }, active: true },
  });
  if (vehicle) await endActiveSessionForVehicle(vehicle.id, securityId);
  await endActiveSessionsForBay('B-03', securityId);
  await endActiveSessionsForBay('A-07', securityId);

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

  const visualArea = await prisma.parkingArea.upsert({
    where: { code: 'VISUAL' },
    update: { name: 'Visual Lot', active: true },
    create: { code: 'VISUAL', name: 'Visual Lot', active: true },
  });
  const baySpecs: Array<[string, string]> = [
    ['Z-01', 'STAFF'],
    ['Z-02', 'STAFF'],
    ['Z-03', 'GENERAL'],
    ['Z-04', 'GENERAL'],
    ['Z-05', 'GUEST'],
    ['Z-06', 'ACCESSIBLE'],
  ];
  const visualBays = new Map<string, string>();
  for (const [index, [code, bayType]] of baySpecs.entries()) {
    const oldCode = `V-${String(index + 1).padStart(2, '0')}`;
    const oldBay = await prisma.parkingBay.findFirst({
      where: { areaId: visualArea.id, code: oldCode },
    });
    if (oldBay) {
      await prisma.parkingBay.update({ where: { id: oldBay.id }, data: { code } });
    }
    const bay = await prisma.parkingBay.upsert({
      where: { areaId_code: { areaId: visualArea.id, code } },
      update: { bayType, active: true },
      create: { areaId: visualArea.id, code, bayType, active: true },
    });
    visualBays.set(code, bay.id);
  }

  const visualOne = await ensureVisualEmployee(
    'VISUAL001',
    'Vera',
    'Visual',
    'Visual Department',
  );
  const visualTwo = await ensureVisualEmployee(
    'VISUAL002',
    'Victor',
    'Visual',
    'Visual Pool',
  );
  const visualThree = await ensureVisualEmployee(
    'VISUAL003',
    'Valerie',
    'Visual',
    'Visual Pool',
  );
  const one = await ensureVisualVehicle('VIS 001', visualOne.id);
  const two = await ensureVisualVehicle('VIS 002', visualTwo.id);
  const three = await ensureVisualVehicle('VIS 003', visualThree.id);

  await endActiveSessionForVehicle(one.id, hrId);
  await endActiveSessionForVehicle(two.id, hrId);
  await endActiveSessionForVehicle(three.id, hrId);
  await prisma.event.updateMany({
    where: {
      employeeId: { in: [visualOne.id, visualTwo.id, visualThree.id] },
      voidedAt: null,
    },
    data: {
      voidedAt: new Date(),
      voidedBy: hrId,
      voidReason: 'Visual fixture reset',
    },
  });

  await prisma.parkingSession.updateMany({
    where: {
      endedAt: null,
      bay: { areaId: visualArea.id },
    },
    data: {
      endedAt: new Date(),
      endedBy: hrId,
      endReason: 'hr',
      note: 'visual fixture reset',
    },
  });
  const visualAssignments: Array<[string, string, string, string]> = [
    ['Z-01', two.id, 'Victor Visual', 'VIS 002'],
    ['Z-03', three.id, 'Valerie Visual', 'VIS 003'],
  ];
  for (const [code, vehicleId, holder, plate] of visualAssignments) {
    const bayId = visualBays.get(code)!;
    await prisma.parkingSession.create({
      data: {
        bayId,
        vehicleId,
        plateSnapshot: plate,
        holderNameSnapshot: holder,
        holderCategory: 'employee',
        startedAt: DateTime.fromISO('2026-09-10T08:00:00', { zone: APP_ZONE })
          .toUTC()
          .toJSDate(),
        allocatedBy: hrId,
        note: 'visual-fixture',
      },
    });
  }

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
