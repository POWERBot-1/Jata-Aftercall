import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import PlansClient from "@/components/PlansClient";
import { AdminPage } from "@/components/admin/AdminUI";

export const dynamic = "force-dynamic";

/**
 * Plan prices are stored, not hard-coded (§16): checkout reads PlanConfig server-side, so a change
 * here is the change every surface picks up — the homepage grid, onboarding, the workspace
 * subscription screen, the POS plan screen and the amount Paystack is asked to confirm.
 */
export default async function AdminPlansPage() {
  await requireAdminPage();
  const plans = await prisma.planConfig.findMany({ orderBy: { priceKES: "asc" } });

  return (
    <AdminPage
      kicker="Platform admin"
      title="Plans & pricing"
      meta="Prices, durations and availability come from this table. Nothing anywhere else hard-codes a price."
    >
      <PlansClient plans={plans} />
    </AdminPage>
  );
}
