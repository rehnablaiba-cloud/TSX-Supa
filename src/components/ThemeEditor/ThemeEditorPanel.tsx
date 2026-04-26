// src/components/ThemeEditor/ThemeEditorPanel.tsx
/**
 * ThemeEditorPanel.tsx
 * Simplified: auto-generates full brand palette from one color.
 * Admin-only · wrapped in ModalShell · matches all other modals.
 *
 * REFACTORED (Item 9): All save paths now call applyStoredTheme()
 * from src/theme.ts — the same single source of truth used by
 * ThemeContext on app init.
 */

import React, { useState, useCallback } from "react";
import { Palette } from "lucide-react";
import ModalShell from "../Layout/ModalShell";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import {
  tokens as defaultTokens,
  palette as defaultPalette,
  type TokenKey,
  type BrandShade,
  type GlassConfig,
  BRAND_SHADES,
  brandShadeVar,
  applyStoredTheme,
  GLASS_DEFAULTS,
} from "../../theme";

// ─── Color math ───────────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = h / 360,
    ss = s / 100,
    ll = l / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (ss === 0) {
    r = g = b = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    r = hue2rgb(p, q, hh + 1 / 3);
    g = hue2rgb(p, q, hh);
    b = hue2rgb(p, q, hh - 1 / 3);
  }
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const SHADE_LIGHTNESS: Record<number, number> = {
  50: 97,
  100: 94,
  200: 86,
  300: 77,
  400: 66,
  500: 55,
  600: 44,
  700: 36,
  800: 29,
  900: 22,
};
const SHADE_SAT_MULT: Record<number, number> = {
  50: 0.3,
  100: 0.5,
  200: 0.7,
  300: 0.85,
  400: 1.0,
  500: 1.0,
  600: 1.0,
  700: 0.95,
  800: 0.85,
  900: 0.75,
};

function generatePalette(baseHex: string): Record<BrandShade, string> {
  const [h, s] = hexToHsl(baseHex);
  const result = {} as Record<BrandShade, string>;
  for (const shade of BRAND_SHADES) {
    const l = SHADE_LIGHTNESS[shade] ?? 50;
    const adjS = Math.min(100, Math.round(s * (SHADE_SAT_MULT[shade] ?? 1)));
    result[shade] = hslToHex(h, adjS, l);
  }
  return result;
}

function toHex(v: string): string {
  if (!v) return "#000000";
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (/^#[0-9a-fA-F]{3}$/.test(v))
    return "#" + v[1].repeat(2) + v[2].repeat(2) + v[3].repeat(2);
  return "#888888";
}

// ─── Presets ──────────────────────────────────────────────────────────────────

const PRESETS = [
  { name: "Blue", color: "#3b82f6" },
  { name: "Sky", color: "#0ea5e9" },
  { name: "Cyan", color: "#06b6d4" },
  { name: "Indigo", color: "#6366f1" },
  { name: "Violet", color: "#8b5cf6" },
  { name: "Purple", color: "#a855f7" },
  { name: "Pink", color: "#ec4899" },
  { name: "Rose", color: "#f43f5e" },
  { name: "Red", color: "#ef4444" },
  { name: "Orange", color: "#f97316" },
  { name: "Amber", color: "#f59e0b" },
  { name: "Yellow", color: "#eab308" },
  { name: "Lime", color: "#84cc16" },
  { name: "Emerald", color: "#10b981" },
  { name: "Teal", color: "#14b8a6" },
  { name: "Slate", color: "#64748b" },
];

const LS_BRAND = "themeEditorBrandPalette";
const LS_STATUS = "themeEditorStatusColors";
const LS_BASE = "themeEditorBaseColor";
const LS_GLASS = "themeEditorGlass";

// ─── Shared UI ────────────────────────────────────────────────────────────────

const Swatch: React.FC<{
  color: string;
  label: string;
  onChange: (v: string) => void;
  onReset?: () => void;
  isOverridden?: boolean;
}> = ({ color, label, onChange, onReset, isOverridden }) => (
  <div className="flex items-center gap-3 py-2">
    <label
      className="relative w-9 h-9 rounded-xl border border-[var(--border-color)] cursor-pointer shrink-0 overflow-hidden shadow-sm"
      style={{ backgroundColor: color }}
    >
      <input
        type="color"
        value={toHex(color)}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
      />
    </label>
    <span className="text-xs text-t-secondary flex-1 min-w-0 truncate">
      {label}
    </span>
    <code className="text-[10px] font-mono text-t-muted shrink-0">{color}</code>
    {isOverridden && onReset && (
      <button
        onClick={onReset}
        className="text-xs text-t-muted hover:text-fail shrink-0 ml-1"
      >
        ↺
      </button>
    )}
  </div>
);

const Section: React.FC<{
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, action, children }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
        {title}
      </p>
      {action}
    </div>
    <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3 divide-y divide-[var(--border-color)]">
      {children}
    </div>
  </div>
);

// ─── Tab: Brand ───────────────────────────────────────────────────────────────

const BrandTab: React.FC = () => {
  const { setBrandPalette, setTokenOverride, mode } = useTheme();

  const [baseColor, setBaseColor] = useState<string>(
    () => localStorage.getItem(LS_BASE) ?? "#6366f1"
  );
  const [palette, setPalette] = useState<Record<BrandShade, string>>(() => {
    try {
      const r = localStorage.getItem(LS_BRAND);
      if (r) return JSON.parse(r);
    } catch {}
    return generatePalette(localStorage.getItem(LS_BASE) ?? "#6366f1");
  });
  const [statusColors, setStatusColors] = useState<Record<string, string>>(
    () => {
      try {
        const r = localStorage.getItem(LS_STATUS);
        if (r) return JSON.parse(r);
      } catch {}
      return {
        pass: defaultPalette.pass,
        fail: defaultPalette.fail,
        pend: defaultPalette.pend,
      };
    }
  );

  // Apply brand palette to DOM + persist
  const applyPalette = useCallback(
    (pal: Record<BrandShade, string>) => {
      BRAND_SHADES.forEach((shade) => {
        document.documentElement.style.setProperty(
          brandShadeVar(shade),
          pal[shade]
        );
      });
      const lm: Partial<Record<BrandShade, TokenKey>> = {
        50: "colorBrandBg",
        600: "colorBrand",
        700: "colorBrandHover",
      };
      const dm: Partial<Record<BrandShade, TokenKey>> = {
        400: "colorBrandHover",
        500: "colorBrand",
      };
      BRAND_SHADES.forEach((shade) => {
        if (lm[shade]) setTokenOverride("light", lm[shade]!, pal[shade]);
        if (dm[shade]) setTokenOverride("dark", dm[shade]!, pal[shade]);
      });
    },
    [setTokenOverride]
  );

  const handleBaseChange = (hex: string) => {
    setBaseColor(hex);
    localStorage.setItem(LS_BASE, hex);
    const pal = generatePalette(hex);
    setPalette(pal);
    localStorage.setItem(LS_BRAND, JSON.stringify(pal));
    applyPalette(pal);
    // ── UNIFIED APPLY ──
    applyStoredTheme();
  };

  const handleStatusChange = (key: string, value: string) => {
    const next = { ...statusColors, [key]: value };
    setStatusColors(next);
    localStorage.setItem(LS_STATUS, JSON.stringify(next));
    document.documentElement.style.setProperty(`--color-${key}`, value);
    // ── UNIFIED APPLY ──
    applyStoredTheme();
  };

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
            🎨 Brand Color
          </p>
          <button
            onClick={() => {
              handleBaseChange("#6366f1");
            }}
            className="text-[10px] text-t-muted hover:text-fail"
          >
            Reset
          </button>
        </div>

        <label
          className="flex items-center gap-4 p-4 rounded-2xl border cursor-pointer mb-3 bg-bg-card transition-colors"
          style={{ borderColor: baseColor + "88" }}
        >
          <div
            className="w-14 h-14 rounded-2xl shadow-lg shrink-0 relative overflow-hidden border-2"
            style={{ backgroundColor: baseColor, borderColor: baseColor }}
          >
            <input
              type="color"
              value={toHex(baseColor)}
              onChange={(e) => handleBaseChange(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            />
          </div>
          <div>
            <p className="text-sm font-semibold text-t-primary">
              Pick base color
            </p>
            <p className="text-xs text-t-muted mt-0.5">
              Full palette auto-generated from this
            </p>
            <code className="text-xs font-mono text-c-brand mt-1 block">
              {baseColor}
            </code>
          </div>
        </label>

        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => handleBaseChange(p.color)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all"
              style={{
                backgroundColor:
                  baseColor === p.color ? p.color + "22" : undefined,
                borderColor:
                  baseColor === p.color ? p.color : "var(--border-color)",
                color:
                  baseColor === p.color ? p.color : "var(--text-secondary)",
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: p.color }}
              />
              {p.name}
            </button>
          ))}
        </div>

        <div className="flex rounded-xl overflow-hidden border border-[var(--border-color)] h-8">
          {BRAND_SHADES.map((shade) => (
            <div
              key={shade}
              className="flex-1"
              style={{ backgroundColor: palette[shade] }}
              title={`${shade}: ${palette[shade]}`}
            />
          ))}
        </div>
        <div className="flex mt-1">
          {BRAND_SHADES.map((shade) => (
            <p
              key={shade}
              className="flex-1 text-center text-[8px] text-t-muted"
            >
              {shade}
            </p>
          ))}
        </div>
      </div>

      <Section
        title="⚡ Status Colors"
        action={
          <button
            onClick={() => {
              const def = {
                pass: defaultPalette.pass,
                fail: defaultPalette.fail,
                pend: defaultPalette.pend,
              };
              setStatusColors(def);
              localStorage.removeItem(LS_STATUS);
              Object.entries(def).forEach(([k, v]) =>
                document.documentElement.style.setProperty(`--color-${k}`, v)
              );
              applyStoredTheme();
            }}
            className="text-[10px] text-t-muted hover:text-fail"
          >
            Reset
          </button>
        }
      >
        {(["pass", "fail", "pend"] as const).map((key) => (
          <Swatch
            key={key}
            color={statusColors[key]}
            label={
              { pass: "Pass ✅", fail: "Fail ❌", pend: "Pending ⏳" }[key]
            }
            onChange={(v) => handleStatusChange(key, v)}
            isOverridden={statusColors[key] !== (defaultPalette as any)[key]}
            onReset={() =>
              handleStatusChange(key, (defaultPalette as any)[key])
            }
          />
        ))}
      </Section>
    </div>
  );
};

// ─── Tab: Mode overrides ──────────────────────────────────────────────────────

const KEY_TOKENS: { key: TokenKey; label: string }[] = [
  { key: "bgBase", label: "Page background" },
  { key: "bgSurface", label: "Surface" },
  { key: "bgCard", label: "Card" },
  { key: "bgNav", label: "Navigation" },
  { key: "textPrimary", label: "Primary text" },
  { key: "textSecondary", label: "Secondary text" },
  { key: "textMuted", label: "Muted text" },
  { key: "borderColor", label: "Border" },
];

const ModeTab: React.FC<{ mode: "light" | "dark" }> = ({ mode }) => {
  const { customTokens, setTokenOverride } = useTheme();
  const count = Object.keys(customTokens[mode]).length;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <Section
        title={`${mode === "light" ? "☀️ Light" : "🌙 Dark"} Mode`}
        action={
          count > 0 ? (
            <span className="text-[10px] text-c-brand font-semibold">
              {count} override{count !== 1 ? "s" : ""}
            </span>
          ) : null
        }
      >
        {KEY_TOKENS.map(({ key, label }) => {
          const value = customTokens[mode][key] ?? defaultTokens[mode][key];
          const defVal = defaultTokens[mode][key];
          const isOverridden =
            customTokens[mode][key] !== undefined &&
            customTokens[mode][key] !== defVal;
          return (
            <Swatch
              key={key}
              color={value}
              label={label}
              onChange={(v) => {
                setTokenOverride(mode, key, v);
                // ── UNIFIED APPLY ──
                applyStoredTheme();
              }}
              isOverridden={isOverridden}
              onReset={() => {
                setTokenOverride(mode, key, defVal);
                applyStoredTheme();
              }}
            />
          );
        })}
      </Section>
      <p className="text-[10px] text-t-muted px-1">
        These override the auto-generated values from the Brand tab.
      </p>
    </div>
  );
};

// ─── Tab: Glass ───────────────────────────────────────────────────────────────

const GLASS_SLIDERS: {
  key: keyof GlassConfig;
  label: string;
  sub: string;
  min: number;
  max: number;
  unit: string;
}[] = [
  {
    key: "blur",
    label: "Blur",
    sub: "backdrop-filter blur",
    min: 0,
    max: 60,
    unit: "px",
  },
  {
    key: "saturation",
    label: "Saturation",
    sub: "backdrop-filter saturate",
    min: 80,
    max: 300,
    unit: "%",
  },
  {
    key: "brightness",
    label: "Brightness",
    sub: "backdrop-filter brightness",
    min: 80,
    max: 140,
    unit: "%",
  },
  {
    key: "bgOpacity",
    label: "Background opacity",
    sub: "surface color-mix amount",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "borderOpacity",
    label: "Border opacity",
    sub: "border color-mix amount",
    min: 0,
    max: 100,
    unit: "%",
  },
];

const GlassTab: React.FC = () => {
  const [config, setConfig] = useState<GlassConfig>(() => {
    try {
      const r = localStorage.getItem(LS_GLASS);
      if (r) return { ...GLASS_DEFAULTS, ...JSON.parse(r) };
    } catch {}
    return { ...GLASS_DEFAULTS };
  });

  const handleChange = (key: keyof GlassConfig, value: number) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    localStorage.setItem(LS_GLASS, JSON.stringify(next));
    // ── UNIFIED APPLY ──
    applyStoredTheme();
  };

  const handleReset = () => {
    setConfig({ ...GLASS_DEFAULTS });
    localStorage.removeItem(LS_GLASS);
    // ── UNIFIED APPLY ──
    applyStoredTheme();
  };

  const previewStyle: React.CSSProperties = {
    background: `color-mix(in srgb, var(--bg-surface) ${config.bgOpacity}%, transparent)`,
    backdropFilter: `blur(${config.blur}px) saturate(${
      config.saturation
    }%) brightness(${(config.brightness / 100).toFixed(2)})`,
    WebkitBackdropFilter: `blur(${config.blur}px) saturate(${
      config.saturation
    }%) brightness(${(config.brightness / 100).toFixed(2)})`,
    border: `1px solid color-mix(in srgb, var(--border-color) ${config.borderOpacity}%, transparent)`,
    boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
  };

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="relative rounded-2xl overflow-hidden h-28">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-brand) 0%, color-mix(in srgb, var(--color-brand) 40%, var(--bg-surface)) 100%)",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="w-full rounded-xl px-4 py-3" style={previewStyle}>
            <p className="text-xs font-semibold text-t-primary">
              Glass preview
            </p>
            <p className="text-[10px] text-t-muted mt-0.5">
              Blur {config.blur}px · Sat {config.saturation}% · Brightness{" "}
              {config.brightness}% · BG {config.bgOpacity}%
            </p>
          </div>
        </div>
      </div>

      <Section
        title="✨ Glass Effect"
        action={
          <button
            onClick={handleReset}
            className="text-[10px] text-t-muted hover:text-fail"
          >
            Reset
          </button>
        }
      >
        {GLASS_SLIDERS.map(({ key, label, sub, min, max, unit }) => (
          <div key={key} className="py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <p className="text-xs text-t-primary">{label}</p>
                <p className="text-[10px] text-t-muted">{sub}</p>
              </div>
              <code className="text-xs font-mono text-c-brand shrink-0">
                {config[key]}
                {unit}
              </code>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              value={config[key]}
              onChange={(e) => handleChange(key, Number(e.target.value))}
              className="w-full accent-[var(--c-brand)]"
            />
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-t-muted">
                {min}
                {unit}
              </span>
              <span className="text-[9px] text-t-muted">
                {max}
                {unit}
              </span>
            </div>
          </div>
        ))}
      </Section>

      <p className="text-[10px] text-t-muted px-1">
        Sliders write <code className="font-mono">--glass-blur</code>,{" "}
        <code className="font-mono">--glass-saturation</code>,{" "}
        <code className="font-mono">--glass-brightness</code>,{" "}
        <code className="font-mono">--glass-bg-opacity</code>, and{" "}
        <code className="font-mono">--glass-border-opacity</code> to{" "}
        <code className="font-mono">:root</code>. Both{" "}
        <code className="font-mono">.glass-frost</code> and{" "}
        <code className="font-mono">.glass-liquid</code> consume these vars, so
        changes apply live to the entire app.
      </p>
    </div>
  );
};

// ─── Panel ────────────────────────────────────────────────────────────────────

type Tab = "brand" | "light" | "dark" | "glass";

const ThemeEditorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { resetTokenOverrides, customTokens, resetAll } = useTheme();
  const [tab, setTab] = useState<Tab>("brand");
  const lc = Object.keys(customTokens.light).length;
  const dc = Object.keys(customTokens.dark).length;
  const total = lc + dc;

  const TABS: { id: Tab; label: string; badge?: string }[] = [
    { id: "brand", label: "Brand" },
    { id: "light", label: "Light", badge: lc ? `${lc}` : undefined },
    { id: "dark", label: "Dark", badge: dc ? `${dc}` : undefined },
    { id: "glass", label: "Glass" },
  ];

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-1.5">
          <Palette size={16} /> Theme Editor
        </span>
      }
      onClose={onClose}
    >
      <div className="flex items-center justify-between -mt-1 mb-3">
        <p className="text-xs text-t-muted">
          {total > 0
            ? `${total} override${total !== 1 ? "s" : ""} active`
            : "Admin only"}
        </p>
        {total > 0 && (
          <button
            onClick={() => {
              if (confirm("Reset ALL overrides?")) {
                resetAll();
              }
            }}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Reset All
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-semibold transition-colors
              ${
                tab === t.id
                  ? "bg-c-brand text-white"
                  : "bg-bg-card text-t-muted hover:text-t-secondary"
              }`}
          >
            {t.label}
            {t.badge && (
              <span
                className={`ml-1 text-[10px] font-bold
                ${tab === t.id ? "text-white/70" : "text-c-brand"}`}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1">
        {tab === "brand" && <BrandTab />}
        {tab === "light" && <ModeTab mode="light" />}
        {tab === "dark" && <ModeTab mode="dark" />}
        {tab === "glass" && <GlassTab />}
      </div>

      {/* ── DEBUG: SessionLog-style console dump ── */}
      <div className="mt-4 p-3 rounded-xl border border-dashed border-[var(--border-color)] bg-bg-card">
        <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-2">
          🔍 Debug Tools
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              console.group("📋 THEME STATE DUMP");
              console.log("localStorage.theme:", localStorage.getItem("theme"));
              console.log(
                "localStorage.themeEditorGlass:",
                localStorage.getItem("themeEditorGlass")
              );
              console.log(
                "localStorage.themeEditorBrandPalette:",
                localStorage.getItem("themeEditorBrandPalette")
              );
              console.log(
                "localStorage.themeEditorStatusColors:",
                localStorage.getItem("themeEditorStatusColors")
              );
              console.log(
                "localStorage.themeEditorOverrides:",
                localStorage.getItem("themeEditorOverrides")
              );
              console.log("document.documentElement styles:");
              const s = getComputedStyle(document.documentElement);
              console.log(
                "  --color-brand:",
                s.getPropertyValue("--color-brand")
              );
              console.log(
                "  --glass-blur:",
                s.getPropertyValue("--glass-blur")
              );
              console.log("  --bg-base:", s.getPropertyValue("--bg-base"));
              console.groupEnd();
            }}
            className="text-[10px] px-2 py-1 rounded bg-bg-surface border border-[var(--border-color)] text-t-secondary hover:text-t-primary"
          >
            Dump localStorage + CSS
          </button>
          <button
            onClick={() => {
              console.clear();
              console.log("🧹 Console cleared");
            }}
            className="text-[10px] px-2 py-1 rounded bg-bg-surface border border-[var(--border-color)] text-t-secondary hover:text-t-primary"
          >
            Clear Console
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

// ─── Exported wrapper ─────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

const ThemeEditor: React.FC<Props> = ({ onClose }) => {
  const { user } = useAuth();
  if (user?.role !== "admin") return null;

  return <ThemeEditorPanel onClose={onClose} />;
};

export default ThemeEditor;
