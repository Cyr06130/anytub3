import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// AnyTub3 is loaded by the Polkadot host as a static `.dot` product bundle.
// Build output goes to ./build (see design doc 3 — `dot deploy` pushes ./build).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "build",
    emptyOutDir: true,
    sourcemap: true,
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
