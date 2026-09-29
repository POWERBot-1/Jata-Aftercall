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
