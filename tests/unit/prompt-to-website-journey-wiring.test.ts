import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const workflow = readFileSync(".github/workflows/website-studio-2-0.yml", "utf8");
const authenticated = readFileSync("scripts/browser/studio-authenticated.check.mjs", "utf8");
const studioPage = readFileSync("app/dashboard/businesses/[id]/studio/page.tsx", "utf8");
const editor = readFileSync("components/studio/openpage/OpenPageEditor.tsx", "utf8");

describe("native OpenPage editor acceptance is wired into the authenticated release gate", () => {
  it("runs the real authenticated production browser suite", () => {
    expect(workflow).toContain("Authenticated Website Studio browser acceptance");
    expect(workflow).toContain("npm run test:browser:studio-authenticated");
    expect(workflow).toContain("Production build");
  });

  it("mounts the upstream editor only through the JATA tenant workspace", () => {
    expect(studioPage).toContain("ensureDefaultStudioWebsite");
    expect(studioPage).toContain("<OpenPageEditor");
    expect(studioPage).toContain("workspace.entitlement.entitled");
    expect(editor).toContain("/api/studio/openpage/document");
    expect(editor).toContain("useEditorStore.getState().setActiveProject(websiteId)");
  });

  it("tests real native editor autosave and immutable server revisions", () => {
    expect(authenticated).toContain("async function openPageEditorUI");
    expect(authenticated).toContain(".openpage-editor-root");
    expect(authenticated).toContain("Add Hero Block");
    expect(authenticated).toContain("openPageSiteRevision.findUnique");
    expect(authenticated).toContain("OpenPage inspector edit persists through JATA API");
    expect(authenticated).toContain("OpenPage content is not persisted in browser local storage");
  });

  it("uses a real disposable Prisma database and server-issued owner sessions", () => {
    expect(authenticated).toContain("new PrismaClient");
    expect(authenticated).toContain("assertIsolatedStudioTarget");
    expect(authenticated).toContain("/api/auth/register");
    expect(authenticated).toContain("jata_session");
  });

  it("tests cross-tenant OpenPage reads and writes against the real API", () => {
    expect(authenticated).toContain("/api/studio/openpage/document?websiteId=");
    expect(authenticated).toContain('"/api/studio/openpage/document", "PUT"');
    expect(authenticated).toContain("cross-tenant attempts do not mutate foreign draft/live");
  });

  it("does not retain the removed fixture-only editor or stale browser script", () => {
    expect(workflow).not.toContain("Prompt-to-website browser journey");
    expect(authenticated).not.toContain("/dashboard/businesses/${fixture.id}/design");
    expect(authenticated).not.toContain("/dashboard/businesses/${fixture.id}/sections");
    expect(existsSync("app/dev/website-studio-preview/page.tsx")).toBe(false);
    expect(existsSync("scripts/browser/website-studio-openpage.check.mjs")).toBe(false);
  });

  it("keeps the existing public Experience renderer regression coverage", () => {
    expect(authenticated).toContain("private preview faithfully shows owner-enabled recipe fact");
    expect(authenticated).toContain("customer sees content");
    expect(authenticated).toContain("exact reviewed content/version published and snapshotted");
  });
});
