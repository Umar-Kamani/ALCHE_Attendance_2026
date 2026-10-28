import { z } from 'zod';

export const RoleSchema = z.enum(['SECURITY', 'HR', 'DEAN']);
export type Role = z.infer<typeof RoleSchema>;

export const DirectionSchema = z.enum(['IN', 'OUT']);
export type Direction = z.infer<typeof DirectionSchema>;

export const EventSourceSchema = z.enum(['gate', 'amendment', 'hr_edit']);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const EmployeeCategorySchema = z.enum(['staff', 'contractor']);
export type EmployeeCategory = z.infer<typeof EmployeeCategorySchema>;

export const VehicleTypeSchema = z.enum(['car', 'motorbike', 'van', 'other']);
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const AttendanceStatusSchema = z.enum(['PRESENT', 'ON_SITE', 'MISSING_IN', 'ABSENT']);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const AttendanceFlagSchema = z.enum([
  'OVERNIGHT',
  'NO_EXIT',
  'AMENDED',
  'DUPLICATE_SUSPECT',
]);
export type AttendanceFlag = z.infer<typeof AttendanceFlagSchema>;

export const TicketStatusSchema = z.enum(['open', 'approved', 'applied', 'rejected', 'withdrawn']);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;
