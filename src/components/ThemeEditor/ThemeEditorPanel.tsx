/**
 * ThemeEditorPanel.tsx
 *
 * Password-gated, full-screen mobile drawer for live theme editing.
 *
 * Features:
 *  • Password gate (SHA-256 via Web Crypto — hash lives in src/config/themeEditorConfig.ts)
 *  • Tab navigation: Brand & Status | Light Mode | Dark Mode
 *  • Live color editing for all 19 semantic tokens × 2 modes
 *  • Brand palette (10 shades) + status colors (pass / fail / pend)
 *  • Changes apply instantly via ThemeContext.setTokenOverride
 *  • Overrides persisted to localStorage — survive page refreshes
 *  • Reset to defaults button
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "../../context/ThemeContext";
import { verifyThemePassword } from "../../config/themeEditorConfig";
import {
  tokens as defaultTokens,
  palette as defaultPalette,
  cssVarMap,
  TokenKey,
} from "../../theme";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "light" | "dark";

interface ThemeEditorPanelProps {
  onClose: () => void;
}

// ─── Token groups for display ─────────────────────────────────────────────────

const TOKEN_GROUPS: { label: string; icon: string; keys: TokenKey[] }[] = [
  {
    label: "Brand",
    icon: "🎨",
    keys: ["colorBrand", "colorBrandHover", "colorBrandBg"],
  },
  {
    label: "Backgrounds",
    icon: "🖼",
    keys: ["bgBase", "bgSurface", "bgCard", "bgNav"],
  },
  {
    label: "Text",
    icon: "🔤",
    keys: ["textPrimary", "textSecondary", "textMuted"],
  },
  {
    label: "Borders",
    icon: "▭",
    keys: ["borderColor"],
  },
  {
    label: "Inputs",
    icon: "📝",
    keys: ["inputBg", "inputBorder", "inputText"],
  },
  {
    label: "Glass",
    icon: "✨",
    keys: ["glassBg", "glassBorder"],
  },
  {
    label: "Gradient",
    icon: "🌈",
    keys: ["gradFrom", "gradVia", "gradTo"],
  },
];

// Friendly labels for each token key
const TOKEN_LABELS: Record<TokenKey, string> = {
  bgBase:          "Base Background",
  bgSurface:       "Surface",
  bgCard:          "Card",
  bgNav:           "Navigation",
  borderColor:     "Border",
  textPrimary:     "Primary Text",
  textSecondary:   "Secondary Text",
  textMuted:       "Muted Text",
  inputBg:         "Input Background",
  inputBorder:     "Input Border",
  inputText:       "Input Text",
  glassBg:         "Glass Background",
  glassBorder:     "Glass Border",
  gradFrom:        "Gradient From",
  gradVia:         "Gradient Via",
  gradTo:          "Gradient To",
  colorBrand:      "Brand Color",
  colorBrandHover: "Brand Hover",
  colorBrandBg:    "Brand Background",
};

// Brand palette shades
const BRAND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
type BrandShade = typeof BRAND_SHADES[number];

// Status color keys
const STATUS_KEYS = ["pass", "fail", "pend"] as const;
type StatusKey = typeof STATUS_KEYS[number];
const STATUS_LABELS: Record<StatusKey, string> = { pass: "Pass ✅", fail: "Fail ❌", pend: "Pending ⏳" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Try to convert any CSS color to a 6-digit hex for <input type="color"> */
function toHexColor(value: string): string {
  if (!value) return "#000000";
  // Already a hex
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) {
    if (value.length === 4) {
      return "#" + value[1].repeat(2) + value[2].repeat(2) + value[3].repeat(2);
    }
    return value.slice(0, 7);
  }
  // rgba/rgb — strip alpha, convert
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const r = parseInt(m[1]).toString(16).padStart(2, "0");
    const g = parseInt(m[2]).toString(16).padStart(2, "0");
    const b = parseInt(m[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return "#888888";
}

/** Get the current effective value of a token in the given mode (custom override → default). */
function effectiveTokenValue(
  mode: Mode,
  key: TokenKey,
  customTokens: ReturnType<typeof useTheme>["customTokens"]
): string {
  return customTokens[mode][key] ?? defaultTokens[mode][key];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ColorRowProps {
  label: string;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
  isOverridden: boolean;
  onReset: () => void;
}

const ColorRow: React.FC<ColorRowProps> = ({ label, value, defaultValue, onChange, isOverridden, onReset }) => {
  const hexForPicker = toHexColor(value);

  return (
    <div className="flex items-center gap-2 py-1.5">
      {/* Color swatch / picker */}
      <label
        className="relative w-8 h-8 rounded-lg border border-[var(--border-color)] cursor-pointer shrink-0 overflow-hidden shadow-sm"
        title={`Pick color for ${label}`}
        style={{ backgroundColor: value || "#888" }}
      >
        <input
          type="color"
          value={hexForPicker}
          onChange={e => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </label>

      {/* Label */}
      <span className="text-xs text-t-secondary flex-1 min-w-0 truncate">{label}</span>

      {/* Hex input */}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
        className="w-28 text-xs font-mono px-2 py-1 rounded-lg
          bg-[var(--input-bg)] border border-[var(--input-border)]
          text-[var(--input-text)] focus:outline-none focus:border-c-brand
          transition-colors"
      />

      {/* Reset dot */}
      {isOverridden && (
        <button
          onClick={onReset}
          title={`Reset to default: ${defaultValue}`}
          className="text-xs text-t-muted hover:text-fail transition-colors shrink-0"
        >
          ↺
        </button>
      )}
    </div>
  );
};

// ─── Password Gate ────────────────────────────────────────────────────────────

interface PasswordGateProps {
  onUnlock: () => void;
  onCancel: () => void;
}

const PasswordGate: React.FC<PasswordGateProps> = ({ onUnlock, onCancel }) => {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    if (!pw.trim()) return;
    setChecking(true);
    setError("");
    const ok = await verifyThemePassword(pw);
    setChecking(false);
    if (ok) {
      onUnlock();
    } else {
      setError("Incorrect password.");
      setPw("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 py-10">
      <div className="text-4xl">🔒</div>
      <div className="text-center">
        <p className="font-semibold text-t-primary text-base">Theme Editor</p>
        <p className="text-xs text-t-muted mt-1">Enter the admin password to access theme controls</p>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3">
        <input
          ref={inputRef}
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          placeholder="Password"
          className="w-full px-4 py-3 rounded-xl text-sm
            bg-[var(--input-bg)] border border-[var(--input-border)]
            text-[var(--input-text)] placeholder:text-t-muted
            focus:outline-none focus:border-c-brand transition-colors"
        />

        {error && <p className="text-fail text-xs text-center">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={checking || !pw.trim()}
          className="w-full py-3 rounded-xl text-sm font-semibold
            bg-c-brand text-white hover:bg-c-brand-hover
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {checking ? "Checking…" : "Unlock"}
        </button>

        <button
          onClick={onCancel}
          className="w-full py-2 text-xs text-t-muted hover:text-t-secondary transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ─── Token Editor Tab ─────────────────────────────────────────────────────────

interface TokenEditorProps {
  mode: Mode;
}

const TokenEditor: React.FC<TokenEditorProps> = ({ mode }) => {
  const { customTokens, setTokenOverride } = useTheme();

  const handleChange = (key: TokenKey, value: string) => {
    setTokenOverride(mode, key, value);
  };

  const handleReset = (key: TokenKey) => {
    setTokenOverride(mode, key, defaultTokens[mode][key]);
  };

  return (
    <div className="flex flex-col gap-5 pb-6">
      {TOKEN_GROUPS.map(group => (
        <div key={group.label}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-2">
            {group.icon} {group.label}
          </p>
          <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3">
            {group.keys.map((key, i) => {
              const value    = effectiveTokenValue(mode, key, customTokens);
              const defValue = defaultTokens[mode][key];
              const isOverridden = customTokens[mode][key] !== undefined &&
                                   customTokens[mode][key] !== defValue;
              return (
                <div key={key}>
                  <ColorRow
                    label={TOKEN_LABELS[key]}
                    value={value}
                    defaultValue={defValue}
                    onChange={v => handleChange(key, v)}
                    isOverridden={isOverridden}
                    onReset={() => handleReset(key)}
                  />
                  {i < group.keys.length - 1 && (
                    <div className="border-t border-[var(--border-color)]" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Brand & Status Tab ───────────────────────────────────────────────────────

const LS_BRAND_KEY  = "themeEditorBrandPalette";
const LS_STATUS_KEY = "themeEditorStatusColors";

const BrandStatusEditor: React.FC = () => {
  const { theme } = useTheme();

  // Brand palette local state (stored separately — display only, not CSS vars directly)
  const [brandColors, setBrandColors] = useState<Record<BrandShade, string>>(() => {
    try {
      const raw = localStorage.getItem(LS_BRAND_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* */ }
    return { ...defaultPalette.brand };
  });

  // Status colors
  const [statusColors, setStatusColors] = useState<Record<StatusKey, string>>(() => {
    try {
      const raw = localStorage.getItem(LS_STATUS_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* */ }
    return { pass: defaultPalette.pass, fail: defaultPalette.fail, pend: defaultPalette.pend };
  });

  const { setTokenOverride } = useTheme();

  const handleBrandChange = (shade: BrandShade, value: string) => {
    const next = { ...brandColors, [shade]: value };
    setBrandColors(next);
    localStorage.setItem(LS_BRAND_KEY, JSON.stringify(next));

    // Sync to semantic tokens: shade 500 → dark colorBrand, 600 → light colorBrand
    const shadeToLightKey: Partial<Record<BrandShade, TokenKey>> = {
      50: "colorBrandBg",
      600: "colorBrand",
      700: "colorBrandHover",
    };
    const shadeToDarkKey: Partial<Record<BrandShade, TokenKey>> = {
      500: "colorBrand",
      400: "colorBrandHover",
    };
    if (shadeToLightKey[shade]) setTokenOverride("light", shadeToLightKey[shade]!, value);
    if (shadeToDarkKey[shade])  setTokenOverride("dark",  shadeToDarkKey[shade]!,  value);
  };

  const handleStatusChange = (key: StatusKey, value: string) => {
    const next = { ...statusColors, [key]: value };
    setStatusColors(next);
    localStorage.setItem(LS_STATUS_KEY, JSON.stringify(next));
    // Inject directly into CSS (status colors aren't in TokenMap but are CSS custom props)
    document.documentElement.style.setProperty(`--color-${key}`, value);
  };

  const resetBrand = () => {
    setBrandColors({ ...defaultPalette.brand } as Record<BrandShade, string>);
    localStorage.removeItem(LS_BRAND_KEY);
  };

  const resetStatus = () => {
    setStatusColors({ pass: defaultPalette.pass, fail: defaultPalette.fail, pend: defaultPalette.pend });
    localStorage.removeItem(LS_STATUS_KEY);
  };

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* Brand palette */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
            🎨 Brand Palette
          </p>
          <button onClick={resetBrand} className="text-[10px] text-t-muted hover:text-fail transition-colors">
            Reset
          </button>
        </div>

        {/* Visual swatch row */}
        <div className="flex gap-1 mb-3">
          {BRAND_SHADES.map(shade => (
            <label
              key={shade}
              className="relative flex-1 h-8 rounded cursor-pointer overflow-hidden"
              style={{ backgroundColor: brandColors[shade] }}
              title={`brand-${shade}: ${brandColors[shade]}`}
            >
              <input
                type="color"
                value={toHexColor(brandColors[shade])}
                onChange={e => handleBrandChange(shade, e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </label>
          ))}
        </div>

        <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3">
          {BRAND_SHADES.map((shade, i) => (
            <div key={shade}>
              <ColorRow
                label={`brand-${shade}${shade === 500 ? " (dark primary)" : shade === 600 ? " (light primary)" : ""}`}
                value={brandColors[shade]}
                defaultValue={String(defaultPalette.brand[shade])}
                onChange={v => handleBrandChange(shade, v)}
                isOverridden={brandColors[shade] !== String(defaultPalette.brand[shade])}
                onReset={() => handleBrandChange(shade, String(defaultPalette.brand[shade]))}
              />
              {i < BRAND_SHADES.length - 1 && (
                <div className="border-t border-[var(--border-color)]" />
              )}
            </div>
          ))}
        </div>

        <p className="text-[10px] text-t-muted mt-2 px-1">
          ↳ Editing brand-500/600/400/50/700 automatically syncs the brand semantic tokens
        </p>
      </div>

      {/* Status colors */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
            ⚡ Status Colors
          </p>
          <button onClick={resetStatus} className="text-[10px] text-t-muted hover:text-fail transition-colors">
            Reset
          </button>
        </div>
        <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3">
          {STATUS_KEYS.map((key, i) => (
            <div key={key}>
              <ColorRow
                label={STATUS_LABELS[key]}
                value={statusColors[key]}
                defaultValue={defaultPalette[key]}
                onChange={v => handleStatusChange(key, v)}
                isOverridden={statusColors[key] !== defaultPalette[key]}
                onReset={() => handleStatusChange(key, defaultPalette[key])}
              />
              {i < STATUS_KEYS.length - 1 && (
                <div className="border-t border-[var(--border-color)]" />
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-t-muted mt-2 px-1">
          ↳ Status colors apply to pass/fail/pending badges and charts
        </p>
      </div>

      {/* Current theme indicator */}
      <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-4 py-3">
        <p className="text-xs text-t-muted">
          Active theme: <span className="font-semibold text-c-brand">{theme}</span>
          {" · "}Changes to semantic tokens below apply to the active mode only.
          Switch modes in the More menu to edit the other mode.
        </p>
      </div>
    </div>
  );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────

type Tab = "brand" | "light" | "dark";

const ThemeEditorPanel: React.FC<ThemeEditorPanelProps> = ({ onClose }) => {
  const { resetTokenOverrides, customTokens } = useTheme();
  const [tab, setTab] = useState<Tab>("brand");
  const sheetRef = useRef<HTMLDivElement>(null);

  const lightOverrideCount = Object.keys(customTokens.light).length;
  const darkOverrideCount  = Object.keys(customTokens.dark).length;
  const totalOverrides      = lightOverrideCount + darkOverrideCount;

  const handleReset = () => {
    if (confirm("Reset ALL theme overrides to defaults?")) {
      resetTokenOverrides();
      localStorage.removeItem("themeEditorBrandPalette");
      localStorage.removeItem("themeEditorStatusColors");
    }
  };

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: "brand", label: "Palette" },
    { id: "light", label: "Light", badge: lightOverrideCount },
    { id: "dark",  label: "Dark",  badge: darkOverrideCount  },
  ];

  return (
    <div className="md:hidden fixed inset-0 z-[60] flex items-end">
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="relative w-full rounded-t-2xl z-10 flex flex-col"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderTop: "1px solid var(--border-color)",
          maxHeight: "90dvh",
        }}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mt-3 mb-1 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-[var(--border-color)]">
          <div>
            <p className="font-semibold text-t-primary text-sm">🎨 Theme Editor</p>
            {totalOverrides > 0 && (
              <p className="text-[10px] text-c-brand">{totalOverrides} override{totalOverrides > 1 ? "s" : ""} active</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {totalOverrides > 0 && (
              <button
                onClick={handleReset}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Reset All
              </button>
            )}
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-lg bg-bg-card text-t-secondary hover:text-t-primary transition-colors"
            >
              Done
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-2 shrink-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-colors relative
                ${tab === t.id
                  ? "bg-c-brand text-white"
                  : "bg-bg-card text-t-muted hover:text-t-secondary"}`}
            >
              {t.label}
              {(t.badge ?? 0) > 0 && (
                <span className={`ml-1 text-[10px] font-bold
                  ${tab === t.id ? "text-white/70" : "text-c-brand"}`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-4 pt-2">
          {tab === "brand" && <BrandStatusEditor />}
          {tab === "light" && <TokenEditor mode="light" />}
          {tab === "dark"  && <TokenEditor mode="dark"  />}
        </div>
      </div>
    </div>
  );
};

// ─── Exported wrapper: password gate → panel ──────────────────────────────────

interface ThemeEditorProps {
  onClose: () => void;
}

type EditorState = "password" | "open";

const ThemeEditor: React.FC<ThemeEditorProps> = ({ onClose }) => {
  // Check if already unlocked this session
  const [state, setState] = useState<EditorState>(() =>
    sessionStorage.getItem("themeEditorUnlocked") === "1" ? "open" : "password"
  );

  const handleUnlock = () => {
    sessionStorage.setItem("themeEditorUnlocked", "1");
    setState("open");
  };

  if (state === "password") {
    return (
      <div className="md:hidden fixed inset-0 z-[60] flex items-end">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div
          className="relative w-full rounded-t-2xl z-10"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderTop: "1px solid var(--border-color)",
            height: "55dvh",
          }}
        >
          <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mt-3" />
          <PasswordGate onUnlock={handleUnlock} onCancel={onClose} />
        </div>
      </div>
    );
  }

  return <ThemeEditorPanel onClose={onClose} />;
};

export default ThemeEditor;
