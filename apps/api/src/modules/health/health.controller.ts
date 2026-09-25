import { Controller, Get, HttpCode } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { RedisService } from '@/infra/redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const [dbOk, redisOk] = await Promise.all([this.checkDb(), Promise.resolve(this.redis.isHealthy())]);
    return { status: dbOk && redisOk ? 'ok' : 'degraded', db: dbOk, redis: redisOk };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
