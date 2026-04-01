/**
 * tailwind.config.js
 *
 * ⚠️  Do NOT add colours directly here.
 *     Edit src/theme.ts instead — this file only wires Tailwind up.
 *
 * Semantic colours (bg-base, t-primary, c-brand …) reference CSS vars.
 * Those vars are set at runtime by applyTheme() in src/theme.ts,
 * so swapping a colour in theme.ts propagates everywhere automatically.
 */

// Static palette values mirrored for Tailwind JIT (must be plain JS at build time).
// ⚠️  Keep in sync with palette.brand / pass / fail / pend in src/theme.ts
const brand = {
  50:  "#eff6ff",
  100: "#dbeafe",
  200: "#bfdbfe",
  300: "#93c5fd",
  400: "#60a5fa",
  500: "#3b82f6",   // ← primary accent (dark mode)
  600: "#2563eb",   // ← primary accent (light mode / buttons)
  700: "#1d4ed8",
  800: "#1e40af",
  900: "#1e3a8a",
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Semantic — resolved at runtime from CSS vars ──────────────
        // Use these as Tailwind classes: bg-bg-surface, text-t-primary, etc.
        "bg-base":       "var(--bg-base)",
        "bg-surface":    "var(--bg-surface)",
        "bg-card":       "var(--bg-card)",
        "bg-nav":        "var(--bg-nav)",
        "t-primary":     "var(--text-primary)",
        "t-secondary":   "var(--text-secondary)",
        "t-muted":       "var(--text-muted)",
        "c-brand":       "var(--color-brand)",
        "c-brand-hover": "var(--color-brand-hover)",
        "c-brand-bg":    "var(--color-brand-bg)",
        // ── Static — same in both modes, safe to inline ───────────────
        brand,                // brand-50 … brand-900
        pass:  "#22c55e",
        fail:  "#ef4444",
        pend:  "#f59e0b",
      },
    },
  },
  plugins: [],
};
