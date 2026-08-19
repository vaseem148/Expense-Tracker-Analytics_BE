import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Papa from 'papaparse';
import { randomUUID } from 'node:crypto';
import { CacheService } from 'src/common/cache/cache.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { normaliseMerchant, transactionHash } from 'src/common/utils/merchant';
import { toMajor, toMinor } from 'src/common/utils/money';
import { guessCategory } from './auto-categorize';
import { ImportCsvDto } from './dto/import.dto';

interface ParsedRow {
  date: Date;
  description: string;
  amount: number;
  type: 'EXPENSE' | 'INCOME';
  merchant?: string;
  categoryName?: string;
  notes?: string;
  line: number;
}

@Injectable()
export class ImportExportService {
  private readonly logger = new Logger(ImportExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
  ) {}

  /** Header sniffing so the UI can pre-fill the mapping form. */
  preview(csv: string) {
    const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
      header: true,
      skipEmptyLines: true,
      preview: 10,
    });
    const headers = parsed.meta.fields ?? [];
    const guess = (candidates: string[]) =>
      headers.find((h) => candidates.some((c) => h.toLowerCase().includes(c))) ?? null;

    return {
      headers,
      rows: parsed.data.slice(0, 5),
      totalPreviewed: parsed.data.length,
      suggestedMapping: {
        date: guess(['date', 'txn date', 'value date']),
        description: guess(['description', 'narration', 'particulars', 'remarks', 'details']),
        amount: guess(['amount', 'value']),
        debit: guess(['debit', 'withdrawal', 'dr']),
        credit: guess(['credit', 'deposit', 'cr']),
        category: guess(['category']),
        merchant: guess(['merchant', 'payee', 'vendor']),
      },
      errors: parsed.errors.slice(0, 5).map((e) => e.message),
    };
  }

  async importCsv(userId: string, dto: ImportCsvDto) {
    const account = await this.prisma.account.findFirst({
      where: { id: dto.accountId, userId },
      select: { id: true },
    });
    if (!account) throw new BadRequestException('Account not found');

    const parsed = Papa.parse<Record<string, string>>(dto.csv.trim(), {
      header: true,
      skipEmptyLines: true,
    });
    if (!parsed.data.length) throw new BadRequestException('The file contains no data rows');

    const rows: ParsedRow[] = [];
    const errors: { line: number; reason: string }[] = [];

    parsed.data.forEach((raw, i) => {
      try {
        rows.push(this.mapRow(raw, dto, i + 2));
      } catch (err) {
        errors.push({ line: i + 2, reason: (err as Error).message });
      }
    });

    if (dto.dryRun) {
      return {
        dryRun: true,
        parsed: rows.length,
        errors,
        sample: rows.slice(0, 10).map((r) => ({ ...r, date: r.date.toISOString() })),
        totals: {
          expense: round2(rows.filter((r) => r.type === 'EXPENSE').reduce((a, r) => a + r.amount, 0)),
          income: round2(rows.filter((r) => r.type === 'INCOME').reduce((a, r) => a + r.amount, 0)),
        },
      };
    }

    const categories = await this.prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, kind: true },
    });
    const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
    const batchId = randomUUID();

    let imported = 0;
    let skipped = 0;
    const created: string[] = [];

    for (const [index, row] of rows.entries()) {
      const amountMinor = toMinor(row.amount);
      const hash = transactionHash({
        accountId: dto.accountId,
        date: row.date,
        amountMinor,
        description: row.description,
        type: row.type,
      });

      if (dto.skipDuplicates !== false) {
        const dupe = await this.prisma.transaction.findFirst({
          where: { userId, externalHash: hash },
          select: { id: true },
        });
        if (dupe) {
          skipped++;
          continue;
        }
      }

      const guessed =
        row.categoryName ??
        (dto.autoCategorize !== false ? guessCategory(`${row.description} ${row.merchant ?? ''}`) : null);
      const category = guessed ? byName.get(guessed.toLowerCase()) : undefined;

      const tx = await this.prisma.transaction.create({
        data: {
          userId,
          accountId: dto.accountId,
          orgId: dto.orgId ?? null,
          scope: dto.orgId ? 'BUSINESS' : 'PERSONAL',
          categoryId: category && category.kind === (row.type === 'INCOME' ? 'INCOME' : 'EXPENSE') ? category.id : null,
          type: row.type,
          amountMinor,
          description: row.description,
          merchant: row.merchant ?? null,
          merchantKey: normaliseMerchant(row.merchant ?? row.description),
          notes: row.notes ?? null,
          date: row.date,
          importBatchId: batchId,
          externalHash: hash,
        },
        select: { id: true },
      });
      created.push(tx.id);
      imported++;

      if (index % 25 === 0) {
        this.events.emit('import.progress', { userId, processed: index + 1, total: rows.length });
      }
    }

    this.cache.invalidate(`analytics:${userId}`);
    this.logger.log(`import ${batchId}: ${imported} imported, ${skipped} skipped`);

    return {
      batchId,
      imported,
      skipped,
      failed: errors.length,
      errors: errors.slice(0, 20),
      transactionIds: created.slice(0, 100),
    };
  }

  /** Reverses an entire import batch - the safety net for a bad mapping. */
  async undoImport(userId: string, batchId: string) {
    const res = await this.prisma.transaction.deleteMany({ where: { userId, importBatchId: batchId } });
    this.cache.invalidate(`analytics:${userId}`);
    return { batchId, removed: res.count };
  }

  async batches(userId: string) {
    const rows = await this.prisma.transaction.groupBy({
      by: ['importBatchId'],
      where: { userId, importBatchId: { not: null } },
      _count: { _all: true },
      _sum: { amountMinor: true },
      _min: { createdAt: true },
    });
    return rows
      .map((r) => ({
        batchId: r.importBatchId,
        transactions: r._count._all,
        total: toMajor(r._sum.amountMinor ?? 0),
        importedAt: r._min.createdAt,
      }))
      .sort((a, b) => (b.importedAt?.getTime() ?? 0) - (a.importedAt?.getTime() ?? 0));
  }

  /** CSV export of the full ledger for a window. */
  async exportCsv(userId: string, from?: Date, to?: Date): Promise<string> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        isDeleted: false,
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      include: {
        category: { select: { name: true } },
        account: { select: { name: true } },
        vendor: { select: { name: true } },
        department: { select: { name: true } },
        tags: { include: { tag: { select: { name: true } } } },
      },
      orderBy: { date: 'desc' },
    });

    return Papa.unparse(
      rows.map((t) => ({
        Date: t.date.toISOString().slice(0, 10),
        Type: t.type,
        Amount: toMajor(t.amountMinor),
        Currency: t.currency,
        Description: t.description,
        Merchant: t.merchant ?? '',
        Category: t.category?.name ?? '',
        Account: t.account.name,
        PaymentMethod: t.paymentMethod,
        Vendor: t.vendor?.name ?? '',
        Department: t.department?.name ?? '',
        Scope: t.scope,
        Tax: toMajor(t.taxAmountMinor),
        Billable: t.isBillable ? 'yes' : 'no',
        Recurring: t.isRecurring ? 'yes' : 'no',
        Tags: t.tags.map((x) => x.tag.name).join('|'),
        Notes: t.notes ?? '',
      })),
    );
  }

  /** Full JSON export - the portable backup of the company ledger. */
  async exportJson(userId: string) {
    const [user, accounts, categories, transactions, budgets, recurring] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true, currency: true, locale: true },
      }),
      this.prisma.account.findMany({ where: { userId } }),
      this.prisma.category.findMany({ where: { userId } }),
      this.prisma.transaction.findMany({ where: { userId, isDeleted: false } }),
      this.prisma.budget.findMany({ where: { userId } }),
      this.prisma.recurringRule.findMany({ where: { userId } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      user,
      accounts: accounts.map((a) => ({ ...a, openingBalance: toMajor(a.openingBalance) })),
      categories,
      transactions: transactions.map((t) => ({ ...t, amount: toMajor(t.amountMinor) })),
      budgets: budgets.map((b) => ({ ...b, amount: toMajor(b.amountMinor) })),
      recurring: recurring.map((r) => ({ ...r, amount: toMajor(r.amountMinor) })),
    };
  }

  // --- parsing helpers ------------------------------------------------

  private mapRow(raw: Record<string, string>, dto: ImportCsvDto, line: number): ParsedRow {
    const m = dto.mapping;
    const rawDate = (raw[m.date] ?? '').trim();
    const date = parseFlexibleDate(rawDate, dto.dateFormat ?? 'AUTO');
    if (!date) throw new Error(`Unparseable date "${rawDate}"`);

    const description = (raw[m.description] ?? '').trim();
    if (!description) throw new Error('Missing description');

    let amount = 0;
    let type: 'EXPENSE' | 'INCOME' = 'EXPENSE';

    if (m.debit || m.credit) {
      // Bank statement layout: two columns, only one populated per row.
      const debit = parseAmount(raw[m.debit ?? ''] ?? '');
      const credit = parseAmount(raw[m.credit ?? ''] ?? '');
      if (debit > 0) {
        amount = debit;
        type = 'EXPENSE';
      } else if (credit > 0) {
        amount = credit;
        type = 'INCOME';
      } else {
        throw new Error('Row has neither a debit nor a credit value');
      }
    } else {
      const value = parseAmount(raw[m.amount ?? ''] ?? '');
      if (value === 0) throw new Error('Amount is zero or unreadable');
      // A negative single-column amount conventionally means money out.
      amount = Math.abs(value);
      type = value < 0 ? 'EXPENSE' : 'INCOME';
    }

    return {
      date,
      description,
      amount,
      type,
      merchant: m.merchant ? raw[m.merchant]?.trim() : undefined,
      categoryName: m.category ? raw[m.category]?.trim() : undefined,
      notes: m.notes ? raw[m.notes]?.trim() : undefined,
      line,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Strips currency symbols, thousands separators and bracketed negatives. */
function parseAmount(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.\-()]/g, '').trim();
  if (!cleaned) return 0;
  const negative = cleaned.startsWith('(') && cleaned.endsWith(')');
  const n = parseFloat(cleaned.replace(/[()]/g, ''));
  if (Number.isNaN(n)) return 0;
  return negative ? -n : n;
}

/**
 * Indian bank exports are overwhelmingly DD/MM/YYYY while ISO exports are
 * YYYY-MM-DD, and JS Date guesses wrong on the former. AUTO disambiguates by
 * checking whether the first component can only be a day.
 */
function parseFlexibleDate(value: string, format: string): Date | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const parts = value.split(/[\/\-.]/).map((p) => p.trim());
  if (parts.length >= 3) {
    let [a, b, c] = parts;
    if (c.length === 2) c = `20${c}`;
    const n1 = Number(a);
    const n2 = Number(b);
    const year = Number(c);
    if (!Number.isNaN(n1) && !Number.isNaN(n2) && !Number.isNaN(year)) {
      const dayFirst =
        format === 'DD/MM/YYYY' || (format === 'AUTO' && (n1 > 12 || n2 <= 12));
      const day = dayFirst ? n1 : n2;
      const month = dayFirst ? n2 : n1;
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        return new Date(year, month - 1, day);
      }
    }
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
