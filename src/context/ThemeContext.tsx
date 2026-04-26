/**
 * ThemeContext.tsx
 *
 * Manages:
 *  1. light / dark mode  — applyTheme() from theme.ts
 *  2. Token overrides    — layered on top of defaults, persisted to localStorage
 *  3. MUI config         — active flag + typography/shape settings, also persisted
 *  4. Glass config       — blur, saturation, brightness, opacity values
 *  5. Status colors      — pass / fail / pending overrides
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  applyTheme,
  applyBrandShadeOverrides,
  cssVarMap,
  TokenKey,
  TokenMap,
  BrandShade,
  tokens,
} from "../theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppTheme = "light" | "dark";

type ModeOverrides = Partial<TokenMap>;
type CustomTokens = { light: ModeOverrides; dark: ModeOverrides };

export interface MuiConfig {
  active: boolean;
  fontFamily: string;
  fontSize: number;
  fontWeightRegular: number;
  fontWeightMedium: number;
  fontWeightBold: number;
  borderRadius: number;
  buttonBorderRadius: number;
  textFieldBorderRadius: number;
  buttonTextTransform: "none" | "uppercase" | "capitalize";
  disablePaperBgImage: boolean;
}

export interface GlassConfig {
  blur: number;
  saturation: number;
  brightness: number;
  bgOpacity: number;
  borderOpacity: number;
}

export interface StatusColors {
  pass: string;
  fail: string;
  pending: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const MUI_CONFIG_DEFAULTS: MuiConfig = {
  active: false,
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 14,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 700,
  borderRadius: 12,
  buttonBorderRadius: 12,
  textFieldBorderRadius: 12,
  buttonTextTransform: "none",
  disablePaperBgImage: true,
};

export const GLASS_DEFAULTS: GlassConfig = {
  blur: 28,
  saturation: 180,
  brightness: 1.06,
  bgOpacity: 40,
  borderOpacity: 55,
};

export const STATUS_DEFAULTS: StatusColors = {
  pass: "#22c55e",
  fail: "#ef4444",
  pending: "#f59e0b",
};

// ─── LocalStorage keys ────────────────────────────────────────────────────────

const LS_THEME = "theme";
const LS_OVERRIDES = "themeEditorOverrides";
const LS_MUI = "themeEditorMuiConfig";
const LS_BRAND_KEY = "themeEditorBrandPalette";
const LS_GLASS = "themeEditorGlass";
const LS_STATUS = "themeEditorStatusColors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadOverrides(): CustomTokens {
  try {
    const r = localStorage.getItem(LS_OVERRIDES);
    if (r) return JSON.parse(r);
  } catch {}
  return { light: {}, dark: {} };
}

function loadMuiConfig(): MuiConfig {
  try {
    const r = localStorage.getItem(LS_MUI);
    if (r) return { ...MUI_CONFIG_DEFAULTS, ...JSON.parse(r) };
  } catch {}
  return { ...MUI_CONFIG_DEFAULTS };
}

function loadBrandOverrides(): Partial<Record<BrandShade, string>> {
  try {
    const r = localStorage.getItem(LS_BRAND_KEY);
    if (r) return JSON.parse(r);
  } catch {}
  return {};
}

function loadGlassConfig(): GlassConfig {
  try {
    const r = localStorage.getItem(LS_GLASS);
    if (r) return { ...GLASS_DEFAULTS, ...JSON.parse(r) };
  } catch {}
  return { ...GLASS_DEFAULTS };
}

function loadStatusColors(): StatusColors {
  try {
    const r = localStorage.getItem(LS_STATUS);
    if (r) return { ...STATUS_DEFAULTS, ...JSON.parse(r) };
  } catch {}
  return { ...STATUS_DEFAULTS };
}

function applyGlassConfig(config: GlassConfig) {
  const root = document.documentElement;
  root.style.setProperty("--glass-blur", `${config.blur}px`);
  root.style.setProperty("--glass-saturation", `${config.saturation}%`);
  root.style.setProperty("--glass-brightness", `${config.brightness}`);
  root.style.setProperty("--glass-bg-opacity", `${config.bgOpacity}%`);
  root.style.setProperty("--glass-border-opacity", `${config.borderOpacity}%`);
}

function applyStatusColors(colors: StatusColors) {
  const root = document.documentElement;
  root.style.setProperty("--color-pass", colors.pass);
  root.style.setProperty("--color-fail", colors.fail);
  root.style.setProperty("--color-pend", colors.pending);
}

/** Sync data-theme attribute and theme-color meta tag */
function syncThemeAttributes(mode: AppTheme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);

  const meta = document.getElementById(
    "theme-color-meta"
  ) as HTMLMetaElement | null;
  if (meta) {
    meta.content = tokens[mode].bgBase;
  }
}

/**
 * ── applyStoredTheme ─────────────────────────────────────────────────────────
 * Reads EVERY persisted theme layer from localStorage and applies it.
 * Call this once on app startup (and after any external storage mutation).
 */
export function applyStoredTheme(mode: AppTheme) {
  const overrides = loadOverrides();
  const brand = loadBrandOverrides();
  const glass = loadGlassConfig();
  const status = loadStatusColors();

  applyTheme(mode);
  const root = document.documentElement;
  (Object.entries(overrides[mode]) as [TokenKey, string][]).forEach(
    ([key, value]) => {
      if (value) root.style.setProperty(cssVarMap[key], value);
    }
  );
  applyBrandShadeOverrides(brand);
  applyGlassConfig(glass);
  applyStatusColors(status);
  syncThemeAttributes(mode);
}

// ─── Context type ─────────────────────────────────────────────────────────────

interface ThemeContextType {
  theme: AppTheme;
  toggleTheme: () => void;
  setTheme: (t: AppTheme) => void;

  customTokens: CustomTokens;
  setTokenOverride: (mode: AppTheme, key: TokenKey, value: string) => void;
  resetTokenOverrides: () => void;

  muiConfig: MuiConfig;
  setMuiConfig: (cfg: Partial<MuiConfig>) => void;
  resetMuiConfig: () => void;

  glassConfig: GlassConfig;
  setGlassConfig: (cfg: Partial<GlassConfig>) => void;
  resetGlassConfig: () => void;

  statusColors: StatusColors;
  setStatusColors: (cfg: Partial<StatusColors>) => void;
  resetStatusColors: () => void;
}

// ─── Context + Provider ───────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  customTokens: { light: {}, dark: {} },
  setTokenOverride: () => {},
  resetTokenOverrides: () => {},
  muiConfig: MUI_CONFIG_DEFAULTS,
  setMuiConfig: () => {},
  resetMuiConfig: () => {},
  glassConfig: GLASS_DEFAULTS,
  setGlassConfig: () => {},
  resetGlassConfig: () => {},
  statusColors: STATUS_DEFAULTS,
  setStatusColors: () => {},
  resetStatusColors: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setThemeState] = useState<AppTheme>(
    () => (localStorage.getItem(LS_THEME) as AppTheme) ?? "dark"
  );
  const [customTokens, setCustomTokens] = useState<CustomTokens>(loadOverrides);
  const [muiConfig, setMuiConfigState] = useState<MuiConfig>(loadMuiConfig);
  const [glassConfig, setGlassConfigState] =
    useState<GlassConfig>(loadGlassConfig);
  const [statusColors, setStatusColorsState] =
    useState<StatusColors>(loadStatusColors);

  // ── CRITICAL: apply EVERY stored theme layer on mount ──────────────────────
  useEffect(() => {
    console.group("🚀 ThemeProvider init");
    console.log("Mode:", theme);
    console.log("Overrides:", customTokens);
    console.log("MUI config:", muiConfig);
    console.log("Glass config:", glassConfig);
    console.log("Status colors:", statusColors);
    applyStoredTheme(theme);
    localStorage.setItem(LS_THEME, theme);
    console.log("✅ applyStoredTheme() completed");
    console.groupEnd();
  }, [theme, customTokens]);

  const setTheme = (t: AppTheme) => setThemeState(t);
  const toggleTheme = () =>
    setThemeState((p) => (p === "dark" ? "light" : "dark"));

  const setTokenOverride = useCallback(
    (mode: AppTheme, key: TokenKey, value: string) => {
      setCustomTokens((prev) => {
        const next = { light: { ...prev.light }, dark: { ...prev.dark } };
        next[mode] = { ...next[mode], [key]: value };
        localStorage.setItem(LS_OVERRIDES, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const resetTokenOverrides = useCallback(() => {
    const empty: CustomTokens = { light: {}, dark: {} };
    localStorage.setItem(LS_OVERRIDES, JSON.stringify(empty));
    setCustomTokens(empty);
  }, []);

  const setMuiConfig = useCallback((patch: Partial<MuiConfig>) => {
    console.group("🎨 ThemeContext.setMuiConfig");
    console.log("Incoming patch:", patch);
    setMuiConfigState((prev) => {
      const next = { ...prev, ...patch };
      console.log("Previous:", prev);
      console.log("Next:", next);
      localStorage.setItem(LS_MUI, JSON.stringify(next));
      console.log("✅ Written to localStorage:", LS_MUI);
      console.groupEnd();
      return next;
    });
  }, []);

  const resetMuiConfig = useCallback(() => {
    localStorage.setItem(LS_MUI, JSON.stringify(MUI_CONFIG_DEFAULTS));
    setMuiConfigState({ ...MUI_CONFIG_DEFAULTS });
  }, []);

  const setGlassConfig = useCallback((patch: Partial<GlassConfig>) => {
    setGlassConfigState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(LS_GLASS, JSON.stringify(next));
      applyGlassConfig(next);
      return next;
    });
  }, []);

  const resetGlassConfig = useCallback(() => {
    localStorage.setItem(LS_GLASS, JSON.stringify(GLASS_DEFAULTS));
    setGlassConfigState({ ...GLASS_DEFAULTS });
    applyGlassConfig(GLASS_DEFAULTS);
  }, []);

  const setStatusColors = useCallback((patch: Partial<StatusColors>) => {
    setStatusColorsState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(LS_STATUS, JSON.stringify(next));
      applyStatusColors(next);
      return next;
    });
  }, []);

  const resetStatusColors = useCallback(() => {
    localStorage.setItem(LS_STATUS, JSON.stringify(STATUS_DEFAULTS));
    setStatusColorsState({ ...STATUS_DEFAULTS });
    applyStatusColors(STATUS_DEFAULTS);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        customTokens,
        setTokenOverride,
        resetTokenOverrides,
        muiConfig,
        setMuiConfig,
        resetMuiConfig,
        glassConfig,
        setGlassConfig,
        resetGlassConfig,
        statusColors,
        setStatusColors,
        resetStatusColors,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
