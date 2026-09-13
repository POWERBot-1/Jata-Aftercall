import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import OnboardingForm from "@/components/OnboardingForm";
export const dynamic = "force-dynamic";


export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let plans: { id: string; key: string; name: string; priceKES: number }[] = [];
  try {
    const pcs = await prisma.planConfig.findMany({ where: { isActive: true } });
    plans = pcs.map((p) => ({ id: p.id, key: p.key, name: p.name, priceKES: p.priceKES }));
  } catch {
    plans = [];
  }
  if (plans.length === 0) {
    plans = [
      { id: "mock-annual", key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999 },
      { id: "mock-monthly", key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149 },
    ];
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <a href="/dashboard" className="text-sm font-medium">← Dashboard</a>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Create your business page</h1>
        <p className="text-sm text-zinc-600">Steps 1–4: business info → style → services → offer → preview → publish</p>
        <OnboardingForm plans={plans} />
      </div>
    </div>
  );
}