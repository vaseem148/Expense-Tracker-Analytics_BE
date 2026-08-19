import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type OrgRole = 'OWNER' | 'ADMIN' | 'FINANCE' | 'MANAGER' | 'EMPLOYEE';

const RANK: Record<OrgRole, number> = {
  EMPLOYEE: 1,
  MANAGER: 2,
  FINANCE: 3,
  ADMIN: 4,
  OWNER: 5,
};

export interface OrgContext {
  orgId: string;
  role: OrgRole;
  /** FINANCE and above see the whole company; everyone else sees their own spend. */
  canSeeAll: boolean;
  currency: string;
  name: string;
}

/**
 * Every request is company-scoped. When no orgId is supplied the caller's
 * primary membership is used, so the API never has to fall back to a
 * "personal" mode that no longer exists.
 */
@Injectable()
export class OrgContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, orgId?: string): Promise<OrgContext> {
    const member = orgId
      ? await this.prisma.orgMember.findUnique({
          where: { orgId_userId: { orgId, userId } },
          include: { org: { select: { id: true, name: true, currency: true } } },
        })
      : await this.prisma.orgMember.findFirst({
          where: { userId, isActive: true },
          include: { org: { select: { id: true, name: true, currency: true } } },
          orderBy: { joinedAt: 'asc' },
        });

    if (!member || !member.isActive) {
      throw new NotFoundException(
        orgId ? 'Organization not found or access revoked' : 'You do not belong to a company yet',
      );
    }

    const role = member.role as OrgRole;
    return {
      orgId: member.orgId,
      role,
      canSeeAll: RANK[role] >= RANK.FINANCE,
      currency: member.org.currency,
      name: member.org.name,
    };
  }

  async require(userId: string, orgId: string | undefined, min: OrgRole): Promise<OrgContext> {
    const ctx = await this.resolve(userId, orgId);
    if (RANK[ctx.role] < RANK[min]) {
      throw new ForbiddenException(`This action requires the ${min} role or above`);
    }
    return ctx;
  }
}
