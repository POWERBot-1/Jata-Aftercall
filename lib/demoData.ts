/**
 * The four advertised demo businesses (homepage "Demo businesses") and the narrow, idempotent
 * mechanism that restores ONLY them.
 *
 * Why this exists: the public demo pages were live but empty ("Contact details coming soon",
 * "No services listed yet"). The global `prisma/seed.ts` is the wrong tool for production — it
 * also creates an admin with a known default password — so this module touches nothing but
 * these four slugs, never creates a user, and never writes subscriptions or payments.
 *
 * Safety boundary: there is no demo marker column on `Business`, so exact slugs are combined with
 * the dedicated `demo@jata.link` owner identity and the absence of non-demo payment references.
 * A slug alone never proves that a real owner's row is synthetic.
 *
 * Contact numbers are deliberately placeholders (0700 000 00x), not anyone's real line. Every
 * business, contact detail, service, offer and price below is synthetic demo content, not a live
 * business, current offer, quote, property listing or availability statement.
 */

export type DemoService = {
  title: string;
  description: string;
  priceLabel: string;
  priceFrom: number;
  category: string;
};

export type DemoBusiness = {
  slug: string;
  name: string;
  category: string;
  description: string;
  phone: string;
  whatsapp: string;
  location: string;
  theme: "clean" | "dark" | "warm";
  aftercallMsg: string;
  openingHours: Record<string, string>;
  offer: { title: string; subtitle: string };
  services: DemoService[];
};

const EXAMPLE_NOTE = "Fictional demonstration data: contact details, services, offers and prices are samples, not a live business or current offer, quote, listing or availability.";

export const DEMO_BUSINESSES: readonly DemoBusiness[] = [
  {
    slug: "nyumbani-kitchen",
    name: "Nyumbani Kitchen",
    category: "Restaurant",
    description: `Sample Kenyan meal-service entries for a fictional page. ${EXAMPLE_NOTE}`,
    phone: "0700000001",
    whatsapp: "0700000001",
    location: "Kilimani, Nairobi",
    theme: "warm",
    aftercallMsg: "Thanks for contacting Nyumbani Kitchen 👋",
    openingHours: { mon_sat: "08:00 – 21:00", sun: "10:00 – 18:00" },
    offer: { title: "Example meal combo — KES 650", subtitle: "Fictional sample only; not a current menu or offer." },
    services: [
      { title: "Pilau Combo", description: "Fictional sample menu entry; not today's menu.", priceLabel: "KES 650", priceFrom: 650, category: "Meals" },
      { title: "Nyama Choma", description: "Fictional sample menu entry; details and price are examples.", priceLabel: "From KES 900", priceFrom: 900, category: "Meals" },
      { title: "Chapati (2 pcs)", description: "Fictional sample menu entry; details and price are examples.", priceLabel: "KES 100", priceFrom: 100, category: "Sides" },
    ],
  },
  {
    slug: "marys-beauty-studio",
    name: "Mary's Beauty Studio",
    category: "Beauty",
    description: `Sample braiding, nail and makeup service entries for a fictional page. ${EXAMPLE_NOTE}`,
    phone: "0700000002",
    whatsapp: "0700000002",
    location: "Kitengela, Kajiado",
    theme: "clean",
    aftercallMsg: "Thanks for calling Mary! 💇‍♀️",
    openingHours: { mon_sat: "08:00 – 19:00", sun: "Closed" },
    offer: { title: "Example braid price — from KES 1,500", subtitle: "Fictional sample only; not a current promotion." },
    services: [
      { title: "Braiding", description: "Fictional sample braiding entry; details and price are examples.", priceLabel: "From KES 1,500", priceFrom: 1500, category: "Hair" },
      { title: "Nails", description: "Fictional sample nail-service entry; details and price are examples.", priceLabel: "From KES 800", priceFrom: 800, category: "Nails" },
      { title: "Makeup", description: "Fictional sample makeup entry; details and price are examples.", priceLabel: "From KES 2,500", priceFrom: 2500, category: "Makeup" },
    ],
  },
  {
    slug: "kamau-auto-care",
    name: "Kamau Auto Care",
    category: "Mechanic",
    description: `Sample diagnostics, oil-change and brake service entries for a fictional page. ${EXAMPLE_NOTE}`,
    phone: "0700000003",
    whatsapp: "0700000003",
    location: "Westlands, Nairobi",
    theme: "dark",
    aftercallMsg: "Thanks for contacting Kamau Auto Care 🔧",
    openingHours: { mon_fri: "07:30 – 18:00", sat: "08:00 – 16:00", sun: "Closed" },
    offer: { title: "Example oil-change price — KES 2,999", subtitle: "Fictional sample only; not a current quote." },
    services: [
      { title: "Diagnostics", description: "Fictional sample diagnostics entry; not a current quote.", priceLabel: "KES 1,500", priceFrom: 1500, category: "Service" },
      { title: "Oil Change", description: "Fictional sample oil-change entry; not a current quote.", priceLabel: "KES 2,999", priceFrom: 2999, category: "Service" },
      { title: "Brake Pads", description: "Fictional sample brake-service entry; not a current quote.", priceLabel: "From KES 4,500", priceFrom: 4500, category: "Repair" },
    ],
  },
  {
    slug: "john-kamau-properties",
    name: "John Kamau Properties",
    category: "Real Estate",
    description: `Fictional property-page demonstration. Category labels and prices are examples, not current listings or viewing availability. ${EXAMPLE_NOTE}`,
    phone: "0700000004",
    whatsapp: "0700000004",
    location: "Kiambu Road, Kiambu",
    theme: "clean",
    aftercallMsg: "Thanks for contacting John Kamau Properties 🏠",
    openingHours: { mon_fri: "08:30 – 17:30", sat: "09:00 – 14:00", sun: "By appointment" },
    offer: { title: "Example rent range — KES 25,000/month", subtitle: "Fictional sample only; not a current rental or sale listing." },
    services: [
      { title: "1BR Rentals", description: "Fictional category only; not an available rental listing.", priceLabel: "From KES 25,000", priceFrom: 25000, category: "Rentals" },
      { title: "2BR Rentals", description: "Fictional category only; not an available rental listing.", priceLabel: "From KES 35,000", priceFrom: 35000, category: "Rentals" },
      { title: "Land Sale", description: "Fictional category only; not an available land listing.", priceLabel: "From KES 1.2M", priceFrom: 1200000, category: "Sales" },
    ],
  },
];

export const DEMO_SLUGS: readonly string[] = DEMO_BUSINESSES.map((demo) => demo.slug);

/** Dedicated owner account created by the non-production demo seed. */
export const DEMO_OWNER_EMAIL = "demo@jata.link";

/** Reference prefix `prisma/seed.ts` uses for its fabricated demo payment rows. */
export const DEMO_PAYMENT_PREFIX = "demo-";

/** Minimal database surface the remediation needs — satisfied by PrismaClient. */
export type DemoDb = {
  business: { findUnique: (args: any) => Promise<any>; create: (args: any) => Promise<any>; update: (args: any) => Promise<any> };
  service: { findFirst: (args: any) => Promise<any>; create: (args: any) => Promise<any>; update: (args: any) => Promise<any> };
  offer: { upsert: (args: any) => Promise<any> };
  payment: { findMany: (args: any) => Promise<any[]> };
  user: { findUnique: (args: any) => Promise<any> };
  $transaction: <T>(work: (tx: any) => Promise<T>) => Promise<T>;
};

export type DemoOutcome = {
  slug: string;
  action: "created" | "updated" | "skipped";
  reason?: string;
  servicesCreated: number;
  servicesUpdated: number;
};

export type DemoReport = { applied: boolean; outcomes: DemoOutcome[] };

function businessContent(demo: DemoBusiness) {
  return {
    name: demo.name,
    category: demo.category,
    description: demo.description,
    phone: demo.phone,
    whatsapp: demo.whatsapp,
    location: demo.location,
    theme: demo.theme,
    aftercallMsg: demo.aftercallMsg,
    openingHours: JSON.stringify(demo.openingHours),
  };
}

/**
 * Restore the demo content. Dry-run unless `apply` is true.
 *
 * - Targets only `DEMO_SLUGS`, looked up by exact slug, and only when the existing row belongs to
 *   the dedicated `DEMO_OWNER_EMAIL` account.
 * - Existing rows with another owner or any payment outside the seed's `demo-` namespace are
 *   skipped, never overwritten.
 * - Missing rows are created only for an EXISTING `DEMO_OWNER_EMAIL` user; a caller cannot assign
 *   fictional demo content to an arbitrary real customer. Users are never created.
 * - Services are matched by exact title inside the verified demo business and never deleted; the
 *   offer is upserted by business. Repeating the run changes nothing.
 */
export async function restoreDemoBusinesses(db: DemoDb, options: { apply: boolean; ownerEmail?: string | null }): Promise<DemoReport> {
  const outcomes: DemoOutcome[] = [];

  for (const demo of DEMO_BUSINESSES) {
    const existing = await db.business.findUnique({ where: { slug: demo.slug } });
    const content = businessContent(demo);

    if (!existing) {
      const email = (options.ownerEmail ?? "").trim().toLowerCase();
      if (email !== DEMO_OWNER_EMAIL) {
        outcomes.push({ slug: demo.slug, action: "skipped", reason: `missing; creation is restricted to the existing ${DEMO_OWNER_EMAIL} demo account`, servicesCreated: 0, servicesUpdated: 0 });
        continue;
      }
      const owner = await db.user.findUnique({ where: { email: DEMO_OWNER_EMAIL }, select: { id: true } });
      if (!owner) {
        outcomes.push({ slug: demo.slug, action: "skipped", reason: `missing and the existing ${DEMO_OWNER_EMAIL} demo account was not found (users are never created)`, servicesCreated: 0, servicesUpdated: 0 });
        continue;
      }
      if (!options.apply) {
        outcomes.push({ slug: demo.slug, action: "created", reason: "dry run", servicesCreated: demo.services.length, servicesUpdated: 0 });
        continue;
      }
      const counts = await db.$transaction(async (tx) => {
        const created = await tx.business.create({
          data: { slug: demo.slug, ownerId: owner.id, ...content, isPublished: true, status: "ACTIVE", members: { create: { userId: owner.id, role: "OWNER" } } },
        });
        return writeChildren(tx, created.id, demo);
      });
      outcomes.push({ slug: demo.slug, action: "created", ...counts });
      continue;
    }

    const owner = await db.user.findUnique({ where: { id: existing.ownerId }, select: { id: true, email: true } });
    if (owner?.email?.trim().toLowerCase() !== DEMO_OWNER_EMAIL) {
      outcomes.push({ slug: demo.slug, action: "skipped", reason: "owned by a non-demo account; fictional content was not written", servicesCreated: 0, servicesUpdated: 0 });
      continue;
    }

    const payments = await db.payment.findMany({ where: { businessId: existing.id }, select: { reference: true } });
    const realPayments = payments.filter((payment) => !String(payment.reference).startsWith(DEMO_PAYMENT_PREFIX));
    if (realPayments.length > 0) {
      outcomes.push({ slug: demo.slug, action: "skipped", reason: `has ${realPayments.length} non-demo payment record(s); treated as a real customer business`, servicesCreated: 0, servicesUpdated: 0 });
      continue;
    }

    if (!options.apply) {
      outcomes.push({ slug: demo.slug, action: "updated", reason: "dry run", servicesCreated: 0, servicesUpdated: 0 });
      continue;
    }

    const counts = await db.$transaction(async (tx) => {
      await tx.business.update({ where: { id: existing.id }, data: content });
      return writeChildren(tx, existing.id, demo);
    });
    outcomes.push({ slug: demo.slug, action: "updated", ...counts });
  }

  return { applied: options.apply, outcomes };
}

async function writeChildren(tx: DemoDb, businessId: string, demo: DemoBusiness) {
  let servicesCreated = 0;
  let servicesUpdated = 0;
  for (const [index, service] of demo.services.entries()) {
    const data = {
      description: service.description,
      priceLabel: service.priceLabel,
      priceFrom: service.priceFrom,
      category: service.category,
      sortOrder: index,
      isActive: true,
    };
    const found = await tx.service.findFirst({ where: { businessId, title: service.title } });
    if (found) {
      await tx.service.update({ where: { id: found.id }, data });
      servicesUpdated += 1;
    } else {
      await tx.service.create({ data: { businessId, title: service.title, ...data } });
      servicesCreated += 1;
    }
  }
  await tx.offer.upsert({
    where: { businessId },
    update: { title: demo.offer.title, subtitle: demo.offer.subtitle, validUntil: null, isActive: true },
    create: { businessId, title: demo.offer.title, subtitle: demo.offer.subtitle, validUntil: null, isActive: true },
  });
  return { servicesCreated, servicesUpdated };
}
