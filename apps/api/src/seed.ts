import { DateTime } from 'luxon';
import { prisma } from './db.js';
import { generatePassword, hashPassword } from './auth.js';
import { auditDirect } from './audit.js';
import { config } from './config.js';
import { APP_ZONE } from './time.js';

const EMPLOYEES = [
  ['ALCHE001', 'Nadia', 'Bossy', 'Administration', 'Head of Administration', 'staff'],
  ['ALCHE002', 'Priya', 'Ramgoolam', 'Finance', 'Finance Officer', 'staff'],
  ['ALCHE003', 'Vikash', 'Bundhoo', 'Facilities', 'Facilities Coordinator', 'staff'],
  ['ALCHE004', 'Marie-Claire', "L'Espérance", 'Student Affairs', 'Student Affairs Officer', 'staff'],
  ['ALCHE005', 'Jean-Noël', 'Ah-Koon', 'Technology', 'IT Support Engineer', 'staff'],
  ['ALCHE006', 'Kavita', 'Seenauth', 'Academic Affairs', 'Registrar', 'staff'],
  ['ALCHE007', 'Mohammad', 'Sookun', 'Facilities', 'Maintenance Technician', 'contractor'],
  ['ALCHE008', 'Anne-Marie', 'Cheung', 'Communications', 'Communications Lead', 'staff'],
  ['ALCHE009', 'Dinesh', 'Gopaul', 'Security', 'Security Supervisor', 'staff'],
  ['ALCHE010', 'Fatima', 'Hossen', 'Library', 'Library Assistant', 'staff'],
  ['ALCHE011', 'Rakesh', 'Bheekhee', 'Finance', 'Accounts Assistant', 'staff'],
  ['ALCHE012', 'Sonia', 'Appadoo', 'Admissions', 'Admissions Officer', 'staff'],
  ['ALCHE013', 'Ken', 'Ah-Sam', 'Technology', 'Network Administrator', 'staff'],
  ['ALCHE014', 'Leila', 'Ramdin', 'Student Affairs', 'Wellbeing Officer', 'staff'],
  ['ALCHE015', 'Thierry', 'Labonne', 'Facilities', 'Groundskeeper', 'contractor'],
] as const;

const VEHICLES: Array<{
  plate: string;
  make: string;
  model: string;
  colour: string;
  index: number;
  vehicleType: 'car' | 'motorbike' | 'van' | 'other';
}> = [
  { plate: 'AB 1234', make: 'Toyota', model: 'Corolla', colour: 'White', index: 0, vehicleType: 'car' },
  { plate: 'AB 5678', make: 'Nissan', model: 'Note', colour: 'Silver', index: 1, vehicleType: 'car' },
  { plate: 'AB 9012', make: 'Hyundai', model: 'i10', colour: 'Blue', index: 2, vehicleType: 'car' },
  { plate: 'CD 3456', make: 'Kia', model: 'Sportage', colour: 'Black', index: 3, vehicleType: 'car' },
  { plate: 'CD 7890', make: 'Honda', model: 'Fit', colour: 'Red', index: 4, vehicleType: 'car' },
  { plate: 'EF 1122', make: 'Yamaha', model: 'NMAX', colour: 'Grey', index: 5, vehicleType: 'motorbike' },
  { plate: 'EF 3344', make: 'Suzuki', model: 'Swift', colour: 'White', index: 6, vehicleType: 'car' },
  { plate: 'GH 5566', make: 'Mitsubishi', model: 'L200', colour: 'White', index: 7, vehicleType: 'van' },
];

const DEMO_ACCOUNTS = [
  { username: 'gate.demo', displayName: 'Gate Officer (demo)', role: 'SECURITY' },
  { username: 'dean.demo', displayName: 'Dean (demo, read only)', role: 'DEAN' },
] as const;

async function ensureAdmin(): Promise<{ id: string; username: string }> {
  const existing = await prisma.user.findUnique({ where: { username: config.ADMIN_USERNAME } });
  if (existing) return { id: existing.id, username: existing.username };
  return prisma.user.create({
    data: {
      username: config.ADMIN_USERNAME,
      displayName: config.ADMIN_DISPLAY_NAME,
      role: 'HR',
      passwordHash: await hashPassword(config.ADMIN_INITIAL_PASSWORD),
      mustChangePassword: true,
    },
    select: { id: true, username: true },
  });
}

async function main(): Promise<void> {
  const admin = await ensureAdmin();
  const printedAccounts: Array<{ username: string; password: string; role: string }> = [];

  for (const account of DEMO_ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { username: account.username } });
    if (existing) continue;
    const password = generatePassword(20);
    await prisma.user.create({
      data: {
        username: account.username,
        displayName: account.displayName,
        role: account.role,
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        active: true,
      },
    });
    printedAccounts.push({ username: account.username, password, role: account.role });
  }

  const employees = [];
  for (const [code, firstName, lastName, department, jobTitle, category] of EMPLOYEES) {
    employees.push(
      await prisma.employee.upsert({
        where: { code },
        update: {
          firstName,
          lastName,
          department,
          jobTitle,
          category,
          active: true,
        },
        create: {
          code,
          firstName,
          lastName,
          department,
          jobTitle,
          category,
          email: `${firstName.toLowerCase().replace(/[^a-z]/g, '.')}.${lastName
            .toLowerCase()
            .replace(/[^a-z]/g, '')
            .replace(/\./g, '')}@alche.ac.mu`,
          phone: `+230 5712 34${String(employees.length + 1).padStart(2, '0')}`,
          active: true,
        },
      }),
    );
  }

  const vehicles = [];
  for (const spec of VEHICLES) {
    const holder = { employeeId: employees[spec.index]!.id };
    const plateNorm = spec.plate.toUpperCase().replace(/[\s-]/g, '');
    const existing = await prisma.vehicle.findFirst({ where: { plateNorm, active: true } });
    vehicles.push(
      existing
        ? await prisma.vehicle.update({
            where: { id: existing.id },
            data: {
              plate: spec.plate,
              plateNorm,
              make: spec.make,
              model: spec.model,
              colour: spec.colour,
              vehicleType: spec.vehicleType,
              active: true,
              ...holder,
            },
          })
        : await prisma.vehicle.create({
            data: {
              plate: spec.plate,
              plateNorm,
              make: spec.make,
              model: spec.model,
              colour: spec.colour,
              vehicleType: spec.vehicleType,
              active: true,
              ...holder,
            },
          }),
    );
  }

  const seededEvents = await prisma.event.findFirst({
    where: { note: { startsWith: 'seed-demo' } },
  });
  if (!seededEvents) {
    const today = DateTime.now().setZone(APP_ZONE).startOf('day');
    const data: Array<{
      employeeId: string;
      occurredAt: Date;
      direction: 'IN' | 'OUT';
      recordedBy: string;
      source: 'gate';
      note: string;
    }> = [];
    for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
      const day = today.minus({ days: dayOffset });
      const date = day.toISODate()!;
      employees.forEach((employee, index) => {
        const base = day.set({ hour: 8, minute: index % 15 });
        const local = (hour: number, minute: number) => day.set({ hour, minute }).toUTC().toJSDate();
        if (index === 10 && dayOffset % 7 === 3) {
          data.push({
            employeeId: employee.id,
            occurredAt: local(17, 5),
            direction: 'OUT',
            recordedBy: admin.id,
            source: 'gate',
            note: `seed-demo:${date}:${index}:missing-in`,
          });
          return;
        }
        data.push({
          employeeId: employee.id,
          occurredAt: base.toUTC().toJSDate(),
          direction: 'IN',
          recordedBy: admin.id,
          source: 'gate',
          note: `seed-demo:${date}:${index}:in`,
        });
        if (index % 5 === 0) {
          data.push({
            employeeId: employee.id,
            occurredAt: local(12, 30),
            direction: 'OUT',
            recordedBy: admin.id,
            source: 'gate',
            note: `seed-demo:${date}:${index}:lunch-out`,
          });
          data.push({
            employeeId: employee.id,
            occurredAt: local(13, 30),
            direction: 'IN',
            recordedBy: admin.id,
            source: 'gate',
            note: `seed-demo:${date}:${index}:lunch-in`,
          });
        }
        if (dayOffset === 0 && index >= 12) return;
        if (index === 12 && dayOffset === 2) return;
        data.push({
          employeeId: employee.id,
          occurredAt: local(17, 0),
          direction: 'OUT',
          recordedBy: admin.id,
          source: 'gate',
          note: `seed-demo:${date}:${index}:out`,
        });
      });
    }
    const now = DateTime.now().setZone(APP_ZONE).toJSDate();
    await prisma.event.createMany({ data: data.filter((event) => event.occurredAt <= now) });
  }

  const seededTickets = await prisma.ticket.count({
    where: { reason: { startsWith: 'seed-demo:' } },
  });
  if (seededTickets === 0) {
    const target = await prisma.event.findFirst({
      where: { employeeId: employees[1]!.id, direction: 'IN' },
      orderBy: { occurredAt: 'desc' },
    });
    if (target) {
      await prisma.ticket.create({
        data: {
          employeeId: employees[1]!.id,
          targetEventId: target.id,
          proposedDirection: 'IN',
          proposedOccurredAt: target.occurredAt,
          reason: 'seed-demo: Paper logbook time was 07:52, recorded as 08:00',
          status: 'approved',
          raisedBy: admin.id,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          hrDirection: 'IN',
          hrOccurredAt: DateTime.fromJSDate(target.occurredAt)
            .setZone(APP_ZONE)
            .minus({ minutes: 8 })
            .toUTC()
            .toJSDate(),
          reviewNote: 'Verified against the signed gate logbook.',
        },
      });
    }
    await prisma.ticket.create({
      data: {
        employeeId: employees[2]!.id,
        proposedDirection: 'OUT',
        proposedOccurredAt: DateTime.now()
          .setZone(APP_ZONE)
          .minus({ days: 2 })
          .set({ hour: 18 })
          .toUTC()
          .toJSDate(),
        reason: 'seed-demo: Missing exit — vehicle left at 18:00',
        status: 'open',
        raisedBy: admin.id,
      },
    });
  }

  await auditDirect({
    actorUserId: admin.id,
    action: 'seed.demo',
    entityType: 'system',
    entityId: null,
    after: {
      employees: employees.length,
      vehicles: vehicles.length,
      demoAccountsCreated: printedAccounts.map((account) => account.username),
    },
    reason: 'Idempotent demonstration seed',
  });

  console.log('Demo data ready.');
  console.log(`  Employees: ${employees.length}`);
  console.log(`  Vehicles: ${vehicles.length}`);
  if (printedAccounts.length > 0) {
    console.log('\nOne-time demo account passwords (shown once):');
    for (const account of printedAccounts) {
      console.log(`  ${account.role.padEnd(8)} ${account.username}  ${account.password}`);
    }
  } else {
    console.log('\nDemo accounts already existed; passwords were not changed.');
  }
  console.log('\nThe HR administrator comes from ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
