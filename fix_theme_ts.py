#!/usr/bin/env python3
"""
Fix setProperty calls in src/theme.ts that use space-separated RGB.
"""

import re
import sys
from pathlib import Path


def fix_theme_file(filepath: str):
    path = Path(filepath)
    if not path.exists():
        print(f"File not found: {filepath}")
        sys.exit(1)

    content = path.read_text(encoding='utf-8')
    original = content

    # Pattern: setProperty('--var-name', 'r, g, b') -> setProperty('--var-name', '#rrggbb')
    # Also handles setProperty("--var-name", "r, g, b")
    pattern = re.compile(
        r"(setProperty\s*\(\s*['\"])(--neon-cyan)(['\"]\s*,\s*['\"])34,\s*211,\s*238(['\"]\s*\))"
    )
    content = pattern.sub(r"\1\2\3#22d3ee\4", content)

    pattern2 = re.compile(
        r"(setProperty\s*\(\s*['\"])(--neon-amber)(['\"]\s*,\s*['\"])245,\s*158,\s*11(['\"]\s*\))"
    )
    content = pattern2.sub(r"\1\2\3#f59e0b\4", content)

    if content == original:
        print("No space-separated RGB setProperty patterns found in theme.ts")
        return

    path.with_suffix(path.suffix + '.backup').write_text(original, encoding='utf-8')
    path.write_text(content, encoding='utf-8')

    print(f"Fixed setProperty calls in {filepath}")
    print("Changes:")
    print("  setProperty('--neon-cyan', '34, 211, 238') -> setProperty('--neon-cyan', '#22d3ee')")
    print("  setProperty('--neon-amber', '245, 158, 11') -> setProperty('--neon-amber', '#f59e0b')")
    print(f"Backup saved to: {filepath}.backup")


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'src/theme.ts'
    fix_theme_file(target)
