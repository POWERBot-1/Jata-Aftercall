import type { Metadata } from "next";
import { PageShell } from "@/components/ui/PageShell";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset password",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <PageShell title="Choose a new password" subtitle="Reset links expire after 30 minutes and can only be used once.">
      <ResetPasswordForm />
      <p className="mt-4 text-center text-xs text-zinc-500">
        <a href="/login" className="font-semibold underline">Back to sign in</a>
      </p>
    </PageShell>
  );
}
