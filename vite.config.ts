import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// AnyTub3 is loaded by the Polkadot host as a static `.dot` product bundle.
// Build output goes to ./build (bulletin-deploy publishes it).

/**
 * Inline the entry stylesheet into index.html. On Polkadot Web the product's
 * files are served by a service worker fed the Bulletin archive; a request that
 * reaches the page before the worker answers falls through to the host's nginx,
 * which returns its 404 page as text/html — for the `<link rel="stylesheet">`
 * that means an unstyled first paint. With the CSS inside the document there is
 * no request left to lose (the CSP already allows `style-src 'unsafe-inline'`).
 */
function inlineEntryCss(): Plugin {
  return {
    name: "anytub3:inline-entry-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset" || typeof html.source !== "string") return;
      let source = html.source;
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (asset.type !== "asset" || !fileName.endsWith(".css")) continue;
        const link = new RegExp(`<link[^>]*href="/${fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
        const match = link.exec(source);
        if (!match || !/rel="stylesheet"/.test(match[0])) continue;
        const css = String(asset.source).replace(/<\/style/gi, "<\\/style");
        source = source.replace(match[0], `<style>${css}</style>`);
        delete bundle[fileName];
      }
      html.source = source;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), inlineEntryCss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "build",
    emptyOutDir: true,
    sourcemap: true,
    // One stylesheet, inlined into index.html by inlineEntryCss — so lazy chunks
    // must never try to preload a CSS file: Vite's import helper would fetch
    // the (removed) entry stylesheet before the Player or the host bridge chunk
    // and fail with "Unable to preload CSS". Keep every style in that single
    // file and drop CSS from the preload dependency lists.
    cssCodeSplit: false,
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((dep) => !dep.endsWith(".css")),
    },
    // WebOS TVs run older Chromium (webOS 6/2021 ≈ Chrome 79). Vite's default
    // target emits ES2022+ syntax that hard-fails there (white screen), so
    // transpile down. NOTE: this covers JS only — Tailwind v4's generated CSS
    // (color-mix, @property) officially targets Chrome 111+; expect minor
    // styling degradation on older TVs, validate on device.
    target: "chrome79",
    // The heaviest chunks are legitimate and already lazy: hls.js (~530 kB) is
    // split into the Player chunk (loaded only when a channel is tuned), and the
    // polkadot-api chain metadata (~850 kB each) is dynamically imported by the
    // real host bridge — never on the standalone/first-paint path. Raise the
    // advisory limit above those so the warning only fires on a real regression.
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
  },
});
