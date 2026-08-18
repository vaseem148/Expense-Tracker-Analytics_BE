import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';
import { RecurringService } from './recurring.service';

@ApiTags('recurring')
@ApiBearerAuth()
@Controller('recurring')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  @ApiOperation({ summary: 'Recurring rules with annualised commitment totals' })
  findAll(@CurrentUser('id') userId: string) {
    return this.recurring.findAll(userId);
  }

  @Post()
  @Audit('CREATE', 'RecurringRule')
  create(@CurrentUser('id') userId: string, @Body() dto: CreateRecurringDto) {
    return this.recurring.create(userId, dto);
  }

  @Patch(':id')
  @Audit('UPDATE', 'RecurringRule')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringDto,
  ) {
    return this.recurring.update(userId, id, dto);
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Post this rule now instead of waiting for the scheduler' })
  runNow(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.recurring.runNow(userId, id);
  }

  @Delete(':id')
  @Audit('DELETE', 'RecurringRule')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.recurring.remove(userId, id);
  }
}
