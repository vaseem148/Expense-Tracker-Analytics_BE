import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

@ApiTags('budgets')
@ApiBearerAuth()
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'Budgets with live consumption, pace and projection' })
  findAll(@CurrentUser('id') userId: string) {
    return this.budgets.findAll(userId);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.budgets.findOne(userId, id);
  }

  @Post()
  @Audit('CREATE', 'Budget')
  create(@CurrentUser('id') userId: string, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(userId, dto);
  }

  @Patch(':id')
  @Audit('UPDATE', 'Budget')
  update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    return this.budgets.update(userId, id, dto);
  }

  @Delete(':id')
  @Audit('DELETE', 'Budget')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.budgets.remove(userId, id);
  }
}
