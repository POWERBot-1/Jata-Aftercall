import type { Metadata } from "next";
import "./globals.css";
import { getBaseUrl } from "@/lib/url";
import ProductThemeProvider from "@/components/ProductThemeProvider";
import { productThemeBootScript, productThemeCss } from "@/lib/productThemes";

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: "JATA AFTERCALL — Business details and contact options in one page",
    template: "%s | JATA AFTERCALL",
  },
  description:
    "Mobile-friendly business pages for Kenyan small businesses to share their details, services, prices and contact options — including WhatsApp, Call and Directions.",
  openGraph: {
    title: "JATA AFTERCALL",
    description: "Business details and contact options in one mobile-friendly page.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style id="jata-product-theme-tokens" dangerouslySetInnerHTML={{ __html: productThemeCss() }} />
        <script id="jata-product-theme-boot" dangerouslySetInnerHTML={{ __html: productThemeBootScript() }} />
      </head>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <ProductThemeProvider>{children}</ProductThemeProvider>
      </body>
    </html>
  );
}
