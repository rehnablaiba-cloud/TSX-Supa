#!/usr/bin/env node
// verify-tailwind-v4.mjs — Post-migration verification script for Tailwind v4
import { readFile, access } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function log(type, msg) {
  const colors = { pass: GREEN, fail: RED, warn: YELLOW, info: CYAN };
  const icons = { pass: '✅', fail: '❌', warn: '⚠️', info: 'ℹ️' };
  console.log(`${colors[type] || ''}${icons[type] || ''} ${msg}${RESET}`);
}

function section(title) {
  console.log(`\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
}

async function readFileSafe(path) {
  try {
    return await readFile(resolve(path), 'utf-8');
  } catch {
    return null;
  }
}

async function fileExists(path) {
  try {
    await access(resolve(path));
    return true;
  } catch {
    return false;
  }
}

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(msg) { passCount++; log('pass', msg); }
function fail(msg) { failCount++; log('fail', msg); }
function warn(msg) { warnCount++; log('warn', msg); }
function info(msg) { log('info', msg); }

// ==================== CHECKS ====================

async function checkPackageJson() {
  section('Package Dependencies');
  const pkgRaw = await readFileSafe('package.json');
  if (!pkgRaw) { fail('package.json not found'); return; }

  const pkg = JSON.parse(pkgRaw);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps['tailwindcss']) {
    const version = deps['tailwindcss'];
    if (version.startsWith('^4') || version.startsWith('4')) {
      pass(`tailwindcss is v4 (${version})`);
    } else {
      fail(`tailwindcss is still v3 (${version}) — upgrade to v4`);
    }
  } else {
    fail('tailwindcss not found in package.json');
  }

  if (deps['autoprefixer']) {
    warn('autoprefixer is still installed — v4 does not need it');
  } else {
    pass('autoprefixer removed (v4 does not need it)');
  }

  const hasPostcssPlugin = deps['@tailwindcss/postcss'] || deps['@tailwindcss/vite'];
  if (hasPostcssPlugin) {
    pass(`v4 integration found: ${Object.keys(deps).find(k => k.startsWith('@tailwindcss/'))}`);
  } else {
    fail('No @tailwindcss/postcss or @tailwindcss/vite found — v4 requires one');
  }

  if (deps['postcss']) {
    pass('postcss is installed');
  } else {
    warn('postcss not found — ensure your build tool handles CSS');
  }
}

async function checkPostcssConfig() {
  section('PostCSS Configuration');

  const configs = ['postcss.config.js', 'postcss.config.mjs', 'postcss.config.cjs', 'postcss.config.json'];
  let found = false;

  for (const cfg of configs) {
    if (await fileExists(cfg)) {
      found = true;
      const content = await readFileSafe(cfg);
      if (content.includes('tailwindcss') && !content.includes('@tailwindcss/postcss')) {
        fail(`${cfg} still references old 'tailwindcss' plugin — update to '@tailwindcss/postcss' or '@tailwindcss/vite'`);
      } else if (content.includes('@tailwindcss/postcss') || content.includes('@tailwindcss/vite')) {
        pass(`${cfg} correctly uses v4 plugin`);
      } else {
        warn(`${cfg} found but cannot verify Tailwind plugin configuration`);
      }
      break;
    }
  }

  if (!found) {
    warn('No postcss.config file found — if using Vite, this may be fine (configure in vite.config)');
  }
}

async function checkCssEntry() {
  section('CSS Entry File');

  const cssFiles = ['src/index.css', 'src/styles.css', 'src/app.css', 'src/global.css', 'src/main.css', 'app/globals.css'];
  let found = false;

  for (const css of cssFiles) {
    if (await fileExists(css)) {
      found = true;
      const content = await readFileSafe(css);

      if (content.includes('@tailwind base;') || content.includes('@tailwind components;') || content.includes('@tailwind utilities;')) {
        fail(`${css} still uses old @tailwind directives — replace with @import "tailwindcss"`);
      } else {
        pass(`${css} does not contain old @tailwind directives`);
      }

      if (content.includes('@import "tailwindcss"') || content.includes("@import 'tailwindcss'")) {
        pass(`${css} imports tailwindcss correctly`);
      } else {
        fail(`${css} missing @import "tailwindcss" — required for v4`);
      }

      if (content.includes('@theme') || content.includes('@theme ')) {
        pass(`${css} contains @theme block`);
      } else {
        warn(`${css} missing @theme block — custom config from tailwind.config.js may not be migrated`);
      }

      if (content.includes('@config')) {
        warn(`${css} uses @config to reference tailwind.config.js — this is a compatibility layer; consider migrating fully to @theme`);
      }
      break;
    }
  }

  if (!found) {
    warn('Could not find main CSS entry file — check manually');
  }
}

async function checkConfigFile() {
  section('Legacy Config File');

  const configs = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs'];
  let found = false;

  for (const cfg of configs) {
    if (await fileExists(cfg)) {
      found = true;
      const content = await readFileSafe(cfg);
      if (content.includes('@config')) {
        warn(`${cfg} still exists but is referenced via @config — this works but is not the v4 native approach`);
      } else {
        warn(`${cfg} still exists — consider migrating its contents to @theme in CSS and removing it`);
      }
    }
  }

  if (!found) {
    pass('No legacy tailwind.config.js/ts found — fully migrated to CSS-based config');
  }
}

async function checkDeprecatedUtilities() {
  section('Deprecated Utilities in Source');

  const deprecated = [
    { pattern: /\bflex-shrink\b/g, name: 'flex-shrink', fix: 'shrink' },
    { pattern: /\bflex-grow\b/g, name: 'flex-grow', fix: 'grow' },
    { pattern: /\bbg-opacity-\d+\b/g, name: 'bg-opacity-*', fix: 'bg-color/opacity modifier' },
    { pattern: /\btext-opacity-\d+\b/g, name: 'text-opacity-*', fix: 'text-color/opacity modifier' },
    { pattern: /\bborder-opacity-\d+\b/g, name: 'border-opacity-*', fix: 'border-color/opacity modifier' },
    { pattern: /\bdivide-opacity-\d+\b/g, name: 'divide-opacity-*', fix: 'divide-color/opacity modifier' },
    { pattern: /\bring-opacity-\d+\b/g, name: 'ring-opacity-*', fix: 'ring-color/opacity modifier' },
    { pattern: /\bplaceholder-opacity-\d+\b/g, name: 'placeholder-opacity-*', fix: 'placeholder-color/opacity modifier' },
    { pattern: /\boverflow-ellipsis\b/g, name: 'overflow-ellipsis', fix: 'text-ellipsis' },
    { pattern: /\bdecoration-slice\b/g, name: 'decoration-slice', fix: 'box-decoration-slice' },
    { pattern: /\bdecoration-clone\b/g, name: 'decoration-clone', fix: 'box-decoration-clone' },
    { pattern: /\bbg-gradient-to-[trbl]\b/g, name: 'bg-gradient-to-*', fix: 'bg-linear-to-*' },
  ];

  const extensions = ['html', 'jsx', 'tsx', 'vue', 'svelte', 'css', 'scss'];
  const { glob } = await import('glob');
  const files = await glob(`**/*.{${extensions.join(',')}}`, { 
    ignore: ['verify-tailwind-v4.mjs', 'node_modules/**', 'dist/**', '.next/**', 'build/**', 'coverage/**'] 
  });

  let foundIssues = false;

  for (const file of files) {
    const content = await readFileSafe(file);
    if (!content) continue;

    for (const { pattern, name, fix } of deprecated) {
      const matches = content.match(pattern);
      if (matches) {
        foundIssues = true;
        fail(`${file}: found ${matches.length}x ${name} → use ${fix}`);
      }
      pattern.lastIndex = 0;
    }
  }

  if (!foundIssues) {
    pass('No deprecated v3 utilities found in source files');
  }
}

async function checkThemeFunction() {
  section('theme() Function Usage');

  const { glob } = await import('glob');
  const files = await glob('**/*.{css,scss,less}', { ignore: ['verify-tailwind-v4.mjs', 'node_modules/**', 'dist/**'] });
  let found = false;

  for (const file of files) {
    const content = await readFileSafe(file);
    if (!content) continue;

    const matches = content.match(/theme\([^)]*\.[^)]*\)/g);
    if (matches) {
      found = true;
      warn(`${file}: uses theme() with dot notation (${matches.length}x) — in v4, use var(--color-*) or theme(--breakpoint-*)`);
    }
  }

  if (!found) {
    pass('No theme() dot-notation usage found');
  }
}

async function checkResolveConfig() {
  section('resolveConfig Usage');

  const { glob } = await import('glob');
  const files = await glob('**/*.{js,ts,jsx,tsx,mjs,cjs}', { ignore: ['verify-tailwind-v4.mjs', 'node_modules/**', 'dist/**'] });
  let found = false;

  for (const file of files) {
    const content = await readFileSafe(file);
    if (!content) continue;

    if (content.includes('resolveConfig')) {
      found = true;
      fail(`${file}: uses resolveConfig — this is removed in v4. Use CSS variables (var(--color-*)) instead`);
    }
  }

  if (!found) {
    pass('No resolveConfig usage found');
  }
}

async function checkBuild() {
  section('Build Verification');

  const pkgRaw = await readFileSafe('package.json');
  if (!pkgRaw) { fail('package.json not found'); return; }

  const pkg = JSON.parse(pkgRaw);
  const scripts = pkg.scripts || {};

  const buildScript = scripts.build || scripts['build:css'];
  if (!buildScript) {
    warn('No build script found in package.json — skipping build check');
    return;
  }

  info(`Running: npm run build`);

  try {
    execSync('npm run build', { stdio: 'pipe', encoding: 'utf-8', timeout: 120000 });
    pass('Build completed successfully');
  } catch (err) {
    fail('Build failed — check output above');
    if (err.stdout) info(err.stdout);
    if (err.stderr) info(err.stderr);
  }
}

async function checkPlugins() {
  section('Custom Plugin Migration');

  const { glob } = await import('glob');
  const files = await glob('**/*.{js,ts,mjs,cjs}', { ignore: ['verify-tailwind-v4.mjs', 'node_modules/**', 'dist/**'] });
  let found = false;

  for (const file of files) {
    const content = await readFileSafe(file);
    if (!content) continue;

    if (content.includes('addUtilities') || content.includes('addComponents') || content.includes('matchUtilities')) {
      found = true;
      warn(`${file}: contains addUtilities/addComponents/matchUtilities — custom JS plugins need manual migration to @utility in CSS`);
    }
  }

  if (!found) {
    pass('No custom JS plugin utilities found');
  }
}

async function checkViteConfig() {
  section('Vite Configuration');

  const viteFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];
  let found = false;

  for (const cfg of viteFiles) {
    if (await fileExists(cfg)) {
      found = true;
      const content = await readFileSafe(cfg);

      if (content.includes('@tailwindcss/vite')) {
        pass(`${cfg} uses @tailwindcss/vite`);
      } else if (content.includes('tailwindcss')) {
        warn(`${cfg} references tailwindcss but not @tailwindcss/vite — if using Vite, consider the official plugin`);
      } else {
        info(`${cfg} found but no Tailwind reference detected`);
      }
      break;
    }
  }

  if (!found) {
    info('No Vite config found — skipping Vite check');
  }
}

// ==================== MAIN ====================

async function main() {
  console.log(`${BOLD}${CYAN}`);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Tailwind CSS v4 Post-Migration Verification              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`${RESET}`);

  await checkPackageJson();
  await checkPostcssConfig();
  await checkCssEntry();
  await checkConfigFile();
  await checkDeprecatedUtilities();
  await checkThemeFunction();
  await checkResolveConfig();
  await checkPlugins();
  await checkViteConfig();
  await checkBuild();

  section('Summary');

  const total = passCount + failCount + warnCount;
  console.log(`\n${BOLD}Results:${RESET}`);
  console.log(`  ${GREEN}✅ Passed:  ${passCount}${RESET}`);
  console.log(`  ${RED}❌ Failed:  ${failCount}${RESET}`);
  console.log(`  ${YELLOW}⚠️  Warnings: ${warnCount}${RESET}`);
  console.log(`  ${CYAN}Total checks: ${total}${RESET}`);

  if (failCount === 0 && warnCount === 0) {
    console.log(`\n${GREEN}${BOLD}🎉 All checks passed! Your migration looks solid.${RESET}`);
  } else if (failCount === 0) {
    console.log(`\n${YELLOW}${BOLD}⚠️  No failures, but review the warnings above.${RESET}`);
  } else {
    console.log(`\n${RED}${BOLD}❌ Found ${failCount} issue(s) that need fixing before your migration is complete.${RESET}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
