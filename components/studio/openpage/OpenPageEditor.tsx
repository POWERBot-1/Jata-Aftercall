"use client";

import { useEffect, useState } from "react";
import { EditorLayout } from "@/vendor/openpage/src/editor/EditorLayout";
import { OpenPagePersistenceProvider } from "./OpenPagePersistenceContext";
import { defaultConfig } from "@/vendor/openpage/src/store/configStore";
import type { SiteConfig } from "@/vendor/openpage/src/blocks/types";
import { useConfigStore } from "@/vendor/openpage/src/store/configStore";
import { useEditorStore } from "@/vendor/openpage/src/store/editorStore";
import { useProjectsStore } from "@/vendor/openpage/src/store/projectsStore";

type Props = { websiteId: string; businessId: string; websiteName: string };

export function OpenPageEditor({ websiteId, businessId, websiteName }: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [publishedVersion, setPublishedVersion] = useState(0);
  const [websiteStatus, setWebsiteStatus] = useState("DRAFT");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/studio/openpage/document?websiteId=${encodeURIComponent(websiteId)}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to load this website.");
        const saved = data.document;
        const config: SiteConfig = saved?.config ?? {
          ...defaultConfig,
          name: websiteName,
          pages: [{ id: "page-home", name: "Home", path: "/", blocks: [] }],
          blocks: [],
        };
        if (cancelled) return;

        useConfigStore.getState().setConfig(config);
        useEditorStore.getState().setActiveProject(websiteId);
        const blockCount = config.pages?.reduce((sum, page) => sum + page.blocks.length, 0) ?? config.blocks.length;
        useProjectsStore.setState({
          projects: [{
            id: websiteId,
            name: config.name || websiteName,
            status: "draft",
            updatedAt: "Loaded from JATA",
            blockCount,
            config,
          }],
        });
        setDraftVersion(saved?.draftVersion ?? 0);
        setPublishedVersion(saved?.publishedVersion ?? 0);
        setWebsiteStatus(data.website?.status ?? "DRAFT");
        setReady(true);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load this website.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [websiteId, websiteName]);

  return (
    <section className="openpage-editor-root" aria-label="OpenPage Website Studio">
      {error ? (
        <div className="flex h-full items-center justify-center p-6 text-center">
          <div>
            <h2 className="text-lg font-semibold">Website Studio could not load</h2>
            <p className="mt-2 text-sm text-red-400">{error}</p>
          </div>
        </div>
      ) : !ready ? (
        <div className="flex h-full items-center justify-center text-sm text-zinc-300">Loading your website editor…</div>
      ) : (
        <OpenPagePersistenceProvider websiteId={websiteId} businessId={businessId} initialDraftVersion={draftVersion} initialPublishedVersion={publishedVersion} initialWebsiteStatus={websiteStatus} ready={ready}>
          <EditorLayout />
        </OpenPagePersistenceProvider>
      )}
    </section>
  );
}
