import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addDays } from 'date-fns';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { roundTo, toMajor, toMinor } from 'src/common/utils/money';
import { CreateInvoiceDto, PayInvoiceDto, UpdateInvoiceDto } from './dto/vendor.dto';
import { OrgAccessService } from './org-access.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrgAccessService,
  ) {}

  async list(orgId: string, userId: string, status?: string) {
    await this.access.membership(orgId, userId);
    const invoices = await this.prisma.invoice.findMany({
      where: { orgId, ...(status ? { status } : {}) },
      include: { vendor: { select: { id: true, name: true, paymentTermsDays: true } } },
      orderBy: [{ dueDate: 'asc' }],
    });

    const now = Date.now();
    const items = invoices.map((i) => {
      const total = toMajor(i.totalMinor);
      const paid = toMajor(i.paidMinor);
      const daysToDue = Math.ceil((i.dueDate.getTime() - now) / 864e5);
      // An OPEN invoice past its due date is OVERDUE regardless of the stored
      // status - deriving it means a missed cron never shows stale data.
      const derived =
        i.status === 'OPEN' || i.status === 'PARTIAL'
          ? daysToDue < 0
            ? 'OVERDUE'
            : i.status
          : i.status;
      return {
        id: i.id,
        number: i.number,
        vendor: i.vendor,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        subtotal: toMajor(i.subtotalMinor),
        tax: toMajor(i.taxMinor),
        total,
        paid,
        outstanding: roundTo(total - paid, 2),
        status: derived,
        daysToDue,
        agingBucket: bucketise(daysToDue, derived),
        notes: i.notes,
      };
    });

    const outstanding = items.filter((i) => i.status !== 'PAID' && i.status !== 'VOID');
    const buckets = ['current', '1-30', '31-60', '61-90', '90+'] as const;

    return {
      items,
      summary: {
        count: items.length,
        totalOutstanding: roundTo(
          outstanding.reduce((a, i) => a + i.outstanding, 0),
          2,
        ),
        overdueCount: outstanding.filter((i) => i.status === 'OVERDUE').length,
        overdueValue: roundTo(
          outstanding.filter((i) => i.status === 'OVERDUE').reduce((a, i) => a + i.outstanding, 0),
          2,
        ),
        dueThisWeek: outstanding.filter((i) => i.daysToDue >= 0 && i.daysToDue <= 7).length,
        aging: buckets.map((b) => ({
          bucket: b,
          count: outstanding.filter((i) => i.agingBucket === b).length,
          value: roundTo(
            outstanding.filter((i) => i.agingBucket === b).reduce((a, i) => a + i.outstanding, 0),
            2,
          ),
        })),
      },
    };
  }

  async create(orgId: string, userId: string, dto: CreateInvoiceDto) {
    await this.access.require(orgId, userId, 'FINANCE');
    const vendor = await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, orgId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const issueDate = new Date(dto.issueDate);
    const subtotalMinor = toMinor(dto.subtotal);
    const taxMinor = toMinor(dto.tax ?? 0);

    return this.prisma.invoice.create({
      data: {
        orgId,
        vendorId: dto.vendorId,
        number: dto.number.trim(),
        issueDate,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : addDays(issueDate, vendor.paymentTermsDays),
        subtotalMinor,
        taxMinor,
        totalMinor: subtotalMinor + taxMinor,
        status: dto.status ?? 'OPEN',
        notes: dto.notes ?? null,
      },
    });
  }

  async update(orgId: string, userId: string, id: string, dto: UpdateInvoiceDto) {
    await this.access.require(orgId, userId, 'FINANCE');
    const invoice = await this.prisma.invoice.findFirst({ where: { id, orgId } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const subtotalMinor = dto.subtotal !== undefined ? toMinor(dto.subtotal) : invoice.subtotalMinor;
    const taxMinor = dto.tax !== undefined ? toMinor(dto.tax) : invoice.taxMinor;

    return this.prisma.invoice.update({
      where: { id },
      data: {
        ...(dto.number !== undefined ? { number: dto.number.trim() } : {}),
        ...(dto.issueDate !== undefined ? { issueDate: new Date(dto.issueDate) } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        subtotalMinor,
        taxMinor,
        totalMinor: subtotalMinor + taxMinor,
      },
    });
  }

  /**
   * Records a payment and, when an account is supplied, writes the matching
   * cash-out transaction so the ledger and the AP module never disagree.
   */
  async pay(orgId: string, userId: string, id: string, dto: PayInvoiceDto) {
    await this.access.require(orgId, userId, 'FINANCE');
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, orgId },
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'VOID') throw new BadRequestException('Cannot pay a voided invoice');

    const payMinor = toMinor(dto.amount);
    const paidMinor = Math.min(invoice.totalMinor, invoice.paidMinor + payMinor);
    const status = paidMinor >= invoice.totalMinor ? 'PAID' : 'PARTIAL';

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { paidMinor, status },
    });

    if (dto.accountId) {
      await this.prisma.transaction.create({
        data: {
          userId,
          orgId,
          accountId: dto.accountId,
          vendorId: invoice.vendorId,
          invoiceId: invoice.id,
          type: 'EXPENSE',
          scope: 'BUSINESS',
          amountMinor: payMinor,
          description: `Invoice ${invoice.number} - ${invoice.vendor.name}`,
          merchant: invoice.vendor.name,
          date: new Date(),
          paymentMethod: 'NETBANKING',
          invoiceNumber: invoice.number,
          notes: dto.reference ?? null,
        },
      });
    }

    return {
      ...updated,
      total: toMajor(updated.totalMinor),
      paid: toMajor(updated.paidMinor),
      outstanding: toMajor(updated.totalMinor - updated.paidMinor),
    };
  }

  async remove(orgId: string, userId: string, id: string) {
    await this.access.require(orgId, userId, 'FINANCE');
    await this.prisma.invoice.updateMany({ where: { id, orgId }, data: { status: 'VOID' } });
    return { id, voided: true as const };
  }
}

function bucketise(daysToDue: number, status: string): string {
  if (status === 'PAID' || status === 'VOID') return 'settled';
  if (daysToDue >= 0) return 'current';
  const overdue = Math.abs(daysToDue);
  if (overdue <= 30) return '1-30';
  if (overdue <= 60) return '31-60';
  if (overdue <= 90) return '61-90';
  return '90+';
}
