// src/theme.ts
/**
 * Theme token definitions and runtime application.
 *
 * 1. TokenKey      — union of all overridable CSS custom properties
 * 2. TokenMap      — Record<TokenKey, string> (hex/rgb/hsl)
 * 3. cssVarMap     — maps TokenKey -> "--css-variable-name"
 * 4. applyTheme()  — writes dark/light defaults to :root
 * 5. applyBrandShadeOverrides() — layers brand palette overrides
 * 6. applyStoredTheme() — unified application for ThemeContext + ThemeEditor
 */

export type AppTheme = "light" | "dark";

// ── Token keys ───────────────────────────────────────────────────────────────
export type TokenKey =
  | "bgBase"
  | "bgSurface"
  | "bgCard"
  | "bgNav"
  | "borderColor"
  | "textPrimary"
  | "textSecondary"
  | "textMuted"
  | "inputBg"
  | "inputBorder"
  | "inputText"
  | "glassBg"
  | "glassBorder"
  | "gradFrom"
  | "gradVia"
  | "gradTo"
  | "colorBrand"
  | "colorBrandHover"
  | "colorBrandBg"
  | "colorPass"
  | "colorFail"
  | "colorPend"
  | "colorWarn";

export type TokenMap = Record<TokenKey, string>;

// ── CSS variable names ───────────────────────────────────────────────────────
export const cssVarMap: Record<TokenKey, string> = {
  bgBase: "--bg-base",
  bgSurface: "--bg-surface",
  bgCard: "--bg-card",
  bgNav: "--bg-nav",
  borderColor: "--border-color",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textMuted: "--text-muted",
  inputBg: "--input-bg",
  inputBorder: "--input-border",
  inputText: "--input-text",
  glassBg: "--glass-bg",
  glassBorder: "--glass-border",
  gradFrom: "--grad-from",
  gradVia: "--grad-via",
  gradTo: "--grad-to",
  colorBrand: "--color-brand",
  colorBrandHover: "--color-brand-hover",
  colorBrandBg: "--color-brand-bg",
  colorPass: "--color-pass",
  colorFail: "--color-fail",
  colorPend: "--color-pend",
  colorWarn: "--color-warn",
};

// ── Brand shade helpers ──────────────────────────────────────────────────────
export type BrandShade =
  | 50
  | 100
  | 200
  | 300
  | 400
  | 500
  | 600
  | 700
  | 800
  | 900;

export const BRAND_SHADES: BrandShade[] = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900,
];

export const brandShadeVar = (shade: BrandShade) => `--brand-${shade}`;

// ── Default palette ──────────────────────────────────────────────────────────
export const palette = {
  brand: {
    50: "#eff6ff",
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
  warn: "#f59e0b",
} as const;

// ── Default tokens per mode ──────────────────────────────────────────────────
export const tokens: Record<AppTheme, TokenMap> = {
  dark: {
    bgBase: "#030712",
    bgSurface: "#111827",
    bgCard: "#1f2937",
    bgNav: "rgba(17,24,39,0.80)",
    borderColor: "rgba(255,255,255,0.05)",
    textPrimary: "#f9fafb",
    textSecondary: "#d1d5db",
    textMuted: "#6b7280",
    inputBg: "#1f2937",
    inputBorder: "rgba(255,255,255,0.10)",
    inputText: "#f3f4f6",
    glassBg: "rgba(255,255,255,0.05)",
    glassBorder: "rgba(255,255,255,0.10)",
    gradFrom: "#1e1b4b",
    gradVia: "#0f172a",
    gradTo: "#1e3a5f",
    colorBrand: palette.brand[500],
    colorBrandHover: palette.brand[400],
    colorBrandBg: "rgba(59,130,246,0.15)",
    colorPass: palette.pass,
    colorFail: palette.fail,
    colorPend: palette.pend,
    colorWarn: palette.warn,
  },
  light: {
    bgBase: "#f8fafc",
    bgSurface: "#ffffff",
    bgCard: "#f1f5f9",
    bgNav: "rgba(255,255,255,0.85)",
    borderColor: "rgba(0,0,0,0.06)",
    textPrimary: "#0f172a",
    textSecondary: "#334155",
    textMuted: "#64748b",
    inputBg: "#ffffff",
    inputBorder: "rgba(0,0,0,0.10)",
    inputText: "#0f172a",
    glassBg: "rgba(0,0,0,0.03)",
    glassBorder: "rgba(0,0,0,0.06)",
    gradFrom: "#e0e7ff",
    gradVia: "#f0f9ff",
    gradTo: "#e0f2fe",
    colorBrand: palette.brand[600],
    colorBrandHover: palette.brand[500],
    colorBrandBg: "rgba(37,99,235,0.10)",
    colorPass: palette.pass,
    colorFail: palette.fail,
    colorPend: palette.pend,
    colorWarn: palette.warn,
  },
};

export const defaultTokens = tokens;

// ── Glass config ─────────────────────────────────────────────────────────────
export interface GlassConfig {
  blur: number;
  saturation: number;
  brightness: number;
  bgOpacity: number;
  borderOpacity: number;
  navBgOpacity: number;
  popupBgOpacity: number;
  cardBgOpacity: number;
  cardBorderOpacity: number;
  backdropDimOpacity: number;
}

export const GLASS_DEFAULTS: GlassConfig = {
  blur: 28,
  saturation: 180,
  brightness: 106,
  bgOpacity: 40,
  borderOpacity: 55,
  navBgOpacity: 75,
  popupBgOpacity: 72,
  cardBgOpacity: 86,
  cardBorderOpacity: 80,
  backdropDimOpacity: 55,
};

// ── localStorage keys ────────────────────────────────────────────────────────
const LS_MODE = "themeMode";
const LS_MODE_LEGACY = "theme";
const LS_BRAND = "themeEditorBrandPalette";
const LS_STATUS = "themeEditorStatusColors";
const LS_BASE = "themeEditorBaseColor";
const LS_GLASS = "themeEditorGlass";
const LS_OVERRIDES = "themeEditorOverrides";

// ── helpers ──────────────────────────────────────────────────────────────────
function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function normalizeGlassConfig(
  glass?: Partial<GlassConfig> | null
): GlassConfig {
  return {
    ...GLASS_DEFAULTS,
    ...(glass ?? {}),
  };
}

function hasKeys(value?: object | null): boolean {
  return !!value && Object.keys(value).length > 0;
}

function hasOverrides(
  overrides?: Record<AppTheme, Partial<TokenMap>>
): boolean {
  if (!overrides) return false;
  return (
    Object.keys(overrides.light ?? {}).length > 0 ||
    Object.keys(overrides.dark ?? {}).length > 0
  );
}

function setOrRemove(key: string, value?: string) {
  if (value === undefined) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

// ── applyTheme() ─────────────────────────────────────────────────────────────
export function applyTheme(mode: AppTheme) {
  const root = document.documentElement;
  const map = tokens[mode];

  (Object.entries(cssVarMap) as [TokenKey, string][]).forEach(
    ([key, varName]) => {
      root.style.setProperty(varName, map[key]);
    }
  );

  BRAND_SHADES.forEach((shade) => {
    root.style.setProperty(brandShadeVar(shade), palette.brand[shade]);
  });

  root.style.setProperty("--neon-cyan", "34, 211, 238");
  root.style.setProperty("--neon-amber", "245, 158, 11");
}

// ── applyBrandShadeOverrides() ───────────────────────────────────────────────
export function applyBrandShadeOverrides(
  overrides: Partial<Record<BrandShade, string>>
) {
  const root = document.documentElement;
  BRAND_SHADES.forEach((shade) => {
    const value = overrides[shade];
    if (value) {
      root.style.setProperty(brandShadeVar(shade), value);
    }
  });
}

// ── applyGlassCssVars() ──────────────────────────────────────────────────────
export function applyGlassCssVars(glass?: Partial<GlassConfig>) {
  const g = normalizeGlassConfig(glass);
  const s = document.documentElement.style;

  s.setProperty("--glass-blur", `${g.blur}px`);
  s.setProperty("--glass-saturation", `${g.saturation}%`);
  s.setProperty("--glass-brightness", `${(g.brightness / 100).toFixed(2)}`);
  s.setProperty("--glass-bg-opacity", `${g.bgOpacity}%`);
  s.setProperty("--glass-border-opacity", `${g.borderOpacity}%`);

  s.setProperty("--glass-nav-bg-opacity", `${g.navBgOpacity}%`);
  s.setProperty("--glass-popup-bg-opacity", `${g.popupBgOpacity}%`);
  s.setProperty("--glass-card-bg-opacity", `${g.cardBgOpacity}%`);
  s.setProperty("--glass-card-border-opacity", `${g.cardBorderOpacity}%`);
  s.setProperty("--backdrop-dim-opacity", `${g.backdropDimOpacity}%`);
}

// ── Stored theme model ───────────────────────────────────────────────────────
export interface StoredTheme {
  mode: AppTheme;
  brandPalette?: Partial<Record<BrandShade, string>>;
  statusColors?: Record<string, string>;
  glass?: Partial<GlassConfig>;
  overrides?: Record<AppTheme, Partial<TokenMap>>;
}

// ── loadStoredTheme() ────────────────────────────────────────────────────────
export function loadStoredTheme(): StoredTheme | null {
  try {
    const rawMode =
      localStorage.getItem(LS_MODE) || localStorage.getItem(LS_MODE_LEGACY);
    const mode: AppTheme = rawMode === "dark" ? "dark" : "light";

    const brandPalette = safeParse<Partial<Record<BrandShade, string>>>(
      localStorage.getItem(LS_BRAND)
    );

    const statusColors = safeParse<Record<string, string>>(
      localStorage.getItem(LS_STATUS)
    );

    const glass = normalizeGlassConfig(
      safeParse<Partial<GlassConfig>>(localStorage.getItem(LS_GLASS))
    );

    const overrides = safeParse<Record<AppTheme, Partial<TokenMap>>>(
      localStorage.getItem(LS_OVERRIDES)
    );

    return {
      mode,
      brandPalette,
      statusColors,
      glass,
      overrides,
    };
  } catch {
    return null;
  }
}

// ── saveStoredTheme() ────────────────────────────────────────────────────────
export function saveStoredTheme(theme: StoredTheme): void {
  localStorage.setItem(LS_MODE, theme.mode);
  localStorage.setItem(LS_MODE_LEGACY, theme.mode);

  setOrRemove(
    LS_BRAND,
    hasKeys(theme.brandPalette) ? JSON.stringify(theme.brandPalette) : undefined
  );

  setOrRemove(
    LS_STATUS,
    hasKeys(theme.statusColors) ? JSON.stringify(theme.statusColors) : undefined
  );

  setOrRemove(
    LS_GLASS,
    theme.glass ? JSON.stringify(normalizeGlassConfig(theme.glass)) : undefined
  );

  setOrRemove(
    LS_OVERRIDES,
    hasOverrides(theme.overrides) ? JSON.stringify(theme.overrides) : undefined
  );
}

// ── applyStoredTheme() ───────────────────────────────────────────────────────
export function applyStoredTheme(theme?: StoredTheme): void {
  const t = theme ?? loadStoredTheme() ?? { mode: "light" as AppTheme };
  const root = document.documentElement;
  const glass = normalizeGlassConfig(t.glass);

  applyTheme(t.mode);

  if (t.brandPalette && Object.keys(t.brandPalette).length > 0) {
    applyBrandShadeOverrides(t.brandPalette);
  }

  if (t.statusColors) {
    Object.entries(t.statusColors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });
  }

  applyGlassCssVars(glass);

  if (t.overrides) {
    const modeOverrides = t.overrides[t.mode] ?? {};
    Object.entries(modeOverrides).forEach(([key, value]) => {
      const varName = cssVarMap[key as TokenKey];
      if (varName && value) {
        root.style.setProperty(varName, value);
      }
    });
  }

  root.classList.remove("light", "dark");
  root.classList.add(t.mode);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    const bg = getComputedStyle(root).getPropertyValue("--bg-base").trim();
    metaTheme.setAttribute(
      "content",
      bg || (t.mode === "dark" ? "#030712" : "#f8fafc")
    );
  }
}

// ── initTheme() ──────────────────────────────────────────────────────────────
export function initTheme(): void {
  const stored = loadStoredTheme();
  if (stored) {
    applyStoredTheme(stored);
    return;
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyStoredTheme({ mode: prefersDark ? "dark" : "light" });
}

// ── resetTheme() ─────────────────────────────────────────────────────────────
export function resetTheme(): void {
  [
    LS_MODE,
    LS_MODE_LEGACY,
    LS_BRAND,
    LS_STATUS,
    LS_BASE,
    LS_GLASS,
    LS_OVERRIDES,
  ].forEach((key) => localStorage.removeItem(key));

  applyStoredTheme({ mode: "light" });
}
