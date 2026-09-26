import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import RegisterForm from "@/components/RegisterForm";
import { PageShell } from "@/components/ui/PageShell";

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return (
    <PageShell title="Create your account" subtitle="We'll open a draft business page with you as the owner. You can publish without paying.">
      <RegisterForm />
      <p className="mt-4 text-center text-xs text-zinc-500">Already have an account? <a href="/login" className="font-semibold underline">Login</a></p>
    </PageShell>
  );
}
