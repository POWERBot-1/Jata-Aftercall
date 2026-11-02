// Measures the RENDERED focus ring against the RENDERED surface, from PNG pixels.
// Ring sample: 3px outside the button's border box (outline-offset 2px + 2px ring).
// Surface sample: 8px outside the box (away from the ring), with the button hidden.
// Fill sample: 6px inside the box on the left edge (button fill, away from text and corners).
import { PNG } from "pngjs";

const toLin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
export const lum = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
export const contrast = (a, b) => {
  const L1 = lum(a), L2 = lum(b);
  return Number(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2));
};

function px(png, x, y) {
  const i = (png.width * y + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

const M = 16; // margin around the button in the capture
export async function measureFocusRing(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await locator.boundingBox();
  // Viewport-relative clip (no fullPage: a full-page capture resizes the viewport and moves layout).
  const clip = { x: Math.max(0, box.x - M), y: Math.max(0, box.y - M), width: box.width + 2 * M, height: box.height + 2 * M };
  const h = Math.round(box.height), w = Math.round(box.width);
  const midY = M + Math.round(h / 2), midX = M + Math.round(w / 2);
  const shotBuf = async () => page.screenshot({ clip, caret: "initial" });
  const focusedBuf = await shotBuf();
  const focused = PNG.sync.read(focusedBuf);
  // Surface reading: hide EVERY button in the clip so neighbouring controls are not sampled as "surface".
  await page.evaluate(() => document.querySelectorAll("button").forEach((b) => (b.dataset.probeVis = b.style.visibility || "", b.style.visibility = "hidden")));
  const bareBuf = await shotBuf();
  const bare = PNG.sync.read(bareBuf);
  await page.evaluate(() => document.querySelectorAll("button").forEach((b) => { b.style.visibility = b.dataset.probeVis || ""; delete b.dataset.probeVis; }));

  // The ring is 2px wide at a 2px offset, but sub-pixel layout can move it by one column/row.
  // Ring = most contrasting pixel in the 2-4px band outside the border box; surface = 8px outside.
  const pick = (ringPts, surfacePt) => {
    const surface = px(bare, ...surfacePt);
    let best = null;
    for (const pt of ringPts) {
      const c = px(focused, ...pt);
      const r = contrast(c, surface);
      if (!best || r > best.ratio) best = { ringRGB: c, ratio: r };
    }
    return { ringRGB: best.ringRGB, surfaceRGB: surface, ratio: best.ratio, changed: best.ringRGB.some((v, i) => v !== surface[i]) };
  };
  const band = (fixed, from, to) => [];
  const perSide = {
    left: pick([2, 3, 4].map((d) => [M - d, midY]), [M - 8, midY]),
    right: pick([2, 3, 4].map((d) => [M + w - 1 + d, midY]), [M + w + 8, midY]),
    top: pick([2, 3, 4].map((d) => [midX, M - d]), [midX, M - 8]),
    bottom: pick([2, 3, 4].map((d) => [midX, M + h - 1 + d]), [midX, M + h + 8]),
  };
  const worst = Object.values(perSide).reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const fill = px(focused, M + 6, midY);
  return {
    box: { x: Math.round(box.x), y: Math.round(box.y), w, h },
    viewportWidth: null,
    perSide,
    worstSide: worst,
    ringRGB: worst.ringRGB,
    surfaceRGB: worst.surfaceRGB,
    fillRGB: fill,
    ringVsSurface: worst.ratio,
    ringVsFill: contrast(worst.ringRGB, fill),
    ringDiffersFromSurface: Object.values(perSide).every((x) => x.changed),
    focusedPng: focusedBuf,
    barePng: bareBuf,
  };
}
