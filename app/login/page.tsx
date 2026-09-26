import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { PageShell } from "@/components/ui/PageShell";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return (
    <PageShell title="Welcome back" subtitle="Sign in to view your page, share it, and edit each section.">
      <LoginForm />
      <p className="mt-4 text-center text-xs text-zinc-500">No account? <a href="/register" className="font-semibold underline">Create one</a></p>
    </PageShell>
  );
}
