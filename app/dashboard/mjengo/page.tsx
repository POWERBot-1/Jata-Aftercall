import { getSession } from "@/lib/auth";
import { getOwnedBusinessIds } from "@/lib/tenant";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MjengoEntry() {
  const session = await getSession();
  if (!session) redirect("/login?next=mjengo");
  const owned = await getOwnedBusinessIds(session);
  if (owned.length === 1) redirect(`/dashboard/mjengo/${owned[0]}`);
  if (owned.length > 1) {
    // Show the owner's own business names (tenant-scoped to the ids resolved above), not raw ids.
    const businesses = await prisma.business
      .findMany({ where: { id: { in: owned } }, select: { id: true, name: true } })
      .catch(() => [] as { id: string; name: string }[]);
    const names = new Map<string, string>(businesses.map((b: { id: string; name: string }) => [b.id, b.name]));
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-bold">MJENGO OS — Choose business</h1>
        <p className="text-muted-foreground">Select a workspace. Business-management is per-business.</p>
        <ul className="mt-4 space-y-2">
          {owned.map((id: string) => (
            <li key={id}>
              <Link className="underline" href={`/dashboard/mjengo/${encodeURIComponent(id)}`}>{names.get(id) || "Unnamed business"}</Link>
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
      <Link className="underline" href="/onboarding">Go to onboarding</Link>
    </main>
  );
}
