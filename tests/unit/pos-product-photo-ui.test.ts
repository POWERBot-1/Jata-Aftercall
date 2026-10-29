// DOM-level component tests with a mocked image pipeline: not evidence of durable storage.
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({ prepare: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/media/browserImage", () => ({ prepareUpload: pipeline.prepare, uploadPreparedImage: pipeline.upload }));
import { RecordBoard } from "@/components/pos/RecordBoard";

let root: Root;
let container: HTMLDivElement;
const upload = { dataUrl: "data:image/png;base64,AA==", width: 1, height: 1 };
const file = () => new File(["example"], "photo.png", { type: "image/png" });
const button = (text: string) => Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.trim() === text) as HTMLButtonElement;
async function choose(value: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [value] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }));
  pipeline.prepare.mockReset().mockResolvedValue({ status: "ok", upload });
  pipeline.upload.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(RecordBoard, {
    businessId: "business-a", apiPath: "/api/pos/business-a/products", word: "Product", plural: "Products",
    fields: [{ key: "name", label: "Name", kind: "text", required: true }],
    rows: [{ id: "one", name: "One", imageUrl: "https://example.test/one.png" }, { id: "two", name: "Two" }],
    titleKey: "name", canEdit: true, productPhotos: true, openNew: true, basePath: "/dashboard/pos/business-a",
    emptyState: { title: "Empty", body: "Empty", action: { label: "Add" } },
  })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("POS product photo selection (mocked pipeline)", () => {
  it("previews a failed selection, prevents saving it, retries and allows removal", async () => {
    pipeline.upload.mockResolvedValueOnce({ status: "error", error: "Storage unavailable" }).mockResolvedValueOnce({ status: "ok", asset: { url: "https://example.test/new.png" } });
    await choose(file());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Storage unavailable");
    expect(container.querySelector('img[alt="Selected item photo"]')?.getAttribute("src")).toBe("blob:preview");
    expect(button("Add product").disabled).toBe(true);
    await act(async () => { button("Retry upload").click(); });
    expect(pipeline.upload).toHaveBeenCalledTimes(2);
    expect(container.querySelector('img[alt="Selected item photo"]')?.getAttribute("src")).toBe("https://example.test/new.png");
    expect(button("Add product").disabled).toBe(false);
    await act(async () => { button("Remove photo").click(); });
    expect(container.textContent).toContain("Photo will be removed when you save.");
  });

  it("does not attach a late upload to another item after switching forms", async () => {
    let resolve!: (value: unknown) => void;
    pipeline.upload.mockReturnValue(new Promise((done) => { resolve = done; }));
    await choose(file());
    expect(button("Add product").disabled).toBe(true);
    await act(async () => { const edits = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === "Edit"); edits[1].click(); });
    await act(async () => { resolve({ status: "ok", asset: { url: "https://example.test/late.png" } }); });
    expect(container.querySelector('img[alt="Selected item photo"]')).toBeNull();
    expect(container.textContent).not.toContain("Photo uploaded. Save the item to use it.");
    expect(button("Save changes").disabled).toBe(false);
  });
});
