/**
 * Controlled AI Tool Architecture (§9, §10, §11, §18, §19, §20, §23, §45).
 *
 * The AI never has arbitrary database access. Every operation goes through an explicit,
 * tenant-scoped tool classified into:
 * - READ: products, inventory, pricing, business hours, delivery, FAQs, promotions, payment status
 * - WRITE: lead, order, preorder, booking, payment request, human escalation, owner notification
 * - HIGH_RISK: refund, cancel order, change price, change inventory, modify business configuration
 *
 * High-risk tools require explicit server-side owner/admin authorization and are NEVER
 * executable by customer conversation prompts.
 */

import { getBusinessBrain } from "./ai-business-brain";
import { resolveDeliveryZoneFee } from "./ai-config";
import { calculateCommerceTotal } from "./commerce-pricing";
import { evaluateProductAvailability } from "./inventory";
import { captureLead, type LeadClassification } from "./leads";
import { createAuthoritativeOrder, hasServerVerifiedOrderPayment } from "./order";
import { createPreOrderSummary, resolvePreorderPricing } from "./preorder";
import { chargeableUnitPrice } from "./sale-pricing";
import { createNotification } from "./notification";
import { initializeOrderPayment, PAYMENT_PURPOSE } from "./experience/payments";
import prisma from "./db";
import type { BusinessRole } from "./tenant";
import { canBusinessRolePerform } from "./tenant";

export type ToolPermissionCategory = "READ" | "WRITE" | "HIGH_RISK";

export const AI_TOOL_REGISTRY = {
  // READ tools
  get_business_hours: { category: "READ" as const, description: "Get configured opening hours and location" },
  search_products: { category: "READ" as const, description: "Search products and services in the business catalogue" },
  get_product: { category: "READ" as const, description: "Get authoritative details and price for a specific product" },
  check_inventory: { category: "READ" as const, description: "Check current authoritative inventory and stock status" },
  calculate_order: { category: "READ" as const, description: "Deterministically calculate order subtotal, delivery, discount, tax, and total" },
  get_delivery_fee: { category: "READ" as const, description: "Check if a delivery zone is supported and get its configured fee" },
  get_faqs: { category: "READ" as const, description: "Retrieve approved FAQs and knowledge" },
  get_promotions: { category: "READ" as const, description: "Get explicitly configured active promotions/offers" },
  get_payment_methods: { category: "READ" as const, description: "Get public merchant payment instructions (never secrets)" },
  check_payment_status: { category: "READ" as const, description: "Verify payment status from authoritative server records" },

  // WRITE tools
  create_lead: { category: "WRITE" as const, description: "Capture a customer lead or inquiry" },
  create_order: { category: "WRITE" as const, description: "Create a customer order with authoritative pricing" },
  create_preorder: { category: "WRITE" as const, description: "Create a clearly labeled pre-order for an eligible product" },
  create_booking: { category: "WRITE" as const, description: "Create a service booking request" },
  create_payment_request: { category: "WRITE" as const, description: "Initiate a server-side payment request for an order" },
  request_human: { category: "WRITE" as const, description: "Escalate conversation to a human team member" },
  send_owner_notification: { category: "WRITE" as const, description: "Send notification to nominated business recipient" },

  // HIGH_RISK tools (never executable by customer AI prompts)
  refund: { category: "HIGH_RISK" as const, description: "Process a refund (requires explicit owner/admin authorization)" },
  cancel_order: { category: "HIGH_RISK" as const, description: "Cancel a confirmed order (requires explicit authorization)" },
  change_price: { category: "HIGH_RISK" as const, description: "Change product price (requires explicit owner authorization)" },
  change_inventory: { category: "HIGH_RISK" as const, description: "Modify stock quantity (requires explicit owner authorization)" },
  modify_business_configuration: { category: "HIGH_RISK" as const, description: "Modify business rules or configuration (requires explicit owner authorization)" },
} as const;

export type AIToolName = keyof typeof AI_TOOL_REGISTRY;

export type ToolExecutionContext = {
  businessId: string;
  preview?: boolean;
  conversationId?: string;
  actorRole?: BusinessRole | "CUSTOMER" | null;
  authorizedHighRisk?: boolean;
  brain?: Awaited<ReturnType<typeof getBusinessBrain>>;
};

export type ToolExecutionResult<T = unknown> = {
  ok: boolean;
  tool: AIToolName;
  category: ToolPermissionCategory;
  status: "KNOWN" | "UNKNOWN" | "ACTION_REQUIRED";
  data?: T;
  error?: string;
  escalated?: boolean;
  preview?: boolean;
};

export function getToolCategory(tool: AIToolName): ToolPermissionCategory {
  return AI_TOOL_REGISTRY[tool]?.category ?? "HIGH_RISK";
}

export async function executeBusinessTool(
  tool: AIToolName,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (!context.businessId) {
    throw new Error("businessId required for tool execution — tenant isolation enforced.");
  }

  const spec = AI_TOOL_REGISTRY[tool];
  if (!spec) {
    return {
      ok: false,
      tool,
      category: "HIGH_RISK",
      status: "ACTION_REQUIRED",
      error: "Unrecognized tool.",
      escalated: true,
    };
  }

  // Enforce HIGH_RISK authorization gate (§9, §11)
  if (spec.category === "HIGH_RISK") {
    const canExecuteHighRisk =
      context.authorizedHighRisk === true &&
      context.actorRole &&
      context.actorRole !== "CUSTOMER" &&
      canBusinessRolePerform(context.actorRole, "high_risk");

    if (!canExecuteHighRisk) {
      return {
        ok: false,
        tool,
        category: "HIGH_RISK",
        status: "ACTION_REQUIRED",
        escalated: true,
        error: "I'll pass this to the business team. High-risk changes (refunds, cancellations, price or inventory edits) require explicit business authorization.",
      };
    }
  }

  const brain = context.brain || (await getBusinessBrain(context.businessId));
  const preview = Boolean(context.preview);

  // Enforce PAUSE / MAINTENANCE / PAUSE ALL ORDERING on transaction write tools (§45)
  const orderingTools: AIToolName[] = ["create_order", "create_preorder", "create_payment_request"];
  if (orderingTools.includes(tool)) {
    if (
      brain.extendedConfig.operationalStatus === "PAUSED" ||
      brain.extendedConfig.operationalStatus === "MAINTENANCE" ||
      brain.extendedConfig.pauseAllOrdering ||
      brain.extendedConfig.orderingAllowed === false
    ) {
      return {
        ok: false,
        tool,
        category: "WRITE",
        status: "ACTION_REQUIRED",
        error: "Ordering is temporarily paused right now. I can still answer your questions or pass your request to the business team.",
      };
    }
  }

  switch (tool) {
    case "get_business_hours": {
      const hours = brain.business.openingHours;
      return {
        ok: Boolean(hours),
        tool,
        category: "READ",
        status: hours ? "KNOWN" : "UNKNOWN",
        data: {
          openingHours: hours || null,
          location: brain.business.location || null,
          phone: brain.business.phone || null,
          whatsapp: brain.business.whatsapp || null,
        },
        error: hours ? undefined : "I don't have that information yet. Let me connect you with the business.",
      };
    }

    case "search_products": {
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const activeProducts = brain.products.filter((p) => p.isActive !== false);
      const activeServices = brain.services.filter((s) => s.isActive !== false);

      if (!query) {
        return {
          ok: activeProducts.length > 0 || activeServices.length > 0,
          tool,
          category: "READ",
          status: activeProducts.length > 0 || activeServices.length > 0 ? "KNOWN" : "UNKNOWN",
          data: { products: activeProducts, services: activeServices },
        };
      }

      const matchedProducts = activeProducts.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          query.includes(p.name.toLowerCase()) ||
          (p.category && p.category.toLowerCase().includes(query)) ||
          (p.description && p.description.toLowerCase().includes(query)),
      );
      const matchedServices = activeServices.filter(
        (s) =>
          s.title.toLowerCase().includes(query) ||
          query.includes(s.title.toLowerCase()) ||
          (s.description && s.description.toLowerCase().includes(query)),
      );

      const found = matchedProducts.length > 0 || matchedServices.length > 0;
      return {
        ok: found,
        tool,
        category: "READ",
        status: found ? "KNOWN" : "UNKNOWN",
        data: { products: matchedProducts, services: matchedServices },
        error: found ? undefined : "I don't have that product listed.",
      };
    }

    case "get_product":
    case "check_inventory": {
      const productId = typeof args.productId === "string" ? args.productId.trim() : "";
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const variantQuery = typeof args.variant === "string" ? args.variant.trim().toLowerCase() : "";
      const requestedQuantity = Math.max(1, Math.round(Number(args.quantity) || 1));

      const product = brain.products.find(
        (p) =>
          (productId && p.id === productId) ||
          (query &&
            (p.name.toLowerCase() === query ||
              p.name.toLowerCase().includes(query) ||
              query.includes(p.name.toLowerCase()))),
      );

      if (!product) {
        return {
          ok: false,
          tool,
          category: "READ",
          status: "UNKNOWN",
          error: "I don't have that product listed.",
        };
      }

      const matchedVariant = variantQuery
        ? (product.variants || []).find(
            (v) =>
              v.label.toLowerCase().includes(variantQuery) ||
              (v.options && v.options.toLowerCase().includes(variantQuery)),
          ) || null
        : null;

      const availability = evaluateProductAvailability({
        product,
        variant: matchedVariant,
        requestedQuantity,
      });

      return {
        ok: true,
        tool,
        category: "READ",
        status: "KNOWN",
        data: {
          product,
          variant: matchedVariant,
          availability,
        },
      };
    }

    case "get_delivery_fee": {
      const zone = typeof args.zone === "string" ? args.zone.trim() : "";
      const subtotalKES = Math.max(0, Math.round(Number(args.subtotalKES) || 0));
      const result = resolveDeliveryZoneFee(brain.delivery, zone, subtotalKES);
      return {
        ok: result.allowed,
        tool,
        category: "READ",
        status: result.allowed ? "KNOWN" : "UNKNOWN",
        data: result,
        error: result.allowed ? undefined : result.reason,
      };
    }

    case "calculate_order": {
      const rawItems = Array.isArray(args.items) ? args.items : [];
      const zone = typeof args.deliveryZone === "string" ? args.deliveryZone.trim() : "";
      const lineItems: Array<{
        productId?: string;
        name: string;
        quantity: number;
        unitPriceKES: number;
        variantDesc?: string;
      }> = [];

      for (const raw of rawItems) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
        const prod = brain.products.find(
          (p) =>
            (typeof item.productId === "string" && p.id === item.productId) ||
            (typeof item.name === "string" && p.name.toLowerCase() === item.name.toLowerCase()),
        );
        if (prod) {
          // Same server rule as createAuthoritativeOrder: sale window first, then the owner's quantity rule.
          const unitPriceKES = chargeableUnitPrice({
            product: prod,
            productName: prod.name,
            quantity: qty,
            now: new Date(),
            rules: brain.extendedConfig?.bulkPricing ?? [],
          }).unitPriceKES;
          lineItems.push({
            productId: prod.id,
            name: prod.name,
            quantity: qty,
            unitPriceKES,
            variantDesc: typeof item.variantDesc === "string" ? item.variantDesc : undefined,
          });
        }
      }

      const subtotalCheck = lineItems.reduce((sum, l) => sum + l.quantity * l.unitPriceKES, 0);
      const deliveryCalc = zone ? resolveDeliveryZoneFee(brain.delivery, zone, subtotalCheck) : { allowed: true, feeKES: 0 };
      const calculation = calculateCommerceTotal({
        lineItems,
        deliveryFeeKES: deliveryCalc.allowed ? deliveryCalc.feeKES : 0,
        discountKES: 0, // Never invent discounts (§38)
      });

      return {
        ok: lineItems.length > 0,
        tool,
        category: "READ",
        status: lineItems.length > 0 ? "KNOWN" : "UNKNOWN",
        data: {
          ...calculation,
          deliveryAllowed: deliveryCalc.allowed,
          deliveryNote: (deliveryCalc as { reason?: string }).reason,
        },
      };
    }

    case "get_faqs": {
      return {
        ok: brain.faqs.length > 0,
        tool,
        category: "READ",
        status: brain.faqs.length > 0 ? "KNOWN" : "UNKNOWN",
        data: { faqs: brain.faqs },
      };
    }

    case "get_promotions": {
      return {
        ok: true,
        tool,
        category: "READ",
        status: "KNOWN",
        data: { promotions: brain.promotions },
      };
    }

    case "get_payment_methods": {
      return {
        ok: brain.paymentMethods.isConfigured,
        tool,
        category: "READ",
        status: brain.paymentMethods.isConfigured ? "KNOWN" : "UNKNOWN",
        data: {
          publicInfo: brain.paymentMethods.publicInfo,
          isConfigured: brain.paymentMethods.isConfigured,
        },
        error: brain.paymentMethods.isConfigured
          ? undefined
          : "I don't have that information yet. Let me connect you with the business.",
      };
    }

    case "check_payment_status": {
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : null;
      const paymentReference = typeof args.paymentReference === "string" ? args.paymentReference.trim() : null;
      const verified = await hasServerVerifiedOrderPayment({
        businessId: context.businessId,
        orderId,
        paymentReference,
      });
      return {
        ok: true,
        tool,
        category: "READ",
        status: verified ? "KNOWN" : "ACTION_REQUIRED",
        data: {
          verified,
          paymentStatus: verified ? "PAID" : "UNPAID",
          message: verified
            ? "Payment has been verified by the server."
            : "Payment has not been verified by the payment provider yet. An order is only confirmed once server verification succeeds.",
        },
      };
    }

    case "create_lead": {
      const classification = (args.classification as LeadClassification) || "GENERAL_INQUIRY";
      const summary = typeof args.summary === "string" ? args.summary : "Customer inquiry";
      const result = await captureLead({
        businessId: context.businessId,
        classification,
        customerName: typeof args.customerName === "string" ? args.customerName : null,
        customerPhone: typeof args.customerPhone === "string" ? args.customerPhone : null,
        customerEmail: typeof args.customerEmail === "string" ? args.customerEmail : null,
        summary,
        conversationId: context.conversationId || null,
        preview,
      });
      return {
        ok: true,
        tool,
        category: "WRITE",
        status: "KNOWN",
        data: result.lead,
        preview,
      };
    }

    case "create_order": {
      const customerName = typeof args.customerName === "string" ? args.customerName.trim() : "Customer";
      const customerPhone = typeof args.customerPhone === "string" ? args.customerPhone.trim() : null;
      const items = Array.isArray(args.items) ? (args.items as any[]) : [];
      const fulfilmentType = args.fulfilmentType === "DELIVERY" ? "DELIVERY" : "PICKUP";
      const deliveryLocation = typeof args.deliveryLocation === "string" ? args.deliveryLocation : null;
      if (fulfilmentType === "DELIVERY") {
        const zoneResult = resolveDeliveryZoneFee(brain.delivery, deliveryLocation);
        if (!zoneResult.allowed || !zoneResult.matchedZone) {
          return {
            ok: false,
            tool,
            category: "WRITE",
            status: "UNKNOWN",
            error: `Delivery is not configured for ${deliveryLocation || "that area"}.`,
            preview,
          };
        }
      }
      const order = await createAuthoritativeOrder({
        businessId: context.businessId,
        customerName,
        customerPhone,
        items,
        // Customer tool arguments cannot set the fee, discount, or unit price.
        deliveryFeeKES: 0,
        discountKES: 0,
        fulfilmentType,
        deliveryLocation,
        idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined,
        confirmedByCustomer: args.confirmedByCustomer === true,
        preview,
      });
      return {
        ok: true,
        tool,
        category: "WRITE",
        status: "ACTION_REQUIRED",
        data: order,
        preview,
      };
    }

    case "create_preorder": {
      if (!brain.extendedConfig.preordersAllowed && !brain.products.some((p) => p.preOrderAllowed)) {
        return {
          ok: false,
          tool,
          category: "WRITE",
          status: "ACTION_REQUIRED",
          error: "Pre-orders are not enabled for this business.",
        };
      }
      // The price comes only from the catalogue (same rule as the HTTP pre-order route). A customer-supplied
      // price or an item that is not in the catalogue is refused, never priced from the request.
      const productName = typeof args.productName === "string" ? args.productName.trim() : "";
      const matched = brain.products.find((p) => p.name.toLowerCase() === productName.toLowerCase());
      if (!matched) {
        return {
          ok: false,
          tool,
          category: "WRITE",
          status: "ACTION_REQUIRED",
          error: "That item is not in this business catalogue, so it cannot be pre-ordered here.",
        };
      }
      const pricing = resolvePreorderPricing({
        product: matched,
        quantity: Number(args.quantity) || 1,
        bulkRules: brain.extendedConfig?.bulkPricing ?? [],
      });
      if (pricing.ok === false) {
        return { ok: false, tool, category: "WRITE", status: "ACTION_REQUIRED", error: pricing.error };
      }
      const totalKES = pricing.unitPriceKES * pricing.quantity;
      const requestedDeposit = Number(args.depositRequiredKES);
      const depositRequiredKES =
        Number.isInteger(requestedDeposit) && requestedDeposit >= 0 && requestedDeposit <= totalKES ? requestedDeposit : undefined;
      const summary = createPreOrderSummary({
        productName: matched.name,
        variantDesc: typeof args.variantDesc === "string" ? args.variantDesc : undefined,
        quantity: pricing.quantity,
        fullPriceKES: pricing.unitPriceKES,
        depositRequiredKES,
      });
      const quantity = pricing.quantity;
      if (!preview) {
        await createNotification({
          businessId: context.businessId,
          eventType: "PREORDER",
          title: summary.label,
          message: `New pre-order request: ${summary.label} x${quantity} (Total KES ${summary.totalKES}).`,
          preview: false,
        }).catch(() => {});
      }
      return {
        ok: true,
        tool,
        category: "WRITE",
        status: "ACTION_REQUIRED",
        data: { ...summary, preview },
        preview,
      };
    }

    case "create_booking": {
      const serviceName = typeof args.serviceName === "string" ? args.serviceName.trim() : "Service";
      const customerName = typeof args.customerName === "string" ? args.customerName.trim() : "Customer";
      const customerPhone = typeof args.customerPhone === "string" ? args.customerPhone.trim() : "";
      const startAt = args.startAt ? new Date(String(args.startAt)) : new Date(Date.now() + 86400000);
      if (preview) {
        return {
          ok: true,
          tool,
          category: "WRITE",
          status: "ACTION_REQUIRED",
          data: {
            id: `preview_booking_${Date.now()}`,
            businessId: context.businessId,
            serviceName,
            customerName,
            customerPhone,
            startAt: startAt.toISOString(),
            status: "PENDING",
            preview: true,
          },
          preview: true,
        };
      }
      let bookingId = `book_${Date.now()}`;
      try {
        if (prisma.booking?.create && customerPhone) {
          const created = await prisma.booking.create({
            data: {
              businessId: context.businessId,
              serviceName,
              customerName,
              customerPhone,
              startAt,
              status: "PENDING",
              paymentStatus: "UNPAID",
            },
          });
          if (created?.id) bookingId = created.id;
        }
      } catch {
        // Fallback ID
      }
      await createNotification({
        businessId: context.businessId,
        eventType: "BOOKING",
        title: `New Booking — ${serviceName}`,
        message: `${customerName} requested booking for ${serviceName}.`,
        referenceId: bookingId,
      }).catch(() => {});
      return {
        ok: true,
        tool,
        category: "WRITE",
        status: "ACTION_REQUIRED",
        data: { id: bookingId, serviceName, customerName, status: "PENDING", paymentStatus: "UNPAID" },
        preview: false,
      };
    }

    case "create_payment_request": {
      if (preview) {
        return {
          ok: true,
          tool,
          category: "WRITE",
          status: "ACTION_REQUIRED",
          data: {
            preview: true,
            paymentStatus: "UNPAID",
            message: "Preview mode: no real money is charged.",
          },
          preview: true,
        };
      }
      const orderId = typeof args.orderId === "string" ? args.orderId : undefined;
      const amountKES = Math.max(0, Math.round(Number(args.amountKES) || 0));
      const email = typeof args.email === "string" && args.email ? args.email : "customer@jata.local";
      const paymentInit = await initializeOrderPayment({
        businessId: context.businessId,
        orderId,
        amountKES,
        email,
        purpose: PAYMENT_PURPOSE.ORDER,
        callbackPath: `/b/${brain.business.slug || context.businessId}/ai`,
      });
      return {
        ok: paymentInit.kind === "ok",
        tool,
        category: "WRITE",
        status: "ACTION_REQUIRED",
        data: paymentInit,
        error: paymentInit.kind === "error" ? paymentInit.error : undefined,
      };
    }

    case "request_human": {
      const reason = typeof args.reason === "string" ? args.reason.trim() : "Customer requested human assistance";
      await captureLead({
        businessId: context.businessId,
        classification: "HUMAN_HANDOFF",
        customerName: typeof args.customerName === "string" ? args.customerName : null,
        customerPhone: typeof args.customerPhone === "string" ? args.customerPhone : null,
        summary: reason,
        conversationId: context.conversationId || null,
        preview,
      });
      return {
        ok: true,
        tool,
        category: "WRITE",
        status: "ACTION_REQUIRED",
        escalated: true,
        data: {
          escalatedToHuman: true,
          message: "I'll pass this to the business team.",
          contactPhone: brain.business.phone || null,
          contactWhatsApp: brain.business.whatsapp || null,
        },
        preview,
      };
    }

    case "send_owner_notification": {
      const notif = await createNotification({
        businessId: context.businessId,
        eventType: typeof args.eventType === "string" ? args.eventType : "HUMAN_HANDOFF",
        title: typeof args.title === "string" ? args.title : "AI Front Desk Alert",
        message: typeof args.message === "string" ? args.message : "Customer action requires attention.",
        preview,
      });
      return {
        ok: true,
        tool,
        category: "WRITE",
        status: "KNOWN",
        data: notif,
        preview,
      };
    }

    default:
      return {
        ok: true,
        tool,
        category: spec.category,
        status: "KNOWN",
        data: { executed: true },
      };
  }
}
