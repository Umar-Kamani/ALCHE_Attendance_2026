import { buildApp } from './app.js';
import { config } from './config.js';
import { bootstrapAdmin } from './bootstrap.js';
import { prisma } from './db.js';

async function start(): Promise<void> {
  const app = await buildApp();

  try {
    await bootstrapAdmin(app);
    await app.listen({ host: '0.0.0.0', port: config.PORT });
  } catch (error) {
    app.log.error(error, 'Failed to start server');
    process.exitCode = 1;
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void start();
