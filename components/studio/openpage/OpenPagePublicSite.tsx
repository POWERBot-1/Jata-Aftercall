"use client";

import { RenderBlock } from "@/vendor/openpage/src/blocks/registry";
import { resolveTheme, themeToCSS } from "@/vendor/openpage/src/lib/theme-presets";
import type { SiteConfig } from "@/vendor/openpage/src/blocks/types";

export function OpenPagePublicSite({ config, pagePath = "/" }: { config: SiteConfig; pagePath?: string }) {
  const pages = config.pages ?? [];
  const page = pages.find((item) => normalizePath(item.path) === normalizePath(pagePath));
  const blocks = page?.blocks ?? (pages.length === 0 && pagePath === "/" ? config.blocks : []);
  const theme = resolveTheme(config.theme);
  const style = {
    ...themeToCSS(theme),
    backgroundColor: theme.bg0,
    color: theme.text0,
    fontFamily: `"${theme.fontSans}", system-ui, sans-serif`,
    minHeight: "100vh",
  } as React.CSSProperties;

  return (
    <main className="openpage-public-root min-h-screen w-full" style={style} data-openpage-public="true">
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
