/** Human-readable labels for internal status codes. Raw enum values are never shown to owners. */
export type Tone = "success" | "warning" | "error" | "neutral";
export type StatusLabel = { label: string; tone: Tone; help?: string };

const SUBSCRIPTION: Record<string, StatusLabel> = {
  PENDING: { label: "Awaiting payment", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  EXPIRING: { label: "Expiring soon", tone: "warning", help: "Renew to avoid interruption." },
  EXPIRED: { label: "Expired", tone: "error", help: "Renew to keep your page active." },
  SUSPENDED: { label: "Suspended", tone: "error", help: "Contact support." },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const PAYMENT: Record<string, StatusLabel> = {
  PENDING: { label: "Processing", tone: "warning", help: "Waiting for confirmation from Paystack." },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "error" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const BUSINESS: Record<string, StatusLabel> = {
  PENDING: { label: "Not yet subscribed", tone: "neutral" },
  ACTIVE: { label: "Subscribed", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "error", help: "Contact support." },
};

/**
 * Interactive Business operational states (§27, §28, §29).
 *
 * These live here rather than in a new module so every status in the product is rendered
 * through the same label/toning rules the dashboard already uses.
 */
const ORDER: Record<string, StatusLabel> = {
  NEW: { label: "New", tone: "warning", help: "Accept it to let the customer know you are on it." },
  ACCEPTED: { label: "Accepted", tone: "success" },
  PROCESSING: { label: "Processing", tone: "warning" },
  READY: { label: "Ready", tone: "success", help: "Ready for pickup or delivery." },
  COMPLETED: { label: "Completed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

const BOOKING: Record<string, StatusLabel> = {
  PENDING: { label: "Pending", tone: "warning", help: "Confirm or decline this request." },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  IN_PROGRESS: { label: "In progress", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  NO_SHOW: { label: "No show", tone: "error" },
};

const ENTITLEMENT: Record<string, StatusLabel> = {
  NONE: { label: "No package", tone: "warning", help: "Choose Interactive Business to unlock your premium website." },
  PENDING: { label: "Awaiting payment", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  PAST_DUE: { label: "Past due", tone: "warning", help: "Renew now to avoid interruption." },
  EXPIRED: { label: "Expired", tone: "error", help: "Renew to put your website back online." },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const EXPERIENCE: Record<string, StatusLabel> = {
  DRAFT: { label: "Draft", tone: "warning", help: "Only you can see this until you publish." },
  PUBLISHED: { label: "Live", tone: "success" },
  UNPUBLISHED: { label: "Hidden", tone: "neutral", help: "Customers cannot see your website right now." },
};

const UNKNOWN: StatusLabel = { label: "Unknown", tone: "neutral" };

export function subscriptionStatusLabel(status: string | null | undefined): StatusLabel {
  if (!status) return { label: "No subscription", tone: "warning" };
  return SUBSCRIPTION[status] || UNKNOWN;
}

export function paymentStatusLabel(status: string | null | undefined): StatusLabel {
  return (status && PAYMENT[status]) || UNKNOWN;
}

export function businessStatusLabel(status: string | null | undefined): StatusLabel {
  return (status && BUSINESS[status]) || UNKNOWN;
}

export function toneClass(tone: Tone): string {
  switch (tone) {
    case "success": return "bg-emerald-50 text-emerald-700";
    case "warning": return "bg-amber-50 text-amber-900";
    case "error": return "bg-red-50 text-red-700";
    default: return "bg-zinc-100 text-zinc-700";
  }
}

export function orderStatusLabel(status: string | null | undefined): StatusLabel {
  return (status && ORDER[status]) || UNKNOWN;
}

export function bookingStatusLabel(status: string | null | undefined): StatusLabel {
  return (status && BOOKING[status]) || UNKNOWN;
}

export function entitlementStatusLabel(status: string | null | undefined): StatusLabel {
  if (!status) return ENTITLEMENT.NONE;
  return ENTITLEMENT[status] || UNKNOWN;
}

export function experienceStatusLabel(status: string | null | undefined): StatusLabel {
  if (!status) return EXPERIENCE.DRAFT;
  return EXPERIENCE[status] || UNKNOWN;
}
