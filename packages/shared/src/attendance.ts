import { z } from 'zod';
import {
  AttendanceFlagSchema,
  AttendanceStatusSchema,
  DirectionSchema,
  EmployeeCategorySchema,
  EventSourceSchema,
} from './enums.js';
import {
  IsoDateTimeSchema,
  LocalDateSchema,
  LocalMonthSchema,
  PaginationMetaSchema,
  SuccessSchema,
  TimeSchema,
  UuidSchema,
} from './common.js';

export const AttendanceEventSchema = z.object({
  id: UuidSchema,
  employeeId: UuidSchema,
  employeeName: z.string(),
  employeeCode: z.string(),
  occurredAt: IsoDateTimeSchema,
  direction: DirectionSchema,
  source: EventSourceSchema,
  note: z.string().nullable(),
  recordedBy: z.string().nullable(),
  supersededById: UuidSchema.nullable(),
  voidedAt: z.string().nullable(),
  ticketId: UuidSchema.nullable(),
  createdAt: z.string(),
});
export type AttendanceEvent = z.infer<typeof AttendanceEventSchema>;

export const EventListResponseSchema = z.object({ items: z.array(AttendanceEventSchema) });

export const CreateEventBodySchema = z.object({
  employeeId: UuidSchema,
  direction: DirectionSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const CreateEventResponseSchema = z.object({
  event: AttendanceEventSchema,
  inferredDirection: DirectionSchema,
  undoUntil: z.string().nullable(),
  employeeState: z.object({
    onCampus: z.boolean(),
    since: z.string().nullable(),
  }),
});

export const UndoResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

export const AttendanceRowSchema = z.object({
  date: LocalDateSchema,
  employeeId: UuidSchema,
  employeeCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  department: z.string(),
  category: EmployeeCategorySchema,
  status: AttendanceStatusSchema,
  firstIn: z.string().nullable(),
  lastOut: z.string().nullable(),
  firstInLocal: TimeSchema.nullable(),
  lastOutLocal: TimeSchema.nullable(),
  spanHours: z.number().nullable(),
  netHours: z.number(),
  visits: z.number().int(),
  flags: z.array(AttendanceFlagSchema),
  amended: z.boolean(),
});
export type AttendanceRow = z.infer<typeof AttendanceRowSchema>;

export const AttendanceQuerySchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  department: z.string().trim().max(160).optional(),
  category: EmployeeCategorySchema.optional(),
  status: AttendanceStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const AttendanceTotalsSchema = z.object({
  present: z.number().int(),
  onSite: z.number().int(),
  missingIn: z.number().int(),
  absent: z.number().int(),
  averageSpanHours: z.number().nullable(),
});

export const AttendanceResponseSchema = z.object({
  items: z.array(AttendanceRowSchema),
  totals: AttendanceTotalsSchema,
  meta: PaginationMetaSchema,
});

export const MonthAttendanceResponseSchema = z.object({
  employee: z.object({
    id: UuidSchema,
    code: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    department: z.string(),
    category: EmployeeCategorySchema,
  }),
  month: LocalMonthSchema,
  days: z.array(AttendanceRowSchema),
  events: z.array(AttendanceEventSchema),
});

export const EventExportQuerySchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  employeeId: UuidSchema.optional(),
});

export const KioskSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(160),
});

export const KioskVehicleSchema = z.object({
  id: UuidSchema,
  plate: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  colour: z.string().nullable(),
  vehicleType: z.string(),
  activeParking: z
    .object({
      sessionId: UuidSchema,
      bayId: UuidSchema,
      bayCode: z.string(),
      areaName: z.string(),
      startedAt: z.string(),
    })
    .nullable(),
});

export const KioskEmployeeResultSchema = z.object({
  kind: z.literal('employee'),
  id: UuidSchema,
  code: z.string(),
  fullName: z.string(),
  department: z.string(),
  category: EmployeeCategorySchema,
  active: z.boolean(),
  currentState: z.object({
    onCampus: z.boolean(),
    since: z.string().nullable(),
    lastDirection: DirectionSchema.nullable(),
    lastOccurredAt: z.string().nullable(),
  }),
  vehicles: z.array(KioskVehicleSchema),
});

export const KioskStudentResultSchema = z.object({
  kind: z.literal('student'),
  id: UuidSchema,
  studentId: z.string(),
  fullName: z.string(),
  programme: z.string().nullable(),
  active: z.boolean(),
  vehicles: z.array(KioskVehicleSchema),
});

export const KioskGuestResultSchema = z.object({
  kind: z.literal('guest'),
  id: UuidSchema,
  fullName: z.string(),
  company: z.string().nullable(),
  active: z.boolean(),
  vehicles: z.array(KioskVehicleSchema),
});

export const KioskSearchResponseSchema = z.object({
  employees: z.array(KioskEmployeeResultSchema),
  students: z.array(KioskStudentResultSchema),
  guests: z.array(KioskGuestResultSchema),
});

export const KioskActivityItemSchema = z.object({
  id: UuidSchema,
  employeeId: UuidSchema,
  employeeName: z.string(),
  direction: DirectionSchema,
  occurredAt: z.string(),
  source: EventSourceSchema,
  recordedByName: z.string().nullable(),
  canUndo: z.boolean(),
  undoUntil: z.string().nullable(),
});

export const KioskActivityResponseSchema = z.object({
  items: z.array(KioskActivityItemSchema),
  onCampusCount: z.number().int(),
  today: LocalDateSchema,
});

export const EmployeeRecentEventsResponseSchema = z.object({
  employee: z.object({
    id: UuidSchema,
    fullName: z.string(),
    code: z.string(),
  }),
  items: z.array(AttendanceEventSchema),
});

export const HrAmendEventBodySchema = z.object({
  direction: DirectionSchema,
  occurredAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(1000),
  note: z.string().trim().max(500).optional().nullable(),
});

export const HrVoidEventBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

export const EventMutationResponseSchema = z.object({
  event: AttendanceEventSchema,
  supersededEventId: UuidSchema.nullable(),
  success: SuccessSchema,
});
