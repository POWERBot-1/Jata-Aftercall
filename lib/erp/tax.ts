/**
 * Tax engine (§2.5, §3 of the Kenya addendum)
 *
 * One effective-dated registry, shared by POS, invoicing, expenses and the ledger. Rates are
 * never hardcoded in screens. A rule carries the date it applies from, an optional end date and
 * the source it was transcribed from, so a historical invoice is recalculated with the rule that
 * was in force — not today's rate.
 *
 * IMPORTANT: the seeded Kenyan rates are *reference configuration*, transcribed from public KRA
 * guidance on 2026-10-27 and marked `verified: false`. They are not legal advice. An accountant
 * must confirm the rate, treatment and effective dates for each taxpayer before live use; the
 * Compliance Centre shows exactly that status instead of claiming compliance.
 */

import { roundHalfUp, rateFromBps } from "./money";

export type TaxTreatment = "STANDARD" | "ZERO_RATED" | "EXEMPT" | "OUT_OF_SCOPE";

export type TaxRule = {
  key: string;
  label: string;
  rateBps: number;
  treatment: TaxTreatment;
  inclusive?: boolean;
  effectiveFrom: string; // ISO date
  effectiveTo?: string | null;
  sourceRef?: string | null;
  verified?: boolean;
};

export const TAX_SOURCE_RETRIEVED_ON = "2026-10-27";

/**
 * Kenyan VAT reference rules. The standard rate returned to 16% on 1 January 2021 after the
 * temporary 14% relief; keeping both rules proves effective dating instead of pretending there
 * was only ever one rate.
 */
export const DEFAULT_KENYA_TAX_RULES: TaxRule[] = [
  {
    key: "VAT_STANDARD_14",
    label: "VAT standard (temporary relief)",
    rateBps: 1400,
    treatment: "STANDARD",
    effectiveFrom: "2020-04-01",
    effectiveTo: "2020-12-31",
    sourceRef: "VAT Act (Cap. 476) as amended by the Tax Laws (Amendment) Act 2020; KRA VAT guidance",
    verified: false,
  },
  {
    key: "VAT_STANDARD",
    label: "VAT standard 16%",
    rateBps: 1600,
    treatment: "STANDARD",
    effectiveFrom: "2021-01-01",
    sourceRef: "VAT Act (Cap. 476) section 5; KRA VAT guidance (kra.go.ke, retrieved 2026-10-27)",
    verified: false,
  },
  {
    key: "VAT_ZERO",
    label: "VAT zero-rated",
    rateBps: 0,
    treatment: "ZERO_RATED",
    effectiveFrom: "2021-01-01",
    sourceRef: "VAT Act (Cap. 476) First Schedule",
    verified: false,
  },
  {
    key: "VAT_EXEMPT",
    label: "VAT exempt",
    rateBps: 0,
    treatment: "EXEMPT",
    effectiveFrom: "2021-01-01",
    sourceRef: "VAT Act (Cap. 476) Second Schedule",
    verified: false,
  },
  {
    key: "OUT_OF_SCOPE",
    label: "Outside the scope of VAT",
    rateBps: 0,
    treatment: "OUT_OF_SCOPE",
    effectiveFrom: "2021-01-01",
    sourceRef: "VAT Act (Cap. 476) — e.g. non-business income",
    verified: false,
  },
];

function dateValue(value: string | Date | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * Pick the rule in force on `onDate` for `key`. Later effective dates win; a rule whose window
 * has ended never applies. If none is active, `null` is returned — the caller must block the
 * posting rather than silently charging zero tax.
 */
export function resolveTaxRule<T extends TaxRule>(rules: T[], key: string, onDate: string | Date): T | null {
  const at = dateValue(onDate);
  const candidates = rules
    .filter((rule) => rule.key === key)
    .filter((rule) => dateValue(rule.effectiveFrom) <= at)
    .filter((rule) => !rule.effectiveTo || dateValue(rule.effectiveTo) >= at)
    .sort((a, b) => dateValue(b.effectiveFrom) - dateValue(a.effectiveFrom));
  return candidates[0] ?? null;
}

export type TaxComputation = {
  netCents: number;
  taxCents: number;
  grossCents: number;
  rateBps: number;
  treatment: TaxTreatment;
};

/**
 * Compute one line. Tax-inclusive prices are the norm in Kenyan retail, so the tax is extracted
 * from the gross rather than added on top. Rounding happens once, on the final tax figure.
 */
export function computeTax(params: {
  quantity: number;
  unitAmountCents: number;
  discountCents?: number;
  rule: Pick<TaxRule, "rateBps" | "treatment" | "inclusive">;
}): TaxComputation {
  const quantity = Number.isFinite(params.quantity) && params.quantity > 0 ? params.quantity : 0;
  const grossBeforeDiscount = roundHalfUp(quantity * Math.max(0, Math.round(params.unitAmountCents)));
  const discount = Math.min(Math.max(0, Math.round(params.discountCents ?? 0)), grossBeforeDiscount);
  const gross = grossBeforeDiscount - discount;
  const rateBps = Math.max(0, Math.round(params.rule.rateBps ?? 0));
  const taxable = params.rule.treatment === "STANDARD" || params.rule.treatment === "ZERO_RATED";

  if (!taxable || rateBps === 0) {
    return { netCents: gross, taxCents: 0, grossCents: gross, rateBps, treatment: params.rule.treatment };
  }

  if (params.rule.inclusive) {
    const net = roundHalfUp((gross * 10_000) / (10_000 + rateBps));
    return { netCents: net, taxCents: gross - net, grossCents: gross, rateBps, treatment: params.rule.treatment };
  }

  const tax = roundHalfUp(gross * rateFromBps(rateBps));
  return { netCents: gross, taxCents: tax, grossCents: gross + tax, rateBps, treatment: params.rule.treatment };
}

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitAmountCents: number;
  discountCents?: number;
  taxKey?: string;
};

export type PricedInvoiceLine = InvoiceLineInput & {
  netCents: number;
  taxCents: number;
  totalCents: number;
  taxRateBps: number;
  taxTreatment: TaxTreatment;
};

export type InvoiceTotals = {
  lines: PricedInvoiceLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Price an invoice. A line whose tax key has no rule in force is rejected outright: silently
 * treating an unknown treatment as zero-rated is how a business under-declares VAT.
 */
export function priceInvoiceLines(
  lines: InvoiceLineInput[],
  rules: TaxRule[],
  onDate: string | Date,
): { ok: true; totals: InvoiceTotals } | { ok: false; error: string; lineIndex?: number } {
  const priced: PricedInvoiceLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const key = line.taxKey ?? "VAT_STANDARD";
    const rule = resolveTaxRule(rules, key, onDate);
    if (!rule) {
      return { ok: false, error: `No tax rule "${key}" was in force on ${new Date(onDate).toISOString().slice(0, 10)}. Choose a valid tax treatment.`, lineIndex: index };
    }
    const calc = computeTax({ quantity: line.quantity, unitAmountCents: line.unitAmountCents, discountCents: line.discountCents, rule });
    priced.push({
      ...line,
      discountCents: Math.max(0, Math.round(line.discountCents ?? 0)),
      netCents: calc.netCents,
      taxCents: calc.taxCents,
      totalCents: calc.grossCents,
      taxRateBps: calc.rateBps,
      taxTreatment: calc.treatment,
    });
  }

  const subtotalCents = priced.reduce((total, line) => total + line.netCents, 0);
  const discountCents = priced.reduce((total, line) => total + Math.max(0, line.discountCents ?? 0), 0);
  const taxCents = priced.reduce((total, line) => total + line.taxCents, 0);
  const totalCents = priced.reduce((total, line) => total + line.totalCents, 0);
  return { ok: true, totals: { lines: priced, subtotalCents, discountCents, taxCents, totalCents } };
}

/** eTIMS `taxTyCd` mapping used by the KRA specification. Reference only until certification. */
export function etimsTaxTypeCode(treatment: TaxTreatment, rateBps: number): string {
  if (treatment === "EXEMPT") return "A";
  if (treatment === "ZERO_RATED") return "C";
  if (treatment === "OUT_OF_SCOPE") return "D";
  if (rateBps === 800) return "E";
  return "B";
}

export type TaxObligation = {
  key: string;
  label: string;
  scope: string;
  status: "SCOPED" | "CONFIGURED" | "BLOCKED" | "NOT TESTED";
  sourceRef: string;
  note: string;
};

/**
 * The Kenyan obligations the ERP must *assess*, not the ones every business must pay. Each entry
 * is deliberately marked unverified until an accountant confirms applicability for a taxpayer.
 */
export const KENYA_TAX_OBLIGATIONS: TaxObligation[] = [
  {
    key: "VAT",
    label: "Value Added Tax",
    scope: "Taxable goods and services; registration threshold and voluntary registration assessed per taxpayer.",
    status: "CONFIGURED",
    sourceRef: "VAT Act (Cap. 476); KRA VAT guidance, retrieved 2026-10-27",
    note: "Standard 16% and 0% treatments are configurable with effective dates. Thresholds and exemptions require professional confirmation.",
  },
  {
    key: "TOT",
    label: "Turnover Tax",
    scope: "Eligible small businesses below the turnover threshold.",
    status: "SCOPED",
    sourceRef: "Income Tax Act; KRA Turnover Tax guidance",
    note: "Rate and threshold are not hardcoded: the tax regime must be confirmed with an accountant before calculation is enabled.",
  },
  {
    key: "PAYE",
    label: "Pay As You Earn",
    scope: "Employers deducting income tax from employees.",
    status: "BLOCKED",
    sourceRef: "Income Tax Act; KRA PAYE guidance",
    note: "Blocked pending verified, effective-dated PAYE bands and an approved payroll adapter. No payslip claims are made.",
  },
  {
    key: "WHT",
    label: "Withholding tax",
    scope: "Specified payments such as rent, professional fees and royalties.",
    status: "SCOPED",
    sourceRef: "Income Tax Act; KRA withholding tax guidance",
    note: "Configurable rates and certificate tracking are planned; no live filing is claimed.",
  },
  {
    key: "EXCISE",
    label: "Excise duty",
    scope: "Exciseable goods and services.",
    status: "BLOCKED",
    sourceRef: "Excise Duty Act 2015; KRA excise guidance",
    note: "Sector-specific rates and licensing are outside the current verified scope.",
  },
  {
    key: "HOUSING_LEVY",
    label: "Affordable Housing Levy",
    scope: "Employers and employees covered by the applicable law.",
    status: "BLOCKED",
    sourceRef: "Affordable Housing Act; KRA guidance",
    note: "Statutory rate changes are frequent. Nothing is calculated until the current instrument is verified.",
  },
  {
    key: "NSSF",
    label: "Social security contributions",
    scope: "Employers registered with NSSF.",
    status: "BLOCKED",
    sourceRef: "NSSF Act",
    note: "Payroll integration blocked pending verified contribution bands and an approved adapter.",
  },
  {
    key: "SHIF",
    label: "Social health insurance",
    scope: "Employers and contributors under the applicable scheme.",
    status: "BLOCKED",
    sourceRef: "Social Health Insurance Act",
    note: "Blocked pending verified rules; no compliance claim is made.",
  },
];

/** Guardrails shown with every tax figure in the UI. */
export const TAX_DISCLAIMER =
  "Tax rules are configuration, not legal advice. Rates, thresholds and treatments must be confirmed by a qualified accountant for your business before you rely on them.";
