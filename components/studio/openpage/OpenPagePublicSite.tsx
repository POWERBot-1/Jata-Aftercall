"use client";

import { RenderBlock } from "@/vendor/openpage/src/blocks/registry";
import { resolveTheme, themeToCSS } from "@/vendor/openpage/src/lib/theme-presets";
import type { SiteConfig } from "@/vendor/openpage/src/blocks/types";
import { useGoogleFonts } from "@/vendor/openpage/src/lib/useGoogleFonts";

export function OpenPagePublicSite({ config, pagePath = "/", preview = false }: { config: SiteConfig; pagePath?: string; preview?: boolean }) {
  const pages = config.pages ?? [];
  const page = pages.find((item) => normalizePath(item.path) === normalizePath(pagePath));
  const blocks = page?.blocks ?? (pages.length === 0 && pagePath === "/" ? config.blocks : []);
  const theme = resolveTheme(config.theme);
  useGoogleFonts([theme.fontSans, theme.fontDisplay, theme.fontMono]);
  const style = {
    ...themeToCSS(theme),
    backgroundColor: theme.bg0,
    color: theme.text0,
    fontFamily: `"${theme.fontSans}", system-ui, sans-serif`,
    minHeight: "100vh",
  } as React.CSSProperties;

  return (
    <main className="openpage-public-root min-h-screen w-full" style={style} data-openpage-public="true">
      {preview ? <div role="note" className="sticky top-0 z-50 bg-amber-300 px-4 py-2 text-center text-xs font-semibold text-amber-950">Draft preview — only authorized business members can see this page.</div> : null}
      {blocks.map((block) => (
        <RenderBlock key={block.id} block={block} />
      ))}
    </main>
  );
}

function normalizePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.split("/").filter(Boolean).join("/")}`;
}
