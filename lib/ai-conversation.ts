/**
 * Conversation Memory & State Engine (§24, §33, §40) — strictly tenant-isolated.
 *
 * Maintains conversational context (e.g., active product/variant reference across turns:
 * "How much is the black one?" -> "KES 2,500." -> "Do you have medium?" -> resolves to that product).
 *
 * Invariants:
 * - Never leaks context across tenants: memory keys include `businessId` and reject cross-tenant access.
 * - Never exposes private customer history without verification.
 */

export type ConversationStatus = "ACTIVE" | "WAITING_FOR_HUMAN" | "CONVERTED" | "ABANDONED";

export type ChannelType =
  | "web_chat"
  | "business_page"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "sms"
  | "email"
  | "voice";

export type ConversationTurn = {
  role: "customer" | "assistant";
  text: string;
  timestamp: string;
  responseType?: "KNOWN" | "UNKNOWN" | "ACTION_REQUIRED";
};

export type ConversationContext = {
  conversationId: string;
  businessId: string;
  channel: ChannelType;
  status: ConversationStatus;
  activeProductId: string | null;
  activeProductName: string | null;
  activeVariantLabel: string | null;
  lastIntent: string | null;
  customerName: string | null;
  customerPhone: string | null;
  verifiedCustomerPhone: boolean;
  pendingCartLines: Array<{
    productId?: string;
    name: string;
    variantDesc?: string;
    quantity: number;
    unitPriceKES: number;
  }>;
  pendingDeliveryZone: string | null;
  pendingFulfilment: "PICKUP" | "DELIVERY" | null;
  collectedCustomerName: string | null;
  collectedCustomerPhone: string | null;
  discussedProductIds: string[];
  /**
   * True when activeProductId was explicitly established as the follow-up referent.
   * Historical discussedProductIds are kept. Opening a comparison (a second distinct
   * product) clears the pin; a later explicit mention pins that product again.
   */
  productFocusPinned: boolean;
  turns: ConversationTurn[];
  preview: boolean;
  createdAt: string;
  updatedAt: string;
};

// Map keyed by `${businessId}::${conversationId}` so Tenant B can never read Tenant A's context.
const conversationStore = new Map<string, ConversationContext>();
// Map tracking which businessId owns a conversationId to detect cross-tenant probing.
const conversationOwnerMap = new Map<string, string>();

/**
 * Whether an explicit catalogue mention should pin follow-ups to that product.
 * The first product pins. Introducing a second distinct product opens a comparison
 * and does not pin. Any later explicit mention re-establishes the named product
 * without deleting the discussed history.
 */
export function productFocusPinnedAfterMention(priorDiscussedIds: string[], productId: string): boolean {
  const prior = (priorDiscussedIds || []).filter(Boolean);
  if (!productId) return false;
  if (prior.length === 0) return true;
  if (prior.length === 1 && prior[0] !== productId) return false;
  return true;
}

export function getOrCreateConversationContext(params: {
  businessId: string;
  conversationId?: string | null;
  channel?: ChannelType;
  preview?: boolean;
}): ConversationContext {
  const { businessId } = params;
  if (!businessId) {
    throw new Error("businessId is required for conversation context — tenant isolation enforced.");
  }

  const rawConvId =
    params.conversationId && typeof params.conversationId === "string" && params.conversationId.trim()
      ? params.conversationId.trim().slice(0, 100)
      : `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const ownerBiz = conversationOwnerMap.get(rawConvId);
  // If a conversationId was created under another tenant, never leak that tenant's context;
  // mint an isolated conversationId scoped to this business instead.
  const effectiveConvId = ownerBiz && ownerBiz !== businessId ? `${businessId}_${rawConvId}` : rawConvId;
  const storeKey = `${businessId}::${effectiveConvId}`;

  const existing = conversationStore.get(storeKey);
  if (existing && existing.businessId === businessId) {
    return existing;
  }

  const now = new Date().toISOString();
  const created: ConversationContext = {
    conversationId: effectiveConvId,
    businessId,
    channel: params.channel || "web_chat",
    status: "ACTIVE",
    activeProductId: null,
    activeProductName: null,
    activeVariantLabel: null,
    lastIntent: null,
    customerName: null,
    customerPhone: null,
    verifiedCustomerPhone: false,
    pendingCartLines: [],
    pendingDeliveryZone: null,
    pendingFulfilment: null,
    collectedCustomerName: null,
    collectedCustomerPhone: null,
    discussedProductIds: [],
    productFocusPinned: false,
    turns: [],
    preview: Boolean(params.preview),
    createdAt: now,
    updatedAt: now,
  };

  conversationOwnerMap.set(effectiveConvId, businessId);
  conversationStore.set(storeKey, created);
  return created;
}

export function updateConversationContext(
  businessId: string,
  conversationId: string,
  updates: Partial<Omit<ConversationContext, "businessId" | "conversationId">>,
): ConversationContext {
  const ctx = getOrCreateConversationContext({ businessId, conversationId });
  const next: ConversationContext = {
    ...ctx,
    ...updates,
    businessId,
    conversationId: ctx.conversationId,
    turns: updates.turns ? updates.turns.slice(-20) : ctx.turns,
    updatedAt: new Date().toISOString(),
  };
  conversationStore.set(`${businessId}::${ctx.conversationId}`, next);
  return next;
}

export function listConversationsForBusiness(
  businessId: string,
  statusFilter?: ConversationStatus | "ALL",
  includePreview = false,
): ConversationContext[] {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  const list: ConversationContext[] = [];
  for (const ctx of conversationStore.values()) {
    if (ctx.businessId !== businessId) continue;
    if (!includePreview && ctx.preview) continue;
    if (statusFilter && statusFilter !== "ALL" && ctx.status !== statusFilter) continue;
    list.push(ctx);
  }
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteCustomerConversationsForBusiness(businessId: string, customerPhone: string): number {
  if (!businessId || !customerPhone) return 0;
  const normalized = customerPhone.replace(/\D/g, "");
  let removed = 0;
  for (const [key, ctx] of conversationStore.entries()) {
    if (ctx.businessId === businessId && ctx.customerPhone && ctx.customerPhone.replace(/\D/g, "") === normalized) {
      conversationStore.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function resetConversationsForTests() {
  conversationStore.clear();
  conversationOwnerMap.clear();
}
