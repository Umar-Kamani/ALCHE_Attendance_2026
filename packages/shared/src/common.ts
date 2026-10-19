import { z } from 'zod';

export const UuidSchema = z.uuid();
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const LocalMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const TimeSchema = z.string().regex(/^\d{2}:\d{2}:\d{2}$/);

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const FieldErrorsSchema = z.record(z.string(), z.array(z.string()));

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export const QueryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1')
  .default(false);

export const PaginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export const IdParamSchema = z.object({ id: UuidSchema });
export const EmployeeIdParamSchema = z.object({ employeeId: UuidSchema });

export const SuccessSchema = z.object({ success: z.literal(true) });
export const MessageSchema = z.object({ message: z.string() });

export const DateRangeSchema = z
  .object({
    from: LocalDateSchema,
    to: LocalDateSchema,
  })
  .refine((value) => value.from <= value.to, {
    message: 'The start date must be on or before the end date',
    path: ['to'],
  });

export function daysInclusive(from: string, to: string): number {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function assertExportRange(from: string, to: string): void {
  const span = daysInclusive(from, to);
  if (span > 366) {
    throw new Error(`Export range is ${span} days; the maximum is 366 days`);
  }
}
