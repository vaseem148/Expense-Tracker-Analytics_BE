import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { CacheService } from 'src/common/cache/cache.service';
import { OrgContextService } from 'src/common/org/org-context.service';
import { Paginated, paginate } from 'src/common/dto/pagination.dto';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { normaliseMerchant, transactionHash } from 'src/common/utils/merchant';
import { toMajor, toMinor } from 'src/common/utils/money';
import {
  BulkCategorizeDto,
  BulkDeleteDto,
  CreateTransactionDto,
  UpdateTransactionDto,
} from './dto/transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';

export interface TransactionView {
  id: string;
  type: string;
  amount: number;
  currency: string;
  description: string;
  merchant: string | null;
  merchantKey: string | null;
  notes: string | null;
  date: Date;
  paymentMethod: string;
  isRecurring: boolean;
  scope: string;
  taxAmount: number;
  taxRateBps: number;
  isBillable: boolean;
  isReimbursable: boolean;
  account: { id: string; name: string; color: string } | null;
  toAccount: { id: string; name: string } | null;
  category: { id: string; name: string; color: string; icon: string } | null;
  vendor: { id: string; name: string } | null;
  department: { id: string; name: string; color: string } | null;
  project: { id: string; name: string } | null;
  claimId: string | null;
  tags: { id: string; name: string; color: string }[];
  isDeleted: boolean;
  createdAt: Date;
}

const INCLUDE = {
  account: { select: { id: true, name: true, color: true } },
  toAccount: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, color: true, icon: true } },
  vendor: { select: { id: true, name: true } },
  department: { select: { id: true, name: true, color: true } },
  project: { select: { id: true, name: true } },
  tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.TransactionInclude;

type TxWithRelations = Prisma.TransactionGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
    private readonly orgs: OrgContextService,
  ) {}

  /** Maps a DB row (minor units) to the API shape (major units). */
  static toView(t: TxWithRelations): TransactionView {
    return {
      id: t.id,
      type: t.type,
      amount: toMajor(t.amountMinor),
      currency: t.currency,
      description: t.description,
      merchant: t.merchant,
      merchantKey: t.merchantKey,
      notes: t.notes,
      date: t.date,
      paymentMethod: t.paymentMethod,
      isRecurring: t.isRecurring,
      scope: t.scope,
      taxAmount: toMajor(t.taxAmountMinor),
      taxRateBps: t.taxRateBps,
      isBillable: t.isBillable,
      isReimbursable: t.isReimbursable,
      account: t.account,
      toAccount: t.toAccount,
      category: t.category,
      vendor: t.vendor,
      department: t.department,
      project: t.project,
      claimId: t.claimId,
      tags: t.tags.map((tt) => tt.tag),
      isDeleted: t.isDeleted,
      createdAt: t.createdAt,
    };
  }

  private buildWhere(
    ctx: { orgId: string; canSeeAll: boolean },
    userId: string,
    q: QueryTransactionDto,
  ): Prisma.TransactionWhereInput {
    // FINANCE and above see the whole company ledger; everyone else sees the
    // spend they themselves recorded.
    const where: Prisma.TransactionWhereInput = {
      orgId: ctx.orgId,
      ...(ctx.canSeeAll ? {} : { userId }),
    };
    if (!q.includeDeleted) where.isDeleted = false;
    if (q.type) where.type = q.type;
    if (q.paymentMethod) where.paymentMethod = q.paymentMethod;
    if (q.merchantKey) where.merchantKey = q.merchantKey;
    if (q.departmentIds?.length) where.departmentId = { in: q.departmentIds };
    if (q.vendorIds?.length) where.vendorId = { in: q.vendorIds };
    if (q.projectIds?.length) where.projectId = { in: q.projectIds };
    if (q.isBillable !== undefined) where.isBillable = q.isBillable;
    if (q.isRecurring !== undefined) where.isRecurring = q.isRecurring;
    if (q.categoryIds?.length) where.categoryId = { in: q.categoryIds };
    if (q.accountIds?.length) where.accountId = { in: q.accountIds };
    if (q.tagIds?.length) where.tags = { some: { tagId: { in: q.tagIds } } };
    if (q.from || q.to) {
      where.date = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(`${q.to.slice(0, 10)}T23:59:59.999Z`) } : {}),
      };
    }
    if (q.minAmount !== undefined || q.maxAmount !== undefined) {
      where.amountMinor = {
        ...(q.minAmount !== undefined ? { gte: toMinor(q.minAmount) } : {}),
        ...(q.maxAmount !== undefined ? { lte: toMinor(q.maxAmount) } : {}),
      };
    }
    if (q.q) {
      const term = q.q.trim();
      where.OR = [
        { description: { contains: term } },
        { merchant: { contains: term } },
        { notes: { contains: term } },
      ];
    }
    return where;
  }

  async findAll(
    userId: string,
    q: QueryTransactionDto,
  ): Promise<Paginated<TransactionView> & { meta: { totals: Record<string, number> } }> {
    const ctx = await this.orgs.resolve(userId, q.orgId);
    const where = this.buildWhere(ctx, userId, q);
    const sortBy = ['date', 'amountMinor', 'createdAt', 'description'].includes(q.sortBy ?? '')
      ? (q.sortBy as string)
      : 'date';

    const [rows, total, sums] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ [sortBy]: q.sortDir }, { createdAt: 'desc' }],
        skip: q.skip,
        take: q.limit,
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.groupBy({ by: ['type'], where, _sum: { amountMinor: true } }),
    ]);

    const totals = { expense: 0, income: 0, transfer: 0, net: 0 };
    for (const s of sums) {
      const v = toMajor(s._sum.amountMinor ?? 0);
      if (s.type === 'EXPENSE') totals.expense = v;
      else if (s.type === 'INCOME') totals.income = v;
      else totals.transfer = v;
    }
    totals.net = Math.round((totals.income - totals.expense) * 100) / 100;

    const page = paginate(rows.map(TransactionsService.toView), total, q.page, q.limit);
    return { items: page.items, meta: { ...page.meta, totals } };
  }

  async findOne(userId: string, id: string): Promise<TransactionView> {
    const ctx = await this.orgs.resolve(userId);
    const tx = await this.prisma.transaction.findFirst({
      where: { id, orgId: ctx.orgId, ...(ctx.canSeeAll ? {} : { userId }) },
      include: INCLUDE,
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    return TransactionsService.toView(tx);
  }

  async create(userId: string, dto: CreateTransactionDto): Promise<TransactionView> {
    const ctx = await this.orgs.resolve(userId, dto.orgId);
    await this.assertAccount(userId, dto.accountId);
    if (dto.type === 'TRANSFER') {
      if (!dto.toAccountId) throw new BadRequestException('A transfer needs a destination account');
      if (dto.toAccountId === dto.accountId) {
        throw new BadRequestException('Source and destination accounts must differ');
      }
      await this.assertAccount(userId, dto.toAccountId);
    }
    if (dto.categoryId) await this.assertCategory(userId, dto.categoryId);

    const date = new Date(dto.date);
    const amountMinor = toMinor(dto.amount);
    const merchantKey = normaliseMerchant(dto.merchant ?? dto.description);

    const taxRateBps = Math.round((dto.taxRatePct ?? 0) * 100);
    // Tax is quoted inclusive on Indian invoices, so the component is backed
    // out of the gross rather than added on top.
    const taxAmountMinor = taxRateBps
      ? Math.round(amountMinor - amountMinor / (1 + taxRateBps / 10000))
      : 0;

    const created = await this.prisma.transaction.create({
      data: {
        userId,
        orgId: ctx.orgId,
        scope: 'BUSINESS',
        departmentId: dto.departmentId ?? null,
        vendorId: dto.vendorId ?? null,
        projectId: dto.projectId ?? null,
        taxRateBps,
        taxAmountMinor,
        isBillable: dto.isBillable ?? false,
        isReimbursable: dto.isReimbursable ?? false,
        invoiceNumber: dto.invoiceNumber ?? null,
        accountId: dto.accountId,
        toAccountId: dto.type === 'TRANSFER' ? dto.toAccountId : null,
        categoryId: dto.type === 'TRANSFER' ? null : (dto.categoryId ?? null),
        type: dto.type ?? 'EXPENSE',
        amountMinor,
        description: dto.description.trim(),
        merchant: dto.merchant?.trim() ?? null,
        merchantKey,
        notes: dto.notes ?? null,
        date,
        paymentMethod: dto.paymentMethod ?? 'UPI',
        receiptUrl: dto.receiptUrl ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        externalHash: transactionHash({
          accountId: dto.accountId,
          date,
          amountMinor,
          description: dto.description,
          type: dto.type ?? 'EXPENSE',
        }),
        tags: dto.tags?.length ? { create: await this.tagLinks(userId, dto.tags) } : undefined,
      },
      include: INCLUDE,
    });

    this.invalidate(userId);
    const view = TransactionsService.toView(created);
    this.events.emit('transaction.created', { userId, transaction: view });
    return view;
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto): Promise<TransactionView> {
    const ctx = await this.orgs.resolve(userId);
    const existing = await this.prisma.transaction.findFirst({
      where: { id, orgId: ctx.orgId, ...(ctx.canSeeAll ? {} : { userId }) },
    });
    if (!existing) throw new NotFoundException('Transaction not found');
    if (dto.accountId) await this.assertAccount(userId, dto.accountId);
    if (dto.categoryId) await this.assertCategory(userId, dto.categoryId);

    const merchantSource = dto.merchant ?? dto.description;
    const updated = await this.prisma.transaction.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined ? { amountMinor: toMinor(dto.amount) } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
        ...(dto.toAccountId !== undefined ? { toAccountId: dto.toAccountId || null } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
        ...(dto.receiptUrl !== undefined ? { receiptUrl: dto.receiptUrl } : {}),
        ...(merchantSource !== undefined
          ? { merchant: dto.merchant?.trim() ?? null, merchantKey: normaliseMerchant(merchantSource) }
          : {}),
        ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId || null } : {}),
        ...(dto.vendorId !== undefined ? { vendorId: dto.vendorId || null } : {}),
        ...(dto.projectId !== undefined ? { projectId: dto.projectId || null } : {}),
        ...(dto.isBillable !== undefined ? { isBillable: dto.isBillable } : {}),
        ...(dto.isReimbursable !== undefined ? { isReimbursable: dto.isReimbursable } : {}),
        ...(dto.invoiceNumber !== undefined ? { invoiceNumber: dto.invoiceNumber } : {}),
        ...(dto.taxRatePct !== undefined
          ? {
              taxRateBps: Math.round(dto.taxRatePct * 100),
              taxAmountMinor: Math.round(
                (dto.amount !== undefined ? toMinor(dto.amount) : existing.amountMinor) *
                  (1 - 1 / (1 + (dto.taxRatePct * 100) / 10000)),
              ),
            }
          : {}),
        ...(dto.tags
          ? { tags: { deleteMany: {}, create: await this.tagLinks(userId, dto.tags) } }
          : {}),
      },
      include: INCLUDE,
    });

    this.invalidate(userId);
    const view = TransactionsService.toView(updated);
    this.events.emit('transaction.updated', { userId, transaction: view });
    return view;
  }

  /** Soft delete keeps history recoverable and analytics reproducible. */
  async remove(userId: string, id: string) {
    const ctx = await this.orgs.resolve(userId);
    const existing = await this.prisma.transaction.findFirst({
      where: { id, orgId: ctx.orgId, ...(ctx.canSeeAll ? {} : { userId }) },
    });
    if (!existing) throw new NotFoundException('Transaction not found');
    await this.prisma.transaction.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    this.invalidate(userId);
    this.events.emit('transaction.deleted', { userId, id });
    return { id, deleted: true as const };
  }

  async restore(userId: string, id: string) {
    const ctx = await this.orgs.resolve(userId);
    const res = await this.prisma.transaction.updateMany({
      where: { id, orgId: ctx.orgId, isDeleted: true, ...(ctx.canSeeAll ? {} : { userId }) },
      data: { isDeleted: false, deletedAt: null },
    });
    if (!res.count) throw new NotFoundException('No deleted transaction with that id');
    this.invalidate(userId);
    return { id, restored: true as const };
  }

  async bulkDelete(userId: string, dto: BulkDeleteDto) {
    const ctx = await this.orgs.resolve(userId);
    const res = await this.prisma.transaction.updateMany({
      where: { id: { in: dto.ids }, orgId: ctx.orgId, ...(ctx.canSeeAll ? {} : { userId }) },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    this.invalidate(userId);
    return { deleted: res.count };
  }

  async bulkCategorize(userId: string, dto: BulkCategorizeDto) {
    const ctx = await this.orgs.resolve(userId);
    await this.assertCategory(userId, dto.categoryId);
    const res = await this.prisma.transaction.updateMany({
      where: { id: { in: dto.ids }, orgId: ctx.orgId, ...(ctx.canSeeAll ? {} : { userId }) },
      data: { categoryId: dto.categoryId },
    });
    this.invalidate(userId);
    return { updated: res.count };
  }

  /** Distinct merchants with spend totals - powers the merchant leaderboard. */
  async merchants(userId: string, limit = 25) {
    const ctx = await this.orgs.resolve(userId);
    const rows = await this.prisma.transaction.groupBy({
      by: ['merchantKey'],
      where: {
        orgId: ctx.orgId,
        ...(ctx.canSeeAll ? {} : { userId }),
        isDeleted: false,
        type: 'EXPENSE',
        merchantKey: { not: null },
      },
      _sum: { amountMinor: true },
      _count: { _all: true },
      _max: { date: true },
      orderBy: { _sum: { amountMinor: 'desc' } },
      take: limit,
    });
    return rows.map((r) => ({
      merchantKey: r.merchantKey,
      total: toMajor(r._sum.amountMinor ?? 0),
      count: r._count._all,
      lastSeen: r._max.date,
      average: toMajor(Math.round((r._sum.amountMinor ?? 0) / Math.max(1, r._count._all))),
    }));
  }

  async tags(userId: string) {
    const rows = await this.prisma.tag.findMany({
      where: { userId },
      include: { _count: { select: { txs: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.txs }));
  }

  /** Finds-or-creates tags by name and returns join rows for a nested write. */
  private async tagLinks(userId: string, names: string[]) {
    const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
    const links: { tagId: string }[] = [];
    for (const name of clean) {
      const tag = await this.prisma.tag.upsert({
        where: { userId_name: { userId, name } },
        create: { userId, name },
        update: {},
      });
      links.push({ tagId: tag.id });
    }
    return links;
  }

  private async assertAccount(userId: string, accountId: string): Promise<void> {
    const found = await this.prisma.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Account not found');
  }

  private async assertCategory(userId: string, categoryId: string): Promise<void> {
    const found = await this.prisma.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Category not found');
  }

  private invalidate(userId: string): void {
    this.cache.invalidate(`analytics:${userId}`);
    this.cache.invalidate(`tx:${userId}`);
  }
}
