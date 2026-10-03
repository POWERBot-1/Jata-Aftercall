/**
 * Receipts (§32, §62)
 *
 * Digital-first, generated from the recorded sale — never a second copy of the truth. The
 * configuration decides what appears: tax only where tax is on, a credit balance only where
 * credit is on, the cashier only where the business wants a name on the slip.
 */

import { resolveTerminology } from "./terminology";
import { hasCapability } from "./capabilities";
import type { PosConfiguration, ReceiptDocument } from "./types";

export type ReceiptSale = {
  receiptNumber: string;
  issuedAt: Date | string;
  channel?: string | null;
  cashierName?: string | null;
  customer?: { name?: string | null; phone?: string | null; number?: string | null } | null;
  lines: { name: string; quantity: number; unitKey?: string | null; unitPriceKES: number; discountKES: number; taxKES?: number; totalKES: number }[];
  subtotalKES: number;
  discountKES: number;
  taxKES: number;
  totalKES: number;
  payments: { method: string; amountKES: number; reference?: string | null }[];
  balanceKES: number;
  creditBalanceKES?: number | null;
};

export type ReceiptBusiness = {
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  location?: string | null;
  logoUrl?: string | null;
  email?: string | null;
};

const CHANNEL_LABELS: Record<string, string> = {
  walk_in: "Walk-in",
  phone: "Phone",
  whatsapp: "WhatsApp",
  business_page: "JATA business page",
  online: "Online",
  staff: "Staff",
  delivery: "Delivery",
  other: "Other",
};

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return "";
  return CHANNEL_LABELS[channel] ?? String(channel);
}

/** Receipt numbers are per business and human-readable: NK-000123 (§32). */
export function formatReceiptNumber(prefix: string, sequence: number): string {
  const clean = (prefix || "JATA").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "JATA";
  const padded = String(Math.max(1, Math.floor(Number(sequence) || 1))).padStart(6, "0");
  return `${clean}-${padded}`;
}

export function receiptPrefixFromBusinessName(name: string): string {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "JATA";
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function buildReceipt(params: {
  config: PosConfiguration;
  business: ReceiptBusiness;
  sale: ReceiptSale;
}): ReceiptDocument {
  const { config, business, sale } = params;
  const receipt = config.receipt;
  const terminology = resolveTerminology(config);
  const contact: string[] = [];
  if (receipt.showContact) {
    if (business.phone) contact.push(business.phone);
    if (business.location) contact.push(business.location);
    if (business.email && contact.length < 2) contact.push(business.email);
  }
  const showTax = receipt.showTaxBreakdown && sale.taxKES > 0;
  const showCredit = receipt.showCreditBalance && hasCapability(config, "customer_credit") && (sale.creditBalanceKES ?? 0) > 0;
  return {
    businessName: receipt.businessName?.trim() || business.name,
    tagline: `${terminology.sale} receipt`,
    contact,
    receiptNumber: sale.receiptNumber,
    issuedAt: new Date(sale.issuedAt).toISOString(),
    cashier: receipt.showCashier ? sale.cashierName ?? undefined : undefined,
    customer: sale.customer?.name
      ? {
          name: sale.customer.name,
          phone: config.customers.fields.phone ? sale.customer.phone ?? undefined : undefined,
          number: config.customers.fields.customerNumber ? sale.customer.number ?? undefined : undefined,
        }
      : undefined,
    lines: sale.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unit: line.unitKey ?? undefined,
      unitPriceKES: line.unitPriceKES,
      discountKES: line.discountKES,
      totalKES: line.totalKES,
    })),
    subtotalKES: sale.subtotalKES,
    discountKES: sale.discountKES,
    taxLabel: showTax ? config.sales.tax.label || "Tax" : undefined,
    taxKES: showTax ? sale.taxKES : 0,
    totalKES: sale.totalKES,
    payments: sale.payments.map((payment) => ({
      method: paymentMethodLabel(payment.method, config),
      amountKES: payment.amountKES,
      reference: payment.reference ?? undefined,
    })),
    balanceKES: receipt.showBalance ? sale.balanceKES : 0,
    creditBalanceKES: showCredit ? sale.creditBalanceKES ?? 0 : undefined,
    footerMessage: receipt.footerMessage || "Thank you — karibu tena.",
    channel: sale.channel ? channelLabel(sale.channel) : undefined,
  };
}

export function paymentMethodLabel(method: string, config: PosConfiguration): string {
  const key = (method || "").trim().toLowerCase();
  const labels: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", bank: "Bank transfer", card: "Card", credit: "Credit" };
  if (labels[key]) return labels[key];
  const custom = config.payments.otherLabels.find((label) => label.toLowerCase() === key);
  return custom ?? (method || "Payment");
}

/**
 * Plain-text receipt for WhatsApp, SMS and printing (§32: designed for easy sharing through
 * supported channels). Widths are deliberately narrow for a phone screen and a 58mm printer.
 */
export function receiptToText(document: ReceiptDocument): string {
  const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;
  const lines: string[] = [];
  lines.push(document.businessName.toUpperCase());
  if (document.contact?.length) lines.push(document.contact.join(" · "));
  lines.push("");
  lines.push(`${document.tagline ?? "Receipt"} ${document.receiptNumber}`);
  lines.push(new Date(document.issuedAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }));
  if (document.cashier) lines.push(`Served by ${document.cashier}`);
  if (document.channel) lines.push(`Channel: ${document.channel}`);
  if (document.customer) {
    lines.push("");
    lines.push(document.customer.name);
    if (document.customer.phone) lines.push(document.customer.phone);
    if (document.customer.number) lines.push(`No. ${document.customer.number}`);
  }
  lines.push("");
  lines.push("─".repeat(32));
  for (const line of document.lines) {
    const quantity = `${line.quantity}${line.unit ? ` ${line.unit}` : ""}`;
    lines.push(`${line.name}`);
    lines.push(`  ${quantity} × ${money(line.unitPriceKES)}${line.discountKES ? ` − ${money(line.discountKES)}` : ""}`);
    lines.push(`  ${money(line.totalKES)}`);
  }
  lines.push("─".repeat(32));
  lines.push(`Subtotal ${money(document.subtotalKES)}`);
  if (document.discountKES > 0) lines.push(`Discount − ${money(document.discountKES)}`);
  if (document.taxLabel && document.taxKES > 0) lines.push(`${document.taxLabel} ${money(document.taxKES)}`);
  lines.push(`TOTAL ${money(document.totalKES)}`);
  lines.push("");
  for (const payment of document.payments) {
    lines.push(`${payment.method} ${money(payment.amountKES)}${payment.reference ? ` (${payment.reference})` : ""}`);
  }
  if (document.balanceKES > 0) lines.push(`Balance due ${money(document.balanceKES)}`);
  if (document.creditBalanceKES && document.creditBalanceKES > 0) {
    lines.push(`Account balance ${money(document.creditBalanceKES)}`);
  }
  lines.push("");
  if (document.footerMessage) lines.push(document.footerMessage);
  return lines.join("\n");
}

/** Share text for WhatsApp/SMS — a short summary plus the receipt body (§32). */
export function receiptShareText(document: ReceiptDocument): string {
  return receiptToText(document);
}
