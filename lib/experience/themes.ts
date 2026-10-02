/**
 * Theme Engine (§21, §22, §50)
 *
 * Every theme consumes the same token system, so the platform stays coherent even when a
 * restaurant and a property agency look nothing alike. A theme is composed from:
 *
 *   palette (colour)  +  treatment (typography, shape, hero, motion)  +  brand overrides
 *
 * Colours are stored as hex so contrast can be measured server-side. Derived tokens
 * (muted text, borders, hero scrims) are computed from the palette, and any derived text
 * colour that would fall below WCAG AA is corrected before it reaches the browser (§48).
 */

import { accessibleSolidPair, contrastWarning, ensureAccessiblePair, isHexColor, mixHex, readableTextOn, withAlpha, type ContrastWarning } from "./color";
import type { CategoryKey, ExperienceBrand } from "./types";

export type ThemePalette = {
  bg: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  heading: string;
  muted: string;
  primary: string;
  primaryText: string;
  accent: string;
  border: string;
  headerBg: string;
  headerText: string;
  footerBg: string;
  footerText: string;
  overlay: string;
};

type PaletteInput = {
  bg: string;
  surface: string;
  text: string;
  primary: string;
  heading?: string;
  accent?: string;
  /** Overrides when the header/footer deliberately invert the page (dark bands, etc). */
  header?: { bg?: string; text?: string };
  footer?: { bg?: string; text?: string };
  overlay?: string;
};

function buildPalette(input: PaletteInput): ThemePalette {
  const { bg, surface, text, primary } = input;
  const heading = input.heading || text;
  const accent = input.accent || primary;
  const muted = ensureAccessiblePair(mixHex(text, surface, 0.38), surface);
  const border = mixHex(text, surface, 0.82);
  const surfaceMuted = mixHex(text, surface, 0.94);
  const headerBg = input.header?.bg || surface;
  const headerText = ensureAccessiblePair(input.header?.text || text, headerBg);
  const footerBg = input.footer?.bg || mixHex(text, bg, 0.92);
  const footerText = ensureAccessiblePair(input.footer?.text || text, footerBg);
  const overlay = input.overlay || withAlpha(mixHex(text, "#000000", 0.75), 0.58);
  // A call-to-action must be readable even when the brand colour sits mid-range (§21).
  const solid = accessibleSolidPair(primary);

  return {
    bg,
    surface,
    surfaceMuted,
    text: ensureAccessiblePair(text, bg),
    heading: ensureAccessiblePair(heading, bg),
    muted,
    primary: solid.background,
    primaryText: solid.text,
    accent,
    border,
    headerBg,
    headerText,
    footerBg,
    footerText,
    overlay,
  };
}

export type ButtonStyle = "solid" | "soft" | "outline" | "pill";
export type CardStyle = "plain" | "elevated" | "bordered" | "media";
export type HeroStyle = "overlay" | "split" | "centered" | "band";
export type NavStyle = "inline" | "pill" | "bar";
export type MotionLevel = "none" | "subtle" | "expressive";

export type ThemeTreatment = {
  key: string;
  name: string;
  display: string;
  body: string;
  eyebrowFont?: string;
  headingWeight: number;
  headingTracking: string;
  bodySize: string;
  uppercaseEyebrow: boolean;
  radius: string;
  buttonRadius: string;
  cardRadius: string;
  shadow: string;
  buttonStyle: ButtonStyle;
  buttonWeight: number;
  buttonUppercase: boolean;
  cardStyle: CardStyle;
  mediaRatio: string;
  heroStyle: HeroStyle;
  heroMinHeight: string;
  navStyle: NavStyle;
  navSticky: boolean;
  sectionSpacing: string;
  motion: MotionLevel;
};

const GROTESK = `Inter, "Helvetica Neue", Helvetica, Arial, sans-serif`;
const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`;
const MONO = `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`;

const TREATMENTS: Record<string, ThemeTreatment> = {
  editorial: {
    key: "editorial",
    name: "Editorial",
    display: SERIF,
    body: GROTESK,
    headingWeight: 600,
    headingTracking: "-0.02em",
    bodySize: "1.0625rem",
    uppercaseEyebrow: true,
    radius: "2px",
    buttonRadius: "2px",
    cardRadius: "2px",
    shadow: "none",
    buttonStyle: "solid",
    buttonWeight: 600,
    buttonUppercase: true,
    cardStyle: "plain",
    mediaRatio: "4 / 5",
    heroStyle: "overlay",
    heroMinHeight: "78vh",
    navStyle: "inline",
    navSticky: true,
    sectionSpacing: "6.5rem",
    motion: "subtle",
  },
  minimal: {
    key: "minimal",
    name: "Minimal",
    display: GROTESK,
    body: GROTESK,
    headingWeight: 500,
    headingTracking: "-0.03em",
    bodySize: "1rem",
    uppercaseEyebrow: true,
    radius: "4px",
    buttonRadius: "999px",
    cardRadius: "6px",
    shadow: "none",
    buttonStyle: "solid",
    buttonWeight: 550,
    buttonUppercase: false,
    cardStyle: "bordered",
    mediaRatio: "1 / 1",
    heroStyle: "centered",
    heroMinHeight: "62vh",
    navStyle: "inline",
    navSticky: true,
    sectionSpacing: "5.5rem",
    motion: "none",
  },
  bold: {
    key: "bold",
    name: "Bold",
    display: GROTESK,
    body: GROTESK,
    headingWeight: 750,
    headingTracking: "-0.035em",
    bodySize: "1.0625rem",
    uppercaseEyebrow: true,
    radius: "10px",
    buttonRadius: "999px",
    cardRadius: "14px",
    shadow: "0 14px 34px rgba(0,0,0,0.10)",
    buttonStyle: "pill",
    buttonWeight: 700,
    buttonUppercase: true,
    cardStyle: "elevated",
    mediaRatio: "4 / 3",
    heroStyle: "overlay",
    heroMinHeight: "84vh",
    navStyle: "pill",
    navSticky: true,
    sectionSpacing: "6rem",
    motion: "subtle",
  },
  warm: {
    key: "warm",
    name: "Warm",
    display: SERIF,
    body: GROTESK,
    headingWeight: 650,
    headingTracking: "-0.015em",
    bodySize: "1.0625rem",
    uppercaseEyebrow: false,
    radius: "18px",
    buttonRadius: "999px",
    cardRadius: "20px",
    shadow: "0 10px 30px rgba(60,40,20,0.08)",
    buttonStyle: "solid",
    buttonWeight: 600,
    buttonUppercase: false,
    cardStyle: "elevated",
    mediaRatio: "4 / 3",
    heroStyle: "split",
    heroMinHeight: "70vh",
    navStyle: "bar",
    navSticky: true,
    sectionSpacing: "5.5rem",
    motion: "subtle",
  },
  technical: {
    key: "technical",
    name: "Technical",
    display: GROTESK,
    body: GROTESK,
    eyebrowFont: MONO,
    headingWeight: 700,
    headingTracking: "-0.01em",
    bodySize: "1rem",
    uppercaseEyebrow: true,
    radius: "4px",
    buttonRadius: "4px",
    cardRadius: "6px",
    shadow: "0 2px 10px rgba(0,0,0,0.06)",
    buttonStyle: "solid",
    buttonWeight: 650,
    buttonUppercase: false,
    cardStyle: "bordered",
    mediaRatio: "16 / 10",
    heroStyle: "band",
    heroMinHeight: "54vh",
    navStyle: "bar",
    navSticky: true,
    sectionSpacing: "4.5rem",
    motion: "none",
  },
  classic: {
    key: "classic",
    name: "Classic",
    display: SERIF,
    body: SERIF,
    headingWeight: 600,
    headingTracking: "0",
    bodySize: "1.0625rem",
    uppercaseEyebrow: true,
    radius: "3px",
    buttonRadius: "3px",
    cardRadius: "4px",
    shadow: "0 6px 20px rgba(0,0,0,0.06)",
    buttonStyle: "outline",
    buttonWeight: 600,
    buttonUppercase: true,
    cardStyle: "bordered",
    mediaRatio: "3 / 4",
    heroStyle: "overlay",
    heroMinHeight: "72vh",
    navStyle: "bar",
    navSticky: true,
    sectionSpacing: "6rem",
    motion: "subtle",
  },
  resort: {
    key: "resort",
    name: "Resort",
    display: SERIF,
    body: GROTESK,
    headingWeight: 500,
    headingTracking: "-0.01em",
    bodySize: "1.0625rem",
    uppercaseEyebrow: true,
    radius: "14px",
    buttonRadius: "999px",
    cardRadius: "16px",
    shadow: "0 12px 32px rgba(20,40,50,0.08)",
    buttonStyle: "soft",
    buttonWeight: 600,
    buttonUppercase: false,
    cardStyle: "media",
    mediaRatio: "3 / 2",
    heroStyle: "overlay",
    heroMinHeight: "88vh",
    navStyle: "pill",
    navSticky: true,
    sectionSpacing: "6.5rem",
    motion: "subtle",
  },
};

export type ExperienceTheme = {
  key: string;
  name: string;
  description: string;
  categoryKey: CategoryKey;
  palette: ThemePalette;
  treatment: ThemeTreatment;
};

type ThemeDefinition = {
  key: string;
  name: string;
  description: string;
  categoryKey: CategoryKey;
  palette: PaletteInput;
  treatment: string;
};

const DEFINITIONS: ThemeDefinition[] = [
  // ── Food (§21) ────────────────────────────────────────────────────────────
  {
    key: "food-grill", name: "Modern Grill", categoryKey: "food", treatment: "bold",
    description: "Charcoal depth and ember accents — food photography leads.",
    palette: { bg: "#0E0F0D", surface: "#171915", text: "#F5F3EE", primary: "#E4572E", accent: "#F2A65A",
      header: { bg: "#0E0F0D", text: "#F5F3EE" }, footer: { bg: "#080908", text: "#E8E5DE" }, overlay: "rgba(8,9,8,0.62)" },
  },
  {
    key: "food-bistro", name: "Bistro", categoryKey: "food", treatment: "classic",
    description: "Cream paper, serif menus and a quiet, confident counter.",
    palette: { bg: "#FBF7EF", surface: "#FFFFFF", text: "#26221C", primary: "#8C2F1B", accent: "#C08A3E",
      header: { bg: "#FBF7EF", text: "#26221C" }, footer: { bg: "#241F19", text: "#F3EEE4" }, overlay: "rgba(36,31,25,0.52)" },
  },
  {
    key: "food-street", name: "Street Food", categoryKey: "food", treatment: "bold",
    description: "High-energy colour for takeaway, delivery and daily specials.",
    palette: { bg: "#FFF6E9", surface: "#FFFFFF", text: "#1D1A17", primary: "#E23D28", accent: "#FFC531",
      footer: { bg: "#1D1A17", text: "#FFF6E9" }, overlay: "rgba(29,26,23,0.55)" },
  },

  // ── Beauty ───────────────────────────────────────────────────────────────
  {
    key: "beauty-editorial", name: "Editorial", categoryKey: "beauty", treatment: "editorial",
    description: "Magazine spacing and full-bleed imagery — products as features.",
    palette: { bg: "#FFFFFF", surface: "#FFFFFF", text: "#1A1A1A", primary: "#111111", accent: "#B76E4B",
      footer: { bg: "#111111", text: "#FFFFFF" }, overlay: "rgba(17,17,17,0.42)" },
  },
  {
    key: "beauty-luxury", name: "Luxury", categoryKey: "beauty", treatment: "classic",
    description: "Deep emerald and gold for premium skincare and fragrance.",
    palette: { bg: "#0B1F1A", surface: "#102722", text: "#F2EDE3", primary: "#C6A15B", accent: "#E7D7AE",
      header: { bg: "#0B1F1A", text: "#F2EDE3" }, footer: { bg: "#07130F", text: "#E7DFCE" }, overlay: "rgba(7,19,15,0.58)" },
  },
  {
    key: "beauty-minimal", name: "Minimal", categoryKey: "beauty", treatment: "minimal",
    description: "Clean, clinical and product-first. Shades read clearly.",
    palette: { bg: "#FAFAF9", surface: "#FFFFFF", text: "#1C1C1E", primary: "#1C1C1E", accent: "#C9A0A0",
      footer: { bg: "#111112", text: "#F5F5F4" }, overlay: "rgba(17,17,18,0.4)" },
  },

  // ── Salon & Barber ───────────────────────────────────────────────────────
  {
    key: "salon-studio", name: "Studio", categoryKey: "salon", treatment: "editorial",
    description: "Soft blush and charcoal — stylish without shouting.",
    palette: { bg: "#FFF8F5", surface: "#FFFFFF", text: "#241E1C", primary: "#B4574F", accent: "#E8C8B6",
      footer: { bg: "#231C1A", text: "#F7EFEA" }, overlay: "rgba(35,28,26,0.5)" },
  },
  {
    key: "salon-classic", name: "Classic", categoryKey: "salon", treatment: "classic",
    description: "Barbershop ink and brass. Prices and durations front and centre.",
    palette: { bg: "#101C2B", surface: "#16263A", text: "#F1EEE7", primary: "#C89549", accent: "#7FA1C4",
      header: { bg: "#101C2B", text: "#F1EEE7" }, footer: { bg: "#0A121C", text: "#E4DFD4" }, overlay: "rgba(10,18,28,0.6)" },
  },
  {
    key: "salon-minimal", name: "Minimal", categoryKey: "salon", treatment: "minimal",
    description: "Quiet, airy and appointment-led.",
    palette: { bg: "#F7F8F7", surface: "#FFFFFF", text: "#1B1D1C", primary: "#1B1D1C", accent: "#9FB8A6",
      footer: { bg: "#141615", text: "#F2F4F2" }, overlay: "rgba(20,22,21,0.42)" },
  },

  // ── Fashion ──────────────────────────────────────────────────────────────
  {
    key: "fashion-editorial", name: "Editorial", categoryKey: "fashion", treatment: "editorial",
    description: "Lookbook energy: oversized type, generous whitespace.",
    palette: { bg: "#FFFFFF", surface: "#FFFFFF", text: "#101010", primary: "#101010", accent: "#8A8A8A",
      footer: { bg: "#101010", text: "#FFFFFF" }, overlay: "rgba(16,16,16,0.4)" },
  },
  {
    key: "fashion-boutique", name: "Boutique", categoryKey: "fashion", treatment: "warm",
    description: "Warm sand and rounded cards — a neighbourhood boutique feel.",
    palette: { bg: "#FDF9F3", surface: "#FFFFFF", text: "#2A231D", primary: "#9A6A4A", accent: "#D9BFA3",
      footer: { bg: "#2A231D", text: "#F7F1E8" }, overlay: "rgba(42,35,29,0.5)" },
  },
  {
    key: "fashion-contemporary", name: "Contemporary", categoryKey: "fashion", treatment: "minimal",
    description: "Monochrome confidence with sharp product grids.",
    palette: { bg: "#F4F4F4", surface: "#FFFFFF", text: "#111111", primary: "#111111", accent: "#6E6E6E",
      footer: { bg: "#111111", text: "#F4F4F4" }, overlay: "rgba(17,17,17,0.45)" },
  },

  // ── Retail ───────────────────────────────────────────────────────────────
  {
    key: "retail-market", name: "Market", categoryKey: "retail", treatment: "bold",
    description: "Fresh, bright and price-forward. Built for daily essentials.",
    palette: { bg: "#F3FBF5", surface: "#FFFFFF", text: "#16241B", primary: "#16794A", accent: "#F0B429",
      footer: { bg: "#12251A", text: "#EDF6EF" }, overlay: "rgba(18,37,26,0.55)" },
  },
  {
    key: "retail-fresh", name: "Fresh", categoryKey: "retail", treatment: "minimal",
    description: "Cool and orderly — easy scanning on a phone.",
    palette: { bg: "#F6FAFD", surface: "#FFFFFF", text: "#152028", primary: "#0F6BA8", accent: "#8FC6E8",
      footer: { bg: "#111C24", text: "#EAF2F8" }, overlay: "rgba(17,28,36,0.52)" },
  },
  {
    key: "retail-bold", name: "Bold", categoryKey: "retail", treatment: "bold",
    description: "High-contrast promotions and weekly offers.",
    palette: { bg: "#FFF9E8", surface: "#FFFFFF", text: "#1B1608", primary: "#C2410C", accent: "#F59E0B",
      footer: { bg: "#1B1608", text: "#FDF6E3" }, overlay: "rgba(27,22,8,0.58)" },
  },

  // ── Electronics ──────────────────────────────────────────────────────────
  {
    key: "tech-precision", name: "Precision", categoryKey: "electronics", treatment: "technical",
    description: "Cool steel, dense specs and comparison-friendly tables.",
    palette: { bg: "#F5F7F9", surface: "#FFFFFF", text: "#141A1F", primary: "#1C4E80", accent: "#00A3C4",
      footer: { bg: "#0F151A", text: "#E7EDF2" }, overlay: "rgba(15,21,26,0.58)" },
  },
  {
    key: "tech-nightshift", name: "Night Shift", categoryKey: "electronics", treatment: "technical",
    description: "Dark studio contrast that makes screens and devices pop.",
    palette: { bg: "#0C1015", surface: "#151B22", text: "#E9EFF5", primary: "#38BDF8", accent: "#A78BFA",
      header: { bg: "#0C1015", text: "#E9EFF5" }, footer: { bg: "#080B0F", text: "#D7E1EA" }, overlay: "rgba(8,11,15,0.6)" },
  },
  {
    key: "tech-clean", name: "Clean", categoryKey: "electronics", treatment: "minimal",
    description: "Light, quiet and brand-led.",
    palette: { bg: "#FAFBFC", surface: "#FFFFFF", text: "#16191D", primary: "#0B7285", accent: "#94D2BD",
      footer: { bg: "#121619", text: "#EDF1F4" }, overlay: "rgba(18,22,25,0.5)" },
  },

  // ── Automotive ───────────────────────────────────────────────────────────
  {
    key: "auto-workshop", name: "Workshop", categoryKey: "automotive", treatment: "technical",
    description: "Safety orange on graphite. Service, diagnostics, turnaround.",
    palette: { bg: "#121417", surface: "#1A1D21", text: "#F0F2F4", primary: "#F2610C", accent: "#9AA4AF",
      header: { bg: "#121417", text: "#F0F2F4" }, footer: { bg: "#0B0D0F", text: "#DFE4E9" }, overlay: "rgba(11,13,15,0.62)" },
  },
  {
    key: "auto-certified", name: "Certified", categoryKey: "automotive", treatment: "warm",
    description: "Navy trust with a service-bay warmth. Good for mixed parts + labour.",
    palette: { bg: "#F4F7FB", surface: "#FFFFFF", text: "#16202E", primary: "#123A6B", accent: "#E3A008",
      footer: { bg: "#101A28", text: "#E9EFF7" }, overlay: "rgba(16,26,40,0.58)" },
  },
  {
    key: "auto-performance", name: "Performance", categoryKey: "automotive", treatment: "bold",
    description: "Aggressive red and carbon. Built for tuning and detailing studios.",
    palette: { bg: "#0B0B0D", surface: "#141417", text: "#F4F4F5", primary: "#D7263D", accent: "#F4F4F5",
      header: { bg: "#0B0B0D", text: "#F4F4F5" }, footer: { bg: "#060607", text: "#DCDCDF" }, overlay: "rgba(6,6,7,0.6)" },
  },

  // ── Real estate ──────────────────────────────────────────────────────────
  {
    key: "estate-signature", name: "Signature", categoryKey: "realestate", treatment: "editorial",
    description: "Stone neutrals and large imagery. Listings are the hero.",
    palette: { bg: "#F7F5F1", surface: "#FFFFFF", text: "#221F1B", primary: "#2C4B3F", accent: "#C0A97E",
      footer: { bg: "#1E1C18", text: "#F1EDE5" }, overlay: "rgba(30,28,24,0.5)" },
  },
  {
    key: "estate-prestige", name: "Prestige", categoryKey: "realestate", treatment: "classic",
    description: "Emerald and cream for premium sales and lettings.",
    palette: { bg: "#0F1F19", surface: "#14271F", text: "#F1F4EF", primary: "#C8A96A", accent: "#8FB8A0",
      header: { bg: "#0F1F19", text: "#F1F4EF" }, footer: { bg: "#0A1410", text: "#E4EBE2" }, overlay: "rgba(10,20,16,0.58)" },
  },
  {
    key: "estate-clean", name: "Clean", categoryKey: "realestate", treatment: "minimal",
    description: "Light, fast and map-friendly. Filters do the work.",
    palette: { bg: "#FAFAFA", surface: "#FFFFFF", text: "#1A1A1A", primary: "#1F6F5C", accent: "#B9C7C1",
      footer: { bg: "#141414", text: "#F4F4F4" }, overlay: "rgba(20,20,20,0.45)" },
  },

  // ── Furniture & home ─────────────────────────────────────────────────────
  {
    key: "home-crafted", name: "Crafted", categoryKey: "furniture", treatment: "warm",
    description: "Timber tones with a workshop feel — made-to-order reads well.",
    palette: { bg: "#FBF6EF", surface: "#FFFFFF", text: "#2B2118", primary: "#8A5A2B", accent: "#D7B98C",
      footer: { bg: "#241B12", text: "#F5EEE4" }, overlay: "rgba(36,27,18,0.5)" },
  },
  {
    key: "home-calm", name: "Calm", categoryKey: "furniture", treatment: "minimal",
    description: "Restrained neutrals so materials and form stand out.",
    palette: { bg: "#F6F6F4", surface: "#FFFFFF", text: "#1D1E1C", primary: "#1D1E1C", accent: "#A8A79C",
      footer: { bg: "#161716", text: "#F1F1EE" }, overlay: "rgba(22,23,22,0.44)" },
  },
  {
    key: "home-grain", name: "Warm Grain", categoryKey: "furniture", treatment: "editorial",
    description: "Editorial layouts with a warm, tactile palette.",
    palette: { bg: "#FDF9F4", surface: "#FFFFFF", text: "#241D16", primary: "#6B4A2F", accent: "#C08552",
      footer: { bg: "#1F1811", text: "#F6EFE6" }, overlay: "rgba(31,24,17,0.52)" },
  },

  // ── Fitness & wellness ───────────────────────────────────────────────────
  {
    key: "fitness-energy", name: "Energy", categoryKey: "fitness", treatment: "bold",
    description: "High contrast and loud typography for classes and memberships.",
    palette: { bg: "#0C0E0C", surface: "#151816", text: "#F4F7F3", primary: "#C6F24E", accent: "#00D1B2",
      header: { bg: "#0C0E0C", text: "#F4F7F3" }, footer: { bg: "#070807", text: "#E1E8DC" },
      overlay: "rgba(7,8,7,0.6)" },
  },
  {
    key: "fitness-balance", name: "Balance", categoryKey: "fitness", treatment: "minimal",
    description: "Sage and sand — yoga, pilates and recovery studios.",
    palette: { bg: "#F5F8F3", surface: "#FFFFFF", text: "#1E241E", primary: "#4F7A5B", accent: "#D9C7A6",
      footer: { bg: "#1A201A", text: "#EEF3EA" }, overlay: "rgba(26,32,26,0.5)" },
  },
  {
    key: "fitness-performance", name: "Performance", categoryKey: "fitness", treatment: "technical",
    description: "Data-led and precise: programmes, timetables and progress.",
    palette: { bg: "#0E1216", surface: "#161C22", text: "#EDF2F7", primary: "#FF6B35", accent: "#4CC9F0",
      header: { bg: "#0E1216", text: "#EDF2F7" }, footer: { bg: "#080B0E", text: "#DAE3EC" }, overlay: "rgba(8,11,14,0.6)" },
  },

  // ── Creative & photography ───────────────────────────────────────────────
  {
    key: "creative-gallery", name: "Gallery", categoryKey: "creative", treatment: "editorial",
    description: "Near-silent chrome so the work is the only colour.",
    palette: { bg: "#FFFFFF", surface: "#FFFFFF", text: "#111111", primary: "#111111", accent: "#8C8C8C",
      footer: { bg: "#111111", text: "#FFFFFF" }, overlay: "rgba(17,17,17,0.38)" },
  },
  {
    key: "creative-studio", name: "Studio", categoryKey: "creative", treatment: "minimal",
    description: "Soft grey studio backdrop with package pricing clarity.",
    palette: { bg: "#F4F4F5", surface: "#FFFFFF", text: "#18181B", primary: "#18181B", accent: "#A1A1AA",
      footer: { bg: "#18181B", text: "#F4F4F5" }, overlay: "rgba(24,24,27,0.42)" },
  },
  {
    key: "creative-editorial", name: "Editorial", categoryKey: "creative", treatment: "editorial",
    description: "Serif storytelling for case studies and long-form portfolios.",
    palette: { bg: "#FDFCF9", surface: "#FFFFFF", text: "#1B1A17", primary: "#1B1A17", accent: "#B08968",
      footer: { bg: "#1B1A17", text: "#F7F5EF" }, overlay: "rgba(27,26,23,0.46)" },
  },

  // ── Professional services ────────────────────────────────────────────────
  {
    key: "pro-professional", name: "Professional", categoryKey: "professional", treatment: "technical",
    description: "Navy, measured spacing and credential-led hierarchy.",
    palette: { bg: "#F7F9FC", surface: "#FFFFFF", text: "#141C26", primary: "#16324F", accent: "#C9A227",
      footer: { bg: "#101A26", text: "#E8EFF7" }, overlay: "rgba(16,26,38,0.58)" },
  },
  {
    key: "pro-modern", name: "Modern", categoryKey: "professional", treatment: "minimal",
    description: "Light, fast and content-led for consultants and agencies.",
    palette: { bg: "#FFFFFF", surface: "#FFFFFF", text: "#16181D", primary: "#2563EB", accent: "#93C5FD",
      footer: { bg: "#111318", text: "#EDF0F5" }, overlay: "rgba(17,19,24,0.5)" },
  },
  {
    key: "pro-trust", name: "Trust", categoryKey: "professional", treatment: "warm",
    description: "Teal steadiness with approachable, human copy.",
    palette: { bg: "#F5FAF9", surface: "#FFFFFF", text: "#12211F", primary: "#0F766E", accent: "#99F6E4",
      footer: { bg: "#0E1B1A", text: "#E6F4F1" }, overlay: "rgba(14,27,26,0.55)" },
  },

  // ── Hospitality ──────────────────────────────────────────────────────────
  {
    key: "hospitality-lodge", name: "Lodge", categoryKey: "hospitality", treatment: "warm",
    description: "Earthy clay and linen. Rooms and stays take the lead.",
    palette: { bg: "#FBF6F0", surface: "#FFFFFF", text: "#2A201A", primary: "#8C4A2F", accent: "#D9B382",
      footer: { bg: "#241A14", text: "#F6EEE7" }, overlay: "rgba(36,26,20,0.52)" },
  },
  {
    key: "hospitality-resort", name: "Resort", categoryKey: "hospitality", treatment: "resort",
    description: "Aqua and white with big, calm imagery.",
    palette: { bg: "#F2FBFD", surface: "#FFFFFF", text: "#0F2733", primary: "#0E7490", accent: "#7DD3FC",
      footer: { bg: "#0B2028", text: "#E6F6FB" }, overlay: "rgba(11,32,40,0.5)" },
  },
  {
    key: "hospitality-urban", name: "Urban", categoryKey: "hospitality", treatment: "editorial",
    description: "Slate and brass for city hotels and event venues.",
    palette: { bg: "#14171B", surface: "#1B1F24", text: "#F1F3F5", primary: "#C8A45C", accent: "#8FA0AE",
      header: { bg: "#14171B", text: "#F1F3F5" }, footer: { bg: "#0C0E11", text: "#DDE2E7" }, overlay: "rgba(12,14,17,0.6)" },
  },

  // ── Education ────────────────────────────────────────────────────────────
  {
    key: "education-academy", name: "Academy", categoryKey: "education", treatment: "classic",
    description: "Indigo and parchment — credibility for courses and cohorts.",
    palette: { bg: "#F8F7FB", surface: "#FFFFFF", text: "#1B1B2F", primary: "#2F2A6B", accent: "#C9B458",
      footer: { bg: "#161630", text: "#EBEAF5" }, overlay: "rgba(22,22,48,0.56)" },
  },
  {
    key: "education-modern", name: "Modern", categoryKey: "education", treatment: "minimal",
    description: "Bright and structured. Syllabus and fees read at a glance.",
    palette: { bg: "#F7FAFF", surface: "#FFFFFF", text: "#141A24", primary: "#1D4ED8", accent: "#93C5FD",
      footer: { bg: "#101725", text: "#E9EFFA" }, overlay: "rgba(16,23,37,0.55)" },
  },
  {
    key: "education-trust", name: "Trust", categoryKey: "education", treatment: "warm",
    description: "Warm and reassuring for training providers and tutors.",
    palette: { bg: "#FBF8F2", surface: "#FFFFFF", text: "#221C12", primary: "#7A5A16", accent: "#E3C77B",
      footer: { bg: "#1E1810", text: "#F6F0E4" }, overlay: "rgba(30,24,16,0.55)" },
  },

  // ── Technical services ───────────────────────────────────────────────────
  {
    key: "technical-reliable", name: "Reliable", categoryKey: "technical", treatment: "technical",
    description: "Amber on slate: call-outs, coverage and quick quotes.",
    palette: { bg: "#F6F8FA", surface: "#FFFFFF", text: "#151A1F", primary: "#B45309", accent: "#38BDF8",
      footer: { bg: "#10161C", text: "#E8EEF4" }, overlay: "rgba(16,22,28,0.58)" },
  },
  {
    key: "technical-modern", name: "Modern", categoryKey: "technical", treatment: "minimal",
    description: "Crisp and local — clean tech, plumbing, electrical.",
    palette: { bg: "#FAFBFC", surface: "#FFFFFF", text: "#16181B", primary: "#0F766E", accent: "#5EEAD4",
      footer: { bg: "#121619", text: "#EDF1F4" }, overlay: "rgba(18,22,25,0.52)" },
  },
  {
    key: "technical-rapid", name: "Rapid", categoryKey: "technical", treatment: "bold",
    description: "Built for emergencies: big call buttons, fast paths to contact.",
    palette: { bg: "#FFF8EC", surface: "#FFFFFF", text: "#1B1509", primary: "#C2410C", accent: "#FBBF24",
      footer: { bg: "#1B1509", text: "#FDF3E3" }, overlay: "rgba(27,21,9,0.58)" },
  },

  // ── Other / core ─────────────────────────────────────────────────────────
  {
    key: "core-minimal", name: "Minimal", categoryKey: "other", treatment: "minimal",
    description: "Neutral and adaptable — a safe, premium starting point.",
    palette: { bg: "#FAFAFA", surface: "#FFFFFF", text: "#18181B", primary: "#18181B", accent: "#A1A1AA",
      footer: { bg: "#18181B", text: "#FAFAFA" }, overlay: "rgba(24,24,27,0.44)" },
  },
  {
    key: "core-bold", name: "Bold", categoryKey: "other", treatment: "bold",
    description: "Confident type and strong calls to action.",
    palette: { bg: "#FFFFFF", surface: "#FFFFFF", text: "#0B0B0C", primary: "#4338CA", accent: "#F59E0B",
      footer: { bg: "#0B0B0C", text: "#F4F4F5" }, overlay: "rgba(11,11,12,0.55)" },
  },
  {
    key: "core-warm", name: "Warm", categoryKey: "other", treatment: "warm",
    description: "Friendly, rounded and local.",
    palette: { bg: "#FDF8F1", surface: "#FFFFFF", text: "#241C14", primary: "#B45309", accent: "#FCD34D",
      footer: { bg: "#241C14", text: "#F7F1E8" }, overlay: "rgba(36,28,20,0.5)" },
  },
];

const THEME_MAP: Map<string, ExperienceTheme> = new Map(
  DEFINITIONS.map((definition) => {
    const treatment = TREATMENTS[definition.treatment] || TREATMENTS.minimal;
    const theme: ExperienceTheme = {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      categoryKey: definition.categoryKey,
      palette: buildPalette(definition.palette),
      treatment,
    };
    // buildPalette already guarantees the primary/primary-text pairing is readable.
    return [definition.key, theme];
  }),
);

export const DEFAULT_THEME_KEY = "core-minimal";

export const EXPERIENCE_THEMES: ExperienceTheme[] = Array.from(THEME_MAP.values());

export function resolveExperienceTheme(key: string | null | undefined): ExperienceTheme {
  if (key && THEME_MAP.has(key)) return THEME_MAP.get(key)!;
  return THEME_MAP.get(DEFAULT_THEME_KEY)!;
}

export function themesForCategory(categoryKey: CategoryKey | string | null | undefined): ExperienceTheme[] {
  const scoped = EXPERIENCE_THEMES.filter((theme) => theme.categoryKey === categoryKey);
  return scoped.length > 0 ? scoped : EXPERIENCE_THEMES.filter((theme) => theme.categoryKey === "other");
}

export function themeOptionsForCategory(categoryKey: CategoryKey | string | null | undefined) {
  return themesForCategory(categoryKey).map((theme) => ({
    key: theme.key,
    name: theme.name,
    description: theme.description,
  }));
}

export function isValidThemeKey(key: unknown): boolean {
  return typeof key === "string" && THEME_MAP.has(key);
}

export type ResolvedThemeVariables = {
  css: string;
  warnings: ContrastWarning[];
};

/**
 * Render the theme (plus optional brand overrides) as CSS custom properties.
 *
 * Brand colours are owner-supplied, so each one is validated and, when it would break
 * legibility, adjusted — the adjustment is reported back as a warning (§22, §48).
 */
export function themeCss(theme: ExperienceTheme, brand?: ExperienceBrand | null): ResolvedThemeVariables {
  const warnings: ContrastWarning[] = [];
  const palette = { ...theme.palette };

  const applyBrand = (field: "primaryColor" | "secondaryColor" | "accentColor", target: "primary" | "accent" | "surface") => {
    const requested = brand?.[field];
    if (!requested || !isHexColor(requested)) return;
    const applied = requested.trim().toUpperCase();
    if (target === "primary") {
      const solid = accessibleSolidPair(applied);
      palette.primary = solid.background;
      palette.primaryText = solid.text;
      palette.accent = solid.background;
    } else {
      palette[target] = applied;
    }
    const warning = contrastWarning(field, applied, target === "primary" ? palette.primary : applied);
    if (warning) warnings.push(warning);
  };

  // The primary colour is the one owners change most; secondary tints surfaces.
  applyBrand("primaryColor", "primary");
  if (brand?.accentColor && isHexColor(brand.accentColor)) {
    palette.accent = brand.accentColor.trim().toUpperCase();
  }

  const t = theme.treatment;
  const vars: Record<string, string> = {
    "--eb-bg": palette.bg,
    "--eb-surface": palette.surface,
    "--eb-surface-muted": palette.surfaceMuted,
    "--eb-text": ensureAccessiblePair(palette.text, palette.bg),
    "--eb-heading": ensureAccessiblePair(palette.heading, palette.bg),
    "--eb-muted": ensureAccessiblePair(palette.muted, palette.surface),
    "--eb-primary": palette.primary,
    "--eb-primary-text": palette.primaryText,
    "--eb-accent": palette.accent,
    "--eb-border": palette.border,
    "--eb-header-bg": palette.headerBg,
    "--eb-header-text": palette.headerText,
    "--eb-footer-bg": palette.footerBg,
    "--eb-footer-text": palette.footerText,
    "--eb-overlay": palette.overlay,
    "--eb-ring": palette.primary,
    "--eb-font-display": t.display,
    "--eb-font-body": t.body,
    "--eb-font-eyebrow": t.eyebrowFont || t.body,
    "--eb-heading-weight": String(t.headingWeight),
    "--eb-heading-tracking": t.headingTracking,
    "--eb-body-size": t.bodySize,
    "--eb-radius": t.radius,
    "--eb-radius-button": t.buttonRadius,
    "--eb-radius-card": t.cardRadius,
    "--eb-shadow": t.shadow,
    "--eb-media-ratio": t.mediaRatio,
    "--eb-hero-min-height": t.heroMinHeight,
    "--eb-section-spacing": t.sectionSpacing,
  };

  const declarations = Object.entries(vars).map(([name, value]) => `${name}: ${value};`).join(" ");
  const flags = [
    `--eb-button-style: ${t.buttonStyle};`,
    `--eb-button-weight: ${t.buttonWeight};`,
    `--eb-button-uppercase: ${t.buttonUppercase ? "1" : "0"};`,
    `--eb-card-style: ${t.cardStyle};`,
    `--eb-hero-style: ${t.heroStyle};`,
    `--eb-nav-style: ${t.navStyle};`,
    `--eb-nav-sticky: ${t.navSticky ? "1" : "0"};`,
    `--eb-motion: ${t.motion};`,
    `--eb-eyebrow-uppercase: ${t.uppercaseEyebrow ? "1" : "0"};`,
  ].join(" ");

  return { css: `.eb-scope{${declarations} ${flags}}`, warnings };
}

/**
 * Discrete treatment choices are emitted as classes rather than CSS variables, so the
 * stylesheet can key off them without runtime style logic.
 */
export function themeRootClassName(theme: ExperienceTheme, extra = ""): string {
  const t = theme.treatment;
  return [
    "eb-scope",
    `eb-btn--${t.buttonStyle === "pill" ? "pill" : t.buttonStyle === "solid" ? "solid" : t.buttonStyle}`,
    t.buttonUppercase ? "eb-btn--upper" : "",
    `eb-card--${t.cardStyle}`,
    `eb-nav--${t.navStyle}`,
    t.navSticky ? "eb-nav--sticky" : "",
    t.uppercaseEyebrow ? "eb-eyebrow--scope" : "",
    t.motion === "none" ? "" : "",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Inline `style` object for the root element (server components). */
export function themeStyleVars(theme: ExperienceTheme, brand?: ExperienceBrand | null): Record<string, string> {
  const { css } = themeCss(theme, brand);
  const pairs = css.replace(".eb-scope{", "").replace(/}$/, "").split(";").map((part) => part.trim()).filter(Boolean);
  const style: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf(":");
    if (index > 0) style[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return style;
}
