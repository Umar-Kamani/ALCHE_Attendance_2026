import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../src/auth.js';
import { prisma } from '../src/db.js';
import type { Role } from '@alche/shared';

const TABLES = [
  'AuditLog',
  'ImportBatch',
  'Ticket',
  'Event',
  'ParkingSession',
  'GuestVisit',
  'Vehicle',
  'ParkingBay',
  'ParkingArea',
  'Employee',
  'Guest',
  'Session',
  'User',
];

export async function resetDatabase(): Promise<void> {
  const tableList = TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE`);
}

export async function createUser(input: {
  username: string;
  password: string;
  role?: Role;
  displayName?: string;
  mustChangePassword?: boolean;
  active?: boolean;
}) {
  return prisma.user.create({
    data: {
      username: input.username,
      displayName: input.displayName ?? input.username,
      passwordHash: await hashPassword(input.password),
      role: input.role ?? 'HR',
      active: input.active ?? true,
      mustChangePassword: input.mustChangePassword ?? false,
    },
  });
}

interface CookieRecord {
  [name: string]: string;
}

interface InjectOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  multipart?: { filename: string; content: Buffer | string; fieldName?: string };
}

export class TestClient {
  readonly app: FastifyInstance;
  private cookies: CookieRecord = {};
  csrfToken = '';

  constructor(app: FastifyInstance) {
    this.app = app;
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  private captureCookies(headers: Record<string, unknown>): void {
    const setCookie = headers['set-cookie'];
    const values = Array.isArray(setCookie) ? setCookie : typeof setCookie === 'string' ? [setCookie] : [];
    for (const header of values) {
      const [pair] = header.split(';');
      if (!pair) continue;
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!value) {
        delete this.cookies[name];
      } else {
        this.cookies[name] = value;
      }
    }
  }

  async csrf(): Promise<string> {
    const response = await this.app.inject({
      method: 'GET',
      url: '/api/v1/auth/csrf',
      headers: {
        ...(this.cookieHeader() ? { cookie: this.cookieHeader() } : {}),
      },
    });
    this.captureCookies(response.headers);
    const body = response.json<{ csrfToken: string }>();
    this.csrfToken = body.csrfToken;
    return this.csrfToken;
  }

  async inject<T = unknown>(options: InjectOptions): Promise<{
    status: number;
    body: T;
    headers: Record<string, unknown>;
    raw: string;
  }> {
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {
      ...(options.headers ?? {}),
    };
    if (this.cookieHeader()) headers.cookie = this.cookieHeader();
    if (method !== 'GET' && method !== 'HEAD' && this.csrfToken && !headers['x-csrf-token']) {
      headers['x-csrf-token'] = this.csrfToken;
    }

    let payload: string | Buffer | undefined;
    if (options.multipart) {
      const boundary = `----alchetest${Date.now()}`;
      const filename = options.multipart.filename;
      const content =
        typeof options.multipart.content === 'string'
          ? Buffer.from(options.multipart.content)
          : options.multipart.content;
      payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${options.multipart.fieldName ?? 'file'}"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
      headers['content-length'] = String(payload.length);
      delete headers['x-csrf-token'];
      headers['x-csrf-token'] = this.csrfToken;
    } else if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }

    const response = await this.app.inject({
      method,
      url: options.url,
      headers,
      payload,
    });
    this.captureCookies(response.headers);
    let body: T;
    try {
      body = response.json<T>();
    } catch {
      body = response.body as unknown as T;
    }
    return {
      status: response.statusCode,
      body,
      headers: response.headers,
      raw: response.body,
    };
  }

  async login(username: string, password: string): Promise<void> {
    await this.csrf();
    const response = await this.inject<{ csrfToken: string }>({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { username, password },
    });
    if (response.status !== 200) {
      throw new Error(`Login failed (${response.status}): ${response.raw}`);
    }
    this.csrfToken = response.body.csrfToken;
  }
}
