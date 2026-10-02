/**
 * Category Experience Profiles (§5, §6, §7–§12)
 *
 * Sixteen categories, each describing how a business of that type should *feel* and
 * behave. Every profile feeds the same renderer, editor, catalogue and checkout engine —
 * adding category seventeen later means adding one object here, never a new application.
 *
 * Nothing here hard-codes a page: it declares capabilities, terminology, sections,
 * field shape and theme defaults. The platform does the rest. (§51)
 */

import type { Capability, CategoryKey, ExperienceProfile, ProductFieldFlags, ServiceFieldFlags } from "./types";

const ALL_PRODUCT_FIELDS: ProductFieldFlags = {
  price: true, salePrice: true, images: true, category: true, stock: true, variants: true,
  sizes: true, colours: true, shades: true, ingredients: true, portion: true, addOns: true,
  prepTime: true, brand: true, tags: true, featured: true, sku: true,
};

const ALL_SERVICE_FIELDS: ServiceFieldFlags = {
  price: true, quote: true, duration: true, staff: true, deposit: true, availability: true,
  image: true, category: true, featured: true,
};

function productFields(overrides: Partial<ProductFieldFlags>): ProductFieldFlags {
  return { ...ALL_PRODUCT_FIELDS, ...overrides };
}

function serviceFields(overrides: Partial<ServiceFieldFlags>): ServiceFieldFlags {
  return { ...ALL_SERVICE_FIELDS, ...overrides };
}

/** ── 1. Food & Restaurant (§7) ───────────────────────────────────────────── */
export const FoodExperienceProfile: ExperienceProfile = {
  key: "food",
  label: "Food & Restaurant",
  blurb: "Menus, portions, add-ons and fast reordering.",
  mood: "Warm, appetising, immediate",
  aliases: ["Restaurant", "Food", "Hotel", "Eatery", "Cafe", "Café", "Butchery", "Bakery", "Catering"],
  itemNoun: "Dish",
  itemNounPlural: "Dishes",
  catalogueLabel: "Menu",
  capabilities: ["commerce", "catalogue", "delivery", "pickup"],
  cta: {
    primary: "Order now",
    secondary: "See the menu",
    add: "Add to order",
    cart: "Your order",
    enquire: "Call the kitchen",
    confirmation: "Order confirmed",
  },
  nav: ["Menu", "Offers", "About", "Contact"],
  defaultSections: ["navigation", "hero", "featured", "categories", "menu", "offers", "about", "location", "contact"],
  recommendedSections: ["gallery", "testimonials", "hours", "faq"],
  productFields: productFields({ colours: false, shades: false, sizes: false, brand: false, sku: false, variants: false }),
  serviceFields: serviceFields({ duration: false, staff: false, deposit: false, availability: false }),
  variantLabels: {},
  themeKeys: ["food-grill", "food-bistro", "food-street"],
  defaultThemeKey: "food-grill",
  filters: ["category", "availability"],
  searchPlaceholder: "Search the menu",
  orderStatuses: ["NEW", "ACCEPTED", "PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  structuredDataType: "Restaurant",
  analyticsEvents: ["PAGE_VIEW", "PRODUCT_VIEW", "SEARCH", "ADD_TO_CART", "CHECKOUT_STARTED", "PAYMENT_SUCCESS", "ORDER_CREATED", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** ── 2. Beauty & Cosmetics (§8) ──────────────────────────────────────────── */
export const BeautyExperienceProfile: ExperienceProfile = {
  key: "beauty",
  label: "Beauty & Cosmetics",
  blurb: "Shades, sizes, collections and brand story.",
  mood: "Refined, tactile, confident",
  aliases: ["Beauty", "Cosmetics", "Skincare", "Makeup", "Perfume"],
  itemNoun: "Product",
  itemNounPlural: "Products",
  catalogueLabel: "Shop",
  capabilities: ["commerce", "catalogue", "delivery", "pickup"],
  cta: {
    primary: "Shop now",
    secondary: "Browse collections",
    add: "Add to bag",
    cart: "Your bag",
    enquire: "Ask about this product",
    confirmation: "Order confirmed",
  },
  nav: ["Shop", "Collections", "Offers", "About", "Contact"],
  defaultSections: ["navigation", "hero", "collections", "featured", "categories", "offers", "about", "contact"],
  recommendedSections: ["gallery", "testimonials", "faq", "location"],
  productFields: productFields({ prepTime: false, addOns: false, portion: false, ingredients: true }),
  serviceFields: serviceFields({ duration: false, deposit: false }),
  variantLabels: { shades: "Shade", sizes: "Size" },
  themeKeys: ["beauty-editorial", "beauty-luxury", "beauty-minimal"],
  defaultThemeKey: "beauty-editorial",
  filters: ["category", "price", "availability"],
  searchPlaceholder: "Search products, shades, brands",
  orderStatuses: ["NEW", "PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  structuredDataType: "Store",
  analyticsEvents: ["PAGE_VIEW", "PRODUCT_VIEW", "SEARCH", "ADD_TO_CART", "CHECKOUT_STARTED", "PAYMENT_SUCCESS", "ORDER_CREATED", "WHATSAPP_CLICK"],
};

/** ── 3. Salon & Barber (§9) ──────────────────────────────────────────────── */
export const SalonExperienceProfile: ExperienceProfile = {
  key: "salon",
  label: "Salon & Barber",
  blurb: "Services, durations, staff and deposits.",
  mood: "Stylish, personal, calm",
  aliases: ["Salon", "Barber", "Barber Shop", "Spa", "Nails", "Hair"],
  itemNoun: "Service",
  itemNounPlural: "Services",
  catalogueLabel: "Services",
  capabilities: ["booking", "catalogue", "quote"],
  cta: {
    primary: "Book now",
    secondary: "See prices",
    add: "Book this",
    cart: "Your booking",
    enquire: "Ask a stylist",
    confirmation: "Booking requested",
  },
  nav: ["Services", "Gallery", "About", "Contact"],
  defaultSections: ["navigation", "hero", "services", "gallery", "about", "hours", "location", "contact"],
  recommendedSections: ["offers", "testimonials", "faq", "categories"],
  productFields: productFields({ prepTime: false, addOns: false, portion: false, ingredients: false, variants: false, colours: false, shades: false, sizes: false, sku: false, brand: false, stock: false, category: false, images: true, price: true, salePrice: false, tags: false, featured: true }),
  serviceFields: serviceFields({}),
  variantLabels: {},
  themeKeys: ["salon-studio", "salon-classic", "salon-minimal"],
  defaultThemeKey: "salon-studio",
  filters: ["category", "duration"],
  searchPlaceholder: "Search services",
  orderStatuses: ["NEW", "ACCEPTED", "COMPLETED", "CANCELLED"],
  structuredDataType: "HealthAndBeautyBusiness",
  analyticsEvents: ["PAGE_VIEW", "SERVICE_VIEW", "BOOKING_CREATED", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** ── 4. Fashion & Clothing (§10) ─────────────────────────────────────────── */
export const FashionExperienceProfile: ExperienceProfile = {
  key: "fashion",
  label: "Fashion & Clothing",
  blurb: "Sizes, colours, new arrivals and sale rails.",
  mood: "Editorial, bold, current",
  aliases: ["Fashion", "Clothing", "Boutique", "Apparel", "Shoes", "Tailor"],
  itemNoun: "Item",
  itemNounPlural: "Items",
  catalogueLabel: "Shop",
  capabilities: ["commerce", "catalogue", "delivery", "pickup"],
  cta: {
    primary: "Shop new arrivals",
    secondary: "View the lookbook",
    add: "Add to bag",
    cart: "Your bag",
    enquire: "Ask about sizing",
    confirmation: "Order confirmed",
  },
  nav: ["New in", "Shop", "Sale", "About", "Contact"],
  defaultSections: ["navigation", "hero", "collections", "featured", "categories", "offers", "about", "contact"],
  recommendedSections: ["gallery", "testimonials", "faq"],
  productFields: productFields({ ingredients: false, prepTime: false, addOns: false, portion: false, shades: false }),
  serviceFields: serviceFields({ duration: false, deposit: false, availability: false }),
  variantLabels: { sizes: "Size", colours: "Colour" },
  themeKeys: ["fashion-editorial", "fashion-boutique", "fashion-contemporary"],
  defaultThemeKey: "fashion-editorial",
  filters: ["category", "price", "availability"],
  searchPlaceholder: "Search the collection",
  orderStatuses: ["NEW", "PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  structuredDataType: "Store",
  analyticsEvents: ["PAGE_VIEW", "PRODUCT_VIEW", "SEARCH", "ADD_TO_CART", "CHECKOUT_STARTED", "PAYMENT_SUCCESS", "ORDER_CREATED", "WHATSAPP_CLICK"],
};

/** ── 5. Retail & General Shop ───────────────────────────────────────────── */
export const RetailExperienceProfile: ExperienceProfile = {
  key: "retail",
  label: "Retail & General Shop",
  blurb: "Everyday stock, prices and quick reordering.",
  mood: "Clear, practical, local",
  aliases: ["Retail", "Shop", "General Shop", "Grocery", "Supermarket", "Chemist", "Pharmacy", "Agrovet", "Hardware"],
  itemNoun: "Product",
  itemNounPlural: "Products",
  catalogueLabel: "Shop",
  capabilities: ["commerce", "catalogue", "delivery", "pickup", "quote"],
  cta: {
    primary: "Shop now",
    secondary: "Browse the shelves",
    add: "Add to basket",
    cart: "Your basket",
    enquire: "Check availability",
    confirmation: "Order confirmed",
  },
  nav: ["Shop", "Offers", "About", "Contact"],
  defaultSections: ["navigation", "hero", "featured", "categories", "offers", "about", "location", "contact"],
  recommendedSections: ["gallery", "faq", "hours"],
  productFields: productFields({ shades: false, ingredients: false, prepTime: false, addOns: false, portion: false }),
  serviceFields: serviceFields({ duration: false, deposit: false, availability: false }),
  variantLabels: { sizes: "Size", colours: "Colour" },
  themeKeys: ["retail-market", "retail-fresh", "retail-bold"],
  defaultThemeKey: "retail-market",
  filters: ["category", "price", "availability"],
  searchPlaceholder: "Search the shop",
  orderStatuses: ["NEW", "PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  structuredDataType: "Store",
  analyticsEvents: ["PAGE_VIEW", "PRODUCT_VIEW", "SEARCH", "ADD_TO_CART", "CHECKOUT_STARTED", "PAYMENT_SUCCESS", "ORDER_CREATED", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** ── 6. Electronics ─────────────────────────────────────────────────────── */
export const ElectronicsExperienceProfile: ExperienceProfile = {
  key: "electronics",
  label: "Electronics",
  blurb: "Specs, warranties, brands and price-led browsing.",
  mood: "Precise, technical, trustworthy",
  aliases: ["Electronics", "Phones", "Computers", "Gadgets", "Tech", "Accessories"],
  itemNoun: "Product",
  itemNounPlural: "Products",
  catalogueLabel: "Catalogue",
  capabilities: ["commerce", "catalogue", "quote", "delivery", "pickup"],
  cta: {
    primary: "Shop devices",
    secondary: "Compare models",
    add: "Add to cart",
    cart: "Your cart",
    enquire: "Ask about stock",
    confirmation: "Order confirmed",
  },
  nav: ["Catalogue", "Brands", "Offers", "Support", "Contact"],
  defaultSections: ["navigation", "hero", "categories", "featured", "offers", "about", "contact"],
  recommendedSections: ["faq", "testimonials", "location", "gallery"],
  productFields: productFields({ shades: false, colours: false, ingredients: false, prepTime: false, addOns: false, portion: false, sizes: false, variants: false }),
  serviceFields: serviceFields({ quote: true, duration: true, staff: false, deposit: false, availability: false }),
  variantLabels: {},
  themeKeys: ["tech-precision", "tech-nightshift", "tech-clean"],
  defaultThemeKey: "tech-precision",
  filters: ["category", "price", "availability"],
  searchPlaceholder: "Search brands and models",
  orderStatuses: ["NEW", "PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  structuredDataType: "Store",
  analyticsEvents: ["PAGE_VIEW", "PRODUCT_VIEW", "SEARCH", "ADD_TO_CART", "CHECKOUT_STARTED", "PAYMENT_SUCCESS", "ORDER_CREATED", "CALL_CLICK", "WHATSAPP_CLICK"],
};

/** ── 7. Automotive (§12, §43) ───────────────────────────────────────────── */
export const AutomotiveExperienceProfile: ExperienceProfile = {
  key: "automotive",
  label: "Automotive",
  blurb: "Service booking, diagnostics and parts.",
  mood: "Capable, honest, engineered",
  aliases: ["Automotive", "Mechanic", "Garage", "Auto", "Car Wash", "Tyres", "Motors", "Boda Boda Repair"],
  itemNoun: "Service",
  itemNounPlural: "Services",
  catalogueLabel: "Services",
  capabilities: ["booking", "catalogue", "quote", "commerce"],
  cta: {
    primary: "Book service",
    secondary: "Get a quote",
    add: "Book this",
    cart: "Your request",
    enquire: "Describe the problem",
    confirmation: "Booking requested",
  },
  nav: ["Services", "Parts", "About", "Contact"],
  defaultSections: ["navigation", "hero", "services", "featured", "about", "location", "contact"],
  recommendedSections: ["offers", "gallery", "faq", "testimonials", "hours"],
  productFields: productFields({ shades: false, colours: false, ingredients: false, prepTime: false, addOns: false, portion: false, sizes: false, variants: false, salePrice: true }),
  serviceFields: serviceFields({}),
  variantLabels: {},
  themeKeys: ["auto-workshop", "auto-certified", "auto-performance"],
  defaultThemeKey: "auto-workshop",
  filters: ["category", "duration"],
  searchPlaceholder: "Search services and parts",
  orderStatuses: ["NEW", "ACCEPTED", "PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  structuredDataType: "AutomotiveBusiness",
  analyticsEvents: ["PAGE_VIEW", "SERVICE_VIEW", "BOOKING_CREATED", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** ── 8. Real Estate (§11) ───────────────────────────────────────────────── */
export const RealEstateExperienceProfile: ExperienceProfile = {
  key: "realestate",
  label: "Real Estate",
  blurb: "Listings, viewing requests and enquiries. Not a shopping cart.",
  mood: "Spacious, credible, considered",
  aliases: ["Real Estate", "Property", "Rentals", "Lettings", "Land", "Realtor"],
  itemNoun: "Property",
  itemNounPlural: "Properties",
  catalogueLabel: "Listings",
  capabilities: ["catalogue", "enquiry", "quote"],
  cta: {
    primary: "Browse listings",
    secondary: "Request a viewing",
    add: "Enquire",
    cart: "Your enquiries",
    enquire: "Enquire about this property",
    confirmation: "Enquiry sent",
  },
  nav: ["Listings", "About", "Contact"],
  defaultSections: ["navigation", "hero", "properties", "about", "location", "contact"],
  recommendedSections: ["testimonials", "faq", "gallery", "offers"],
  productFields: productFields({
    price: true, salePrice: false, images: true, category: true, stock: true, variants: false,
    sizes: false, colours: false, shades: false, ingredients: false, portion: false, addOns: false,
    prepTime: false, brand: false, tags: true, featured: true, sku: false,
  }),
  serviceFields: serviceFields({ price: false, duration: false, staff: false, deposit: false, availability: false }),
  variantLabels: {},
  themeKeys: ["estate-signature", "estate-prestige", "estate-clean"],
  defaultThemeKey: "estate-signature",
  filters: ["type", "location", "price"],
  searchPlaceholder: "Search by location, type or price",
  orderStatuses: ["NEW", "ACCEPTED", "COMPLETED", "CANCELLED"],
  structuredDataType: "RealEstateAgent",
  analyticsEvents: ["PAGE_VIEW", "PRODUCT_VIEW", "SEARCH", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** ── 9. Furniture & Home ────────────────────────────────────────────────── */
export const FurnitureExperienceProfile: ExperienceProfile = {
  key: "furniture",
  label: "Furniture & Home",
  blurb: "Made-to-order pieces, materials and room inspiration.",
  mood: "Crafted, warm, material",
  aliases: ["Furniture", "Home", "Interior", "Decor", "Upholstery", "Carpentry"],
  itemNoun: "Piece",
  itemNounPlural: "Pieces",
  catalogueLabel: "Collection",
  capabilities: ["commerce", "catalogue", "quote", "delivery", "pickup"],
  cta: {
    primary: "Explore the collection",
    secondary: "Request a quote",
    add: "Add to enquiry",
    cart: "Your selection",
    enquire: "Request a quote",
    confirmation: "Enquiry sent",
  },
  nav: ["Collection", "Rooms", "About", "Contact"],
  defaultSections: ["navigation", "hero", "collections", "featured", "about", "gallery", "contact"],
  recommendedSections: ["testimonials", "faq", "location", "offers"],
  productFields: productFields({ shades: false, ingredients: false, prepTime: false, addOns: false, portion: false }),
  serviceFields: serviceFields({ quote: true, duration: false, availability: false }),
  variantLabels: { sizes: "Size", colours: "Finish" },
  themeKeys: ["home-crafted", "home-calm", "home-grain"],
  defaultThemeKey: "home-crafted",
  filters: ["category", "price", "availability"],
  searchPlaceholder: "Search furniture and decor",
  orderStatuses: ["NEW", "ACCEPTED", "PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  structuredDataType: "HomeAndConstructionBusiness",
  analyticsEvents: ["PAGE_VIEW", "PRODUCT_VIEW", "SEARCH", "ADD_TO_CART", "CHECKOUT_STARTED", "PAYMENT_SUCCESS", "ORDER_CREATED", "WHATSAPP_CLICK", "CALL_CLICK"],
};

/** ── 10. Fitness & Wellness ─────────────────────────────────────────────── */
export const FitnessExperienceProfile: ExperienceProfile = {
  key: "fitness",
  label: "Fitness & Wellness",
  blurb: "Classes, memberships, trainers and schedules.",
  mood: "Energetic, disciplined, encouraging",
  aliases: ["Fitness", "Gym", "Wellness", "Yoga", "Training", "Health"],
  itemNoun: "Session",
  itemNounPlural: "Sessions",
  catalogueLabel: "Programmes",
  capabilities: ["booking", "catalogue", "commerce"],
  cta: {
    primary: "Book a session",
    secondary: "View the timetable",
    add: "Book this",
    cart: "Your booking",
    enquire: "Talk to a trainer",
    confirmation: "Booking confirmed",
  },
  nav: ["Programmes", "Timetable", "Trainers", "Contact"],
  defaultSections: ["navigation", "hero", "services", "featured", "testimonials", "hours", "location", "contact"],
  recommendedSections: ["gallery", "offers", "faq", "about", "categories"],
  productFields: productFields({ shades: false, colours: false, ingredients: false, prepTime: false, addOns: false, portion: false, sizes: false, variants: false }),
  serviceFields: serviceFields({}),
  variantLabels: {},
  themeKeys: ["fitness-energy", "fitness-balance", "fitness-performance"],
  defaultThemeKey: "fitness-energy",
  filters: ["category", "duration"],
  searchPlaceholder: "Search classes and programmes",
  orderStatuses: ["NEW", "ACCEPTED", "COMPLETED", "CANCELLED"],
  structuredDataType: "HealthAndBeautyBusiness",
  analyticsEvents: ["PAGE_VIEW", "SERVICE_VIEW", "BOOKING_CREATED", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** ── 11. Creative & Photography ─────────────────────────────────────────── */
export const CreativeExperienceProfile: ExperienceProfile = {
  key: "creative",
  label: "Creative & Photography",
  blurb: "Portfolios, packages and booking by project.",
  mood: "Artful, quiet, image-led",
  aliases: ["Photography", "Creative", "Studio", "Design", "Video", "Events", "Media", "Printing"],
  itemNoun: "Package",
  itemNounPlural: "Packages",
  catalogueLabel: "Portfolio",
  capabilities: ["booking", "catalogue", "quote", "enquiry"],
  cta: {
    primary: "View the portfolio",
    secondary: "Request a quote",
    add: "Request this",
    cart: "Your request",
    enquire: "Start a project",
    confirmation: "Request sent",
  },
  nav: ["Portfolio", "Packages", "About", "Contact"],
  defaultSections: ["navigation", "hero", "gallery", "services", "about", "contact"],
  recommendedSections: ["testimonials", "faq", "featured", "offers"],
  productFields: productFields({ stock: false, shades: false, colours: false, ingredients: false, prepTime: false, addOns: false, portion: false, sizes: false, variants: false, salePrice: false, sku: false }),
  serviceFields: serviceFields({}),
  variantLabels: {},
  themeKeys: ["creative-gallery", "creative-studio", "creative-editorial"],
  defaultThemeKey: "creative-gallery",
  filters: ["category", "price"],
  searchPlaceholder: "Search the portfolio",
  orderStatuses: ["NEW", "ACCEPTED", "COMPLETED", "CANCELLED"],
  structuredDataType: "ProfessionalService",
  analyticsEvents: ["PAGE_VIEW", "SERVICE_VIEW", "BOOKING_CREATED", "WHATSAPP_CLICK", "CALL_CLICK"],
};

/** ── 12. Professional Services (§12) ────────────────────────────────────── */
export const ProfessionalExperienceProfile: ExperienceProfile = {
  key: "professional",
  label: "Professional Services",
  blurb: "Consultations, retainers and fixed-fee work.",
  mood: "Assured, clear, credible",
  aliases: ["Professional Services", "Consultancy", "Consultant", "Legal", "Accounting", "Lawyer", "Insurance", "Agency", "Marketing"],
  itemNoun: "Service",
  itemNounPlural: "Services",
  catalogueLabel: "Services",
  capabilities: ["booking", "catalogue", "quote", "enquiry"],
  cta: {
    primary: "Book a consultation",
    secondary: "Request a quote",
    add: "Request this",
    cart: "Your request",
    enquire: "Request a quote",
    confirmation: "Request sent",
  },
  nav: ["Services", "About", "Insights", "Contact"],
  defaultSections: ["navigation", "hero", "services", "about", "testimonials", "faq", "contact"],
  recommendedSections: ["featured", "gallery", "offers", "location", "hours"],
  productFields: productFields({ stock: false, shades: false, colours: false, ingredients: false, prepTime: false, addOns: false, portion: false, sizes: false, variants: false, salePrice: false, sku: false, images: false, category: true, tags: false }),
  serviceFields: serviceFields({}),
  variantLabels: {},
  themeKeys: ["pro-professional", "pro-modern", "pro-trust"],
  defaultThemeKey: "pro-professional",
  filters: ["category", "duration"],
  searchPlaceholder: "Search services",
  orderStatuses: ["NEW", "ACCEPTED", "COMPLETED", "CANCELLED"],
  structuredDataType: "ProfessionalService",
  analyticsEvents: ["PAGE_VIEW", "SERVICE_VIEW", "BOOKING_CREATED", "CALL_CLICK", "WHATSAPP_CLICK"],
};

/** ── 13. Hospitality ────────────────────────────────────────────────────── */
export const HospitalityExperienceProfile: ExperienceProfile = {
  key: "hospitality",
  label: "Hospitality",
  blurb: "Rooms, tables, events and availability.",
  mood: "Welcoming, calm, considered",
  aliases: ["Hospitality", "Hotel", "Lodge", "Guest House", "Airbnb", "Tours", "Travel", "Events", "Catering"],
  itemNoun: "Experience",
  itemNounPlural: "Experiences",
  catalogueLabel: "Stays & offers",
  capabilities: ["booking", "catalogue", "enquiry", "commerce"],
  cta: {
    primary: "Check availability",
    secondary: "Explore stays",
    add: "Reserve",
    cart: "Your reservation",
    enquire: "Ask about availability",
    confirmation: "Reservation requested",
  },
  nav: ["Stays", "Dining", "Gallery", "Contact"],
  defaultSections: ["navigation", "hero", "featured", "gallery", "services", "about", "location", "contact"],
  recommendedSections: ["offers", "testimonials", "faq", "hours"],
  productFields: productFields({ shades: false, colours: false, ingredients: false, prepTime: false, addOns: true, portion: false, sizes: false, variants: false, sku: false }),
  serviceFields: serviceFields({}),
  variantLabels: {},
  themeKeys: ["hospitality-lodge", "hospitality-resort", "hospitality-urban"],
  defaultThemeKey: "hospitality-lodge",
  filters: ["category", "price", "availability"],
  searchPlaceholder: "Search rooms and experiences",
  orderStatuses: ["NEW", "ACCEPTED", "COMPLETED", "CANCELLED"],
  structuredDataType: "LodgingBusiness",
  analyticsEvents: ["PAGE_VIEW", "SERVICE_VIEW", "PRODUCT_VIEW", "BOOKING_CREATED", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** ── 14. Education & Training ───────────────────────────────────────────── */
export const EducationExperienceProfile: ExperienceProfile = {
  key: "education",
  label: "Education & Training",
  blurb: "Courses, cohorts, fees and enrolment.",
  mood: "Structured, encouraging, clear",
  aliases: ["Education", "Training", "School", "Tutor", "Academy", "College", "Driving School"],
  itemNoun: "Course",
  itemNounPlural: "Courses",
  catalogueLabel: "Courses",
  capabilities: ["booking", "catalogue", "quote", "enquiry"],
  cta: {
    primary: "Enrol now",
    secondary: "Download the syllabus",
    add: "Enrol",
    cart: "Your enrolment",
    enquire: "Ask about this course",
    confirmation: "Enrolment received",
  },
  nav: ["Courses", "About", "Admissions", "Contact"],
  defaultSections: ["navigation", "hero", "services", "about", "testimonials", "faq", "contact"],
  recommendedSections: ["featured", "gallery", "offers", "hours", "location"],
  productFields: productFields({ stock: false, shades: false, colours: false, ingredients: false, prepTime: false, addOns: false, portion: false, sizes: false, variants: false, salePrice: true, sku: false, images: true }),
  serviceFields: serviceFields({}),
  variantLabels: {},
  themeKeys: ["education-academy", "education-modern", "education-trust"],
  defaultThemeKey: "education-academy",
  filters: ["category", "duration"],
  searchPlaceholder: "Search courses",
  orderStatuses: ["NEW", "ACCEPTED", "COMPLETED", "CANCELLED"],
  structuredDataType: "EducationalOrganization",
  analyticsEvents: ["PAGE_VIEW", "SERVICE_VIEW", "BOOKING_CREATED", "CALL_CLICK", "WHATSAPP_CLICK"],
};

/** ── 15. Home & Technical Services (§12) ───────────────────────────────── */
export const TechnicalExperienceProfile: ExperienceProfile = {
  key: "technical",
  label: "Home & Technical Services",
  blurb: "Call-outs, quotes and booked visits.",
  mood: "Dependable, direct, local",
  aliases: ["Home Services", "Plumber", "Electrician", "Technician", "Repair", "Cleaning", "Contractor", "Fundi", "Maintenance", "Moving"],
  itemNoun: "Service",
  itemNounPlural: "Services",
  catalogueLabel: "Services",
  capabilities: ["booking", "catalogue", "quote", "enquiry"],
  cta: {
    primary: "Request a quote",
    secondary: "Book a visit",
    add: "Request this",
    cart: "Your request",
    enquire: "Describe the job",
    confirmation: "Request sent",
  },
  nav: ["Services", "Coverage", "About", "Contact"],
  defaultSections: ["navigation", "hero", "services", "about", "testimonials", "location", "contact"],
  recommendedSections: ["faq", "gallery", "offers", "hours", "featured"],
  productFields: productFields({ stock: false, shades: false, colours: false, ingredients: false, prepTime: false, addOns: false, portion: false, sizes: false, variants: false, salePrice: false, sku: false, images: true, category: true, price: true, tags: false, brand: false }),
  serviceFields: serviceFields({}),
  variantLabels: {},
  themeKeys: ["technical-reliable", "technical-modern", "technical-rapid"],
  defaultThemeKey: "technical-reliable",
  filters: ["category", "location"],
  searchPlaceholder: "Search services",
  orderStatuses: ["NEW", "ACCEPTED", "PROCESSING", "COMPLETED", "CANCELLED"],
  structuredDataType: "HomeAndConstructionBusiness",
  analyticsEvents: ["PAGE_VIEW", "SERVICE_VIEW", "BOOKING_CREATED", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** ── 16. Other ─────────────────────────────────────────────────────────── */
export const OtherExperienceProfile: ExperienceProfile = {
  key: "other",
  label: "Other",
  blurb: "A flexible experience you can shape as you go.",
  mood: "Neutral, adaptable",
  aliases: ["Other", "", "General", "Business"],
  itemNoun: "Item",
  itemNounPlural: "Items",
  catalogueLabel: "Catalogue",
  capabilities: ["catalogue", "commerce", "quote", "enquiry"],
  cta: {
    primary: "Get in touch",
    secondary: "Browse",
    add: "Add",
    cart: "Your selection",
    enquire: "Enquire",
    confirmation: "Request sent",
  },
  nav: ["Catalogue", "About", "Contact"],
  defaultSections: ["navigation", "hero", "featured", "about", "contact"],
  recommendedSections: ["services", "categories", "offers", "gallery", "location", "faq", "testimonials"],
  productFields: productFields({}),
  serviceFields: serviceFields({}),
  variantLabels: { sizes: "Size", colours: "Colour" },
  themeKeys: ["core-minimal", "core-bold", "core-warm"],
  defaultThemeKey: "core-minimal",
  filters: ["category", "price"],
  searchPlaceholder: "Search",
  orderStatuses: ["NEW", "ACCEPTED", "PROCESSING", "READY", "COMPLETED", "CANCELLED"],
  structuredDataType: "LocalBusiness",
  analyticsEvents: ["PAGE_VIEW", "PRODUCT_VIEW", "SERVICE_VIEW", "SEARCH", "ADD_TO_CART", "ORDER_CREATED", "BOOKING_CREATED", "CALL_CLICK", "WHATSAPP_CLICK", "DIRECTIONS_CLICK"],
};

/** Every profile, in the order shown to a business owner (§5). */
export const EXPERIENCE_PROFILES: ExperienceProfile[] = [
  FoodExperienceProfile,
  BeautyExperienceProfile,
  SalonExperienceProfile,
  FashionExperienceProfile,
  RetailExperienceProfile,
  ElectronicsExperienceProfile,
  AutomotiveExperienceProfile,
  RealEstateExperienceProfile,
  FurnitureExperienceProfile,
  FitnessExperienceProfile,
  CreativeExperienceProfile,
  ProfessionalExperienceProfile,
  HospitalityExperienceProfile,
  EducationExperienceProfile,
  TechnicalExperienceProfile,
  OtherExperienceProfile,
];

const PROFILE_BY_KEY = new Map(EXPERIENCE_PROFILES.map((profile) => [profile.key, profile]));

/** Alias → profile, lowercased. Built once; legacy JATA categories resolve here (§39). */
const PROFILE_BY_ALIAS = new Map<string, ExperienceProfile>();
for (const profile of EXPERIENCE_PROFILES) {
  PROFILE_BY_ALIAS.set(profile.key, profile);
  PROFILE_BY_ALIAS.set(profile.label.toLowerCase(), profile);
  for (const alias of profile.aliases) {
    const normalized = alias.trim().toLowerCase();
    if (normalized) PROFILE_BY_ALIAS.set(normalized, profile);
  }
}

export const CATEGORY_KEYS: CategoryKey[] = EXPERIENCE_PROFILES.map((profile) => profile.key);

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && PROFILE_BY_KEY.has(value as CategoryKey);
}

/** Never throws: an unknown category degrades to `other` rather than breaking a page. */
export function getExperienceProfile(key: string | null | undefined): ExperienceProfile {
  if (key && PROFILE_BY_KEY.has(key as CategoryKey)) return PROFILE_BY_KEY.get(key as CategoryKey)!;
  return OtherExperienceProfile;
}

/**
 * Resolve a stored JATA business category (free text, e.g. "Restaurant") to a profile.
 * Falls back to `other`, which is a complete experience rather than an error path.
 */
export function resolveExperienceProfile(category: string | null | undefined): ExperienceProfile {
  if (!category) return OtherExperienceProfile;
  const normalized = category.trim().toLowerCase();
  return PROFILE_BY_ALIAS.get(normalized) || OtherExperienceProfile;
}

export function capabilityOf(profile: ExperienceProfile, capability: Capability): boolean {
  return profile.capabilities.includes(capability);
}

export function hasCapability(categoryKey: string | null | undefined, capability: Capability): boolean {
  return capabilityOf(getExperienceProfile(categoryKey), capability);
}

/** Owner-facing category picker options. */
export function categoryOptions(): Array<{ key: CategoryKey; label: string; blurb: string; mood: string }> {
  return EXPERIENCE_PROFILES.map((profile) => ({
    key: profile.key,
    label: profile.label,
    blurb: profile.blurb,
    mood: profile.mood,
  }));
}
