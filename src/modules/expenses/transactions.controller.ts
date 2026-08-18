import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import {
  BulkCategorizeDto,
  BulkDeleteDto,
  CreateTransactionDto,
  UpdateTransactionDto,
} from './dto/transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Filter, search, sort and paginate the ledger' })
  findAll(@CurrentUser('id') userId: string, @Query() query: QueryTransactionDto) {
    return this.transactions.findAll(userId, query);
  }

  @Get('merchants')
  @ApiOperation({ summary: 'Merchant leaderboard by total spend' })
  merchants(@CurrentUser('id') userId: string, @Query('limit') limit?: string) {
    return this.transactions.merchants(userId, limit ? parseInt(limit, 10) : 25);
  }

  @Get('tags')
  tags(@CurrentUser('id') userId: string) {
    return this.transactions.tags(userId);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.transactions.findOne(userId, id);
  }

  @Post()
  @Audit('CREATE', 'Transaction')
  @ApiOperation({ summary: 'Record an expense, income or transfer' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateTransactionDto) {
    return this.transactions.create(userId, dto);
  }

  @Patch('bulk/categorize')
  @Audit('UPDATE', 'Transaction')
  @ApiOperation({ summary: 'Re-categorise many transactions at once' })
  bulkCategorize(@CurrentUser('id') userId: string, @Body() dto: BulkCategorizeDto) {
    return this.transactions.bulkCategorize(userId, dto);
  }

  @Post('bulk/delete')
  @Audit('DELETE', 'Transaction')
  bulkDelete(@CurrentUser('id') userId: string, @Body() dto: BulkDeleteDto) {
    return this.transactions.bulkDelete(userId, dto);
  }

  @Patch(':id')
  @Audit('UPDATE', 'Transaction')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.transactions.update(userId, id, dto);
  }

  @Post(':id/restore')
  @Audit('UPDATE', 'Transaction')
  restore(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.transactions.restore(userId, id);
  }

  @Delete(':id')
  @Audit('DELETE', 'Transaction')
  @ApiOperation({ summary: 'Soft-delete (restorable)' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.transactions.remove(userId, id);
  }
}
