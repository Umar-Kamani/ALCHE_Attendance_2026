import { Prisma } from '@prisma/client';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 'BAD_REQUEST', message, details);
}

export function unauthorized(message = 'Your session has ended. Sign in again.'): AppError {
  return new AppError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = 'You do not have permission to do that.'): AppError {
  return new AppError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'That record could not be found.'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(409, code, message, details);
}

export function unprocessable(message: string, details?: unknown): AppError {
  return new AppError(422, 'UNPROCESSABLE', message, details);
}

function zodDetails(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    fields[key] ??= [];
    fields[key].push(issue.message);
  }
  return fields;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          details: zodDetails(error),
        },
      });
    }

    if ('validation' in error && Array.isArray(error.validation) && error.validation.length > 0) {
      const details: Record<string, string[]> = {};
      for (const issue of error.validation) {
        const path = String((issue as { instancePath?: string }).instancePath ?? '').replace(/^\//, '');
        const key = path || '_root';
        details[key] ??= [];
        details[key].push((issue as { message?: string }).message ?? 'Invalid value');
      }
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          details,
        },
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply.status(409).send({
          error: {
            code: 'DUPLICATE',
            message: 'That record already exists.',
            details: error.meta,
          },
        });
      }
      if (error.code === 'P2003') {
        return reply.status(409).send({
          error: {
            code: 'IN_USE',
            message: 'That record is still in use and cannot be removed.',
          },
        });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'That record could not be found.' },
        });
      }
    }

    const statusCode =
      'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: 'code' in error && error.code ? error.code : 'REQUEST_ERROR',
          message: error.message,
        },
      });
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on the server. Please try again.',
      },
    });
  });

}
