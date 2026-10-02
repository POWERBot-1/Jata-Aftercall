/**
 * The single most useful next step for a business owner, shown at the top of each
 * dashboard card so the owner is never left guessing what to do.
 */
export type NextActionInput = {
  isPublished: boolean;
  hasContact: boolean;
  hasLocation: boolean;
  servicesCount: number;
  subscriptionStatus: string | null;
  expiresAt?: string | null;
  /** Interactive Business state (§15, §23). Optional — every existing caller keeps working. */
  hasExperience?: boolean;
  catalogueCount?: number;
  hasUnpublishedChanges?: boolean;
  entitlementStatus?: string | null;
};

export type NextAction = {
  key:
    | "add-contact"
    | "renew"
    | "publish"
    | "add-services"
    | "subscribe"
    | "add-location"
    | "share"
    /** Interactive Business steps (§15): set up, fill, preview, publish. */
    | "start-experience"
    | "add-items"
    | "publish-changes";
  title: string;
  detail: string;
};

const DAY = 86400000;

export function nextActionFor(b: NextActionInput, now: Date = new Date()): NextAction {
  if (!b.hasContact) {
    return { key: "add-contact", title: "Add a phone or WhatsApp number", detail: "Customers need a way to reach you before your page is useful." };
  }
  const expiresSoon = b.subscriptionStatus === "ACTIVE" && b.expiresAt ? new Date(b.expiresAt).getTime() - now.getTime() < 7 * DAY : false;
  if (b.subscriptionStatus === "EXPIRED" || b.subscriptionStatus === "EXPIRING" || b.subscriptionStatus === "SUSPENDED" || expiresSoon) {
    return { key: "renew", title: "Renew your subscription", detail: "Your plan has ended or ends within 7 days." };
  }
  if (b.subscriptionStatus !== "ACTIVE") {
    return { key: "subscribe", title: "Choose a plan", detail: "Choose a plan and pay to unlock publishing and keep your page active." };
  }
  // Interactive Business: guide the owner through set up → content → publish (§15).
  if (b.hasExperience === false) {
    return {
      key: "start-experience",
      title: "Start your interactive website",
      detail: "Choose what kind of business this is and we set up the right sections, fields and wording.",
    };
  }
  if (b.entitlementStatus && b.entitlementStatus !== "ACTIVE" && b.entitlementStatus !== "NONE") {
    return { key: "renew", title: "Activate Interactive Business", detail: "Your premium website needs an active plan before customers can use it." };
  }
  if (typeof b.catalogueCount === "number" && b.catalogueCount === 0 && b.hasExperience) {
    return { key: "add-items", title: "Add what you sell", detail: "Customers cannot order or book what they cannot see." };
  }
  if (b.hasUnpublishedChanges) {
    return { key: "publish-changes", title: "Publish your latest changes", detail: "You have saved changes that customers cannot see yet." };
  }
  if (!b.isPublished) {
    return { key: "publish", title: "Publish your page", detail: "Your page is a draft. Publishing makes it visible to customers." };
  }
  if (b.servicesCount === 0) {
    return { key: "add-services", title: "Add your services", detail: "Pages with services and prices get more enquiries." };
  }
  if (!b.hasLocation) {
    return { key: "add-location", title: "Add your location", detail: "Let customers find you with one tap on Directions." };
  }
  return { key: "share", title: "Share your page", detail: "Send your link on WhatsApp, social media and receipts." };
}
