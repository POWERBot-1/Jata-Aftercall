import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { WorkspacePhotoImage } from "./WorkspaceUI";
import { WORKSPACE_HERO_PHOTO } from "@/lib/workspaceImagery";
import { Check } from "lucide-react";

/**
 * Account and setup shell.
 *
 * The signed-out half of the workspace: sign in, create an account, recover a password and
 * set up a business all share this frame, so the marketing page, the account pages and the
 * authenticated product read as one product rather than three.
 *
 * Desktop: a graphite/serif panel with the brand story beside the form. Phone: the story panel
 * is dropped, the form is the page, and every control keeps its 44px touch target.
 */
export function WorkspaceAuthShell({
  title,
  subtitle,
  children,
  points,
  asideTitle,
  asideCopy,
  backHref = "/",
  backLabel = "Back",
  footnote,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  points?: string[];
  asideTitle?: ReactNode;
  asideCopy?: ReactNode;
  backHref?: string;
  backLabel?: string;
  footnote?: ReactNode;
}) {
  const benefits = points ?? [
    "A page customers can act on — WhatsApp, Call, Directions",
    "Real numbers, recorded by your own page",
    "Pay with M-Pesa or card on Paystack",
  ];
  return (
    <div className="ws-shell">
      <a href="#main" className="jata-skip-link">
        Skip to content
      </a>
      <div className="ws-auth">
        <aside className="ws-auth__aside">
          <WorkspacePhotoImage photo={WORKSPACE_HERO_PHOTO} sizes="(min-width: 960px) 52vw, 100vw" priority />
          <BrandMark href="/" compact />
          <div>
            <h2 className="ws-auth__aside-title">
              {asideTitle ?? (
                <>
                  Every conversation, <em>one link</em>.
                </>
              )}
            </h2>
            <p className="ws-auth__aside-copy">
              {asideCopy ?? "JATA AFTERCALL turns the moment after a customer calls, messages or visits into a page they can act on — and a workspace where you can see what happened."}
            </p>
            <ul className="ws-auth__aside-list">
              {benefits.map((point) => (
                <li key={point}>
                  <Check size={15} aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="ws-tiny" style={{ color: "rgba(247,242,232,0.55)" }}>
            Built for Kenyan small businesses · works on any phone
          </p>
        </aside>

        <main id="main" className="ws-auth__main">
          <div className="mx-auto flex w-full max-w-[30rem] items-center justify-between gap-3 pb-4">
            <span className="inline-flex sm:hidden">
              <BrandMark href="/" compact />
            </span>
            <Link href={backHref} className="ml-auto inline-flex min-h-11 items-center text-sm font-semibold text-[color:var(--ws-amber-deep)] hover:underline">
              ← {backLabel}
            </Link>
          </div>
          <div className="ws-auth__card">
            <h1 className="ws-auth__title">{title}</h1>
            {subtitle ? <p className="ws-auth__sub">{subtitle}</p> : null}
            <div className="mt-4 ws-form">{children}</div>
          </div>
          {footnote ? <div className="mx-auto mt-4 w-full max-w-[30rem] text-center text-xs text-[color:var(--ws-muted)]">{footnote}</div> : null}
        </main>
      </div>
    </div>
  );
}

/**
 * Setup shell.
 *
 * Used by the add-a-business wizard and the AI configuration screen: the same graphite chrome
 * as the workspace, a wide reading column, and no marketing panel so a long form gets the
 * whole screen.
 */
export function WorkspaceSetupShell({
  title,
  subtitle,
  children,
  backHref = "/dashboard",
  backLabel = "Dashboard",
  width = "wide",
  meta,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
  width?: "wide" | "xwide";
  meta?: ReactNode;
}) {
  return (
    <div className="ws-shell">
      <a href="#main" className="jata-skip-link">
        Skip to content
      </a>
      <header className="ws-chrome">
        <div className="ws-chrome__row">
          <BrandMark href="/dashboard" compact />
          <span className="ws-chrome__tag">Setup</span>
          <div className="ws-chrome__actions">
            <Link href={backHref} className="jata-btn jata-btn-secondary">
              ← {backLabel}
            </Link>
          </div>
        </div>
      </header>
      <main id="main" className={width === "xwide" ? "ws-main max-w-[92rem]" : "ws-main"}>
        <div className="ws-stack">
          <div className="max-w-[52rem]">
            <h1 className="font-[family-name:var(--ws-display)] text-[clamp(1.6rem,4vw,2.3rem)] font-semibold leading-[1.1] tracking-[-0.02em]">{title}</h1>
            {subtitle ? <p className="ws-muted mt-2 text-[0.92rem] leading-[1.6]">{subtitle}</p> : null}
            {meta ? <p className="ws-tiny mt-2 text-[color:var(--ws-faint)]">{meta}</p> : null}
          </div>
          <div className="ws-form">{children}</div>
        </div>
      </main>
    </div>
  );
}
