import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, AuditMeta } from '../decorators/audit.decorator';
import { AuthUser } from '../types/domain.types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Records @Audit()-marked mutations after they succeed. Writes are
 * fire-and-forget: an audit failure must never fail the user's request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    return next.handle().pipe(
      tap((result) => {
        const entityId =
          result && typeof result === 'object' && 'id' in result
            ? String((result as { id: unknown }).id)
            : undefined;

        void this.prisma.auditLog
          .create({
            data: {
              userId: req.user?.id ?? null,
              action: meta.action,
              entity: meta.entity,
              entityId,
              after: safeJson(result),
              ip: req.ip ?? null,
              userAgent: req.headers['user-agent'] ?? null,
            },
          })
          .catch(() => undefined);
      }),
    );
  }
}

function safeJson(value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    if (!json) return null;
    return json.length > 8000 ? `${json.slice(0, 8000)}...` : json;
  } catch {
    return null;
  }
}
