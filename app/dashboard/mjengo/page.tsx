import { getSession } from "@/lib/auth";
import { getOwnedBusinessIds } from "@/lib/tenant";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MjengoEntry() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/mjengo");
  const owned = await getOwnedBusinessIds(session);
  if (owned.length === 1) redirect(`/dashboard/mjengo/${owned[0]}`);
  if (owned.length > 1) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-bold">MJENGO OS — Choose business</h1>
        <p className="text-muted-foreground">Select a workspace. Business-management is per-business.</p>
        <ul className="mt-4 space-y-2">
          {owned.map((id: string) => (
            <li key={id}>
              <a className="underline" href={`/dashboard/mjengo/${encodeURIComponent(id)}`}>{id}</a>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">MJENGO OS</h1>
      <p>No business found. Create one first.</p>
      <a className="underline" href="/onboarding">Go to onboarding</a>
    </main>
  );
}
