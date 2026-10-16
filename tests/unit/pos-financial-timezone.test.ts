/**
 * Financial-document timestamps and report day labels (release report §H.13.3 / D-3b).
 *
 * Receipts, report rows and the wallet health label used the *ambient* server time zone — UTC on
 * Vercel — so a 22:30 Nairobi sale printed as 19:30 and a 00:30 Nairobi sale printed the previous
 * day. They now use the deterministic business-clock formatters (Africa/Nairobi).
 *
 * What this file deliberately does NOT change, and pins as the open decision D-3b-2: the report
 * *period boundaries* and the daily-series *buckets* (`dayRange`/`weekRange`/`monthRange` and
 * `dailySeries` in `lib/pos/reports.ts`) are still derived from the server's ambient day. Changing
 * them would change which transactions belong to which accounting period, so it needs the owner's
 * decision rather than a formatting sweep — the tests below document today's grouping explicitly.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayRange, dailySeries, summarizeSales, type SaleRecord } from "@/lib/pos/reports";
import { receiptToText } from "@/lib/pos/receipt";
import { paymentHealthRows } from "@/lib/payments/wallet";
import type { ReceiptDocument } from "@/lib/pos/types";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** 22:30 in Nairobi on 14 Oct 2026 (19:30Z — the same instant, three hours apart). */
const LATE_SALE = "2026-10-14T19:30:00.000Z";
/** 00:30 in Nairobi on 14 Oct 2026 (21:30Z on the 13th — the UTC date is the *previous* day). */
const AFTER_MIDNIGHT_SALE = "2026-10-13T21:30:00.000Z";

function receipt(issuedAt: string): ReceiptDocument {
  // Matches the real document shape: `issuedAt` is the stored ISO instant, exactly as the sale
  // record carries it.
  return {
    businessName: "Mwangi Hardware",
    contact: [],
    tagline: "Receipt",
    receiptNumber: "MW-000012",
    issuedAt,
    channel: "walk_in",
    lines: [{ name: "Flour 2kg", quantity: 2, unit: "piece", unitPriceKES: 150, discountKES: 0, totalKES: 300 }],
    subtotalKES: 300,
    discountKES: 0,
    taxKES: 0,
    totalKES: 300,
    payments: [{ method: "M-Pesa", amountKES: 300, reference: "QGH7X1" }],
    balanceKES: 0,
  };
}

function sale(createdAt: string, totalKES = 300): SaleRecord {
  return {
    id: `sale_${createdAt}`,
    receiptNumber: "MW-000013",
    createdAt: new Date(createdAt),
    status: "PAID",
    subtotalKES: totalKES,
    discountKES: 0,
    taxKES: 0,
    totalKES,
    paidKES: totalKES,
    balanceKES: 0,
  };
}

describe("a receipt prints the business clock", () => {
  it("shows 22:30 for a sale made at 22:30 in Nairobi, not the server's 19:30", async () => {
    process.env.TZ = "UTC"; // the production server zone
    vi.resetModules();
    const { receiptToText: render } = await import("@/lib/pos/receipt");
    const text = render(receipt(LATE_SALE));
    expect(text).toContain("14 Oct 2026, 22:30");
    expect(text).not.toContain("19:30");
  });

  it("shows 00:30 and the Nairobi date for a sale just after midnight", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { receiptToText: render } = await import("@/lib/pos/receipt");
    const text = render(receipt(AFTER_MIDNIGHT_SALE));
    // 21:30Z on the 13th is 00:30 on the 14th in Nairobi: the printed date must be the 14th.
    expect(text).toContain("14 Oct 2026, 00:30");
    expect(text).not.toContain("13 Oct 2026");
  });

  it("prints the same text under a UTC, a Nairobi, a US and a UTC+14 server", async () => {
    const rendered: string[] = [];
    for (const tz of ["UTC", "Africa/Nairobi", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      vi.resetModules();
      const { receiptToText: render } = await import("@/lib/pos/receipt");
      rendered.push(render(receipt(AFTER_MIDNIGHT_SALE)));
    }
    expect(new Set(rendered).size, `receipt differs per TZ:\n${rendered.join("\n---\n")}`).toBe(1);
    expect(rendered[0]).toContain("14 Oct 2026, 00:30");
  });
});

describe("the wallet health label reads in business time", () => {
  it("labels the last confirmed payment with the Nairobi timestamp, not the server's", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { paymentHealthRows: rows } = await import("@/lib/payments/wallet");
    const health: Parameters<typeof rows>[0] = {
      system: { label: "Payments", ok: true },
      connectors: [],
      events: { ok: true, lastEventAt: null, receivedToday: 0 },
      lastPayment: { at: new Date(LATE_SALE).toISOString(), label: "No payment yet" },
      reconciliation: { ok: true, exceptions: 0 },
      notifications: { ok: true, queued: 0, failed: 0 },
      destinations: { ready: 0, actionRequired: 0, unavailable: 0 },
    };
    const lastPayment = rows(health).find((row) => row.label === "Last payment");
    // UI surfaces use the shared "date · time" shape (lib/format); printed receipts keep their
    // own comma shape (lib/dateFormat) — both are pinned to the business clock, neither moves.
    expect(lastPayment?.value).toBe("14 Oct 2026 · 22:30");
  });
});

describe("report day labels are business time; report periods are unchanged (decision D-3b-2)", () => {
  it("labels a report row with the Nairobi wall clock", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { formatDateTime } = await import("@/lib/format");
    // The exact helper the report row builders call for `when`.
    expect(formatDateTime(AFTER_MIDNIGHT_SALE)).toBe("14 Oct 2026 · 00:30");
    expect(formatDateTime(LATE_SALE)).toBe("14 Oct 2026 · 22:30");
  });

  it("documents today's grouping: the daily series buckets by the server (UTC) day", () => {
    // On the production server (UTC) the day runs 00:00Z–23:59Z, i.e. 03:00–03:00 Nairobi. A sale
    // at 00:30 Nairobi therefore falls in the *previous* UTC bucket. This is the existing
    // accounting boundary and this change does not touch it — redefining it is the owner decision
    // recorded as D-3b-2 in the release report.
    process.env.TZ = "UTC";
    const now = new Date("2026-10-14T09:00:00.000Z"); // 12:00 Nairobi on the 14th
    const range = dayRange(now);
    expect(range.from.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-14T23:59:59.999Z");

    const sales = [sale(AFTER_MIDNIGHT_SALE), sale(LATE_SALE)];
    const summary = summarizeSales(sales, range);
    // The 22:30 sale is inside the 14th's bucket; the 00:30 sale is not (it sits in the 13th's).
    expect(summary.count).toBe(1);
    expect(summary.netKES).toBe(300);

    const series = dailySeries(sales, 2, now);
    expect(series.map((point) => point.date)).toEqual(["2026-10-13", "2026-10-14"]);
    expect(series[0].count).toBe(1); // the 00:30 Nairobi sale, labelled by its UTC date
    expect(series[1].count).toBe(1); // the 22:30 Nairobi sale
    // Both rows still read in Nairobi time, so the same instant is labelled 14 Oct 00:30 while it
    // is counted in the 13 Oct bucket. The display is deterministic; the boundary is the decision.
  });
});

describe("nothing about payment, receipt or reconciliation storage changed", () => {
  it("formats the same instant identically everywhere, whatever the server zone", async () => {
    const seen: string[] = [];
    for (const tz of ["UTC", "Africa/Nairobi", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      vi.resetModules();
      const { formatDateTime, formatDate } = await import("@/lib/format");
      seen.push(`${formatDateTime(AFTER_MIDNIGHT_SALE)}|${formatDate(AFTER_MIDNIGHT_SALE)}`);
    }
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe("14 Oct 2026 · 00:30|14 Oct 2026");
  });

  it("keeps the money helpers locale-pinned and zone-independent", () => {
    // Amounts were never zone-dependent: they pass an explicit locale, so the digits cannot move.
    const text = receiptToText(receipt(AFTER_MIDNIGHT_SALE));
    expect(text).toContain("KES 300");
    expect(text).toContain("QGH7X1");
  });
});
