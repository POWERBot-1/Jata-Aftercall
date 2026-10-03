import { redirect } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import AIDashboardClient from "@/components/AIDashboardClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Business Front Desk Dashboard — JATA Aftercall",
  description: "Manage AI conversations, orders, pre-orders, unanswered questions, demand intelligence, readiness, and live status.",
};

export default async function AIDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ businessId?: string }>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    redirect("/login?callbackUrl=/dashboard/ai");
  }

  const business = await prisma.business
    .findFirst({
      where: sp?.businessId
        ? { id: sp.businessId, ...(user.role === "ADMIN" ? {} : { ownerId: user.id }) }
        : { ownerId: user.id },
      select: { id: true, name: true, slug: true },
    })
    .catch(() => null);

  return (
    <main id="main">
      <AIDashboardClient
        businessId={business?.id || sp?.businessId || ""}
        businessName={business?.name || "Your Business"}
        businessSlug={business?.slug || "my-business"}
        userEmail={user.email}
        isAdmin={user.role === "ADMIN"}
      />
    </main>
  );
}
