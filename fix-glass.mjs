/**
 * fix-glass.mjs
 * ─────────────────────────────────────────────────────────────────
 * Auto-fixes all HARDCODED_BACKDROP / HARDCODED_BG_OPACITY /
 * HARDCODED_BORDER_OPACITY / HARDCODED_WEBKIT_BACKDROP /
 * HARDCODED_SHADOW errors found by audit-glass.mjs.
 *
 * Also raises LOW_OPACITY_INLINE warnings where the context
 * confirms they are nav/icon elements (not intentional dim layers).
 *
 * Usage:
 *   node fix-glass.mjs              — dry run (shows diffs, no writes)
 *   node fix-glass.mjs --apply      — applies all fixes in place
 *   node fix-glass.mjs --apply --verbose  — applies + prints each change
 * ─────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

const APPLY   = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const ROOT    = "./src";

// ── Replacement helpers ────────────────────────────────────────────

/**
 * Each fix is { file, description, find (string|RegExp), replace (string|fn) }
 * find/replace follow the same API as String.prototype.replace()
 */
const FIXES = [

  // ════════════════════════════════════════════════════════════
  // index.css — glass utility (line 61-62)
  // ════════════════════════════════════════════════════════════
  {
    file: "index.css",
    description: "[glass utility] bg opacity 86% → var(--glass-bg-opacity)",
    find: /background: color-mix\(in srgb, var\(--bg-surface\) 86%, transparent\);/g,
    replace: "background: color-mix(in srgb, var(--bg-surface) var(--glass-bg-opacity), transparent);",
  },
  {
    file: "index.css",
    description: "[glass utility] border opacity 80% → var(--glass-border-opacity)",
    find: /border: 1px solid color-mix\(in srgb, var\(--border-color\) 80%, transparent\);/g,
    replace: "border: 1px solid color-mix(in srgb, var(--border-color) var(--glass-border-opacity), transparent);",
  },
  {
    file: "index.css",
    description: "[backdrop-dim utility] bg opacity 55% → var(--backdrop-dim-opacity)",
    // backdrop-dim uses --bg-base not --bg-surface, so keep a dedicated var
    find: /background: color-mix\(in srgb, var\(--bg-base\) 55%, transparent\);/g,
    replace: "background: color-mix(in srgb, var(--bg-base) var(--backdrop-dim-opacity), transparent);",
  },
  {
    // Add --backdrop-dim-opacity to :root fallbacks (after --glass-border-opacity line)
    file: "index.css",
    description: "[index.css :root] add --backdrop-dim-opacity CSS var",
    find: /--glass-border-opacity: 55%;(\s*\})/,
    replace: "--glass-border-opacity: 55%;\n    --backdrop-dim-opacity: 55%;$1",
  },

  // ════════════════════════════════════════════════════════════
  // SessionLog.tsx (lines 86-87)
  // Context: backdropFilter: "blur(20px) saturate(180%)",
  // ════════════════════════════════════════════════════════════
  {
    file: "components/DevTools/SessionLog.tsx",
    description: "[SessionLog] inline backdropFilter → CSS vars",
    find: /backdropFilter:\s*["'`]blur\(20px\)\s*saturate\(180%\)["'`],?/g,
    replace: 'backdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturation)) brightness(var(--glass-brightness))`,',
  },
  {
    file: "components/DevTools/SessionLog.tsx",
    description: "[SessionLog] inline WebkitBackdropFilter → CSS vars",
    find: /WebkitBackdropFilter:\s*["'`]blur\(20px\)\s*saturate\(180%\)["'`],?/g,
    replace: 'WebkitBackdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturation)) brightness(var(--glass-brightness))`,',
  },

  // ════════════════════════════════════════════════════════════
  // ActiveLockContext.tsx (lines 98-99)
  // Context: backdropFilter: "blur(20px) saturate(180%)",
  // ════════════════════════════════════════════════════════════
  {
    file: "context/ActiveLockContext.tsx",
    description: "[ActiveLockContext] inline backdropFilter → CSS vars",
    find: /backdropFilter:\s*["'`]blur\(20px\)\s*saturate\(180%\)["'`],?/g,
    replace: 'backdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturation)) brightness(var(--glass-brightness))`,',
  },
  {
    file: "context/ActiveLockContext.tsx",
    description: "[ActiveLockContext] inline WebkitBackdropFilter → CSS vars",
    find: /WebkitBackdropFilter:\s*["'`]blur\(20px\)\s*saturate\(180%\)["'`],?/g,
    replace: 'WebkitBackdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturation)) brightness(var(--glass-brightness))`,',
  },

  // ════════════════════════════════════════════════════════════
  // TestExecution.tsx (lines 201, 278, 665)
  // line 201 context: style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
  //   → This is a modal overlay — keep backgroundColor, fix blur
  // line 278 context: backdropFilter: "blur(12px)",
  // line 665 context: backdropFilter: "blur(4px)",
  // ════════════════════════════════════════════════════════════
  {
    file: "components/TestExecution/TestExecution.tsx",
    description: "[TestExecution] modal overlay backdropFilter blur(4px) → CSS var (line 201 pattern)",
    find: /backgroundColor:\s*["'`]rgba\(0,0,0,0\.55\)["'`],\s*backdropFilter:\s*["'`]blur\(4px\)["'`]/g,
    replace: 'backgroundColor: "color-mix(in srgb, var(--bg-base) 55%, transparent)", backdropFilter: `blur(var(--glass-blur))`',
  },
  {
    file: "components/TestExecution/TestExecution.tsx",
    description: "[TestExecution] backdropFilter blur(12px) → CSS var (line 278)",
    find: /backdropFilter:\s*["'`]blur\(12px\)["'`],?/g,
    replace: "backdropFilter: `blur(var(--glass-blur))`,",
  },
  {
    file: "components/TestExecution/TestExecution.tsx",
    description: "[TestExecution] remaining backdropFilter blur(4px) → CSS var (line 665)",
    // Use a targeted replacement for standalone blur(4px) not preceded by rgba pattern
    find: /backdropFilter:\s*["'`]blur\(4px\)["'`],?/g,
    replace: "backdropFilter: `blur(var(--glass-blur))`,",
  },

  // ════════════════════════════════════════════════════════════
  // TestReport.tsx (line 136)
  // Context: backdropFilter: "blur(4px)",
  // ════════════════════════════════════════════════════════════
  {
    file: "components/TestReport/TestReport.tsx",
    description: "[TestReport] inline backdropFilter blur(4px) → CSS var",
    find: /backdropFilter:\s*["'`]blur\(4px\)["'`],?/g,
    replace: "backdropFilter: `blur(var(--glass-blur))`,",
  },

  // ════════════════════════════════════════════════════════════
  // MassImageUploadModal.tsx (line 128)
  // Context: backdropFilter: "blur(4px)",
  // ════════════════════════════════════════════════════════════
  {
    file: "components/UI/MassImageUploadModal.tsx",
    description: "[MassImageUploadModal] inline backdropFilter blur(4px) → CSS var",
    find: /backdropFilter:\s*["'`]blur\(4px\)["'`],?/g,
    replace: "backdropFilter: `blur(var(--glass-blur))`,",
  },

  // ════════════════════════════════════════════════════════════
  // ThemeEditorPanel.tsx (line 564) — WARN: hardcoded rgba() shadow
  // Context: boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
  // ════════════════════════════════════════════════════════════
  {
    file: "components/ThemeEditor/ThemeEditorPanel.tsx",
    description: "[ThemeEditorPanel] hardcoded rgba() boxShadow → color-mix CSS var",
    find: /boxShadow:\s*["'`]0 8px 32px rgba\(0,0,0,0\.20\)["'`],?/g,
    replace: 'boxShadow: "0 8px 32px color-mix(in srgb, var(--bg-base) 80%, transparent)",',
  },

  // ════════════════════════════════════════════════════════════
  // ModuleDashboard.tsx (lines 625, 778) — WARN: opacity 0.3
  // Context line 625: <span style={{ opacity: 0.3 }} className="mx-0.5">
  //   → This is a decorative divider span, 0.3 is intentional — SKIP
  // Context line 778: opacity: 0.3,
  //   → Need to check if it's a nav/icon element. Raise if it's text/icon.
  // We only fix line 778 (object style) as it's likely an icon/label
  // ════════════════════════════════════════════════════════════
  {
    file: "components/ModuleDashboard/ModuleDashboard.tsx",
    description: "[ModuleDashboard] opacity: 0.3 in style object → 0.65 (line 778 pattern)",
    // Only target opacity: 0.3 inside a style object (not JSX attribute pattern)
    find: /(\{\s*[\s\S]{0,80})opacity:\s*0\.3(,?\s*\})/g,
    replace: (match, before, after) => {
      // Skip if it looks like a JSX attribute (contains className or is a span divider)
      if (before.includes("className") || before.includes("mx-0.5")) return match;
      return `${before}opacity: 0.65${after}`;
    },
  },

];

// ── Diff helper ────────────────────────────────────────────────────
function showDiff(label, before, after) {
  if (before === after) return false;
  const bLines = before.split("\n");
  const aLines = after.split("\n");
  console.log(`\n  ${label}`);
  for (let i = 0; i < Math.max(bLines.length, aLines.length); i++) {
    if (bLines[i] !== aLines[i]) {
      if (bLines[i] !== undefined)
        console.log(`    \x1b[31m- ${bLines[i].trim()}\x1b[0m`);
      if (aLines[i] !== undefined)
        console.log(`    \x1b[32m+ ${aLines[i].trim()}\x1b[0m`);
    }
  }
  return true;
}

// ── Main ───────────────────────────────────────────────────────────
const COLORS = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m",
};
const c = (col, t) => `${COLORS[col]}${t}${COLORS.reset}`;

function run() {
  console.log(c("bold", APPLY
    ? "\n🔧  Glass Fix — APPLY MODE (writing files)\n"
    : "\n🔍  Glass Fix — DRY RUN (no files written, pass --apply to fix)\n"
  ));

  let totalFixed = 0;
  let totalSkipped = 0;

  // Group fixes by file
  const byFile = {};
  for (const fix of FIXES) {
    (byFile[fix.file] ??= []).push(fix);
  }

  for (const [relFile, fixes] of Object.entries(byFile)) {
    const fullPath = path.join(ROOT, relFile);

    if (!fs.existsSync(fullPath)) {
      console.log(c("yellow", `  ⚠️  Not found: ${fullPath} — skipping`));
      totalSkipped += fixes.length;
      continue;
    }

    let src = fs.readFileSync(fullPath, "utf8");
    let changed = false;
    console.log(c("bold", `\n📄  ${relFile}`));
    console.log(c("gray", "─".repeat(60)));

    for (const fix of fixes) {
      fix.find.lastIndex = 0; // reset global regex
      const before = src;
      src = src.replace(fix.find, fix.replace);
      fix.find.lastIndex = 0;

      const didChange = src !== before;
      if (didChange) {
        changed = true;
        totalFixed++;
        if (VERBOSE) {
          showDiff(`✅  ${fix.description}`, before, src);
        } else {
          console.log(`  ${c("green", "✅")}  ${fix.description}`);
        }
      } else {
        console.log(`  ${c("gray", "–– ")}${fix.description} ${c("gray", "(no match — may already be fixed)")}`);
      }
    }

    if (changed && APPLY) {
      fs.writeFileSync(fullPath, src, "utf8");
      console.log(c("cyan", `\n  💾  Written: ${fullPath}`));
    }
  }

  // ── Summary ──
  console.log(c("gray", "\n" + "═".repeat(60)));
  console.log(c("bold", "  Summary"));
  console.log(c("gray", "  Fixes applied : ") + c("green",  String(totalFixed)));
  console.log(c("gray", "  Skipped       : ") + (totalSkipped > 0 ? c("yellow", String(totalSkipped)) : "0"));

  if (!APPLY) {
    console.log(
      c("yellow", "\n  ⚠️  Dry run — no files were written.") +
      c("gray",   " Run with --apply to patch in place.\n")
    );
  } else {
    console.log(c("green", "\n  ✅  Done. Run audit-glass.mjs to verify.\n"));
  }
}

run();
