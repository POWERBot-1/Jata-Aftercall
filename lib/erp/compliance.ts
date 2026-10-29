/**
 * Kenya Compliance Centre (§1–§4 of the Kenya addendum)
 *
 * A registry, not a promise. Every entry records the official source it was transcribed from,
 * the date it was retrieved, and its real verification status. The eTIMS adapter is NOT connected:
 * system-to-system integration requires KRA certification of the integrating party and the
 * taxpayer's own onboarding. Until that exists the ERP can prepare, validate and queue invoices,
 * and it says so on every screen.
 *
 * A locally generated invoice is never presented as an eTIMS-accepted invoice.
 */

import type { ErpRole } from "./access";

export type EvidenceStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT TESTED";

export type ComplianceSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  retrievedOn: string;
  usedFor: string;
};

export const COMPLIANCE_SOURCES: ComplianceSource[] = [
  {
    id: "kra-etims-s2s",
    title: "eTIMS System to System Integration (OSCU / VSCU)",
    publisher: "Kenya Revenue Authority",
    url: "https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-system-to-system-integration",
    retrievedOn: "2026-10-27",
    usedFor: "OSCU/VSCU descriptions and certification requirement for self-integration or third-party integrators.",
  },
  {
    id: "kra-etims-types",
    title: "Types of eTIMS Solutions",
    publisher: "Kenya Revenue Authority",
    url: "https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/types-of-etims-solutions",
    retrievedOn: "2026-10-27",
    usedFor: "Available eTIMS solutions and eligibility categories.",
  },
  {
    id: "kra-etims-guidelines",
    title: "Public guidelines to taxpayers on eTIMS onboarding",
    publisher: "Kenya Revenue Authority",
    url: "https://www.zd.kra.go.ke/images/publications/eTIMS-Taxpayer-Guidelines_2024.pdf",
    retrievedOn: "2026-10-27",
    usedFor: "Solution eligibility (eTIMS Lite, Client, online portal, VSCU/OSCU) and onboarding steps.",
  },
  {
    id: "kra-vat",
    title: "Value Added Tax — registration and rates",
    publisher: "Kenya Revenue Authority",
    url: "https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax",
    retrievedOn: "2026-10-27",
    usedFor: "VAT standard rate and registration threshold reference. Threshold changes must be re-verified.",
  },
  {
    id: "kra-etims-self-onboarding",
    title: "KRA enhances eTIMS: self-onboarding and multiple solutions",
    publisher: "Kenya Revenue Authority",
    url: "https://www.kra.go.ke/news-center/press-release/2166-kra-enhances-etims-system-to-improve-taxpayer-experience",
    retrievedOn: "2026-10-27",
    usedFor: "Confirmation that eTIMS onboarding approval was removed and multiple solutions may be used.",
  },
];

export type EtimsSolution = {
  key: "NONE" | "LITE" | "CLIENT" | "OSCU" | "VSCU" | "PORTAL";
  label: string;
  description: string;
  eligibility: string;
  systemIntegration: boolean;
  status: EvidenceStatus;
  blocker: string | null;
};

export const ETIMS_SOLUTIONS: EtimsSolution[] = [
  {
    key: "NONE",
    label: "Not onboarded",
    description: "No eTIMS solution selected yet.",
    eligibility: "All businesses must assess their eTIMS obligation.",
    systemIntegration: false,
    status: "PASS",
    blocker: "Choose and complete the applicable eTIMS onboarding before issuing tax invoices.",
  },
  {
    key: "LITE",
    label: "eTIMS Lite (web / USSD / mobile)",
    description: "Simplified invoicing for eligible small and micro taxpayers.",
    eligibility: "Non-VAT taxpayers, with no other active eTIMS solution, selling goods or services.",
    systemIntegration: false,
    status: "BLOCKED",
    blocker: "KRA does not provide a public system-to-system API for eTIMS Lite. The ERP can prepare invoices and export them, but cannot submit them.",
  },
  {
    key: "CLIENT",
    label: "eTIMS Client (Windows / Android)",
    description: "KRA's installed invoicing client for businesses without an invoicing system.",
    eligibility: "Taxpayers selling goods or services without their own invoicing system; Android client is services-only.",
    systemIntegration: false,
    status: "BLOCKED",
    blocker: "The desktop/Android client is operated by the taxpayer. Integrate only through the officially supported interface, if one is published for your case.",
  },
  {
    key: "OSCU",
    label: "OSCU — Online Sales Control Unit",
    description: "System-to-system integration for invoicing systems that are always online.",
    eligibility: "Taxpayers with an automated invoicing system, self-integrating or using a KRA-certified third-party integrator.",
    systemIntegration: true,
    status: "BLOCKED",
    blocker: "Requires KRA certification of the integrating party and the taxpayer's own OSCU onboarding and credentials. No credentials or certification are present in this environment.",
  },
  {
    key: "VSCU",
    label: "VSCU — Virtual Sales Control Unit",
    description: "System-to-system integration for bulk invoicing, including intermittently connected environments.",
    eligibility: "Taxpayers with high volumes or bulk invoicing, self-integrating or using a certified third-party integrator.",
    systemIntegration: true,
    status: "BLOCKED",
    blocker: "Requires KRA certification and a deployed local VSCU component with credentials. Nothing is faked locally.",
  },
  {
    key: "PORTAL",
    label: "eTIMS online portal",
    description: "Browser invoicing on the KRA portal.",
    eligibility: "Strictly service suppliers issuing no more than ten invoices per month.",
    systemIntegration: false,
    status: "NOT TESTED",
    blocker: "Portal automation is prohibited. The ERP does not scrape or automate the KRA portal.",
  },
];

export type ComplianceCheck = {
  key: string;
  label: string;
  explanation: string;
  owner: "CUSTOMER" | "JATA" | "KRA" | "PROVIDER";
  status: EvidenceStatus;
  evidence: string;
  action: string | null;
};

export type EtimsProfile = {
  etimsSolution?: string | null;
  etimsStatus?: string | null;
  kraPin?: string | null;
  vatRegistered?: boolean | null;
  taxpayerName?: string | null;
};

/**
 * Readiness, computed from what is actually true. Nothing here says "compliant"; every line either
 * has evidence or is blocked.
 */
export function etimsReadiness(profile: EtimsProfile | null | undefined): {
  solution: string;
  status: EvidenceStatus;
  checks: ComplianceCheck[];
  invoiceSubmissionEnabled: boolean;
  headline: string;
} {
  const solution = String(profile?.etimsSolution ?? "NONE").toUpperCase();
  const definition = ETIMS_SOLUTIONS.find((entry) => entry.key === solution) ?? ETIMS_SOLUTIONS[0];
  const hasPin = Boolean(profile?.kraPin && /^[A-Z]{1,2}\d{9}[A-Z]$/i.test(String(profile.kraPin).trim()));
  const hasTaxpayer = Boolean(profile?.taxpayerName && String(profile.taxpayerName).trim().length > 2);

  const checks: ComplianceCheck[] = [
    {
      key: "taxpayer_identity",
      label: "Taxpayer identity recorded",
      explanation: "The legal name and KRA PIN the business trades under.",
      owner: "CUSTOMER",
      status: hasPin && hasTaxpayer ? "PASS" : "FAIL",
      evidence: hasPin ? "KRA PIN format is valid (11 characters)." : "No valid-format KRA PIN recorded.",
      action: hasPin && hasTaxpayer ? null : "Add the legal name and KRA PIN in the tax profile.",
    },
    {
      key: "vat_status",
      label: "VAT position confirmed",
      explanation: "Whether the business is VAT-registered, and therefore which eTIMS route and invoices apply.",
      owner: "CUSTOMER",
      status: typeof profile?.vatRegistered === "boolean" ? "PASS" : "FAIL",
      evidence: typeof profile?.vatRegistered === "boolean" ? `Recorded as ${profile.vatRegistered ? "VAT-registered" : "not VAT-registered"}.` : "VAT position has not been recorded.",
      action: typeof profile?.vatRegistered === "boolean" ? null : "Confirm your VAT registration status with your accountant.",
    },
    {
      key: "solution_selected",
      label: "eTIMS solution selected",
      explanation: "Which officially supported eTIMS route this business will use.",
      owner: "CUSTOMER",
      status: solution === "NONE" ? "FAIL" : "PASS",
      evidence: solution === "NONE" ? "No solution selected." : `${definition.label} selected.`,
      action: solution === "NONE" ? "Choose a solution that matches your eligibility." : null,
    },
    {
      key: "kra_onboarding",
      label: "KRA eTIMS onboarding completed",
      explanation: "The business itself must onboard on eTIMS; self-onboarding no longer requires KRA approval, but the business must still register.",
      owner: "CUSTOMER",
      status: String(profile?.etimsStatus ?? "").toUpperCase() === "ONBOARDED" ? "PASS" : "BLOCKED",
      evidence: String(profile?.etimsStatus ?? "NOT_STARTED"),
      action: String(profile?.etimsStatus ?? "").toUpperCase() === "ONBOARDED" ? null : "Complete onboarding on eTIMS and record the confirmation here.",
    },
    {
      key: "integration_certification",
      label: "System-to-system integration certified",
      explanation: "OSCU/VSCU require KRA certification of the integrating party (self or a KRA-certified third party).",
      owner: "JATA",
      status: definition.systemIntegration ? "BLOCKED" : "NOT TESTED",
      evidence: definition.systemIntegration ? "No KRA certification or sandbox credentials are present in this deployment." : "This route does not use system-to-system integration.",
      action: definition.systemIntegration ? "Obtain KRA certification and sandbox credentials, then complete certification tests before enabling submission." : null,
    },
    {
      key: "submission_test",
      label: "Sandbox invoice accepted",
      explanation: "An end-to-end invoice submission acknowledged by the authoritative eTIMS endpoint.",
      owner: "JATA",
      status: "NOT TESTED",
      evidence: "No sandbox submission has been performed. The ERP records this honestly.",
      action: "Complete after certification using synthetic taxpayer data in an approved sandbox.",
    },
  ];

  const invoiceSubmissionEnabled = false; // never true until the provider adapter is certified and configured
  return {
    solution: definition.label,
    status: definition.status,
    checks,
    invoiceSubmissionEnabled,
    headline:
      solution === "NONE"
        ? "Choose how your business will meet its eTIMS obligation."
        : "Invoices can be prepared and validated here. Submission to KRA is not connected yet, so no invoice is marked as accepted.",
  };
}

/** The eTIMS invoice lifecycle, exactly as the UI must present it. */
export const ETIMS_INVOICE_STATES = [
  { key: "DRAFT", label: "Draft", meaning: "Saved internally. Nothing has been submitted." },
  { key: "VALIDATED", label: "Validated", meaning: "Fields and totals pass the local checks." },
  { key: "QUEUED", label: "Queued for submission", meaning: "Waiting for a certified eTIMS connection." },
  { key: "SUBMITTING", label: "Submitting", meaning: "A request is in flight. Not yet accepted." },
  { key: "PENDING_ACK", label: "Awaiting acknowledgement", meaning: "Sent, but KRA has not answered." },
  { key: "ACCEPTED", label: "Accepted by eTIMS", meaning: "The authoritative response contains the control number. Only then may the invoice be called accepted." },
  { key: "REJECTED", label: "Rejected", meaning: "KRA refused it. The reason is shown and the invoice is not deleted." },
  { key: "UNCERTAIN", label: "Uncertain", meaning: "The request timed out. Reconcile before resubmitting so you do not create a duplicate." },
  { key: "CORRECTED", label: "Corrected", meaning: "Corrected through a credit/debit note, preserving the original." },
  { key: "PAID", label: "Paid", meaning: "Payment settled. Separate from, and never implied by, eTIMS acceptance." },
] as const;

/** An invoice is never "accepted" without an authoritative response carrying a control number. */
export function assertAuthoritativeAcceptance(input: {
  status: string;
  controlNumber?: string | null;
  responseSource?: string | null;
}): { ok: boolean; reason: string } {
  if (String(input.status).toUpperCase() !== "ACCEPTED") return { ok: true, reason: "Not claiming acceptance." };
  if (!input.controlNumber) return { ok: false, reason: "An accepted eTIMS invoice must carry the control number returned by KRA. This one does not." };
  if (String(input.responseSource ?? "").toUpperCase() !== "KRA_ETIMS") {
    return { ok: false, reason: "The response did not come from the authoritative eTIMS endpoint, so acceptance cannot be claimed." };
  }
  return { ok: true, reason: "Acceptance is backed by an authoritative response." };
}

export type SectorCompliance = {
  key: string;
  label: string;
  status: "SCOPED" | "IN DEVELOPMENT" | "TESTED" | "VERIFIED FOR RELEASE" | "BLOCKED";
  coreWorkflows: string[];
  taxNotes: string;
  licences: string[];
  etims: string;
  privacy: string;
  unsupported: string[];
};

/** 28 Kenyan sectors, honestly scoped. No sector is claimed as "verified for release". */
export const KENYA_SECTOR_MATRIX: SectorCompliance[] = [
  { key: "retail", label: "Retail and convenience", status: "IN DEVELOPMENT", coreWorkflows: ["Barcode checkout", "Stock and reorder", "Receipts", "Customer credit"], taxNotes: "VAT standard 16% on taxable goods; exempt/zero-rated lines need item-level treatment.", licences: ["Single business permit", "County trade licence"], etims: "Applicable; solution depends on VAT status and invoicing volume.", privacy: "Customer contact data; retain transaction records under tax law.", unsupported: ["Weighted scale integration untested", "eTIMS submission blocked"] },
  { key: "wholesale", label: "Wholesale and distribution", status: "SCOPED", coreWorkflows: ["Price tiers", "Purchase orders", "Credit terms", "Ageing"], taxNotes: "VAT on taxable supplies; credit notes for returns.", licences: ["Business permit"], etims: "Applicable.", privacy: "B2B contact data.", unsupported: ["Route accounting and van sales not implemented"] },
  { key: "supermarket", label: "Supermarkets and multi-branch retail", status: "SCOPED", coreWorkflows: ["Branch stock", "Transfers", "Till shifts"], taxNotes: "VAT; mixed exempt baskets.", licences: ["County permits", "Liquor licence where applicable"], etims: "Applicable per branch/pay point configuration.", privacy: "Loyalty data requires consent.", unsupported: ["Scale and label-printer devices untested"] },
  { key: "restaurant", label: "Restaurants, cafés and catering", status: "IN DEVELOPMENT", coreWorkflows: ["Table orders", "Kitchen tickets", "Split payments"], taxNotes: "VAT on taxable sales; service charge treatment requires professional review.", licences: ["Food hygiene certificate", "Liquor licence where applicable"], etims: "Applicable.", privacy: "Reservation and order data.", unsupported: ["Kitchen display hardware untested"] },
  { key: "manufacturing", label: "Manufacturing and processing", status: "SCOPED", coreWorkflows: ["Bills of materials", "Production runs", "Wastage"], taxNotes: "VAT; input VAT on eligible purchases; excise possible.", licences: ["Factory registration", "Health permits"], etims: "Applicable.", privacy: "Supplier and employee data.", unsupported: ["Work-in-progress costing not implemented"] },
  { key: "import_export", label: "Importers, exporters and trade", status: "BLOCKED", coreWorkflows: ["Landed cost", "Customs documents"], taxNotes: "Import VAT, duty and zero-rated exports require validation.", licences: ["Customs registration", "KEPHIS/KEBS where applicable"], etims: "Applicable.", privacy: "Cross-border data transfers need review.", unsupported: ["Customs system integration not available", "Landed-cost engine not implemented"] },
  { key: "logistics", label: "Transport, logistics and delivery", status: "SCOPED", coreWorkflows: ["Dispatch", "Delivery notes", "Proof of delivery"], taxNotes: "VAT on transport services; exemptions may apply.", licences: ["Transport licence", "Insurance"], etims: "Applicable.", privacy: "Driver and recipient data.", unsupported: ["Live courier API adapters not connected"] },
  { key: "construction", label: "Construction and building supplies", status: "SCOPED", coreWorkflows: ["Project costing", "Retention", "Variations"], taxNotes: "VAT on supplies and contracts; withholding rules may apply.", licences: ["NCA registration", "County permits"], etims: "Applicable.", privacy: "Worker and client data.", unsupported: ["Retention accounting not tested"] },
  { key: "agriculture", label: "Agriculture and agribusiness", status: "SCOPED", coreWorkflows: ["Harvest intake", "Weighed sales", "Input stock"], taxNotes: "Zero-rated and exempt inputs; VAT treatment varies by product.", licences: ["AFFA registration where applicable"], etims: "Applicable.", privacy: "Farmer data; consider aggregator consent.", unsupported: ["Scale protocols untested"] },
  { key: "livestock", label: "Livestock, dairy and fisheries", status: "SCOPED", coreWorkflows: ["Weighed intake", "Cold-chain notes"], taxNotes: "Unprocessed produce often zero-rated; verify per item.", licences: ["Veterinary/health permits"], etims: "Applicable.", privacy: "Producer data.", unsupported: ["Cold-chain sensor integration not implemented"] },
  { key: "professional_services", label: "Professional services", status: "SCOPED", coreWorkflows: ["Quotes", "Time and milestones", "Invoices"], taxNotes: "VAT on taxable services; WHT on some payments.", licences: ["Professional body registration"], etims: "Applicable.", privacy: "Client confidentiality obligations.", unsupported: ["Trust/escrow accounting not implemented"] },
  { key: "agency", label: "Marketing and creative agencies", status: "SCOPED", coreWorkflows: ["Client projects", "Retainers", "Pass-through costs"], taxNotes: "VAT on fees; disbursement treatment needs review.", licences: ["Business permit"], etims: "Applicable.", privacy: "Client and campaign audience data.", unsupported: ["Cross-client data walls beyond project scoping not verified"] },
  { key: "property", label: "Property sales, letting and management", status: "BLOCKED", coreWorkflows: ["Units", "Rent invoicing", "Maintenance"], taxNotes: "Residential rent generally exempt; commercial property VAT treatment requires legal review.", licences: ["Estate agent registration", "County permits"], etims: "Applicable to taxable supplies.", privacy: "Tenant identity data is sensitive.", unsupported: ["Rent-regulation rules not implemented"] },
  { key: "automotive", label: "Automotive sales, garages and parts", status: "SCOPED", coreWorkflows: ["Job cards", "Parts", "Service history"], taxNotes: "VAT on parts and labour.", licences: ["Trade licence"], etims: "Applicable.", privacy: "Vehicle owner data.", unsupported: ["Diagnostic device integration untested"] },
  { key: "salon", label: "Salons, beauty and wellness", status: "SCOPED", coreWorkflows: ["Appointments", "Packages", "Commission"], taxNotes: "VAT on taxable services.", licences: ["County health permit"], etims: "Applicable.", privacy: "Client treatment records are sensitive.", unsupported: ["Consumable back-bar costing not implemented"] },
  { key: "healthcare", label: "Healthcare providers and pharmacies", status: "BLOCKED", coreWorkflows: ["Dispensing", "Batch and expiry", "Prescriptions"], taxNotes: "Medicines may be exempt or zero-rated; verify each item.", licences: ["Pharmacy and Poisons Board licence", "Practitioner registration"], etims: "Applicable; sector rules apply.", privacy: "Health data is sensitive personal data under the Data Protection Act.", unsupported: ["Clinical records, prescription validation and sector compliance are out of scope until independently verified"] },
  { key: "education", label: "Education and training", status: "SCOPED", coreWorkflows: ["Enrolment", "Fee invoices", "Term billing"], taxNotes: "Education services may be exempt; verify.", licences: ["Ministry registration"], etims: "Applicable to taxable supplies.", privacy: "Student data, including minors.", unsupported: ["Examination and regulator integrations not available"] },
  { key: "ngo", label: "NGOs and non-profits", status: "BLOCKED", coreWorkflows: ["Donor projects", "Fund accounting"], taxNotes: "Exemptions and tax-exempt status require verification.", licences: ["NGO Coordination Board registration"], etims: "Assess with professional advice.", privacy: "Beneficiary data is highly sensitive.", unsupported: ["Fund accounting and donor reporting not implemented"] },
  { key: "financial", label: "Financial and payment businesses", status: "BLOCKED", coreWorkflows: [], taxNotes: "Financial services often exempt; licensing is extensive.", licences: ["CBK / CMA licensing"], etims: "Assess with professional advice.", privacy: "Regulated financial data.", unsupported: ["Out of scope: licensing, safeguarding and prudential requirements"] },
  { key: "telecom", label: "Telecoms, technology and digital services", status: "SCOPED", coreWorkflows: ["Subscriptions", "Usage billing"], taxNotes: "VAT on digital services; place-of-supply rules need review.", licences: ["CA registration where applicable"], etims: "Applicable.", privacy: "Subscriber and traffic data.", unsupported: ["Carrier billing integrations not implemented"] },
  { key: "ecommerce", label: "E-commerce and marketplaces", status: "IN DEVELOPMENT", coreWorkflows: ["Storefront", "Orders", "Delivery"], taxNotes: "VAT on taxable goods and services; marketplace rules need review.", licences: ["Business permit"], etims: "Applicable per seller.", privacy: "Buyer data, consent and cookies.", unsupported: ["Marketplace multi-seller settlement not implemented"] },
  { key: "hotel", label: "Hotels, travel and tourism", status: "BLOCKED", coreWorkflows: ["Rooms", "Bookings", "Tourism levy"], taxNotes: "VAT plus tourism levy; treatment requires review.", licences: ["Tourism Regulatory Authority licence"], etims: "Applicable.", privacy: "Guest data and passport copies.", unsupported: ["Tourism levy and booking-channel integration not implemented"] },
  { key: "security", label: "Security and facilities management", status: "SCOPED", coreWorkflows: ["Guards", "Shift rosters", "Client sites"], taxNotes: "VAT on services.", licences: ["Private Security Regulatory Authority licence"], etims: "Applicable.", privacy: "Guard and client data.", unsupported: ["Biometric attendance devices untested"] },
  { key: "recruitment", label: "Recruitment and HR services", status: "SCOPED", coreWorkflows: ["Placements", "Candidate pipeline"], taxNotes: "VAT on fees.", licences: ["Business permit"], etims: "Applicable.", privacy: "Candidate data requires a lawful basis and retention limits.", unsupported: ["Background-check integrations not available"] },
  { key: "utilities", label: "Water, energy and utilities", status: "BLOCKED", coreWorkflows: ["Metered billing"], taxNotes: "Sector-specific levies and tariffs.", licences: ["Sector regulator licence"], etims: "Assess.", privacy: "Consumer metering data.", unsupported: ["Meter integrations and regulatory tariffs out of scope"] },
  { key: "public_sector", label: "Public-sector agencies", status: "BLOCKED", coreWorkflows: [], taxNotes: "Public finance rules differ from commercial accounting.", licences: ["Public procurement compliance"], etims: "Per entity.", privacy: "Public-sector data handling and procurement rules.", unsupported: ["IFMIS, procurement and public-finance controls not implemented"] },
  { key: "multi_entity", label: "Multi-agency, multi-branch organisations", status: "IN DEVELOPMENT", coreWorkflows: ["Branch reporting", "Consolidated owner view"], taxNotes: "Each legal entity is a separate taxpayer.", licences: ["Per entity"], etims: "Per entity; credentials never shared across tenants.", privacy: "Cross-entity access must be explicitly authorised.", unsupported: ["Full consolidation and eliminations not implemented"] },
  { key: "other", label: "Other lawful Kenyan industries", status: "SCOPED", coreWorkflows: ["Generic retail/service core"], taxNotes: "Assess with an accountant.", licences: ["Depends on activity"], etims: "Assess.", privacy: "Apply the Data Protection Act baseline.", unsupported: ["Sector-specific workflows not covered"] },
];

export function sectorFor(key: string): SectorCompliance {
  return KENYA_SECTOR_MATRIX.find((sector) => sector.key === key) ?? KENYA_SECTOR_MATRIX[KENYA_SECTOR_MATRIX.length - 1];
}

/** Regulatory changes are versioned so a report can say which rule set produced it. */
export const TAX_RULE_REGISTRY_VERSION = "KE-2026-10-27-1";

export function complianceCentreSummary(input: {
  role: ErpRole;
  profile: EtimsProfile | null | undefined;
  taxRules: Array<{ key: string; verified: boolean }>;
  /** Counts loaded from the database; never invented here. */
  counts?: { awaitingSubmission?: number; accepted?: number; rejected?: number; uncertain?: number };
}) {
  const readiness = etimsReadiness(input.profile);
  return {
    readiness,
    registryVersion: TAX_RULE_REGISTRY_VERSION,
    taxRuleCount: input.taxRules.length,
    verifiedTaxRuleCount: input.taxRules.filter((rule) => rule.verified).length,
    // The numbers below are deliberately zero/blocked until real integrations exist.
    submissionEnabled: false,
    invoicesAwaitingSubmission: input.counts?.awaitingSubmission ?? 0,
    acceptedInvoices: input.counts?.accepted ?? 0,
    rejectedInvoices: input.counts?.rejected ?? 0,
    uncertainInvoices: input.counts?.uncertain ?? 0,
    blocker: "No certified KRA eTIMS connection is configured. Invoices are prepared and validated only.",
  };
}
