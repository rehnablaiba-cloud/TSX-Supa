/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Semantic — resolved at runtime from CSS vars ──────────────
        "bg-base": "var(--bg-base)",
        "bg-surface": "var(--bg-surface)",
        "bg-card": "var(--bg-card)",
        "bg-nav": "var(--bg-nav)",
        "t-primary": "var(--text-primary)",
        "t-secondary": "var(--text-secondary)",
        "t-muted": "var(--text-muted)",
        "c-brand": "var(--color-brand)",
        "c-brand-hover": "var(--color-brand-hover)",
        "c-brand-bg": "var(--color-brand-bg)",
        // ── Brand shades — runtime-editable via CSS vars ──────────────
        // applyTheme() sets --brand-50…900 defaults; ThemeEditor can
        // override them. bg-brand-500 now compiles to var(--brand-500).
        brand: {
          50: "var(--brand-50)",
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
        // ── Status colours — runtime via CSS vars with static fallbacks ─
        // ThemeEditor can override these by writing to --color-pass etc.
        pass: "var(--color-pass, #22c55e)",
        fail: "var(--color-fail, #ef4444)",
        pend: "var(--color-pend, #f59e0b)",
        // ── Divider colours — runtime via CSS vars (TestExecution) ───
        "divider-1": "var(--color-divider-1, #14b8a6)",
        "divider-2": "var(--color-divider-2, #f59e0b)",
        "divider-3": "var(--color-divider-3, #0ea5e9)",
        // ── Log colours — runtime via CSS vars (DevTools/SessionLog) ───
        "log-auth-bg": "var(--log-auth-bg, rgba(59,130,246,0.15))",
        "log-auth-text": "var(--log-auth-text, #3b82f6)",
        "log-info": "var(--log-level-info, #3b82f6)",
        "log-warn": "var(--log-level-warn, #f59e0b)",
        "log-error": "var(--log-level-error, #ef4444)",
      },
    },
  },
  plugins: [],
};
