import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // WAL + a busy timeout keep SQLite usable while the scheduler writes in the
    // background and API requests read concurrently.
    // `PRAGMA journal_mode` answers with a row, so it has to go through
    // $queryRaw - $executeRaw rejects any statement that returns results.
    try {
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await this.$executeRawUnsafe('PRAGMA busy_timeout = 5000;');
      await this.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
      this.logger.log('Prisma connected (SQLite/WAL)');
    } catch (err) {
      // A pragma failure is not fatal: the app still works, just less
      // concurrently, so log it and keep the process up.
      this.logger.warn(`SQLite pragmas skipped: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /** Wipe user-owned rows in FK-safe order. Used by tests and the seeder. */
  async truncateAll(): Promise<void> {
    await this.$transaction([
      this.transactionTag.deleteMany(),
      this.transaction.deleteMany(),
      this.recurringRule.deleteMany(),
      this.budget.deleteMany(),
      this.notification.deleteMany(),
      this.auditLog.deleteMany(),
      this.tag.deleteMany(),
      this.category.deleteMany(),
      this.account.deleteMany(),
      this.refreshToken.deleteMany(),
      this.user.deleteMany(),
    ]);
  }
}
