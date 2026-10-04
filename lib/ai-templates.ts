/**
 * Universal Business Model & Business-Type Templates (§41, §42).
 *
 * The AI Business Front Desk is universal across trades (not hardcoded to restaurants).
 * Templates simplify onboarding while sharing the exact same Business Brain and commerce core.
 */

export type OfferTypeKey =
  | "PRODUCTS"
  | "SERVICES"
  | "BOTH"
  | "BOOKINGS"
  | "PREORDERS"
  | "APPOINTMENTS"
  | "CUSTOM_INQUIRIES";

export type OrderingModeKey =
  | "direct_order"
  | "preorder"
  | "human_confirmation"
  | "payment_before_confirmation";

export type DeliveryModeKey = "PICKUP" | "DELIVERY" | "BOTH";

export type BusinessTemplate = {
  key: string;
  label: string;
  categories: string[];
  offerType: OfferTypeKey;
  defaultTone: "professional" | "friendly" | "casual" | "premium" | "local" | "formal";
  defaultLanguage: "en" | "sw" | "mixed";
  defaultSalesBehavior: "informational" | "recommend" | "upsell" | "cross_sell" | "promotions";
  orderingAllowed: boolean;
  preordersAllowed: boolean;
  orderingMode: OrderingModeKey;
  deliveryMode: DeliveryModeKey;
  welcomeMessage: string;
  suggestedActions: Array<{ id: string; label: string; prompt: string }>;
  sampleFAQs: Array<{ question: string; answer: string }>;
};

export const UNIVERSAL_BUSINESS_CATEGORIES = [
  "Restaurant",
  "Retail",
  "Salon",
  "Barbershop",
  "Clothing",
  "Electronics",
  "Auto repair",
  "Property",
  "Professional services",
  "Beauty",
  "Food delivery",
  "Home services",
  "Events",
  "Education",
  "Agriculture",
  "Wholesale",
  "Manufacturing",
  "Freelancers",
  "Online businesses",
] as const;

export const AI_BUSINESS_TEMPLATES: Record<string, BusinessTemplate> = {
  restaurant: {
    key: "restaurant",
    label: "Restaurant & Food Delivery",
    categories: ["Restaurant", "Food delivery"],
    offerType: "PRODUCTS",
    defaultTone: "friendly",
    defaultLanguage: "mixed",
    defaultSalesBehavior: "recommend",
    orderingAllowed: true,
    preordersAllowed: false,
    orderingMode: "direct_order",
    deliveryMode: "BOTH",
    welcomeMessage: "Karibu! Welcome — ask about our menu, prices, delivery areas, or place an order.",
    suggestedActions: [
      { id: "menu", label: "🍽 View Menu", prompt: "What do you sell?" },
      { id: "prices", label: "💰 Prices", prompt: "What are your prices?" },
      { id: "delivery", label: "🚚 Delivery", prompt: "How much is delivery?" },
      { id: "location", label: "📍 Location", prompt: "Where are you located and when are you open?" },
      { id: "order", label: "🛒 Order Now", prompt: "I want to place an order" },
      { id: "human", label: "💬 Talk to a Person", prompt: "I would like to talk to a person" },
    ],
    sampleFAQs: [
      { question: "How long does delivery take?", answer: "" },
      { question: "How do I pay?", answer: "" },
    ],
  },
  retail: {
    key: "retail",
    label: "Retail & General Store",
    categories: ["Retail", "Wholesale", "Online businesses"],
    offerType: "PRODUCTS",
    defaultTone: "friendly",
    defaultLanguage: "mixed",
    defaultSalesBehavior: "recommend",
    orderingAllowed: true,
    preordersAllowed: true,
    orderingMode: "direct_order",
    deliveryMode: "BOTH",
    welcomeMessage: "Welcome! Ask about item availability, prices, sizes, delivery, or order directly.",
    suggestedActions: [
      { id: "catalogue", label: "🍽 View Catalogue", prompt: "What products do you have?" },
      { id: "prices", label: "💰 Prices", prompt: "What are your prices?" },
      { id: "delivery", label: "🚚 Delivery", prompt: "How much is delivery?" },
      { id: "location", label: "📍 Location", prompt: "Where are you located?" },
      { id: "order", label: "🛒 Order Now", prompt: "I want to order" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Talk to a person" },
    ],
    sampleFAQs: [{ question: "Can I preorder out-of-stock items?", answer: "" }],
  },
  salon: {
    key: "salon",
    label: "Salon, Barbershop & Beauty",
    categories: ["Salon", "Barbershop", "Beauty"],
    offerType: "BOOKINGS",
    defaultTone: "friendly",
    defaultLanguage: "mixed",
    defaultSalesBehavior: "recommend",
    orderingAllowed: true,
    preordersAllowed: false,
    orderingMode: "direct_order",
    deliveryMode: "PICKUP",
    welcomeMessage: "Welcome! Ask about our services, prices, available slots, or book an appointment.",
    suggestedActions: [
      { id: "services", label: "🍽 View Services", prompt: "What services do you offer?" },
      { id: "prices", label: "💰 Prices", prompt: "What are your service prices?" },
      { id: "book", label: "📅 Book", prompt: "I would like to book an appointment" },
      { id: "location", label: "📍 Location", prompt: "Where are you located and what time do you open?" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Talk to a person" },
    ],
    sampleFAQs: [{ question: "Do I need a deposit to book?", answer: "" }],
  },
  auto: {
    key: "auto",
    label: "Auto Repair & Garage",
    categories: ["Auto repair", "Mechanic"],
    offerType: "BOTH",
    defaultTone: "professional",
    defaultLanguage: "mixed",
    defaultSalesBehavior: "informational",
    orderingAllowed: true,
    preordersAllowed: true,
    orderingMode: "human_confirmation",
    deliveryMode: "PICKUP",
    welcomeMessage: "Welcome! Ask about diagnostics, service pricing, parts availability, or book a bay.",
    suggestedActions: [
      { id: "services", label: "🍽 Services & Parts", prompt: "What services and parts do you offer?" },
      { id: "prices", label: "💰 Prices", prompt: "How much are your services?" },
      { id: "book", label: "📅 Book", prompt: "Book my car for service" },
      { id: "location", label: "📍 Location", prompt: "Where is your workshop located?" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Speak to a mechanic" },
    ],
    sampleFAQs: [{ question: "Do you inspect before quoting?", answer: "" }],
  },
  real_estate: {
    key: "real_estate",
    label: "Real Estate & Property",
    categories: ["Property", "Real Estate"],
    offerType: "APPOINTMENTS",
    defaultTone: "professional",
    defaultLanguage: "en",
    defaultSalesBehavior: "informational",
    orderingAllowed: false,
    preordersAllowed: false,
    orderingMode: "human_confirmation",
    deliveryMode: "PICKUP",
    welcomeMessage: "Welcome! Ask about available listings, rent/sale prices, locations, or schedule a viewing.",
    suggestedActions: [
      { id: "listings", label: "🍽 View Listings", prompt: "What listings are available?" },
      { id: "prices", label: "💰 Prices", prompt: "What are the prices?" },
      { id: "location", label: "📍 Location", prompt: "Where are the properties located?" },
      { id: "book", label: "📅 Book Viewing", prompt: "I want to schedule a viewing" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Talk to an agent" },
    ],
    sampleFAQs: [{ question: "How do I schedule a viewing?", answer: "" }],
  },
  professional_services: {
    key: "professional_services",
    label: "Professional Services, Education & Freelancers",
    categories: ["Professional services", "Education", "Freelancers"],
    offerType: "APPOINTMENTS",
    defaultTone: "professional",
    defaultLanguage: "en",
    defaultSalesBehavior: "informational",
    orderingAllowed: true,
    preordersAllowed: false,
    orderingMode: "human_confirmation",
    deliveryMode: "PICKUP",
    welcomeMessage: "Welcome! Ask about our services, rates, availability, or request a consultation.",
    suggestedActions: [
      { id: "services", label: "🍽 Services", prompt: "What services do you offer?" },
      { id: "prices", label: "💰 Prices", prompt: "What are your rates?" },
      { id: "book", label: "📅 Book", prompt: "Book a consultation" },
      { id: "location", label: "📍 Location", prompt: "Where is your office?" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Talk to a specialist" },
    ],
    sampleFAQs: [],
  },
  home_services: {
    key: "home_services",
    label: "Home Services & Events",
    categories: ["Home services", "Events"],
    offerType: "SERVICES",
    defaultTone: "friendly",
    defaultLanguage: "mixed",
    defaultSalesBehavior: "recommend",
    orderingAllowed: true,
    preordersAllowed: false,
    orderingMode: "human_confirmation",
    deliveryMode: "DELIVERY",
    welcomeMessage: "Welcome! Ask about our service areas, packages, pricing, or book a visit.",
    suggestedActions: [
      { id: "services", label: "🍽 Packages", prompt: "What services do you offer?" },
      { id: "prices", label: "💰 Prices", prompt: "What are your prices?" },
      { id: "delivery", label: "🚚 Service Areas", prompt: "Which areas do you cover?" },
      { id: "book", label: "📅 Book", prompt: "Book a service" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Talk to the team" },
    ],
    sampleFAQs: [],
  },
  fashion: {
    key: "fashion",
    label: "Fashion, Clothing & Footwear",
    categories: ["Clothing", "Fashion"],
    offerType: "PRODUCTS",
    defaultTone: "friendly",
    defaultLanguage: "mixed",
    defaultSalesBehavior: "cross_sell",
    orderingAllowed: true,
    preordersAllowed: true,
    orderingMode: "direct_order",
    deliveryMode: "BOTH",
    welcomeMessage: "Karibu! Ask about available sizes, colours, prices, delivery, or order your outfit.",
    suggestedActions: [
      { id: "menu", label: "🍽 View Catalogue", prompt: "What do you sell?" },
      { id: "prices", label: "💰 Prices", prompt: "What are your prices?" },
      { id: "delivery", label: "🚚 Delivery", prompt: "How much is delivery?" },
      { id: "location", label: "📍 Location", prompt: "Where is your shop?" },
      { id: "order", label: "🛒 Order Now", prompt: "I want to order" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Talk to a person" },
    ],
    sampleFAQs: [],
  },
  electronics: {
    key: "electronics",
    label: "Electronics & Gadgets",
    categories: ["Electronics"],
    offerType: "BOTH",
    defaultTone: "professional",
    defaultLanguage: "en",
    defaultSalesBehavior: "recommend",
    orderingAllowed: true,
    preordersAllowed: true,
    orderingMode: "payment_before_confirmation",
    deliveryMode: "BOTH",
    welcomeMessage: "Welcome! Check stock, specs, prices, warranty policy, or place an order.",
    suggestedActions: [
      { id: "menu", label: "🍽 Products", prompt: "What products do you have in stock?" },
      { id: "prices", label: "💰 Prices", prompt: "What are your prices?" },
      { id: "delivery", label: "🚚 Delivery", prompt: "Do you deliver?" },
      { id: "order", label: "🛒 Order Now", prompt: "I want to buy" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Talk to a technician" },
    ],
    sampleFAQs: [],
  },
  agriculture: {
    key: "agriculture",
    label: "Agriculture, Wholesale & Manufacturing",
    categories: ["Agriculture", "Manufacturing"],
    offerType: "PRODUCTS",
    defaultTone: "local",
    defaultLanguage: "mixed",
    defaultSalesBehavior: "informational",
    orderingAllowed: true,
    preordersAllowed: true,
    orderingMode: "direct_order",
    deliveryMode: "BOTH",
    welcomeMessage: "Karibu! Ask about stock, bulk pricing, minimum order quantities, and delivery.",
    suggestedActions: [
      { id: "menu", label: "🍽 Products", prompt: "What products do you supply?" },
      { id: "prices", label: "💰 Prices", prompt: "What are your prices?" },
      { id: "delivery", label: "🚚 Delivery", prompt: "How much is delivery?" },
      { id: "order", label: "🛒 Order Now", prompt: "I want to order" },
      { id: "human", label: "💬 Talk to a Person", prompt: "Talk to sales" },
    ],
    sampleFAQs: [],
  },
};

export type TemplateStarter = {
  walkInsAccepted: boolean;
  ordersAccepted: boolean;
  bookingsAccepted: boolean;
  preordersAccepted: boolean;
  requiredCustomerFields: Array<"name" | "phone" | "delivery_location" | "notes">;
  suggestedCatalogueFields: string[];
  fulfilmentHint: string;
  escalationHint: string;
  questionPrompts: string[];
};

/** Suggested questionnaire structure only. Never includes prices, zones, or customer-facing facts. */
export function starterForTemplate(template: BusinessTemplate): TemplateStarter {
  const bookings = template.offerType === "BOOKINGS" || template.offerType === "APPOINTMENTS" || template.offerType === "SERVICES";
  return {
    walkInsAccepted: template.deliveryMode !== "DELIVERY",
    ordersAccepted: template.orderingAllowed,
    bookingsAccepted: bookings,
    preordersAccepted: template.preordersAllowed,
    requiredCustomerFields: template.deliveryMode === "PICKUP" ? ["name", "phone"] : ["name", "phone", "delivery_location"],
    suggestedCatalogueFields: bookings
      ? ["Service name", "Price", "Duration", "Deposit if you require one"]
      : ["Name", "Category", "Price", "Unit", "Stock", "Variations"],
    fulfilmentHint:
      template.deliveryMode === "PICKUP"
        ? "Customers collect unless you later add your own service areas."
        : "Add your own zones, fees, and expected times. Nothing is pre-filled.",
    escalationHint: "Call a person for complaints, refunds, missing information, and anything that needs approval.",
    questionPrompts: template.sampleFAQs.map((item) => item.question).filter(Boolean),
  };
}

export function resolveTemplateForCategory(categoryOrKey?: string | null): BusinessTemplate {
  const raw = (categoryOrKey || "").trim().toLowerCase();
  if (AI_BUSINESS_TEMPLATES[raw]) return AI_BUSINESS_TEMPLATES[raw];
  for (const tpl of Object.values(AI_BUSINESS_TEMPLATES)) {
    if (tpl.categories.some((c) => c.toLowerCase() === raw || raw.includes(c.toLowerCase()))) {
      return tpl;
    }
  }
  return AI_BUSINESS_TEMPLATES.retail;
}
