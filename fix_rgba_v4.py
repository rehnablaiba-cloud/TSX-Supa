#!/usr/bin/env python3
"""
Auto-fix rgba(var(--x), opacity) -> color-mix() for Tailwind v4
"""

import re
import sys
from pathlib import Path

def fix_file(filepath: str):
    path = Path(filepath)
    if not path.exists():
        print(f"File not found: {filepath}")
        sys.exit(1)

    content = path.read_text(encoding='utf-8')
    original = content

    # Pattern: rgba(var(--name), 0.45) or rgba(var(--name),.45)
    # Captures: var name and opacity value
    pattern = re.compile(
        r'rgba\(\s*(var\(--[a-zA-Z0-9_-]+\))\s*,\s*([0-9.]+)\s*\)',
        re.IGNORECASE
    )

    def replacer(match):
        var_expr = match.group(1)  # e.g., var(--neon-cyan)
        opacity = float(match.group(2))
        # Convert 0.45 -> 45%, 0.18 -> 18%, etc.
        percent = int(round(opacity * 100))
        return f'color-mix(in oklab, {var_expr} {percent}%, transparent)'

    content = pattern.sub(replacer, content)

    if content == original:
        print("No rgba(var(--*), opacity) patterns found.")
        return

    # Backup original
    backup = path.with_suffix(path.suffix + '.backup')
    backup.write_text(original, encoding='utf-8')
    print(f"Backup saved to: {backup}")

    path.write_text(content, encoding='utf-8')

    # Count replacements
    count = len(pattern.findall(original))
    print(f"Fixed {count} rgba(var(--*), opacity) patterns in {filepath}")
    print("\nExample changes:")
    print("  rgba(var(--neon-cyan), 0.45)")
    print("    -> color-mix(in oklab, var(--neon-cyan) 45%, transparent)")
    print("  rgba(var(--neon-amber), 0.18)")
    print("    -> color-mix(in oklab, var(--neon-amber) 18%, transparent)")
    print("\nRebuild your project and verify the glows/borders are back.")

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'src/index.css'
    fix_file(target)
