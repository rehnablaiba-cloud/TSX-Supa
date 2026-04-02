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
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §1  RAW PALETTE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const palette = {
  brand: {
    50:  "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
  },
  pass: "#22c55e",
  fail: "#ef4444",
  pend: "#f59e0b",
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
// §2  SEMANTIC TOKENS
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
// §3  CSS VAR MAP
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

// Brand shade helpers — lets tailwind.config.js and the ThemeEditor
// reference/set per-shade CSS vars so ALL brand-* classes are runtime-editable.
export const BRAND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type BrandShade = typeof BRAND_SHADES[number];
export const brandShadeVar = (shade: BrandShade): string => `--brand-${shade}`;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §4  CSS VAR INJECTOR
//     Now also sets --brand-{shade} vars so bg-brand-500 etc.
//     are live-editable at runtime.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function applyTheme(mode: "light" | "dark"): void {
  const root = document.documentElement;
  const t    = tokens[mode];

  // Semantic tokens
  (Object.entries(cssVarMap) as [TokenKey, string][]).forEach(([key, cssVar]) => {
    root.style.setProperty(cssVar, t[key]);
  });

  // Brand shade CSS vars — sets defaults; ThemeEditor overrides applied after.
  BRAND_SHADES.forEach(shade => {
    root.style.setProperty(brandShadeVar(shade), (palette.brand as Record<number, string>)[shade]);
  });

  if (mode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * Re-apply brand shade overrides from the ThemeEditor after applyTheme()
 * resets them to defaults. Call this in ThemeContext after applyTheme.
 */
export function applyBrandShadeOverrides(
  saved: Partial<Record<BrandShade, string>>
): void {
  const root = document.documentElement;
  BRAND_SHADES.forEach(shade => {
    const v = saved[shade];
    if (v) root.style.setProperty(brandShadeVar(shade), v);
  });
}

export const cssVar = (key: TokenKey): string => `var(${cssVarMap[key]})`;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §5  TAILWIND EXTEND CONFIG
//     Brand shades now reference CSS vars so they are runtime-editable.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const tailwindTheme = {
  colors: {
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
    pass:  palette.pass,
    fail:  palette.fail,
    pend:  palette.pend,
  },
} as const;
