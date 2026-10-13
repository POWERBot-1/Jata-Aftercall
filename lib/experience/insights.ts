/**
 * Business intelligence (§30–§32)
 *
 * One place computes the owner-facing numbers, so the dashboard page and the analytics API
 * can never disagree. Every query is filtered by businessId; the caller owns the ownership
 * check (§37).
 */

import prisma from "@/lib/db";
import { displayPriceKES } from "@/lib/sale-pricing";
import { conversionRate, EMPTY_METRICS, getBusinessMetricsSince, getTopSubjects, type BusinessMetrics, type EventType } from "@/lib/analytics";

export type BusinessSummary = {
  today: {
    visitors: number;
    orders: number;
    paidOrders: number;
    sales: number;
    conversion: number;
    bookings: number;
  };
  week: {
    visitors: number;
    productViews: number;
    serviceViews: number;
    searches: number;
    addToCart: number;
    checkoutStarted: number;
    paymentStarted: number;
    paymentSuccess: number;
    bookings: number;
  };
  totals: {
    sales: number;
    orders: number;
    customers: number;
    returningCustomers: number;
    newCustomersThisWeek: number;
  };
  metrics: BusinessMetrics;
  allTimeMetrics: BusinessMetrics;
  topProducts: Array<{ id: string; name: string; basePriceKES: number | null; salePriceKES: number | null; imageUrl: string | null; views: number }>;
  topServices: Array<{ id: string; name: string; priceFrom: number | null; views: number }>;
  attention: Array<{ id: string; name: string; stockStatus: string }>;
};

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function emptySummary(): BusinessSummary {
  return {
    today: { visitors: 0, orders: 0, paidOrders: 0, sales: 0, conversion: 0, bookings: 0 },
    week: { visitors: 0, productViews: 0, serviceViews: 0, searches: 0, addToCart: 0, checkoutStarted: 0, paymentStarted: 0, paymentSuccess: 0, bookings: 0 },
    totals: { sales: 0, orders: 0, customers: 0, returningCustomers: 0, newCustomersThisWeek: 0 },
    metrics: { ...EMPTY_METRICS },
    allTimeMetrics: { ...EMPTY_METRICS },
    topProducts: [],
    topServices: [],
    attention: [],
  };
}

export async function businessSummary(businessId: string): Promise<BusinessSummary> {
  const now = new Date();
  const todayStart = startOfToday(now);
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);

  const [todayMetrics, weekMetrics, ordersToday, paidOrders, revenue, customers, topProducts, topServices, lowStock, newCustomers] =
    await Promise.all([
      getBusinessMetricsSince(businessId, todayStart),
      getBusinessMetricsSince(businessId, weekStart),
      prisma.order.count({ where: { businessId, createdAt: { gte: todayStart } } }),
      prisma.order.aggregate({
        where: { businessId, paymentStatus: "PAID", createdAt: { gte: todayStart } },
        _sum: { totalKES: true },
        _count: { _all: true },
      }),
      prisma.order.aggregate({ where: { businessId, paymentStatus: "PAID" }, _sum: { totalKES: true }, _count: { _all: true } }),
      prisma.order.groupBy({ by: ["customerPhone"], where: { businessId, customerPhone: { not: null } }, _count: { customerPhone: true } }),
      getTopSubjects(businessId, "PRODUCT_VIEW" as EventType, 5),
      getTopSubjects(businessId, "SERVICE_VIEW" as EventType, 5),
      prisma.product.findMany({
        where: { businessId, isActive: true, stockStatus: { in: ["OUT_OF_STOCK", "LOW_STOCK"] } },
        select: { id: true, name: true, stockStatus: true },
        take: 8,
      }),
      prisma.order.groupBy({
        by: ["customerPhone"],
        where: { businessId, createdAt: { gte: weekStart }, customerPhone: { not: null } },
        _count: { customerPhone: true },
      }),
    ]);

  const productIds = topProducts.map((entry) => entry.subjectId);
  const serviceIds = topServices.map((entry) => entry.subjectId);
  const [productRows, serviceRows] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { businessId, id: { in: productIds } },
          select: { id: true, name: true, basePriceKES: true, salePriceKES: true, salePriceStartsAt: true, salePriceEndsAt: true, imageUrl: true },
        })
      : Promise.resolve([]),
    serviceIds.length
      ? prisma.service.findMany({ where: { businessId, id: { in: serviceIds } }, select: { id: true, title: true, priceFrom: true } })
      : Promise.resolve([]),
  ]);

  const totalCustomers = customers.length;
  const returningCustomers = customers.filter((row) => row._count.customerPhone > 1).length;
  const newThisWeek = newCustomers.filter((row) => row._count.customerPhone === 1).length;

  return {
    today: {
      visitors: todayMetrics.views,
      orders: ordersToday,
      paidOrders: paidOrders._count._all,
      sales: paidOrders._sum.totalKES || 0,
      conversion: conversionRate(todayMetrics.checkoutStarted || todayMetrics.addToCart, paidOrders._count._all),
      bookings: todayMetrics.bookings,
    },
    week: {
      visitors: weekMetrics.views,
      productViews: weekMetrics.productViews,
      serviceViews: weekMetrics.serviceViews,
      searches: weekMetrics.searches,
      addToCart: weekMetrics.addToCart,
      checkoutStarted: weekMetrics.checkoutStarted,
      paymentStarted: weekMetrics.paymentStarted,
      paymentSuccess: weekMetrics.paymentSuccess,
      bookings: weekMetrics.bookings,
    },
    totals: {
      sales: revenue._sum.totalKES || 0,
      orders: revenue._count._all,
      customers: totalCustomers,
      returningCustomers,
      newCustomersThisWeek: newThisWeek,
    },
    metrics: weekMetrics,
    allTimeMetrics: { ...EMPTY_METRICS },
    topProducts: productRows.map((product) => ({
      id: product.id,
      name: product.name,
      basePriceKES: product.basePriceKES,
      // Only a sale running now is reported; an expired or unscheduled sale is not.
      salePriceKES: displayPriceKES(product).wasPriceKES !== null ? product.salePriceKES : null,
      imageUrl: product.imageUrl,
      views: topProducts.find((entry) => entry.subjectId === product.id)?.count || 0,
    })),
    topServices: serviceRows.map((service) => ({
      id: service.id,
      name: service.title,
      priceFrom: service.priceFrom,
      views: topServices.find((entry) => entry.subjectId === service.id)?.count || 0,
    })),
    attention: lowStock.map((row) => ({ id: row.id, name: row.name, stockStatus: String(row.stockStatus) })),
  };
}
