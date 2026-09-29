import type { Metadata } from "next";

export const metadata: Metadata = { title: "Payment status" };

export default function CheckoutCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
