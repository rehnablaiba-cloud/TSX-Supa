// src/components/ThemeEditor/ThemeEditorPanel.tsx
/**
 * ThemeEditorPanel.tsx
 * Migration-friendly Theme Editor
 * - Uses ThemeContext as the main source of truth
 * - Keeps old LS_BASE fallback for smoother migration
 * - User-friendly layout with live updates
 */

import React, { useEffect, useMemo, useState } from "react";
import { Moon, Palette, RotateCcw, Sun } from "lucide-react";
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
  GLASS_DEFAULTS,
} from "../../theme";

type Tab = "brand" | "light" | "dark" | "glass";
type StatusKey = "pass" | "fail" | "pend" | "warn";

const LS_BASE = "themeEditorBaseColor";

const defaultBrandPalette = defaultPalette.brand as Record<BrandShade, string>;
const defaultStatusColors: Record<StatusKey, string> = {
  pass: defaultPalette.pass,
  fail: defaultPalette.fail,
  pend: defaultPalette.pend,
  warn: defaultPalette.warn,
};

const BRAND_LIGHT_MAP: Partial<Record<BrandShade, TokenKey>> = {
  50: "colorBrandBg",
  600: "colorBrand",
  700: "colorBrandHover",
};

const BRAND_DARK_MAP: Partial<Record<BrandShade, TokenKey>> = {
  400: "colorBrandHover",
  500: "colorBrand",
};

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
] as const;

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
    sub: "Backdrop softness",
    min: 0,
    max: 60,
    unit: "px",
  },
  {
    key: "saturation",
    label: "Saturation",
    sub: "Backdrop color intensity",
    min: 80,
    max: 300,
    unit: "%",
  },
  {
    key: "brightness",
    label: "Brightness",
    sub: "Backdrop light boost",
    min: 80,
    max: 140,
    unit: "%",
  },
  {
    key: "bgOpacity",
    label: "Glass overlay opacity",
    sub: ".glass-frost and .glass-liquid",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "borderOpacity",
    label: "Glass border opacity",
    sub: "Shared glass border strength",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "navBgOpacity",
    label: "Mobile nav opacity",
    sub: ".glass-nav background mix",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "popupBgOpacity",
    label: "Popup opacity",
    sub: ".glass-popup background mix",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "cardBgOpacity",
    label: "Card opacity",
    sub: ".glass card background mix",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "cardBorderOpacity",
    label: "Card border opacity",
    sub: ".glass card border mix",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "backdropDimOpacity",
    label: "Backdrop dim",
    sub: ".backdrop-dim scrim strength",
    min: 0,
    max: 100,
    unit: "%",
  },
];

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  let h = 0;
  let s = 0;
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
  const hh = h / 360;
  const ss = s / 100;
  const ll = l / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;

  if (ss === 0) {
    r = g = b = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    r = hue2rgb(p, q, hh + 1 / 3);
    g = hue2rgb(p, q, hh);
    b = hue2rgb(p, q, hh - 1 / 3);
  }

  const toHexPart = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}`;
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
  400: 1,
  500: 1,
  600: 1,
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
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[1].repeat(2)}${v[2].repeat(2)}${v[3].repeat(2)}`;
  }
  return "#888888";
}

function getLegacyBaseColorFallback(): string {
  if (typeof window === "undefined") return defaultBrandPalette[500];
  return localStorage.getItem(LS_BASE) ?? defaultBrandPalette[500];
}

function countActiveOverrides(
  mode: "light" | "dark",
  customTokens: Record<"light" | "dark", Partial<Record<TokenKey, string>>>
) {
  return KEY_TOKENS.filter(({ key }) => {
    const current = customTokens[mode][key];
    return current !== undefined && current !== defaultTokens[mode][key];
  }).length;
}

const Swatch: React.FC<{
  color: string;
  label: string;
  hint?: string;
  onChange: (v: string) => void;
  onReset?: () => void;
  isOverridden?: boolean;
}> = ({ color, label, hint, onChange, onReset, isOverridden }) => (
  <div className="flex items-center gap-3 py-2.5">
    <label
      className="relative w-10 h-10 rounded-xl border border-(--border-color) cursor-pointer shrink-0 overflow-hidden shadow-xs"
      style={{ backgroundColor: color }}
    >
      <input
        type="color"
        value={toHex(color)}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
      />
    </label>

    <div className="flex-1 min-w-0">
      <p className="text-xs text-t-primary truncate">{label}</p>
      {hint && <p className="text-[10px] text-t-muted mt-0.5">{hint}</p>}
    </div>

    <code className="text-[10px] font-mono text-t-muted shrink-0">{color}</code>

    {isOverridden && onReset && (
      <button
        onClick={onReset}
        className="text-xs text-t-muted hover:text-fail shrink-0 ml-1"
        title="Reset"
      >
        ↺
      </button>
    )}
  </div>
);

const Section: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, action, children }) => (
  <div>
    <div className="flex items-start justify-between gap-3 mb-2">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
          {title}
        </p>
        {subtitle && <p className="text-[10px] text-t-muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>

    <div className="bg-bg-card rounded-xl border border-(--border-color) px-3 divide-y divide-(--border-color)">
      {children}
    </div>
  </div>
);

const BrandTab: React.FC = () => {
  const {
    brandPalette,
    setBrandPalette,
    setTokenOverride,
    statusColors,
    setStatusColor,
    theme,
  } = useTheme();

  const [baseColor, setBaseColor] = useState<string>(() => {
    return brandPalette?.[500] ?? brandPalette?.[600] ?? getLegacyBaseColorFallback();
  });

  useEffect(() => {
    setBaseColor(
      brandPalette?.[500] ?? brandPalette?.[600] ?? getLegacyBaseColorFallback()
    );
  }, [brandPalette]);

  const effectivePalette = useMemo(() => {
    if (brandPalette && Object.keys(brandPalette).length > 0) {
      return {
        ...defaultBrandPalette,
        ...brandPalette,
      } as Record<BrandShade, string>;
    }
    return generatePalette(baseColor);
  }, [brandPalette, baseColor]);

  const applyGeneratedBrand = (hex: string) => {
    const pal = generatePalette(hex);
    setBaseColor(hex);
    setBrandPalette(pal);

    for (const shade of BRAND_SHADES) {
      const lightKey = BRAND_LIGHT_MAP[shade];
      const darkKey = BRAND_DARK_MAP[shade];
      if (lightKey) setTokenOverride("light", lightKey, pal[shade]);
      if (darkKey) setTokenOverride("dark", darkKey, pal[shade]);
    }

    if (typeof window !== "undefined") {
      localStorage.setItem(LS_BASE, hex);
    }
  };

  const resetBrand = () => {
    setBaseColor(defaultBrandPalette[500]);
    setBrandPalette(null);

    setTokenOverride("light", "colorBrandBg", defaultTokens.light.colorBrandBg);
    setTokenOverride("light", "colorBrand", defaultTokens.light.colorBrand);
    setTokenOverride(
      "light",
      "colorBrandHover",
      defaultTokens.light.colorBrandHover
    );

    setTokenOverride("dark", "colorBrand", defaultTokens.dark.colorBrand);
    setTokenOverride(
      "dark",
      "colorBrandHover",
      defaultTokens.dark.colorBrandHover
    );

    if (typeof window !== "undefined") {
      localStorage.removeItem(LS_BASE);
    }
  };

  const resetStatuses = () => {
    (Object.keys(defaultStatusColors) as StatusKey[]).forEach((key) => {
      setStatusColor(key, defaultStatusColors[key]);
    });
  };

  return (
    <div className="flex flex-col gap-5 pb-6">
      <Section
        title="Brand color"
        subtitle={`Pick one base color and the full palette is generated automatically. Current mode: ${theme}.`}
        action={
          <button
            onClick={resetBrand}
            className="text-[10px] text-t-muted hover:text-fail"
          >
            Reset
          </button>
        }
      >
        <div className="py-3">
          <label
            className="flex items-center gap-4 p-4 rounded-2xl border cursor-pointer bg-bg-surface transition-colors"
            style={{ borderColor: `${baseColor}55` }}
          >
            <div
              className="w-14 h-14 rounded-2xl shadow-lg shrink-0 relative overflow-hidden border-2"
              style={{ backgroundColor: baseColor, borderColor: baseColor }}
            >
              <input
                type="color"
                value={toHex(baseColor)}
                onChange={(e) => applyGeneratedBrand(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-semibold text-t-primary">
                Pick one base color
              </p>
              <p className="text-xs text-t-muted mt-0.5">
                The full 50-900 palette updates instantly.
              </p>
              <code className="text-xs font-mono text-c-brand mt-1 block">
                {baseColor}
              </code>
            </div>
          </label>
        </div>

        <div className="py-3">
          <div className="grid grid-cols-4 gap-1.5">
            {PRESETS.map((preset) => {
              const active = baseColor.toLowerCase() === preset.color.toLowerCase();
              return (
                <button
                  key={preset.name}
                  onClick={() => applyGeneratedBrand(preset.color)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all"
                  style={{
                    backgroundColor: active ? `${preset.color}22` : undefined,
                    borderColor: active ? preset.color : "var(--border-color)",
                    color: active ? preset.color : "var(--text-secondary)",
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: preset.color }}
                  />
                  {preset.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="py-3">
          <div className="flex rounded-xl overflow-hidden border border-(--border-color) h-9">
            {BRAND_SHADES.map((shade) => (
              <div
                key={shade}
                className="flex-1"
                style={{ backgroundColor: effectivePalette[shade] }}
                title={`${shade}: ${effectivePalette[shade]}`}
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
      </Section>

      <Section
        title="Status colors"
        subtitle="Controls pass, fail, pending, and warning states across the app."
        action={
          <button
            onClick={resetStatuses}
            className="text-[10px] text-t-muted hover:text-fail"
          >
            Reset
          </button>
        }
      >
        {(Object.keys(defaultStatusColors) as StatusKey[]).map((key) => {
          const current = statusColors[key] ?? defaultStatusColors[key];
          const labelMap: Record<StatusKey, string> = {
            pass: "Pass",
            fail: "Fail",
            pend: "Pending",
            warn: "Warning",
          };

          return (
            <Swatch
              key={key}
              color={current}
              label={labelMap[key]}
              hint={`--color-${key}`}
              onChange={(v) => setStatusColor(key, v)}
              isOverridden={current !== defaultStatusColors[key]}
              onReset={() => setStatusColor(key, defaultStatusColors[key])}
            />
          );
        })}
      </Section>
    </div>
  );
};

const ModeTab: React.FC<{ mode: "light" | "dark" }> = ({ mode }) => {
  const { customTokens, setTokenOverride } = useTheme();
  const activeCount = countActiveOverrides(mode, customTokens);

  return (
    <div className="flex flex-col gap-5 pb-6">
      <Section
        title={`${mode === "light" ? "Light" : "Dark"} mode`}
        subtitle="Fine-tune semantic colors for this mode only."
        action={
          activeCount > 0 ? (
            <span className="text-[10px] text-c-brand font-semibold">
              {activeCount} active
            </span>
          ) : null
        }
      >
        {KEY_TOKENS.map(({ key, label }) => {
          const current = customTokens[mode][key] ?? defaultTokens[mode][key];
          const defVal = defaultTokens[mode][key];
          const isOverridden =
            customTokens[mode][key] !== undefined &&
            customTokens[mode][key] !== defVal;

          return (
            <Swatch
              key={key}
              color={current}
              label={label}
              hint={key}
              onChange={(v) => setTokenOverride(mode, key, v)}
              isOverridden={isOverridden}
              onReset={() => setTokenOverride(mode, key, defVal)}
            />
          );
        })}
      </Section>

      <p className="text-[10px] text-t-muted px-1">
        Mode overrides sit on top of the generated brand palette.
      </p>
    </div>
  );
};

const GlassTab: React.FC = () => {
  const { glassConfig, setGlassConfig } = useTheme();
  const config = glassConfig ?? { ...GLASS_DEFAULTS };

  const handleChange = (key: keyof GlassConfig, value: number) => {
    setGlassConfig({ ...config, [key]: value });
  };

  const handleReset = () => {
    setGlassConfig({ ...GLASS_DEFAULTS });
  };

  const previewStyle: React.CSSProperties = {
    background: `color-mix(in srgb, var(--bg-surface) ${config.bgOpacity}%, transparent)`,
    backdropFilter: `blur(${config.blur}px) saturate(${config.saturation}%) brightness(${(
      config.brightness / 100
    ).toFixed(2)})`,
    WebkitBackdropFilter: `blur(${config.blur}px) saturate(${config.saturation}%) brightness(${(
      config.brightness / 100
    ).toFixed(2)})`,
    border: `1px solid color-mix(in srgb, var(--border-color) ${config.borderOpacity}%, transparent)`,
    boxShadow: "0 8px 32px color-mix(in srgb, var(--bg-base) 70%, transparent)",
  };

  const miniGlass = (opacity: number, borderOpacity = config.borderOpacity) => ({
    background: `color-mix(in srgb, var(--bg-surface) ${opacity}%, transparent)`,
    border: `1px solid color-mix(in srgb, var(--border-color) ${borderOpacity}%, transparent)`,
    backdropFilter: `blur(${config.blur}px) saturate(${config.saturation}%) brightness(${(
      config.brightness / 100
    ).toFixed(2)})`,
    WebkitBackdropFilter: `blur(${config.blur}px) saturate(${config.saturation}%) brightness(${(
      config.brightness / 100
    ).toFixed(2)})`,
  });

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="relative rounded-2xl overflow-hidden h-36">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-brand) 0%, color-mix(in srgb, var(--color-brand) 35%, var(--bg-surface)) 100%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `color-mix(in srgb, var(--bg-base) ${config.backdropDimOpacity}%, transparent)`,
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="w-full rounded-xl px-4 py-3" style={previewStyle}>
            <p className="text-xs font-semibold text-t-primary">Glass preview</p>
            <p className="text-[10px] text-t-muted mt-0.5">
              Blur {config.blur}px · Sat {config.saturation}% · Brightness{" "}
              {config.brightness}% · BG {config.bgOpacity}% · Border{" "}
              {config.borderOpacity}%
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-3" style={miniGlass(config.navBgOpacity)}>
          <p className="text-[10px] font-semibold text-t-primary">Mobile nav</p>
          <p className="text-[9px] text-t-muted mt-1">
            {config.navBgOpacity}% opacity
          </p>
        </div>
        <div className="rounded-xl p-3" style={miniGlass(config.popupBgOpacity)}>
          <p className="text-[10px] font-semibold text-t-primary">Popup</p>
          <p className="text-[9px] text-t-muted mt-1">
            {config.popupBgOpacity}% opacity
          </p>
        </div>
        <div
          className="rounded-xl p-3"
          style={miniGlass(config.cardBgOpacity, config.cardBorderOpacity)}
        >
          <p className="text-[10px] font-semibold text-t-primary">Card</p>
          <p className="text-[9px] text-t-muted mt-1">
            BG {config.cardBgOpacity}% · Border {config.cardBorderOpacity}%
          </p>
        </div>
      </div>

      <Section
        title="Glass effect"
        subtitle="These values update shared glass surfaces live across the app."
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
              className="w-full"
              style={{ accentColor: "var(--color-brand)" }}
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
    </div>
  );
};

const ThemeEditorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { customTokens, resetAll, theme, setTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("brand");

  const lightCount = countActiveOverrides("light", customTokens);
  const darkCount = countActiveOverrides("dark", customTokens);
  const totalModeOverrides = lightCount + darkCount;

  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: "brand", label: "Brand" },
    { id: "light", label: "Light", badge: lightCount ? String(lightCount) : undefined },
    { id: "dark", label: "Dark", badge: darkCount ? String(darkCount) : undefined },
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
      <div className="flex items-center justify-between gap-3 -mt-1 mb-4 flex-wrap">
        <div>
          <p className="text-xs text-t-muted">
            {totalModeOverrides > 0
              ? `${totalModeOverrides} mode override${totalModeOverrides !== 1 ? "s" : ""} active`
              : "Changes save automatically"}
          </p>
          <p className="text-[10px] text-t-muted mt-1">
            Brand, status, glass, and mode colors update live.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl border border-(--border-color) bg-bg-card p-1">
            <button
              onClick={() => setTheme("light")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                theme === "light"
                  ? "bg-c-brand text-(--bg-surface)"
                  : "text-t-muted hover:text-t-primary"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Sun size={13} /> Light
              </span>
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                theme === "dark"
                  ? "bg-c-brand text-(--bg-surface)"
                  : "text-t-muted hover:text-t-primary"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Moon size={13} /> Dark
              </span>
            </button>
          </div>

          <button
            onClick={() => {
              if (confirm("Reset all theme changes and return to defaults?")) {
                resetAll();
              }
            }}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-fail/10 text-fail hover:bg-fail/20 transition-colors"
          >
            <RotateCcw size={13} />
            Reset All
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-semibold transition-colors ${
              tab === t.id
                ? "bg-c-brand text-(--bg-surface)"
                : "bg-bg-card text-t-muted hover:text-t-secondary"
            }`}
          >
            {t.label}
            {t.badge && (
              <span
                className={`ml-1 text-[10px] font-bold ${
                  tab === t.id ? "text-(--bg-surface)/70" : "text-c-brand"
                }`}
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
    </ModalShell>
  );
};

interface Props {
  onClose: () => void;
}

const ThemeEditor: React.FC<Props> = ({ onClose }) => {
  const { user } = useAuth();
  if (user?.role !== "admin") return null;
  return <ThemeEditorPanel onClose={onClose} />;
};

export default ThemeEditor;