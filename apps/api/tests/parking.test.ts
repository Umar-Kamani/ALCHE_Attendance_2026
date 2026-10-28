import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';

const ZONE = 'Indian/Mauritius';

interface Fixture {
  areaId: string;
  bayIds: Record<string, string>;
  staffVehicleId: string;
  guestVehicleId: string;
}

describe('P7 parking allocation and inventory', () => {
  let app: FastifyInstance;
  let security: TestClient;
  let hr: TestClient;
  let fixture: Fixture;

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
    await createUser({ username: 'security', password: 'StrongPassword123!', role: 'SECURITY' });
    await createUser({ username: 'hr', password: 'StrongPassword123!', role: 'HR' });
    security = new TestClient(app);
    await security.login('security', 'StrongPassword123!');
    hr = new TestClient(app);
    await hr.login('hr', 'StrongPassword123!');

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
    const guest = await prisma.guest.create({
      data: { fullName: 'Élodie Tran', company: 'Telecom', active: true },
    });
    const staffVehicle = await prisma.vehicle.create({
      data: {
        plate: 'AB 1234',
        plateNorm: 'AB1234',
        vehicleType: 'car',
        employeeId: employee.id,
        active: true,
      },
    });
    const guestVehicle = await prisma.vehicle.create({
      data: {
        plate: 'GU 9080',
        plateNorm: 'GU9080',
        vehicleType: 'car',
        guestId: guest.id,
        active: true,
      },
    });
    const area = await prisma.parkingArea.create({
      data: { name: 'Main Lot', code: 'MAIN', active: true },
    });
    const bayCodes: Array<[string, string]> = [
      ['STAFF', 'A-10'],
      ['GENERAL', 'A-01'],
      ['GENERAL', 'A-02'],
      ['GENERAL', 'A-03'],
      ['ACCESSIBLE', 'A-05'],
      ['MOTORBIKE', 'A-06'],
    ];
    const bayIds: Record<string, string> = {};
    for (const [bayType, code] of bayCodes) {
      const bay = await prisma.parkingBay.create({
        data: { areaId: area.id, code, bayType, active: true },
      });
      bayIds[code] = bay.id;
    }
    fixture = {
      areaId: area.id,
      bayIds,
      staffVehicleId: staffVehicle.id,
      guestVehicleId: guestVehicle.id,
    };
  });

  async function allocate(vehicleId: string, bayId?: string, overrideReason?: string) {
    return security.inject<{
      session: {
        id: string;
        bayCode: string;
        isOverride: boolean;
        overrideReason: string | null;
        holderCategory: string;
      };
    }>({
      method: 'POST',
      url: '/api/v1/parking/sessions',
      body: {
        vehicleId,
        ...(bayId ? { bayId } : { autoAssign: true }),
        ...(overrideReason ? { overrideReason } : {}),
      },
    });
  }

  it('allocates and releases a bay and exposes a truthful board', async () => {
    const allocated = await allocate(fixture.staffVehicleId, fixture.bayIds['A-10']!);
    expect(allocated.status).toBe(201);
    expect(allocated.body.session.bayCode).toBe('A-10');

    const board = await security.inject<{
      counts: { overall: { total: number; occupied: number; free: number } };
      areas: Array<{ bays: Array<{ code: string; chip: string; session: unknown }> }>;
    }>({ url: '/api/v1/parking/board' });
    expect(board.status).toBe(200);
    expect(board.body.counts.overall).toMatchObject({ total: 6, occupied: 1, free: 5 });
    const bay = board.body.areas
      .flatMap((area) => area.bays)
      .find((item) => item.code === 'A-10');
    expect(bay?.chip).toBe('S');
    expect(bay?.session).toBeTruthy();

    const released = await security.inject({
      method: 'POST',
      url: `/api/v1/parking/sessions/${allocated.body.session.id}/release`,
      body: { reason: 'Staff left campus' },
    });
    expect(released.status).toBe(200);
    const freeBay = await prisma.parkingBay.findUniqueOrThrow({
      where: { id: fixture.bayIds['A-10']! },
    });
    expect(freeBay.active).toBe(true);
    expect(
      await prisma.parkingSession.count({ where: { bayId: freeBay.id, endedAt: null } }),
    ).toBe(0);
  });

  it('accepts an explicit kiosk start time for a parking session', async () => {
    const startedAt = DateTime.now().setZone(ZONE).minus({ hours: 2 }).toUTC().toISO();
    const response = await security.inject<{ session: { startedAt: string; bayCode: string } }>({
      method: 'POST',
      url: '/api/v1/parking/sessions',
      body: {
        vehicleId: fixture.staffVehicleId,
        bayId: fixture.bayIds['A-10']!,
        startedAt,
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.session.startedAt).toBe(startedAt);
    const stored = await prisma.parkingSession.findFirstOrThrow({
      where: { vehicleId: fixture.staffVehicleId, endedAt: null },
    });
    expect(stored.startedAt.toISOString()).toBe(startedAt);
  });

  it('rejects double allocation and double parking with friendly 409s', async () => {
    const first = await allocate(fixture.staffVehicleId, fixture.bayIds['A-01']!);
    expect(first.status).toBe(201);

    const otherEmployee = await prisma.employee.create({
      data: {
        code: 'ALCHE099',
        firstName: 'Other',
        lastName: 'Driver',
        department: 'Facilities',
        category: 'staff',
        active: true,
      },
    });
    const other = await prisma.vehicle.create({
      data: {
        plate: 'AB 9999',
        plateNorm: 'AB9999',
        vehicleType: 'car',
        employeeId: otherEmployee.id,
        active: true,
      },
    });
    const bayConflict = await allocate(other.id, fixture.bayIds['A-01']!);
    expect(bayConflict.status).toBe(409);
    expect((bayConflict.body as { error: { code: string } }).error.code).toBe('BAY_OCCUPIED');

    const vehicleConflict = await allocate(fixture.staffVehicleId, fixture.bayIds['A-02']!);
    expect(vehicleConflict.status).toBe(409);
    expect((vehicleConflict.body as { error: { code: string } }).error.code).toBe(
      'VEHICLE_ALREADY_PARKED',
    );
    expect((vehicleConflict.body as { error: { message: string } }).error.message).toContain('A-01');
  });

  it('blocks a mismatched bay unless a typed reason is supplied and audited', async () => {
    const denied = await allocate(fixture.staffVehicleId, fixture.bayIds['A-06']!);
    expect(denied.status).toBe(422);
    expect((denied.body as { error: { message: string } }).error.message).toContain('reserved');

    const allowed = await allocate(
      fixture.staffVehicleId,
      fixture.bayIds['A-06']!,
      'Overflow from staff lot during graduation rehearsal',
    );
    expect(allowed.status).toBe(201);
    expect(allowed.body.session.isOverride).toBe(true);
    expect(allowed.body.session.overrideReason).toContain('graduation');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'parking.override' } });
    expect(audit).not.toBeNull();
  });

  it('requires an override for accessible bays', async () => {
    const denied = await allocate(fixture.staffVehicleId, fixture.bayIds['A-05']!);
    expect(denied.status).toBe(422);
    const allowed = await allocate(
      fixture.staffVehicleId,
      fixture.bayIds['A-05']!,
      'Visitor with a mobility permit shown at the gate',
    );
    expect(allowed.status).toBe(201);
  });

  it('auto-assigns matching type before GENERAL and falls back to GENERAL', async () => {
    const matching = await allocate(fixture.staffVehicleId);
    expect(matching.status).toBe(201);
    expect(matching.body.session.bayCode).toBe('A-10');

    const secondEmployee = await prisma.employee.create({
      data: {
        code: 'ALCHE002',
        firstName: 'Priya',
        lastName: 'Ramgoolam',
        department: 'Finance',
        category: 'staff',
        active: true,
      },
    });
    const secondVehicle = await prisma.vehicle.create({
      data: {
        plate: 'AB 5678',
        plateNorm: 'AB5678',
        vehicleType: 'car',
        employeeId: secondEmployee.id,
        active: true,
      },
    });
    await prisma.parkingBay.update({
      where: { id: fixture.bayIds['A-10']! },
      data: { active: true },
    });
    const fallback = await allocate(secondVehicle.id);
    expect(fallback.status).toBe(201);
    expect(fallback.body.session.bayCode).toBe('A-01');
  });

  it('fails when no suitable bay is free instead of using a reserved type', async () => {
    let index = 0;
    for (const code of ['A-01', 'A-02', 'A-03']) {
      const filler = await prisma.employee.create({
        data: {
          code: `ALCHE90${index}`,
          firstName: 'Filler',
          lastName: `Driver ${index}`,
          department: 'Facilities',
          category: 'staff',
          active: true,
        },
      });
      const vehicle = await prisma.vehicle.create({
        data: {
          plate: `XX 000${index}`,
          plateNorm: `XX000${index}`,
          vehicleType: 'car',
          employeeId: filler.id,
          active: true,
        },
      });
      await allocate(vehicle.id, fixture.bayIds[code]!);
      index += 1;
    }
    const result = await allocate(fixture.guestVehicleId);
    expect(result.status).toBe(409);
    expect((result.body as { error: { code: string } }).error.code).toBe('NO_SUITABLE_BAY');
  });

  it('relocates atomically and frees the old bay', async () => {
    const allocated = await allocate(fixture.staffVehicleId, fixture.bayIds['A-01']!);
    const relocated = await security.inject<{
      session: { id: string; bayCode: string };
      releasedSessionId: string;
    }>({
      method: 'POST',
      url: `/api/v1/parking/sessions/${allocated.body.session.id}/relocate`,
      body: { bayId: fixture.bayIds['A-02']! },
    });
    expect(relocated.status).toBe(200);
    expect(relocated.body.session.bayCode).toBe('A-02');
    expect(relocated.body.releasedSessionId).toBe(allocated.body.session.id);
    expect(
      await prisma.parkingSession.count({
        where: { bayId: fixture.bayIds['A-01']!, endedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.parkingSession.count({
        where: { bayId: fixture.bayIds['A-02']!, endedAt: null },
      }),
    ).toBe(1);
  });

  it('refuses to deactivate an occupied bay and skips existing codes in bulk create', async () => {
    await allocate(fixture.staffVehicleId, fixture.bayIds['A-10']!);
    const deactivate = await security.inject({
      method: 'PATCH',
      url: `/api/v1/parking/bays/${fixture.bayIds['A-10']!}`,
      body: { active: false },
    });
    expect(deactivate.status).toBe(409);

    await prisma.parkingBay.create({
      data: { areaId: fixture.areaId, code: 'B-02', bayType: 'GENERAL', active: true },
    });

    const bulk = await security.inject<{
      skipped: string[];
      created: Array<{ code: string }>;
      preview: string[];
    }>({
      method: 'POST',
      url: '/api/v1/parking/bays/bulk',
      body: {
        areaId: fixture.areaId,
        prefix: 'B-',
        padding: 2,
        from: 1,
        to: 3,
        bayType: 'GENERAL',
        dryRun: false,
      },
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.preview).toEqual(['B-01', 'B-02', 'B-03']);
    expect(bulk.body.skipped).toEqual(['B-02']);
    expect(bulk.body.created.map((bay) => bay.code)).toEqual(['B-01', 'B-03']);
  });

  it('keeps bay inventory writes with security and HR read-only', async () => {
    const hrWrite = await hr.inject({
      method: 'POST',
      url: '/api/v1/parking/areas',
      body: { name: 'HR Overreach', code: 'HRX' },
    });
    expect(hrWrite.status).toBe(403);

    const securityWrite = await security.inject({
      method: 'POST',
      url: '/api/v1/parking/areas',
      body: { name: 'Admin Front', code: 'ADMIN' },
    });
    expect(securityWrite.status).toBe(201);

    const read = await hr.inject({ url: '/api/v1/parking/areas' });
    expect(read.status).toBe(200);
  });

  it('reports parking history and exports sessions with BOM and exact columns', async () => {
    const allocated = await allocate(fixture.guestVehicleId, fixture.bayIds['A-01']!);
    await security.inject({
      method: 'POST',
      url: `/api/v1/parking/sessions/${allocated.body.session.id}/release`,
      body: {},
    });
    const today = DateTime.now().setZone(ZONE).toISODate()!;
    const history = await security.inject<{
      rows: Array<{ peakOccupancy: number; sessions: number }>;
      totals: { sessions: number };
    }>({ url: `/api/v1/parking/history?from=${today}&to=${today}` });
    expect(history.status).toBe(200);
    expect(history.body.rows[0]?.peakOccupancy).toBeGreaterThanOrEqual(1);
    expect(history.body.totals.sessions).toBe(1);

    const exported = await security.inject({
      url: `/api/v1/parking/export.csv?from=${today}&to=${today}`,
    });
    expect(exported.status).toBe(200);
    expect(exported.raw.startsWith('\uFEFF')).toBe(true);
    const lines = exported.raw.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe(
      'date,bay,area,bay_type,plate,holder_name,holder_category,started_at,ended_at,minutes,allocated_by,override',
    );
    expect(exported.raw).toContain('A-01,Main Lot,GENERAL,GU 9080,Élodie Tran,guest');
  });

  it('allows only one active parking session per holder across their vehicles', async () => {
    await allocate(fixture.staffVehicleId, fixture.bayIds['A-01']!);
    const employee = await prisma.employee.findFirstOrThrow();
    const secondVehicle = await prisma.vehicle.create({
      data: {
        plate: 'AB 7700',
        plateNorm: 'AB7700',
        vehicleType: 'car',
        employeeId: employee.id,
        active: true,
      },
    });
    const response = await allocate(secondVehicle.id, fixture.bayIds['A-02']!);
    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe(
      'HOLDER_ALREADY_PARKED',
    );
  });

  it('prevents a guest vehicle from being double-parked', async () => {
    const first = await allocate(fixture.guestVehicleId, fixture.bayIds['A-01']!);
    expect(first.status).toBe(201);
    const second = await allocate(fixture.guestVehicleId, fixture.bayIds['A-02']!);
    expect(second.status).toBe(409);
    expect((second.body as { error: { code: string } }).error.code).toBe('VEHICLE_ALREADY_PARKED');
  });
});
