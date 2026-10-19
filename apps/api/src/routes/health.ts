import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { nowUtc } from '../time.js';

const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.boolean(),
  version: z.string(),
  time: z.string(),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get('/healthz', { schema: { response: { 200: HealthSchema } } }, async () => {
    let db = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = false;
    }
    return {
      status: db ? ('ok' as const) : ('degraded' as const),
      db,
      version: config.BUILD_VERSION,
      time: nowUtc().toISO() ?? '',
    };
  });
}
