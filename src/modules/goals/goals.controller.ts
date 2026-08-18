import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ContributeDto, CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('goals')
@ApiBearerAuth()
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'Savings goals with progress and required monthly contribution' })
  findAll(@CurrentUser('id') userId: string) {
    return this.goals.findAll(userId);
  }

  @Post()
  @Audit('CREATE', 'SavingsGoal')
  create(@CurrentUser('id') userId: string, @Body() dto: CreateGoalDto) {
    return this.goals.create(userId, dto);
  }

  @Patch(':id')
  @Audit('UPDATE', 'SavingsGoal')
  update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateGoalDto) {
    return this.goals.update(userId, id, dto);
  }

  @Post(':id/contribute')
  @ApiOperation({ summary: 'Add to (or withdraw from) a goal' })
  contribute(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ContributeDto,
  ) {
    return this.goals.contribute(userId, id, dto.amount);
  }

  @Delete(':id')
  @Audit('DELETE', 'SavingsGoal')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.goals.remove(userId, id);
  }
}
