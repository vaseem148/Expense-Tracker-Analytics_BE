import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { roundTo, toMajor, toMinor } from 'src/common/utils/money';
import { CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async findAll(userId: string) {
    const goals = await this.prisma.savingsGoal.findMany({
      where: { userId },
      orderBy: [{ isAchieved: 'asc' }, { createdAt: 'desc' }],
    });

    return goals.map((g) => {
      const target = toMajor(g.targetMinor);
      const saved = toMajor(g.savedMinor);
      const remaining = Math.max(0, roundTo(target - saved, 2));
      const daysLeft = g.targetDate
        ? Math.ceil((g.targetDate.getTime() - Date.now()) / 864e5)
        : null;
      return {
        id: g.id,
        name: g.name,
        target,
        saved,
        remaining,
        progressPct: target > 0 ? roundTo((saved / target) * 100, 1) : 0,
        targetDate: g.targetDate,
        daysLeft,
        // What you must set aside each month to land on time.
        requiredMonthly:
          daysLeft && daysLeft > 0 ? roundTo(remaining / Math.max(1, daysLeft / 30), 2) : null,
        onTrack: daysLeft === null ? null : remaining === 0 || (daysLeft > 0 && saved / Math.max(target, 1) >= 0.5),
        color: g.color,
        icon: g.icon,
        isAchieved: g.isAchieved,
      };
    });
  }

  async create(userId: string, dto: CreateGoalDto) {
    return this.prisma.savingsGoal.create({
      data: {
        userId,
        name: dto.name.trim(),
        targetMinor: toMinor(dto.target),
        savedMinor: toMinor(dto.saved ?? 0),
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        color: dto.color ?? '#10b981',
        icon: dto.icon ?? 'target',
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    await this.assertOwned(userId, id);
    return this.prisma.savingsGoal.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.target !== undefined ? { targetMinor: toMinor(dto.target) } : {}),
        ...(dto.saved !== undefined ? { savedMinor: toMinor(dto.saved) } : {}),
        ...(dto.targetDate !== undefined
          ? { targetDate: dto.targetDate ? new Date(dto.targetDate) : null }
          : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
      },
    });
  }

  /** Adds (or with a negative amount, withdraws) and flips the achieved flag. */
  async contribute(userId: string, id: string, amount: number) {
    const goal = await this.prisma.savingsGoal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundException('Goal not found');

    const savedMinor = Math.max(0, goal.savedMinor + toMinor(amount));
    const isAchieved = savedMinor >= goal.targetMinor;
    const updated = await this.prisma.savingsGoal.update({
      where: { id },
      data: { savedMinor, isAchieved },
    });

    if (isAchieved && !goal.isAchieved) {
      this.events.emit('goal.reached', { userId, goalId: id, name: goal.name });
    }
    return { ...updated, saved: toMajor(updated.savedMinor), target: toMajor(updated.targetMinor) };
  }

  async remove(userId: string, id: string) {
    await this.assertOwned(userId, id);
    await this.prisma.savingsGoal.delete({ where: { id } });
    return { id, deleted: true as const };
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const found = await this.prisma.savingsGoal.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Goal not found');
  }
}
