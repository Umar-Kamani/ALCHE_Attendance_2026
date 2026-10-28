import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';

type Role = 'SECURITY' | 'HR' | 'DEAN';

interface Probe {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  allowed: Role[];
  body?: Record<string, unknown>;
  multipart?: string;
}

const ID = '00000000-0000-4000-8000-000000000123';
const TODAY = DateTime.now().setZone('Indian/Mauritius').toISODate()!;
const MONTH = DateTime.now().setZone('Indian/Mauritius').toFormat('yyyy-MM');

const EMPTY_CSV =
  'employee_code,first_name,last_name,department\nROLE001,Role,Probe,Administration\n';
const PROBES: Probe[] = [
  { method: 'GET', url: '/api/v1/kiosk/search?q=role', allowed: ['SECURITY', 'HR'] },
  { method: 'GET', url: '/api/v1/kiosk/activity', allowed: ['SECURITY', 'HR'] },
  {
    method: 'POST',
    url: '/api/v1/events',
    allowed: ['SECURITY', 'HR'],
    body: { employeeId: ID, direction: 'IN' },
  },
  { method: 'DELETE', url: `/api/v1/events/${ID}`, allowed: ['SECURITY', 'HR'] },
  {
    method: 'GET',
    url: `/api/v1/attendance?from=${TODAY}&to=${TODAY}`,
    allowed: ['SECURITY', 'HR'],
  },
  {
    method: 'GET',
    url: `/api/v1/attendance/${ID}/month?month=${MONTH}`,
    allowed: ['HR'],
  },
  {
    method: 'GET',
    url: `/api/v1/attendance/export.csv?from=${TODAY}&to=${TODAY}`,
    allowed: ['HR'],
  },
  {
    method: 'GET',
    url: `/api/v1/events/export.csv?from=${TODAY}&to=${TODAY}`,
    allowed: ['HR'],
  },
  { method: 'GET', url: '/api/v1/employees', allowed: ['HR'] },
  {
    method: 'POST',
    url: '/api/v1/employees',
    allowed: ['HR'],
    body: {
      code: 'ROLE100',
      firstName: 'Role',
      lastName: 'Probe',
      department: 'Administration',
    },
  },
  {
    method: 'PATCH',
    url: `/api/v1/employees/${ID}`,
    allowed: ['HR'],
    body: { jobTitle: 'Probe' },
  },
  { method: 'POST', url: '/api/v1/employees/import?dryRun=true', allowed: ['HR'], multipart: EMPTY_CSV },
  { method: 'GET', url: '/api/v1/guests', allowed: ['SECURITY', 'HR'] },
  {
    method: 'POST',
    url: '/api/v1/guests',
    allowed: ['SECURITY', 'HR'],
    body: { fullName: 'Role Probe' },
  },
  { method: 'GET', url: `/api/v1/guests/${ID}`, allowed: ['SECURITY', 'HR'] },
  {
    method: 'PATCH',
    url: `/api/v1/guests/${ID}`,
    allowed: ['SECURITY', 'HR'],
    body: { company: 'Probe Co' },
  },
  { method: 'GET', url: `/api/v1/guest-visits?date=${TODAY}`, allowed: ['SECURITY', 'HR'] },
  {
    method: 'POST',
    url: '/api/v1/guest-visits',
    allowed: ['SECURITY', 'HR'],
    body: {
      guestId: ID,
      hostEmployeeId: ID,
      purpose: 'Role probe',
      expectedFrom: new Date().toISOString(),
      expectedTo: new Date(Date.now() + 3_600_000).toISOString(),
    },
  },
  {
    method: 'POST',
    url: `/api/v1/guest-visits/${ID}/check-in`,
    allowed: ['SECURITY', 'HR'],
    body: {},
  },
  {
    method: 'POST',
    url: `/api/v1/guest-visits/${ID}/check-out`,
    allowed: ['SECURITY', 'HR'],
    body: { releaseParking: false },
  },
  {
    method: 'GET',
    url: `/api/v1/guest-visits/export.csv?from=${TODAY}&to=${TODAY}`,
    allowed: ['SECURITY', 'HR'],
  },
  { method: 'GET', url: '/api/v1/vehicles', allowed: ['SECURITY', 'HR'] },
  { method: 'GET', url: `/api/v1/vehicles/${ID}`, allowed: ['SECURITY', 'HR'] },
  {
    method: 'POST',
    url: '/api/v1/vehicles',
    allowed: ['SECURITY', 'HR'],
    body: { plate: 'RP 1000', holderKind: 'employee', holderId: ID },
  },
  {
    method: 'PATCH',
    url: `/api/v1/vehicles/${ID}`,
    allowed: ['HR'],
    body: { colour: 'Blue' },
  },
  { method: 'GET', url: '/api/v1/parking/areas', allowed: ['SECURITY', 'HR'] },
  {
    method: 'POST',
    url: '/api/v1/parking/areas',
    allowed: ['SECURITY'],
    body: { name: 'Role Probe Lot', code: 'ROLEPROBE' },
  },
  {
    method: 'PATCH',
    url: `/api/v1/parking/areas/${ID}`,
    allowed: ['SECURITY'],
    body: { name: 'Probe' },
  },
  { method: 'GET', url: '/api/v1/parking/bays', allowed: ['SECURITY', 'HR'] },
  {
    method: 'POST',
    url: '/api/v1/parking/bays',
    allowed: ['SECURITY'],
    body: { areaId: ID, code: 'R-01', bayType: 'GENERAL' },
  },
  {
    method: 'PATCH',
    url: `/api/v1/parking/bays/${ID}`,
    allowed: ['SECURITY'],
    body: { active: false },
  },
  {
    method: 'POST',
    url: '/api/v1/parking/bays/bulk',
    allowed: ['SECURITY'],
    body: { areaId: ID, prefix: 'R-', from: 1, to: 2, bayType: 'GENERAL' },
  },
  { method: 'GET', url: '/api/v1/parking/board', allowed: ['SECURITY', 'HR'] },
  {
    method: 'POST',
    url: '/api/v1/parking/sessions',
    allowed: ['SECURITY'],
    body: { vehicleId: ID, autoAssign: true },
  },
  {
    method: 'POST',
    url: `/api/v1/parking/sessions/${ID}/release`,
    allowed: ['SECURITY'],
    body: {},
  },
  {
    method: 'POST',
    url: `/api/v1/parking/sessions/${ID}/relocate`,
    allowed: ['SECURITY'],
    body: { autoAssign: true },
  },
  {
    method: 'GET',
    url: `/api/v1/parking/history?from=${TODAY}&to=${TODAY}`,
    allowed: ['SECURITY', 'HR'],
  },
  {
    method: 'GET',
    url: `/api/v1/parking/export.csv?from=${TODAY}&to=${TODAY}`,
    allowed: ['SECURITY', 'HR'],
  },
  { method: 'GET', url: '/api/v1/tickets', allowed: ['SECURITY', 'HR'] },
  {
    method: 'POST',
    url: '/api/v1/tickets',
    allowed: ['SECURITY', 'HR'],
    body: {
      employeeId: ID,
      proposedDirection: 'IN',
      proposedOccurredAt: new Date().toISOString(),
      reason: 'Role matrix probe',
    },
  },
  {
    method: 'POST',
    url: `/api/v1/tickets/${ID}/approve`,
    allowed: ['HR'],
    body: {},
  },
  {
    method: 'POST',
    url: `/api/v1/tickets/${ID}/reject`,
    allowed: ['HR'],
    body: { reviewNote: 'Probe' },
  },
  {
    method: 'POST',
    url: `/api/v1/tickets/${ID}/apply`,
    allowed: ['HR'],
  },
  {
    method: 'POST',
    url: `/api/v1/tickets/${ID}/withdraw`,
    allowed: ['SECURITY', 'HR'],
    body: { reason: 'Role matrix probe' },
  },
  { method: 'GET', url: '/api/v1/users', allowed: ['HR'] },
  {
    method: 'POST',
    url: '/api/v1/users',
    allowed: ['HR'],
    body: { username: 'role.probe', displayName: 'Role Probe', role: 'SECURITY' },
  },
  {
    method: 'PATCH',
    url: `/api/v1/users/${ID}/role`,
    allowed: ['HR'],
    body: { role: 'SECURITY' },
  },
  { method: 'POST', url: `/api/v1/users/${ID}/deactivate`, allowed: ['HR'] },
  { method: 'POST', url: `/api/v1/users/${ID}/reset-password`, allowed: ['HR'] },
  { method: 'GET', url: '/api/v1/audit', allowed: ['HR'] },
  { method: 'GET', url: '/api/v1/on-campus', allowed: ['SECURITY', 'HR'] },
  { method: 'GET', url: '/api/v1/dashboard/stats', allowed: ['DEAN'] },
  { method: 'GET', url: '/api/v1/auth/me', allowed: ['SECURITY', 'HR', 'DEAN'] },
  {
    method: 'POST',
    url: '/api/v1/auth/change-password',
    allowed: ['SECURITY', 'HR', 'DEAN'],
    body: { currentPassword: 'wrong-password', newPassword: 'Another-Password-123!' },
  },
];

const ROLES: Role[] = ['SECURITY', 'HR', 'DEAN'];

describe('role matrix — every route', () => {
  let app: FastifyInstance;
  const clients = new Map<Role, TestClient>();
  let anonymous: TestClient;

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
    for (const role of ROLES) {
      await createUser({
        username: role.toLowerCase(),
        password: 'StrongPassword123!',
        role,
      });
      const client = new TestClient(app);
      await client.login(role.toLowerCase(), 'StrongPassword123!');
      clients.set(role, client);
    }
    anonymous = new TestClient(app);
    await anonymous.csrf();
  });

  it('is exercised by a complete probe table', () => {
    expect(PROBES.length).toBeGreaterThanOrEqual(54);
  });

  for (const probe of PROBES) {
    it(`${probe.method} ${probe.url} — allowed and denied by role`, async () => {
      for (const role of ROLES) {
        const client = clients.get(role)!;
        const response = await client.inject({
          method: probe.method,
          url: probe.url,
          ...(probe.body ? { body: probe.body } : {}),
          ...(probe.multipart
            ? {
                multipart: {
                  filename: 'probe.csv',
                  content: probe.multipart,
                },
              }
            : {}),
        });
        if (probe.allowed.includes(role)) {
          expect([401, 403], `${role} was unexpectedly denied`).not.toContain(response.status);
          expect(response.status, `${role} caused a server error`).toBeLessThan(500);
        } else {
          expect(response.status, `${role} should be denied`).toBe(403);
        }
      }

      const response = await anonymous.inject({
        method: probe.method,
        url: probe.url,
        ...(probe.body ? { body: probe.body } : {}),
        ...(probe.multipart
          ? { multipart: { filename: 'probe.csv', content: probe.multipart } }
          : {}),
      });
      expect([401, 403]).toContain(response.status);
    });
  }

  it('serves public health, CSRF and login routes without a session', async () => {
    const health = await anonymous.inject({ url: '/healthz' });
    expect(health.status).toBe(200);
    const csrf = await anonymous.inject({ url: '/api/v1/auth/csrf' });
    expect(csrf.status).toBe(200);
    const login = await anonymous.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { username: 'nobody', password: 'WrongPassword123!' },
    });
    expect(login.status).toBe(401);
  });

  it('allows every role to sign out and revoke its own sessions', async () => {
    for (const role of ROLES) {
      const username = role.toLowerCase();
      const client = new TestClient(app);
      await client.login(username, 'StrongPassword123!');
      const revoke = await client.inject({
        method: 'POST',
        url: '/api/v1/auth/revoke-all-sessions',
      });
      expect(revoke.status).toBe(200);
      expect((await client.inject({ url: '/api/v1/auth/me' })).status).toBe(401);

      await client.login(username, 'StrongPassword123!');
      const logout = await client.inject({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(logout.status).toBe(200);
      expect((await client.inject({ url: '/api/v1/auth/me' })).status).toBe(401);
    }
  });
});
