/**
 * Theme token definitions and runtime application.
 *
 *  1. TokenKey      — union of all overridable CSS custom properties
 *  2. TokenMap      — Record<TokenKey, string> (hex/rgb/hsl)
 *  3. cssVarMap     — maps TokenKey → "--css-variable-name"
 *  4. applyTheme()  — writes dark/light defaults to :root
 *  5. applyBrandShadeOverrides() — layers brand palette overrides
 */

export type AppTheme = "light" | "dark";

// ── Token keys ───────────────────────────────────────────────────────────────
export type TokenKey =
  | "bgBase" | "bgSurface" | "bgCard" | "bgNav"
  | "borderColor"
  | "textPrimary" | "textSecondary" | "textMuted"
  | "inputBg" | "inputBorder" | "inputText"
  | "glassBg" | "glassBorder"
  | "gradFrom" | "gradVia" | "gradTo"
  | "colorBrand" | "colorBrandHover" | "colorBrandBg"
  | "colorPass" | "colorFail" | "colorPend";   // ← ADD: status colors

export type TokenMap = Record<TokenKey, string>;

// ── CSS variable names ───────────────────────────────────────────────────────
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
  colorPass:       "--color-pass",    // ← ADD
  colorFail:       "--color-fail",    // ← ADD
  colorPend:       "--color-pend",    // ← ADD
};

// ── Brand shade helpers ──────────────────────────────────────────────────────
export type BrandShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export const BRAND_SHADES: BrandShade[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export const brandShadeVar = (shade: BrandShade) => `--brand-${shade}`;

// ── Default palette ──────────────────────────────────────────────────────────
export const palette = {
  brand: {
    50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd",
    400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8",
    800: "#1e40af", 900: "#1e3a8a",
  },
  pass: "#22c55e",
  fail: "#ef4444",
  pend: "#f59e0b",
} as const;

// ── Default tokens per mode ──────────────────────────────────────────────────
export const tokens: Record<AppTheme, TokenMap> = {
  dark: {
    bgBase:        "#030712",
    bgSurface:     "#111827",
    bgCard:        "#1f2937",
    bgNav:         "rgba(17,24,39,0.80)",
    borderColor:   "rgba(255,255,255,0.05)",
    textPrimary:   "#f9fafb",
    textSecondary: "#d1d5db",
    textMuted:     "#6b7280",
    inputBg:       "#1f2937",
    inputBorder:   "rgba(255,255,255,0.10)",
    inputText:     "#f3f4f6",
    glassBg:       "rgba(255,255,255,0.05)",
    glassBorder:   "rgba(255,255,255,0.10)",
    gradFrom:      "#1e1b4b",
    gradVia:       "#0f172a",
    gradTo:        "#1e3a5f",
    colorBrand:      palette.brand[500],
    colorBrandHover: palette.brand[400],
    colorBrandBg:    "rgba(59,130,246,0.15)",
    colorPass:       palette.pass,   // ← ADD
    colorFail:       palette.fail,   // ← ADD
    colorPend:       palette.pend,   // ← ADD
  },
  light: {
    bgBase:        "#f8fafc",
    bgSurface:     "#ffffff",
    bgCard:        "#f1f5f9",
    bgNav:         "rgba(255,255,255,0.85)",
    borderColor:   "rgba(0,0,0,0.06)",
    textPrimary:   "#0f172a",
    textSecondary: "#334155",
    textMuted:     "#64748b",
    inputBg:       "#ffffff",
    inputBorder:   "rgba(0,0,0,0.10)",
    inputText:     "#0f172a",
    glassBg:       "rgba(0,0,0,0.03)",
    glassBorder:   "rgba(0,0,0,0.06)",
    gradFrom:      "#e0e7ff",
    gradVia:       "#f0f9ff",
    gradTo:        "#e0f2fe",
    colorBrand:      palette.brand[600],
    colorBrandHover: palette.brand[500],
    colorBrandBg:    "rgba(37,99,235,0.10)",
    colorPass:       palette.pass,   // ← ADD
    colorFail:       palette.fail,   // ← ADD
    colorPend:       palette.pend,   // ← ADD
  },
};

// ── applyTheme() ─────────────────────────────────────────────────────────────
export function applyTheme(mode: AppTheme) {
  const root = document.documentElement;
  const map = tokens[mode];
  (Object.entries(cssVarMap) as [TokenKey, string][]).forEach(([key, varName]) => {
    root.style.setProperty(varName, map[key]);
  });
  // Also set neon vars from palette (used by keyframe animations)
  root.style.setProperty("--neon-cyan", "34, 211, 238");
  root.style.setProperty("--neon-amber", "245, 158, 11");
}

// ── applyBrandShadeOverrides() ───────────────────────────────────────────────
export function applyBrandShadeOverrides(
  overrides: Partial<Record<BrandShade, string>>
) {
  const root = document.documentElement;
  BRAND_SHADES.forEach((shade) => {
    const saved = overrides[shade];
    if (saved) {
      root.style.setProperty(brandShadeVar(shade), saved);
    }
  });
}