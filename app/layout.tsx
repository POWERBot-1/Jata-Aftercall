import type { Metadata } from "next";
import "./globals.css";
import { getBaseUrl } from "@/lib/url";

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: "JATA AFTERCALL — Every call leaves your business behind",
    template: "%s | JATA AFTERCALL",
  },
  description:
    "Turn every customer interaction into another opportunity to sell. Lightweight after-interaction pages for Kenyan SMEs — WhatsApp, Call, Directions, Offers, Analytics.",
  openGraph: {
    title: "JATA AFTERCALL",
    description: "Every call leaves your business behind.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}
