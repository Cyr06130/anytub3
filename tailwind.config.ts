import spektrPreset from "@novasamatech/tr-ui/tailwind.preset";
import type { Config } from "tailwindcss";

// TrUI ships the full semantic token palette via its preset + styles.css.
// We extend the content globs so TrUI's own utility classes aren't purged,
// and so our markup can use the same tokens (bg-bg-*, text-fg-*, border-border-*).
export default {
  presets: [spektrPreset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/@novasamatech/tr-ui/dist/**/*.{js,mjs}",
  ],
} satisfies Config;
