"use client";

/**
 * Catalogue editor (§17, §18)
 *
 * One catalogue model, sixteen categories. The profile decides which fields appear: a
 * restaurant gets portions and add-ons, a salon gets duration and deposits, a property
 * listing gets location and price on request. Pricing and stock are always the owner's call —
 * the AI assistant can suggest wording, never numbers.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductFieldFlags, ServiceFieldFlags } from "@/lib/experience/types";
import { formatKES } from "@/lib/format";
import { MediaPicker } from "./MediaPicker";
import { AssistBox } from "./AssistBox";

type Variant = { label: string; priceKES: number | null };
import { displayPriceKES, formatBusinessDateTime, toBusinessLocalInput } from "@/lib/sale-pricing";

type AddOn = { id?: string; name: string; priceKES: number };

function parseSaleDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** One line for the list: the sale price and when it ends, or that a scheduled/expired sale is not running. */
function saleSummary(product: ProductRow): string {
  const shown = displayPriceKES({
    basePriceKES: product.basePriceKES,
    salePriceKES: product.salePriceKES,
    salePriceStartsAt: parseSaleDate(product.salePriceStartsAt),
    salePriceEndsAt: parseSaleDate(product.salePriceEndsAt),
  });
  if (shown.saleState === "ACTIVE" && shown.priceKES !== null) {
    return ` · Sale ${formatKES(shown.priceKES)} until ${formatBusinessDateTime(parseSaleDate(product.salePriceEndsAt))}`;
  }
  if (shown.saleState === "SCHEDULED") return ` · Sale ${formatKES(product.salePriceKES ?? 0)} from ${formatBusinessDateTime(parseSaleDate(product.salePriceStartsAt))} (not running yet)`;
  if (shown.saleState === "EXPIRED") return " · Sale ended (original price charged)";
  if (shown.saleState === "NO_WINDOW" || shown.saleState === "INVALID_WINDOW") return " · Sale not running: set a start and end time";
  return "";
}

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  basePriceKES: number | null;
  salePriceKES: number | null;
  /** Sale window. Stored in UTC; shown and entered in Africa/Nairobi time. A sale runs only inside it. */
  salePriceStartsAt: string | null;
  salePriceEndsAt: string | null;
  imageUrl: string | null;
  images: string | null;
  brand: string | null;
  portionSize: string | null;
  ingredients: string | null;
  prepMinutes: number | null;
  tags: string | null;
  addOns: string | null;
  variantOptions: string | null;
  stockStatus: string;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  variants?: Array<{ id: string; label: string; priceKES: number | null }>;
};

type ServiceRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  staffName: string | null;
  priceLabel: string | null;
  priceFrom: number | null;
  priceToKES: number | null;
  depositKES: number | null;
  durationMinutes: number | null;
  imageUrl: string | null;
  pricingType: string;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
};

const STOCK_OPTIONS = [
  { value: "IN_STOCK", label: "In stock" },
  { value: "LOW_STOCK", label: "Low stock" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
  { value: "PRE_ORDER", label: "Pre-order" },
  { value: "AVAILABLE_ON_REQUEST", label: "Available on request" },
];

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function ItemsEditor({
  businessId,
  categoryKey,
  itemNoun,
  itemNounPlural,
  productFields,
  serviceFields,
  products: initialProducts,
  services: initialServices,
}: {
  businessId: string;
  categoryKey: string;
  itemNoun: string;
  itemNounPlural: string;
  productFields: ProductFieldFlags;
  serviceFields: ServiceFieldFlags;
  products: ProductRow[];
  services: ServiceRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"products" | "services">("products");
  const [products, setProducts] = useState<ProductRow[]>(initialProducts);
  const [services, setServices] = useState<ServiceRow[]>(initialServices);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [editingService, setEditingService] = useState<ServiceRow | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(url: string, method: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: data.error || "We couldn’t save that. Please try again." });
        return null;
      }
      setMessage({ tone: "ok", text: "Saved ✓" });
      router.refresh();
      return data;
    } catch {
      setMessage({ tone: "error", text: "We couldn’t reach the server. Please try again." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct(product: ProductRow) {
    const isNew = product.id.startsWith("new-");
    const data = await send(
      "/api/products",
      isNew ? "POST" : "PATCH",
      isNew ? { businessId, ...product, id: undefined } : { businessId, ...product },
    );
    if (data?.product) {
      const saved = data.product as ProductRow;
      setProducts((current) => (isNew ? [...current.filter((entry) => entry.id !== product.id), saved] : current.map((entry) => (entry.id === saved.id ? saved : entry))));
      setEditingProduct(saved);
    }
  }

  async function saveService(service: ServiceRow) {
    const isNew = service.id.startsWith("new-");
    const data = await send("/api/services", isNew ? "POST" : "PATCH", isNew ? { businessId, ...service, id: undefined } : { businessId, ...service });
    if (data?.service) {
      const saved = data.service as ServiceRow;
      setServices((current) => (isNew ? [...current.filter((entry) => entry.id !== service.id), saved] : current.map((entry) => (entry.id === saved.id ? saved : entry))));
      setEditingService(saved);
    }
  }

  async function removeProduct(id: string) {
    const response = await fetch(`/api/products?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setProducts((current) => current.filter((entry) => entry.id !== id));
      setEditingProduct(null);
      router.refresh();
    } else {
      const data = await response.json().catch(() => ({}));
      setMessage({ tone: "error", text: data.error || "We couldn’t remove that." });
    }
  }

  async function removeService(id: string) {
    const response = await fetch(`/api/services?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setServices((current) => current.filter((entry) => entry.id !== id));
      setEditingService(null);
      router.refresh();
    } else {
      const data = await response.json().catch(() => ({}));
      setMessage({ tone: "error", text: data.error || "We couldn’t remove that." });
    }
  }

  function blankProduct(): ProductRow {
    return {
      id: `new-${Date.now()}`, name: "", description: null, category: null, basePriceKES: null, salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null,
      imageUrl: null, images: null, brand: null, portionSize: null, ingredients: null, prepMinutes: null,
      tags: null, addOns: null, variantOptions: null, stockStatus: "IN_STOCK", isFeatured: false, isActive: true, sortOrder: 0,
    };
  }

  function blankService(): ServiceRow {
    return {
      id: `new-${Date.now()}`, title: "", description: null, category: null, staffName: null, priceLabel: null,
      priceFrom: null, priceToKES: null, depositKES: null, durationMinutes: null, imageUrl: null,
      pricingType: "FIXED", isFeatured: false, isActive: true, sortOrder: 0,
    };
  }

  return (
    <div className="space-y-4">
      <div className="jata-toolbar">
        <div className="flex gap-2">
          <button
            type="button"
            className={`jata-btn ${tab === "products" ? "jata-btn-primary" : "jata-btn-secondary"}`}
            aria-pressed={tab === "products"}
            onClick={() => setTab("products")}
          >
            {itemNounPlural}
          </button>
          <button
            type="button"
            className={`jata-btn ${tab === "services" ? "jata-btn-primary" : "jata-btn-secondary"}`}
            aria-pressed={tab === "services"}
            onClick={() => setTab("services")}
          >
            Services
          </button>
        </div>
        <button
          type="button"
          className="jata-btn jata-btn-primary"
          onClick={() => (tab === "products" ? setEditingProduct(blankProduct()) : setEditingService(blankService()))}
        >
          {tab === "products" ? `Add ${itemNoun.toLowerCase()}` : "Add service"}
        </button>
      </div>

      {message ? (
        <p className={`text-sm ${message.tone === "error" ? "jata-error" : "text-emerald-700"}`} role="status">
          {message.text}
        </p>
      ) : null}

      {tab === "products" ? (
        products.length === 0 ? (
          <div className="jata-empty">
            <p className="text-sm font-semibold">No {itemNounPlural.toLowerCase()} yet</p>
            <p className="mt-1 text-sm text-zinc-600">Add your first one — customers cannot order what they cannot see.</p>
            <button type="button" className="jata-btn jata-btn-primary mt-4" onClick={() => setEditingProduct(blankProduct())}>
              Add {itemNoun.toLowerCase()}
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {products.map((product) => (
              <li key={product.id} className={`jata-section-row ${product.isActive ? "" : "opacity-60"}`}>
                {product.imageUrl ? (
                  <span
                    aria-hidden="true"
                    className="h-12 w-12 shrink-0 rounded-lg border bg-zinc-50"
                    style={{ backgroundImage: `url(${product.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {product.name}
                    {product.isFeatured ? <span className="ml-2 text-xs font-normal text-amber-700">Featured</span> : null}
                    {!product.isActive ? <span className="ml-2 text-xs font-normal text-zinc-500">Hidden</span> : null}
                  </p>
                  <p className="truncate text-xs text-zinc-600">
                    {product.basePriceKES !== null ? `Original ${formatKES(product.basePriceKES)}` : "Price on request"}
                    {saleSummary(product)}
                    {product.stockStatus !== "IN_STOCK" ? ` · ${STOCK_OPTIONS.find((option) => option.value === product.stockStatus)?.label || product.stockStatus}` : ""}
                  </p>
                </div>
                <button className="jata-icon-btn" aria-label={`Edit ${product.name}`} onClick={() => setEditingProduct(product)}>✎</button>
              </li>
            ))}
          </ul>
        )
      ) : services.length === 0 ? (
        <div className="jata-empty">
          <p className="text-sm font-semibold">No services yet</p>
          <p className="mt-1 text-sm text-zinc-600">Add what you offer, how long it takes and what it costs.</p>
          <button type="button" className="jata-btn jata-btn-primary mt-4" onClick={() => setEditingService(blankService())}>
            Add service
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {services.map((service) => (
            <li key={service.id} className={`jata-section-row ${service.isActive ? "" : "opacity-60"}`}>
              {service.imageUrl ? (
                <span
                  aria-hidden="true"
                  className="h-12 w-12 shrink-0 rounded-lg border bg-zinc-50"
                  style={{ backgroundImage: `url(${service.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{service.title}</p>
                <p className="truncate text-xs text-zinc-600">
                  {service.pricingType === "QUOTE"
                    ? service.priceLabel || "Quote on request"
                    : service.priceFrom !== null
                      ? `From ${formatKES(service.priceFrom)}`
                      : "Price on request"}
                  {service.durationMinutes ? ` · ${service.durationMinutes} min` : ""}
                  {!service.isActive ? " · Hidden" : ""}
                </p>
              </div>
              <button className="jata-icon-btn" aria-label={`Edit ${service.title}`} onClick={() => setEditingService(service)}>✎</button>
            </li>
          ))}
        </ul>
      )}

      {editingProduct ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Edit ${editingProduct.name || itemNoun.toLowerCase()}`}>
          <button className="jata-sheet-scrim" aria-label="Close editor" onClick={() => setEditingProduct(null)} />
          <div className="jata-sheet">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold">{editingProduct.id.startsWith("new-") ? `New ${itemNoun.toLowerCase()}` : editingProduct.name}</h2>
              <button className="jata-icon-btn" aria-label="Close editor" onClick={() => setEditingProduct(null)}>✕</button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="jata-field">
                <label className="jata-label" htmlFor="p-name">Name</label>
                <input id="p-name" className="jata-input" value={editingProduct.name} onChange={(event) => setEditingProduct({ ...editingProduct, name: event.target.value })} />
              </div>
              <div className="jata-field">
                <label className="jata-label" htmlFor="p-description">Description</label>
                <textarea id="p-description" className="jata-input min-h-24" value={editingProduct.description || ""} onChange={(event) => setEditingProduct({ ...editingProduct, description: event.target.value })} />
                <AssistBox
                  businessId={businessId}
                  kind="PRODUCT_DESCRIPTION"
                  categoryKey={categoryKey}
                  name={editingProduct.name}
                  onAccept={(text) => setEditingProduct({ ...editingProduct, description: text })}
                />
              </div>

              {productFields.images ? (
                <MediaPicker businessId={businessId} label="Photo" value={editingProduct.imageUrl || ""} onChange={(url) => setEditingProduct({ ...editingProduct, imageUrl: url || null })} />
              ) : null}

              {productFields.price ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="jata-field">
                    <label className="jata-label" htmlFor="p-price">Original price (KES)</label>
                    <input id="p-price" type="number" min={0} className="jata-input" value={editingProduct.basePriceKES ?? ""} onChange={(event) => setEditingProduct({ ...editingProduct, basePriceKES: event.target.value === "" ? null : Number(event.target.value) })} />
                  </div>
                  {productFields.salePrice ? (
                    <div className="jata-field">
                      <label className="jata-label" htmlFor="p-sale">Sale price (KES, optional)</label>
                      <input id="p-sale" type="number" min={0} className="jata-input" value={editingProduct.salePriceKES ?? ""} onChange={(event) => setEditingProduct({ ...editingProduct, salePriceKES: event.target.value === "" ? null : Number(event.target.value) })} />
                      <p className="text-xs text-zinc-500">The sale applies only between the two times below (Africa/Nairobi). Outside them the original price is charged.</p>
                      <label className="jata-label" htmlFor="p-sale-start">Sale starts (Africa/Nairobi)</label>
                      <input id="p-sale-start" type="datetime-local" className="jata-input" value={toBusinessLocalInput(parseSaleDate(editingProduct.salePriceStartsAt))} onChange={(event) => setEditingProduct({ ...editingProduct, salePriceStartsAt: event.target.value || null })} />
                      <label className="jata-label" htmlFor="p-sale-end">Sale ends (Africa/Nairobi)</label>
                      <input id="p-sale-end" type="datetime-local" className="jata-input" value={toBusinessLocalInput(parseSaleDate(editingProduct.salePriceEndsAt))} onChange={(event) => setEditingProduct({ ...editingProduct, salePriceEndsAt: event.target.value || null })} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {productFields.category ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="p-category">Category</label>
                  <input id="p-category" className="jata-input" value={editingProduct.category || ""} placeholder="e.g. Main dishes" onChange={(event) => setEditingProduct({ ...editingProduct, category: event.target.value })} />
                </div>
              ) : null}

              {productFields.stock ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="p-stock">Availability</label>
                  <select id="p-stock" className="jata-input" value={editingProduct.stockStatus} onChange={(event) => setEditingProduct({ ...editingProduct, stockStatus: event.target.value })}>
                    {STOCK_OPTIONS.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
                  </select>
                </div>
              ) : null}

              {productFields.portion ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="p-portion">Portion size</label>
                  <input id="p-portion" className="jata-input" value={editingProduct.portionSize || ""} onChange={(event) => setEditingProduct({ ...editingProduct, portionSize: event.target.value })} />
                </div>
              ) : null}
              {productFields.ingredients ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="p-ingredients">What’s in it</label>
                  <input id="p-ingredients" className="jata-input" value={editingProduct.ingredients || ""} onChange={(event) => setEditingProduct({ ...editingProduct, ingredients: event.target.value })} />
                </div>
              ) : null}
              {productFields.prepTime ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="p-prep">Prep time (minutes)</label>
                  <input id="p-prep" type="number" min={0} className="jata-input" value={editingProduct.prepMinutes ?? ""} onChange={(event) => setEditingProduct({ ...editingProduct, prepMinutes: event.target.value === "" ? null : Number(event.target.value) })} />
                </div>
              ) : null}
              {productFields.brand ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="p-brand">Brand</label>
                  <input id="p-brand" className="jata-input" value={editingProduct.brand || ""} onChange={(event) => setEditingProduct({ ...editingProduct, brand: event.target.value })} />
                </div>
              ) : null}
              {productFields.tags ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="p-tags">Tags (comma separated)</label>
                  <input id="p-tags" className="jata-input" value={parseJson<string[]>(editingProduct.tags, []).join(", ")} onChange={(event) => setEditingProduct({ ...editingProduct, tags: JSON.stringify(event.target.value.split(",").map((entry) => entry.trim()).filter(Boolean)) })} />
                </div>
              ) : null}

              {productFields.variants ? (
                <VariantEditor
                  label="Options (size, colour, shade)"
                  variants={(editingProduct.variants || []).map((variant) => ({ label: variant.label, priceKES: variant.priceKES }))}
                  onChange={(variants) => setEditingProduct({ ...editingProduct, variants: variants.map((variant, index) => ({ id: `v-${index}`, label: variant.label, priceKES: variant.priceKES })) })}
                />
              ) : null}

              {productFields.addOns ? (
                <AddOnEditor
                  addOns={parseJson<AddOn[]>(editingProduct.addOns, [])}
                  onChange={(addOns) => setEditingProduct({ ...editingProduct, addOns: JSON.stringify(addOns) })}
                />
              ) : null}

              <div className="flex flex-wrap gap-4">
                {productFields.featured ? (
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={editingProduct.isFeatured} onChange={(event) => setEditingProduct({ ...editingProduct, isFeatured: event.target.checked })} />
                    Feature on the home page
                  </label>
                ) : null}
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={editingProduct.isActive} onChange={(event) => setEditingProduct({ ...editingProduct, isActive: event.target.checked })} />
                  Visible to customers
                </label>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="jata-btn jata-btn-primary" disabled={busy} onClick={() => saveProduct(editingProduct)}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setEditingProduct(null)}>Close</button>
              {!editingProduct.id.startsWith("new-") ? (
                <button type="button" className="jata-btn jata-btn-ghost" onClick={() => removeProduct(editingProduct.id)}>Delete</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {editingService ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Edit ${editingService.title || "service"}`}>
          <button className="jata-sheet-scrim" aria-label="Close editor" onClick={() => setEditingService(null)} />
          <div className="jata-sheet">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold">{editingService.id.startsWith("new-") ? "New service" : editingService.title}</h2>
              <button className="jata-icon-btn" aria-label="Close editor" onClick={() => setEditingService(null)}>✕</button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="jata-field">
                <label className="jata-label" htmlFor="s-title">Service name</label>
                <input id="s-title" className="jata-input" value={editingService.title} onChange={(event) => setEditingService({ ...editingService, title: event.target.value })} />
              </div>
              <div className="jata-field">
                <label className="jata-label" htmlFor="s-description">Description</label>
                <textarea id="s-description" className="jata-input min-h-24" value={editingService.description || ""} onChange={(event) => setEditingService({ ...editingService, description: event.target.value })} />
                <AssistBox
                  businessId={businessId}
                  kind="SERVICE_DESCRIPTION"
                  categoryKey={categoryKey}
                  name={editingService.title}
                  onAccept={(text) => setEditingService({ ...editingService, description: text })}
                />
              </div>

              {serviceFields.image ? (
                <MediaPicker businessId={businessId} label="Photo" value={editingService.imageUrl || ""} onChange={(url) => setEditingService({ ...editingService, imageUrl: url || null })} />
              ) : null}

              <div className="jata-field">
                <label className="jata-label" htmlFor="s-pricing">Pricing</label>
                <select
                  id="s-pricing"
                  className="jata-input"
                  value={editingService.pricingType}
                  onChange={(event) => setEditingService({ ...editingService, pricingType: event.target.value })}
                >
                  <option value="FIXED">Fixed price</option>
                  <option value="QUOTE">Quote on request</option>
                </select>
              </div>

              {editingService.pricingType === "QUOTE" ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="s-price-label">Price label</label>
                  <input id="s-price-label" className="jata-input" placeholder="e.g. From KES 2,500" value={editingService.priceLabel || ""} onChange={(event) => setEditingService({ ...editingService, priceLabel: event.target.value })} />
                </div>
              ) : serviceFields.price ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="jata-field">
                    <label className="jata-label" htmlFor="s-price-from">Price from (KES)</label>
                    <input id="s-price-from" type="number" min={0} className="jata-input" value={editingService.priceFrom ?? ""} onChange={(event) => setEditingService({ ...editingService, priceFrom: event.target.value === "" ? null : Number(event.target.value) })} />
                  </div>
                  <div className="jata-field">
                    <label className="jata-label" htmlFor="s-price-to">Price to (KES)</label>
                    <input id="s-price-to" type="number" min={0} className="jata-input" value={editingService.priceToKES ?? ""} onChange={(event) => setEditingService({ ...editingService, priceToKES: event.target.value === "" ? null : Number(event.target.value) })} />
                  </div>
                </div>
              ) : null}

              {serviceFields.duration ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="s-duration">Duration (minutes)</label>
                  <input id="s-duration" type="number" min={0} className="jata-input" value={editingService.durationMinutes ?? ""} onChange={(event) => setEditingService({ ...editingService, durationMinutes: event.target.value === "" ? null : Number(event.target.value) })} />
                </div>
              ) : null}
              {serviceFields.deposit ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="s-deposit">Deposit (KES)</label>
                  <input id="s-deposit" type="number" min={0} className="jata-input" value={editingService.depositKES ?? ""} onChange={(event) => setEditingService({ ...editingService, depositKES: event.target.value === "" ? null : Number(event.target.value) })} />
                  <p className="jata-hint">Leave empty to confirm bookings without payment.</p>
                </div>
              ) : null}
              {serviceFields.staff ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="s-staff">Who provides it</label>
                  <input id="s-staff" className="jata-input" value={editingService.staffName || ""} onChange={(event) => setEditingService({ ...editingService, staffName: event.target.value })} />
                </div>
              ) : null}
              {serviceFields.category ? (
                <div className="jata-field">
                  <label className="jata-label" htmlFor="s-category">Category</label>
                  <input id="s-category" className="jata-input" value={editingService.category || ""} onChange={(event) => setEditingService({ ...editingService, category: event.target.value })} />
                </div>
              ) : null}

              <div className="flex flex-wrap gap-4">
                {serviceFields.featured ? (
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={editingService.isFeatured} onChange={(event) => setEditingService({ ...editingService, isFeatured: event.target.checked })} />
                    Feature on the home page
                  </label>
                ) : null}
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={editingService.isActive} onChange={(event) => setEditingService({ ...editingService, isActive: event.target.checked })} />
                  Visible to customers
                </label>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="jata-btn jata-btn-primary" disabled={busy} onClick={() => saveService(editingService)}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setEditingService(null)}>Close</button>
              {!editingService.id.startsWith("new-") ? (
                <button type="button" className="jata-btn jata-btn-ghost" onClick={() => removeService(editingService.id)}>Delete</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VariantEditor({
  label,
  variants,
  onChange,
}: {
  label: string;
  variants: Variant[];
  onChange: (variants: Variant[]) => void;
}) {
  return (
    <div className="jata-field">
      <span className="jata-label">{label}</span>
      <ul className="mt-2 space-y-2">
        {variants.map((variant, index) => (
          <li key={index} className="flex items-center gap-2">
            <input
              className="jata-input"
              aria-label={`Option ${index + 1} name`}
              placeholder="e.g. Large"
              value={variant.label}
              onChange={(event) => onChange(variants.map((entry, position) => (position === index ? { ...entry, label: event.target.value } : entry)))}
            />
            <input
              type="number"
              min={0}
              className="jata-input"
              aria-label={`Option ${index + 1} price`}
              placeholder="Price"
              value={variant.priceKES ?? ""}
              onChange={(event) => onChange(variants.map((entry, position) => (position === index ? { ...entry, priceKES: event.target.value === "" ? null : Number(event.target.value) } : entry)))}
            />
            <button type="button" className="jata-icon-btn" aria-label="Remove option" onClick={() => onChange(variants.filter((_, position) => position !== index))}>🗑</button>
          </li>
        ))}
      </ul>
      <button type="button" className="jata-btn jata-btn-secondary mt-2" onClick={() => onChange([...variants, { label: "", priceKES: null }])}>
        Add option
      </button>
    </div>
  );
}

function AddOnEditor({ addOns, onChange }: { addOns: AddOn[]; onChange: (addOns: AddOn[]) => void }) {
  return (
    <div className="jata-field">
      <span className="jata-label">Add-ons</span>
      <ul className="mt-2 space-y-2">
        {addOns.map((addOn, index) => (
          <li key={addOn.id || index} className="flex items-center gap-2">
            <input
              className="jata-input"
              aria-label={`Add-on ${index + 1} name`}
              placeholder="e.g. Extra sauce"
              value={addOn.name}
              onChange={(event) => onChange(addOns.map((entry, position) => (position === index ? { ...entry, name: event.target.value } : entry)))}
            />
            <input
              type="number"
              min={0}
              className="jata-input"
              aria-label={`Add-on ${index + 1} price`}
              placeholder="KES"
              value={addOn.priceKES ?? ""}
              onChange={(event) => onChange(addOns.map((entry, position) => (position === index ? { ...entry, priceKES: Number(event.target.value) || 0 } : entry)))}
            />
            <button type="button" className="jata-icon-btn" aria-label="Remove add-on" onClick={() => onChange(addOns.filter((_, position) => position !== index))}>🗑</button>
          </li>
        ))}
      </ul>
      <button type="button" className="jata-btn jata-btn-secondary mt-2" onClick={() => onChange([...addOns, { id: `a-${Date.now()}`, name: "", priceKES: 0 }])}>
        Add add-on
      </button>
    </div>
  );
}
