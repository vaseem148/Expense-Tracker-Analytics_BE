import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { roundTo, toMajor } from 'src/common/utils/money';
import { CreateClaimDto, DecideClaimDto, ReimburseClaimDto, UpdateClaimDto } from './dto/claim.dto';
import { OrgAccessService } from './org-access.service';

type ClaimStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED';

/** Legal state transitions - anything not listed here is rejected. */
const TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'DRAFT'],
  APPROVED: ['REIMBURSED', 'REJECTED'],
  REJECTED: ['DRAFT'],
  REIMBURSED: [],
};

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrgAccessService,
    private readonly events: EventEmitter2,
  ) {}

  async list(orgId: string, userId: string, status?: string) {
    const canSeeAll = await this.access.canSeeAll(orgId, userId);
    const claims = await this.prisma.expenseClaim.findMany({
      where: {
        orgId,
        ...(canSeeAll ? {} : { userId }),
        ...(status ? { status } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatarColor: true } },
        decidedBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    const items = claims.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      status: c.status,
      total: toMajor(c.totalMinor),
      itemCount: c._count.items,
      claimant: c.user,
      decidedBy: c.decidedBy,
      decisionNote: c.decisionNote,
      policyFlags: c.policyFlags ? (JSON.parse(c.policyFlags) as string[]) : [],
      submittedAt: c.submittedAt,
      decidedAt: c.decidedAt,
      reimbursedAt: c.reimbursedAt,
      paymentRef: c.paymentRef,
      createdAt: c.createdAt,
      // Time an approver has been sitting on it, in hours.
      ageingHours: c.submittedAt && !c.decidedAt
        ? Math.round((Date.now() - c.submittedAt.getTime()) / 3600_000)
        : null,
    }));

    const pipeline = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED'].map((s) => ({
      status: s,
      count: items.filter((i) => i.status === s).length,
      total: roundTo(
        items.filter((i) => i.status === s).reduce((a, i) => a + i.total, 0),
        2,
      ),
    }));

    return { items, pipeline, canApprove: canSeeAll };
  }

  async findOne(orgId: string, userId: string, id: string) {
    const canSeeAll = await this.access.canSeeAll(orgId, userId);
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id, orgId, ...(canSeeAll ? {} : { userId }) },
      include: {
        user: { select: { id: true, name: true, email: true } },
        decidedBy: { select: { id: true, name: true } },
        items: {
          include: {
            category: { select: { name: true, color: true, icon: true } },
            vendor: { select: { name: true } },
          },
          orderBy: { date: 'desc' },
        },
      },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    return {
      ...claim,
      total: toMajor(claim.totalMinor),
      policyFlags: claim.policyFlags ? (JSON.parse(claim.policyFlags) as string[]) : [],
      items: claim.items.map((t) => ({
        id: t.id,
        date: t.date,
        description: t.description,
        amount: toMajor(t.amountMinor),
        category: t.category,
        vendor: t.vendor,
        receiptUrl: t.receiptUrl,
        hasReceipt: Boolean(t.receiptUrl),
      })),
    };
  }

  async create(orgId: string, userId: string, dto: CreateClaimDto) {
    await this.access.membership(orgId, userId);
    const claim = await this.prisma.expenseClaim.create({
      data: { orgId, userId, title: dto.title.trim(), description: dto.description ?? null },
    });
    if (dto.transactionIds?.length) await this.attach(orgId, userId, claim.id, dto.transactionIds);
    return this.findOne(orgId, userId, claim.id);
  }

  async update(orgId: string, userId: string, id: string, dto: UpdateClaimDto) {
    const claim = await this.owned(orgId, userId, id);
    if (claim.status !== 'DRAFT' && claim.status !== 'REJECTED') {
      throw new BadRequestException('Only draft or rejected claims can be edited');
    }
    await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });
    if (dto.transactionIds) await this.attach(orgId, userId, id, dto.transactionIds);
    return this.findOne(orgId, userId, id);
  }

  /** Links transactions to the claim and recomputes its total. */
  async attach(orgId: string, userId: string, claimId: string, transactionIds: string[]) {
    const claim = await this.owned(orgId, userId, claimId);
    if (claim.status !== 'DRAFT' && claim.status !== 'REJECTED') {
      throw new BadRequestException('Attach items while the claim is still a draft');
    }
    await this.prisma.transaction.updateMany({
      where: { claimId, userId },
      data: { claimId: null },
    });
    await this.prisma.transaction.updateMany({
      where: { id: { in: transactionIds }, userId, isDeleted: false },
      data: { claimId, orgId, scope: 'BUSINESS', isReimbursable: true },
    });
    return this.recalculate(claimId);
  }

  /**
   * Submits for approval after evaluating the org policies.
   * Violations do not block submission - they are attached as flags so the
   * approver sees exactly why the claim needs a closer look.
   */
  async submit(orgId: string, userId: string, id: string) {
    const claim = await this.owned(orgId, userId, id);
    this.assertTransition(claim.status as ClaimStatus, 'SUBMITTED');

    const items = await this.prisma.transaction.findMany({
      where: { claimId: id },
      select: { amountMinor: true, receiptUrl: true, date: true, description: true },
    });
    if (!items.length) throw new BadRequestException('Attach at least one expense before submitting');

    const policies = await this.prisma.approvalPolicy.findMany({
      where: { orgId, isActive: true },
    });
    const totalMinor = items.reduce((a, i) => a + i.amountMinor, 0);
    const flags: string[] = [];

    for (const p of policies) {
      if (totalMinor < p.minAmount) continue;
      if (p.maxAmount !== null && totalMinor > p.maxAmount) continue;
      const missingReceipts = items.filter((i) => i.amountMinor >= p.receiptAbove && !i.receiptUrl);
      if (missingReceipts.length) flags.push(`RECEIPT_MISSING:${missingReceipts.length}`);
      if (p.requiresTwo) flags.push('DUAL_APPROVAL_REQUIRED');
    }
    // Stale expenses are the most common reimbursement dispute, so flag them.
    const stale = items.filter((i) => Date.now() - i.date.getTime() > 90 * 864e5);
    if (stale.length) flags.push(`STALE_EXPENSE:${stale.length}`);

    const autoApprove = policies.some(
      (p) => p.autoApprove && totalMinor >= p.minAmount && (p.maxAmount === null || totalMinor <= p.maxAmount),
    );

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: autoApprove && !flags.length ? 'APPROVED' : 'SUBMITTED',
        totalMinor,
        submittedAt: new Date(),
        policyFlags: flags.length ? JSON.stringify(flags) : null,
        ...(autoApprove && !flags.length ? { decidedAt: new Date(), decisionNote: 'Auto-approved by policy' } : {}),
      },
    });

    this.events.emit('claim.submitted', { orgId, claimId: id, userId, total: toMajor(totalMinor) });
    return { ...updated, total: toMajor(updated.totalMinor), policyFlags: flags };
  }

  async approve(orgId: string, approverId: string, id: string, dto: DecideClaimDto) {
    await this.access.require(orgId, approverId, 'MANAGER');
    const claim = await this.prisma.expenseClaim.findFirst({ where: { id, orgId } });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.userId === approverId) {
      throw new BadRequestException('You cannot approve your own claim');
    }
    this.assertTransition(claim.status as ClaimStatus, 'APPROVED');

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedById: approverId,
        decisionNote: dto.note ?? null,
      },
    });
    this.events.emit('claim.approved', { orgId, claimId: id, userId: claim.userId });
    return { ...updated, total: toMajor(updated.totalMinor) };
  }

  async reject(orgId: string, approverId: string, id: string, dto: DecideClaimDto) {
    await this.access.require(orgId, approverId, 'MANAGER');
    const claim = await this.prisma.expenseClaim.findFirst({ where: { id, orgId } });
    if (!claim) throw new NotFoundException('Claim not found');
    this.assertTransition(claim.status as ClaimStatus, 'REJECTED');

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: 'REJECTED',
        decidedAt: new Date(),
        decidedById: approverId,
        decisionNote: dto.note ?? 'Rejected',
      },
    });
    this.events.emit('claim.rejected', { orgId, claimId: id, userId: claim.userId });
    return { ...updated, total: toMajor(updated.totalMinor) };
  }

  async reimburse(orgId: string, actorId: string, id: string, dto: ReimburseClaimDto) {
    await this.access.require(orgId, actorId, 'FINANCE');
    const claim = await this.prisma.expenseClaim.findFirst({ where: { id, orgId } });
    if (!claim) throw new NotFoundException('Claim not found');
    this.assertTransition(claim.status as ClaimStatus, 'REIMBURSED');

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: 'REIMBURSED',
        reimbursedAt: new Date(),
        paymentRef: dto.paymentRef ?? null,
      },
    });
    this.events.emit('claim.reimbursed', { orgId, claimId: id, userId: claim.userId });
    return { ...updated, total: toMajor(updated.totalMinor) };
  }

  async remove(orgId: string, userId: string, id: string) {
    const claim = await this.owned(orgId, userId, id);
    if (claim.status === 'REIMBURSED') {
      throw new BadRequestException('Reimbursed claims are part of the audit trail');
    }
    await this.prisma.transaction.updateMany({ where: { claimId: id }, data: { claimId: null } });
    await this.prisma.expenseClaim.delete({ where: { id } });
    return { id, deleted: true as const };
  }

  private async recalculate(claimId: string) {
    const agg = await this.prisma.transaction.aggregate({
      where: { claimId },
      _sum: { amountMinor: true },
    });
    return this.prisma.expenseClaim.update({
      where: { id: claimId },
      data: { totalMinor: agg._sum.amountMinor ?? 0 },
    });
  }

  private async owned(orgId: string, userId: string, id: string) {
    const claim = await this.prisma.expenseClaim.findFirst({ where: { id, orgId, userId } });
    if (!claim) throw new NotFoundException('Claim not found');
    return claim;
  }

  private assertTransition(from: ClaimStatus, to: ClaimStatus): void {
    if (!TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(`A ${from} claim cannot move to ${to}`);
    }
  }
}
