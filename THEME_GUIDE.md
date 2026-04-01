# TestPro — Unified Theme System

> **One file to rule them all: `src/theme.ts`**

---

## Quick-start: change the brand colour

Open `src/theme.ts` and edit §1:

```ts
brand: {
  50:  "#fdf4ff",   // ← swap these hex values
  500: "#a855f7",   // ← for purple, for example
  600: "#9333ea",
  ...
},
```

Save. Done. The change propagates to:
- All CSS custom properties (via `applyTheme()`)
- Tailwind utility classes (`bg-c-brand`, `text-c-brand`, …)
- `btn-primary` button background
- Active nav highlights
- Every component that uses `var(--color-brand)`

---

## File overview

```
src/
  theme.ts                ← THE single source of truth
  context/
    ThemeContext.tsx       ← thin wrapper; calls applyTheme() from theme.ts
  index.css               ← CSS var fallback defaults only; driven by theme.ts at runtime
tailwind.config.js        ← references CSS vars; do not add colours here directly
```

---

## How it works

```
§1 palette (raw hex)
      ↓
§2 tokens (semantic names, light + dark)
      ↓
§3 cssVarMap (token key → CSS var name)
      ↓
§4 applyTheme(mode) → sets all CSS vars on <html> + toggles .dark class
      ↑
ThemeContext calls applyTheme() on every mode change
```

`tailwind.config.js` maps semantic Tailwind class names to CSS vars:

```js
"bg-surface":  "var(--bg-surface)"   // → bg-bg-surface class
"t-primary":   "var(--text-primary)" // → text-t-primary class
"c-brand":     "var(--color-brand)"  // → bg-c-brand, text-c-brand, border-c-brand
```

---

## Utility classes (use in components)

| Class | Resolves to |
|---|---|
| `bg-bg-base` | Page background |
| `bg-bg-surface` | Panel / modal background |
| `bg-bg-card` | Card background |
| `text-t-primary` | Main body text |
| `text-t-secondary` | Secondary / label text |
| `text-t-muted` | Placeholder / disabled text |
| `bg-c-brand` / `text-c-brand` | Brand accent |
| `bg-c-brand-bg` | Tinted brand background (for active states) |
| `text-pass` / `text-fail` / `text-pend` | Status colours |

CSS utility classes (defined in `index.css`):

| Class | Use for |
|---|---|
| `.glass` | Glassmorphism panel |
| `.card` | Standard card (glass + padding + radius) |
| `.btn-primary` | Primary CTA button |
| `.btn-ghost` | Secondary / icon button |
| `.input` | Text input |
| `.badge-pass/fail/pend/admin/tester` | Status badges |

---

## Switching to MUI

1. Install: `npm install @mui/material @emotion/react @emotion/styled`
2. Uncomment §6 in `src/theme.ts`
3. In `App.tsx`:
   ```tsx
   import { ThemeProvider as MuiProvider } from "@mui/material/styles";
   import { createMuiTheme } from "./theme";
   import { useTheme } from "./context/ThemeContext";

   // Inside AppInner:
   const { theme } = useTheme();
   return (
     <MuiProvider theme={createMuiTheme(theme)}>
       {/* rest of app */}
     </MuiProvider>
   );
   ```
4. MUI components now inherit brand, status, and surface colours from `src/theme.ts`.
   You can still use CSS vars and Tailwind classes alongside MUI.

---

## Using GSAP with theme colours

Uncomment §7 in `src/theme.ts`, then:

```ts
import { gsapColors } from "../theme";

gsap.to(element, {
  backgroundColor: gsapColors.brand(), // reads CSS var → correct for current mode
  color: gsapColors.pass,              // static green
});
```

`gsapColors.brand()` is a getter function (not a static string) so it always
returns the correct value for whichever mode is currently active.

---

## Adding a new colour token

1. Add it to `TokenKey` type in `theme.ts`
2. Add its value to both `tokens.light` and `tokens.dark`
3. Add its CSS var name to `cssVarMap`
4. Add the CSS var reference to `tailwind.config.js` colors
5. Optionally add a CSS utility to `index.css`

---

## Preset colour schemes

To switch the whole app's palette, replace `palette.brand` in §1:

```ts
// Emerald
brand: { 500: "#10b981", 600: "#059669", 700: "#047857", ... }

// Violet
brand: { 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", ... }

// Rose
brand: { 500: "#f43f5e", 600: "#e11d48", 700: "#be123c", ... }
```

The rest of the tokens (`pass`, `fail`, `pend`) stay the same unless you
want to change them too.
