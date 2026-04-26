/**
 * Theme token definitions and runtime application.
 *
 *  1. TokenKey      — union of all overridable CSS custom properties
 *  2. TokenMap      — Record<TokenKey, string> (hex/rgb/hsl)
 *  3. cssVarMap     — maps TokenKey → "--css-variable-name"
 *  4. applyTheme()  — writes dark/light defaults to :root
 *  5. applyBrandShadeOverrides() — layers brand palette overrides
 *  6. applyStoredTheme() — UNIFIED: applies EVERYTHING from localStorage
 *                          (called by both ThemeContext init & ThemeEditor save)
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

// Alias for ThemeEditorPanel compatibility
export const defaultTokens = tokens;

// ── Glass config type & defaults ─────────────────────────────────────────────
export interface GlassConfig {
  blur: number;
  saturation: number;
  brightness: number;
  bgOpacity: number;
  borderOpacity: number;
}

export const GLASS_DEFAULTS: GlassConfig = {
  blur: 28,
  saturation: 180,
  brightness: 106,
  bgOpacity: 40,
  borderOpacity: 55,
};

// ── localStorage keys (must match ThemeEditorPanel) ──────────────────────────
const LS_MODE = "themeMode";
const LS_BRAND = "themeEditorBrandPalette";
const LS_STATUS = "themeEditorStatusColors";
const LS_BASE = "themeEditorBaseColor";
const LS_GLASS = "themeEditorGlass";
const LS_OVERRIDES = "themeEditorOverrides";

// ── applyTheme() ── base mode application ────────────────────────────────────
export function applyTheme(mode: AppTheme) {
  const root = document.documentElement;
  const map = tokens[mode];
  (Object.entries(cssVarMap) as [TokenKey, string][]).forEach(
    ([key, varName]) => {
      root.style.setProperty(varName, map[key]);
    }
  );
  // Neon vars (used by keyframe animations)
  root.style.setProperty("--neon-cyanÜ, 211, 238");
  root.style.setProperty("--neon-amberÔ5, 158, 11");
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

// ── applyGlassCssVars() ──────────────────────────────────────────────────────
export function applyGlassCssVars(g: GlassConfig) {
  const s = document.documentElement.style;
  s.setProperty("--glass-blur", `${g.blur}px`);
  s.setProperty("--glass-saturation", `${g.saturation}%`);
  s.setProperty("--glass-brightness", `${(g.brightness / 100).toFixed(2)}`);
  s.setProperty("--glass-bg-opacity", `${g.bgOpacity}%`);
  s.setProperty("--glass-border-opacity", `${g.borderOpacity}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UNIFIED THEME APPLICATION — Item 9 Fix
//  Single function called by BOTH ThemeContext init AND ThemeEditor save.
// ═══════════════════════════════════════════════════════════════════════════════

export interface StoredTheme {
  mode: AppTheme;
  brandPalette?: Partial<Record<BrandShade, string>>;
  statusColors?: Record<string, string>;
  glass?: GlassConfig;
  overrides?: Record<AppTheme, Partial<TokenMap>>;
}

/**
 * Load the complete stored theme from localStorage.
 * Returns null if nothing is stored.
 */
export function loadStoredTheme(): StoredTheme | null {
  try {
    const mode = (localStorage.getItem(LS_MODE) as AppTheme) || "light";
    const brandPalette = (() => {
      const r = localStorage.getItem(LS_BRAND);
      return r
        ? (JSON.parse(r) as Partial<Record<BrandShade, string>>)
        : undefined;
    })();
    const statusColors = (() => {
      const r = localStorage.getItem(LS_STATUS);
      return r ? (JSON.parse(r) as Record<string, string>) : undefined;
    })();
    const glass = (() => {
      const r = localStorage.getItem(LS_GLASS);
      return r
        ? ({ ...GLASS_DEFAULTS, ...JSON.parse(r) } as GlassConfig)
        : undefined;
    })();
    const overrides = (() => {
      const r = localStorage.getItem(LS_OVERRIDES);
      return r
        ? (JSON.parse(r) as Record<AppTheme, Partial<TokenMap>>)
        : undefined;
    })();

    return { mode, brandPalette, statusColors, glass, overrides };
  } catch {
    return null;
  }
}

/**
 * Save the complete theme to localStorage.
 */
export function saveStoredTheme(theme: StoredTheme): void {
  localStorage.setItem(LS_MODE, theme.mode);
  if (theme.brandPalette) {
    localStorage.setItem(LS_BRAND, JSON.stringify(theme.brandPalette));
  }
  if (theme.statusColors) {
    localStorage.setItem(LS_STATUS, JSON.stringify(theme.statusColors));
  }
  if (theme.glass) {
    localStorage.setItem(LS_GLASS, JSON.stringify(theme.glass));
  }
  if (theme.overrides) {
    localStorage.setItem(LS_OVERRIDES, JSON.stringify(theme.overrides));
  }
}

/**
 * Apply EVERYTHING to the DOM in one shot.
 * This is the single source of truth for how themes get applied.
 *
 * Call sites:
 *   • ThemeContext.tsx — on app mount (prevents FOUC)
 *   • ThemeEditorPanel.tsx — on "Apply & Save" button click
 *   • Any future theme restore/reset path
 */
export function applyStoredTheme(theme?: StoredTheme): void {
  const t = theme ?? loadStoredTheme() ?? { mode: "light" };

  // 1. Base mode tokens
  applyTheme(t.mode);

  // 2. Brand palette overrides
  if (t.brandPalette && Object.keys(t.brandPalette).length > 0) {
    applyBrandShadeOverrides(t.brandPalette);
  }

  // 3. Status color overrides (pass/fail/pend/warn)
  if (t.statusColors) {
    Object.entries(t.statusColors).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--color-${key}`, value);
    });
  }

  // 4. Glass effect config
  if (t.glass) {
    applyGlassCssVars(t.glass);
  } else {
    applyGlassCssVars(GLASS_DEFAULTS);
  }

  // 5. Mode-specific token overrides (light/dark custom colours)
  if (t.overrides) {
    (Object.entries(t.overrides) as [AppTheme, Partial<TokenMap>][]).forEach(
      ([mode, modeOverrides]) => {
        // Only apply overrides for the CURRENT mode to avoid polluting inactive mode vars
        if (mode === t.mode) {
          Object.entries(modeOverrides).forEach(([key, value]) => {
            const varName = cssVarMap[key as TokenKey];
            if (varName && value) {
              document.documentElement.style.setProperty(varName, value);
            }
          });
        }
      }
    );
  }

  // 6. Sync dark/light class on <html>
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(t.mode);

  // 7. Meta theme-color for mobile browsers
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute(
      "content",
      t.mode === "dark" ? "#030712" : "#f8fafc"
    );
  }
}

/**
 * Initialise theme on app boot.
 * Call once in main.tsx or App.tsx before React paint.
 */
export function initTheme(): void {
  const stored = loadStoredTheme();
  if (stored) {
    applyStoredTheme(stored);
  } else {
    // First visit — detect system preference
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    applyStoredTheme({ mode: prefersDark ? "dark" : "light" });
  }
}

/**
 * Reset theme to defaults (clears all localStorage keys).
 */
export function resetTheme(): void {
  [LS_MODE, LS_BRAND, LS_STATUS, LS_BASE, LS_GLASS, LS_OVERRIDES].forEach((k) =>
    localStorage.removeItem(k)
  );
  applyStoredTheme({ mode: "light" });
}
