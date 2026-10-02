"use client";

/**
 * Customer cart (§24)
 *
 * The cart lives on the customer's device, which keeps browsing instant even on a slow
 * connection. It only ever stores ids and quantities: every amount shown is re-derived from
 * the catalogue on the server at checkout, so a tampered cart cannot change a price (§26).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatKES } from "@/lib/format";
import { trackEvent } from "./Track";

export type CartLine = {
  key: string;
  productId: string;
  variantId?: string;
  variantLabel?: string;
  name: string;
  unitPriceKES: number;
  quantity: number;
  addOns: Array<{ id: string; name: string; priceKES: number }>;
  imageUrl?: string | null;
  notes?: string;
};

type CartContextValue = {
  lines: CartLine[];
  count: number;
  subtotalKES: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (line: Omit<CartLine, "key"> & { key?: string }) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  cartNoun: string;
  checkoutHref: string;
  canCheckout: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside a CartProvider");
  return context;
}

function storageKey(slug: string): string {
  return `jata_cart_${slug}`;
}

export function CartProvider({
  slug,
  businessId,
  cartNoun,
  checkoutHref,
  canCheckout,
  children,
}: {
  slug: string;
  businessId: string;
  cartNoun: string;
  checkoutHref: string;
  canCheckout: boolean;
  children: ReactNode;
}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(slug));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setLines(parsed.slice(0, 40));
      }
    } catch {
      /* an unreadable cart simply starts empty */
    }
    setHydrated(true);
  }, [slug]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (lines.length === 0) window.localStorage.removeItem(storageKey(slug));
      else window.localStorage.setItem(storageKey(slug), JSON.stringify(lines));
    } catch {
      /* storage full or blocked — the cart still works for this session */
    }
  }, [lines, slug, hydrated]);

  const add = useCallback(
    (line: Omit<CartLine, "key"> & { key?: string }) => {
      const key = line.key || [line.productId, line.variantId || "", (line.addOns || []).map((a) => a.id).join("+")].join("::");
      setLines((current) => {
        const existing = current.find((entry) => entry.key === key);
        if (existing) {
          return current.map((entry) => (entry.key === key ? { ...entry, quantity: Math.min(99, entry.quantity + line.quantity) } : entry));
        }
        return [...current, { ...line, key }];
      });
      trackEvent(businessId, "ADD_TO_CART", line.productId);
      setOpen(true);
    },
    [businessId],
  );

  const remove = useCallback((key: string) => {
    setLines((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) =>
      current
        .map((entry) => (entry.key === key ? { ...entry, quantity: Math.max(1, Math.min(99, quantity)) } : entry))
        .filter((entry) => entry.quantity > 0),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    const subtotalKES = lines.reduce((sum, line) => {
      const addOns = (line.addOns || []).reduce((total, addOn) => total + addOn.priceKES, 0);
      return sum + (line.unitPriceKES + addOns) * line.quantity;
    }, 0);
    return { lines, count, subtotalKES, open, setOpen, add, remove, setQuantity, clear, cartNoun, checkoutHref, canCheckout };
  }, [lines, open, add, remove, setQuantity, clear, cartNoun, checkoutHref, canCheckout]);

  return (
    <CartContext.Provider value={value}>
      {children}
      {open ? (
        <CartDrawer
          onClose={() => setOpen(false)}
          lines={lines}
          subtotalKES={value.subtotalKES}
          cartNoun={cartNoun}
          setQuantity={setQuantity}
          remove={remove}
          onCheckout={() => {
            setOpen(false);
            router.push(checkoutHref);
          }}
          canCheckout={canCheckout}
        />
      ) : null}
    </CartContext.Provider>
  );
}

function CartDrawer({
  lines,
  subtotalKES,
  cartNoun,
  setQuantity,
  remove,
  onClose,
  onCheckout,
  canCheckout,
}: {
  lines: CartLine[];
  subtotalKES: number;
  cartNoun: string;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  onClose: () => void;
  onCheckout: () => void;
  canCheckout: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button className="eb-drawer-scrim" aria-label="Close cart" onClick={onClose} />
      <aside className="eb-drawer" role="dialog" aria-modal="true" aria-label={cartNoun}>
        <header className="eb-drawer__head">
          <h2 className="eb-h3">{cartNoun}</h2>
          <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={onClose} aria-label="Close cart">
            Close
          </button>
        </header>
        <div className="eb-drawer__body">
          {lines.length === 0 ? (
            <div className="eb-empty">
              <h3 className="eb-h3">Nothing here yet</h3>
              <p>Add something you like and it will appear here.</p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {lines.map((line) => (
                <li key={line.key} className="eb-row">
                  {line.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <div className="eb-row__media">
                      <img src={line.imageUrl} alt="" loading="lazy" decoding="async" />
                    </div>
                  ) : null}
                  <div className="eb-row__main">
                    <p style={{ margin: 0, fontWeight: 600 }}>{line.name}</p>
                    {line.variantLabel ? <p className="eb-card__meta" style={{ margin: 0 }}>{line.variantLabel}</p> : null}
                    <p className="eb-card__meta" style={{ margin: 0 }}>{formatKES(line.unitPriceKES)} each</p>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem" }}>
                      <button
                        type="button"
                        className="eb-btn eb-btn--outline eb-btn--sm"
                        onClick={() => setQuantity(line.key, line.quantity - 1)}
                        aria-label={`Decrease quantity of ${line.name}`}
                      >
                        −
                      </button>
                      <span aria-live="polite" style={{ minWidth: "1.5rem", textAlign: "center" }}>{line.quantity}</span>
                      <button
                        type="button"
                        className="eb-btn eb-btn--outline eb-btn--sm"
                        onClick={() => setQuantity(line.key, line.quantity + 1)}
                        aria-label={`Increase quantity of ${line.name}`}
                      >
                        +
                      </button>
                      <button type="button" className="eb-btn eb-btn--ghost eb-btn--sm" onClick={() => remove(line.key)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="eb-row__side">
                    <span className="eb-price">{formatKES((line.unitPriceKES + (line.addOns || []).reduce((t, a) => t + a.priceKES, 0)) * line.quantity)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length > 0 ? (
          <footer className="eb-drawer__foot">
            <div className="eb-totals">
              <div className="eb-totals__row">
                <span>Subtotal</span>
                <span>{formatKES(subtotalKES)}</span>
              </div>
              <p className="eb-card__meta" style={{ margin: 0 }}>Delivery and any discount are worked out at checkout.</p>
            </div>
            <button type="button" className="eb-btn eb-btn--block" onClick={onCheckout} disabled={!canCheckout}>
              Checkout
            </button>
          </footer>
        ) : null}
      </aside>
    </>
  );
}

/** Add-to-cart control used on cards and detail pages (§24). */
export function AddToCartButton({
  productId,
  name,
  unitPriceKES,
  variantId,
  variantLabel,
  imageUrl,
  addOns = [],
  label,
  quantity = 1,
  disabled,
}: {
  productId: string;
  name: string;
  unitPriceKES: number | null;
  variantId?: string;
  variantLabel?: string;
  imageUrl?: string | null;
  addOns?: Array<{ id: string; name: string; priceKES: number }>;
  label: string;
  quantity?: number;
  disabled?: boolean;
}) {
  const cart = useCart();
  if (unitPriceKES === null) return null;
  return (
    <button
      type="button"
      className="eb-btn eb-btn--sm"
      disabled={disabled}
      onClick={() =>
        cart.add({
          productId,
          variantId,
          variantLabel,
          name,
          unitPriceKES,
          quantity,
          addOns,
          imageUrl: imageUrl || null,
        })
      }
    >
      {label}
    </button>
  );
}

/** Floating cart indicator for the sticky action bar (§43). */
export function CartIndicator() {
  const cart = useCart();
  if (cart.count === 0) return null;
  return (
    <button type="button" className="eb-btn eb-btn--soft" onClick={() => cart.setOpen(true)} aria-label={`Open ${cart.cartNoun.toLowerCase()}, ${cart.count} items`}>
      {cart.cartNoun} · {cart.count}
    </button>
  );
}
