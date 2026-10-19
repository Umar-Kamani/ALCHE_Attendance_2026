import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';

const ZONE = 'Indian/Mauritius';

function nowPlus(hours: number): string {
  return DateTime.now().setZone(ZONE).plus({ hours }).toUTC().toISO()!;
}

describe('P6 vehicles and guests', () => {
  let app: FastifyInstance;
  let security: TestClient;
  let hr: TestClient;
  let hostId: string;

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
    const host = await prisma.employee.create({
      data: {
        code: 'ALCHE001',
        firstName: 'Nadia',
        lastName: 'Bossy',
        department: 'Administration',
        category: 'staff',
        active: true,
      },
    });
    hostId = host.id;
    await createUser({ username: 'security', password: 'StrongPassword123!', role: 'SECURITY' });
    await createUser({ username: 'hr', password: 'StrongPassword123!', role: 'HR' });
    security = new TestClient(app);
    await security.login('security', 'StrongPassword123!');
    hr = new TestClient(app);
    await hr.login('hr', 'StrongPassword123!');
  });

  async function newGuest(name = 'Élodie Tran') {
    const response = await security.inject<{ id: string }>({
      method: 'POST',
      url: '/api/v1/guests',
      body: { fullName: name, company: 'Mauritius Telecom', phone: '+230 5000 0000' },
    });
    expect(response.status).toBe(201);
    return response.body.id;
  }

  async function preRegister(guestId: string, from = nowPlus(-4), to = nowPlus(2)) {
    const response = await security.inject<{ visit: { id: string } }>({
      method: 'POST',
      url: '/api/v1/guest-visits',
      body: {
        guestId,
        hostEmployeeId: hostId,
        purpose: 'Campus tour',
        expectedFrom: from,
        expectedTo: to,
        badgeNo: 'V-104',
      },
    });
    expect(response.status).toBe(201);
    return response.body.visit.id;
  }

  it('creates vehicles, normalises plates and names the existing holder on conflict', async () => {
    const created = await security.inject<{
      id: string;
      plate: string;
      plateNorm: string;
      holder: { name: string };
    }>({
      method: 'POST',
      url: '/api/v1/vehicles',
      body: {
        plate: 'ab 1234',
        make: 'Toyota',
        model: 'Corolla',
        colour: 'White',
        vehicleType: 'car',
        holderKind: 'employee',
        holderId: hostId,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      plate: 'AB 1234',
      plateNorm: 'AB1234',
      holder: { name: 'Nadia Bossy' },
    });

    const duplicate = await security.inject<{ error: { code: string; message: string } }>({
      method: 'POST',
      url: '/api/v1/vehicles',
      body: {
        plate: 'AB-1234',
        vehicleType: 'car',
        holderKind: 'employee',
        holderId: hostId,
      },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('PLATE_TAKEN');
    expect(duplicate.body.error.message).toContain('Nadia Bossy');

    const search = await security.inject<{ items: Array<{ id: string }> }>({
      url: '/api/v1/vehicles?q=AB1234',
    });
    expect(search.body.items).toHaveLength(1);

    const securityEdit = await security.inject({
      method: 'PATCH',
      url: `/api/v1/vehicles/${created.body.id}`,
      body: { colour: 'Blue' },
    });
    expect(securityEdit.status).toBe(403);

    const hrEdit = await hr.inject<{ colour: string }>({
      method: 'PATCH',
      url: `/api/v1/vehicles/${created.body.id}`,
      body: { colour: 'Blue' },
    });
    expect(hrEdit.status).toBe(200);
    expect(hrEdit.body.colour).toBe('Blue');

    const detail = await hr.inject<{ history: unknown[]; holder: { kind: string } }>({
      url: `/api/v1/vehicles/${created.body.id}`,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.history).toEqual([]);
    expect(detail.body.holder.kind).toBe('employee');
  });

  it('requires a host, checks in once and checks out once', async () => {
    const guestId = await newGuest();
    const missingHost = await security.inject({
      method: 'POST',
      url: '/api/v1/guest-visits',
      body: {
        guestId,
        purpose: 'Meeting',
        expectedFrom: nowPlus(0),
        expectedTo: nowPlus(2),
      },
    });
    expect(missingHost.status).toBe(422);

    const visitId = await preRegister(guestId);
    const checkIn = await security.inject<{ visit: { status: string; checkedInAt: string } }>({
      method: 'POST',
      url: `/api/v1/guest-visits/${visitId}/check-in`,
      body: { badgeNo: 'V-105' },
    });
    expect(checkIn.status).toBe(200);
    expect(checkIn.body.visit.status).toBe('ON_SITE');

    const secondCheckIn = await security.inject({
      method: 'POST',
      url: `/api/v1/guest-visits/${visitId}/check-in`,
      body: {},
    });
    expect(secondCheckIn.status).toBe(409);

    const checkOut = await security.inject<{
      visit: { status: string; checkedOutAt: string };
    }>({
      method: 'POST',
      url: `/api/v1/guest-visits/${visitId}/check-out`,
      body: { note: 'Left through the main gate' },
    });
    expect(checkOut.status).toBe(200);
    expect(checkOut.body.visit.status).toBe('DEPARTED');
    expect(checkOut.body.visit.checkedOutAt).toBeTruthy();

    const secondCheckOut = await security.inject({
      method: 'POST',
      url: `/api/v1/guest-visits/${visitId}/check-out`,
      body: {},
    });
    expect(secondCheckOut.status).toBe(409);
  });

  it('flags an overdue guest while they remain on site', async () => {
    const guestId = await newGuest();
    const visitId = await preRegister(guestId, nowPlus(-3), nowPlus(-1));
    await security.inject({
      method: 'POST',
      url: `/api/v1/guest-visits/${visitId}/check-in`,
      body: {},
    });
    const today = DateTime.now().setZone(ZONE).toISODate()!;
    const list = await security.inject<{
      items: Array<{ status: string; overdue: boolean }>;
      counts: { overdue: number; onSite: number };
    }>({ url: `/api/v1/guest-visits?date=${today}` });
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ status: 'OVERDUE', overdue: true });
    expect(list.body.counts.overdue).toBe(1);
  });

  it('creates a guest vehicle inline and exports the guest register', async () => {
    const guestId = await newGuest('Priya Naidoo');
    const visit = await security.inject<{ visit: { id: string } }>({
      method: 'POST',
      url: '/api/v1/guest-visits',
      body: {
        guestId,
        hostEmployeeId: hostId,
        purpose: 'Supplier meeting',
        expectedFrom: nowPlus(-1),
        expectedTo: nowPlus(2),
        vehicle: {
          plate: 'GU 9080',
          make: 'Nissan',
          model: 'Note',
          colour: 'Silver',
          vehicleType: 'car',
        },
      },
    });
    expect(visit.status).toBe(201);
    const guestVehicle = await prisma.vehicle.findFirstOrThrow({ where: { guestId } });
    expect(guestVehicle.plateNorm).toBe('GU9080');

    await security.inject({
      method: 'POST',
      url: `/api/v1/guest-visits/${visit.body.visit.id}/check-in`,
      body: {},
    });

    const today = DateTime.now().setZone(ZONE).toISODate()!;
    const exported = await security.inject({
      url: `/api/v1/guest-visits/export.csv?from=${today}&to=${today}`,
    });
    expect(exported.status).toBe(200);
    expect(exported.raw.startsWith('\uFEFF')).toBe(true);
    const lines = exported.raw.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe(
      'date_in,time_in,date_out,time_out,guest_name,company,phone,id_number,host_employee,host_department,purpose,badge_no,vehicle_plate,status',
    );
    expect(exported.raw).toContain('Priya Naidoo');
    expect(exported.raw).toContain('GU 9080');
    expect(exported.raw).toContain('ON_SITE');
  });

  it('lists guests with visit counts and deactivates without deleting visits', async () => {
    const guestId = await newGuest();
    await preRegister(guestId);
    const list = await security.inject<{ items: Array<{ visitCount: number }> }>({
      url: '/api/v1/guests',
    });
    expect(list.status).toBe(200);
    expect(list.body.items[0]?.visitCount).toBe(1);

    const deactivated = await security.inject<{ active: boolean }>({
      method: 'PATCH',
      url: `/api/v1/guests/${guestId}`,
      body: { active: false },
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);
    expect(await prisma.guestVisit.count()).toBe(1);
  });
});
