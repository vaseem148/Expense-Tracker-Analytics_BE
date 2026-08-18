import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Audit } from 'src/common/decorators/audit.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { raw } from 'src/common/interceptors/transform.interceptor';
import { parseDate } from 'src/common/utils/date';
import { ImportCsvDto, PreviewCsvDto } from './dto/import.dto';
import { ImportExportService } from './importexport.service';

@ApiTags('import-export')
@ApiBearerAuth()
@Controller('data')
export class ImportExportController {
  constructor(private readonly service: ImportExportService) {}

  @Post('import/preview')
  @ApiOperation({ summary: 'Sniff headers and suggest a column mapping' })
  preview(@Body() dto: PreviewCsvDto) {
    return this.service.preview(dto.csv);
  }

  @Post('import')
  @Audit('IMPORT', 'Transaction')
  @ApiOperation({ summary: 'Import a CSV with mapping, dedupe and auto-categorisation' })
  import(@CurrentUser('id') userId: string, @Body() dto: ImportCsvDto) {
    return this.service.importCsv(userId, dto);
  }

  @Get('import/batches')
  @ApiOperation({ summary: 'Past import batches (undo targets)' })
  batches(@CurrentUser('id') userId: string) {
    return this.service.batches(userId);
  }

  @Delete('import/:batchId')
  @Audit('DELETE', 'Transaction')
  @ApiOperation({ summary: 'Undo an entire import batch' })
  undo(@CurrentUser('id') userId: string, @Param('batchId') batchId: string) {
    return this.service.undoImport(userId, batchId);
  }

  @Get('export/csv')
  @Audit('EXPORT', 'Transaction')
  @ApiOperation({ summary: 'Download the ledger as CSV' })
  async exportCsv(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.service.exportCsv(
      userId,
      parseDate(from) ?? undefined,
      parseDate(to) ?? undefined,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="expenses-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return raw(csv);
  }

  @Get('export/json')
  @Audit('EXPORT', 'User')
  @ApiOperation({ summary: 'Full portable JSON backup' })
  exportJson(@CurrentUser('id') userId: string) {
    return this.service.exportJson(userId);
  }
}
