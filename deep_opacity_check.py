
"""
Tailwind v4 Deep Opacity Diagnostic (Fixed)
Checks CSS variables, color-mix() validity, built output, and JS theme patterns.
"""

import re
import sys
from pathlib import Path
from collections import defaultdict


def rgb_to_hex(r, g, b):
    try:
        return f"#{int(r):02x}{int(g):02x}{int(b):02x}"
    except:
        return None


def scan_css_file(filepath: Path):
    content = filepath.read_text(encoding='utf-8', errors='ignore')
    lines = content.split('\n')
    vars_defined = {}
    color_mix_usages = []
    rgba_var_patterns = []
    apply_in_utility = []

    in_utility = False
    utility_name = None

    for i, line in enumerate(lines, 1):
        stripped = line.strip()

        if stripped.startswith('@utility '):
            in_utility = True
            utility_name = stripped.split()[1].rstrip('{').strip()
        elif in_utility and stripped == '}':
            in_utility = False
            utility_name = None

        if in_utility and '@apply' in line:
            apply_in_utility.append((i, utility_name, stripped))

        var_match = re.match(r'^\s*(--[a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*;?\s*$', stripped)
        if var_match:
            var_name = var_match.group(1)
            var_value = var_match.group(2).rstrip(';').strip()
            vars_defined[var_name] = var_value

        for cm in re.finditer(r'color-mix\([^)]*var\((--[a-zA-Z0-9_-]+)\)[^)]*\)', line):
            color_mix_usages.append((i, cm.group(1), cm.group(0)))

        for rm in re.finditer(r'rgba\(\s*var\((--[a-zA-Z0-9_-]+)\)\s*,\s*[0-9.]+\s*\)', line, re.IGNORECASE):
            rgba_var_patterns.append((i, rm.group(1), rm.group(0)))

    return {
        'vars': vars_defined,
        'color_mix': color_mix_usages,
        'rgba_var': rgba_var_patterns,
        'apply_in_utility': apply_in_utility,
    }


def is_space_separated_rgb(value: str) -> bool:
    cleaned = value.replace(',', ' ').strip()
    parts = cleaned.split()
    if len(parts) in (2, 3, 4):
        try:
            [float(p) for p in parts]
            return True
        except ValueError:
            pass
    return False


def scan_js_for_theme_setters(project: Path):
    """Scan JS/TS files for setProperty calls that might set space-separated RGB."""
    issues = []
    pattern = re.compile(
        r'setProperty\s*\(\s*["\'](--[a-zA-Z0-9_-]+)["\']\s*,\s*["\']([0-9,\s]+)["\']\s*\)'
    )
    for ext in ('.js', '.ts', '.jsx', '.tsx'):
        for f in project.rglob(f'*{ext}'):
            if 'node_modules' in str(f):
                continue
            try:
                content = f.read_text(encoding='utf-8', errors='ignore')
                for m in pattern.finditer(content):
                    var_name = m.group(1)
                    value = m.group(2)
                    if is_space_separated_rgb(value):
                        rel = str(f.relative_to(project))
                        issues.append((rel, var_name, value, m.start()))
            except:
                pass
    return issues


def main():
    project = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    css_files = [f for f in project.rglob('*.css') if 'node_modules' not in str(f)]

    all_vars = {}
    all_color_mix = []
    all_rgba_var = []
    all_apply = []

    print("=" * 70)
    print("TAILWIND V4 DEEP OPACITY DIAGNOSTIC")
    print("=" * 70)

    for css_file in css_files:
        rel = str(css_file.relative_to(project))
        result = scan_css_file(css_file)
        all_vars.update(result['vars'])
        all_color_mix.extend([(rel, l, v, e) for l, v, e in result['color_mix']])
        all_rgba_var.extend([(rel, l, v, e) for l, v, e in result['rgba_var']])
        all_apply.extend([(rel, l, u, e) for l, u, e in result['apply_in_utility']])

    print(f"\n📁 Scanned {len(css_files)} CSS files")

    # Check 1: CSS Variables with space-separated RGB
    print(f"\n🔴 CSS VARIABLES WITH SPACE-SEPARATED RGB (INVALID FOR color-mix)")
    broken_vars = [(n, v) for n, v in all_vars.items() if is_space_separated_rgb(v)]

    if broken_vars:
        print(f"   Found {len(broken_vars)} variables that will BREAK color-mix():")
        for var_name, value in broken_vars:
            nums = value.replace(',', ' ').split()
            hex_val = rgb_to_hex(*nums[:3]) if len(nums) >= 3 else None
            print(f"   ❌ {var_name}: {value}")
            if hex_val:
                print(f"      FIX: Change to rgb({value})  or  {hex_val}")
            else:
                print(f"      FIX: Change to rgb({value})")
    else:
        print("   ✅ No space-separated RGB values in CSS files")

    # Check 2: color-mix() usages referencing broken vars
    print(f"\n🔴 color-mix() CALLS USING BROKEN VARIABLES")
    broken_refs = [(r, l, v, e) for r, l, v, e in all_color_mix if v in [n for n, _ in broken_vars]]

    if broken_refs:
        print(f"   Found {len(broken_refs)} broken color-mix() calls:")
        for rel, line, var_name, expr in broken_refs[:20]:
            print(f"   ❌ {rel}:{line}")
            print(f"      var({var_name}) contains invalid color value")
            print(f"      {expr}")
    else:
        print("   ✅ No broken color-mix() references in CSS files")

    # Check 3: Stale rgba(var(--*)) in built output
    print(f"\n🔴 STALE rgba(var(--*), opacity) IN BUILT CSS")
    built_rgba = [(r, l, v, e) for r, l, v, e in all_rgba_var if 'dist/' in r or 'build/' in r]
    if built_rgba:
        print(f"   Found {len(built_rgba)} stale patterns:")
        for rel, line, var_name, expr in built_rgba[:10]:
            print(f"   ⚠️  {rel}:{line} — {expr}")
        print("   → Rebuild: npm run build")
    else:
        print("   ✅ No stale rgba(var(--*)) in built output")

    # Check 4: Source rgba(var(--*))
    src_rgba = [(r, l, v, e) for r, l, v, e in all_rgba_var if 'dist/' not in r and 'build/' not in r]
    if src_rgba:
        print(f"\n⚠️  rgba(var(--*), opacity) IN SOURCE ({len(src_rgba)} found)")
        for rel, line, var_name, expr in src_rgba[:10]:
            print(f"   {rel}:{line} — {expr}")
    else:
        print(f"\n✅ No rgba(var(--*), opacity) in source CSS")

    # Check 5: JS theme setters
    print(f"\n🔴 JS THEME SETTERS (setProperty with space-separated RGB)")
    js_issues = scan_js_for_theme_setters(project)
    if js_issues:
        print(f"   Found {len(js_issues)} runtime setProperty calls with invalid values:")
        for rel, var_name, value, pos in js_issues[:20]:
            nums = value.replace(',', ' ').split()
            hex_val = rgb_to_hex(*nums[:3]) if len(nums) >= 3 else None
            print(f"   ❌ {rel}")
            print(f"      setProperty('{var_name}', '{value}')")
            if hex_val:
                print(f"      FIX: setProperty('{var_name}', '{hex_val}')")
            else:
                print(f"      FIX: setProperty('{var_name}', 'rgb({value})')")
    else:
        print("   ✅ No space-separated RGB setProperty calls found in JS/TS")

    # Check 6: @apply in @utility
    print(f"\nℹ️  @apply INSIDE @utility")
    if all_apply:
        print(f"   Found {len(all_apply)} usages:")
        for rel, line, utility_name, expr in all_apply[:10]:
            print(f"   {rel}:{line} in @{utility_name}")
    else:
        print("   None found")

    # Check 7: Variables used in color-mix that might be overridden at runtime
    print(f"\n⚠️  VARIABLES USED IN color-mix() (check these at runtime)")
    cm_vars = set(v for _, _, v, _ in all_color_mix)
    for var_name in sorted(cm_vars):
        css_val = all_vars.get(var_name, "NOT DEFINED IN CSS — SET BY JS AT RUNTIME ⚠️")
        marker = "✅" if var_name not in [n for n, _ in broken_vars] else "❌"
        print(f"   {marker} {var_name}: {css_val}")

    print("\n" + "=" * 70)
    print("SUMMARY & FIXES")
    print("=" * 70)

    if broken_vars:
        print("\n1. FIX BROKEN CSS VARIABLES in your CSS:")
        for var_name, value in broken_vars:
            nums = value.replace(',', ' ').split()
            hex_val = rgb_to_hex(*nums[:3]) if len(nums) >= 3 else None
            if hex_val:
                print(f"   {var_name}: {value}  ->  {hex_val}")
            else:
                print(f"   {var_name}: {value}  ->  rgb({value})")

    if js_issues:
        print("\n2. FIX JS THEME SETTERS (this is likely your main issue):")
        print("   Find applyStoredTheme() or similar in your theme.ts/js")
        print("   Change setProperty calls from space-separated RGB to hex:")
        for rel, var_name, value, _ in js_issues[:5]:
            nums = value.replace(',', ' ').split()
            hex_val = rgb_to_hex(*nums[:3]) if len(nums) >= 3 else None
            if hex_val:
                print(f"   setProperty('{var_name}', '{hex_val}')")
            else:
                print(f"   setProperty('{var_name}', 'rgb({value})')")

    if built_rgba:
        print("\n3. REBUILD: npm run build")

    if src_rgba:
        print("\n4. FIX REMAINING rgba(var(--*)) IN SOURCE:")
        print("   Replace with color-mix(in oklab, var(--*) XX%, transparent)")

    print("\n5. VERIFY IN DEVTOOLS:")
    print("   Inspect MobileNav -> Computed -> background")
    print("   Should show: color-mix(in srgb, #0f172a 40%, transparent)")
    print("   NOT: color-mix(in srgb, 15, 23, 42 40%, transparent) [INVALID]")
    print("\n   If the var value shows space-separated numbers, your JS theme")
    print("   system is setting invalid colors. Fix the JS, not the CSS.")

if __name__ == '__main__':
    main()