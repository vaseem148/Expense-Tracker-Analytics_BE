import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateInvoiceDto, PayInvoiceDto, UpdateInvoiceDto } from './dto/vendor.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('business')
@ApiBearerAuth()
@Controller('orgs/:orgId/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'Accounts payable with aging buckets' })
  list(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Query('status') status?: string,
  ) {
    return this.invoices.list(orgId, userId, status);
  }

  @Post()
  @Audit('CREATE', 'Invoice')
  create(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoices.create(orgId, userId, dto);
  }

  @Patch(':id')
  @Audit('UPDATE', 'Invoice')
  update(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoices.update(orgId, userId, id, dto);
  }

  @Post(':id/pay')
  @Audit('UPDATE', 'Invoice')
  @ApiOperation({ summary: 'Record a payment and post the matching ledger entry' })
  pay(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: PayInvoiceDto,
  ) {
    return this.invoices.pay(orgId, userId, id, dto);
  }

  @Delete(':id')
  @Audit('DELETE', 'Invoice')
  @ApiOperation({ summary: 'Void an invoice (never hard-deleted)' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.invoices.remove(orgId, userId, id);
  }
}
