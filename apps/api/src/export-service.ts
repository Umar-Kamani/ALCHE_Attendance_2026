import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type { AttendanceExportQuery } from '@alche/shared';
import { prisma } from './db.js';
import { deriveDateRange } from './attendance.js';
import { loadEffectiveEventsForEmployees } from './attendance-service.js';
import { APP_ZONE, currentLocalDate, localTimeOf, rangeEndUtc, rangeStartUtc } from './time.js';
import type { CsvRow } from './csv.js';

const ATTENDANCE_COLUMNS = [
  'date',
  'employee_code',
  'first_name',
  'last_name',
  'department',
  'category',
  'status',
  'first_in',
  'last_out',
  'span_hours',
  'net_hours',
  'visits',
  'flags',
  'amended',
  'first_in_iso',
  'last_out_iso',
];

export const attendanceExportColumns = ATTENDANCE_COLUMNS;

export async function* attendanceExportRows(
  filter: AttendanceExportQuery,
): AsyncGenerator<CsvRow> {
  const where: Prisma.EmployeeWhereInput = {
    ...(filter.department ? { department: filter.department } : {}),
    ...(filter.category ? { category: filter.category } : {}),
  };
  const before = DateTime.fromISO(filter.to, { zone: APP_ZONE })
    .plus({ days: 2 })
    .startOf('day')
    .toUTC()
    .toJSDate();
  const today = currentLocalDate();
  let cursor: string | undefined;

  while (true) {
    const employees = await prisma.employee.findMany({
      where,
      orderBy: { id: 'asc' },
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (employees.length === 0) break;
    cursor = employees[employees.length - 1]!.id;

    const eventMap = await loadEffectiveEventsForEmployees(
      employees.map((employee) => employee.id),
      before,
    );

    for (const employee of employees) {
      const events = eventMap.get(employee.id) ?? [];
      if (!employee.active && events.length === 0) continue;
      const days = deriveDateRange(events, filter.from, filter.to, today);
      for (const day of days) {
        if (filter.status && day.status !== filter.status) continue;
        yield {
          date: day.date,
          employee_code: employee.code,
          first_name: employee.firstName,
          last_name: employee.lastName,
          department: employee.department,
          category: employee.category,
          status: day.status,
          first_in: day.firstIn ? localTimeOf(day.firstIn) : '',
          last_out: day.lastOut ? localTimeOf(day.lastOut) : '',
          span_hours: day.spanHours === null ? '' : day.spanHours.toFixed(2),
          net_hours: day.netHours.toFixed(2),
          visits: day.visits,
          flags: day.flags.join(';'),
          amended: day.amended ? 'TRUE' : 'FALSE',
          first_in_iso: day.firstIn?.toISOString() ?? '',
          last_out_iso: day.lastOut?.toISOString() ?? '',
        };
      }
    }

    if (employees.length < 50) break;
  }
}

const EVENT_COLUMNS = [
  'event_id',
  'date',
  'time',
  'employee_code',
  'first_name',
  'last_name',
  'direction',
  'source',
  'recorded_by',
  'note',
  'occurred_at_iso',
  'superseded_by',
  'voided_at',
  'void_reason',
  'created_at_iso',
];

export const eventExportColumns = EVENT_COLUMNS;

export async function* eventExportRows(filter: {
  from: string;
  to: string;
  employeeId?: string | undefined;
}): AsyncGenerator<CsvRow> {
  const where: Prisma.EventWhereInput = {
    occurredAt: { gte: rangeStartUtc(filter.from), lt: rangeEndUtc(filter.to) },
    ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
  };
  let cursor: string | undefined;
  while (true) {
    const events = await prisma.event.findMany({
      where,
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        employee: { select: { code: true, firstName: true, lastName: true } },
        recorder: { select: { displayName: true } },
      },
    });
    if (events.length === 0) break;
    cursor = events[events.length - 1]!.id;

    for (const event of events) {
      const local = DateTime.fromJSDate(event.occurredAt, { zone: 'utc' }).setZone(APP_ZONE);
      yield {
        event_id: event.id,
        date: local.toISODate() ?? '',
        time: local.toFormat('HH:mm:ss'),
        employee_code: event.employee.code,
        first_name: event.employee.firstName,
        last_name: event.employee.lastName,
        direction: event.direction,
        source: event.source,
        recorded_by: event.recorder?.displayName ?? '',
        note: event.note ?? '',
        occurred_at_iso: event.occurredAt.toISOString(),
        superseded_by: event.supersededById ?? '',
        voided_at: event.voidedAt?.toISOString() ?? '',
        void_reason: event.voidReason ?? '',
        created_at_iso: event.createdAt.toISOString(),
      };
    }

    if (events.length < 500) break;
  }
}
