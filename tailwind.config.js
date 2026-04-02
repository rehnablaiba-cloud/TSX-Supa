/**
 * tailwind.config.js
 *
 * ⚠️  Do NOT add colours directly here.
 *     Edit src/theme.ts instead — this file only wires Tailwind up.
 *
 * Semantic colours (bg-base, t-primary, c-brand …) reference CSS vars.
 * Brand shades (brand-50 … brand-900) also reference CSS vars so the
 * ThemeEditor can change them at runtime without a rebuild.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Semantic — resolved at runtime from CSS vars ──────────────
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
        // ── Brand shades — runtime-editable via CSS vars ──────────────
        // applyTheme() sets --brand-50…900 defaults; ThemeEditor can
        // override them. bg-brand-500 now compiles to var(--brand-500).
        brand: {
          50:  "var(--brand-50)",
          100: "var(--brand-100)",
          200: "var(--brand-200)",
          300: "var(--brand-300)",
          400: "var(--brand-400)",
          500: "var(--brand-500)",
          600: "var(--brand-600)",
          700: "var(--brand-700)",
          800: "var(--brand-800)",
          900: "var(--brand-900)",
        },
        // ── Static status colours — same in both modes ────────────────
        pass:  "#22c55e",
        fail:  "#ef4444",
        pend:  "#f59e0b",
      },
    },
  },
  plugins: [],
};
