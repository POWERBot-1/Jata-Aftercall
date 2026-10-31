// DOM-level component tests with a mocked image pipeline and mocked API, not durable storage.
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const pipeline = vi.hoisted(() => ({ prepare: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/media/browserImage", () => ({ prepareUpload: pipeline.prepare, uploadPreparedImage: pipeline.upload }));
import { CategoryPhotos } from "@/components/pos/CategoryPhotos";

let root: Root;
let container: HTMLDivElement;
const button = (text: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === text) as HTMLButtonElement;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:category"), revokeObjectURL: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
  pipeline.prepare.mockReset().mockResolvedValue({ status: "ok", upload: { dataUrl: "data:image/png;base64,AA==", width: 1, height: 1 } });
  pipeline.upload.mockReset();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(createElement(CategoryPhotos, { businessId: "business-a", categories: ["Produce", "Drinks"], initialImages: [], canEdit: true })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("POS category photos (mocked pipeline)", () => {
  it("retries a failed upload, persists the selected category, then removes its photo", async () => {
    pipeline.upload.mockResolvedValueOnce({ status: "error", error: "Storage unavailable" }).mockResolvedValueOnce({ status: "ok", asset: { url: "https://example.test/photo.png" } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["pixels"], "produce.png", { type: "image/png" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Storage unavailable");
    expect(container.querySelector('img')?.getAttribute("src")).toBe("blob:category");
    await act(async () => button("Retry upload").click());
    expect(container.querySelector('img')?.getAttribute("src")).toBe("https://example.test/photo.png");
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toEqual({ category: "Produce", imageUrl: "https://example.test/photo.png" });
    await act(async () => button("Remove category photo").click());
    expect(JSON.parse((fetch as any).mock.calls[1][1].body)).toEqual({ category: "Produce", imageUrl: null });
    expect(container.textContent).toContain("library image was kept");
  });
});
