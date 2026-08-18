import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthUser } from '../types/domain.types';

/** Injects the authenticated user, or one of its fields: @CurrentUser('id'). */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
