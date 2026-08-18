import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CreateApiKeyDto } from './dto/integration.dto';

const DEFAULT_SCOPES = ['transactions:read', 'analytics:read'];

/**
 * Machine-to-machine keys for a company's own jobs.
 * Only the SHA-256 hash is stored: a leaked database yields nothing usable,
 * and the plaintext key is shown exactly once at creation.
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, orgId?: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: orgId ? { orgId } : { userId, orgId: null },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: JSON.parse(k.scopes) as string[],
      rateLimit: k.rateLimit,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      isActive: !k.revokedAt && (!k.expiresAt || k.expiresAt > new Date()),
      createdAt: k.createdAt,
    }));
  }

  async create(userId: string, dto: CreateApiKeyDto) {
    const raw = randomBytes(24).toString('base64url');
    const prefix = `eak_${randomBytes(4).toString('hex')}`;
    const token = `${prefix}_${raw}`;

    const key = await this.prisma.apiKey.create({
      data: {
        userId,
        orgId: dto.orgId ?? null,
        name: dto.name.trim(),
        prefix,
        keyHash: this.hash(token),
        scopes: JSON.stringify(dto.scopes?.length ? dto.scopes : DEFAULT_SCOPES),
        rateLimit: dto.rateLimit ?? 1000,
      },
    });

    return {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: JSON.parse(key.scopes) as string[],
      // Shown once. There is no endpoint that can return it again.
      token,
      warning: 'Copy this key now - it cannot be retrieved later.',
    };
  }

  async revoke(userId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, userId } });
    if (!key) throw new NotFoundException('API key not found');
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true as const };
  }

  /** Resolves a presented token to its owner, or null when it is not valid. */
  async verify(token: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: this.hash(token) } });
    if (!key || key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt < new Date()) return null;
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return {
      userId: key.userId,
      orgId: key.orgId,
      scopes: JSON.parse(key.scopes) as string[],
      rateLimit: key.rateLimit,
    };
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
