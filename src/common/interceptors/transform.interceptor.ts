import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, map } from 'rxjs';

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  timestamp: string;
}

const RAW_MARKER = '__raw__';
/** Wrap a handler result to bypass the envelope (file downloads, health probes). */
export const raw = <T>(data: T) => ({ [RAW_MARKER]: true, data });

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiEnvelope<T> | T> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((payload: unknown) => {
        if (payload && typeof payload === 'object' && RAW_MARKER in payload) {
          return (payload as unknown as { data: T }).data;
        }
        // Paginated services return { items, meta }; hoist meta beside data.
        if (payload && typeof payload === 'object' && 'items' in payload && 'meta' in payload) {
          const p = payload as { items: T; meta: Record<string, unknown> };
          return {
            success: true as const,
            data: p.items,
            meta: p.meta,
            timestamp: new Date().toISOString(),
          };
        }
        res.setHeader('X-Api-Envelope', 'v1');
        return { success: true as const, data: payload as T, timestamp: new Date().toISOString() };
      }),
    );
  }
}
