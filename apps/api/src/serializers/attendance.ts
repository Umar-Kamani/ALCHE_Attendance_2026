import type { Employee, Event, User } from '@prisma/client';
import type { AttendanceRow } from '@alche/shared';
import type { AttendanceDerivation } from '../attendance.js';
import { isoRequired, localTimeOf } from '../time.js';

export type EventWithPeople = Event & {
  employee: Pick<Employee, 'firstName' | 'lastName' | 'code'>;
  recorder: Pick<User, 'displayName'> | null;
};

export function serializeEvent(event: EventWithPeople) {
  return {
    id: event.id,
    employeeId: event.employeeId,
    employeeName: `${event.employee.firstName} ${event.employee.lastName}`,
    employeeCode: event.employee.code,
    occurredAt: isoRequired(event.occurredAt),
    direction: event.direction as 'IN' | 'OUT',
    source: event.source as 'gate' | 'amendment' | 'hr_edit',
    note: event.note,
    recordedBy: event.recorder?.displayName ?? null,
    supersededById: event.supersededById,
    voidedAt: event.voidedAt?.toISOString() ?? null,
    ticketId: event.ticketId,
    createdAt: isoRequired(event.createdAt),
  };
}

export function serializeAttendanceRow(
  employee: Employee,
  derivation: AttendanceDerivation,
): AttendanceRow {
  return {
    date: derivation.date,
    employeeId: employee.id,
    employeeCode: employee.code,
    firstName: employee.firstName,
    lastName: employee.lastName,
    department: employee.department,
    category: employee.category as 'staff' | 'contractor',
    status: derivation.status,
    firstIn: derivation.firstIn?.toISOString() ?? null,
    lastOut: derivation.lastOut?.toISOString() ?? null,
    firstInLocal: derivation.firstIn ? localTimeOf(derivation.firstIn) : null,
    lastOutLocal: derivation.lastOut ? localTimeOf(derivation.lastOut) : null,
    spanHours: derivation.spanHours,
    netHours: derivation.netHours,
    visits: derivation.visits,
    flags: derivation.flags,
    amended: derivation.amended,
  };
}
