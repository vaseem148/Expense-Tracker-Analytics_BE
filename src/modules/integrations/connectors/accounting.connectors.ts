import axios from 'axios';
import {
  ConnectionTest,
  Connector,
  ConnectorContext,
  ExternalTransaction,
  PullResult,
  PushResult,
} from './connector.interface';
import { sandboxTransactions } from './sandbox';

/**
 * Tally is on-premise and speaks XML over a local HTTP port, so the connector
 * targets the gateway address the company configures rather than a cloud API.
 */
export class TallyConnector implements Connector {
  readonly provider = 'TALLY';
  readonly displayName = 'Tally Prime';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['PULL', 'PUSH'];
  readonly requiredCredentials = [
    { key: 'gatewayUrl', label: 'Tally gateway URL', secret: false },
    { key: 'companyName', label: 'Company name in Tally', secret: false },
  ];
  readonly configSchema = [
    { key: 'expenseLedger', label: 'Default expense ledger', type: 'string' as const },
    { key: 'voucherType', label: 'Voucher type', type: 'string' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    if (ctx.mode === 'SANDBOX') {
      return {
        ok: true,
        message: 'Sandbox gateway reachable',
        details: { company: ctx.credentials.companyName },
      };
    }
    try {
      await axios.post(
        ctx.credentials.gatewayUrl,
        '<ENVELOPE><HEADER><VERSION>1</VERSION></HEADER></ENVELOPE>',
        { timeout: 5000, headers: { 'Content-Type': 'text/xml' } },
      );
      return { ok: true, message: 'Tally gateway responded' };
    } catch (err) {
      return { ok: false, message: `Gateway unreachable: ${(err as Error).message}` };
    }
  }

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    if (ctx.mode === 'SANDBOX') {
      return {
        transactions: sandboxTransactions('tally', 14),
        cursor: new Date().toISOString(),
        hasMore: false,
      };
    }
    // A LIVE pull needs the customer to expose their gateway; without one we
    // report an empty page rather than pretending the sync succeeded.
    return { transactions: [], cursor: ctx.cursor ?? null, hasMore: false };
  }

  async push(ctx: ConnectorContext, transactions: ExternalTransaction[]): Promise<PushResult> {
    if (ctx.mode === 'SANDBOX') {
      return { pushed: transactions.length, failed: 0, messages: ['Sandbox: vouchers accepted'] };
    }
    return {
      pushed: 0,
      failed: transactions.length,
      messages: ['LIVE push requires a configured gateway'],
    };
  }
}

export class ZohoBooksConnector implements Connector {
  readonly provider = 'ZOHO_BOOKS';
  readonly displayName = 'Zoho Books';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['PULL', 'PUSH'];
  readonly requiredCredentials = [
    { key: 'clientId', label: 'Client ID', secret: false },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true },
    { key: 'organizationId', label: 'Zoho organization ID', secret: false },
  ];
  readonly configSchema = [
    { key: 'region', label: 'Data centre (in/com/eu)', type: 'string' as const },
    { key: 'accountId', label: 'Default expense account', type: 'string' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    if (ctx.mode === 'SANDBOX') {
      return {
        ok: true,
        message: 'Sandbox credentials accepted',
        details: { org: ctx.credentials.organizationId },
      };
    }
    if (!ctx.credentials.refreshToken) return { ok: false, message: 'Refresh token missing' };
    return { ok: true, message: 'Credentials present - token exchange happens on first sync' };
  }

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    if (ctx.mode === 'SANDBOX') {
      return {
        transactions: sandboxTransactions('zoho', 16),
        cursor: new Date().toISOString(),
        hasMore: false,
      };
    }
    return { transactions: [], cursor: ctx.cursor ?? null, hasMore: false };
  }

  async push(ctx: ConnectorContext, transactions: ExternalTransaction[]): Promise<PushResult> {
    return ctx.mode === 'SANDBOX'
      ? { pushed: transactions.length, failed: 0, messages: ['Sandbox: expenses created in Zoho Books'] }
      : { pushed: 0, failed: transactions.length, messages: ['LIVE push needs an OAuth token exchange'] };
  }
}

export class QuickBooksConnector implements Connector {
  readonly provider = 'QUICKBOOKS';
  readonly displayName = 'QuickBooks Online';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['PULL', 'PUSH'];
  readonly requiredCredentials = [
    { key: 'clientId', label: 'Client ID', secret: false },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'realmId', label: 'Company (realm) ID', secret: false },
    { key: 'refreshToken', label: 'Refresh token', secret: true },
  ];
  readonly configSchema = [
    { key: 'environment', label: 'sandbox | production', type: 'string' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    return ctx.credentials.realmId
      ? { ok: true, message: 'Realm configured', details: { realmId: ctx.credentials.realmId } }
      : { ok: false, message: 'Realm ID is required' };
  }

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    return {
      transactions: ctx.mode === 'SANDBOX' ? sandboxTransactions('qbo', 10) : [],
      cursor: new Date().toISOString(),
      hasMore: false,
    };
  }
}

export class XeroConnector implements Connector {
  readonly provider = 'XERO';
  readonly displayName = 'Xero';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['PULL'];
  readonly requiredCredentials = [
    { key: 'clientId', label: 'Client ID', secret: false },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'tenantId', label: 'Tenant ID', secret: false },
  ];
  readonly configSchema = [
    { key: 'trackingCategory', label: 'Tracking category', type: 'string' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    return ctx.credentials.tenantId
      ? { ok: true, message: 'Tenant configured' }
      : { ok: false, message: 'Tenant ID is required' };
  }

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    return {
      transactions: ctx.mode === 'SANDBOX' ? sandboxTransactions('xero', 11) : [],
      cursor: new Date().toISOString(),
      hasMore: false,
    };
  }
}
