/**
 * ThemeEditorPanel.tsx
 * Tabs: Palette | Light | Dark | MUI
 */

import React, { useState, useRef, useEffect } from "react";
import { useTheme, MuiConfig, MUI_CONFIG_DEFAULTS } from "../../context/ThemeContext";
import { verifyThemePassword } from "../../config/themeEditorConfig";
import { tokens as defaultTokens, palette as defaultPalette, TokenKey } from "../../theme";

type Mode = "light" | "dark";

// ─── Token groups ─────────────────────────────────────────────────────────────

const TOKEN_GROUPS: { label: string; icon: string; keys: TokenKey[] }[] = [
  { label: "Brand",       icon: "🎨", keys: ["colorBrand", "colorBrandHover", "colorBrandBg"] },
  { label: "Backgrounds", icon: "🖼",  keys: ["bgBase", "bgSurface", "bgCard", "bgNav"] },
  { label: "Text",        icon: "🔤", keys: ["textPrimary", "textSecondary", "textMuted"] },
  { label: "Borders",     icon: "▭",  keys: ["borderColor"] },
  { label: "Inputs",      icon: "📝", keys: ["inputBg", "inputBorder", "inputText"] },
  { label: "Glass",       icon: "✨", keys: ["glassBg", "glassBorder"] },
  { label: "Gradient",    icon: "🌈", keys: ["gradFrom", "gradVia", "gradTo"] },
];

const TOKEN_LABELS: Record<TokenKey, string> = {
  bgBase:"Base Background", bgSurface:"Surface", bgCard:"Card", bgNav:"Navigation",
  borderColor:"Border", textPrimary:"Primary Text", textSecondary:"Secondary Text",
  textMuted:"Muted Text", inputBg:"Input Background", inputBorder:"Input Border",
  inputText:"Input Text", glassBg:"Glass Background", glassBorder:"Glass Border",
  gradFrom:"Gradient From", gradVia:"Gradient Via", gradTo:"Gradient To",
  colorBrand:"Brand Color", colorBrandHover:"Brand Hover", colorBrandBg:"Brand Background",
};

const BRAND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
type BrandShade = typeof BRAND_SHADES[number];
const STATUS_KEYS = ["pass", "fail", "pend"] as const;
type StatusKey = typeof STATUS_KEYS[number];
const STATUS_LABELS: Record<StatusKey, string> = { pass:"Pass ✅", fail:"Fail ❌", pend:"Pending ⏳" };
const LS_BRAND_KEY = "themeEditorBrandPalette";
const LS_STATUS_KEY = "themeEditorStatusColors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toHexColor(v: string): string {
  if (!v) return "#000000";
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v.length === 4
    ? "#" + v[1].repeat(2) + v[2].repeat(2) + v[3].repeat(2) : v.slice(0, 7);
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return `#${(+m[1]).toString(16).padStart(2,"0")}${(+m[2]).toString(16).padStart(2,"0")}${(+m[3]).toString(16).padStart(2,"0")}`;
  return "#888888";
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

const ColorRow: React.FC<{
  label: string; value: string; defaultValue: string;
  onChange: (v: string) => void; isOverridden: boolean; onReset: () => void;
}> = ({ label, value, defaultValue, onChange, isOverridden, onReset }) => (
  <div className="flex items-center gap-2 py-1.5">
    <label className="relative w-8 h-8 rounded-lg border border-[var(--border-color)] cursor-pointer shrink-0 overflow-hidden shadow-sm"
      style={{ backgroundColor: value || "#888" }}>
      <input type="color" value={toHexColor(value)} onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
    </label>
    <span className="text-xs text-t-secondary flex-1 min-w-0 truncate">{label}</span>
    <input type="text" value={value} onChange={e => onChange(e.target.value)} spellCheck={false}
      className="w-28 text-xs font-mono px-2 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] focus:outline-none focus:border-c-brand transition-colors" />
    {isOverridden && (
      <button onClick={onReset} title={`Reset to: ${defaultValue}`}
        className="text-xs text-t-muted hover:text-fail transition-colors shrink-0">↺</button>
    )}
  </div>
);

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button onClick={() => onChange(!value)}
    className={`w-12 h-6 rounded-full transition-colors relative shrink-0
      ${value ? "bg-c-brand" : "bg-bg-base border border-[var(--border-color)]"}`}>
    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
      ${value ? "translate-x-6" : "translate-x-0.5"}`} />
  </button>
);

const Row: React.FC<{ label: string; sub?: string; children: React.ReactNode }> =
  ({ label, sub, children }) => (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-t-primary">{label}</p>
        {sub && <p className="text-[10px] text-t-muted">{sub}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

const NumInput: React.FC<{ value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }> =
  ({ value, onChange, min = 0, max = 100, step = 1 }) => (
    <input type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value))}
      className="w-16 text-xs font-mono text-center px-2 py-1 rounded-lg
        bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)]
        focus:outline-none focus:border-c-brand transition-colors" />
  );

// ─── Password Gate ────────────────────────────────────────────────────────────

const PasswordGate: React.FC<{ onUnlock: () => void; onCancel: () => void }> = ({ onUnlock, onCancel }) => {
  const [pw, setPw] = useState(""); const [error, setError] = useState(""); const [checking, setChecking] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = async () => {
    if (!pw.trim()) return; setChecking(true); setError("");
    const ok = await verifyThemePassword(pw); setChecking(false);
    if (ok) onUnlock(); else { setError("Incorrect password."); setPw(""); ref.current?.focus(); }
  };
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 py-10">
      <div className="text-4xl">🔒</div>
      <div className="text-center">
        <p className="font-semibold text-t-primary text-base">Theme Editor</p>
        <p className="text-xs text-t-muted mt-1">Enter admin password to continue</p>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <input ref={ref} type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="Password"
          className="w-full px-4 py-3 rounded-xl text-sm bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
        {error && <p className="text-fail text-xs text-center">{error}</p>}
        <button onClick={submit} disabled={checking || !pw.trim()}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-c-brand text-white hover:bg-c-brand-hover disabled:opacity-50 transition-colors">
          {checking ? "Checking…" : "Unlock"}
        </button>
        <button onClick={onCancel} className="py-2 text-xs text-t-muted hover:text-t-secondary transition-colors">Cancel</button>
      </div>
    </div>
  );
};

// ─── Token Editor tab ─────────────────────────────────────────────────────────

const TokenEditor: React.FC<{ mode: Mode }> = ({ mode }) => {
  const { customTokens, setTokenOverride } = useTheme();
  return (
    <div className="flex flex-col gap-5 pb-6">
      {TOKEN_GROUPS.map(group => (
        <div key={group.label}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-2">{group.icon} {group.label}</p>
          <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3">
            {group.keys.map((key, i) => {
              const value = customTokens[mode][key] ?? defaultTokens[mode][key];
              const defValue = defaultTokens[mode][key];
              const isOverridden = customTokens[mode][key] !== undefined && customTokens[mode][key] !== defValue;
              return (
                <div key={key}>
                  <ColorRow label={TOKEN_LABELS[key]} value={value} defaultValue={defValue}
                    onChange={v => setTokenOverride(mode, key, v)} isOverridden={isOverridden}
                    onReset={() => setTokenOverride(mode, key, defValue)} />
                  {i < group.keys.length - 1 && <div className="border-t border-[var(--border-color)]" />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Palette & Status tab ─────────────────────────────────────────────────────

const BrandStatusEditor: React.FC = () => {
  const { theme, setTokenOverride } = useTheme();
  const [brandColors, setBrandColors] = useState<Record<BrandShade, string>>(() => {
    try { const r = localStorage.getItem(LS_BRAND_KEY); if (r) return JSON.parse(r); } catch {}
    return { ...defaultPalette.brand };
  });
  const [statusColors, setStatusColors] = useState<Record<StatusKey, string>>(() => {
    try { const r = localStorage.getItem(LS_STATUS_KEY); if (r) return JSON.parse(r); } catch {}
    return { pass: defaultPalette.pass, fail: defaultPalette.fail, pend: defaultPalette.pend };
  });

  const handleBrandChange = (shade: BrandShade, value: string) => {
    const next = { ...brandColors, [shade]: value }; setBrandColors(next);
    localStorage.setItem(LS_BRAND_KEY, JSON.stringify(next));
    const lm: Partial<Record<BrandShade, TokenKey>> = { 50:"colorBrandBg", 600:"colorBrand", 700:"colorBrandHover" };
    const dm: Partial<Record<BrandShade, TokenKey>> = { 500:"colorBrand", 400:"colorBrandHover" };
    if (lm[shade]) setTokenOverride("light", lm[shade]!, value);
    if (dm[shade]) setTokenOverride("dark",  dm[shade]!,  value);
  };

  const handleStatusChange = (key: StatusKey, value: string) => {
    const next = { ...statusColors, [key]: value }; setStatusColors(next);
    localStorage.setItem(LS_STATUS_KEY, JSON.stringify(next));
    document.documentElement.style.setProperty(`--color-${key}`, value);
  };

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">🎨 Brand Palette</p>
          <button onClick={() => { setBrandColors({ ...defaultPalette.brand } as any); localStorage.removeItem(LS_BRAND_KEY); }}
            className="text-[10px] text-t-muted hover:text-fail">Reset</button>
        </div>
        <div className="flex gap-1 mb-3">
          {BRAND_SHADES.map(shade => (
            <label key={shade} className="relative flex-1 h-8 rounded cursor-pointer overflow-hidden"
              style={{ backgroundColor: brandColors[shade] }}>
              <input type="color" value={toHexColor(brandColors[shade])} onChange={e => handleBrandChange(shade, e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
            </label>
          ))}
        </div>
        <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3">
          {BRAND_SHADES.map((shade, i) => (
            <div key={shade}>
              <ColorRow label={`brand-${shade}${shade===500?" · dark primary":shade===600?" · light primary":""}`}
                value={brandColors[shade]} defaultValue={String(defaultPalette.brand[shade])}
                onChange={v => handleBrandChange(shade, v)}
                isOverridden={brandColors[shade] !== String(defaultPalette.brand[shade])}
                onReset={() => handleBrandChange(shade, String(defaultPalette.brand[shade]))} />
              {i < BRAND_SHADES.length - 1 && <div className="border-t border-[var(--border-color)]" />}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">⚡ Status Colors</p>
          <button onClick={() => { setStatusColors({ pass:defaultPalette.pass, fail:defaultPalette.fail, pend:defaultPalette.pend }); localStorage.removeItem(LS_STATUS_KEY); }}
            className="text-[10px] text-t-muted hover:text-fail">Reset</button>
        </div>
        <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3">
          {STATUS_KEYS.map((key, i) => (
            <div key={key}>
              <ColorRow label={STATUS_LABELS[key]} value={statusColors[key]} defaultValue={defaultPalette[key]}
                onChange={v => handleStatusChange(key, v)} isOverridden={statusColors[key] !== defaultPalette[key]}
                onReset={() => handleStatusChange(key, defaultPalette[key])} />
              {i < STATUS_KEYS.length - 1 && <div className="border-t border-[var(--border-color)]" />}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-t-muted px-1">Active mode: <span className="font-semibold text-c-brand">{theme}</span> — Light and Dark tabs edit each mode independently.</p>
    </div>
  );
};

// ─── MUI tab ─────────────────────────────────────────────────────────────────

function buildMuiCode(cfg: MuiConfig): string {
  return `// 1. Install (if not done):
//    npm i @mui/material @emotion/react @emotion/styled
//
// 2. App.tsx already wraps with <MuiActivator> — done ✅
//    Toggle "Activate MUI ThemeProvider" above to turn it on.
//
// 3. Use MUI components anywhere alongside Tailwind:
//    <Button variant="contained">Save</Button>
//    <TextField label="Name" />
//
// Generated config (live-synced from your settings):
shape:      { borderRadius: ${cfg.borderRadius} }
typography: {
  fontFamily:        "${cfg.fontFamily}"
  fontSize:          ${cfg.fontSize}
  fontWeightRegular: ${cfg.fontWeightRegular}
  fontWeightMedium:  ${cfg.fontWeightMedium}
  fontWeightBold:    ${cfg.fontWeightBold}
  button.textTransform: "${cfg.buttonTextTransform}"
}
components:
  MuiButton    borderRadius: ${cfg.buttonBorderRadius}
  MuiTextField borderRadius: ${cfg.textFieldBorderRadius}
  MuiPaper     backgroundImage: ${cfg.disablePaperBgImage ? '"none"' : 'unset'}

// Colors are read live from CSS vars (--color-brand, --bg-base etc.)
// so they always match your Tailwind tokens automatically.`;
}

const MuiEditor: React.FC = () => {
  const { muiConfig, setMuiConfig, resetMuiConfig } = useTheme();
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const update = <K extends keyof MuiConfig>(key: K, value: MuiConfig[K]) =>
    setMuiConfig({ [key]: value });

  const handleCopy = () => {
    navigator.clipboard.writeText(buildMuiCode(muiConfig)).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-4 pb-6">

      {/* ── THE MAIN SWITCH ── */}
      <div className={`rounded-2xl border-2 p-4 transition-colors
        ${muiConfig.active
          ? "border-c-brand bg-c-brand-bg"
          : "border-[var(--border-color)] bg-bg-card"}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-t-primary text-sm">
              {muiConfig.active ? "✅ MUI ThemeProvider ON" : "MUI ThemeProvider"}
            </p>
            <p className="text-[11px] text-t-muted mt-0.5">
              {muiConfig.active
                ? "MUI components use this theme. Tailwind still works side-by-side."
                : "Off — app uses Tailwind only. Turn on to activate MUI globally."}
            </p>
          </div>
          <Toggle value={muiConfig.active} onChange={v => setMuiConfig({ active: v })} />
        </div>

        {muiConfig.active && (
          <div className="mt-3 pt-3 border-t border-c-brand/20 text-[11px] text-t-secondary space-y-1">
            <p>• MUI reads colors from <code className="font-mono text-c-brand">var(--color-brand)</code>, <code className="font-mono text-c-brand">var(--bg-base)</code> etc.</p>
            <p>• Changing tokens in the Light/Dark tabs updates MUI automatically.</p>
            <p>• Needs <code className="font-mono bg-black/10 px-1 rounded">@mui/material</code> installed — see banner below if not.</p>
          </div>
        )}
      </div>

      {/* Install check */}
      <div className="rounded-xl px-4 py-3 border bg-bg-card border-[var(--border-color)]">
        <p className="text-xs font-semibold text-t-primary mb-0.5">Install status</p>
        <code className="text-[11px] font-mono text-t-muted block">
          npm i @mui/material @emotion/react @emotion/styled
        </code>
        <p className="text-[10px] text-t-muted mt-1">
          If already installed, activating the toggle above applies the theme immediately. If not, a banner will appear — the app keeps working with Tailwind.
        </p>
      </div>

      {/* How it bridges Tailwind ↔ MUI */}
      <div className="rounded-xl px-4 py-3 border bg-bg-card border-[var(--border-color)]">
        <p className="text-xs font-semibold text-t-primary mb-1">🔗 How Tailwind ↔ MUI stay in sync</p>
        <p className="text-[11px] text-t-muted leading-relaxed">
          Both systems read from the same CSS custom properties. <code className="font-mono text-c-brand">bg-bg-surface</code> (Tailwind) and MUI's <code className="font-mono text-c-brand">background.paper</code> both resolve to <code className="font-mono text-c-brand">var(--bg-surface)</code>. Change a token → both update instantly. You can mix <code className="font-mono text-c-brand">sx</code> and Tailwind classes on the same element.
        </p>
      </div>

      {/* Typography */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">🔤 Typography</p>
          <button onClick={resetMuiConfig} className="text-[10px] text-t-muted hover:text-fail">Reset all</button>
        </div>
        <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3 divide-y divide-[var(--border-color)]">
          <Row label="Font family" sub="CSS font-family string">
            <input type="text" value={muiConfig.fontFamily} onChange={e => update("fontFamily", e.target.value)}
              className="w-40 text-xs font-mono px-2 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] focus:outline-none focus:border-c-brand transition-colors" />
          </Row>
          <Row label="Base font size" sub="px — MUI default 14">
            <NumInput value={muiConfig.fontSize} onChange={v => update("fontSize", v)} min={10} max={20} />
          </Row>
          <Row label="Weight regular" sub="Body text">
            <NumInput value={muiConfig.fontWeightRegular} onChange={v => update("fontWeightRegular", v)} min={100} max={900} step={100} />
          </Row>
          <Row label="Weight medium" sub="Buttons, labels">
            <NumInput value={muiConfig.fontWeightMedium} onChange={v => update("fontWeightMedium", v)} min={100} max={900} step={100} />
          </Row>
          <Row label="Weight bold" sub="Headings">
            <NumInput value={muiConfig.fontWeightBold} onChange={v => update("fontWeightBold", v)} min={100} max={900} step={100} />
          </Row>
          <Row label="Button text transform">
            <select value={muiConfig.buttonTextTransform} onChange={e => update("buttonTextTransform", e.target.value as any)}
              className="text-xs px-2 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] focus:outline-none focus:border-c-brand">
              <option value="none">none</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </Row>
        </div>
      </div>

      {/* Shape */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-2">📐 Shape & Components</p>
        <div className="bg-bg-card rounded-xl border border-[var(--border-color)] px-3 divide-y divide-[var(--border-color)]">
          <Row label="Global border radius" sub="shape.borderRadius px">
            <NumInput value={muiConfig.borderRadius} onChange={v => update("borderRadius", v)} min={0} max={32} />
          </Row>
          <Row label="Button radius" sub="MuiButton override px">
            <NumInput value={muiConfig.buttonBorderRadius} onChange={v => update("buttonBorderRadius", v)} min={0} max={32} />
          </Row>
          <Row label="TextField radius" sub="MuiOutlinedInput override px">
            <NumInput value={muiConfig.textFieldBorderRadius} onChange={v => update("textFieldBorderRadius", v)} min={0} max={32} />
          </Row>
          <Row label="Disable Paper background image" sub="Removes MUI gradient (recommended for dark mode)">
            <Toggle value={muiConfig.disablePaperBgImage} onChange={v => update("disablePaperBgImage", v)} />
          </Row>
        </div>

        {/* Live preview */}
        <div className="flex gap-2 mt-2 px-1">
          <div className="flex-1 h-9 bg-c-brand flex items-center justify-center text-white text-xs font-semibold shadow"
            style={{ borderRadius: muiConfig.buttonBorderRadius }}>Button</div>
          <div className="flex-1 h-9 bg-bg-card border border-[var(--border-color)] flex items-center justify-center text-t-muted text-xs"
            style={{ borderRadius: muiConfig.textFieldBorderRadius }}>TextField</div>
          <div className="flex-1 h-9 bg-bg-surface border border-[var(--border-color)] flex items-center justify-center text-t-muted text-xs"
            style={{ borderRadius: muiConfig.borderRadius }}>Paper</div>
        </div>
        <p className="text-[10px] text-t-muted px-1 mt-1">Live preview of border radii ↑</p>
      </div>

      {/* Code reference */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">📋 Config reference</p>
          <div className="flex gap-2">
            <button onClick={() => setShowCode(v => !v)} className="text-[10px] text-t-muted hover:text-t-secondary">
              {showCode ? "Hide" : "Show"}
            </button>
            <button onClick={handleCopy}
              className="text-[10px] px-2 py-1 rounded-lg bg-c-brand-bg text-c-brand border border-c-brand/20 hover:bg-c-brand hover:text-white transition-colors">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
        {showCode && (
          <pre className="text-[10px] font-mono leading-relaxed bg-bg-card border border-[var(--border-color)] rounded-xl p-3 overflow-x-auto whitespace-pre-wrap text-t-secondary">
            {buildMuiCode(muiConfig)}
          </pre>
        )}
      </div>
    </div>
  );
};

// ─── Main panel shell ─────────────────────────────────────────────────────────

type Tab = "brand" | "light" | "dark" | "mui";

const ThemeEditorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { resetTokenOverrides, customTokens, muiConfig } = useTheme();
  const [tab, setTab] = useState<Tab>("brand");
  const lc = Object.keys(customTokens.light).length;
  const dc = Object.keys(customTokens.dark).length;
  const total = lc + dc;

  const TABS: { id: Tab; label: string; badge?: number | string }[] = [
    { id: "brand", label: "Palette" },
    { id: "light", label: "Light", badge: lc || undefined },
    { id: "dark",  label: "Dark",  badge: dc || undefined },
    { id: "mui",   label: "MUI",   badge: muiConfig.active ? "ON" : undefined },
  ];

  return (
    <div className="md:hidden fixed inset-0 z-[60] flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl z-10 flex flex-col"
        style={{ backgroundColor:"var(--bg-surface)", borderTop:"1px solid var(--border-color)", maxHeight:"92dvh" }}>
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mt-3 mb-1 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-[var(--border-color)]">
          <div>
            <p className="font-semibold text-t-primary text-sm">🎨 Theme Editor</p>
            {total > 0 && <p className="text-[10px] text-c-brand">{total} token override{total !== 1 ? "s" : ""} active</p>}
          </div>
          <div className="flex gap-2">
            {total > 0 && (
              <button onClick={() => { if(confirm("Reset ALL token overrides?")) { resetTokenOverrides(); localStorage.removeItem("themeEditorBrandPalette"); localStorage.removeItem("themeEditorStatusColors"); }}}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Reset All</button>
            )}
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg bg-bg-card text-t-secondary hover:text-t-primary transition-colors">Done</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-2 shrink-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-2 px-2 rounded-xl text-xs font-semibold transition-colors
                ${tab === t.id ? "bg-c-brand text-white" : "bg-bg-card text-t-muted hover:text-t-secondary"}`}>
              {t.label}
              {t.badge !== undefined && (
                <span className={`ml-1 text-[10px] font-bold ${tab === t.id ? "text-white/70" : t.badge === "ON" ? "text-pass" : "text-c-brand"}`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-4 pt-2">
          {tab === "brand" && <BrandStatusEditor />}
          {tab === "light" && <TokenEditor mode="light" />}
          {tab === "dark"  && <TokenEditor mode="dark" />}
          {tab === "mui"   && <MuiEditor />}
        </div>
      </div>
    </div>
  );
};

// ─── Exported wrapper ─────────────────────────────────────────────────────────

const ThemeEditor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [state, setState] = useState<"password" | "open">(() =>
    sessionStorage.getItem("themeEditorUnlocked") === "1" ? "open" : "password"
  );
  const unlock = () => { sessionStorage.setItem("themeEditorUnlocked","1"); setState("open"); };

  if (state === "password") {
    return (
      <div className="md:hidden fixed inset-0 z-[60] flex items-end">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className="relative w-full rounded-t-2xl z-10"
          style={{ backgroundColor:"var(--bg-surface)", borderTop:"1px solid var(--border-color)", height:"55dvh" }}>
          <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mt-3" />
          <PasswordGate onUnlock={unlock} onCancel={onClose} />
        </div>
      </div>
    );
  }
  return <ThemeEditorPanel onClose={onClose} />;
};

export default ThemeEditor;
