export type ProductThemeKey = "lime-spark" | "emerald-ink";
type CssVariable = `--${string}`;

export type ProductTheme = {
  key: ProductThemeKey;
  name: string;
  description: string;
  tokens: Record<CssVariable, string>;
};

const sharedStatusTokens = {
  "--color-success": "#047857",
  "--color-success-surface": "#ECFDF5",
  "--color-warning": "#854D0E",
  "--color-warning-surface": "#FEF3C7",
  "--color-error": "#B91C1C",
  "--color-error-surface": "#FEF2F2",
};

/** JATA product-interface themes. These are separate from public business-page themes. */
export const PRODUCT_THEMES: Record<ProductThemeKey, ProductTheme> = {
  "lime-spark": {
    key: "lime-spark",
    name: "Lime Spark / Graphite",
    description: "Energetic, modern, and action-oriented with a confident graphite foundation.",
    tokens: {
      ...sharedStatusTokens,
      "--color-brand-primary": "#B6FF2E",
      "--color-brand-structure": "#23262F",
      "--color-structure": "#23262F",
      "--color-on-dark": "#F4F6F0",
      "--color-background": "#23262F",
      "--color-surface": "#2D313B",
      "--color-surface-muted": "#383D48",
      "--color-text": "#F4F6F0",
      "--color-text-muted": "#C2C8D1",
      "--color-primary": "#B6FF2E",
      "--color-primary-hover": "#A3E62A",
      "--color-primary-active": "#8FCB1E",
      "--color-primary-contrast": "#23262F",
      "--color-secondary": "#454B58",
      "--color-border": "#929AA6",
      "--color-focus": "#B6FF2E",
      "--color-placeholder": "#AEB5C0",
      "--color-disabled": "#ABB2BD",
    },
  },
  "emerald-ink": {
    key: "emerald-ink",
    name: "Emerald Ink / Champagne",
    description: "Sophisticated, warm, and trustworthy with calm premium accents.",
    tokens: {
      ...sharedStatusTokens,
      "--color-brand-primary": "#064E3B",
      "--color-brand-secondary": "#F8E7C9",
      "--color-structure": "#064E3B",
      "--color-on-dark": "#FFFFFF",
      "--color-background": "#FFF9F0",
      "--color-surface": "#FFFFFF",
      "--color-surface-muted": "#F8E7C9",
      "--color-text": "#18352B",
      "--color-text-muted": "#496359",
      "--color-primary": "#064E3B",
      "--color-primary-hover": "#053F30",
      "--color-primary-active": "#033326",
      "--color-primary-contrast": "#FFFFFF",
      "--color-secondary": "#F8E7C9",
      "--color-border": "#84704F",
      "--color-focus": "#064E3B",
      "--color-placeholder": "#64756D",
      "--color-disabled": "#64756D",
    },
  },
};

export const DEFAULT_PRODUCT_THEME: ProductThemeKey = "lime-spark";
export const PRODUCT_THEME_STORAGE_KEY = "jata-product-theme";

export function isProductThemeKey(value: unknown): value is ProductThemeKey {
  return value === "lime-spark" || value === "emerald-ink";
}

export function readProductThemePreference(
  storage: Pick<Storage, "getItem"> | null | undefined,
): ProductThemeKey | null {
  try {
    const value = storage?.getItem(PRODUCT_THEME_STORAGE_KEY);
    return isProductThemeKey(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveProductThemePreference(
  theme: ProductThemeKey,
  storage: Pick<Storage, "setItem"> | null | undefined,
): boolean {
  try {
    storage?.setItem(PRODUCT_THEME_STORAGE_KEY, theme);
    return Boolean(storage);
  } catch {
    return false;
  }
}
