import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/alche_test?schema=public';

function databaseName(): string {
  const url = new URL(TEST_URL);
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function adminUrl(): string {
  const url = new URL(TEST_URL);
  url.pathname = '/postgres';
  return url.toString();
}

function testUrl(): string {
  const url = new URL(TEST_URL);
  url.searchParams.set('schema', 'public');
  return url.toString();
}

export default async function globalSetup(): Promise<void> {
  const dbName = databaseName();
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Unsafe test database name: ${dbName}`);
  }

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
  try {
    const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      'SELECT datname FROM pg_database WHERE datname = $1',
      dbName,
    );
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  const testClient = new PrismaClient({ datasources: { db: { url: testUrl() } } });
  try {
    await testClient.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await testClient.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await testClient.$disconnect();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl() },
    stdio: 'inherit',
  });

  process.env.DATABASE_URL = testUrl();
  process.env.TEST_DATABASE_URL = testUrl();
}
