/**
 * JATA Autopilot — Universal Industry Pack Engine (§6)
 *
 * One core Autopilot platform configured via 15 prioritized Industry Packs plus
 * a `generic_custom` pack so an unusual or hybrid business still receives
 * domain-appropriate terminology, KPIs, playbooks, and safety boundaries.
 */

export type IndustryPackKey =
  | "restaurant_cafe_bakery"
  | "retail_supermarket_minimart"
  | "salon_barbershop_spa"
  | "fashion_apparel_footwear"
  | "electronics_phone_appliance"
  | "pharmacy_clinic_wellness"
  | "auto_repair_garage_carwash"
  | "real_estate_property"
  | "hardware_agrovet_construction"
  | "logistics_courier_transport"
  | "events_photography_catering"
  | "education_tutoring_training"
  | "professional_agency_consulting"
  | "hospitality_hotel_travel"
  | "wholesale_distributor_manufacturing"
  | "generic_custom";

export interface IndustryPack {
  key: IndustryPackKey;
  name: string;
  terminology: {
    customerNoun: string;
    offeringNoun: string;
    conversionNoun: string;
  };
  priorityKpis: string[];
  leadQualificationQuestions: string[];
  safePlaybooks: string[];
  upsellGuidance: string;
  regulatedGuardrail?: {
    code: "CLINICAL_PRESCRIPTION_LOCK" | "REGULATED_ADVISORY_LOCK";
    blockedPatterns: RegExp[];
    ownerNotice: string;
  };
}

const CLINICAL_BLOCKED_PATTERNS = [
  /\b(prescrib(e|ing)|dosage|mg\s*(twice|three|daily)|take\s+\d+\s*(tablets?|capsules?|ml)|diagnos(e|is)\s+you|antibiotic\s+regimen|insulin\s+dose)\b/i,
];

const REGULATED_ADVISORY_PATTERNS = [
  /\b(binding\s+legal\s+opinion|guaranteed\s+court\s+outcome|certified\s+tax\s+clearance\s+advice)\b/i,
];

export const INDUSTRY_PACKS: Record<IndustryPackKey, IndustryPack> = {
  restaurant_cafe_bakery: {
    key: "restaurant_cafe_bakery",
    name: "Restaurants, Cafes, Fast Food & Bakeries",
    terminology: { customerNoun: "diner", offeringNoun: "menu item", conversionNoun: "table or delivery order" },
    priorityKpis: ["Daily order volume", "Peak meal-hour enquiries", "Slow-moving menu items", "Repeat diner rate"],
    leadQualificationQuestions: ["Dine-in, takeaway, or delivery?", "Preferred time and group size?", "Any dietary notes?"],
    safePlaybooks: ["Off-peak combo offer draft", "Unanswered menu/delivery FAQ update", "Pre-order confirmation follow-up"],
    upsellGuidance: "Pair mains with drinks, sides, or family platters without discounting core bestsellers.",
  },
  retail_supermarket_minimart: {
    key: "retail_supermarket_minimart",
    name: "Retail Shops, Supermarkets & Minimarts",
    terminology: { customerNoun: "shopper", offeringNoun: "SKU", conversionNoun: "basket sale" },
    priorityKpis: ["Low-stock fast movers", "Dead stock (>30d)", "Average basket value", "Credit balance aging"],
    leadQualificationQuestions: ["Item & quantity needed?", "Branch pickup or rider delivery?"],
    safePlaybooks: ["Slow-mover bundle offer", "Stock & opening-hours FAQ resolution", "Consented restock alert"],
    upsellGuidance: "Suggest household replenishment bundles and multi-pack value options.",
  },
  salon_barbershop_spa: {
    key: "salon_barbershop_spa",
    name: "Salons, Barbershops, Spas & Beauty",
    terminology: { customerNoun: "client", offeringNoun: "treatment", conversionNoun: "appointment booking" },
    priorityKpis: ["Confirmed vs no-show bookings", "Mid-week slot utilization", "Rebooking interval", "Top treatments"],
    leadQualificationQuestions: ["Preferred service & stylist?", "Preferred day and time slot?"],
    safePlaybooks: ["Mid-week quiet-slot offer", "Service duration & pricing FAQ fix", "24h appointment reminder"],
    upsellGuidance: "Offer add-on conditioning, grooming, or aftercare products at booking confirmation.",
  },
  fashion_apparel_footwear: {
    key: "fashion_apparel_footwear",
    name: "Fashion, Apparel, Footwear & Accessories",
    terminology: { customerNoun: "buyer", offeringNoun: "piece", conversionNoun: "order" },
    priorityKpis: ["Size/colour stock gaps", "Catalogue views to WhatsApp/order rate", "End-of-line stock", "Return enquiries"],
    leadQualificationQuestions: ["Preferred size and colour?", "Delivery area or shop fitting?"],
    safePlaybooks: ["New-drop or last-sizes spotlight offer", "Sizing & exchange policy FAQ", "Reserved-item follow-up"],
    upsellGuidance: "Recommend matching footwear or accessories grounded in in-stock variants only.",
  },
  electronics_phone_appliance: {
    key: "electronics_phone_appliance",
    name: "Electronics, Phone Shops & Appliances",
    terminology: { customerNoun: "buyer", offeringNoun: "device", conversionNoun: "verified sale" },
    priorityKpis: ["High-value model availability", "Warranty/spec unanswered questions", "Accessory attach rate"],
    leadQualificationQuestions: ["Exact model/storage capacity?", "Warranty or trade-in question?"],
    safePlaybooks: ["Accessory bundle offer", "Warranty & genuine-stock FAQ update", "Quote follow-up"],
    upsellGuidance: "Pair devices with screen protection, surge protectors, or official chargers in stock.",
  },
  pharmacy_clinic_wellness: {
    key: "pharmacy_clinic_wellness",
    name: "Pharmacies, Clinics & Wellness Centres",
    terminology: { customerNoun: "patient or client", offeringNoun: "wellness item or consultation", conversionNoun: "appointment or OTC order" },
    priorityKpis: ["Consultation booking response time", "OTC availability questions", "Clinic hours & insurance FAQs"],
    leadQualificationQuestions: ["Do you have a valid clinician prescription or need a consultation slot?", "Preferred branch or clinic time?"],
    safePlaybooks: ["Clinic hours & insurance FAQ resolution", "Appointment reminder (non-clinical)", "Wellness checkup package notice"],
    upsellGuidance: "Never upsell prescription medicines; surface only general clinic booking availability or non-clinical wellness info.",
    regulatedGuardrail: {
      code: "CLINICAL_PRESCRIPTION_LOCK",
      blockedPatterns: CLINICAL_BLOCKED_PATTERNS,
      ownerNotice:
        "Regulated healthcare guardrail active: Autopilot will never diagnose conditions, recommend dosages, or prescribe/dispense restricted medicines. Clinical questions escalate to a licensed practitioner.",
    },
  },
  auto_repair_garage_carwash: {
    key: "auto_repair_garage_carwash",
    name: "Auto Repair, Garages, Spare Parts & Car Wash",
    terminology: { customerNoun: "motorist", offeringNoun: "service bay or part", conversionNoun: "bay booking or parts order" },
    priorityKpis: ["Bay bookings", "Part compatibility enquiries", "Service interval follow-ups", "Unpaid job balances"],
    leadQualificationQuestions: ["Vehicle make, model, and year?", "Symptom or part number needed?"],
    safePlaybooks: ["Rainy-season wash/checkup offer", "Parts & bay-hours FAQ update", "Vehicle ready-for-pickup notice"],
    upsellGuidance: "Suggest wheel alignment, fluid check, or interior detailing alongside scheduled work.",
  },
  real_estate_property: {
    key: "real_estate_property",
    name: "Real Estate, Property Management & Rentals",
    terminology: { customerNoun: "prospect or tenant", offeringNoun: "unit or listing", conversionNoun: "site viewing" },
    priorityKpis: ["Qualified viewing requests", "Response speed to listing enquiries", "Vacancy duration"],
    leadQualificationQuestions: ["Buy or rent, budget range, and preferred location?", "Preferred viewing day?"],
    safePlaybooks: ["Open-house viewing offer", "Deposit, lease terms & amenities FAQ", "Scheduled viewing confirmation"],
    upsellGuidance: "Present comparable available units in the same budget/neighbourhood when a unit is taken.",
  },
  hardware_agrovet_construction: {
    key: "hardware_agrovet_construction",
    name: "Hardware, Agrovet & Construction Supply",
    terminology: { customerNoun: "contractor or farmer", offeringNoun: "supply item", conversionNoun: "bulk quote or order" },
    priorityKpis: ["Bulk quote turnaround", "Seasonal input stock levels", "Contractor credit balances"],
    leadQualificationQuestions: ["Item quantities and site delivery location?", "Immediate pickup or scheduled lorry drop?"],
    safePlaybooks: ["Planting/building-season bundle offer", "Delivery radius & bulk MOQ FAQ", "Pending quote follow-up"],
    upsellGuidance: "Bundle complementary fasteners, tools, or seasonal farm inputs verified in inventory.",
  },
  logistics_courier_transport: {
    key: "logistics_courier_transport",
    name: "Logistics, Courier, Delivery & Transport",
    terminology: { customerNoun: "shipper", offeringNoun: "route or dispatch tier", conversionNoun: "booked dispatch" },
    priorityKpis: ["Route rate enquiries", "On-time dispatch confirmations", "Repeat business shippers"],
    leadQualificationQuestions: ["Pickup & drop-off zones?", "Parcel weight/size and urgency?"],
    safePlaybooks: ["Same-day corridor rate offer", "Zone pricing & cut-off time FAQ", "Dispatch status notification"],
    upsellGuidance: "Offer return-trip errand bundles or recurring merchant dispatch plans.",
  },
  events_photography_catering: {
    key: "events_photography_catering",
    name: "Events, Photography, Catering & Venues",
    terminology: { customerNoun: "host", offeringNoun: "package", conversionNoun: "date reservation" },
    priorityKpis: ["Weekend date availability enquiries", "Package quote conversion", "Deposit-pending bookings"],
    leadQualificationQuestions: ["Event date, guest count, and venue location?", "Which package tier fits your event?"],
    safePlaybooks: ["Early-bird weekday/off-season event offer", "Guest tiers & deposit policy FAQ", "Quote follow-up"],
    upsellGuidance: "Highlight drone/album add-ons, extra chaffing dishes, or decor upgrades.",
  },
  education_tutoring_training: {
    key: "education_tutoring_training",
    name: "Education, Tutoring, Training & Academies",
    terminology: { customerNoun: "learner or parent", offeringNoun: "course or cohort", conversionNoun: "enrolment" },
    priorityKpis: ["Intake enquiries", "Seat fill rate", "Fee structure & schedule FAQs"],
    leadQualificationQuestions: ["Learner level/goal?", "Weekday, evening, or weekend cohort?"],
    safePlaybooks: ["Upcoming intake early-registration offer", "Syllabus, timetable & fee FAQ", "Cohort start reminder"],
    upsellGuidance: "Recommend exam-prep workshops or next-level modules upon completion.",
  },
  professional_agency_consulting: {
    key: "professional_agency_consulting",
    name: "Professional Services, Agencies, Legal/Accounting & Consulting",
    terminology: { customerNoun: "client", offeringNoun: "retainer or consultation", conversionNoun: "discovery booking" },
    priorityKpis: ["Qualified consultation enquiries", "Proposal turnaround time", "Retainer renewal health"],
    leadQualificationQuestions: ["Scope of engagement and timeline?", "Preferred consultation slot?"],
    safePlaybooks: ["Diagnostic consultation offer", "Scope, turnaround & onboarding FAQ", "Consultation prep reminder"],
    upsellGuidance: "Propose structured monthly retainers after one-off advisory sessions.",
    regulatedGuardrail: {
      code: "REGULATED_ADVISORY_LOCK",
      blockedPatterns: REGULATED_ADVISORY_PATTERNS,
      ownerNotice:
        "Regulated professional guardrail active: Autopilot assists with intake, scheduling, and general scope FAQs, and never issues binding legal, audit, or tax opinions.",
    },
  },
  hospitality_hotel_travel: {
    key: "hospitality_hotel_travel",
    name: "Hospitality, Hotels, Short-Stays & Travel",
    terminology: { customerNoun: "guest", offeringNoun: "room or tour package", conversionNoun: "confirmed stay" },
    priorityKpis: ["Occupancy & date enquiries", "Direct booking share", "Check-in/transfer FAQs"],
    leadQualificationQuestions: ["Check-in/check-out dates and number of guests?", "Airport transfer or meal plan needed?"],
    safePlaybooks: ["Stay-longer or weekend resident offer", "Check-in, transfer & cancellation FAQ", "Pre-arrival welcome message"],
    upsellGuidance: "Offer airport pickup, late checkout, or curated local excursions.",
  },
  wholesale_distributor_manufacturing: {
    key: "wholesale_distributor_manufacturing",
    name: "Wholesale, Distributors & Small Manufacturing",
    terminology: { customerNoun: "stockist", offeringNoun: "carton or batch SKU", conversionNoun: "wholesale order" },
    priorityKpis: ["Reorder cycle adherence", "MOQ & trade-tier enquiries", "Receivables aging"],
    leadQualificationQuestions: ["Business name, delivery town, and carton quantities?", "Target dispatch date?"],
    safePlaybooks: ["Carton volume tier offer", "MOQ, lead-time & dispatch FAQ", "Scheduled restock check-in"],
    upsellGuidance: "Encourage full-carton step-ups and cross-line stockist assortments.",
  },
  generic_custom: {
    key: "generic_custom",
    name: "Universal Custom Business Pack",
    terminology: { customerNoun: "customer", offeringNoun: "product or service", conversionNoun: "order or booking" },
    priorityKpis: ["Customer enquiries", "Unanswered Front Desk questions", "Recorded orders & bookings", "Active offers"],
    leadQualificationQuestions: ["What product or service are you looking for?", "Preferred timeline and contact method?"],
    safePlaybooks: ["Featured offer update", "Unanswered customer FAQ fix", "Consented enquiry follow-up"],
    upsellGuidance: "Highlight complementary active offerings grounded in your published catalogue.",
  },
};

export const ALL_INDUSTRY_PACK_KEYS = Object.keys(INDUSTRY_PACKS) as IndustryPackKey[];

export function isIndustryPackKey(value: unknown): value is IndustryPackKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INDUSTRY_PACKS, value);
}

/**
 * Deterministic mapping from an existing Business.category or explicit pack key
 * to one of the 15 Industry Packs (or `generic_custom` fallback).
 */
export function resolveIndustryPack(categoryOrPackKey?: string | null): IndustryPack {
  if (categoryOrPackKey && isIndustryPackKey(categoryOrPackKey)) {
    return INDUSTRY_PACKS[categoryOrPackKey];
  }
  const raw = (categoryOrPackKey ?? "").trim().toLowerCase();
  if (!raw) return INDUSTRY_PACKS.generic_custom;

  if (/\b(restaurant|cafe|bakery|food|coffee|bistro|fast[\s-]?food|eatery|grill)\b/.test(raw)) {
    return INDUSTRY_PACKS.restaurant_cafe_bakery;
  }
  if (/\b(supermarket|minimart|mini[\s-]?mart|grocery|duka|retail|general[\s-]?store|mart)\b/.test(raw)) {
    return INDUSTRY_PACKS.retail_supermarket_minimart;
  }
  if (/\b(salon|barber|barbershop|spa|beauty|nail|nails|hair|kinyozi|cosmetics?)\b/.test(raw)) {
    return INDUSTRY_PACKS.salon_barbershop_spa;
  }
  if (/(fashion|apparel|boutique|cloth|shoe|footwear|tailor|wear|jewelry)/.test(raw)) {
    return INDUSTRY_PACKS.fashion_apparel_footwear;
  }
  if (/(electronic|phone|laptop|computer|appliance|gadget|tech.?shop)/.test(raw)) {
    return INDUSTRY_PACKS.electronics_phone_appliance;
  }
  if (/(pharmac|chemist|clinic|hospital|dental|medical|health|wellness|optician)/.test(raw)) {
    return INDUSTRY_PACKS.pharmacy_clinic_wellness;
  }
  if (/(auto|garage|mechanic|car.?wash|tyre|spare.?part|motor)/.test(raw)) {
    return INDUSTRY_PACKS.auto_repair_garage_carwash;
  }
  if (/(real.?estate|property|rental|apartment|land|housing|realtor)/.test(raw)) {
    return INDUSTRY_PACKS.real_estate_property;
  }
  if (/(hardware|agrovet|construction|timber|cement|farm|seed|plumb)/.test(raw)) {
    return INDUSTRY_PACKS.hardware_agrovet_construction;
  }
  if (/(logistic|courier|delivery|transport|freight|mover|errand|dispatch)/.test(raw)) {
    return INDUSTRY_PACKS.logistics_courier_transport;
  }
  if (/(event|photo|videograph|cater|venue|decor|wedding|dj)/.test(raw)) {
    return INDUSTRY_PACKS.events_photography_catering;
  }
  if (/(educat|school|tutor|train|academy|college|course|coaching)/.test(raw)) {
    return INDUSTRY_PACKS.education_tutoring_training;
  }
  if (/(legal|law|account|audit|consult|agency|architect|marketing|advisory|professional)/.test(raw)) {
    return INDUSTRY_PACKS.professional_agency_consulting;
  }
  if (/(hotel|hospitality|travel|safari|tour|airbnb|lodge|resort|guest.?house)/.test(raw)) {
    return INDUSTRY_PACKS.hospitality_hotel_travel;
  }
  if (/(wholesale|distribut|manufactur|factory|supplier|packaging)/.test(raw)) {
    return INDUSTRY_PACKS.wholesale_distributor_manufacturing;
  }
  return INDUSTRY_PACKS.generic_custom;
}

export function checkRegulatedIndustryViolation(
  pack: IndustryPack,
  textToInspect: string,
): { allowed: true } | { allowed: false; code: string; reason: string } {
  const guardrail = pack.regulatedGuardrail;
  if (!guardrail) return { allowed: true };
  for (const pattern of guardrail.blockedPatterns) {
    if (pattern.test(textToInspect)) {
      return {
        allowed: false,
        code: guardrail.code,
        reason: guardrail.ownerNotice,
      };
    }
  }
  return { allowed: true };
}
