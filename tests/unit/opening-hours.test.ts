import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDayLabel, formatOpeningHours } from "@/lib/openingHours";
import BusinessPage from "@/components/BusinessPage";
import { THEMES } from "@/lib/themes";

// Regression: the public page printed JSON.stringify(JSON.parse(openingHours)), so customers saw
// raw JSON such as {"mon_sat":"8am - 7pm"}. Customers must only ever see readable rows.

const RAW_JSON = /[{}\[\]"]/;

describe("formatOpeningHours", () => {
  it("formats the stored object shape (as written by the business API) into readable rows", () => {
    const stored = JSON.stringify({ mon_sat: "8am - 7pm", sun: "10am - 4pm" });
    expect(formatOpeningHours(stored)).toEqual([{ label: "Mon–Sat", value: "8am - 7pm" }, { label: "Sun", value: "10am - 4pm" }]);
  });

  it("handles strings, arrays, open/close objects, closed days and plain text", () => {
    expect(formatOpeningHours(JSON.stringify("Mon–Fri 8am–6pm"))).toEqual([{ label: "", value: "Mon–Fri 8am–6pm" }]);
    expect(formatOpeningHours("Daily 7am to 9pm")).toEqual([{ label: "", value: "Daily 7am to 9pm" }]);
    expect(formatOpeningHours(JSON.stringify([{ day: "monday", open: "8:00", close: "17:00" }, { day: "sunday", closed: true }]))).toEqual([
      { label: "Mon", value: "8:00 – 17:00" },
      { label: "Sun", value: "Closed" },
    ]);
    expect(formatOpeningHours(JSON.stringify({ saturday: { open: "9am", close: "1pm" }, sunday: null }))).toEqual([
      { label: "Sat", value: "9am – 1pm" },
      { label: "Sun", value: "Closed" },
    ]);
  });

  it("never returns JSON for unknown, nested, broken or empty values", () => {
    for (const raw of [null, undefined, "", "   ", "{not json", "[1,", JSON.stringify({ mon: { weird: { deep: 1 } } }), JSON.stringify([[1, 2]]), JSON.stringify({})]) {
      for (const row of formatOpeningHours(raw as string)) {
        expect(row.value).not.toMatch(RAW_JSON);
        expect(row.label).not.toMatch(RAW_JSON);
      }
    }
    expect(formatOpeningHours("{not json")).toEqual([]);
  });

  it("decodes the HTML escaping applied by sanitizeText instead of showing entities", () => {
    expect(formatOpeningHours(JSON.stringify({ weekdays: "&lt;8am&gt; - 5pm" }))[0]).toEqual({ label: "Weekdays", value: "<8am> - 5pm" });
  });

  it("formats day keys and ranges", () => {
    expect(formatDayLabel("mon_fri")).toBe("Mon–Fri");
    expect(formatDayLabel("Saturday")).toBe("Sat");
    expect(formatDayLabel("public_holidays")).toBe("Public holidays");
  });
});

function renderPage(business: Record<string, unknown>, theme = THEMES.clean) {
  return renderToStaticMarkup(createElement(BusinessPage, {
    business: { id: "b1", slug: "mary", name: "Mary's Beauty Studio", category: "Beauty", theme: theme.key, ...business } as any,
    services: [],
    offer: null,
    theme,
  }));
}

describe("public BusinessPage rendering", () => {
  it("shows opening hours as readable rows, never raw JSON", () => {
    const html = renderPage({ phone: "0712345678", whatsapp: "0712345678", openingHours: JSON.stringify({ mon_sat: "8am - 7pm", sun: "10am - 4pm" }) });
    expect(html).toContain("OPENING HOURS");
    expect(html).toContain("Mon–Sat");
    expect(html).toContain("8am - 7pm");
    expect(html).not.toContain("mon_sat");
    expect(html).not.toContain("{&quot;");
  });

  it.each(["clean", "dark", "warm"] as const)("%s theme: no fake disabled Call/WhatsApp/Directions controls when details are missing", (key) => {
    const html = renderPage({ phone: null, whatsapp: "0712345678", location: null }, THEMES[key]);
    expect(html).not.toContain("opacity-50");
    expect(html).not.toMatch(/<span[^>]*>Call<\/span>/);
    expect(html).not.toMatch(/<span[^>]*>Directions<\/span>/);
    expect(html).toMatch(/<a[^>]*>WhatsApp<\/a>/);
  });

  it("explains missing contact details instead of rendering dead buttons", () => {
    const html = renderPage({ phone: null, whatsapp: null });
    expect(html).toContain("Contact details for this business are coming soon.");
    expect(html).not.toMatch(/>WhatsApp</);
  });

  it("uses the AA-compliant WhatsApp colour (emerald-700) instead of emerald-500", () => {
    const html = renderPage({ phone: "0712345678", whatsapp: "0712345678" });
    expect(html).toContain("bg-emerald-700");
    expect(html).not.toContain("bg-emerald-500");
  });
});
