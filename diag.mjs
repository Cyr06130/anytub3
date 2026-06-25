import { chromium } from "@playwright/test";
const BASE = "http://localhost:4173";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1100, height: 820 } });
const p = await ctx.newPage();
// Simulate Polkadot Desktop: real Fullscreen API blocked.
await p.addInitScript(() => {
  Element.prototype.requestFullscreen = () => Promise.reject(new Error("blocked"));
  // @ts-ignore
  Element.prototype.webkitRequestFullscreen = undefined;
  // @ts-ignore
  HTMLVideoElement.prototype.webkitEnterFullscreen = undefined;
});
await p.goto(BASE);
await p.getByRole("button", { name: "Add a playlist" }).click();
await p.getByRole("button", { name: "Load the sample" }).click();
await p.getByText(/Playlist saved/).waitFor();
await p.getByText("Tears of Steel").first().click();
await p.locator("video").waitFor();

// 1) Any ancestor of <video> that establishes a containing block for position:fixed?
const blockers = await p.evaluate(() => {
  const out = [];
  let el = document.querySelector("video")?.parentElement;
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    if (s.transform !== "none" || s.filter !== "none" || s.perspective !== "none" ||
        (s.contain && /paint|layout|strict|content/.test(s.contain)) || (s.willChange && s.willChange !== "auto")) {
      out.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 60), transform: s.transform, filter: s.filter, contain: s.contain, willChange: s.willChange });
    }
    el = el.parentElement;
  }
  return out;
});
console.log("CONTAINING-BLOCK ANCESTORS:", JSON.stringify(blockers, null, 2));

// 2) Click the fullscreen button → should fall back to CSS-fill. Does it fill the viewport?
await p.getByRole("button", { name: "Fullscreen" }).click();
await p.waitForTimeout(400);
const fill = await p.evaluate(() => {
  const c = document.querySelector("video")?.parentElement;
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const s = getComputedStyle(c);
  return { position: s.position, zIndex: s.zIndex, rectW: Math.round(r.width), rectH: Math.round(r.height), vw: innerWidth, vh: innerHeight, fillsViewport: Math.round(r.width) >= innerWidth - 2 && Math.round(r.height) >= innerHeight - 2 };
});
console.log("CSS-FILL RESULT:", JSON.stringify(fill, null, 2));

await b.close();
