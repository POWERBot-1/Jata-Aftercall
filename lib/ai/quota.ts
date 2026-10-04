/**
 * AI usage control (§17, §43, §51)
 *
 * Generation costs real money per call, so it is metered per business and per period, and the
 * meter is derived from the generation history the Studio already stores — there is no second
 * counter to drift out of sync.
 *
 * The Interactive Business package (KES 999/month) includes a generous monthly allowance. A
 * business that has not yet activated the package keeps a small preview allowance, so an owner
 * can see what JATA will do for them *before* paying — but never an unlimited free loop.
 */

export type AiCapability = "IMAGE" | "ENHANCE" | "COPY" | "ALT_TEXT";

export type AiQuota = {
  planKey: string;
  /** Images created per rolling month. */
  imagesPerMonth: number;
  /** Photo improvements per rolling month. */
  enhancesPerMonth: number;
  /** Copy/alt-text assists per rolling month. */
  copyPerMonth: number;
  /** Maximum candidates requested in a single generation. */
  maxCandidatesPerRequest: number;
  /** Minimum gap between generations for one business, in milliseconds. */
  minIntervalMs: number;
  label: string;
};

export const INTERACTIVE_AI_QUOTA: AiQuota = {
  planKey: "INTERACTIVE_BUSINESS",
  imagesPerMonth: 40,
  enhancesPerMonth: 40,
  copyPerMonth: 400,
  maxCandidatesPerRequest: 4,
  minIntervalMs: 4_000,
  label: "Interactive Business",
};

/** Preview allowance: enough to try the studio, not enough to run a business on. */
export const PREVIEW_AI_QUOTA: AiQuota = {
  planKey: "PREVIEW",
  imagesPerMonth: 3,
  enhancesPerMonth: 3,
  copyPerMonth: 40,
  maxCandidatesPerRequest: 2,
  minIntervalMs: 8_000,
  label: "Preview",
};

export function quotaForPlan(input: { entitled: boolean; planKey?: string | null }): AiQuota {
  if (!input.entitled) return PREVIEW_AI_QUOTA;
  return INTERACTIVE_AI_QUOTA;
}

export type UsageRecord = {
  kind: string;
  status: string;
  createdAt: Date | string;
  /**
   * The candidates a generation produced, stored by `generationStore`. One request that returns
   * three images spends three images of the monthly allowance — the meter must match the bill.
   */
  assetIds?: string | string[] | null;
};

export type QuotaUsage = {
  quota: AiQuota;
  periodStart: Date;
  used: { images: number; enhances: number; copy: number };
  remaining: { images: number; enhances: number; copy: number };
  /** Percentage of the image allowance used, for the Studio's capacity bar. */
  imagePercent: number;
  unlimited: false;
};

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function candidateCount(record: UsageRecord): number {
  const raw = record.assetIds;
  if (Array.isArray(raw)) return Math.max(1, raw.length);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return Math.max(1, parsed.length);
    } catch {
      // A malformed list still spent one request.
    }
  }
  return 1;
}

function countKind(records: UsageRecord[], kind: string): number {
  return records
    .filter((record) => record.kind === kind && record.status === "SUCCEEDED")
    .reduce((total, record) => total + candidateCount(record), 0);
}

export function quotaUsage(input: { quota: AiQuota; records: UsageRecord[]; now?: Date }): QuotaUsage {
  const now = input.now ?? new Date();
  const periodStart = startOfMonth(now);
  const inPeriod = input.records.filter((record) => {
    const created = record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt);
    return created.getTime() >= periodStart.getTime();
  });
  // A copy assist and an alt-text assist draw on the same allowance: both are cheap text calls.
  const copyUsed = countKind(inPeriod, "COPY") + countKind(inPeriod, "ALT_TEXT");
  const images = countKind(inPeriod, "IMAGE");
  const enhances = countKind(inPeriod, "ENHANCE");
  const imagePercent = input.quota.imagesPerMonth === 0 ? 100 : Math.min(100, Math.round((images / input.quota.imagesPerMonth) * 100));
  return {
    quota: input.quota,
    periodStart,
    used: { images, enhances, copy: copyUsed },
    remaining: {
      images: Math.max(0, input.quota.imagesPerMonth - images),
      enhances: Math.max(0, input.quota.enhancesPerMonth - enhances),
      copy: Math.max(0, input.quota.copyPerMonth - copyUsed),
    },
    imagePercent,
    unlimited: false,
  };
}

export type QuotaDecision =
  | { status: "ok"; remaining: number }
  | { status: "blocked"; code: "quota_exhausted" | "too_soon"; message: string; retryAfterMs?: number };

/**
 * The gate every generation passes through, before any provider is called (§51: no repeated
 * calls, no runaway loop).
 */
export function checkQuota(input: {
  capability: AiCapability;
  usage: QuotaUsage;
  requested?: number;
  lastGenerationAt?: Date | string | null;
  now?: Date;
}): QuotaDecision {
  const now = input.now ?? new Date();
  const requested = Math.max(1, Math.min(input.requested ?? 1, input.usage.quota.maxCandidatesPerRequest));

  if (input.lastGenerationAt) {
    const last = input.lastGenerationAt instanceof Date ? input.lastGenerationAt : new Date(input.lastGenerationAt);
    const elapsed = now.getTime() - last.getTime();
    if (elapsed < input.usage.quota.minIntervalMs) {
      return {
        status: "blocked",
        code: "too_soon",
        message: "JATA is still finishing your last image. Give it a few seconds.",
        retryAfterMs: input.usage.quota.minIntervalMs - elapsed,
      };
    }
  }

  if (input.capability === "IMAGE") {
    if (input.usage.remaining.images < requested) {
      return {
        status: "blocked",
        code: "quota_exhausted",
        message:
          input.usage.remaining.images === 0
            ? `You have used all ${input.usage.quota.imagesPerMonth} AI images included this month. They reset on the 1st, and your existing images stay yours.`
            : `Only ${input.usage.remaining.images} AI image${input.usage.remaining.images === 1 ? "" : "s"} left this month — reduce the number of options.`,
      };
    }
    return { status: "ok", remaining: input.usage.remaining.images };
  }

  if (input.capability === "ENHANCE") {
    if (input.usage.remaining.enhances <= 0) {
      return {
        status: "blocked",
        code: "quota_exhausted",
        message: `You have used all ${input.usage.quota.enhancesPerMonth} photo improvements this month. You can still improve photos on your phone with the free editor.`,
      };
    }
    return { status: "ok", remaining: input.usage.remaining.enhances };
  }

  if (input.usage.remaining.copy <= 0) {
    return {
      status: "blocked",
      code: "quota_exhausted",
      message: "You have used a lot of writing help this month. You can keep editing every field by hand, and help resets on the 1st.",
    };
  }
  return { status: "ok", remaining: input.usage.remaining.copy };
}

/** Owner-facing summary line for the studio banner (§52: plain language, no jargon). */
export function quotaSummaryLine(usage: QuotaUsage): string {
  if (usage.remaining.images === 0) {
    return `No AI images left this month (${usage.used.images} used). Resets on the 1st.`;
  }
  return `${usage.remaining.images} of ${usage.quota.imagesPerMonth} AI images left this month.`;
}
