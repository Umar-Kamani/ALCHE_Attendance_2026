import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';

const DOCS = resolve(process.cwd(), '../../docs');

async function sample(name: string): Promise<Buffer> {
  return readFile(resolve(DOCS, name));
}

async function hrClient(app: FastifyInstance): Promise<TestClient> {
  await createUser({ username: 'hr', password: 'StrongPassword123!', role: 'HR' });
  const client = new TestClient(app);
  await client.login('hr', 'StrongPassword123!');
  return client;
}

describe('P2 employee and CSV import', () => {
  let app: FastifyInstance;

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
  });

  it('previews then imports the sample employee file idempotently', async () => {
    const client = await hrClient(app);
    const file = await sample('sample_employees.csv');

    const preview = await client.inject<{
      created: number;
      updated: number;
      totalRows: number;
      dryRun: boolean;
    }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=true',
      multipart: { filename: 'sample_employees.csv', content: file },
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ created: 10, updated: 0, totalRows: 10, dryRun: true });
    expect(await prisma.employee.count()).toBe(0);

    const imported = await client.inject<{
      created: number;
      updated: number;
      invalid: number;
    }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=false',
      multipart: { filename: 'sample_employees.csv', content: file },
    });
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({ created: 10, updated: 0, invalid: 0 });
    expect(await prisma.employee.count()).toBe(10);

    const reimported = await client.inject<{ created: number; updated: number }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=false',
      multipart: { filename: 'sample_employees.csv', content: file },
    });
    expect(reimported.status).toBe(200);
    expect(reimported.body).toMatchObject({ created: 0, updated: 10 });
    expect(await prisma.employee.count()).toBe(10);
  });

  it('writes nothing when the bad sample is imported all-or-nothing', async () => {
    const client = await hrClient(app);
    const file = await sample('sample_employees_bad.csv');

    const preview = await client.inject<{ invalid: number; errors: unknown[] }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=true',
      multipart: { filename: 'sample_employees_bad.csv', content: file },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.invalid).toBeGreaterThanOrEqual(8);
    expect(preview.body.errors.length).toBe(preview.body.invalid);

    const imported = await client.inject<{ error: { code: string } }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=false',
      multipart: { filename: 'sample_employees_bad.csv', content: file },
    });
    expect(imported.status).toBe(422);
    expect(imported.body.error.code).toBe('IMPORT_INVALID');
    expect(await prisma.employee.count()).toBe(0);
  });

  it('imports only valid rows in skip-invalid mode', async () => {
    const client = await hrClient(app);
    const file = await sample('sample_employees_bad.csv');
    const result = await client.inject<{ created: number; invalid: number; skipped: number }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=false&skipInvalid=true',
      multipart: { filename: 'sample_employees_bad.csv', content: file },
    });
    expect(result.status).toBe(200);
    expect(result.body.created).toBe(0);
    expect(result.body.invalid).toBeGreaterThan(0);
    expect(result.body.skipped).toBe(result.body.invalid);
    expect(await prisma.employee.count()).toBe(0);
    const batch = await prisma.importBatch.findFirst();
    expect(batch?.skipInvalid).toBe(true);
  });

  it('tolerates BOM, CRLF and quoted commas, and matches codes case-insensitively', async () => {
    const client = await hrClient(app);
    await prisma.employee.create({
      data: {
        code: 'ALCHE100',
        firstName: 'Old',
        lastName: 'Name',
        department: 'Old Department',
        category: 'staff',
        active: true,
      },
    });

    const csv = Buffer.from(
      '\uFEFFemployee_code,first_name,last_name,email,phone,job_title,department,category,active\r\n' +
        'alche100,Anaïs,Duval,anais.duval@alche.ac.mu,+230 5000 0001,Researcher,"Research, Development",staff,true\r\n' +
        'ALCHE101,Étienne,Leclézio,etienne@alche.ac.mu,,Lecturer,Academic Affairs,staff,true\r\n\r\n',
    );

    const result = await client.inject<{ created: number; updated: number; invalid: number }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=false',
      multipart: { filename: 'excel.csv', content: csv },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ created: 1, updated: 1, invalid: 0 });

    const updated = await prisma.employee.findUniqueOrThrow({ where: { code: 'ALCHE100' } });
    expect(updated.firstName).toBe('Anaïs');
    expect(updated.department).toBe('Research, Development');
    const created = await prisma.employee.findUniqueOrThrow({ where: { code: 'ALCHE101' } });
    expect(created.lastName).toBe('Leclézio');
  });

  it('rejects missing and unknown headers with clear messages', async () => {
    const client = await hrClient(app);
    const missing = await client.inject<{ error: { message: string } }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=true',
      multipart: {
        filename: 'missing.csv',
        content: 'employee_code,first_name,last_name\nA1,Ada,Lovelace\n',
      },
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.message).toContain('department');

    const unknown = await client.inject<{ error: { message: string } }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=true',
      multipart: {
        filename: 'unknown.csv',
        content: 'employee_code,first_name,last_name,department,favourite_colour\nA1,Ada,Lovelace,Science,purple\n',
      },
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.message).toContain('favourite_colour');
  });

  it('rejects duplicate codes within one file', async () => {
    const client = await hrClient(app);
    const result = await client.inject<{
      invalid: number;
      errors: Array<{ row: number; message: string }>;
    }>({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=true',
      multipart: {
        filename: 'dupes.csv',
        content:
          'employee_code,first_name,last_name,department\nDUP1,One,Person,Admin\nDUP1,Two,Person,Admin\n',
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.invalid).toBe(2);
    expect(result.body.errors[0]?.message).toContain('Duplicate employee_code');
  });

  it('lists, edits and deactivates employees without deleting history', async () => {
    const client = await hrClient(app);
    const created = await client.inject<{ id: string; code: string }>({
      method: 'POST',
      url: '/api/v1/employees',
      body: {
        code: 'ALCHE200',
        firstName: 'Test',
        lastName: 'Person',
        department: 'Finance',
      },
    });
    expect(created.status).toBe(201);

    const patched = await client.inject<{ active: boolean; jobTitle: string }>({
      method: 'PATCH',
      url: `/api/v1/employees/${created.body.id}`,
      body: { active: false, jobTitle: 'Analyst' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ active: false, jobTitle: 'Analyst' });
    expect(await prisma.employee.count()).toBe(1);

    const list = await client.inject<{ items: unknown[] }>({
      url: '/api/v1/employees?includeInactive=true',
    });
    expect(list.body.items).toHaveLength(1);
  });

  it('no longer exposes the student directory', async () => {
    const client = await hrClient(app);
    const list = await client.inject({ url: '/api/v1/students' });
    expect(list.status).toBe(404);
    const importRoute = await client.inject({
      method: 'POST',
      url: '/api/v1/students/import?dryRun=true',
    });
    expect(importRoute.status).toBe(404);
  });

  it('audits imports and exposes idempotent batch counts', async () => {
    const client = await hrClient(app);
    const file = await sample('sample_employees.csv');
    await client.inject({
      method: 'POST',
      url: '/api/v1/employees/import?dryRun=false',
      multipart: { filename: 'sample_employees.csv', content: file },
    });
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'import_batch' },
    });
    expect(audit?.action).toBe('import.employees');
    const batch = await prisma.importBatch.findFirstOrThrow();
    expect(batch.created).toBe(10);
    expect(batch.filename).toBe('sample_employees.csv');
  });
});
