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

const GUESTS = [
  ['Élodie Tran', 'Mauritius Telecom', '+230 5700 1001', 'ID-MU-1001'],
  ['Priya Naidoo', 'Orange Business', '+230 5700 1002', 'ID-MU-1002'],
  ['Samuel Wong', 'Campus Books Ltd', '+230 5700 1003', 'PASSPORT-SG-2003'],
  ['Amina Diallo', 'African Leadership Network', '+230 5700 1004', 'PASSPORT-SN-2004'],
  ['Lucas Martin', 'Sodexo', '+230 5700 1005', 'ID-FR-1005'],
  ['Rita Chung', 'Chung & Associates', '+230 5700 1006', 'ID-MU-1006'],
] as const;

const VEHICLES: Array<{
  plate: string;
  make: string;
  model: string;
  colour: string;
  kind: 'employee' | 'guest';
  index: number;
  vehicleType: 'car' | 'motorbike' | 'van' | 'other';
}> = [
  { plate: 'AB 1234', make: 'Toyota', model: 'Corolla', colour: 'White', kind: 'employee', index: 0, vehicleType: 'car' },
  { plate: 'AB 5678', make: 'Nissan', model: 'Note', colour: 'Silver', kind: 'employee', index: 1, vehicleType: 'car' },
  { plate: 'AB 9012', make: 'Hyundai', model: 'i10', colour: 'Blue', kind: 'employee', index: 2, vehicleType: 'car' },
  { plate: 'CD 3456', make: 'Kia', model: 'Sportage', colour: 'Black', kind: 'employee', index: 3, vehicleType: 'car' },
  { plate: 'CD 7890', make: 'Honda', model: 'Fit', colour: 'Red', kind: 'employee', index: 4, vehicleType: 'car' },
  { plate: 'EF 1122', make: 'Yamaha', model: 'NMAX', colour: 'Grey', kind: 'employee', index: 5, vehicleType: 'motorbike' },
  { plate: 'EF 3344', make: 'Suzuki', model: 'Swift', colour: 'White', kind: 'employee', index: 6, vehicleType: 'car' },
  { plate: 'GH 5566', make: 'Mitsubishi', model: 'L200', colour: 'White', kind: 'employee', index: 7, vehicleType: 'van' },
  { plate: 'GU 9080', make: 'Nissan', model: 'X-Trail', colour: 'Grey', kind: 'guest', index: 0, vehicleType: 'car' },
  { plate: 'GU 9081', make: 'Toyota', model: 'Hiace', colour: 'White', kind: 'guest', index: 1, vehicleType: 'van' },
  { plate: 'GU 9082', make: 'Peugeot', model: '208', colour: 'Blue', kind: 'guest', index: 2, vehicleType: 'car' },
];

const AREA_BAYS: Array<{
  area: { code: string; name: string };
  bays: Array<{ from: number; to: number; prefix: string; type: string }>;
}> = [
  {
    area: { code: 'MAIN', name: 'Main Lot' },
    bays: [
      { from: 1, to: 12, prefix: 'A-', type: 'STAFF' },
      { from: 13, to: 20, prefix: 'A-', type: 'GENERAL' },
      { from: 21, to: 26, prefix: 'A-', type: 'GENERAL' },
      { from: 27, to: 28, prefix: 'A-', type: 'ACCESSIBLE' },
      { from: 29, to: 30, prefix: 'A-', type: 'MOTORBIKE' },
    ],
  },
  {
    area: { code: 'ADMIN', name: 'Admin Front' },
    bays: [
      { from: 1, to: 3, prefix: 'B-', type: 'GUEST' },
      { from: 4, to: 6, prefix: 'B-', type: 'GENERAL' },
      { from: 7, to: 7, prefix: 'B-', type: 'MOTORBIKE' },
      { from: 8, to: 8, prefix: 'B-', type: 'ACCESSIBLE' },
      { from: 9, to: 10, prefix: 'B-', type: 'STAFF' },
    ],
  },
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

  const guests = [];
  for (const [fullName, company, phone, idNumber] of GUESTS) {
    const existing = await prisma.guest.findFirst({ where: { fullName, company } });
    guests.push(
      existing
        ? await prisma.guest.update({
            where: { id: existing.id },
            data: { phone, idNumber, active: true },
          })
        : await prisma.guest.create({
            data: {
              fullName,
              company,
              phone,
              idNumber,
              email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}@example.mu`,
              active: true,
            },
          }),
    );
  }

  const areaIds = new Map<string, string>();
  const bayIds = new Map<string, string>();
  for (const group of AREA_BAYS) {
    const area = await prisma.parkingArea.upsert({
      where: { code: group.area.code },
      update: { name: group.area.name, active: true },
      create: { code: group.area.code, name: group.area.name, active: true },
    });
    areaIds.set(group.area.code, area.id);
    for (const range of group.bays) {
      for (let number = range.from; number <= range.to; number += 1) {
        const code = `${range.prefix}${String(number).padStart(2, '0')}`;
        const bay = await prisma.parkingBay.upsert({
          where: { areaId_code: { areaId: area.id, code } },
          update: { bayType: range.type, active: true },
          create: { areaId: area.id, code, bayType: range.type, active: true },
        });
        bayIds.set(code, bay.id);
      }
    }
  }

  const vehicles = [];
  for (const spec of VEHICLES) {
    const holder =
      spec.kind === 'employee'
        ? { employeeId: employees[spec.index]!.id, guestId: null }
        : { employeeId: null, guestId: guests[spec.index]!.id };
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

  const seededVisits = await prisma.guestVisit.findFirst({
    where: { note: { startsWith: 'seed-demo' } },
  });
  if (!seededVisits) {
    const today = DateTime.now().setZone(APP_ZONE).startOf('day');
    const specs: Array<{
      guest: number;
      host: number;
      purpose: string;
      from: DateTime;
      to: DateTime;
      status: 'EXPECTED' | 'ON_SITE' | 'DEPARTED';
      checkedIn?: DateTime;
      checkedOut?: DateTime;
      vehicleId?: string;
    }> = [
      {
        guest: 0,
        host: 0,
        purpose: 'Campus tour',
        from: today.set({ hour: 10 }),
        to: today.set({ hour: 12 }),
        status: 'EXPECTED',
      },
      {
        guest: 1,
        host: 1,
        purpose: 'Supplier meeting',
        from: today.set({ hour: 9 }),
        to: today.set({ hour: 12 }),
        status: 'ON_SITE',
        checkedIn: today.set({ hour: 9, minute: 10 }),
        vehicleId: vehicles[11]!.id,
      },
      {
        guest: 2,
        host: 2,
        purpose: 'Book delivery',
        from: today.set({ hour: 7 }),
        to: today.set({ hour: 8 }),
        status: 'ON_SITE',
        checkedIn: today.set({ hour: 7, minute: 15 }),
      },
      {
        guest: 3,
        host: 3,
        purpose: 'Leadership workshop',
        from: today.set({ hour: 8 }),
        to: today.set({ hour: 11 }),
        status: 'DEPARTED',
        checkedIn: today.set({ hour: 8, minute: 5 }),
        checkedOut: today.set({ hour: 11, minute: 20 }),
      },
      {
        guest: 4,
        host: 4,
        purpose: 'Catering review',
        from: today.minus({ days: 1 }).set({ hour: 14 }),
        to: today.minus({ days: 1 }).set({ hour: 16 }),
        status: 'DEPARTED',
        checkedIn: today.minus({ days: 1 }).set({ hour: 14, minute: 5 }),
        checkedOut: today.minus({ days: 1 }).set({ hour: 16, minute: 10 }),
      },
      {
        guest: 5,
        host: 5,
        purpose: 'Legal consultation',
        from: today.set({ hour: 15 }),
        to: today.set({ hour: 16 }),
        status: 'EXPECTED',
      },
    ];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index]!;
      await prisma.guestVisit.create({
        data: {
          guestId: guests[spec.guest]!.id,
          hostEmployeeId: employees[spec.host]!.id,
          vehicleId: spec.vehicleId ?? null,
          purpose: spec.purpose,
          expectedFrom: spec.from.toUTC().toJSDate(),
          expectedTo: spec.to.toUTC().toJSDate(),
          badgeNo: `V-${String(index + 1).padStart(3, '0')}`,
          status: spec.status,
          checkedInAt: spec.checkedIn?.toUTC().toJSDate() ?? null,
          checkedInBy: spec.checkedIn ? admin.id : null,
          checkedOutAt: spec.checkedOut?.toUTC().toJSDate() ?? null,
          checkedOutBy: spec.checkedOut ? admin.id : null,
          note: `seed-demo:visit:${index}`,
        },
      });
    }
  }

  const seededSessions = await prisma.parkingSession.count({
    where: { note: 'seed-demo:session' },
  });
  if (seededSessions === 0) {
    const allocations: Array<[string, string, 'employee' | 'guest', number]> = [
      ['A-01', 'AB 1234', 'employee', 0],
      ['A-02', 'AB 5678', 'employee', 1],
      ['A-03', 'AB 9012', 'employee', 2],
      ['A-04', 'CD 3456', 'employee', 3],
      ['A-05', 'CD 7890', 'employee', 4],
      ['A-06', 'EF 1122', 'employee', 5],
      ['B-01', 'GU 9080', 'guest', 8],
      ['B-02', 'GU 9081', 'guest', 9],
      ['B-03', 'GU 9082', 'guest', 10],
    ];
    for (const [code, plate, category, vehicleIndex] of allocations) {
      const vehicle = vehicles[vehicleIndex]!;
      const holderName =
        category === 'employee'
          ? `${employees[vehicleIndex]!.firstName} ${employees[vehicleIndex]!.lastName}`
          : guests[vehicleIndex - 8]!.fullName;
      await prisma.parkingSession.create({
        data: {
          bayId: bayIds.get(code)!,
          vehicleId: vehicle.id,
          plateSnapshot: plate,
          holderNameSnapshot: holderName,
          holderCategory: category,
          startedAt: DateTime.now().setZone(APP_ZONE).minus({ hours: 2 }).toUTC().toJSDate(),
          allocatedBy: admin.id,
          note: 'seed-demo:session',
        },
      });
    }
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
      guests: guests.length,
      vehicles: vehicles.length,
      bays: bayIds.size,
      demoAccountsCreated: printedAccounts.map((account) => account.username),
    },
    reason: 'Idempotent demonstration seed',
  });

  console.log('Demo data ready.');
  console.log(`  Employees: ${employees.length}`);
  console.log(`  Guests: ${guests.length}`);
  console.log(`  Vehicles: ${vehicles.length}`);
  console.log(`  Bays: ${bayIds.size}`);
  console.log(`  Active parking sessions: 9`);
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
