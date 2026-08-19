import { Global, Module } from '@nestjs/common';
import { OrgContextService } from './org-context.service';

@Global()
@Module({ providers: [OrgContextService], exports: [OrgContextService] })
export class OrgContextModule {}
