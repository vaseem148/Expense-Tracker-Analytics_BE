import { Connector } from './connector.interface';
import {
  QuickBooksConnector,
  TallyConnector,
  XeroConnector,
  ZohoBooksConnector,
} from './accounting.connectors';
import {
  BankFeedConnector,
  GoogleSheetsConnector,
  RazorpayConnector,
  SlackConnector,
  WebhookConnector,
} from './misc.connectors';

const ALL: Connector[] = [
  new TallyConnector(),
  new ZohoBooksConnector(),
  new QuickBooksConnector(),
  new XeroConnector(),
  new BankFeedConnector(),
  new RazorpayConnector(),
  new GoogleSheetsConnector(),
  new SlackConnector(),
  new WebhookConnector(),
];

export const CONNECTORS = new Map(ALL.map((c) => [c.provider, c]));

export function getConnector(provider: string): Connector | undefined {
  return CONNECTORS.get(provider);
}

/** Catalogue for the UI: what exists, what it needs, what it can do. */
export function catalogue() {
  return ALL.map((c) => ({
    provider: c.provider,
    displayName: c.displayName,
    capabilities: c.capabilities,
    requiredCredentials: c.requiredCredentials,
    configSchema: c.configSchema,
    category: categorise(c.provider),
  }));
}

function categorise(provider: string): string {
  if (['TALLY', 'ZOHO_BOOKS', 'QUICKBOOKS', 'XERO', 'SAP'].includes(provider)) return 'Accounting & ERP';
  if (['BANK_FEED', 'RAZORPAY', 'STRIPE'].includes(provider)) return 'Banking & Payments';
  if (['SLACK', 'WEBHOOK'].includes(provider)) return 'Alerts & Automation';
  return 'Productivity';
}
