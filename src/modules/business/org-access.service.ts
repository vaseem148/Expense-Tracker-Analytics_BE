import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { OrgRole } from './dto/org.dto';

const RANK: Record<OrgRole, number> = {
  EMPLOYEE: 1,
  MANAGER: 2,
  FINANCE: 3,
  ADMIN: 4,
  OWNER: 5,
};

/**
 * Central membership + role resolution. Every org-scoped service call goes
 * through here, so authorisation logic exists in exactly one place instead of
 * being re-implemented per controller.
 */
@Injectable()
export class OrgAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async membership(orgId: string, userId: string) {
    const member = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: { org: { select: { id: true, name: true, currency: true, slug: true } } },
    });
    if (!member || !member.isActive) {
      throw new NotFoundException('Organization not found or access revoked');
    }
    return member;
  }

  /** Throws unless the caller holds `min` or a higher role. */
  async require(orgId: string, userId: string, min: OrgRole) {
    const member = await this.membership(orgId, userId);
    if (RANK[member.role as OrgRole] < RANK[min]) {
      throw new ForbiddenException(`This action requires the ${min} role or above`);
    }
    return member;
  }

  /** True when the member may see org-wide data rather than just their own. */
  async canSeeAll(orgId: string, userId: string): Promise<boolean> {
    const member = await this.membership(orgId, userId);
    return RANK[member.role as OrgRole] >= RANK.FINANCE;
  }

  async myOrgs(userId: string) {
    const members = await this.prisma.orgMember.findMany({
      where: { userId, isActive: true },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            slug: true,
            currency: true,
            logoColor: true,
            gstin: true,
            city: true,
            _count: { select: { members: true, transactions: true, vendors: true } },
          },
        },
        department: { select: { id: true, name: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({
      orgId: m.orgId,
      role: m.role,
      title: m.title,
      department: m.department,
      joinedAt: m.joinedAt,
      ...m.org,
      counts: m.org._count,
      _count: undefined,
    }));
  }
}
