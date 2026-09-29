export const SAFE_ERRORS = {
  signIn: "Please sign in to continue.",
  noAccess: "You don't have access to that business.",
  notFound: "We couldn't find that.",
  chooseBusiness: "Choose a business before saving.",
  saveFailed: "We couldn't save those changes. Please try again.",
  registerUnexpected: "We couldn't create your account. Please try again.",
  registerDuplicate: "That email is already registered. Try signing in instead.",
  registerName: "Please enter your name (at least 2 characters).",
  registerEmail: "Please enter a valid email address.",
  registerPhone: "Please enter a valid phone number.",
  registerPassword: "Password must be at least 8 characters.",
  registerSession: "We couldn't sign you in. Please try signing in.",
  registerUnreadable: "We couldn't read that request. Please try again.",
  serviceFailed: "We couldn't save that service. Please try again.",
  offerFailed: "We couldn't save that offer. Please try again.",
  publishFailed: "We couldn't publish your page. Please try again.",
  publishPaymentRequired: "Choose a plan and complete payment before publishing your page.",
  businessFailed: "We couldn't create that business. Please try again.",
} as const;

/**
 * Map an unknown failure to a status and a plain-language message.
 * Never returns exception text, Prisma traces, or connection details.
 */
export function publicErrorMessage(error: unknown, fallback: string): { status: number; message: string } {
  const status =
    error && typeof error === "object" && "status" in error && typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : 500;

  if (status === 401) return { status: 401, message: SAFE_ERRORS.signIn };
  if (status === 403) return { status: 403, message: SAFE_ERRORS.noAccess };
  if (status === 404) return { status: 404, message: SAFE_ERRORS.notFound };
  if (status === 400 || status === 409 || status === 429) return { status, message: fallback };
  return { status: 500, message: fallback };
}

export function responseHasTechnicalDetail(message: string): boolean {
  return /prisma|stack|ECONN|passwordHash|DATABASE_URL|invocation|sql|secret/i.test(message);
}
