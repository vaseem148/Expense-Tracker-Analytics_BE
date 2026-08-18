import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMeta {
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'IMPORT' | 'EXPORT';
  entity: string;
}

/** Mark a handler so the AuditInterceptor records it after a successful run. */
export const Audit = (action: AuditMeta['action'], entity: string) =>
  SetMetadata(AUDIT_KEY, { action, entity } satisfies AuditMeta);
