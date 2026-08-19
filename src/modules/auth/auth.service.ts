import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { AuthUser, JwtPayload, Role } from 'src/common/types/domain.types';
import { toMinor } from 'src/common/utils/money';
import { CategoriesService } from '../categories/categories.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult extends TokenPair {
  user: AuthUser & { monthlyIncome: number; locale: string; avatarColor: string };
}

interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Dummy hash used to keep login timing constant for unknown emails. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Uw1Zk3xkS1n9lLQ0mV3Yl0jH0eXqXhJ8kM9pQ2rT4vY';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly categories: CategoriesService,
  ) {}

  async register(dto: RegisterDto, meta: ClientMeta = {}): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('That email is already registered');

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash: await argon2.hash(dto.password, ARGON_OPTS),
        currency: dto.currency ?? this.config.get<string>('defaultCurrency') ?? 'INR',
      },
    });

    // Registration provisions a company, not a personal ledger: default cost
    // categories, four cost centres, an operating account and the approval
    // policies a finance team expects on day one.
    await this.categories.seedDefaults(user.id);
    await this.prisma.account.create({
      data: { userId: user.id, name: 'Operating Account', type: 'BANK', currency: user.currency },
    });
    await this.provisionCompany(user.id, dto);

    this.logger.log(`registered ${email} with company "${dto.companyName}"`);
    return this.issue(user, meta);
  }

  async login(dto: LoginDto, meta: ClientMeta = {}): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always run a verify so response timing does not reveal account existence.
    const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, dto.password).catch(() => false);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issue(user, meta);
  }

  /**
   * Rotating refresh: the presented token is revoked and replaced.
   * Presenting an already-revoked token means it leaked, so the whole family
   * is burned and every session in that lineage dies.
   */
  async refresh(refreshToken: string, meta: ClientMeta = {}): Promise<AuthResult> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    const tokenHash = this.hash(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) throw new UnauthorizedException('Refresh token not recognised');

    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, family: stored.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`refresh replay detected for user ${stored.userId}; family revoked`);
      throw new UnauthorizedException('Refresh token reuse detected - please sign in again');
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('Account is inactive');

    const next = await this.issue(user, meta, stored.family);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedBy: this.hash(next.refreshToken) },
    });
    return next;
  }

  async logout(userId: string, refreshToken?: string): Promise<{ revoked: number }> {
    if (refreshToken) {
      const stored = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: this.hash(refreshToken) },
      });
      if (stored) {
        const res = await this.prisma.refreshToken.updateMany({
          where: { userId, family: stored.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { revoked: res.count };
      }
    }
    const res = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: res.count };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, dto.currentPassword).catch(() => false);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must differ from the current one');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(dto.newPassword, ARGON_OPTS) },
    });
    await this.logout(userId); // a password change kills every session
    return { ok: true };
  }

  async sessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.refreshToken.updateMany({
      where: { id, userId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /** Housekeeping for expired/revoked tokens; called by the scheduler. */
  async pruneTokens(): Promise<number> {
    const res = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: new Date(Date.now() - 7 * 864e5) } },
        ],
      },
    });
    return res.count;
  }

  private async issue(
    user: {
      id: string;
      email: string;
      role: string;
      name: string;
      currency: string;
      monthlyIncome: number;
      locale: string;
      avatarColor: string;
    },
    meta: ClientMeta,
    family?: string,
  ): Promise<AuthResult> {
    const fam = family ?? randomUUID();
    const base: JwtPayload = { sub: user.id, email: user.email, role: user.role as Role };

    const accessTtl = this.config.get<string>('jwt.accessTtl') ?? '900s';
    const refreshTtl = this.config.get<string>('jwt.refreshTtl') ?? '30d';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(base, {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: accessTtl as unknown as number,
      }),
      this.jwt.signAsync(
        { ...base, fam },
        {
          secret: this.config.get<string>('jwt.refreshSecret'),
          expiresIn: refreshTtl as unknown as number,
        },
      ),
    ]);

    const decoded = this.jwt.decode(refreshToken) as JwtPayload;
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        family: fam,
        expiresAt: new Date((decoded.exp ?? Math.floor(Date.now() / 1000) + 2592000) * 1000),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ttlSeconds(accessTtl),
      user: {
        id: user.id,
        email: user.email,
        role: user.role as Role,
        name: user.name,
        currency: user.currency,
        monthlyIncome: user.monthlyIncome / 100,
        locale: user.locale,
        avatarColor: user.avatarColor,
      },
    };
  }

  /** Creates the organization, its cost centres and its approval policies. */
  private async provisionCompany(ownerId: string, dto: RegisterDto): Promise<void> {
    const base =
      dto.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'company';
    let slug = base;
    let n = 1;
    while (await this.prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${base}-${++n}`;
    }

    await this.prisma.organization.create({
      data: {
        name: dto.companyName.trim(),
        slug,
        gstin: dto.gstin ?? null,
        currency: dto.currency ?? 'INR',
        cashOnHandMinor: toMinor(dto.cashOnHand ?? 0),
        ownerId,
        members: { create: { userId: ownerId, role: 'OWNER', title: 'Founder' } },
        departments: {
          create: [
            { name: 'Engineering', code: 'ENG', color: '#0ea5e9' },
            { name: 'Sales & Marketing', code: 'SLS', color: '#f97316' },
            { name: 'Operations', code: 'OPS', color: '#10b981' },
            { name: 'General & Admin', code: 'GNA', color: '#64748b' },
          ],
        },
        policies: {
          create: [
            {
              name: 'Standard approval',
              minAmount: 0,
              maxAmount: 2500000,
              approverRole: 'MANAGER',
              receiptAbove: 100000,
            },
            {
              name: 'Senior approval',
              minAmount: 2500000,
              approverRole: 'FINANCE',
              requiresTwo: true,
              receiptAbove: 100000,
            },
          ],
        },
      },
    });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private ttlSeconds(ttl: string): number {
    const m = /^(\d+)([smhd])?$/.exec(ttl.trim());
    if (!m) return 900;
    const n = parseInt(m[1], 10);
    const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return n * (mult[m[2] ?? 's'] ?? 1);
  }
}
