import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  type AppTheme,
  type TokenKey,
  type TokenMap,
  type BrandShade,
  type GlassConfig,
  type StoredTheme,
  loadStoredTheme,
  saveStoredTheme,
  applyStoredTheme,
  GLASS_DEFAULTS,
  tokens as defaultTokens,
  palette as defaultPalette,
} from "../theme";

// ═══════════════════════════════════════════════════════════════════════════════
//  ThemeContext — React state layer over the unified applyStoredTheme()
// ═══════════════════════════════════════════════════════════════════════════════

export interface MuiConfig {
  active: boolean;
  borderRadius: number;
  buttonBorderRadius: number;
  textFieldBorderRadius: number;
  fontSize: number;
  disablePaperBgImage: boolean;
}

const DEFAULT_MUI: MuiConfig = {
  active: false,
  borderRadius: 12,
  buttonBorderRadius: 10,
  textFieldBorderRadius: 10,
  fontSize: 14,
  disablePaperBgImage: false,
};

const LS_MUI = "themeEditorMuiConfig";

interface ThemeContextValue {
  // Current mode
  mode: AppTheme;
  setMode: (mode: AppTheme) => void;

  // Aliases used by ThemeToggle, MobileNav, and other components
  theme: AppTheme;
  setTheme: (mode: AppTheme) => void;
  toggleTheme: () => void;

  // Token overrides per mode (exposed for ThemeEditor)
  customTokens: Record<AppTheme, Partial<TokenMap>>;
  setTokenOverride: (mode: AppTheme, key: TokenKey, value: string) => void;
  resetTokenOverrides: () => void;

  // Brand palette (exposed for ThemeEditor)
  brandPalette: Partial<Record<BrandShade, string>> | null;
  setBrandPalette: (palette: Partial<Record<BrandShade, string>>) => void;

  // Status colors
  statusColors: Record<string, string>;
  setStatusColor: (key: string, value: string) => void;

  // Glass config
  glassConfig: GlassConfig;
  setGlassConfig: (config: GlassConfig) => void;

  // MUI config
  muiConfig: MuiConfig;
  setMuiConfig: (config: Partial<MuiConfig>) => void;
  resetMuiConfig: () => void;

  // Unified apply (for external callers / debug)
  reapplyTheme: () => void;

  // Reset everything
  resetAll: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ── Helper: load MUI config from localStorage ────────────────────────────────
function loadMuiConfig(): MuiConfig {
  try {
    const raw = localStorage.getItem(LS_MUI);
    if (raw) return { ...DEFAULT_MUI, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_MUI };
}

function saveMuiConfig(config: MuiConfig) {
  localStorage.setItem(LS_MUI, JSON.stringify(config));
}

// ── Provider ─────────────────────────────────────────────────────────────────
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isReady, setIsReady] = useState(false);

  const stored = loadStoredTheme();
  const [mode, setModeState] = useState<AppTheme>(stored?.mode ?? "light");
  const [customTokens, setCustomTokens] = useState<
    Record<AppTheme, Partial<TokenMap>>
  >(stored?.overrides ?? { light: {}, dark: {} });
  const [brandPalette, setBrandPaletteState] = useState<Partial<
    Record<BrandShade, string>
  > | null>(stored?.brandPalette ?? null);
  const [statusColors, setStatusColorsState] = useState<Record<string, string>>(
    stored?.statusColors ?? {
      pass: defaultPalette.pass,
      fail: defaultPalette.fail,
      pend: defaultPalette.pend,
    }
  );
  const [glassConfig, setGlassConfigState] = useState<GlassConfig>(
    stored?.glass ?? { ...GLASS_DEFAULTS }
  );
  const [muiConfig, setMuiConfigState] = useState<MuiConfig>(loadMuiConfig);

  // ── Apply theme on mount (prevents FOUC) ──────────────────────────────────
  useEffect(() => {
    applyStoredTheme();
    setIsReady(true);
  }, []);

  // ── Re-apply whenever core theme state changes ────────────────────────────
  useEffect(() => {
    if (!isReady) return;
    const theme: StoredTheme = {
      mode,
      brandPalette: brandPalette ?? undefined,
      statusColors,
      glass: glassConfig,
      overrides: customTokens,
    };
    saveStoredTheme(theme);
    applyStoredTheme(theme);
  }, [mode, brandPalette, statusColors, glassConfig, customTokens, isReady]);

  // ── Mode ──────────────────────────────────────────────────────────────────
  const setMode = useCallback((newMode: AppTheme) => {
    setModeState(newMode);
    localStorage.setItem("themeMode", newMode);
  }, []);

  const toggleTheme = useCallback(() => {
    setModeState((prev) => {
      const next: AppTheme = prev === "dark" ? "light" : "dark";
      localStorage.setItem("themeMode", next);
      return next;
    });
  }, []);

  // ── Token overrides ───────────────────────────────────────────────────────
  const setTokenOverride = useCallback(
    (targetMode: AppTheme, key: TokenKey, value: string) => {
      setCustomTokens((prev) => ({
        ...prev,
        [targetMode]: { ...prev[targetMode], [key]: value },
      }));
    },
    []
  );

  const resetTokenOverrides = useCallback(() => {
    setCustomTokens({ light: {}, dark: {} });
    localStorage.removeItem("themeEditorOverrides");
    applyStoredTheme({ mode, glass: glassConfig });
  }, [mode, glassConfig]);

  // ── Brand palette ─────────────────────────────────────────────────────────
  const setBrandPalette = useCallback(
    (palette: Partial<Record<BrandShade, string>>) => {
      setBrandPaletteState(palette);
    },
    []
  );

  // ── Status colors ─────────────────────────────────────────────────────────
  const setStatusColor = useCallback((key: string, value: string) => {
    setStatusColorsState((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Glass ─────────────────────────────────────────────────────────────────
  const setGlassConfig = useCallback((config: GlassConfig) => {
    setGlassConfigState(config);
  }, []);

  // ── MUI ───────────────────────────────────────────────────────────────────
  const setMuiConfig = useCallback((patch: Partial<MuiConfig>) => {
    setMuiConfigState((prev: MuiConfig) => {
      const next = { ...prev, ...patch };
      saveMuiConfig(next);
      return next;
    });
  }, []);

  const resetMuiConfig = useCallback(() => {
    setMuiConfigState({ ...DEFAULT_MUI });
    saveMuiConfig({ ...DEFAULT_MUI });
  }, []);

  // ── Re-apply (for debug / external sync) ──────────────────────────────────
  const reapplyTheme = useCallback(() => {
    applyStoredTheme();
  }, []);

  // ── Reset all ─────────────────────────────────────────────────────────────
  const resetAll = useCallback(() => {
    setModeState("light");
    setCustomTokens({ light: {}, dark: {} });
    setBrandPaletteState(null);
    setStatusColorsState({
      pass: defaultPalette.pass,
      fail: defaultPalette.fail,
      pend: defaultPalette.pend,
    });
    setGlassConfigState({ ...GLASS_DEFAULTS });
    setMuiConfigState({ ...DEFAULT_MUI });
    localStorage.removeItem("themeMode");
    localStorage.removeItem("themeEditorOverrides");
    localStorage.removeItem("themeEditorBrandPalette");
    localStorage.removeItem("themeEditorStatusColors");
    localStorage.removeItem("themeEditorGlass");
    localStorage.removeItem("themeEditorBaseColor");
    localStorage.removeItem(LS_MUI);
    applyStoredTheme({ mode: "light" });
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        mode,
        setMode,
        // Aliases for components using the old API
        theme: mode,
        setTheme: setMode,
        toggleTheme,
        customTokens,
        setTokenOverride,
        resetTokenOverrides,
        brandPalette,
        setBrandPalette,
        statusColors,
        setStatusColor,
        glassConfig,
        setGlassConfig,
        muiConfig,
        setMuiConfig,
        resetMuiConfig,
        reapplyTheme,
        resetAll,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
