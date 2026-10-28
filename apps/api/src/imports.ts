import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { AppError, unprocessable } from './errors.js';
import { audit } from './audit.js';
import type { FastifyRequest } from 'fastify';

type ImportKind = 'employees';
type ImportAction = 'create' | 'update' | 'invalid' | 'skip';

interface RawRow {
  row: number;
  values: Record<string, string>;
}

interface ParsedRow {
  row: number;
  code: string;
  name: string;
  action: ImportAction;
  reason?: string;
  values?: Record<string, string>;
}

interface ImportResult {
  id: string;
  kind: ImportKind;
  filename: string;
  dryRun: boolean;
  skipInvalid: boolean;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  errors: Array<{ row: number; code?: string; message: string }>;
  preview: Array<{ row: number; code: string; name: string; action: ImportAction; reason?: string }>;
  createdAt: string;
}

const EMAIL_SCHEMA = z.string().trim().email();

function normalizeCode(value: string): string {
  return value.trim().toLowerCase();
}

function booleanValue(value: string | undefined, fallback = true): boolean | null {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'active'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'inactive'].includes(normalized)) return false;
  return null;
}

async function readRecords(
  buffer: Buffer,
  required: string[],
  optional: string[],
): Promise<Array<RawRow & { headers: string[] }>> {
  const headerParser = parse({
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    to: 1,
    record_delimiter: ['\r\n', '\n', '\r'],
  });
  let headerRow: string[] = [];
  try {
    for await (const record of Readable.from(buffer).pipe(headerParser)) {
      headerRow = record as string[];
      break;
    }
  } catch (error) {
    throw unprocessable('The CSV file could not be read. Check quoting and line endings.', {
      _file: [error instanceof Error ? error.message : 'Invalid CSV'],
    });
  }

  const headers = headerRow.map((header) => header.trim());
  const allowed = new Set([...required, ...optional]);
  const unknown = headers.filter((header) => !allowed.has(header));
  if (unknown.length > 0) {
    throw unprocessable(`Unknown column${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`, {
      _file: [`Unknown columns: ${unknown.join(', ')}. Allowed columns: ${[...allowed].join(', ')}`],
    });
  }
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw unprocessable(`Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`, {
      _file: [`Missing required columns: ${missing.join(', ')}`],
    });
  }

  const parser = parse({
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    record_delimiter: ['\r\n', '\n', '\r'],
  });

  const records: Record<string, string>[] = [];
  try {
    for await (const record of Readable.from(buffer).pipe(parser)) {
      records.push(record as Record<string, string>);
    }
  } catch (error) {
    throw unprocessable('The CSV file could not be read. Check quoting and line endings.', {
      _file: [error instanceof Error ? error.message : 'Invalid CSV'],
    });
  }

  if (records.length === 0) {
    throw unprocessable('The CSV file has a header but no rows.');
  }

  return records.map((values, index) => ({ row: index + 2, values, headers }));
}

async function createBatch(
  request: FastifyRequest,
  kind: ImportKind,
  filename: string,
  dryRun: boolean,
  skipInvalid: boolean,
  result: Omit<ImportResult, 'id' | 'createdAt'>,
): Promise<{ id: string; createdAt: Date }> {
  const batch = await prisma.importBatch.create({
    data: {
      kind,
      filename,
      dryRun,
      skipInvalid,
      actorUserId: request.authUser!.id,
      totalRows: result.totalRows,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      invalid: result.invalid,
      errors: result.errors as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });
  await audit(request, {
    action: dryRun ? `import.${kind}.preview` : `import.${kind}`,
    entityType: 'import_batch',
    entityId: batch.id,
    after: {
      filename,
      totalRows: result.totalRows,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      invalid: result.invalid,
      dryRun,
      skipInvalid,
    },
  });
  return batch;
}

function commitOrPreview(
  parsed: ParsedRow[],
  previewOnly: boolean,
  plan: Map<string, 'create' | 'update'>,
): Pick<ImportResult, 'created' | 'updated' | 'skipped' | 'invalid'> {
  const valid = parsed.filter((row) => row.action !== 'invalid');
  const invalid = parsed.filter((row) => row.action === 'invalid');
  const created = valid.filter((row) => plan.get(normalizeCode(row.code)) === 'create').length;
  const updated = valid.filter((row) => plan.get(normalizeCode(row.code)) === 'update').length;
  return { created, updated, skipped: previewOnly ? invalid.length : invalid.length, invalid: invalid.length };
}

export async function importEmployees(
  request: FastifyRequest,
  buffer: Buffer,
  filename: string,
  dryRun: boolean,
  skipInvalid: boolean,
): Promise<ImportResult> {
  const records = await readRecords(
    buffer,
    ['employee_code', 'first_name', 'last_name', 'department'],
    ['email', 'phone', 'job_title', 'category', 'active'],
  );

  const codeSeen = new Map<string, number[]>();
  const emailSeen = new Map<string, number[]>();
  const parsed: ParsedRow[] = [];

  for (const { row, values } of records) {
    const code = (values.employee_code ?? '').trim();
    const firstName = (values.first_name ?? '').trim();
    const lastName = (values.last_name ?? '').trim();
    const department = (values.department ?? '').trim();
    const email = (values.email ?? '').trim();
    const category = (values.category ?? 'staff').trim().toLowerCase() || 'staff';
    const active = booleanValue(values.active);
    const errors: string[] = [];

    if (!/^[A-Za-z0-9]{2,32}$/.test(code)) {
      errors.push('employee_code must be 2–32 letters or numbers');
    }
    if (!firstName) errors.push('first_name is required');
    if (!lastName) errors.push('last_name is required');
    if (!department) errors.push('department is required');
    if (email) {
      const result = EMAIL_SCHEMA.safeParse(email);
      if (!result.success) errors.push('email is not a valid address');
    }
    if (!['staff', 'contractor'].includes(category)) {
      errors.push('category must be staff or contractor');
    }
    if (active === null) errors.push('active must be true or false');

    if (code) {
      codeSeen.set(normalizeCode(code), [...(codeSeen.get(normalizeCode(code)) ?? []), row]);
    }
    if (email) {
      emailSeen.set(email.toLowerCase(), [...(emailSeen.get(email.toLowerCase()) ?? []), row]);
    }

    parsed.push({
      row,
      code,
      name: `${firstName} ${lastName}`.trim(),
      action: errors.length ? 'invalid' : 'create',
      ...(errors.length ? { reason: errors.join('; ') } : {}),
      values: {
        employee_code: code,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: (values.phone ?? '').trim(),
        department,
        job_title: (values.job_title ?? '').trim(),
        category,
        active: String(active ?? true),
      },
    });
  }

  for (const rows of codeSeen.values()) {
    if (rows.length < 2) continue;
    for (const rowNumber of rows) {
      const row = parsed.find((item) => item.row === rowNumber);
      if (row) {
        row.action = 'invalid';
        row.reason = `Duplicate employee_code in this file (also on row${rows.length > 2 ? 's' : ''} ${rows
          .filter((n) => n !== rowNumber)
          .join(', ')})`;
      }
    }
  }
  for (const rows of emailSeen.values()) {
    if (rows.length < 2) continue;
    for (const rowNumber of rows) {
      const row = parsed.find((item) => item.row === rowNumber);
      if (row) {
        row.action = 'invalid';
        row.reason = `Duplicate email in this file (also on row ${rows.filter((n) => n !== rowNumber).join(', ')})`;
      }
    }
  }

  const codes = [...codeSeen.keys()];
  const existing = await prisma.employee.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, email: true },
  });
  const existingByCode = new Map(existing.map((employee) => [normalizeCode(employee.code), employee]));
  const existingEmails = await prisma.employee.findMany({
    where: { email: { not: null } },
    select: { id: true, code: true, email: true },
  });
  const emailOwner = new Map(
    existingEmails
      .filter((employee) => employee.email)
      .map((employee) => [employee.email!.toLowerCase(), employee]),
  );

  const plan = new Map<string, 'create' | 'update'>();
  for (const row of parsed) {
    if (row.action === 'invalid' || !row.values) continue;
    const normalized = normalizeCode(row.code);
    const existingRow = existingByCode.get(normalized);
    plan.set(normalized, existingRow ? 'update' : 'create');
    const email = (row.values.email ?? '').trim();
    if (email) {
      const owner = emailOwner.get(email.toLowerCase());
      if (owner && owner.id !== existingRow?.id) {
        row.action = 'invalid';
        row.reason = `Email already belongs to employee ${owner.code}`;
      }
    }
  }

  const counts = commitOrPreview(parsed, dryRun, plan);
  const invalid = parsed.filter((row) => row.action === 'invalid');
  const errors = invalid.map((row) => ({
    row: row.row,
    ...(row.code ? { code: row.code } : {}),
    message: row.reason ?? 'Invalid row',
  }));
  const preview = parsed.map((row) => ({
    row: row.row,
    code: row.code,
    name: row.name,
    action: row.action,
    ...(row.reason ? { reason: row.reason } : {}),
  }));

  if (!dryRun && !skipInvalid && invalid.length > 0) {
    const batch = await createBatch(request, 'employees', filename, true, false, {
      kind: 'employees',
      filename,
      dryRun: true,
      skipInvalid: false,
      totalRows: parsed.length,
      ...counts,
      errors,
      preview,
    });
    throw new AppError(
      422,
      'IMPORT_INVALID',
      `${invalid.length} row${invalid.length === 1 ? '' : 's'} need correction. Nothing was imported.`,
      {
        batchId: batch.id,
        invalid: errors,
        preview,
        created: 0,
        updated: 0,
        skipped: 0,
      },
    );
  }

  const batch = await createBatch(request, 'employees', filename, dryRun, skipInvalid, {
    kind: 'employees',
    filename,
    dryRun,
    skipInvalid,
    totalRows: parsed.length,
    ...counts,
    errors,
    preview,
  });

  if (!dryRun) {
    const rowsToWrite = parsed.filter((row) => row.action !== 'invalid');
    await prisma.$transaction(async (tx) => {
      for (const row of rowsToWrite) {
        const values = row.values!;
        const normalized = normalizeCode(row.code);
        const existingRow = existingByCode.get(normalized);
        const data = {
          code: values.employee_code!,
          firstName: values.first_name!,
          lastName: values.last_name!,
          email: values.email || null,
          phone: values.phone || null,
          department: values.department!,
          jobTitle: values.job_title || null,
          category: values.category!,
          active: values.active === 'true',
          importBatchId: batch.id,
        };
        if (existingRow) {
          await tx.employee.update({ where: { id: existingRow.id }, data });
        } else {
          await tx.employee.create({ data });
        }
      }
    });
  }

  return {
    id: batch.id,
    kind: 'employees',
    filename,
    dryRun,
    skipInvalid,
    totalRows: parsed.length,
    ...counts,
    errors,
    preview,
    createdAt: batch.createdAt.toISOString(),
  };
}
