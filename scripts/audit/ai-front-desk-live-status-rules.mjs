/**
 * Classification rules for the AI Front Desk live-status audit.
 *
 * Deliberately dependency-free (plain ESM, no Prisma, no Next): the audit has to be runnable
 * against a production database by an owner with node and `pg`, without generating a Prisma client
 * first, and the rules have to be unit-testable without a database at all.
 *
 * These rules mirror `lib/ai-entitlement.ts` + `lib/ai-publication.ts`. They are used only to
 * *report*; nothing here can change a row.
 */

export const AI_PLAN_KEY = "AI_BUSINESS_FRONT_DESK";

/** The states the product reports. Mirrors AI_FRONT_DESK_STATES in lib/ai-publication.ts. */
export const STATES = Object.freeze([
  "DRAFT",
  "PREVIEW",
  "LIVE",
  "PAUSED",
  "MAINTENANCE",
  "SUSPENDED",
]);

/**
 * @param {{
 *   isPublished: boolean,
 *   operationalStatus: string,
 *   subscription: { status?: string | null, expiresAt?: string | Date | null, graceUntil?: string | Date | null } | null,
 *   entitlement: { status?: string | null } | null,
 *   planKey: string | null,
 *   hasPaidPayment: boolean,
 *   now: number,
 * }} input
 */
export function evaluate(input) {
  const subscription = input.subscription || null;
  const entitlement = input.entitlement || null;
  const validUntil = subscription?.graceUntil ?? subscription?.expiresAt ?? null;
  const withinWindow = !validUntil || new Date(validUntil).getTime() >= input.now;

  const entitled =
    input.planKey === AI_PLAN_KEY &&
    input.hasPaidPayment === true &&
    entitlement?.status !== "SUSPENDED" &&
    entitlement?.status !== "CANCELLED" &&
    (subscription?.status === "ACTIVE" || subscription?.status === "EXPIRING") &&
    withinWindow;

  const storedSwitchSaysLive = input.operationalStatus === "LIVE";
  const derivedState = !input.isPublished
    ? "DRAFT"
    : !entitled
      ? "SUSPENDED"
      : input.operationalStatus === "PAUSED"
        ? "PAUSED"
        : input.operationalStatus === "MAINTENANCE"
          ? "MAINTENANCE"
          : input.operationalStatus === "LIVE"
            ? "LIVE"
            : "DRAFT";

  return {
    entitled,
    storedSwitchSaysLive,
    derivedState,
    publiclyOperational: derivedState === "LIVE",
    /** The exact defect being audited: the record claims LIVE without the entitlement behind it. */
    incorrectlyLive: storedSwitchSaysLive && derivedState !== "LIVE",
  };
}

/** Reads the stored operational switch out of an AI system-config snapshot, defaulting to DRAFT. */
export function operationalStatusFromSnapshot(snapshot) {
  if (!snapshot) return "DRAFT";
  try {
    const parsed = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
    const value = typeof parsed?.operationalStatus === "string" ? parsed.operationalStatus : "";
    return value ? value.toUpperCase() : "DRAFT";
  } catch {
    return "DRAFT";
  }
}

/**
 * CLI arguments. `--apply` is refused on purpose: this tool has no write path, and reconciling
 * production rows needs explicit owner authorisation plus a reviewed, reversible migration.
 */
export function parseArgs(argv) {
  const options = { json: false, limit: 100, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--limit") {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--limit expects a positive number");
      options.limit = Math.min(Math.floor(value), 1000);
      index += 1;
    } else if (arg === "--apply") {
      throw new Error(
        "--apply is deliberately not implemented: reconciling production rows needs explicit owner authorisation and a reviewed change.",
      );
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  return options;
}

export const GRACE_NOTE =
  "The documented JATA grace policy applies only when the subscription row carries a graceUntil window; this report never invents one.";

/** The safe, staged reconciliation plan. Nothing in it is executed by the audit script. */
export function reconciliationPlan(counts) {
  return [
    {
      step: 1,
      action:
        "Export this report and review the `incorrectlyLive` rows with the owner. Each row is published and switched LIVE with no verified paid entitlement.",
      affectsRows: counts.incorrectlyLive,
      dataChange: "none (review only)",
    },
    {
      step: 2,
      action: `For rows whose subscription lapsed but whose payment history is legitimate, confirm the grace policy before any change. ${GRACE_NOTE}`,
      affectsRows: counts.withPaymentHistory,
      dataChange: "none (policy review)",
    },
    {
      step: 3,
      action:
        "Keep the shipped server-side derivation: every live path re-derives the state, so these rows stop serving customers without any data change. No row edit is required to make the label honest.",
      affectsRows: counts.incorrectlyLive,
      dataChange: "none (server-derived)",
    },
    {
      step: 4,
      action:
        "Optional and owner-authorised after steps 1–3: set the stored operational switch on the affected rows to PAUSED so the saved configuration matches the derived state exactly. Requires written approval and a reviewed, reversible migration.",
      affectsRows: counts.incorrectlyLive,
      dataChange: "UPDATE of the stored AI system-config JSON — NOT performed by this script",
    },
  ];
}
