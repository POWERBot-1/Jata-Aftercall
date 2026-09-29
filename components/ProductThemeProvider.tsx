"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  DEFAULT_PRODUCT_THEME,
  PRODUCT_THEMES,
  isProductThemeKey,
  readProductThemePreference,
  saveProductThemePreference,
  type ProductThemeKey,
} from "@/lib/productThemes";

export function ProductThemeSelector({
  selected,
  onSelect,
}: {
  selected: ProductThemeKey;
  onSelect: (theme: ProductThemeKey) => void;
}) {
  return (
    <details className="product-theme-picker">
      <summary aria-label="Choose JATA appearance">
        <span aria-hidden="true" className="product-theme-picker-icon">◐</span>
        <span>Appearance</span>
        <span aria-hidden="true" className="product-theme-picker-current">{PRODUCT_THEMES[selected].name}</span>
      </summary>
      <fieldset className="product-theme-options">
        <legend>Choose your JATA theme</legend>
        {(Object.values(PRODUCT_THEMES)).map((theme) => (
          <label className="product-theme-option" key={theme.key} data-selected={selected === theme.key}>
            <input
              type="radio"
              name="jata-product-theme"
              value={theme.key}
              aria-label={`${theme.name} — ${theme.description}`}
              checked={selected === theme.key}
              onChange={() => onSelect(theme.key)}
            />
            <span className="product-theme-swatches" aria-hidden="true">
              <span style={{ backgroundColor: theme.tokens["--color-brand-primary"] }} />
              <span style={{ backgroundColor: theme.tokens["--color-brand-structure"] || theme.tokens["--color-brand-secondary"] }} />
            </span>
            <span className="product-theme-option-copy">
              <span className="product-theme-option-name">{theme.name}</span>
              <span className="product-theme-option-description">{theme.description}</span>
              <span className="product-theme-selection">{selected === theme.key ? "Selected" : "Select this theme"}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export default function ProductThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicBusinessPage = Boolean(pathname?.startsWith("/b/"));
  const [theme, setTheme] = useState<ProductThemeKey>(DEFAULT_PRODUCT_THEME);

  useEffect(() => {
    const preference = readProductThemePreference(getBrowserStorage());
    if (preference) setTheme(preference);
  }, []);

  // Keep <html data-jata-theme> (set before first paint by the boot script) in sync with state.
  useEffect(() => {
    try { document.documentElement.setAttribute("data-jata-theme", theme); } catch { /* non-browser */ }
  }, [theme]);

  function chooseTheme(nextTheme: ProductThemeKey) {
    if (!isProductThemeKey(nextTheme)) return;
    setTheme(nextTheme);
    saveProductThemePreference(nextTheme, getBrowserStorage());
  }

  if (isPublicBusinessPage) {
    // Customer-facing business pages retain their independent clean/dark/warm themes.
    return <div className="business-route-root">{children}</div>;
  }

  // Token values come from productThemeCss() in the root layout, keyed on data-product-theme.
  return (
    <div className="product-theme-root" data-product-theme={theme}>
      <div className="product-theme-toolbar">
        <ProductThemeSelector selected={theme} onSelect={chooseTheme} />
      </div>
      {children}
    </div>
  );
}
