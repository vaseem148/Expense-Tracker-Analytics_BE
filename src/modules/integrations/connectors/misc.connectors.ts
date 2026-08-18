import axios from 'axios';
import {
  ConnectionTest,
  Connector,
  ConnectorContext,
  ExternalTransaction,
  PullResult,
} from './connector.interface';
import { sandboxTransactions } from './sandbox';

/** Open-banking style feed: the company connects a bank account, we read it. */
export class BankFeedConnector implements Connector {
  readonly provider = 'BANK_FEED';
  readonly displayName = 'Bank feed (open banking)';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['PULL'];
  readonly requiredCredentials = [
    { key: 'apiKey', label: 'Aggregator API key', secret: true },
    { key: 'accountRef', label: 'Bank account reference', secret: false },
  ];
  readonly configSchema = [
    { key: 'bankName', label: 'Bank name', type: 'string' as const },
    { key: 'lookbackDays', label: 'Days to fetch per sync', type: 'number' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    return ctx.credentials.apiKey
      ? { ok: true, message: `Feed ready for ${ctx.config.bankName ?? 'account'}` }
      : { ok: false, message: 'Aggregator API key is required' };
  }

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    return {
      transactions: ctx.mode === 'SANDBOX' ? sandboxTransactions('bank', 20) : [],
      cursor: new Date().toISOString(),
      hasMore: false,
    };
  }
}

/** Outbound only: budget breaches and approvals land in a Slack channel. */
export class SlackConnector implements Connector {
  readonly provider = 'SLACK';
  readonly displayName = 'Slack';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['NOTIFY'];
  readonly requiredCredentials = [
    { key: 'webhookUrl', label: 'Incoming webhook URL', secret: true },
  ];
  readonly configSchema = [
    { key: 'channel', label: 'Channel', type: 'string' as const },
    { key: 'mentionOnBreach', label: 'Mention channel on budget breach', type: 'boolean' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    if (!ctx.credentials.webhookUrl) return { ok: false, message: 'Webhook URL is required' };
    if (ctx.mode === 'SANDBOX') return { ok: true, message: 'Sandbox: message would be delivered' };
    return this.notify(ctx, { title: 'Connection test', body: 'Expense Analytics is now connected.' })
      .then((ok) => ({ ok, message: ok ? 'Test message delivered' : 'Slack rejected the message' }));
  }

  async notify(ctx: ConnectorContext, message: { title: string; body: string }): Promise<boolean> {
    if (ctx.mode === 'SANDBOX') return true;
    try {
      await axios.post(
        ctx.credentials.webhookUrl,
        {
          text: `*${message.title}*\n${message.body}`,
          ...(ctx.config.channel ? { channel: ctx.config.channel } : {}),
        },
        { timeout: 5000 },
      );
      return true;
    } catch {
      return false;
    }
  }
}

/** Generic HTTP sink so a company can wire us into anything they already run. */
export class WebhookConnector implements Connector {
  readonly provider = 'WEBHOOK';
  readonly displayName = 'Generic webhook';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['NOTIFY'];
  readonly requiredCredentials = [{ key: 'url', label: 'Endpoint URL', secret: false }];
  readonly configSchema = [
    { key: 'signingSecret', label: 'HMAC signing secret', type: 'string' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    return ctx.credentials.url?.startsWith('http')
      ? { ok: true, message: 'Endpoint accepted' }
      : { ok: false, message: 'A valid http(s) URL is required' };
  }

  async notify(ctx: ConnectorContext, message: { title: string; body: string }): Promise<boolean> {
    if (ctx.mode === 'SANDBOX') return true;
    try {
      await axios.post(ctx.credentials.url, { event: 'notification', ...message }, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

/** Payment gateways: settlements come in as INCOME rows. */
export class RazorpayConnector implements Connector {
  readonly provider = 'RAZORPAY';
  readonly displayName = 'Razorpay';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['PULL'];
  readonly requiredCredentials = [
    { key: 'keyId', label: 'Key ID', secret: false },
    { key: 'keySecret', label: 'Key secret', secret: true },
  ];
  readonly configSchema = [
    { key: 'settlementAccount', label: 'Settlement account name', type: 'string' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    return ctx.credentials.keyId
      ? { ok: true, message: 'Key pair stored' }
      : { ok: false, message: 'Key ID is required' };
  }

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    if (ctx.mode !== 'SANDBOX') {
      return { transactions: [], cursor: ctx.cursor ?? null, hasMore: false };
    }
    // Settlements are inflow, so flip the sandbox rows to INCOME.
    const rows = sandboxTransactions('razorpay', 8).map((t): ExternalTransaction => ({
      ...t,
      type: 'INCOME' as const,
      description: 'Customer settlement',
      merchant: 'Razorpay',
      vendorName: undefined,
    }));
    return { transactions: rows, cursor: new Date().toISOString(), hasMore: false };
  }
}

/** Google Sheets: finance teams still live here, so make it first class. */
export class GoogleSheetsConnector implements Connector {
  readonly provider = 'GOOGLE_SHEETS';
  readonly displayName = 'Google Sheets';
  readonly capabilities: ('PULL' | 'PUSH' | 'NOTIFY')[] = ['PULL', 'PUSH'];
  readonly requiredCredentials = [
    { key: 'serviceAccountJson', label: 'Service account JSON', secret: true },
    { key: 'spreadsheetId', label: 'Spreadsheet ID', secret: false },
  ];
  readonly configSchema = [
    { key: 'sheetName', label: 'Sheet/tab name', type: 'string' as const },
    { key: 'headerRow', label: 'Header row number', type: 'number' as const },
  ];

  async test(ctx: ConnectorContext): Promise<ConnectionTest> {
    return ctx.credentials.spreadsheetId
      ? { ok: true, message: 'Spreadsheet reference stored' }
      : { ok: false, message: 'Spreadsheet ID is required' };
  }

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    return {
      transactions: ctx.mode === 'SANDBOX' ? sandboxTransactions('sheets', 9) : [],
      cursor: new Date().toISOString(),
      hasMore: false,
    };
  }
}
