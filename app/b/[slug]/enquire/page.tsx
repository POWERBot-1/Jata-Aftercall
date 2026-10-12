import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { loadStorefront } from "@/lib/experience/storefront";
import { StorefrontShell } from "@/components/storefront/StorefrontShell";
import { EnquiryClient } from "@/components/storefront/EnquiryClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Service enquiry", robots: { index: false, follow: false } };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ service?: string }> };
async function canPreview(slug: string): Promise<boolean> {
  const session = await getSession(); if (!session) return false; if (session.role === "ADMIN") return true;
  const business = await prisma.business.findUnique({ where: { slug }, select: { ownerId: true, members: { select: { userId: true } } } });
  return Boolean(business && (business.ownerId === session.userId || business.members.some((member) => member.userId === session.userId)));
}
export default async function EnquiryPage({ params, searchParams }: Props) {
  const { slug } = await params; const { service } = await searchParams;
  const data = await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  if (!data || data.document.categoryKey !== "professional") notFound();
  const services = data.services.filter((entry) => entry.kind === "service");
  // Never silently substitute this business's first service for a foreign/stale query parameter.
  if (service && !services.some((entry) => entry.id === service)) notFound();
  return <StorefrontShell data={data} previewNotice={data.isPreview ? "Draft preview — only you can see these unpublished changes." : null}>
    <section className="eb-section"><div className="eb-container">
      <header className="eb-section-head"><h1 className="eb-h2">Request a quote or ask about a service</h1></header>
      <EnquiryClient slug={data.business.slug} preselectedId={service} preview={data.isPreview} services={services.map((entry) => ({ id: entry.id,
        name: entry.name, description: entry.description, kind: "service", price: entry.price, pricingType: entry.pricingType, bookingEnabled: entry.bookingEnabled }))} />
    </div></section>
  </StorefrontShell>;
}
