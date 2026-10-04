import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import PlansClient from "@/components/PlansClient";
export const dynamic = "force-dynamic";


export default async function AdminPlansPage() {
  await requireAdminPage();
  const plans = await prisma.planConfig.findMany({ orderBy: { priceKES: "asc" } });
  return (
    <div>
      <h1 className="text-lg font-bold">Plans & pricing</h1>
      <p className="text-xs text-zinc-500">Pricing is DB-driven (§16). Edit here — no hardcoded prices elsewhere.</p>
      <PlansClient plans={plans} />
    </div>
  );
}