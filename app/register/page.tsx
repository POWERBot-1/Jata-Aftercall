import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import RegisterForm from "@/components/RegisterForm";

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-md px-4 py-10">
        <a href="/" className="text-sm font-semibold">← Back</a>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-zinc-600">Start your JATA AFTERCALL page — ~5 minutes.</p>
        <RegisterForm />
        <p className="mt-4 text-center text-xs text-zinc-500">Already have an account? <a href="/login" className="font-semibold underline">Login</a></p>
      </div>
    </div>
  );
}
