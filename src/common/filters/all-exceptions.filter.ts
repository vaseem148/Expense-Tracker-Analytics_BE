import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

interface ErrorBody {
  success: false;
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  method: string;
  traceId: string;
  timestamp: string;
}

/**
 * One error shape for the whole API. Prisma's low-level codes are translated
 * into HTTP semantics here so no controller has to care about the ORM.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = (req.headers['x-request-id'] as string) || randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      code = HttpStatus[status] ?? 'HTTP_ERROR';
      if (typeof payload === 'string') {
        message = payload;
      } else if (payload && typeof payload === 'object') {
        const p = payload as { message?: string | string[]; error?: string };
        message = Array.isArray(p.message) ? p.message[0] : (p.message ?? p.error ?? message);
        if (Array.isArray(p.message)) details = p.message;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          code = 'DUPLICATE';
          message = `A record with this ${(exception.meta?.target as string[])?.join(', ') ?? 'value'} already exists`;
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          code = 'NOT_FOUND';
          message = 'The requested record does not exist';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          code = 'FK_CONSTRAINT';
          message = 'Referenced record does not exist';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          code = `PRISMA_${exception.code}`;
          message = 'Database request failed';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'INVALID_QUERY';
      message = 'Invalid database query';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const body: ErrorBody = {
      success: false,
      statusCode: status,
      code,
      message,
      details,
      path: req.originalUrl,
      method: req.method,
      traceId,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status} ${message} [${traceId}]`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${req.method} ${req.originalUrl} -> ${status} ${message}`);
    }

    res.status(status).json(body);
  }
}
