import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { toMajor, toMinor } from 'src/common/utils/money';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

export interface AccountView {
  id: string;
  name: string;
  type: string;
  currency: string;
  color: string;
  icon: string;
  openingBalance: number;
  balance: number;
  creditLimit: number | null;
  utilisation: number | null;
  transactionCount: number;
  isArchived: boolean;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Balance is derived, never stored: opening balance + income - expense
   * + transfers in - transfers out. Deriving it means an edited or deleted
   * transaction can never leave a stale balance behind.
   */
  async findAll(userId: string, includeArchived = false): Promise<AccountView[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ isArchived: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { transactions: true } } },
    });

    const [outflow, inflow, transfersIn] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['accountId'],
        where: { userId, isDeleted: false, type: { in: ['EXPENSE', 'TRANSFER'] } },
        _sum: { amountMinor: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['accountId'],
        where: { userId, isDeleted: false, type: 'INCOME' },
        _sum: { amountMinor: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['toAccountId'],
        where: { userId, isDeleted: false, type: 'TRANSFER', toAccountId: { not: null } },
        _sum: { amountMinor: true },
      }),
    ]);

    const out = new Map(outflow.map((r) => [r.accountId, r._sum.amountMinor ?? 0]));
    const inn = new Map(inflow.map((r) => [r.accountId, r._sum.amountMinor ?? 0]));
    const tin = new Map(transfersIn.map((r) => [r.toAccountId!, r._sum.amountMinor ?? 0]));

    return accounts.map((a) => {
      const balanceMinor =
        a.openingBalance + (inn.get(a.id) ?? 0) - (out.get(a.id) ?? 0) + (tin.get(a.id) ?? 0);
      const balance = toMajor(balanceMinor);
      const creditLimit = a.creditLimit === null ? null : toMajor(a.creditLimit);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        color: a.color,
        icon: a.icon,
        openingBalance: toMajor(a.openingBalance),
        balance,
        creditLimit,
        utilisation:
          creditLimit && creditLimit > 0
            ? Math.round((Math.max(0, -balance) / creditLimit) * 1000) / 10
            : null,
        transactionCount: a._count.transactions,
        isArchived: a.isArchived,
      };
    });
  }

  async findOne(userId: string, id: string): Promise<AccountView> {
    const all = await this.findAll(userId, true);
    const found = all.find((a) => a.id === id);
    if (!found) throw new NotFoundException('Account not found');
    return found;
  }

  async create(userId: string, dto: CreateAccountDto) {
    const account = await this.prisma.account.create({
      data: {
        userId,
        name: dto.name.trim(),
        type: dto.type ?? 'BANK',
        openingBalance: toMinor(dto.openingBalance ?? 0),
        currency: dto.currency ?? 'INR',
        color: dto.color ?? '#64748b',
        icon: dto.icon ?? 'wallet',
        creditLimit: dto.creditLimit === undefined ? null : toMinor(dto.creditLimit),
      },
    });
    this.cache.invalidate(`analytics:${userId}`);
    return account;
  }

  async update(userId: string, id: string, dto: UpdateAccountDto) {
    await this.assertOwned(userId, id);
    const account = await this.prisma.account.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
        ...(dto.openingBalance !== undefined ? { openingBalance: toMinor(dto.openingBalance) } : {}),
        ...(dto.creditLimit !== undefined ? { creditLimit: toMinor(dto.creditLimit) } : {}),
      },
    });
    this.cache.invalidate(`analytics:${userId}`);
    return account;
  }

  async remove(userId: string, id: string) {
    await this.assertOwned(userId, id);
    const count = await this.prisma.transaction.count({ where: { userId, accountId: id } });
    if (count > 0) {
      // Deleting would cascade away real history; archiving preserves it.
      throw new BadRequestException(
        `Account has ${count} transactions - archive it instead of deleting`,
      );
    }
    await this.prisma.account.delete({ where: { id } });
    this.cache.invalidate(`analytics:${userId}`);
    return { id, deleted: true as const };
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const found = await this.prisma.account.findFirst({ where: { id, userId }, select: { id: true } });
    if (!found) throw new NotFoundException('Account not found');
  }
}
