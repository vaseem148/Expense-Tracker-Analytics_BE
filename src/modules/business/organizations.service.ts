import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { normaliseMerchant } from 'src/common/utils/merchant';
import { toMajor, toMinor } from 'src/common/utils/money';
import {
  CreateDepartmentDto,
  CreateOrgDto,
  CreateProjectDto,
  InviteMemberDto,
  UpdateDepartmentDto,
  UpdateMemberDto,
  UpdateOrgDto,
  UpdateProjectDto,
} from './dto/org.dto';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { OrgAccessService } from './org-access.service';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrgAccessService,
  ) {}

  // --- organizations --------------------------------------------------

  async create(userId: string, dto: CreateOrgDto) {
    const base = slugify(dto.name) || 'org';
    let slug = base;
    let n = 1;
    while (await this.prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${base}-${++n}`;
    }

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name.trim(),
        slug,
        legalName: dto.legalName ?? null,
        gstin: dto.gstin ?? null,
        pan: dto.pan ?? null,
        addressLine: dto.addressLine ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        currency: dto.currency ?? 'INR',
        fiscalYearStartMonth: dto.fiscalYearStartMonth ?? 4,
        cashOnHandMinor: toMinor(dto.cashOnHand ?? 0),
        logoColor: dto.logoColor ?? '#6366f1',
        ownerId: userId,
        members: { create: { userId, role: 'OWNER', title: 'Founder' } },
        departments: {
          create: [
            { name: 'General', code: 'GEN', color: '#64748b' },
            { name: 'Engineering', code: 'ENG', color: '#0ea5e9' },
            { name: 'Sales & Marketing', code: 'SLS', color: '#f97316' },
            { name: 'Operations', code: 'OPS', color: '#10b981' },
          ],
        },
      },
      include: { departments: true, _count: { select: { members: true } } },
    });
    return org;
  }

  async findOne(orgId: string, userId: string) {
    await this.access.membership(orgId, userId);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        departments: { orderBy: { name: 'asc' } },
        _count: {
          select: { members: true, vendors: true, projects: true, transactions: true, invoices: true },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return { ...org, cashOnHand: toMajor(org.cashOnHandMinor), counts: org._count, _count: undefined };
  }

  async update(orgId: string, userId: string, dto: UpdateOrgDto) {
    await this.access.require(orgId, userId, 'ADMIN');
    return this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
        ...(dto.gstin !== undefined ? { gstin: dto.gstin } : {}),
        ...(dto.pan !== undefined ? { pan: dto.pan } : {}),
        ...(dto.addressLine !== undefined ? { addressLine: dto.addressLine } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.state !== undefined ? { state: dto.state } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.fiscalYearStartMonth !== undefined
          ? { fiscalYearStartMonth: dto.fiscalYearStartMonth }
          : {}),
        ...(dto.cashOnHand !== undefined ? { cashOnHandMinor: toMinor(dto.cashOnHand) } : {}),
        ...(dto.logoColor !== undefined ? { logoColor: dto.logoColor } : {}),
      },
    });
  }

  // --- members --------------------------------------------------------

  async members(orgId: string, userId: string) {
    await this.access.membership(orgId, userId);
    const members = await this.prisma.orgMember.findMany({
      where: { orgId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarColor: true, lastLoginAt: true } },
        department: { select: { id: true, name: true, color: true } },
        manager: { select: { id: true, name: true } },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    // Month-to-date spend per member, so managers can see burn per head.
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const spend = await this.prisma.transaction.groupBy({
      by: ['userId'],
      where: { orgId, isDeleted: false, type: 'EXPENSE', date: { gte: start } },
      _sum: { amountMinor: true },
    });
    const spendMap = new Map(spend.map((s) => [s.userId, toMajor(s._sum.amountMinor ?? 0)]));

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      avatarColor: m.user.avatarColor,
      role: m.role,
      title: m.title,
      department: m.department,
      manager: m.manager,
      monthlyLimit: toMajor(m.monthlyLimit),
      monthToDateSpend: spendMap.get(m.userId) ?? 0,
      limitUsedPct:
        m.monthlyLimit > 0
          ? Math.round(((spendMap.get(m.userId) ?? 0) / toMajor(m.monthlyLimit)) * 1000) / 10
          : null,
      isActive: m.isActive,
      joinedAt: m.joinedAt,
      lastLoginAt: m.user.lastLoginAt,
    }));
  }

  /**
   * Adds an existing platform user to the org. There is no email delivery in
   * this build, so the invite resolves against a registered account and fails
   * loudly if none exists - better than silently creating a ghost member.
   */
  async inviteMember(orgId: string, actorId: string, dto: InviteMemberDto) {
    await this.access.require(orgId, actorId, 'ADMIN');
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('No registered user with that email - ask them to sign up first');
    }
    const existing = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    if (existing) throw new BadRequestException('That user is already a member');

    return this.prisma.orgMember.create({
      data: {
        orgId,
        userId: user.id,
        role: dto.role ?? 'EMPLOYEE',
        title: dto.title ?? null,
        departmentId: dto.departmentId ?? null,
        managerId: dto.managerId ?? null,
        monthlyLimit: toMinor(dto.monthlyLimit ?? 0),
      },
    });
  }

  async updateMember(orgId: string, actorId: string, memberId: string, dto: UpdateMemberDto) {
    await this.access.require(orgId, actorId, 'ADMIN');
    const member = await this.prisma.orgMember.findFirst({ where: { id: memberId, orgId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'OWNER' && dto.role && dto.role !== 'OWNER') {
      throw new BadRequestException('The owner role cannot be reassigned');
    }
    return this.prisma.orgMember.update({
      where: { id: memberId },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId || null } : {}),
        ...(dto.managerId !== undefined ? { managerId: dto.managerId || null } : {}),
        ...(dto.monthlyLimit !== undefined ? { monthlyLimit: toMinor(dto.monthlyLimit) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async removeMember(orgId: string, actorId: string, memberId: string) {
    await this.access.require(orgId, actorId, 'ADMIN');
    const member = await this.prisma.orgMember.findFirst({ where: { id: memberId, orgId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'OWNER') throw new BadRequestException('The owner cannot be removed');
    await this.prisma.orgMember.delete({ where: { id: memberId } });
    return { id: memberId, removed: true as const };
  }

  // --- departments ----------------------------------------------------

  async departments(orgId: string, userId: string) {
    await this.access.membership(orgId, userId);
    const departments = await this.prisma.department.findMany({
      where: { orgId },
      include: { _count: { select: { members: true, transactions: true } } },
      orderBy: { name: 'asc' },
    });

    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const spend = await this.prisma.transaction.groupBy({
      by: ['departmentId'],
      where: { orgId, isDeleted: false, type: 'EXPENSE', date: { gte: start } },
      _sum: { amountMinor: true },
    });
    const spendMap = new Map(spend.map((s) => [s.departmentId, toMajor(s._sum.amountMinor ?? 0)]));

    return departments.map((d) => {
      const budget = toMajor(d.monthlyBudget);
      const spent = spendMap.get(d.id) ?? 0;
      return {
        id: d.id,
        name: d.name,
        code: d.code,
        color: d.color,
        monthlyBudget: budget,
        monthToDateSpend: spent,
        remaining: Math.round((budget - spent) * 100) / 100,
        consumedPct: budget > 0 ? Math.round((spent / budget) * 1000) / 10 : null,
        headcount: d._count.members,
        transactions: d._count.transactions,
        costPerHead: d._count.members > 0 ? Math.round((spent / d._count.members) * 100) / 100 : 0,
      };
    });
  }

  async createDepartment(orgId: string, userId: string, dto: CreateDepartmentDto) {
    await this.access.require(orgId, userId, 'ADMIN');
    return this.prisma.department.create({
      data: {
        orgId,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        monthlyBudget: toMinor(dto.monthlyBudget ?? 0),
        headUserId: dto.headUserId ?? null,
        color: dto.color ?? '#0ea5e9',
      },
    });
  }

  async updateDepartment(orgId: string, userId: string, id: string, dto: UpdateDepartmentDto) {
    await this.access.require(orgId, userId, 'ADMIN');
    const dept = await this.prisma.department.findFirst({ where: { id, orgId } });
    if (!dept) throw new NotFoundException('Department not found');
    return this.prisma.department.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined ? { code: dto.code.toUpperCase() } : {}),
        ...(dto.monthlyBudget !== undefined ? { monthlyBudget: toMinor(dto.monthlyBudget) } : {}),
        ...(dto.headUserId !== undefined ? { headUserId: dto.headUserId || null } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
    });
  }

  async removeDepartment(orgId: string, userId: string, id: string) {
    await this.access.require(orgId, userId, 'ADMIN');
    await this.prisma.department.deleteMany({ where: { id, orgId } });
    return { id, deleted: true as const };
  }

  // --- vendors --------------------------------------------------------

  async vendors(orgId: string, userId: string) {
    await this.access.membership(orgId, userId);
    const vendors = await this.prisma.vendor.findMany({
      where: { orgId },
      include: { _count: { select: { transactions: true, invoices: true } } },
      orderBy: { name: 'asc' },
    });

    const spend = await this.prisma.transaction.groupBy({
      by: ['vendorId'],
      where: { orgId, isDeleted: false, vendorId: { not: null } },
      _sum: { amountMinor: true },
      _max: { date: true },
    });
    const spendMap = new Map(
      spend.map((s) => [s.vendorId, { total: toMajor(s._sum.amountMinor ?? 0), last: s._max.date }]),
    );

    const outstanding = await this.prisma.invoice.groupBy({
      by: ['vendorId'],
      where: { orgId, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } },
      _sum: { totalMinor: true, paidMinor: true },
    });
    const dueMap = new Map(
      outstanding.map((o) => [o.vendorId, toMajor((o._sum.totalMinor ?? 0) - (o._sum.paidMinor ?? 0))]),
    );

    const grandTotal = [...spendMap.values()].reduce((a, v) => a + v.total, 0);

    return vendors.map((v) => ({
      id: v.id,
      name: v.name,
      gstin: v.gstin,
      pan: v.pan,
      email: v.email,
      phone: v.phone,
      category: v.category,
      paymentTermsDays: v.paymentTermsDays,
      isPreferred: v.isPreferred,
      riskScore: v.riskScore,
      totalSpend: spendMap.get(v.id)?.total ?? 0,
      spendShare:
        grandTotal > 0 ? Math.round(((spendMap.get(v.id)?.total ?? 0) / grandTotal) * 1000) / 10 : 0,
      lastTransaction: spendMap.get(v.id)?.last ?? null,
      outstanding: dueMap.get(v.id) ?? 0,
      transactionCount: v._count.transactions,
      invoiceCount: v._count.invoices,
    }));
  }

  async createVendor(orgId: string, userId: string, dto: CreateVendorDto) {
    await this.access.require(orgId, userId, 'FINANCE');
    return this.prisma.vendor.create({
      data: {
        orgId,
        name: dto.name.trim(),
        normKey: normaliseMerchant(dto.name) ?? dto.name.toLowerCase(),
        gstin: dto.gstin ?? null,
        pan: dto.pan ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        category: dto.category ?? null,
        paymentTermsDays: dto.paymentTermsDays ?? 30,
        isPreferred: dto.isPreferred ?? false,
        notes: dto.notes ?? null,
      },
    });
  }

  async updateVendor(orgId: string, userId: string, id: string, dto: UpdateVendorDto) {
    await this.access.require(orgId, userId, 'FINANCE');
    const vendor = await this.prisma.vendor.findFirst({ where: { id, orgId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendor.update({
      where: { id },
      data: {
        ...(dto.name !== undefined
          ? { name: dto.name.trim(), normKey: normaliseMerchant(dto.name) ?? dto.name.toLowerCase() }
          : {}),
        ...(dto.gstin !== undefined ? { gstin: dto.gstin } : {}),
        ...(dto.pan !== undefined ? { pan: dto.pan } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.paymentTermsDays !== undefined ? { paymentTermsDays: dto.paymentTermsDays } : {}),
        ...(dto.isPreferred !== undefined ? { isPreferred: dto.isPreferred } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  async removeVendor(orgId: string, userId: string, id: string) {
    await this.access.require(orgId, userId, 'FINANCE');
    await this.prisma.vendor.deleteMany({ where: { id, orgId } });
    return { id, deleted: true as const };
  }

  // --- projects -------------------------------------------------------

  async projects(orgId: string, userId: string) {
    await this.access.membership(orgId, userId);
    const projects = await this.prisma.project.findMany({
      where: { orgId },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });

    const spend = await this.prisma.transaction.groupBy({
      by: ['projectId'],
      where: { orgId, isDeleted: false, type: 'EXPENSE', projectId: { not: null } },
      _sum: { amountMinor: true },
      _count: { _all: true },
    });
    const billable = await this.prisma.transaction.groupBy({
      by: ['projectId'],
      where: {
        orgId,
        isDeleted: false,
        type: 'EXPENSE',
        isBillable: true,
        projectId: { not: null },
      },
      _sum: { amountMinor: true },
    });
    const spendMap = new Map(spend.map((s) => [s.projectId, s]));
    const billMap = new Map(billable.map((s) => [s.projectId, toMajor(s._sum.amountMinor ?? 0)]));

    return projects.map((p) => {
      const budget = toMajor(p.budgetMinor);
      const spent = toMajor(spendMap.get(p.id)?._sum.amountMinor ?? 0);
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        clientName: p.clientName,
        status: p.status,
        isBillable: p.isBillable,
        startDate: p.startDate,
        endDate: p.endDate,
        budget,
        spent,
        billableSpend: billMap.get(p.id) ?? 0,
        remaining: Math.round((budget - spent) * 100) / 100,
        consumedPct: budget > 0 ? Math.round((spent / budget) * 1000) / 10 : null,
        transactions: spendMap.get(p.id)?._count._all ?? 0,
        isOverBudget: budget > 0 && spent > budget,
      };
    });
  }

  async createProject(orgId: string, userId: string, dto: CreateProjectDto) {
    await this.access.require(orgId, userId, 'MANAGER');
    return this.prisma.project.create({
      data: {
        orgId,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        clientName: dto.clientName ?? null,
        budgetMinor: toMinor(dto.budget ?? 0),
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        status: dto.status ?? 'ACTIVE',
        isBillable: dto.isBillable ?? true,
      },
    });
  }

  async updateProject(orgId: string, userId: string, id: string, dto: UpdateProjectDto) {
    await this.access.require(orgId, userId, 'MANAGER');
    const project = await this.prisma.project.findFirst({ where: { id, orgId } });
    if (!project) throw new NotFoundException('Project not found');
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined ? { code: dto.code.toUpperCase() } : {}),
        ...(dto.clientName !== undefined ? { clientName: dto.clientName } : {}),
        ...(dto.budget !== undefined ? { budgetMinor: toMinor(dto.budget) } : {}),
        ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate ? new Date(dto.endDate) : null }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.isBillable !== undefined ? { isBillable: dto.isBillable } : {}),
      },
    });
  }

  async removeProject(orgId: string, userId: string, id: string) {
    await this.access.require(orgId, userId, 'MANAGER');
    await this.prisma.project.deleteMany({ where: { id, orgId } });
    return { id, deleted: true as const };
  }
}
