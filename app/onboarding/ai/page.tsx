import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/ui/PageShell";
import { AIConfigForm } from "@/components/AIConfigForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Configure AI assistant" };

export const dynamic = "force-dynamic";

export default async function OnboardingAIPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <PageShell
      title="Configure your AI assistant"
      subtitle="Control how your AI responds: tone, language, sales behavior, and escalation rules (§29, §31)."
      backHref="/dashboard"
      backLabel="Dashboard"
    >
      <AIConfigForm userId={session.userId} />
    </PageShell>
  );
}
