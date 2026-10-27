/**
 * Guided onboarding and the home screen
 *
 * Every step is derived from stored facts, never from a checkbox the UI sets by itself. A step is
 * DONE only when the underlying record exists; "waiting" is used where an external approval is
 * genuinely pending, and the copy tells the customer what they *can* do in the meantime.
 */

export type OnboardingFacts = {
  workspaceConfigured: boolean;
  profileComplete: boolean;
  chartOfAccounts: boolean;
  taxRules: boolean;
  senderActive: boolean;
  channelConnected: boolean;
  contactsAdded: boolean;
  consentRecorded: boolean;
  firstCampaignDrafted: boolean;
  firstCampaignSent: boolean;
  firstInvoiceIssued: boolean;
  storefrontOpened: boolean;
};

export type OnboardingStatus = "DONE" | "NEXT" | "TODO" | "WAITING";

export type OnboardingStepDefinition = {
  key: keyof OnboardingFacts;
  label: string;
  description: string;
  /** What the customer can do while an external approval is pending. */
  meanwhile: string | null;
  effort: string;
  path: string;
  /** When the step depends on someone outside the business. */
  external?: boolean;
};

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  { key: "workspaceConfigured", label: "Create your workspace", description: "Chart of accounts, tax rules and a wallet are created for this business.", meanwhile: null, effort: "1 minute", path: "/settings#workspace" },
  { key: "profileComplete", label: "Add your business details", description: "Legal name, KRA PIN and county, so documents and forms prefill correctly.", meanwhile: null, effort: "3 minutes", path: "/settings#business" },
  { key: "chartOfAccounts", label: "Check your chart of accounts", description: "The default Kenyan retail chart; rename or add accounts if your accountant prefers.", meanwhile: null, effort: "2 minutes", path: "/accounting" },
  { key: "taxRules", label: "Confirm your tax rules", description: "VAT 16%, zero-rated and exempt, each effective from a date.", meanwhile: null, effort: "2 minutes", path: "/compliance" },
  { key: "senderActive", label: "Activate a Sender ID", description: "The name your customers see instead of a random number.", meanwhile: "Draft campaigns while the provider reviews the name; nothing sends until it is active.", effort: "5–10 minutes", path: "/sender-identity", external: true },
  { key: "channelConnected", label: "Connect a sending channel", description: "SMS or WhatsApp, with credentials you own.", meanwhile: "The sandbox channel proves the flow without messaging a real phone.", effort: "5 minutes", path: "/sender-identity#channels" },
  { key: "contactsAdded", label: "Add your customers", description: "Import a spreadsheet or add one customer.", meanwhile: null, effort: "2 minutes", path: "/customers" },
  { key: "consentRecorded", label: "Record marketing consent", description: "Consent needs a source and wording version. A phone number on its own is not consent.", meanwhile: null, effort: "2 minutes", path: "/customers" },
  { key: "firstCampaignDrafted", label: "Draft your first campaign", description: "Choose an audience, write the message and see the exact cost.", meanwhile: null, effort: "3 minutes", path: "/messaging/new" },
  { key: "firstCampaignSent", label: "Send your first campaign", description: "Approved campaigns reserve credit and dispatch in batches.", meanwhile: "Approval and dispatch are separate steps on purpose.", effort: "2 minutes", path: "/messaging" },
  { key: "firstInvoiceIssued", label: "Issue your first invoice", description: "Posting an invoice writes the receivable and the revenue together.", meanwhile: null, effort: "2 minutes", path: "/invoices" },
  { key: "storefrontOpened", label: "Open your ordering page", description: "A public link where customers order at your real prices.", meanwhile: "Your shop stays closed until you switch it on.", effort: "3 minutes", path: "/store" },
];

export type OnboardingStep = OnboardingStepDefinition & {
  index: number;
  status: OnboardingStatus;
  note: string | null;
};

export type DerivedOnboarding = {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  percent: number;
  nextStep: OnboardingStep | null;
  headline: string;
  waitingExternal: boolean;
};

export function deriveOnboarding(facts: OnboardingFacts): DerivedOnboarding {
  let assigned = false;
  const steps: OnboardingStep[] = ONBOARDING_STEPS.map((step, index) => {
    const done = Boolean(facts[step.key]);
    let status: OnboardingStatus;
    if (done) status = "DONE";
    else if (step.external && facts.channelConnected) status = "WAITING";
    else if (assigned) status = "TODO";
    else {
      status = "NEXT";
      assigned = true;
    }
    return {
      ...step,
      index,
      status,
      note: status === "WAITING" ? "With the provider. You can keep preparing everything else." : null,
    };
  });
  const completed = steps.filter((step) => step.status === "DONE").length;
  const total = steps.length;
  const nextStep = steps.find((step) => step.status === "NEXT") ?? null;
  const headline = completed === total
    ? "Everything is set up. Review today's figures, or send another campaign."
    : nextStep
      ? `Next: ${nextStep.label.toLowerCase()}.`
      : "You're waiting on an external approval. Everything else is ready.";
  return {
    steps,
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    nextStep,
    headline,
    waitingExternal: steps.some((step) => step.status === "WAITING"),
  };
}

export type DashboardCard = {
  key: string;
  title: string;
  description: string;
  status: "done" | "action" | "waiting" | "blocked";
  statusLabel: string;
  nextAction: string;
  effort: string;
  href: string;
};

export function dashboardCards(input: {
  businessId: string;
  basePath: string;
  counts: { contacts: number; contactsWithMarketingConsent: number; campaignsLive: number; campaignsReady: number; openInvoices: number; outstandingCents: number; pendingOrders: number; walletAvailableCents: number };
  onboarding: DerivedOnboarding;
  senderStatus: string | null;
  storefrontEnabled: boolean;
}): DashboardCard[] {
  const base = input.basePath;
  const senderActive = String(input.senderStatus ?? "").toUpperCase() === "ACTIVE";
  const senderWaiting = Boolean(input.senderStatus && !["DRAFT", "NOT_STARTED"].includes(String(input.senderStatus).toUpperCase()));
  return [
    {
      key: "business",
      title: "Set up my business",
      description: input.onboarding.steps[1].status === "DONE" ? "Business details are saved." : "Add the legal name, KRA PIN and county.",
      status: input.onboarding.steps[1].status === "DONE" ? "done" : "action",
      statusLabel: input.onboarding.steps[1].status === "DONE" ? "Done" : "Start here",
      nextAction: input.onboarding.steps[1].status === "DONE" ? "Review" : "Add details",
      effort: "3 min",
      href: `${base}/settings#business`,
    },
    {
      key: "sender",
      title: "Activate my Sender ID",
      description: senderActive
        ? "Active. Your name appears on customers' phones."
        : senderWaiting
          ? "Application is with the provider. You can prepare campaigns now."
          : "Apply for the name customers will see.",
      status: senderActive ? "done" : senderWaiting ? "waiting" : "action",
      statusLabel: senderActive ? "Active" : senderWaiting ? "With provider" : "Not started",
      nextAction: senderActive ? "View" : senderWaiting ? "Track" : "Apply",
      effort: "5–10 min",
      href: `${base}/sender-identity`,
    },
    {
      key: "customers",
      title: "Add my customers",
      description: input.counts.contacts > 0
        ? `${input.counts.contacts} contacts · ${input.counts.contactsWithMarketingConsent} with marketing consent.`
        : "Import a spreadsheet or add one customer.",
      status: input.counts.contacts > 0 ? (input.counts.contactsWithMarketingConsent > 0 ? "done" : "action") : "action",
      statusLabel: input.counts.contacts > 0 ? (input.counts.contactsWithMarketingConsent > 0 ? "Ready" : "Add consent") : "No contacts",
      nextAction: input.counts.contacts > 0 ? "Manage" : "Import",
      effort: "2 min",
      href: `${base}/customers`,
    },
    {
      key: "campaign",
      title: "Send my first campaign",
      description: input.counts.campaignsLive > 0
        ? `${input.counts.campaignsLive} campaign${input.counts.campaignsLive === 1 ? "" : "s"} live.`
        : input.counts.campaignsReady > 0
          ? `${input.counts.campaignsReady} campaign${input.counts.campaignsReady === 1 ? "" : "s"} waiting for approval.`
          : "Draft a campaign and see the real cost before sending.",
      status: input.counts.campaignsLive > 0 ? "done" : "action",
      statusLabel: input.counts.campaignsLive > 0 ? "Live" : input.counts.campaignsReady > 0 ? "Ready for review" : "Not started",
      nextAction: input.counts.campaignsReady > 0 ? "Review" : "Create",
      effort: "3 min",
      href: input.counts.campaignsReady > 0 ? `${base}/messaging` : `${base}/messaging/new`,
    },
    {
      key: "money",
      title: "Invoices and money owed",
      description: input.counts.openInvoices > 0
        ? `${input.counts.openInvoices} open invoice${input.counts.openInvoices === 1 ? "" : "s"} · KES ${(input.counts.outstandingCents / 100).toLocaleString("en-KE")} outstanding.`
        : "Issue an invoice and the receivable posts itself.",
      status: input.counts.openInvoices > 0 ? "done" : "action",
      statusLabel: input.counts.openInvoices > 0 ? "In progress" : "No invoices",
      nextAction: input.counts.openInvoices > 0 ? "Open invoices" : "Create invoice",
      effort: "2 min",
      href: `${base}/invoices`,
    },
    {
      key: "store",
      title: input.storefrontEnabled ? "View my online shop" : "Open my online shop",
      description: input.counts.pendingOrders > 0
        ? `${input.counts.pendingOrders} order${input.counts.pendingOrders === 1 ? "" : "s"} waiting for confirmation.`
        : input.storefrontEnabled
          ? "Your ordering page is live. Share the link."
          : "Turn the shop on when your prices and stock are ready.",
      status: input.counts.pendingOrders > 0 ? "action" : input.storefrontEnabled ? "done" : "action",
      statusLabel: input.counts.pendingOrders > 0 ? "Orders waiting" : input.storefrontEnabled ? "Live" : "Closed",
      nextAction: input.counts.pendingOrders > 0 ? "Confirm orders" : input.storefrontEnabled ? "Manage" : "Set up",
      effort: "3 min",
      href: `${base}/store`,
    },
  ];
}
