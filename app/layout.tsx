import type { Metadata, Viewport } from "next";
import "./globals.css";
// POS / ERP - PRO styles live in their own sheet: globals.css is pinned by the design-restoration
// and workspace-token contracts, so the ERP block must not append hex literals after them.
import "./erp.css";
import { getBaseUrl } from "@/lib/url";
import ProductThemeProvider from "@/components/ProductThemeProvider";
import { productThemeBootScript, productThemeCss } from "@/lib/productThemes";
import { PwaInstaller } from "@/components/pwa/PwaInstaller";

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
  applicationName: "JATA AFTERCALL",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "AFTERCALL", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14110f",
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
        <PwaInstaller />
      </body>
    </html>
  );
}
