import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_BUSINESSES } from "@/lib/demoData";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact action fixtures", robots: { index: false, follow: false } };

/** Local evidence index for the four mandated demo pages. No database or production data. */
export default function ContactActionFixtureIndex() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-bold">Demo contact action fixtures</h1>
      <p className="mt-2 text-sm">Local browser evidence only. These render the real public BusinessPage component with fictional fixture data.</p>
      <ul className="mt-4 space-y-2">
        {DEMO_BUSINESSES.map((demo) => (
          <li key={demo.slug}>
            <Link className="underline" href={`/dev/contact-actions/${demo.slug}`}>{demo.name} — /b/{demo.slug}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
