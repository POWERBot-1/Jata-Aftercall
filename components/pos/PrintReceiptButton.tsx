"use client";

/** The sale detail page is a Server Component; browser printing must live in a client boundary. */
export function PrintReceiptButton() {
  return <button className="jata-btn jata-btn-ghost" onClick={() => window.print()} type="button">Print</button>;
}
