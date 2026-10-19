import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import csrfProtection from '@fastify/csrf-protection';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { config } from './config.js';
import { registerErrorHandler } from './errors.js';
import { authPlugin } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { peopleRoutes } from './routes/people.js';

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    logger:
      options.logger === false
        ? false
        : {
            level: config.NODE_ENV === 'development' ? 'info' : 'warn',
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["x-csrf-token"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
          },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie, {
    secret: config.SECRET_KEY,
    parseOptions: { sameSite: 'lax', httpOnly: true, secure: config.isProduction, path: '/' },
  });

  await app.register(csrfProtection, {
    sessionPlugin: '@fastify/cookie',
    cookieKey: config.csrfCookieName,
    cookieOpts: {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: config.isProduction,
    },
    getToken: (request) => {
      const header = request.headers['x-csrf-token'];
      return Array.isArray(header) ? header[0] : header;
    },
  });

  await app.register(rateLimit, { global: false });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(multipart, {
    limits: { fileSize: config.uploadLimitBytes, files: 1 },
  });

  await app.register(authPlugin);

  app.addHook('onRequest', (request, reply, done) => {
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    const apiRequest = request.raw.url?.startsWith('/api/v1') ?? false;
    if (mutating && apiRequest) {
      app.csrfProtection(request, reply, done);
      return;
    }
    done();
  });

  registerErrorHandler(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(peopleRoutes, { prefix: '/api/v1' });

  const publicDir = resolve(config.publicDir);
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false,
      cacheControl: true,
      maxAge: '1y',
      immutable: true,
      index: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.raw.url?.startsWith('/api/') ?? false;
    const acceptsHtml =
      request.method === 'GET' &&
      Boolean(request.headers.accept?.includes('text/html')) &&
      !isApi;

    if (acceptsHtml && existsSync(resolve(publicDir, 'index.html'))) {
      reply.header('Cache-Control', 'no-store');
      return reply.sendFile('index.html');
    }

    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' },
    });
  });

  return app;
}
