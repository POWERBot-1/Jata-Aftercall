/**
 * Business QR identity — the page section (Business Hub E).
 *
 * The SVG is generated on the server from the page's canonical public URL and inlined, so the
 * section adds no JavaScript and no network request: the code a visitor sees is the code that
 * gets downloaded.
 *
 * Only public information appears here — the page URL and the business name. No dashboard link,
 * no business id, no customer detail.
 */

import { businessQrSvg, publicPageUrl } from "@/lib/business-hub/qrIdentity";
import { QrDownloadButton } from "./QrDownloadButton";

export function QrIdentityBlock({
  slug,
  businessName,
  size = 220,
  showDownload = true,
}: {
  slug: string;
  businessName: string;
  size?: number;
  showDownload?: boolean;
}) {
  const url = publicPageUrl(slug);
  const svg = businessQrSvg(slug, { size });
  const domId = `business-qr-${slug.replace(/[^a-z0-9-]/gi, "")}`;

  return (
    <section id="qr" className="st-section st-hub-panel" aria-labelledby="qr-title">
      <h2 id="qr-title" className="st-sectionTitle st-hub-panel__title">
        Scan to open this page
      </h2>
      <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div
          id={domId}
          className="st-hub-qr rounded-2xl p-2"
          // Generated entirely by lib/qr/encoder.ts from the slug: no owner or user input reaches
          // this markup.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            Point a phone camera at this code to open <span className="font-semibold">{businessName}</span> on JATA
            AFTERCALL.
          </p>
          <p className="jata-hint mt-1 break-all">{url}</p>
          {showDownload ? <QrDownloadButton targetId={domId} filename={`${slug}-jata-qr`} /> : null}
        </div>
      </div>
    </section>
  );
}

export default QrIdentityBlock;
