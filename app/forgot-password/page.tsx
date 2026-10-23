import type { Metadata } from "next";
import { PageShell } from "@/components/ui/PageShell";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <PageShell title="Reset your password" subtitle="We’ll send a one-time link if an account matches that email address.">
      <ForgotPasswordForm />
      <p className="mt-4 text-center text-xs text-zinc-500">
        <a href="/login" className="font-semibold underline">Back to sign in</a>
      </p>
    </PageShell>
  );
}
