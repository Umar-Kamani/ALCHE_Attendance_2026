import { z } from 'zod';
import { RoleSchema } from './enums.js';
import { PaginationMetaSchema, UuidSchema } from './common.js';

export const AuditLogSchema = z.object({
  id: UuidSchema,
  actor: z
    .object({
      id: UuidSchema,
      username: z.string(),
      displayName: z.string(),
    })
    .nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AuditListQuerySchema = z.object({
  entity: z.string().trim().max(80).optional(),
  actor: UuidSchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const AuditListResponseSchema = z.object({
  items: z.array(AuditLogSchema),
  meta: PaginationMetaSchema,
});

export const UserAdminSchema = z.object({
  id: UuidSchema,
  username: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserAdmin = z.infer<typeof UserAdminSchema>;

export const UserAdminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export const UserAdminListResponseSchema = z.object({
  items: z.array(UserAdminSchema),
  meta: PaginationMetaSchema,
});

export type UserAdminListResponse = z.infer<typeof UserAdminListResponseSchema>;
export type OnCampusResponse = z.infer<typeof OnCampusResponseSchema>;

export const DashboardQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const DashboardStatsSchema = z.object({
  generatedAt: z.string(),
  today: z.string(),
  attendance: z.object({
    present: z.number().int(),
    onSite: z.number().int(),
    missingIn: z.number().int(),
    absent: z.number().int(),
    onCampusNow: z.number().int(),
    averageSpanHours: z.number().nullable(),
  }),
  month: z.object({
    present: z.number().int(),
    onSite: z.number().int(),
    missingIn: z.number().int(),
    absent: z.number().int(),
    averageSpanHours: z.number().nullable(),
  }),
  guests: z.object({
    expectedToday: z.number().int(),
    onSiteNow: z.number().int(),
    overdueNow: z.number().int(),
    departedToday: z.number().int(),
  }),
  parking: z.object({
    total: z.number().int(),
    occupied: z.number().int(),
    free: z.number().int(),
    byType: z.record(z.string(), z.object({
      total: z.number().int(),
      occupied: z.number().int(),
      free: z.number().int(),
    })),
  }),
  trend: z.array(
    z.object({
      date: z.string(),
      present: z.number().int(),
      onSite: z.number().int(),
      missingIn: z.number().int(),
      absent: z.number().int(),
    }),
  ),
  range: z.object({ from: z.string(), to: z.string() }),
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

export const OnCampusResponseSchema = z.object({
  employees: z.array(
    z.object({
      id: UuidSchema,
      code: z.string(),
      fullName: z.string(),
      department: z.string(),
      since: z.string(),
      elapsedMinutes: z.number().int(),
      vehicles: z.array(z.string()),
    }),
  ),
  guests: z.array(
    z.object({
      visitId: UuidSchema,
      guestName: z.string(),
      company: z.string().nullable(),
      hostName: z.string(),
      hostDepartment: z.string(),
      since: z.string(),
      expectedTo: z.string(),
      badgeNo: z.string().nullable(),
      overdue: z.boolean(),
    }),
  ),
  parking: z.object({
    total: z.number().int(),
    occupied: z.number().int(),
    free: z.number().int(),
  }),
  generatedAt: z.string(),
});
