import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ClaimsService } from './claims.service';
import { CreateClaimDto, DecideClaimDto, ReimburseClaimDto, UpdateClaimDto } from './dto/claim.dto';

@ApiTags('business')
@ApiBearerAuth()
@Controller('orgs/:orgId/claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @ApiOperation({ summary: 'Claims visible to the caller, plus pipeline totals' })
  list(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query('status') status?: string,
  ) {
    return this.claims.list(orgId, userId, status);
  }

  @Get(':id')
  findOne(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.claims.findOne(orgId, userId, id);
  }

  @Post()
  @Audit('CREATE', 'ExpenseClaim')
  create(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: CreateClaimDto,
  ) {
    return this.claims.create(orgId, userId, dto);
  }

  @Patch(':id')
  @Audit('UPDATE', 'ExpenseClaim')
  update(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClaimDto,
  ) {
    return this.claims.update(orgId, userId, id, dto);
  }

  @Post(':id/submit')
  @Audit('UPDATE', 'ExpenseClaim')
  @ApiOperation({ summary: 'Submit for approval; evaluates org policies' })
  submit(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.claims.submit(orgId, userId, id);
  }

  @Post(':id/approve')
  @Audit('UPDATE', 'ExpenseClaim')
  @ApiOperation({ summary: 'MANAGER+ approves (never your own claim)' })
  approve(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: DecideClaimDto,
  ) {
    return this.claims.approve(orgId, userId, id, dto);
  }

  @Post(':id/reject')
  @Audit('UPDATE', 'ExpenseClaim')
  reject(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: DecideClaimDto,
  ) {
    return this.claims.reject(orgId, userId, id, dto);
  }

  @Post(':id/reimburse')
  @Audit('UPDATE', 'ExpenseClaim')
  @ApiOperation({ summary: 'FINANCE+ marks the claim as paid out' })
  reimburse(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: ReimburseClaimDto,
  ) {
    return this.claims.reimburse(orgId, userId, id, dto);
  }

  @Delete(':id')
  @Audit('DELETE', 'ExpenseClaim')
  remove(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.claims.remove(orgId, userId, id);
  }
}
