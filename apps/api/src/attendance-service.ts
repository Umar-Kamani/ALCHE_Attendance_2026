import type { Employee } from '@prisma/client';
import { DateTime } from 'luxon';
import type { AttendanceStatus, EmployeeCategory } from '@alche/shared';
import { prisma } from './db.js';
import { deriveDateRange, type DerivationEvent } from './attendance.js';
import { APP_ZONE, currentLocalDate, rangeEndUtc, rangeStartUtc } from './time.js';
import { serializeAttendanceRow } from './serializers/attendance.js';

export interface AttendanceFilters {
  from: string;
  to: string;
  department?: string;
  category?: EmployeeCategory;
  status?: AttendanceStatus;
}

export interface DerivedRow {
  employee: Employee;
  derivation: ReturnType<typeof deriveDateRange>[number];
}

export async function loadEffectiveEventsForEmployees(
  employeeIds: string[],
  before: Date,
): Promise<Map<string, DerivationEvent[]>> {
  if (employeeIds.length === 0) return new Map();
  const events = await prisma.event.findMany({
    where: {
      employeeId: { in: employeeIds },
      supersededById: null,
      voidedAt: null,
      occurredAt: { lt: before },
    },
    select: {
      id: true,
      employeeId: true,
      occurredAt: true,
      direction: true,
      source: true,
    },
    orderBy: { occurredAt: 'asc' },
  });
  const map = new Map<string, DerivationEvent[]>();
  for (const event of events) {
    const list = map.get(event.employeeId) ?? [];
    list.push({
      id: event.id,
      occurredAt: event.occurredAt,
      direction: event.direction as 'IN' | 'OUT',
      source: event.source as 'gate' | 'amendment' | 'hr_edit',
    });
    map.set(event.employeeId, list);
  }
  return map;
}

export async function deriveRows(filters: AttendanceFilters): Promise<DerivedRow[]> {
  const employees = await prisma.employee.findMany({
    where: {
      ...(filters.department ? { department: filters.department } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const today = currentLocalDate();
  const before = rangeEndUtc(DateTime.fromISO(filters.to, { zone: APP_ZONE }).plus({ days: 1 }).toISODate()!);
  const eventMap = await loadEffectiveEventsForEmployees(
    employees.map((employee) => employee.id),
    before,
  );

  const rows: DerivedRow[] = [];
  for (const employee of employees) {
    const events = eventMap.get(employee.id) ?? [];
    const derivations = deriveDateRange(events, filters.from, filters.to, today);
    if (!employee.active && events.length === 0) continue;
    for (const derivation of derivations) {
      if (filters.status && derivation.status !== filters.status) continue;
      rows.push({ employee, derivation });
    }
  }

  rows.sort((a, b) => {
    if (a.derivation.date !== b.derivation.date) return a.derivation.date < b.derivation.date ? 1 : -1;
    const last = a.employee.lastName.localeCompare(b.employee.lastName);
    return last !== 0 ? last : a.employee.firstName.localeCompare(b.employee.firstName);
  });
  return rows;
}

export function attendanceTotals(rows: DerivedRow[]) {
  const totals = {
    present: 0,
    onSite: 0,
    missingIn: 0,
    absent: 0,
    averageSpanHours: null as number | null,
  };
  let spanTotal = 0;
  let spanCount = 0;
  for (const row of rows) {
    switch (row.derivation.status) {
      case 'PRESENT':
        totals.present += 1;
        if (row.derivation.spanHours !== null) {
          spanTotal += row.derivation.spanHours;
          spanCount += 1;
        }
        break;
      case 'ON_SITE':
        totals.onSite += 1;
        break;
      case 'MISSING_IN':
        totals.missingIn += 1;
        break;
      case 'ABSENT':
        totals.absent += 1;
        break;
    }
  }
  totals.averageSpanHours =
    spanCount === 0 ? null : Math.round((spanTotal / spanCount) * 100) / 100;
  return totals;
}

export async function monthDetail(employeeId: string, month: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;

  const start = DateTime.fromISO(`${month}-01`, { zone: APP_ZONE }).startOf('month');
  const end = start.endOf('month');
  const from = start.toISODate() ?? '';
  const to = end.toISODate() ?? '';
  const dayAfter = end.plus({ days: 2 }).toUTC().toJSDate();
  const eventMap = await loadEffectiveEventsForEmployees([employeeId], dayAfter);
  const events = eventMap.get(employeeId) ?? [];
  const days = deriveDateRange(events, from, to, currentLocalDate()).map((derivation) =>
    serializeAttendanceRow(employee, derivation),
  );

  const eventRows = await prisma.event.findMany({
    where: {
      employeeId,
      supersededById: null,
      voidedAt: null,
      occurredAt: {
        gte: rangeStartUtc(from),
        lt: rangeEndUtc(to),
      },
    },
    include: {
      employee: { select: { firstName: true, lastName: true, code: true } },
      recorder: { select: { displayName: true } },
    },
    orderBy: { occurredAt: 'asc' },
  });

  return { employee, days, events: eventRows };
}
