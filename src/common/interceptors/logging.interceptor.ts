import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'node:crypto';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const traceId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('X-Request-Id', traceId);
    const started = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - started;
        const level = ms > 800 ? 'warn' : 'log';
        this.logger[level](`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
      }),
    );
  }
}
