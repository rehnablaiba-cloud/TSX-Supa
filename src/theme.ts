/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║           TESTPRO  ·  UNIFIED THEME SYSTEM                        ║
 * ║   src/theme.ts  —  THE single source of truth for all styling     ║
 * ╠═══════════════════════════════════════════════════════════════════╣
 * ║  ✏️  Change brand colour  →  edit `palette.brand` in §1           ║
 * ║  🎨  Swap colour scheme   →  edit `tokens.light / dark` in §2     ║
 * ║  🔧  Switch to MUI        →  uncomment §6, install @mui/material  ║
 * ║  🎬  GSAP colours         →  uncomment §7                         ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * HOW IT WORKS
 * ┌─────────────┐   applyTheme()   ┌──────────────────┐
 * │  palette    │ ──────────────▶  │ CSS custom props  │
 * │  tokens     │                  │ (--bg-base etc.)  │
 * └─────────────┘                  └────────┬─────────┘
 *        │                                  │
 *        │  tailwindTheme (§5)              │  consumed by
 *        ▼                                  ▼
 * tailwind.config.js               Tailwind utilities &
 * (var() references)               raw CSS classes
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §1  RAW PALETTE  — the only place raw hex values live
//     Edit here → every token, utility class & library updates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const palette = {

  // ✏️  Change this entire block to rebrand the whole app instantly
  brand: {
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
  },

  /** Status colours — used for pass/fail/pending badges & charts */
  pass: "#22c55e",
  fail: "#ef4444",
  pend: "#f59e0b",

  /** Neutral scale — Tailwind slate */
  gray: {
    50:  "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
    950: "#030712",
  },

} as const;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §2  SEMANTIC TOKENS  — map palette values to intent
//     Each key becomes a CSS custom property (see §3 & §4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type TokenKey =
  | "bgBase" | "bgSurface" | "bgCard" | "bgNav"
  | "borderColor"
  | "textPrimary" | "textSecondary" | "textMuted"
  | "inputBg" | "inputBorder" | "inputText"
  | "glassBg" | "glassBorder"
  | "gradFrom" | "gradVia" | "gradTo"
  | "colorBrand" | "colorBrandHover" | "colorBrandBg";

export type TokenMap = Record<TokenKey, string>;

export const tokens: Record<"light" | "dark", TokenMap> = {

  // ─── Light mode ───────────────────────────────────────
  light: {
    bgBase:          palette.gray[100],
    bgSurface:       "#ffffff",
    bgCard:          palette.gray[50],
    bgNav:           "#ffffff",
    borderColor:     "rgba(0,0,0,0.08)",

    textPrimary:     palette.gray[900],
    textSecondary:   palette.gray[600],
    textMuted:       palette.gray[400],

    inputBg:         palette.gray[100],
    inputBorder:     "rgba(0,0,0,0.12)",
    inputText:       palette.gray[900],

    glassBg:         "rgba(255,255,255,0.70)",
    glassBorder:     "rgba(0,0,0,0.08)",

    gradFrom:        "#e0e7ff",
    gradVia:         palette.gray[100],
    gradTo:          palette.brand[100],

    colorBrand:      palette.brand[600],
    colorBrandHover: palette.brand[700],
    colorBrandBg:    palette.brand[50],
  },

  // ─── Dark mode ────────────────────────────────────────
  dark: {
    bgBase:          palette.gray[950],
    bgSurface:       "#111827",
    bgCard:          "#1f2937",
    bgNav:           "rgba(17,24,39,0.80)",
    borderColor:     "rgba(255,255,255,0.05)",

    textPrimary:     "#f9fafb",
    textSecondary:   "#d1d5db",
    textMuted:       "#6b7280",

    inputBg:         "#1f2937",
    inputBorder:     "rgba(255,255,255,0.10)",
    inputText:       "#f3f4f6",

    glassBg:         "rgba(255,255,255,0.05)",
    glassBorder:     "rgba(255,255,255,0.10)",

    gradFrom:        "#1e1b4b",
    gradVia:         palette.gray[900],
    gradTo:          "#1e3a5f",

    colorBrand:      palette.brand[500],
    colorBrandHover: palette.brand[400],
    colorBrandBg:    "rgba(59,130,246,0.15)",
  },

};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §3  CSS VAR MAP  — token key → CSS custom property name
//     Change a name here to rename it everywhere.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const cssVarMap: Record<TokenKey, string> = {
  bgBase:          "--bg-base",
  bgSurface:       "--bg-surface",
  bgCard:          "--bg-card",
  bgNav:           "--bg-nav",
  borderColor:     "--border-color",
  textPrimary:     "--text-primary",
  textSecondary:   "--text-secondary",
  textMuted:       "--text-muted",
  inputBg:         "--input-bg",
  inputBorder:     "--input-border",
  inputText:       "--input-text",
  glassBg:         "--glass-bg",
  glassBorder:     "--glass-border",
  gradFrom:        "--grad-from",
  gradVia:         "--grad-via",
  gradTo:          "--grad-to",
  colorBrand:      "--color-brand",
  colorBrandHover: "--color-brand-hover",
  colorBrandBg:    "--color-brand-bg",
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §4  CSS VAR INJECTOR  — called by ThemeContext on every mode change
//     Sets all CSS custom props AND toggles the Tailwind dark class.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function applyTheme(mode: "light" | "dark"): void {
  const root = document.documentElement;
  const t    = tokens[mode];

  (Object.entries(cssVarMap) as [TokenKey, string][]).forEach(([key, cssVar]) => {
    root.style.setProperty(cssVar, t[key]);
  });

  if (mode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * Read the current value of any token as a CSS var string.
 * Useful for inline styles: style={{ color: cssVar("colorBrand") }}
 */
export const cssVar = (key: TokenKey): string => `var(${cssVarMap[key]})`;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §5  TAILWIND EXTEND CONFIG
//     Imported by tailwind.config.js — do not edit that file directly.
//     Semantic colors reference CSS vars so they update with the theme.
//     Static colors (brand shades, status) are inlined for JIT.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const tailwindTheme = {
  colors: {
    // ── Semantic (resolved at runtime from CSS vars) ──────
    "bg-base":      "var(--bg-base)",
    "bg-surface":   "var(--bg-surface)",
    "bg-card":      "var(--bg-card)",
    "bg-nav":       "var(--bg-nav)",
    "t-primary":    "var(--text-primary)",
    "t-secondary":  "var(--text-secondary)",
    "t-muted":      "var(--text-muted)",
    "c-brand":      "var(--color-brand)",
    "c-brand-hover":"var(--color-brand-hover)",
    "c-brand-bg":   "var(--color-brand-bg)",
    // ── Static (same value in both modes — safe to inline) ─
    brand: palette.brand,
    pass:  palette.pass,
    fail:  palette.fail,
    pend:  palette.pend,
  },
} as const;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §6  MUI THEME FACTORY  (Tailwind → MUI migration path)
//
//  1. npm install @mui/material @emotion/react @emotion/styled
//  2. Uncomment the block below
//  3. In App.tsx: wrap with <ThemeProvider theme={createMuiTheme(theme)}>
//  4. Components can now use MUI sx prop AND CSS vars simultaneously
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// import { createTheme as createMuiThemeBase } from "@mui/material/styles";
//
// export function createMuiTheme(mode: "light" | "dark") {
//   const t = tokens[mode];
//   return createMuiThemeBase({
//     palette: {
//       mode,
//       primary:    { main: t.colorBrand, light: palette.brand[400], dark: palette.brand[800] },
//       error:      { main: palette.fail },
//       warning:    { main: palette.pend },
//       success:    { main: palette.pass },
//       background: { default: t.bgBase, paper: t.bgSurface },
//       text:       { primary: t.textPrimary, secondary: t.textSecondary },
//       divider:    t.borderColor,
//     },
//     shape: { borderRadius: 12 },
//     typography: {
//       fontFamily: "Inter, system-ui, sans-serif",
//       button: { textTransform: "none", fontWeight: 600 },
//     },
//     components: {
//       MuiButton:    { styleOverrides: { root: { borderRadius: 12 } } },
//       MuiTextField: { styleOverrides: { root: { "& .MuiOutlinedInput-root": { borderRadius: 12 } } } },
//       MuiPaper:     { styleOverrides: { root: { backgroundImage: "none" } } },
//     },
//   });
// }


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §7  GSAP COLOUR HELPERS  (animations that respect the theme)
//
//  Usage example:
//    gsap.to(el, { backgroundColor: gsapColors.brand() });
//    gsap.to(el, { color: gsapColors.pass });
//
//  gsapColors.brand() is a getter — it reads the current CSS var
//  so it always returns the right value for the active mode.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// export const gsapColors = {
//   /** Live getter — resolves to the active mode's brand colour */
//   brand:      () => getComputedStyle(document.documentElement)
//                       .getPropertyValue(cssVarMap.colorBrand).trim(),
//   brandHover: () => getComputedStyle(document.documentElement)
//                       .getPropertyValue(cssVarMap.colorBrandHover).trim(),
//   /** Static status colours (same in both modes) */
//   pass: palette.pass,
//   fail: palette.fail,
//   pend: palette.pend,
// } as const;
