import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { toMajor, toMinor } from 'src/common/utils/money';
import { UpdateProfileDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        currency: true,
        locale: true,
        timezone: true,
        monthlyIncome: true,
        avatarColor: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        _count: {
          select: { transactions: true, accounts: true, categories: true, budgets: true },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return { ...user, monthlyIncome: toMajor(user.monthlyIncome), counts: user._count, _count: undefined };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency.toUpperCase() } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.avatarColor !== undefined ? { avatarColor: dto.avatarColor } : {}),
        ...(dto.monthlyIncome !== undefined ? { monthlyIncome: toMinor(dto.monthlyIncome) } : {}),
      },
      select: { id: true, name: true, currency: true, locale: true, timezone: true, monthlyIncome: true, avatarColor: true },
    });
    this.cache.invalidate(`analytics:${userId}`);
    return { ...user, monthlyIncome: toMajor(user.monthlyIncome) };
  }

  /** Full account erasure - cascades remove every child row. */
  async deleteAccount(userId: string) {
    await this.prisma.user.delete({ where: { id: userId } });
    this.cache.invalidate(`analytics:${userId}`);
    this.cache.invalidate(`cat:${userId}`);
    return { deleted: true as const };
  }

  /** ADMIN-only directory listing. */
  async listAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { transactions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setActive(id: string, isActive: boolean) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    });
  }
}
