// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepaymentPanel } from "@/components/pos/RepaymentPanel";

describe("repayment request recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  const props = { businessId: "b", customerId: "c", customerName: "Customer", basePath: "/pos", balanceKES: 100, entitled: true, words: { customer: "customer" } };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("8be29cab-150e-4a70-ae65-52ae5ca6ff4a");
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not discard or retry an old fractional pending request automatically", async () => {
    sessionStorage.setItem("pos-repayment:b:c", JSON.stringify({ key: "legacy-key", amountKES: 100.4, method: "cash", reference: "" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(RepaymentPanel, props)));
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("fractional amount");
    expect(sessionStorage.getItem("pos-repayment:b:c")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unlocks fields after a definite pre-write repayment refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code: "REPAYMENT_INVALID", error: "Invalid amount" }) }));
    await act(async () => root.render(createElement(RepaymentPanel, props)));
    await act(async () => { container.querySelector("button")!.click(); });
    expect(sessionStorage.getItem("pos-repayment:b:c")).toBeNull();
    expect((container.querySelector("#repay-amount") as HTMLInputElement).disabled).toBe(false);
    expect(container.textContent).toContain("Invalid amount");
  });

  it("keeps the same key and body after a network failure and a remount, even when the balance is now zero", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network disconnected"));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(RepaymentPanel, props)));
    await act(async () => { container.querySelector("button")!.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, first] = fetchMock.mock.calls[0];
    expect(first.headers["Idempotency-Key"]).toBe("8be29cab-150e-4a70-ae65-52ae5ca6ff4a");
    expect(JSON.parse(sessionStorage.getItem("pos-repayment:b:c")!)).toMatchObject({ key: first.headers["Idempotency-Key"], amountKES: 100 });
    expect((container.querySelector("#repay-amount") as HTMLInputElement).disabled).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(RepaymentPanel, { ...props, balanceKES: 0 })));
    expect(container.textContent).toContain("Retry");
    await act(async () => { container.querySelector("button")!.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [retryUrl, retry] = fetchMock.mock.calls[1];
    expect(retryUrl).toBe(url);
    expect(retry.headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
    expect(retry.body).toBe(first.body);
  });
});
