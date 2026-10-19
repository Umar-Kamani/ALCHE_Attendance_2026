import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';

const ZONE = 'Indian/Mauritius';

function at(date: string, time: string): Date {
  return DateTime.fromISO(`${date}T${time}`, { zone: ZONE }).toUTC().toJSDate();
}

describe('P4 CSV exports', () => {
  let app: FastifyInstance;
  let hr: TestClient;
  let security: TestClient;
  let employeeId: string;

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
    await createUser({ username: 'hr', password: 'StrongPassword123!', role: 'HR' });
    await createUser({
      username: 'security',
      password: 'StrongPassword123!',
      role: 'SECURITY',
    });
    const employee = await prisma.employee.create({
      data: {
        code: 'ALCHE004',
        firstName: 'Marie-Claire',
        lastName: "L'Espérance",
        department: 'Student Affairs, Residence',
        category: 'staff',
        active: true,
      },
    });
    employeeId = employee.id;
    await prisma.event.createMany({
      data: [
        {
          employeeId,
          direction: 'IN',
          source: 'gate',
          occurredAt: at('2026-09-10', '08:03:00'),
          recordedBy: (await prisma.user.findUniqueOrThrow({ where: { username: 'hr' } })).id,
        },
        {
          employeeId,
          direction: 'OUT',
          source: 'gate',
          occurredAt: at('2026-09-10', '17:12:00'),
          recordedBy: (await prisma.user.findUniqueOrThrow({ where: { username: 'hr' } })).id,
        },
      ],
    });
    hr = new TestClient(app);
    await hr.login('hr', 'StrongPassword123!');
    security = new TestClient(app);
    await security.login('security', 'StrongPassword123!');
  });

  it('streams attendance with BOM, CRLF, exact columns and accents intact', async () => {
    const response = await hr.inject({
      url: '/api/v1/attendance/export.csv?from=2026-09-01&to=2026-09-30',
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="attendance_2026-09-01_2026-09-30.csv"',
    );
    expect(response.raw.startsWith('\uFEFF')).toBe(true);
    expect(response.raw).toContain('\r\n');
    const lines = response.raw.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe(
      'date,employee_code,first_name,last_name,department,category,status,first_in,last_out,span_hours,net_hours,visits,flags,amended,first_in_iso,last_out_iso',
    );
    expect(response.raw).toContain("Marie-Claire,L'Espérance");
    expect(response.raw).toContain('"Student Affairs, Residence"');
    expect(response.raw).toContain(',PRESENT,08:03:00,17:12:00,9.15,9.15,1,');
  });

  it('rejects an over-length range and security exports', async () => {
    const tooLong = await hr.inject({
      url: '/api/v1/attendance/export.csv?from=2025-01-01&to=2026-12-31',
    });
    expect(tooLong.status).toBe(422);

    const denied = await security.inject({
      url: '/api/v1/attendance/export.csv?from=2026-09-01&to=2026-09-30',
    });
    expect(denied.status).toBe(403);
  });

  it('exports raw events for audit with local and UTC times', async () => {
    const response = await hr.inject({
      url: `/api/v1/events/export.csv?from=2026-09-01&to=2026-09-30&employeeId=${employeeId}`,
    });
    expect(response.status).toBe(200);
    const lines = response.raw.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe(
      'event_id,date,time,employee_code,first_name,last_name,direction,source,recorded_by,note,occurred_at_iso,superseded_by,voided_at,void_reason,created_at_iso',
    );
    expect(response.raw).toContain('2026-09-10,08:03:00,ALCHE004');
    expect(response.raw).toContain('2026-09-10T04:03:00.000Z');
  });

  it('audits every export', async () => {
    await hr.inject({ url: '/api/v1/attendance/export.csv?from=2026-09-01&to=2026-09-30' });
    await hr.inject({ url: '/api/v1/events/export.csv?from=2026-09-01&to=2026-09-30' });
    const rows = await prisma.auditLog.findMany({
      where: { action: { in: ['export.attendance', 'export.events'] } },
    });
    expect(rows).toHaveLength(2);
  });
});
