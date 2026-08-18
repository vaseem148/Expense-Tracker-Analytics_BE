import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CacheService } from 'src/common/cache/cache.service';
import { Public } from 'src/common/decorators/public.decorator';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly gateway: EventsGateway,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  liveness() {
    return { status: 'ok', uptimeSec: Math.round((Date.now() - this.startedAt) / 1000) };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - verifies the database round-trips' })
  async readiness() {
    const started = Date.now();
    let db: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    const mem = process.memoryUsage();
    return {
      status: db === 'up' ? 'ready' : 'degraded',
      checks: {
        database: { status: db, latencyMs: Date.now() - started },
        cache: this.cache.stats(),
        realtime: { connectedUsers: this.gateway.onlineCount() },
      },
      runtime: {
        node: process.version,
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        rssMb: Math.round(mem.rss / 1048576),
        uptimeSec: Math.round(process.uptime()),
      },
    };
  }
}
