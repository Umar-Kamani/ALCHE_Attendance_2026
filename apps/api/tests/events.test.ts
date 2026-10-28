import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';

const ZONE = 'Indian/Mauritius';

function localTodayAt(hour: number, minute = 0): Date {
  return DateTime.now().setZone(ZONE).startOf('day').set({ hour, minute }).toUTC().toJSDate();
}

async function seedPeople() {
  const employee = await prisma.employee.create({
    data: {
      code: 'ALCHE001',
      firstName: 'Nadia',
      lastName: 'Bossy',
      department: 'Administration',
      category: 'staff',
      active: true,
    },
  });
  const other = await prisma.employee.create({
    data: {
      code: 'ALCHE002',
      firstName: 'Priya',
      lastName: 'Ramgoolam',
      department: 'Finance',
      category: 'staff',
      active: true,
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      plate: 'AB 1234',
      plateNorm: 'AB1234',
      make: 'Toyota',
      model: 'Corolla',
      colour: 'White',
      vehicleType: 'car',
      employeeId: employee.id,
      active: true,
    },
  });
  return { employee, other, vehicle };
}

describe('P3 events, duplicate guard, attendance and kiosk', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  async function client(role: 'SECURITY' | 'HR'): Promise<TestClient> {
    const username = role.toLowerCase();
    await createUser({ username, password: 'StrongPassword123!', role });
    const result = new TestClient(app);
    await result.login(username, 'StrongPassword123!');
    return result;
  }

  it('infers direction, blocks duplicate taps and isolates people', async () => {
    const { employee, other } = await seedPeople();
    const security = await client('SECURITY');
    const base = DateTime.now().setZone(ZONE).startOf('day').set({ hour: 9 }).toUTC().toJSDate();
    const plus = (seconds: number) => new Date(base.getTime() + seconds * 1000);

    const first = await security.inject<{ event: { direction: string }; inferredDirection: string }>({
      method: 'POST',
      url: '/api/v1/events',
      body: { employeeId: employee.id, occurredAt: base.toISOString() },
    });
    expect(first.status).toBe(201);
    expect(first.body.event.direction).toBe('IN');
    expect(first.body.inferredDirection).toBe('IN');

    const duplicate = await security.inject<{ error: { code: string; message: string } }>({
      method: 'POST',
      url: '/api/v1/events',
      body: {
        employeeId: employee.id,
        direction: 'IN',
        occurredAt: plus(119).toISOString(),
      },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_EVENT');
    expect(duplicate.body.error.message).toContain('Nadia Bossy');
    expect(duplicate.body.error.message).toContain('119 seconds ago');

    const accepted = await security.inject({
      method: 'POST',
      url: '/api/v1/events',
      body: {
        employeeId: employee.id,
        direction: 'IN',
        occurredAt: plus(121).toISOString(),
      },
    });
    expect(accepted.status).toBe(201);

    const opposite = await security.inject({
      method: 'POST',
      url: '/api/v1/events',
      body: {
        employeeId: employee.id,
        direction: 'OUT',
        occurredAt: plus(122).toISOString(),
      },
    });
    expect(opposite.status).toBe(201);

    const separatePerson = await security.inject({
      method: 'POST',
      url: '/api/v1/events',
      body: {
        employeeId: other.id,
        direction: 'IN',
        occurredAt: plus(10).toISOString(),
      },
    });
    expect(separatePerson.status).toBe(201);
  });

  it('undoes only the current user’s recent gate event', async () => {
    const { employee } = await seedPeople();
    const security = await client('SECURITY');
    await createUser({ username: 'hr', password: 'StrongPassword123!', role: 'HR' });
    const created = await security.inject<{ event: { id: string } }>({
      method: 'POST',
      url: '/api/v1/events',
      body: { employeeId: employee.id, direction: 'IN' },
    });
    expect(created.status).toBe(201);

    const otherClient = new TestClient(app);
    await otherClient.login('hr', 'StrongPassword123!');
    const denied = await otherClient.inject({
      method: 'DELETE',
      url: `/api/v1/events/${created.body.event.id}`,
    });
    expect(denied.status).toBe(422);

    const undo = await security.inject<{ success: boolean }>({
      method: 'DELETE',
      url: `/api/v1/events/${created.body.event.id}`,
    });
    expect(undo.status).toBe(200);
    expect(undo.body.success).toBe(true);
    const remaining = await prisma.event.findMany({ where: { voidedAt: null } });
    expect(remaining).toHaveLength(0);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'gate_undo' } });
    expect(audit).not.toBeNull();
  });

  it('searches people and plates and reports today’s activity and campus count', async () => {
    const { employee } = await seedPeople();
    const security = await client('SECURITY');
    const todayAt = localTodayAt(8);
    await security.inject({
      method: 'POST',
      url: '/api/v1/events',
      body: { employeeId: employee.id, direction: 'IN', occurredAt: todayAt.toISOString() },
    });

    const byName = await security.inject<{
      employees: Array<{ fullName: string; currentState: { onCampus: boolean }; vehicles: unknown[] }>;
    }>({ url: '/api/v1/kiosk/search?q=bossy' });
    expect(byName.status).toBe(200);
    expect(byName.body.employees).toHaveLength(1);
    expect(byName.body.employees[0]?.fullName).toBe('Nadia Bossy');
    expect(byName.body.employees[0]?.currentState.onCampus).toBe(true);
    expect(byName.body.employees[0]?.vehicles).toHaveLength(1);

    const byPlate = await security.inject<{ employees: Array<{ fullName: string }> }>({
      url: '/api/v1/kiosk/search?q=ab-1234',
    });
    expect(byPlate.status).toBe(200);
    expect(byPlate.body.employees[0]?.fullName).toBe('Nadia Bossy');

    const byFullName = await security.inject<{ employees: Array<{ fullName: string }> }>({
      url: '/api/v1/kiosk/search?q=Nadia%20Bossy',
    });
    expect(byFullName.body.employees).toHaveLength(1);

    const options = await security.inject<{
      employees: Array<{ id: string; fullName: string; vehicles: unknown[] }>;
    }>({ url: '/api/v1/kiosk/employees' });
    expect(options.status).toBe(200);
    expect(options.body.employees[0]).toMatchObject({
      id: employee.id,
      fullName: 'Nadia Bossy',
    });
    expect(options.body.employees[0]?.vehicles).toHaveLength(1);
    expect(byName.body).not.toHaveProperty('guests');

    const activity = await security.inject<{ onCampusCount: number; items: unknown[] }>({
      url: '/api/v1/kiosk/activity',
    });
    expect(activity.status).toBe(200);
    expect(activity.body.onCampusCount).toBe(1);
    expect(activity.body.items.length).toBeGreaterThan(0);
  });

  it('serves today’s attendance to security and full reports to HR', async () => {
    const { employee } = await seedPeople();
    const security = await client('SECURITY');
    const hr = await client('HR');
    const today = DateTime.now().setZone(ZONE).toISODate()!;

    for (const [direction, time] of [
      ['IN', localTodayAt(8)],
      ['OUT', localTodayAt(17)],
    ] as const) {
      const result = await security.inject({
        method: 'POST',
        url: '/api/v1/events',
        body: { employeeId: employee.id, direction, occurredAt: time.toISOString() },
      });
      expect(result.status).toBe(201);
    }

    const todayReport = await security.inject<{
      items: Array<{ status: string; spanHours: number; employeeCode: string }>;
      totals: { present: number };
    }>({ url: `/api/v1/attendance?from=${today}&to=${today}` });
    expect(todayReport.status).toBe(200);
    expect(todayReport.body.items[0]).toMatchObject({
      status: 'PRESENT',
      spanHours: 9,
      employeeCode: 'ALCHE001',
    });
    expect(todayReport.body.totals.present).toBe(1);

    const past = DateTime.now().setZone(ZONE).minus({ days: 2 }).toISODate()!;
    const blocked = await security.inject({
      url: `/api/v1/attendance?from=${past}&to=${past}`,
    });
    expect(blocked.status).toBe(403);

    const hrReport = await hr.inject<{ items: Array<{ status: string }> }>({
      url: `/api/v1/attendance?from=${past}&to=${today}`,
    });
    expect(hrReport.status).toBe(200);
    expect(hrReport.body.items.length).toBeGreaterThan(0);
  });

  it('builds an employee month view and allows HR to retime with supersession', async () => {
    const { employee } = await seedPeople();
    const hr = await client('HR');
    const createdAt = localTodayAt(8);
    const created = await hr.inject<{ event: { id: string } }>({
      method: 'POST',
      url: '/api/v1/events',
      body: { employeeId: employee.id, direction: 'IN', occurredAt: createdAt.toISOString() },
    });
    expect(created.status).toBe(201);

    const month = DateTime.now().setZone(ZONE).toFormat('yyyy-MM');
    const amended = await hr.inject<{ event: { id: string } }>({
      method: 'POST',
      url: `/api/v1/events/${created.body.event.id}/amend`,
      body: {
        direction: 'IN',
        occurredAt: localTodayAt(7, 30).toISOString(),
        reason: 'Paper logbook showed 07:30',
      },
    });
    expect(amended.status).toBe(200);

    const old = await prisma.event.findUniqueOrThrow({ where: { id: created.body.event.id } });
    expect(old.supersededById).toBe(amended.body.event.id);

    const detail = await hr.inject<{
      days: Array<{ status: string; amended: boolean; firstInLocal: string }>;
      events: unknown[];
    }>({ url: `/api/v1/attendance/${employee.id}/month?month=${month}` });
    expect(detail.status).toBe(200);
    const todayRow = detail.body.days.find(
      (row) => row.status === 'PRESENT' || row.status === 'ON_SITE',
    );
    expect(todayRow?.amended).toBe(true);
    expect(detail.body.events).toHaveLength(1);
  });

  it('refuses security amendment routes', async () => {
    const { employee } = await seedPeople();
    const security = await client('SECURITY');
    const created = await security.inject<{ event: { id: string } }>({
      method: 'POST',
      url: '/api/v1/events',
      body: { employeeId: employee.id, direction: 'IN' },
    });
    const response = await security.inject({
      method: 'POST',
      url: `/api/v1/events/${created.body.event.id}/amend`,
      body: {
        direction: 'IN',
        occurredAt: new Date().toISOString(),
        reason: 'should not work',
      },
    });
    expect(response.status).toBe(403);
  });
});
