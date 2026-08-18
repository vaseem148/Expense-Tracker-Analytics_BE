import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UpdateProfileDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Full profile with entity counts' })
  me(@CurrentUser('id') userId: string) {
    return this.users.profile(userId);
  }

  @Patch('me')
  @Audit('UPDATE', 'User')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(userId, dto);
  }

  @Delete('me')
  @Audit('DELETE', 'User')
  @ApiOperation({ summary: 'Permanently delete the account and all its data' })
  deleteMe(@CurrentUser('id') userId: string) {
    return this.users.deleteAccount(userId);
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'ADMIN - list every user' })
  listAll() {
    return this.users.listAll();
  }

  @Patch(':id/active')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'ADMIN - activate or deactivate a user' })
  setActive(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.users.setActive(id, isActive);
  }
}
