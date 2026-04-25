/**
 * ThemeContext.tsx
 *
 * Manages:
 *  1. light / dark mode  — applyTheme() from theme.ts
 *  2. Token overrides    — layered on top of defaults, persisted to localStorage
 *  3. MUI config         — active flag + typography/shape settings, also persisted
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

// ─── LocalStorage keys ────────────────────────────────────────────────────────

const LS_THEME = "theme";
const LS_OVERRIDES = "themeEditorOverrides";
const LS_MUI = "themeEditorMuiConfig";
const LS_BRAND_KEY = "themeEditorBrandPalette";

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

function applyThemeWithOverrides(mode: AppTheme, overrides: CustomTokens) {
  applyTheme(mode);
  const root = document.documentElement;
  (Object.entries(overrides[mode]) as [TokenKey, string][]).forEach(
    ([key, value]) => {
      if (value) root.style.setProperty(cssVarMap[key], value);
    }
  );
  // Re-apply brand shade overrides so ThemeEditor changes survive mode switches.
  applyBrandShadeOverrides(loadBrandOverrides());
}

/** Sync data-theme attribute and theme-color meta tag */
function syncThemeAttributes(mode: AppTheme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);

  // Update theme-color meta for mobile browser chrome
  const meta = document.getElementById(
    "theme-color-meta"
  ) as HTMLMetaElement | null;
  if (meta) {
    meta.content = tokens[mode].bgBase;
  }
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
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setThemeState] = useState<AppTheme>(
    () => (localStorage.getItem(LS_THEME) as AppTheme) ?? "dark"
  );
  const [customTokens, setCustomTokens] = useState<CustomTokens>(loadOverrides);
  const [muiConfig, setMuiConfigState] = useState<MuiConfig>(loadMuiConfig);

  useEffect(() => {
    applyThemeWithOverrides(theme, customTokens);
    localStorage.setItem(LS_THEME, theme);
    syncThemeAttributes(theme);
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
    setMuiConfigState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(LS_MUI, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetMuiConfig = useCallback(() => {
    localStorage.setItem(LS_MUI, JSON.stringify(MUI_CONFIG_DEFAULTS));
    setMuiConfigState({ ...MUI_CONFIG_DEFAULTS });
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
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
