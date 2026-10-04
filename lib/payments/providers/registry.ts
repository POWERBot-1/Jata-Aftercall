/**
 * The JATA Provider Registry (§8, §91).
 *
 * One place knows which providers exist, what they can do, whether JATA's central connector for
 * them is actually configured, and which adapter to use. The POS asks the registry; it never
 * branches on a provider name itself (§6 "the POS must never implement provider-specific logic").
 *
 * Adding a provider is one adapter plus one line here. Removing one changes nothing in the POS.
 */

import type { DestinationKind, ProviderCapability, ProviderKey } from "../types";
import { PROVIDER_LABELS } from "../types";
import type { PaymentProviderAdapter } from "./types";
import { createMpesaAdapter } from "./mpesa";
import { createPaystackAdapter } from "./paystack";
import { createBankAdapter } from "./bank";

export type ProviderDescriptor = {
  key: ProviderKey;
  label: string;
  /** Shown on the wallet tile under the provider name (§10). */
  summary: string;
  supportedKinds: DestinationKind[];
  /** Capabilities when the connector is live — the provider's ceiling. */
  capabilities: ProviderCapability[];
  connectorReady: boolean;
  /** Whether this provider can be configured at all in this build. */
  available: boolean;
  /** "Coming soon" — shown, never selectable, never claimed as working (§120). */
  comingSoon: boolean;
};

const adapters: Record<string, PaymentProviderAdapter> = {
  MPESA: createMpesaAdapter(),
  PAYSTACK: createPaystackAdapter(),
  BANK: createBankAdapter(),
};

/** Future providers are visible but inert: no adapter, no capability, no fake success (§120). */
const COMING_SOON: ProviderKey[] = ["AIRTEL_MONEY"];

export function getAdapter(provider: ProviderKey | string): PaymentProviderAdapter | null {
  return adapters[provider] ?? null;
}

/** Throws rather than silently falling back to another provider (§51: never silently re-route). */
export function requireAdapter(provider: ProviderKey | string): PaymentProviderAdapter {
  const adapter = getAdapter(provider);
  if (!adapter) throw new Error(`No JATA provider adapter is registered for ${String(provider)}.`);
  return adapter;
}

export function providerDescriptors(): ProviderDescriptor[] {
  const keys: ProviderKey[] = ["MPESA", "PAYSTACK", "BANK", "AIRTEL_MONEY"];
  return keys.map((key) => {
    const adapter = getAdapter(key);
    const comingSoon = !adapter || COMING_SOON.includes(key);
    return {
      key,
      label: PROVIDER_LABELS[key],
      summary: summaryFor(key),
      supportedKinds: adapter?.supportedKinds ?? [],
      capabilities: adapter?.declaredCapabilities() ?? [],
      connectorReady: adapter?.connectorReady() ?? false,
      available: Boolean(adapter) && !comingSoon,
      comingSoon,
    };
  });
}

function summaryFor(key: ProviderKey): string {
  switch (key) {
    case "MPESA":
      return "Till, Buy Goods and PayBill — confirmed in real time";
    case "PAYSTACK":
      return "Online payments collected through JATA";
    case "BANK":
      return "Bank account — instructions for your customers";
    case "AIRTEL_MONEY":
      return "Coming soon";
    default:
      return "";
  }
}

/** Providers JATA shows but does not claim to support yet (§120). */
export function comingSoonProviders(): ProviderKey[] {
  return providerDescriptors().filter((descriptor) => descriptor.comingSoon).map((descriptor) => descriptor.key);
}

export function isProviderAvailable(provider: ProviderKey | string): boolean {
  const descriptor = providerDescriptors().find((entry) => entry.key === provider);
  return Boolean(descriptor?.available);
}

/** The wallet tiles, in the order the merchant sees them (§10). */
export function walletTiles(): {
  kind: DestinationKind;
  provider: ProviderKey;
  title: string;
  subtitle: string;
  available: boolean;
  comingSoon: boolean;
}[] {
  return [
    { kind: "MPESA_TILL", provider: "MPESA", title: "M-PESA", subtitle: "Till / Buy Goods", available: true, comingSoon: false },
    { kind: "MPESA_PAYBILL", provider: "MPESA", title: "M-PESA", subtitle: "PayBill", available: true, comingSoon: false },
    { kind: "BANK_ACCOUNT", provider: "BANK", title: "Bank", subtitle: "Account", available: true, comingSoon: false },
    { kind: "PAYSTACK", provider: "PAYSTACK", title: "Paystack", subtitle: "Online / M-PESA", available: true, comingSoon: false },
    { kind: "MPESA_POCHI", provider: "MPESA", title: "M-PESA", subtitle: "Pochi la Biashara", available: true, comingSoon: false },
  ];
}
