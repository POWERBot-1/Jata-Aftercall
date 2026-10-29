import prisma from "@/lib/db";
import { handleErpRequest, strParam } from "@/lib/erp/http";
import { previewAudience } from "@/lib/messaging/campaigns";

export const dynamic = "force-dynamic";

/**
 * Audience preview.
 *
 * The same function the approval step uses, so what the composer shows and what approval prices
 * cannot drift apart. A read only: no recipient rows are created here.
 */
export async function POST(request: Request, context: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await context.params;
  return handleErpRequest({
    businessId,
    request,
    permission: "VIEW_MESSAGING",
    rateLimit: { key: `erp-preview:${businessId}`, max: 60, windowMs: 60_000 },
    fallback: "We couldn't check that audience just now.",
    handler: async ({ body, url }) => {
      const channel = String(body.channel ?? "SMS").toUpperCase();
      const purpose = String(body.purpose ?? "MARKETING").toUpperCase();
      if (!["SMS", "WHATSAPP", "EMAIL"].includes(channel)) {
        return { status: 400, data: { error: "Choose SMS or WhatsApp." } };
      }
      if (!["MARKETING", "TRANSACTIONAL"].includes(purpose)) {
        return { status: 400, data: { error: "Choose marketing or transactional." } };
      }
      const bodyText = String(body.body ?? "");
      if (bodyText.trim().length < 3) {
        return { status: 400, data: { error: "Write the message first so the cost is real." } };
      }
      const audience = (body.audience ?? {}) as Record<string, unknown>;
      const mode = String(audience.mode ?? "ALL_ELIGIBLE").toUpperCase();
      if (!["ALL_ELIGIBLE", "SELECTED", "TAGS", "OVERDUE_INVOICES", "IMPORTED"].includes(mode)) {
        return { status: 400, data: { error: "Choose an audience." } };
      }
      const preview = await previewAudience(prisma, {
        businessId,
        channel: channel as "SMS" | "WHATSAPP" | "EMAIL",
        purpose: purpose as "MARKETING" | "TRANSACTIONAL",
        body: bodyText,
        definition: {
          mode: mode as "ALL_ELIGIBLE" | "SELECTED" | "TAGS" | "OVERDUE_INVOICES" | "IMPORTED",
          tags: Array.isArray(audience.tags) ? (audience.tags as string[]).map(String).slice(0, 5) : undefined,
          contactIds: Array.isArray(audience.contactIds) ? (audience.contactIds as string[]).map(String).slice(0, 5000) : undefined,
        },
        network: (strParam(url, "network") as "SAFARICOM" | "AIRTEL" | "TELKOM" | "MULTI" | null) ?? "MULTI",
      });
      return {
        data: {
          preview,
          // Percentages are computed for display only; the counts above remain authoritative.
          eligiblePercent: preview.totalContacts ? Math.round((preview.eligibleCount / preview.totalContacts) * 100) : 0,
        },
      };
    },
  });
}
