import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding JATA AFTERCALL…");

  // Plans — DB-driven pricing. `isActive: true` is part of both create and update so a
  // re-run always restores the intended KES plans instead of leaving them deactivated.
  const plans = [
    { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365 },
    { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30 },
    // AI Business Front Desk package (§49 — KES 499 / 30 days monthly)
    { key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30 },
  ];
  for (const p of plans) {
    await prisma.planConfig.upsert({ where: { key: p.key }, update: { name: p.name, priceKES: p.priceKES, durationDays: p.durationDays, isActive: true }, create: { ...p, isActive: true } });
  }
  console.log("Plans seeded");

  // Themes
  const themes = [
    { key: "clean", name: "Clean", config: JSON.stringify({ bg: "white" }) },
    { key: "dark", name: "Dark", config: JSON.stringify({ bg: "dark" }) },
    { key: "warm", name: "Warm", config: JSON.stringify({ bg: "warm" }) },
  ];
  for (const t of themes) {
    await prisma.pageTheme.upsert({ where: { key: t.key }, update: { name: t.name }, create: t });
  }

  // Demo admin user
  const adminEmail = (process.env.ADMIN_EMAILS || "admin@jata.link").split(",")[0].trim().toLowerCase();
  const adminHash = await bcrypt.hash("Admin123!", 10);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN" },
    create: { email: adminEmail, name: "Jata Admin", phone: "0700000000", passwordHash: adminHash, role: "ADMIN" },
  });
  console.log("Admin:", admin.email);

  // Demo customer user
  const demoUserEmail = "demo@jata.link";
  const demoHash = await bcrypt.hash("Demo1234!", 10);
  const demoUser = await prisma.user.upsert({
    where: { email: demoUserEmail },
    update: {},
    create: { email: demoUserEmail, name: "Demo Owner", phone: "0722000000", passwordHash: demoHash, role: "CUSTOMER" },
  });

  // Demo businesses
  const demos = [
    {
      slug: "nyumbani-kitchen",
      name: "Nyumbani Kitchen",
      category: "Restaurant",
      phone: "0722123456",
      whatsapp: "0722123456",
      location: "Kilimani, Nairobi",
      description: "Homestyle Kenyan meals — pilau, chapati, nyama choma daily.",
      theme: "warm",
      aftercallMsg: "Thanks for contacting Nyumbani Kitchen 👋",
      offer: { title: "Pilau Combo KES 650", subtitle: "Today only — chapati + stew" },
      services: [
        { title: "Pilau Combo", priceLabel: "KES 650" },
        { title: "Nyama Choma", priceLabel: "From KES 900" },
        { title: "Chapati (2 pcs)", priceLabel: "KES 100" },
      ],
    },
    {
      slug: "marys-beauty-studio",
      name: "Mary's Beauty Studio",
      category: "Beauty",
      phone: "0723987654",
      whatsapp: "0723987654",
      location: "Kitengela, Kajiado",
      description: "Braids, nails & beauty in Kitengela — walk-ins welcome.",
      theme: "clean",
      aftercallMsg: "Thanks for calling Mary! 💇‍♀️",
      offer: { title: "Braids from KES 1,500", subtitle: "This week only" },
      services: [
        { title: "Braiding", priceLabel: "From KES 1,500" },
        { title: "Nails", priceLabel: "From KES 800" },
        { title: "Makeup", priceLabel: "From KES 2,500" },
      ],
    },
    {
      slug: "kamau-auto-care",
      name: "Kamau Auto Care",
      category: "Mechanic",
      phone: "0700111222",
      whatsapp: "0700111222",
      location: "Westlands, Nairobi",
      description: "Diagnostics, oil change, brakes — honest fundi pricing.",
      theme: "dark",
      aftercallMsg: "Thanks for contacting Kamau Auto Care 🔧",
      offer: { title: "Oil Change KES 2,999", subtitle: "Includes filter" },
      services: [
        { title: "Diagnostics", priceLabel: "KES 1,500" },
        { title: "Oil Change", priceLabel: "KES 2,999" },
        { title: "Brake Pads", priceLabel: "From KES 4,500" },
      ],
    },
    {
      slug: "john-kamau-properties",
      name: "John Kamau Properties",
      category: "Real Estate",
      phone: "0733004455",
      whatsapp: "0733004455",
      location: "Kiambu Road, Kiambu",
      description: "Rentals & sales in Kiambu — verified listings, no brokers.",
      theme: "clean",
      aftercallMsg: "Thanks for contacting John Kamau Properties 🏠",
      offer: { title: "1BR from KES 25,000/mo", subtitle: "Kiambu Road — viewing this weekend" },
      services: [
        { title: "1BR Rentals", priceLabel: "From KES 25,000" },
        { title: "2BR Rentals", priceLabel: "From KES 35,000" },
        { title: "Land Sale", priceLabel: "From KES 1.2M" },
      ],
    },
  ];

  for (const d of demos) {
    const business = await prisma.business.upsert({
      where: { slug: d.slug },
      update: {
        name: d.name,
        category: d.category,
        phone: d.phone,
        whatsapp: d.whatsapp,
        location: d.location,
        description: d.description,
        theme: d.theme,
        aftercallMsg: d.aftercallMsg,
        isPublished: true,
        status: "ACTIVE",
        ownerId: demoUser.id,
      },
      create: {
        slug: d.slug,
        name: d.name,
        category: d.category,
        phone: d.phone,
        whatsapp: d.whatsapp,
        location: d.location,
        description: d.description,
        theme: d.theme,
        aftercallMsg: d.aftercallMsg,
        isPublished: true,
        status: "ACTIVE",
        ownerId: demoUser.id,
      },
    });

    await prisma.businessMember.upsert({
      where: { userId_businessId: { userId: demoUser.id, businessId: business.id } },
      update: {},
      create: { userId: demoUser.id, businessId: business.id, role: "OWNER" },
    });

    // Ensure demo businesses have active subscriptions
    const annualPlan = await prisma.planConfig.findUnique({ where: { key: "ANNUAL" } });
    if (annualPlan) {
      await prisma.subscription.upsert({
        where: { businessId: business.id },
        update: { status: "ACTIVE", expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
        create: {
          businessId: business.id,
          userId: demoUser.id,
          planId: annualPlan.id,
          status: "ACTIVE",
          startAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          graceUntil: new Date(Date.now() + 368 * 24 * 60 * 60 * 1000),
        },
      });
      // Seed a PAID payment for demo
      await prisma.payment.upsert({
        where: { reference: `demo-${d.slug}` },
        update: {},
        create: {
          reference: `demo-${d.slug}`,
          businessId: business.id,
          userId: demoUser.id,
          planId: annualPlan.id,
          amount: annualPlan.priceKES * 100,
          currency: "KES",
          status: "PAID",
          paystackId: `demo-${d.slug}`,
          raw: JSON.stringify({ demo: true }),
        },
      });
    }

    for (const [idx, s] of d.services.entries()) {
      const existing = await prisma.service.findFirst({ where: { businessId: business.id, title: s.title } });
      if (!existing) {
        await prisma.service.create({ data: { businessId: business.id, title: s.title, priceLabel: s.priceLabel, sortOrder: idx } });
      }
    }

    await prisma.offer.upsert({
      where: { businessId: business.id },
      update: { title: d.offer.title, subtitle: d.offer.subtitle },
      create: { businessId: business.id, title: d.offer.title, subtitle: d.offer.subtitle },
    });

    console.log("Seeded business:", d.slug);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
