/**
 * audit-glass.mjs
 * ─────────────────────────────────────────────────────────────────
 * Scans your src/ directory for hardcoded glass / opacity / backdrop
 * values that bypass the --glass-* CSS var system.
 *
 * Usage:
 *   node audit-glass.mjs              (scans ./src by default)
 *   node audit-glass.mjs ./src        (explicit path)
 *   node audit-glass.mjs --fix        (prints sed hints to fix)
 * ─────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

const ROOT = process.argv[2]?.startsWith("--") ? "./src" : (process.argv[2] ?? "./src");
const FIX_MODE = process.argv.includes("--fix");

// ── Rule definitions ──────────────────────────────────────────────
const RULES = [
  // 1. Hardcoded backdropFilter in inline style (not using CSS var)
  {
    id: "HARDCODED_BACKDROP",
    severity: "ERROR",
    description: "Hardcoded backdropFilter/WebkitBackdropFilter bypasses --glass-blur/saturation/brightness vars",
    pattern: /backdropFilter\s*:\s*["'`][^"'`]*blur\(\d+px\)/g,
    suggestion: "Remove inline backdropFilter — let glass-frost/glass-liquid class handle it via --glass-* vars",
  },
  {
    id: "HARDCODED_WEBKIT_BACKDROP",
    severity: "ERROR",
    description: "Hardcoded WebkitBackdropFilter bypasses CSS var system",
    pattern: /WebkitBackdropFilter\s*:\s*["'`][^"'`]*blur\(\d+px\)/g,
    suggestion: "Remove inline WebkitBackdropFilter — use glass-frost class instead",
  },

  // 2. Hardcoded background opacity on glass surfaces (not using --glass-bg-opacity)
  {
    id: "HARDCODED_BG_OPACITY",
    severity: "ERROR",
    description: "Hardcoded % in color-mix background bypasses --glass-bg-opacity var",
    pattern: /background\s*:\s*`?color-mix\(in srgb,\s*var\(--bg-(?:surface|card|base)\)\s+\d+%/g,
    suggestion: "Replace hardcoded % with var(--glass-bg-opacity): color-mix(in srgb, var(--bg-surface) var(--glass-bg-opacity), transparent)",
  },

  // 3. Hardcoded border opacity (not using --glass-border-opacity)
  {
    id: "HARDCODED_BORDER_OPACITY",
    severity: "ERROR",
    description: "Hardcoded % in border color-mix bypasses --glass-border-opacity var",
    pattern: /border\s*:\s*`?[`"']?1px solid color-mix\(in srgb,\s*var\(--border-color\)\s+\d+%/g,
    suggestion: "Replace hardcoded % with var(--glass-border-opacity)",
  },

  // 4. useMemo returning inline glass styles (the glassNav anti-pattern)
  {
    id: "GLASS_USEMEMO",
    severity: "ERROR",
    description: "useMemo returning glass styles — these bypass the CSS var system",
    pattern: /useMemo\s*\(\s*\(\s*\)\s*:\s*React\.CSSProperties\s*=>\s*\(\s*\{[\s\S]{0,300}backdropFilter/g,
    suggestion: "Delete the useMemo and apply glass-frost/glass-liquid className instead",
  },

  // 5. Inline opacity values on nav icons/labels (should use CSS vars or higher values)
  {
    id: "LOW_OPACITY_INLINE",
    severity: "WARN",
    description: "Very low inline opacity (≤0.5) on text/icon — likely invisible on dark themes",
    pattern: /opacity\s*:\s*(?:highlighted\s*\?\s*1\s*:\s*)?0\.[0-4]\d*/g,
    suggestion: "Raise inactive opacity to 0.65–0.75 minimum for legibility",
  },

  // 6. Hardcoded rgba box-shadow instead of CSS vars
  {
    id: "HARDCODED_SHADOW",
    severity: "WARN",
    description: "Hardcoded rgba() in boxShadow — use color-mix with CSS vars for theme consistency",
    pattern: /boxShadow\s*:\s*["'`][^"'`]*rgba\(\d+\s*,\s*\d+\s*,\s*\d+/g,
    suggestion: "Replace rgba() with color-mix(in srgb, var(--bg-base) X%, transparent) for theme awareness",
  },

  // 7. glass-frost class paired with inline background override (negates the class)
  {
    id: "GLASS_FROST_OVERRIDDEN",
    severity: "ERROR",
    description: "glass-frost class is overridden by an inline background style on the same element",
    // Detect: className="...glass-frost..." with a style prop containing background on the same JSX element
    pattern: /className="[^"]*glass-frost[^"]*"[\s\S]{0,300}style=\{[\s\S]{0,300}background\s*:/g,
    suggestion: "Remove the inline background — glass-frost already sets it via --glass-* vars",
  },

  // 8. Hardcoded blur values in CSS/style (not using var(--glass-blur))
  {
    id: "HARDCODED_BLUR_VAR",
    severity: "WARN",
    description: "Hardcoded blur px value — use var(--glass-blur) for global ThemeEditor control",
    pattern: /blur\(\d{2,}px\)/g,
    suggestion: "Replace blur(28px) etc. with blur(var(--glass-blur))",
  },
];

// ── File walker ───────────────────────────────────────────────────
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css"];

function walk(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "dist", "build"].includes(entry.name)) {
      results.push(...walk(full));
    } else if (entry.isFile() && EXTENSIONS.includes(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// ── Scanner ───────────────────────────────────────────────────────
function scanFile(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const lines = src.split("\n");
  const hits = [];

  for (const rule of RULES) {
    // Reset lastIndex for global patterns
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(src)) !== null) {
      // Find line number
      const before = src.slice(0, match.index);
      const lineNo = before.split("\n").length;
      const lineText = lines[lineNo - 1]?.trim() ?? "";

      hits.push({
        rule: rule.id,
        severity: rule.severity,
        description: rule.description,
        suggestion: rule.suggestion,
        line: lineNo,
        match: match[0].slice(0, 80).replace(/\n/g, " "),
        lineText: lineText.slice(0, 100),
      });

      // Prevent infinite loop on zero-width matches
      if (match[0].length === 0) rule.pattern.lastIndex++;
    }
    rule.pattern.lastIndex = 0;
  }

  return hits;
}

// ── Report ────────────────────────────────────────────────────────
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

function run() {
  console.log(c("bold", "\n🔍  Glass / Opacity CSS Var Audit"));
  console.log(c("gray", `   Scanning: ${path.resolve(ROOT)}\n`));

  const files = walk(ROOT);
  let totalErrors = 0;
  let totalWarns = 0;
  const fileResults = [];

  for (const file of files) {
    const hits = scanFile(file);
    if (hits.length > 0) {
      fileResults.push({ file, hits });
      totalErrors += hits.filter((h) => h.severity === "ERROR").length;
      totalWarns += hits.filter((h) => h.severity === "WARN").length;
    }
  }

  if (fileResults.length === 0) {
    console.log(c("green", "  ✅  No issues found — all glass surfaces use CSS vars correctly.\n"));
    return;
  }

  for (const { file, hits } of fileResults) {
    const rel = path.relative(process.cwd(), file);
    console.log(c("bold", `\n📄  ${rel}`));
    console.log(c("gray", "─".repeat(60)));

    for (const hit of hits) {
      const badge =
        hit.severity === "ERROR"
          ? c("red", " ERROR ")
          : c("yellow", "  WARN ");

      console.log(`\n  [${badge}] ${c("bold", hit.rule)}  ${c("gray", `line ${hit.line}`)}`);
      console.log(`  ${c("gray", "Issue:")}      ${hit.description}`);
      console.log(`  ${c("gray", "Matched:")}    ${c("cyan", hit.match)}`);
      console.log(`  ${c("gray", "Fix:")}        ${hit.suggestion}`);

      if (FIX_MODE) {
        console.log(
          `  ${c("gray", "Context:")}    ${c("white", hit.lineText)}`
        );
      }
    }
  }

  // ── Summary ──
  console.log(c("gray", "\n" + "═".repeat(60)));
  console.log(c("bold", "  Summary"));
  console.log(c("gray", "  Files scanned : ") + files.length);
  console.log(c("gray", "  Files with hits: ") + fileResults.length);
  console.log(
    c("gray", "  Errors        : ") +
      (totalErrors > 0 ? c("red", String(totalErrors)) : c("green", "0"))
  );
  console.log(
    c("gray", "  Warnings      : ") +
      (totalWarns > 0 ? c("yellow", String(totalWarns)) : c("green", "0"))
  );
  console.log(c("gray", "═".repeat(60) + "\n"));

  // ── Rule reference ──
  console.log(c("bold", "  Rule Reference"));
  console.log(c("gray", "  ─────────────────────────────────────────────────────"));
  for (const rule of RULES) {
    const badge =
      rule.severity === "ERROR" ? c("red", "ERROR") : c("yellow", "WARN ");
    console.log(`  [${badge}]  ${c("bold", rule.id)}`);
    console.log(c("gray", `           ${rule.description}`));
  }
  console.log();

  process.exit(totalErrors > 0 ? 1 : 0);
}

run();
