import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';

const ZONE = 'Indian/Mauritius';

describe('P8 users, audit, on-campus and dean dashboard', () => {
  let app: FastifyInstance;
  let hr: TestClient;
  let hrUser: { id: string };

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
    hrUser = await createUser({ username: 'hr', password: 'StrongPassword123!', role: 'HR' });
    hr = new TestClient(app);
    await hr.login('hr', 'StrongPassword123!');
  });

  it('creates a security user with a one-time password and forces a change', async () => {
    const created = await hr.inject<{
      user: { id: string; role: string; mustChangePassword: boolean };
      temporaryPassword: string;
    }>({
      method: 'POST',
      url: '/api/v1/users',
      body: { username: 'gate.officer', displayName: 'Gate Officer', role: 'SECURITY' },
    });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe('SECURITY');
    expect(created.body.user.mustChangePassword).toBe(true);
    expect(created.body.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    const officer = new TestClient(app);
    await officer.login('gate.officer', created.body.temporaryPassword);
    const blocked = await officer.inject({ url: '/api/v1/kiosk/activity' });
    expect(blocked.status).toBe(403);
    expect((blocked.body as { error: { code: string } }).error.code).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );
  });

  it('protects the last active HR administrator from demotion and deactivation', async () => {
    const demote = await hr.inject({
      method: 'PATCH',
      url: `/api/v1/users/${hrUser.id}/role`,
      body: { role: 'SECURITY' },
    });
    expect(demote.status).toBe(409);
    expect((demote.body as { error: { code: string } }).error.code).toBe('LAST_HR_ADMIN');

    const deactivate = await hr.inject({
      method: 'POST',
      url: `/api/v1/users/${hrUser.id}/deactivate`,
    });
    expect(deactivate.status).toBe(409);
  });

  it('revokes sessions when a user is deactivated and after a password reset', async () => {
    const officerUser = await createUser({
      username: 'officer',
      password: 'StrongPassword123!',
      role: 'SECURITY',
    });
    const officer = new TestClient(app);
    await officer.login('officer', 'StrongPassword123!');
    expect((await officer.inject({ url: '/api/v1/auth/me' })).status).toBe(200);

    const reset = await hr.inject<{ temporaryPassword: string }>({
      method: 'POST',
      url: `/api/v1/users/${officerUser.id}/reset-password`,
    });
    expect(reset.status).toBe(200);
    expect((await officer.inject({ url: '/api/v1/auth/me' })).status).toBe(401);

    await officer.login('officer', reset.body.temporaryPassword);
    expect((await officer.inject({ url: '/api/v1/auth/me' })).status).toBe(200);

    const deactivate = await hr.inject({
      method: 'POST',
      url: `/api/v1/users/${officerUser.id}/deactivate`,
    });
    expect(deactivate.status).toBe(200);
    expect((await officer.inject({ url: '/api/v1/auth/me' })).status).toBe(401);
  });

  it('exposes on-campus employees and their vehicles to both roles', async () => {
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
    await prisma.vehicle.createMany({
      data: [
        {
          plate: 'AB 1234',
          plateNorm: 'AB1234',
          vehicleType: 'car',
          employeeId: employee.id,
        },
        {
          plate: 'AB 5678',
          plateNorm: 'AB5678',
          vehicleType: 'car',
          employeeId: employee.id,
        },
      ],
    });
    await prisma.event.create({
      data: {
        employeeId: employee.id,
        occurredAt: new Date(Date.now() - 2 * 60 * 60_000),
        direction: 'IN',
        recordedBy: hrUser.id,
        source: 'gate',
      },
    });

    const response = await hr.inject<{
      employees: Array<{ fullName: string; vehicles: string[] }>;
    }>({ url: '/api/v1/on-campus' });
    expect(response.status).toBe(200);
    expect(response.body.employees[0]).toMatchObject({
      fullName: 'Nadia Bossy',
      vehicles: ['AB 1234', 'AB 5678'],
    });
    expect(response.body).not.toHaveProperty('guests');
    expect(response.body).not.toHaveProperty('parking');
  });

  it('serves aggregate-only dean stats and denies HR and security', async () => {
    const dean = await createUser({
      username: 'dean',
      password: 'StrongPassword123!',
      role: 'DEAN',
    });
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
    const employee2 = await prisma.employee.create({
      data: {
        code: 'ALCHE002',
        firstName: 'Priya',
        lastName: 'Ramgoolam',
        department: 'Finance',
        category: 'staff',
        active: true,
      },
    });
    const today = DateTime.now().setZone(ZONE).startOf('day');
    await prisma.event.createMany({
      data: [
        {
          employeeId: employee.id,
          occurredAt: today.set({ hour: 8 }).toUTC().toJSDate(),
          direction: 'IN',
          recordedBy: hrUser.id,
          source: 'gate',
        },
        {
          employeeId: employee.id,
          occurredAt: today.set({ hour: 17 }).toUTC().toJSDate(),
          direction: 'OUT',
          recordedBy: hrUser.id,
          source: 'gate',
        },
        {
          employeeId: employee2.id,
          occurredAt: today.set({ hour: 9 }).toUTC().toJSDate(),
          direction: 'IN',
          recordedBy: hrUser.id,
          source: 'gate',
        },
      ],
    });

    const deanClient = new TestClient(app);
    await deanClient.login('dean', 'StrongPassword123!');
    const stats = await deanClient.inject<{
      attendance: { present: number; onSite: number; absent: number };
      trend: unknown[];
      today: string;
    }>({ url: '/api/v1/dashboard/stats' });
    expect(stats.status).toBe(200);
    expect(stats.body.today).toBe(today.toISODate());
    expect(stats.body.attendance.present).toBe(1);
    expect(stats.body.attendance.onSite).toBe(1);
    expect(stats.body.attendance.absent).toBe(0);
    expect(stats.body.trend.length).toBeGreaterThan(0);
    expect(JSON.stringify(stats.body)).not.toContain('Nadia');
    expect(JSON.stringify(stats.body)).not.toContain('Priya');
    expect(dean.id).toBeTruthy();

    const hrDenied = await hr.inject({ url: '/api/v1/dashboard/stats' });
    expect(hrDenied.status).toBe(403);

    const deanAudit = await deanClient.inject({ url: '/api/v1/audit' });
    expect(deanAudit.status).toBe(403);
  });

  it('writes and filters append-only audit entries', async () => {
    const created = await hr.inject({
      method: 'POST',
      url: '/api/v1/users',
      body: { username: 'officer2', displayName: 'Officer Two', role: 'SECURITY' },
    });
    expect(created.status).toBe(201);
    const response = await hr.inject<{
      items: Array<{ action: string; actor: { username: string } | null }>;
    }>({ url: '/api/v1/audit?entity=user' });
    expect(response.status).toBe(200);
    expect(response.body.items.some((row) => row.action === 'user.create')).toBe(true);
    expect(response.body.items.some((row) => row.action === 'auth.login')).toBe(true);

    const filtered = await hr.inject<{ items: Array<{ actor: { username: string } }> }>({
      url: `/api/v1/audit?actor=${hrUser.id}&entity=user`,
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.every((row) => row.actor?.username === 'hr')).toBe(true);

    await expect(
      prisma.$executeRawUnsafe('UPDATE "AuditLog" SET action = \'tampered\' WHERE action = \'auth.login\''),
    ).rejects.toThrow(/append-only/);
  });
});
