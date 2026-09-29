import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import RegisterForm from "@/components/RegisterForm";
import { PageShell } from "@/components/ui/PageShell";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Create your account" };

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return (
    <PageShell title="Create your account" subtitle="We'll open a draft business page with you as the owner. Publish once your subscription payment is confirmed.">
      <RegisterForm />
      <p className="mt-4 text-center text-xs text-zinc-500">Already have an account? <a href="/login" className="font-semibold underline">Login</a></p>
    </PageShell>
  );
}
