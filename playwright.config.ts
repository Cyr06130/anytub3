import { defineConfig, devices } from "@playwright/test";

// e2e runs against the built bundle in standalone (mock) mode — exercising the
// real app code (parser, keys, crypto, bulletin, sync, share) without a host.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    // e2e runs against the PRODUCTION bundle — always rebuild it first, or the
    // suite silently validates stale code. (With reuseExistingServer, a preview
    // server left running skips this command: rebuilds are still picked up from
    // disk, but only if you rebuild yourself.)
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    timeout: 120_000,
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
