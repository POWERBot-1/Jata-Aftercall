import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import LoginForm from "@/components/LoginForm";
import { WorkspaceAuthShell } from "@/components/workspace/WorkspaceAuthShell";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  // Only an explicit local destination is permitted; never use an arbitrary next URL.
  const destination = params.next === "agents" ? "/agents/dashboard" : "/dashboard";
  const session = await getSession();
  if (session) redirect(destination);
  return (
    <WorkspaceAuthShell
      title="Welcome back"
      subtitle="Sign in to view your page, share it, and edit each section."
      asideTitle={
        <>
          Your customers are <em>already</em> reaching out.
        </>
      }
      asideCopy="Sign in to see what they did after your page, answer their questions and keep your services, prices and location up to date."
      points={[
        "Your page, plan and website in one workspace",
        "WhatsApp, Call and Directions taps counted — never estimated",
        "Edit from any Android phone, tablet or laptop",
      ]}
      backHref="/"
      backLabel="Home"
      footnote={
        <>
          No account?{" "}
          <Link href="/register" className="font-semibold text-[color:var(--ws-amber-deep)] underline">
            Create one
          </Link>
        </>
      }
    >
      <LoginForm destination={destination} />
    </WorkspaceAuthShell>
  );
}
