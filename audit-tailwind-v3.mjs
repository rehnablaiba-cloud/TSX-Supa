#!/usr/bin/env node
// audit-tailwind-v3.mjs — Scan your codebase before migrating to Tailwind v4
import { glob } from "glob";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";

// ============ CONFIG ============
const INCLUDE = ["**/*.{html,jsx,tsx,vue,svelte,css,scss,less,mdx}"];
const EXCLUDE = [
  "node_modules/**",
  "dist/**",
  ".next/**",
  "build/**",
  "coverage/**",
];

// ============ PATTERNS ============
const CHECKS = [
  {
    id: "deprecated-utilities",
    name: "Deprecated utilities removed in v4",
    patterns: [
      /\bflex-shrink\b/g,
      /\bflex-grow\b/g,
      /\bbg-opacity-\d+\b/g,
      /\btext-opacity-\d+\b/g,
      /\bborder-opacity-\d+\b/g,
      /\bdivide-opacity-\d+\b/g,
      /\bring-opacity-\d+\b/g,
      /\bplaceholder-opacity-\d+\b/g,
      /\boverflow-ellipsis\b/g,
      /\bdecoration-slice\b/g,
      /\bdecoration-clone\b/g,
    ],
    fix: "Use shrink/grow, opacity modifiers (e.g. bg-black/50), text-ellipsis, box-decoration-slice/clone",
  },
  {
    id: "gradient-classes",
    name: "Gradient direction classes renamed",
    patterns: [/\bbg-gradient-to-[trbl]\b/g],
    fix: "Replace with bg-linear-to-* (e.g. bg-gradient-to-r → bg-linear-to-r)",
  },
  {
    id: "tailwind-directives",
    name: "Old @tailwind directives (v3)",
    patterns: [/@tailwind\s+(base|components|utilities);/g],
    fix: 'Replace with @import "tailwindcss";',
  },
  {
    id: "dynamic-classes",
    name: "Dynamic class construction (codemod cannot fix)",
    patterns: [
      /['"`][^'"`]*gradient-to-[^'"`]*['"`]/g,
      /['"`][^'"`]*flex-shrink[^'"`]*['"`]/g,
      /['"`][^'"`]*flex-grow[^'"`]*['"`]/g,
      /['"`][^'"`]*bg-opacity[^'"`]*['"`]/g,
      /cn\([^)]+\)/g, // class-variance-authority / clsx patterns
      /classNames?\([^)]+\)/g,
    ],
    fix: "Review manually — the official upgrade tool cannot detect dynamically built strings",
  },
  {
    id: "ring-utility",
    name: "Default ring width/color changed",
    patterns: [/\bring\b(?![-\w])/g], // "ring" not followed by - or word char
    fix: "ring now defaults to 1px currentColor instead of 3px blue-500. Use ring-3 ring-blue-500 to preserve v3 behavior, or add --default-ring-width: 3px; --default-ring-color: var(--color-blue-500); in @theme",
  },
  {
    id: "theme-function",
    name: "theme() function with dot notation",
    patterns: [/theme\([^)]+\.[^)]+\)/g],
    fix: "In v4 use CSS variable names: theme(colors.red.500) → var(--color-red-500), or theme(--breakpoint-xl) in media queries",
  },
  {
    id: "config-file",
    name: "tailwind.config.js/ts exists",
    fileCheck: true,
    patterns: [],
    fix: "Config must migrate to @theme in CSS. Run npx @tailwindcss/upgrade to auto-convert, or do it manually.",
  },
  {
    id: "postcss-config",
    name: "PostCSS config using tailwindcss plugin",
    patterns: [/"tailwindcss"\s*:/g, /'tailwindcss'\s*:/g],
    fix: 'Update postcss.config.js to use "@tailwindcss/postcss": {} and remove autoprefixer',
  },
  {
    id: "plugins",
    name: "Custom plugins or addUtilities",
    patterns: [
      /\baddUtilities\b/g,
      /\baddComponents\b/g,
      /\bmatchUtilities\b/g,
      /\bplugin\(/g,
    ],
    fix: "Custom JS plugins need manual migration to @utility or @plugin in CSS",
  },
  {
    id: "resolve-config",
    name: "resolveConfig import/usage",
    patterns: [/\bresolveConfig\b/g],
    fix: "resolveConfig is removed in v4. Use CSS variables (var(--color-*)) directly in JS instead",
  },
];

// ============ SCANNER ============
async function scanFile(filePath, content) {
  const results = [];
  for (const check of CHECKS) {
    if (check.fileCheck) continue;
    for (const pattern of check.patterns) {
      const matches = content.match(pattern);
      if (matches) {
        results.push({
          file: filePath,
          check: check.id,
          name: check.name,
          count: matches.length,
          fix: check.fix,
          snippet: content
            .split("\n")
            .map((line, i) => ({ line: i + 1, text: line }))
            .filter(({ text }) => pattern.test(text))
            .slice(0, 3)
            .map(({ line, text }) => `    L${line}: ${text.trim()}`)
            .join("\n"),
        });
        // Reset regex lastIndex if global
        pattern.lastIndex = 0;
      }
    }
  }
  return results;
}

async function checkConfigFiles() {
  const results = [];
  const configs = [
    "tailwind.config.js",
    "tailwind.config.ts",
    "tailwind.config.mjs",
    "tailwind.config.cjs",
  ];
  for (const cfg of configs) {
    if (existsSync(resolve(cfg))) {
      results.push({
        file: cfg,
        check: "config-file",
        name: "tailwind.config.js/ts exists",
        count: 1,
        fix: "Must migrate to @theme in CSS. Run npx @tailwindcss/upgrade to auto-convert.",
        snippet: "",
      });
    }
  }
  return results;
}

async function main() {
  console.log("🔍 Scanning for Tailwind v3 → v4 migration issues...\n");

  const files = await glob(INCLUDE, { ignore: EXCLUDE, absolute: false });
  let allResults = await checkConfigFiles();

  for (const file of files) {
    try {
      const content = await readFile(file, "utf-8");
      const results = await scanFile(file, content);
      allResults.push(...results);
    } catch (e) {
      // skip binary/unreadable files
    }
  }

  // Group by check
  const grouped = allResults.reduce((acc, r) => {
    if (!acc[r.check]) acc[r.check] = [];
    acc[r.check].push(r);
    return acc;
  }, {});

  let totalIssues = 0;

  for (const [key, items] of Object.entries(grouped)) {
    const checkDef = CHECKS.find((c) => c.id === key) || { name: key, fix: "" };
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`⚠️  ${checkDef.name}`);
    console.log(`   💡 Fix: ${checkDef.fix}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const byFile = items.reduce((acc, item) => {
      if (!acc[item.file]) acc[item.file] = [];
      acc[item.file].push(item);
      return acc;
    }, {});

    for (const [file, occurrences] of Object.entries(byFile)) {
      const count = occurrences.reduce((s, o) => s + o.count, 0);
      totalIssues += count;
      console.log(
        `\n  📄 ${file} (${count} occurrence${count > 1 ? "s" : ""})`
      );
      for (const occ of occurrences) {
        if (occ.snippet) console.log(occ.snippet);
      }
    }
  }

  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Total issues found: ${totalIssues}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (totalIssues === 0) {
    console.log(
      "\n✅ No obvious v3-specific patterns found. You're likely ready to run the upgrade tool!"
    );
  } else {
    console.log("\n👉 Next step: Review the issues above, then run:");
    console.log("   npx @tailwindcss/upgrade@latest");
    console.log(
      "\n   (Run with --dry-run first to preview changes without writing files)"
    );
  }
}

main().catch(console.error);
