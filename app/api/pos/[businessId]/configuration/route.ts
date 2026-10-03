import {
  configurationHeadline,
  configurationSummary,
  describeConfiguration,
  validateConfiguration,
} from "@/lib/pos/configuration";
import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { configurationReadiness } from "@/lib/pos/questionnaire";
import { questionnaireView } from "@/lib/pos/questionnaireView";
import { resolveTerminology } from "@/lib/pos/terminology";
import { saveDraft } from "@/lib/pos/provisioning";
import { sanitizeAnswersPayload, sanitizeTerminologyPayload } from "@/lib/pos/validation";

/**
 * The Business Operating Profile (§7, §20, §22).
 *
 * GET returns the current draft in the owner's own words. POST autosaves answers: they are
 * sanitized, pruned of anything no longer relevant (§40), rebuilt into a configuration and
 * stored as a DRAFT. A draft never trades (§44) — publishing is a separate, entitled step.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "EDIT_CONFIGURATION", fast: true },
    fallback: "We couldn't load your POS setup.",
    handler: async ({ ctx }) => {
      const configuration = ctx.configuration;
      const readiness = configurationReadiness(ctx.record?.answers ?? {});
      return posOk({
        businessTypeKey: configuration.business.typeKey,
        businessTypeLabel: configuration.business.typeLabel,
        otherDescription: configuration.business.otherDescription,
        answers: ctx.record?.answers ?? {},
        status: ctx.record?.status ?? "DRAFT",
        lifecycle: ctx.lifecycle,
        lifecycleLabel: ctx.lifecycleLabel,
        draftVersion: ctx.record?.draftVersion ?? 1,
        publishedVersion: ctx.record?.publishedVersion ?? 0,
        hasUnpublishedChanges: (ctx.record?.draftVersion ?? 1) > (ctx.record?.publishedVersion ?? 0),
        readiness,
        validation: validateConfiguration(configuration),
        summary: configurationSummary(configuration),
        headline: configurationHeadline(configuration),
        description: describeConfiguration(configuration),
        terminology: ctx.terminology,
        capabilities: configuration.capabilities,
        view: questionnaireView(ctx.record?.answers ?? {}, readiness.missing),
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "EDIT_CONFIGURATION" },
    fallback: "We couldn't save your POS setup.",
    handler: async ({ ctx, body }) => {
      const saved = await saveDraft({
        businessId,
        answers: sanitizeAnswersPayload(body),
        actorId: ctx.session.userId,
        context: { businessName: ctx.business.name },
        terminology: sanitizeTerminologyPayload(body),
      });

      return fromOutcome(
        { ok: true, warnings: saved.validation.ok ? [] : saved.validation.issues.map((issue) => issue.message) },
        {
          changed: saved.changed,
          status: saved.record.status,
          draftVersion: saved.record.draftVersion,
          readiness: saved.readiness,
          validation: saved.validation,
          summary: configurationSummary(saved.record.draft),
          headline: configurationHeadline(saved.record.draft),
        },
      );
    },
  });
}
