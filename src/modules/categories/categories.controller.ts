import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CATEGORY_KINDS, CategoryKind } from 'src/common/types/domain.types';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiQuery({ name: 'kind', enum: CATEGORY_KINDS, required: false })
  @ApiOperation({ summary: 'Flat category list with usage counts' })
  findAll(@CurrentUser('id') userId: string, @Query('kind') kind?: CategoryKind) {
    return this.categories.findAll(userId, kind);
  }

  @Get('tree')
  @ApiOperation({ summary: 'Categories nested under their parents' })
  findTree(@CurrentUser('id') userId: string, @Query('kind') kind?: CategoryKind) {
    return this.categories.findTree(userId, kind);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.categories.findOne(userId, id);
  }

  @Post()
  @Audit('CREATE', 'Category')
  create(@CurrentUser('id') userId: string, @Body() dto: CreateCategoryDto) {
    return this.categories.create(userId, dto);
  }

  @Patch(':id')
  @Audit('UPDATE', 'Category')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(userId, id, dto);
  }

  @Delete(':id')
  @Audit('DELETE', 'Category')
  @ApiQuery({ name: 'reassignTo', required: false, description: 'Move existing transactions here' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('reassignTo') reassignTo?: string,
  ) {
    return this.categories.remove(userId, id, reassignTo);
  }
}
