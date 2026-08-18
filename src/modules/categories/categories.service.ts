import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CategoryKind } from 'src/common/types/domain.types';
import { toMajor, toMinor } from 'src/common/utils/money';
import { DEFAULT_CATEGORIES } from './default-categories';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Creates the starter taxonomy (parents + children) for a new user. */
  async seedDefaults(userId: string): Promise<number> {
    let created = 0;
    for (const [index, def] of DEFAULT_CATEGORIES.entries()) {
      const parent = await this.prisma.category.create({
        data: {
          userId,
          name: def.name,
          kind: def.kind,
          icon: def.icon,
          color: def.color,
          isSystem: true,
          sortOrder: index * 10,
        },
      });
      created++;
      for (const [ci, child] of (def.children ?? []).entries()) {
        await this.prisma.category.create({
          data: {
            userId,
            name: child,
            kind: def.kind,
            icon: def.icon,
            color: def.color,
            parentId: parent.id,
            isSystem: true,
            sortOrder: index * 10 + ci + 1,
          },
        });
        created++;
      }
    }
    this.cache.invalidate(`cat:${userId}`);
    return created;
  }

  async findAll(userId: string, kind?: CategoryKind) {
    return this.cache.wrap(`cat:${userId}:${kind ?? 'all'}`, 120_000, async () => {
      const rows = await this.prisma.category.findMany({
        where: { userId, ...(kind ? { kind } : {}) },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { transactions: true } } },
      });
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        icon: c.icon,
        color: c.color,
        parentId: c.parentId,
        monthlyLimit: c.monthlyLimit === null ? null : toMajor(c.monthlyLimit),
        isSystem: c.isSystem,
        sortOrder: c.sortOrder,
        transactionCount: c._count.transactions,
      }));
    });
  }

  /** Same data as findAll, nested one level deep for tree pickers. */
  async findTree(userId: string, kind?: CategoryKind) {
    const flat = await this.findAll(userId, kind);
    const byId = new Map(flat.map((c) => [c.id, { ...c, children: [] as typeof flat }]));
    const roots: (typeof flat[number] & { children: typeof flat })[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async findOne(userId: string, id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException('Category not found');
    return { ...category, monthlyLimit: category.monthlyLimit === null ? null : toMajor(category.monthlyLimit) };
  }

  async create(userId: string, dto: CreateCategoryDto) {
    if (dto.parentId) await this.assertOwned(userId, dto.parentId);
    const category = await this.prisma.category.create({
      data: {
        userId,
        name: dto.name.trim(),
        kind: dto.kind ?? 'EXPENSE',
        icon: dto.icon ?? 'tag',
        color: dto.color ?? '#6366f1',
        parentId: dto.parentId ?? null,
        monthlyLimit: dto.monthlyLimit === undefined ? null : toMinor(dto.monthlyLimit),
        sortOrder: dto.sortOrder ?? 999,
      },
    });
    this.cache.invalidate(`cat:${userId}`);
    return category;
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto) {
    await this.assertOwned(userId, id);
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent');
      await this.assertOwned(userId, dto.parentId);
    }
    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId || null } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.monthlyLimit !== undefined ? { monthlyLimit: toMinor(dto.monthlyLimit) } : {}),
      },
    });
    this.cache.invalidate(`cat:${userId}`);
    this.cache.invalidate(`analytics:${userId}`);
    return category;
  }

  /**
   * Deleting a category does not delete its history - transactions are
   * re-pointed to `reassignTo` (or left uncategorised) so totals never move.
   */
  async remove(userId: string, id: string, reassignTo?: string) {
    await this.assertOwned(userId, id);
    if (reassignTo) await this.assertOwned(userId, reassignTo);

    await this.prisma.$transaction([
      this.prisma.transaction.updateMany({
        where: { userId, categoryId: id },
        data: { categoryId: reassignTo ?? null },
      }),
      this.prisma.category.updateMany({ where: { userId, parentId: id }, data: { parentId: null } }),
      this.prisma.category.delete({ where: { id } }),
    ]);
    this.cache.invalidate(`cat:${userId}`);
    this.cache.invalidate(`analytics:${userId}`);
    return { id, deleted: true as const };
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const found = await this.prisma.category.findFirst({ where: { id, userId }, select: { id: true } });
    if (!found) throw new NotFoundException('Category not found');
  }
}
