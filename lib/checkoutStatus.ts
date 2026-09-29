/**
 * Maps the server's payment verification response to what the checkout callback shows.
 * The browser returning from Paystack is never treated as success: only a server
 * response with status PAID *and* an ACTIVE subscription is shown as confirmed.
 */
export type CheckoutViewState = "paid" | "activating" | "processing" | "cancelled" | "expired" | "failed" | "signin" | "error";

export type CheckoutView = { state: CheckoutViewState; title: string; message: string; poll: boolean };

export const CHECKOUT_POLL_INTERVALS_MS = [3000, 5000, 8000, 13000, 20000, 30000] as const;

export function interpretVerifyResponse(httpStatus: number, data: unknown): CheckoutView {
  const body = (data && typeof data === "object" ? data : {}) as { status?: unknown; subscriptionStatus?: unknown; error?: unknown };
  const serverError = typeof body.error === "string" && body.error ? body.error : "";

  if (httpStatus === 401 || httpStatus === 403) {
    return { state: "signin", title: "Sign in to check this payment", message: serverError || "Sign in with the account that started this payment.", poll: false };
  }
  if (body.status === "PAID" && body.subscriptionStatus === "ACTIVE") {
    return { state: "paid", title: "Payment confirmed", message: "Paystack confirmed the payment and your subscription is active.", poll: false };
  }
  if (body.status === "PAID") {
    return { state: "activating", title: "Payment received — finishing activation", message: "Your payment is confirmed. We are still activating your subscription. Check again in a moment, or contact support if this does not change.", poll: true };
  }
  if (body.status === "PENDING") {
    return { state: "processing", title: "Payment processing", message: "Paystack is still processing this payment. Your subscription is not active yet. This page checks again automatically.", poll: true };
  }
  if (body.status === "CANCELLED") {
    return { state: "cancelled", title: "Payment cancelled", message: "The payment was cancelled. You have not been charged for this attempt and your subscription has not been activated.", poll: false };
  }
  if (body.status === "EXPIRED") {
    return { state: "expired", title: "Payment expired", message: "This payment attempt expired before it was completed. Start a new checkout to try again.", poll: false };
  }
  if (body.status === "FAILED" || body.status === "REFUNDED") {
    return { state: "failed", title: "Payment not completed", message: serverError || "The payment was not completed. Your subscription has not been activated.", poll: false };
  }
  if (httpStatus >= 500) {
    // Verification temporarily unavailable: the payment may still succeed, keep checking.
    return { state: "error", title: "Payment status unavailable", message: serverError || "We couldn’t confirm this payment yet. We’ll keep checking.", poll: true };
  }
  return { state: "error", title: "Payment status unavailable", message: serverError || "We couldn’t verify this payment yet. Please check again.", poll: false };
}
