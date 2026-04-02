/**
 * ThemeContext.tsx
 *
 * Light wrapper around src/theme.ts.
 * All colour values live in theme.ts — do not hardcode anything here.
 *
 * Extended with:
 *  - customTokens: per-mode token overrides (stored in localStorage)
 *  - setTokenOverride / resetTokenOverrides for the Theme Editor panel
 *  - applyThemeWithOverrides: applies defaults then layers overrides on top
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { applyTheme, cssVarMap, TokenKey, TokenMap } from "../theme";

type Theme = "light" | "dark";

// Partial overrides per mode — only the tokens the user has changed
type ModeOverrides = Partial<TokenMap>;
type CustomTokens = { light: ModeOverrides; dark: ModeOverrides };

const LS_THEME_KEY     = "theme";
const LS_OVERRIDES_KEY = "themeEditorOverrides";

function loadOverrides(): CustomTokens {
  try {
    const raw = localStorage.getItem(LS_OVERRIDES_KEY);
    if (raw) return JSON.parse(raw) as CustomTokens;
  } catch { /* ignore */ }
  return { light: {}, dark: {} };
}

function saveOverrides(o: CustomTokens) {
  localStorage.setItem(LS_OVERRIDES_KEY, JSON.stringify(o));
}

/** Apply CSS vars for the active mode, then layer any custom overrides on top. */
function applyThemeWithOverrides(mode: Theme, overrides: CustomTokens) {
  applyTheme(mode); // sets all CSS vars from theme.ts defaults
  const modeOverrides = overrides[mode];
  const root = document.documentElement;
  (Object.entries(modeOverrides) as [TokenKey, string][]).forEach(([key, value]) => {
    if (value) root.style.setProperty(cssVarMap[key], value);
  });
}

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;

  // Theme Editor API
  customTokens: CustomTokens;
  setTokenOverride: (mode: Theme, key: TokenKey, value: string) => void;
  resetTokenOverrides: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  customTokens: { light: {}, dark: {} },
  setTokenOverride: () => {},
  resetTokenOverrides: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() =>
    (localStorage.getItem(LS_THEME_KEY) as Theme) ?? "dark"
  );
  const [customTokens, setCustomTokens] = useState<CustomTokens>(loadOverrides);

  // Re-apply whenever theme or overrides change
  useEffect(() => {
    applyThemeWithOverrides(theme, customTokens);
    localStorage.setItem(LS_THEME_KEY, theme);
  }, [theme, customTokens]);

  const setTheme    = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState(prev => (prev === "dark" ? "light" : "dark"));

  const setTokenOverride = useCallback((mode: Theme, key: TokenKey, value: string) => {
    setCustomTokens(prev => {
      const next: CustomTokens = {
        light: { ...prev.light },
        dark:  { ...prev.dark  },
      };
      next[mode] = { ...next[mode], [key]: value };
      saveOverrides(next);
      return next;
    });
  }, []);

  const resetTokenOverrides = useCallback(() => {
    const empty: CustomTokens = { light: {}, dark: {} };
    saveOverrides(empty);
    setCustomTokens(empty);
  }, []);

  return (
    <ThemeContext.Provider value={{
      theme, toggleTheme, setTheme,
      customTokens, setTokenOverride, resetTokenOverrides,
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
