/**
 * Message templates and rendering
 *
 * Variables are a whitelist, not arbitrary string interpolation: a customer name must never be
 * able to inject a different link or a second call to action. Unknown variables are rejected,
 * missing values fall back to something human, and URLs are validated as absolute HTTPS before a
 * message is queued.
 */

import { calculateSegments, type SegmentSummary } from "./segments";

export type TemplateVariable =
  | "name"
  | "first_name"
  | "business"
  | "invoice_number"
  | "receipt_number"
  | "order_number"
  | "amount"
  | "due_date"
  | "balance"
  | "link"
  | "unsubscribe_link";

export const ALLOWED_VARIABLES: TemplateVariable[] = [
  "name",
  "first_name",
  "business",
  "invoice_number",
  "receipt_number",
  "order_number",
  "amount",
  "due_date",
  "balance",
  "link",
  "unsubscribe_link",
];

export const VARIABLE_FALLBACKS: Record<TemplateVariable, string> = {
  name: "customer",
  first_name: "customer",
  business: "your business",
  invoice_number: "your invoice",
  receipt_number: "your receipt",
  order_number: "your order",
  amount: "the amount",
  due_date: "the due date",
  balance: "your balance",
  link: "https://example.com",
  unsubscribe_link: "https://example.com/unsubscribe",
};

export const VARIABLE_LABELS: Record<TemplateVariable, string> = {
  name: "Customer name",
  first_name: "First name",
  business: "Business name",
  invoice_number: "Invoice number",
  receipt_number: "Receipt number",
  order_number: "Order number",
  amount: "Amount",
  due_date: "Due date",
  balance: "Balance",
  link: "Secure link",
  unsubscribe_link: "Unsubscribe link",
};

/** Variables that are rendered inside a URL, and must therefore be controlled by the platform. */
const LINK_VARIABLES: TemplateVariable[] = ["link", "unsubscribe_link"];

export type TemplateValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  variables: TemplateVariable[];
  segments: SegmentSummary;
  unknownVariables: string[];
};

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(VARIABLE_PATTERN.source, "g");
  while ((match = pattern.exec(String(body ?? ""))) !== null) found.add(match[1]);
  return [...found];
}

export function validateTemplate(input: {
  body: string;
  channel: "SMS" | "WHATSAPP" | "EMAIL";
  category: "TRANSACTIONAL" | "MARKETING";
  whatsappTemplateStatus?: string | null;
  whatsappTemplateName?: string | null;
}): TemplateValidation {
  const body = String(input.body ?? "");
  const errors: string[] = [];
  const warnings: string[] = [];
  const variables = extractVariables(body);
  const allowed = new Set(ALLOWED_VARIABLES.map(String));
  const unknownVariables = variables.filter((variable) => !allowed.has(variable));

  if (!body.trim()) errors.push("Write the message before saving it.");
  if (body.length > 2000) errors.push("That message is too long. Keep it under 2,000 characters.");
  if (unknownVariables.length) {
    errors.push(`Unknown placeholder${unknownVariables.length > 1 ? "s" : ""}: ${unknownVariables.map((name) => `{{${name}}}`).join(", ")}. Use only the listed fields.`);
  }

  // Links must be absolute and secured. A message may contain at most two links, and neither may
  // be an unapproved scheme such as javascript: or a bare domain that renders unpredictably.
  const urls = body.match(URL_PATTERN) ?? [];
  for (const url of urls) {
    if (!/^https:\/\//i.test(url)) errors.push(`Use a secure https:// link: ${url.slice(0, 80)}`);
  }
  if (urls.length > 2) warnings.push("More than two links can look like spam and may be filtered by the network.");

  if (input.category === "MARKETING" && !variables.includes("unsubscribe_link")) {
    warnings.push("Marketing messages should include {{unsubscribe_link}} so customers can opt out.");
  }

  if (input.channel === "WHATSAPP") {
    if (!input.whatsappTemplateName || !input.whatsappTemplateStatus) {
      errors.push("WhatsApp messages need a provider-approved template. Submit the template first.");
    } else if (String(input.whatsappTemplateStatus).toUpperCase() !== "APPROVED") {
      errors.push("That WhatsApp template is not approved yet. It cannot be sent until the provider approves it.");
    }
  }

  if (input.category === "TRANSACTIONAL") {
    const promotional = /\b(offer|discount|sale|promo|deal|buy now|% off)\b/i.test(body);
    if (promotional) {
      warnings.push("This reads like a promotion. Transactional messages must not carry marketing content.");
    }
  }

  const segments = calculateSegments(body);
  if (input.channel === "SMS" && segments.segments > 3) {
    warnings.push(`This message is ${segments.segments} SMS segments per recipient, so it costs ${segments.segments}× the single-message rate.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    variables: variables.filter((variable) => allowed.has(variable)) as TemplateVariable[],
    segments,
    unknownVariables,
  };
}

export type RenderValues = Partial<Record<TemplateVariable, string | number | null | undefined>>;

export type RenderResult = {
  ok: boolean;
  body: string;
  errors: string[];
  missing: TemplateVariable[];
};

/**
 * Render with a whitelist. Values are trimmed and newlines collapsed so a customer-supplied name
 * cannot break the message layout. Missing values become readable fallbacks, not "undefined".
 */
export function renderTemplate(body: string, values: RenderValues): RenderResult {
  const errors: string[] = [];
  const missing: TemplateVariable[] = [];
  const rendered = String(body ?? "").replace(VARIABLE_PATTERN, (_full, rawName: string) => {
    const name = rawName as TemplateVariable;
    if (!ALLOWED_VARIABLES.includes(name)) {
      errors.push(`Unknown placeholder {{${rawName}}}.`);
      return "";
    }
    const raw = values[name];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      missing.push(name);
      return VARIABLE_FALLBACKS[name];
    }
    const value = String(raw).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
    if (LINK_VARIABLES.includes(name)) {
      if (!/^https:\/\//i.test(value)) {
        errors.push(`The ${VARIABLE_LABELS[name].toLowerCase()} must be a secure https:// URL.`);
        return "";
      }
      return value;
    }
    return value;
  });

  return { ok: errors.length === 0, body: rendered, errors, missing };
}

/** Build a safe unsubscribe link without exposing internal identifiers. */
export function unsubscribeUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/u/${encodeURIComponent(token)}`;
}

/** Starter templates. They are drafts: the owner reviews and edits before any send. */
export const STARTER_TEMPLATES = [
  {
    key: "invoice_due",
    name: "Invoice reminder",
    channel: "SMS" as const,
    category: "TRANSACTIONAL" as const,
    body: "Hi {{first_name}}, invoice {{invoice_number}} for {{amount}} is due on {{due_date}}. Pay securely: {{link}} — {{business}}",
  },
  {
    key: "receipt_thanks",
    name: "Receipt / thank you",
    channel: "SMS" as const,
    category: "TRANSACTIONAL" as const,
    body: "Thank you {{first_name}}! We received {{amount}} for {{receipt_number}}. — {{business}}",
  },
  {
    key: "order_ready",
    name: "Order ready for collection",
    channel: "SMS" as const,
    category: "TRANSACTIONAL" as const,
    body: "Hi {{first_name}}, order {{order_number}} is ready. Bring this message. — {{business}}",
  },
  {
    key: "winback",
    name: "Welcome-back offer",
    channel: "SMS" as const,
    category: "MARKETING" as const,
    body: "Hi {{first_name}}, we miss you at {{business}}. Show this message for a treat this week. Opt out: {{unsubscribe_link}}",
  },
];
