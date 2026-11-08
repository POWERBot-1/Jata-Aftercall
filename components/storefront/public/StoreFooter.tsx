import Link from "next/link";

/**
 * The platform footer on every public page.
 *
 * Attribution is part of the product, not an afterthought: a customer always knows this is a JATA
 * AFTERCALL page, and always has a way to get one of their own. Nothing here is business-specific.
 */
export function StoreFooter({ referralHref }: { referralHref?: string | null }) {
  return (
    <footer className="st-footer">
      <p className="st-footer__brand">
        <span className="st-footer__mark" aria-hidden="true" />
        JATA AFTERCALL
      </p>
      <p style={{ margin: "0.4rem 0 0" }}>
        Powered by JATA AFTERCALL ·{" "}
        <Link href={referralHref && referralHref.startsWith("/r/") ? referralHref : "/"}>
          {referralHref && referralHref.startsWith("/r/") ? "Create your page" : "Create your page"}
        </Link>
      </p>
      <p style={{ margin: "0.25rem 0 0" }}>
        A JATA AFTERCALL business page. Payments, where offered, are handled by the business — this page takes none.
      </p>
    </footer>
  );
}

export default StoreFooter;
