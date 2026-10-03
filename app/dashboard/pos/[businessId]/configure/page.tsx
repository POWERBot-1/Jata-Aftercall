import Link from "next/link";
import { configurationHeadline, configurationSummary, describeConfiguration } from "@/lib/pos/configuration";
import { configurationReadiness } from "@/lib/pos/questionnaire";
import { questionnaireView } from "@/lib/pos/questionnaireView";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { QuestionnaireClient } from "@/components/pos/QuestionnaireClient";

/**
 * Configure the POS (§4, §20, §41, §42, §43).
 *
 * The owner answers questions in their own words; JATA turns the answers into a Business
 * Operating Profile and shows it back as a plain-language summary they can edit. No screen here
 * mentions schemas, capabilities or feature flags (§3, §38).
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Configure your POS" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosConfigurePage({ params }: Props) {
  const { businessId } = await params;
  const workspace = await loadPosWorkspaceCached(businessId);

  if (!workspace.permissions.includes("EDIT_CONFIGURATION")) {
    return (
      <div className="jata-card p-6">
        <p className="jata-kicker">Not allowed</p>
        <h2 className="text-lg font-bold">Only the owner can change how the POS works</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Ask the owner of {workspace.business.name} if something needs to change. You can still use
          the POS for selling.
        </p>
        <Link href={workspace.basePath} className="jata-btn jata-btn-secondary mt-4">Back to the dashboard</Link>
      </div>
    );
  }

  const answers = workspace.record?.answers ?? {};
  const readiness = configurationReadiness(answers);
  const configuration = workspace.configuration;
  const view = questionnaireView(answers, readiness.missing);

  return (
    <div className="space-y-4">
      <div>
        <p className="jata-kicker">Step 2 of 5</p>
        <h2 className="text-xl font-bold">Tell JATA how your business works</h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          Short questions, one at a time. Answer what you know and skip what you don&apos;t — you can
          change anything later, and you can start selling before you finish.
        </p>
      </div>

      <QuestionnaireClient
        businessId={businessId}
        basePath={workspace.basePath}
        view={view}
        answers={answers}
        summary={configurationSummary(configuration)}
        headline={configurationHeadline(configuration)}
        description={describeConfiguration(configuration)}
        terminology={workspace.terminology}
        wordsEditable={Boolean(answers.custom_words)}
        ready={readiness.ready}
        missing={readiness.missing}
        status={workspace.record?.status ?? "DRAFT"}
        lifecycleLabel={workspace.lifecycleLabel}
        entitled={workspace.entitlement.entitled}
        publishedVersion={workspace.record?.publishedVersion ?? 0}
        draftVersion={workspace.record?.draftVersion ?? 1}
      />
    </div>
  );
}
