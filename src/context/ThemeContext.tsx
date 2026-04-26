// src/context/ThemeContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  resetTheme,
  GLASS_DEFAULTS,
  tokens as defaultTokens,
  palette as defaultPalette,
} from "../theme";

interface ThemeContextValue {
  mode: AppTheme;
  setMode: (mode: AppTheme) => void;

  theme: AppTheme;
  setTheme: (mode: AppTheme) => void;
  toggleTheme: () => void;

  customTokens: Record<AppTheme, Partial<TokenMap>>;
  setTokenOverride: (mode: AppTheme, key: TokenKey, value: string) => void;
  resetTokenOverrides: () => void;

  brandPalette: Partial<Record<BrandShade, string>> | null;
  setBrandPalette: (
    palette: Partial<Record<BrandShade, string>> | null
  ) => void;

  statusColors: Record<string, string>;
  setStatusColor: (key: string, value: string) => void;

  glassConfig: GlassConfig;
  setGlassConfig: (config: GlassConfig) => void;

  reapplyTheme: () => void;
  resetAll: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function normalizeGlassConfig(
  glass?: Partial<GlassConfig> | null
): GlassConfig {
  return {
    ...GLASS_DEFAULTS,
    ...(glass ?? {}),
  };
}

function buildDefaultStatusColors() {
  return {
    pass: defaultPalette.pass,
    fail: defaultPalette.fail,
    pend: defaultPalette.pend,
    warn: defaultPalette.warn,
  };
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const stored = useMemo(() => loadStoredTheme(), []);

  const [mode, setModeState] = useState<AppTheme>(stored?.mode ?? "light");
  const [customTokens, setCustomTokens] = useState<
    Record<AppTheme, Partial<TokenMap>>
  >(stored?.overrides ?? { light: {}, dark: {} });

  const [brandPalette, setBrandPaletteState] = useState<Partial<
    Record<BrandShade, string>
  > | null>(stored?.brandPalette ?? null);

  const [statusColors, setStatusColorsState] = useState<Record<string, string>>(
    stored?.statusColors ?? buildDefaultStatusColors()
  );

  const [glassConfig, setGlassConfigState] = useState<GlassConfig>(
    normalizeGlassConfig(stored?.glass)
  );

  const [isReady, setIsReady] = useState(false);

  const currentTheme = useMemo<StoredTheme>(
    () => ({
      mode,
      brandPalette:
        brandPalette && Object.keys(brandPalette).length > 0
          ? brandPalette
          : undefined,
      statusColors,
      glass: glassConfig,
      overrides: customTokens,
    }),
    [mode, brandPalette, statusColors, glassConfig, customTokens]
  );

  useEffect(() => {
    if (!isReady) {
      applyStoredTheme(currentTheme);
      setIsReady(true);
      return;
    }

    saveStoredTheme(currentTheme);
    applyStoredTheme(currentTheme);
  }, [currentTheme, isReady]);

  const setMode = useCallback((newMode: AppTheme) => {
    setModeState(newMode);
  }, []);

  const toggleTheme = useCallback(() => {
    setModeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const setTokenOverride = useCallback(
    (targetMode: AppTheme, key: TokenKey, value: string) => {
      setCustomTokens((prev) => {
        const nextModeTokens = { ...(prev[targetMode] ?? {}) };
        const defaultValue = defaultTokens[targetMode][key];

        if (value === defaultValue) {
          delete nextModeTokens[key];
        } else {
          nextModeTokens[key] = value;
        }

        return {
          ...prev,
          [targetMode]: nextModeTokens,
        };
      });
    },
    []
  );

  const resetTokenOverrides = useCallback(() => {
    setCustomTokens({ light: {}, dark: {} });
  }, []);

  const setBrandPalette = useCallback(
    (palette: Partial<Record<BrandShade, string>> | null) => {
      if (!palette || Object.keys(palette).length === 0) {
        setBrandPaletteState(null);
      } else {
        setBrandPaletteState(palette);
      }
    },
    []
  );

  const setStatusColor = useCallback((key: string, value: string) => {
    setStatusColorsState((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const setGlassConfig = useCallback((config: GlassConfig) => {
    setGlassConfigState(normalizeGlassConfig(config));
  }, []);

  const reapplyTheme = useCallback(() => {
    applyStoredTheme(currentTheme);
  }, [currentTheme]);

  const resetAll = useCallback(() => {
    setModeState("light");
    setCustomTokens({ light: {}, dark: {} });
    setBrandPaletteState(null);
    setStatusColorsState(buildDefaultStatusColors());
    setGlassConfigState({ ...GLASS_DEFAULTS });
    resetTheme();
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        mode,
        setMode,
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
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
};
