import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-md px-4 py-10">
        <a href="/" className="text-sm font-semibold">← Back</a>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-zinc-600">Sign in to manage your business page.</p>
        <LoginForm />
        <p className="mt-4 text-center text-xs text-zinc-500">No account? <a href="/register" className="font-semibold underline">Create one</a></p>
      </div>
    </div>
  );
}
