import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiOperation({ summary: 'Accounts with derived live balances' })
  findAll(
    @CurrentUser('id') userId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.accounts.findAll(userId, includeArchived === 'true');
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.accounts.findOne(userId, id);
  }

  @Post()
  @Audit('CREATE', 'Account')
  create(@CurrentUser('id') userId: string, @Body() dto: CreateAccountDto) {
    return this.accounts.create(userId, dto);
  }

  @Patch(':id')
  @Audit('UPDATE', 'Account')
  update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(userId, id, dto);
  }

  @Delete(':id')
  @Audit('DELETE', 'Account')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.accounts.remove(userId, id);
  }
}
