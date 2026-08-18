import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { DateRangeDto } from 'src/common/dto/date-range.dto';
import { BusinessAnalyticsService } from './business-analytics.service';
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
import { OrganizationsService } from './organizations.service';

@ApiTags('business')
@ApiBearerAuth()
@Controller('orgs')
export class BusinessController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly access: OrgAccessService,
    private readonly analytics: BusinessAnalyticsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Organizations the caller belongs to' })
  myOrgs(@CurrentUser('id') userId: string) {
    return this.access.myOrgs(userId);
  }

  @Post()
  @Audit('CREATE', 'Organization')
  @ApiOperation({ summary: 'Create an organization with default departments' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateOrgDto) {
    return this.orgs.create(userId, dto);
  }

  @Get(':orgId')
  findOne(@CurrentUser('id') userId: string, @Param('orgId') orgId: string) {
    return this.orgs.findOne(orgId, userId);
  }

  @Patch(':orgId')
  @Audit('UPDATE', 'Organization')
  update(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrgDto,
  ) {
    return this.orgs.update(orgId, userId, dto);
  }

  // --- members --------------------------------------------------------

  @Get(':orgId/members')
  @ApiOperation({ summary: 'Members with month-to-date spend against their cap' })
  members(@CurrentUser('id') userId: string, @Param('orgId') orgId: string) {
    return this.orgs.members(orgId, userId);
  }

  @Post(':orgId/members')
  @Audit('CREATE', 'OrgMember')
  invite(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.orgs.inviteMember(orgId, userId, dto);
  }

  @Patch(':orgId/members/:memberId')
  @Audit('UPDATE', 'OrgMember')
  updateMember(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.orgs.updateMember(orgId, userId, memberId, dto);
  }

  @Delete(':orgId/members/:memberId')
  @Audit('DELETE', 'OrgMember')
  removeMember(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.orgs.removeMember(orgId, userId, memberId);
  }

  // --- departments ----------------------------------------------------

  @Get(':orgId/departments')
  departments(@CurrentUser('id') userId: string, @Param('orgId') orgId: string) {
    return this.orgs.departments(orgId, userId);
  }

  @Post(':orgId/departments')
  @Audit('CREATE', 'Department')
  createDepartment(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.orgs.createDepartment(orgId, userId, dto);
  }

  @Patch(':orgId/departments/:id')
  @Audit('UPDATE', 'Department')
  updateDepartment(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.orgs.updateDepartment(orgId, userId, id, dto);
  }

  @Delete(':orgId/departments/:id')
  @Audit('DELETE', 'Department')
  removeDepartment(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.orgs.removeDepartment(orgId, userId, id);
  }

  // --- vendors --------------------------------------------------------

  @Get(':orgId/vendors')
  @ApiOperation({ summary: 'Vendors with spend share and outstanding payables' })
  vendors(@CurrentUser('id') userId: string, @Param('orgId') orgId: string) {
    return this.orgs.vendors(orgId, userId);
  }

  @Post(':orgId/vendors')
  @Audit('CREATE', 'Vendor')
  createVendor(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: CreateVendorDto,
  ) {
    return this.orgs.createVendor(orgId, userId, dto);
  }

  @Patch(':orgId/vendors/:id')
  @Audit('UPDATE', 'Vendor')
  updateVendor(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return this.orgs.updateVendor(orgId, userId, id, dto);
  }

  @Delete(':orgId/vendors/:id')
  @Audit('DELETE', 'Vendor')
  removeVendor(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.orgs.removeVendor(orgId, userId, id);
  }

  // --- projects -------------------------------------------------------

  @Get(':orgId/projects')
  projects(@CurrentUser('id') userId: string, @Param('orgId') orgId: string) {
    return this.orgs.projects(orgId, userId);
  }

  @Post(':orgId/projects')
  @Audit('CREATE', 'Project')
  createProject(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.orgs.createProject(orgId, userId, dto);
  }

  @Patch(':orgId/projects/:id')
  @Audit('UPDATE', 'Project')
  updateProject(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.orgs.updateProject(orgId, userId, id, dto);
  }

  @Delete(':orgId/projects/:id')
  @Audit('DELETE', 'Project')
  removeProject(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.orgs.removeProject(orgId, userId, id);
  }
}
