export interface ConnectorContext {
  orgId?: string | null;
  userId: string;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
  mode: 'SANDBOX' | 'LIVE';
  cursor?: string | null;
}

export interface ExternalTransaction {
  externalId: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
  merchant?: string;
  type: 'EXPENSE' | 'INCOME';
  taxAmount?: number;
  taxRatePct?: number;
  vendorName?: string;
  reference?: string;
}

export interface PullResult {
  transactions: ExternalTransaction[];
  cursor?: string | null;
  hasMore: boolean;
}

export interface PushResult {
  pushed: number;
  failed: number;
  messages: string[];
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Every external system is reduced to the same four verbs. Adding a new ERP
 * means implementing this interface - nothing else in the codebase changes.
 */
export interface Connector {
  readonly provider: string;
  readonly displayName: string;
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[];
  readonly requiredCredentials: { key: string; label: string; secret: boolean }[];
  readonly configSchema: { key: string; label: string; type: 'string' | 'number' | 'boolean' }[];

  test(ctx: ConnectorContext): Promise<ConnectionTest>;
  pull?(ctx: ConnectorContext): Promise<PullResult>;
  push?(ctx: ConnectorContext, transactions: ExternalTransaction[]): Promise<PushResult>;
  notify?(ctx: ConnectorContext, message: { title: string; body: string }): Promise<boolean>;
}
