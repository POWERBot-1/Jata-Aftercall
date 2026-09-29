"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Stage 2: owner-facing referral sharing. The link contains only the opaque public code — no
 * tenant id, email, phone or internal referral data is exposed to the browser beyond the owner's
 * own link.
 */
export default function ReferralShareCard({ url }: { url: string }) {
  const [status, setStatus] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Referral link copied. Paste it into WhatsApp, SMS or social media.");
    } catch {
      setStatus(`Copy your referral link: ${url}`);
    }
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`Set up your own business page like mine: ${url}`)}`;

  return (
    <section className="mt-4 rounded-xl border border-dashed bg-zinc-50 p-4" aria-labelledby="referral-share-title">
      <h3 id="referral-share-title" className="jata-section-title">Refer another business</h3>
      <p className="mt-1 text-sm text-zinc-600">
        Share your link with another business owner. They open it without signing in, create their own account and page, and you are credited — self-service, nothing to request from us.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()}>Copy referral link</Button>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="jata-btn jata-btn-secondary inline-flex items-center"
        >
          Share on WhatsApp
        </a>
      </div>
      <p role="status" aria-live="polite" className={`mt-2 text-sm text-zinc-600 ${status ? "" : "sr-only"}`}>{status}</p>
    </section>
  );
}
