import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CreateEmployeeBodySchema,
  EmployeeListQuerySchema,
  EmployeeListResponseSchema,
  EmployeeSchema,
  ImportBatchSummarySchema,
  ImportQuerySchema,
  UpdateEmployeeBodySchema,
  IdParamSchema,
  SuccessSchema,
} from '@alche/shared';
import { prisma } from '../db.js';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import { audit } from '../audit.js';
import { pageArgs, pageMeta } from '../pagination.js';
import { serializeEmployee } from '../serializers/people.js';
import { importEmployees } from '../imports.js';

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/employees',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        querystring: EmployeeListQuerySchema,
        response: { 200: EmployeeListResponseSchema },
      },
    },
    async (request) => {
      const { q, department, includeInactive, page } = request.query;
      const where = {
        ...(includeInactive ? {} : { active: true }),
        ...(department ? { department } : {}),
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' as const } },
                { lastName: { contains: q, mode: 'insensitive' as const } },
                { code: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
                { department: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const [items, total, departments] = await Promise.all([
        prisma.employee.findMany({
          where,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          ...pageArgs(page),
        }),
        prisma.employee.count({ where }),
        prisma.employee.findMany({
          distinct: ['department'],
          select: { department: true },
          orderBy: { department: 'asc' },
        }),
      ]);

      return {
        items: items.map(serializeEmployee),
        meta: pageMeta(page, total),
        departments: departments.map((row) => row.department),
      };
    },
  );

  typed.post(
    '/employees',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: { body: CreateEmployeeBodySchema, response: { 201: EmployeeSchema } },
    },
    async (request, reply) => {
      const body = request.body;
      const code = body.code.trim();
      const existing = await prisma.employee.findUnique({ where: { code } });
      if (existing) throw conflict('EMPLOYEE_CODE_TAKEN', `Employee code ${code} is already in use.`);

      try {
        const employee = await prisma.employee.create({
          data: {
            code,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email ?? null,
            phone: body.phone ?? null,
            department: body.department,
            jobTitle: body.jobTitle ?? null,
            category: body.category,
            active: body.active,
          },
        });
        await audit(request, {
          action: 'employee.create',
          entityType: 'employee',
          entityId: employee.id,
          after: serializeEmployee(employee),
        });
        reply.status(201);
        return serializeEmployee(employee);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'P2002') {
          throw conflict('EMPLOYEE_DUPLICATE', 'That employee code or email is already in use.');
        }
        throw error;
      }
    },
  );

  typed.patch(
    '/employees/:id',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: IdParamSchema,
        body: UpdateEmployeeBodySchema,
        response: { 200: EmployeeSchema },
      },
    },
    async (request) => {
      const current = await prisma.employee.findUnique({ where: { id: request.params.id } });
      if (!current) throw notFound('Employee not found.');
      if (request.body.code) {
        const code = request.body.code.trim();
        const collision = await prisma.employee.findFirst({
          where: { code, id: { not: current.id } },
        });
        if (collision) throw conflict('EMPLOYEE_CODE_TAKEN', `Employee code ${code} is already in use.`);
      }

      try {
        const updated = await prisma.employee.update({
          where: { id: current.id },
          data: {
            ...(request.body.code === undefined ? {} : { code: request.body.code.trim() }),
            ...(request.body.firstName === undefined ? {} : { firstName: request.body.firstName }),
            ...(request.body.lastName === undefined ? {} : { lastName: request.body.lastName }),
            ...(request.body.email === undefined ? {} : { email: request.body.email }),
            ...(request.body.phone === undefined ? {} : { phone: request.body.phone }),
            ...(request.body.department === undefined ? {} : { department: request.body.department }),
            ...(request.body.jobTitle === undefined ? {} : { jobTitle: request.body.jobTitle }),
            ...(request.body.category === undefined ? {} : { category: request.body.category }),
            ...(request.body.active === undefined ? {} : { active: request.body.active }),
          },
        });
        await audit(request, {
          action: updated.active === current.active ? 'employee.update' : updated.active ? 'employee.activate' : 'employee.deactivate',
          entityType: 'employee',
          entityId: updated.id,
          before: serializeEmployee(current),
          after: serializeEmployee(updated),
        });
        return serializeEmployee(updated);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'P2002') {
          throw conflict('EMPLOYEE_DUPLICATE', 'That employee code or email is already in use.');
        }
        throw error;
      }
    },
  );

  typed.post(
    '/employees/import',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        querystring: ImportQuerySchema,
        response: { 200: ImportBatchSummarySchema },
      },
    },
    async (request) => {
      const upload = await request.file();
      if (!upload) throw unprocessable('Choose a CSV file to import.');
      const buffer = await upload.toBuffer();
      return importEmployees(
        request,
        buffer,
        upload.filename,
        request.query.dryRun,
        request.query.skipInvalid,
      );
    },
  );

}
