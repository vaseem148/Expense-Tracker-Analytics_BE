import { Module } from '@nestjs/common';
import { ImportExportController } from './importexport.controller';
import { ImportExportService } from './importexport.service';

@Module({
  controllers: [ImportExportController],
  providers: [ImportExportService],
  exports: [ImportExportService],
})
export class ImportExportModule {}
