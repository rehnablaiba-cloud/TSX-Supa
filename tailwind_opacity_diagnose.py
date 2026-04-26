
import os, re, sys, json
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict
from collections import defaultdict

REMOVED_UTILITIES = {
    'bg-opacity-0', 'bg-opacity-5', 'bg-opacity-10', 'bg-opacity-20',
    'bg-opacity-25', 'bg-opacity-30', 'bg-opacity-40', 'bg-opacity-50',
    'bg-opacity-60', 'bg-opacity-70', 'bg-opacity-75', 'bg-opacity-80',
    'bg-opacity-90', 'bg-opacity-95', 'bg-opacity-100',
    'text-opacity-0', 'text-opacity-5', 'text-opacity-10', 'text-opacity-20',
    'text-opacity-25', 'text-opacity-30', 'text-opacity-40', 'text-opacity-50',
    'text-opacity-60', 'text-opacity-70', 'text-opacity-75', 'text-opacity-80',
    'text-opacity-90', 'text-opacity-95', 'text-opacity-100',
    'border-opacity-0', 'border-opacity-5', 'border-opacity-10', 'border-opacity-20',
    'border-opacity-25', 'border-opacity-30', 'border-opacity-40', 'border-opacity-50',
    'border-opacity-60', 'border-opacity-70', 'border-opacity-75', 'border-opacity-80',
    'border-opacity-90', 'border-opacity-95', 'border-opacity-100',
    'divide-opacity-0', 'divide-opacity-5', 'divide-opacity-10', 'divide-opacity-20',
    'divide-opacity-25', 'divide-opacity-30', 'divide-opacity-40', 'divide-opacity-50',
    'divide-opacity-60', 'divide-opacity-70', 'divide-opacity-75', 'divide-opacity-80',
    'divide-opacity-90', 'divide-opacity-95', 'divide-opacity-100',
    'ring-opacity-0', 'ring-opacity-5', 'ring-opacity-10', 'ring-opacity-20',
    'ring-opacity-25', 'ring-opacity-30', 'ring-opacity-40', 'ring-opacity-50',
    'ring-opacity-60', 'ring-opacity-70', 'ring-opacity-75', 'ring-opacity-80',
    'ring-opacity-90', 'ring-opacity-95', 'ring-opacity-100',
    'placeholder-opacity-0', 'placeholder-opacity-5', 'placeholder-opacity-10',
    'placeholder-opacity-20', 'placeholder-opacity-25', 'placeholder-opacity-30',
    'placeholder-opacity-40', 'placeholder-opacity-50', 'placeholder-opacity-60',
    'placeholder-opacity-70', 'placeholder-opacity-75', 'placeholder-opacity-80',
    'placeholder-opacity-90', 'placeholder-opacity-95', 'placeholder-opacity-100',
    'fill-opacity-0', 'fill-opacity-5', 'fill-opacity-10', 'fill-opacity-20',
    'fill-opacity-25', 'fill-opacity-30', 'fill-opacity-40', 'fill-opacity-50',
    'fill-opacity-60', 'fill-opacity-70', 'fill-opacity-75', 'fill-opacity-80',
    'fill-opacity-90', 'fill-opacity-95', 'fill-opacity-100',
    'stroke-opacity-0', 'stroke-opacity-5', 'stroke-opacity-10', 'stroke-opacity-20',
    'stroke-opacity-25', 'stroke-opacity-30', 'stroke-opacity-40', 'stroke-opacity-50',
    'stroke-opacity-60', 'stroke-opacity-70', 'stroke-opacity-75', 'stroke-opacity-80',
    'stroke-opacity-90', 'stroke-opacity-95', 'stroke-opacity-100',
    'backdrop-opacity-0', 'backdrop-opacity-5', 'backdrop-opacity-10', 'backdrop-opacity-20',
    'backdrop-opacity-25', 'backdrop-opacity-30', 'backdrop-opacity-40', 'backdrop-opacity-50',
    'backdrop-opacity-60', 'backdrop-opacity-70', 'backdrop-opacity-75', 'backdrop-opacity-80',
    'backdrop-opacity-90', 'backdrop-opacity-95', 'backdrop-opacity-100',
}

SCAN_EXTENSIONS = {'.html', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.php', '.erb', '.hbs', '.js', '.ts', '.css', '.scss'}

@dataclass
class Issue:
    file: str
    line: int
    column: int
    severity: str
    category: str
    message: str
    original: str
    suggestion: str
    context: str

@dataclass
class MigrationReport:
    total_files_scanned: int
    issues_found: int
    errors: int
    warnings: int
    infos: int
    by_category: Dict[str, int]
    by_file: Dict[str, int]
    issues: List[Issue]
    tailwind_version: str = "unknown"
    has_v3_directives: bool = False
    has_v4_import: bool = False
    has_tailwind_config: bool = False
    has_color_mix_in_css: bool = False
    has_tw_bg_opacity_in_css: bool = False

class TailwindOpacityDiagnostic:
    def __init__(self, project_path: str):
        self.project_path = Path(project_path).resolve()
        self.issues: List[Issue] = []
        self.files_scanned = 0
        self.tailwind_version = "unknown"
        self.has_v3_directives = False
        self.has_v4_import = False
        self.has_tailwind_config = False
        self.has_color_mix_in_css = False
        self.has_tw_bg_opacity_in_css = False

        escaped_utils = '|'.join(re.escape(u) for u in REMOVED_UTILITIES)
        self.opacity_pattern = re.compile(r'\b(' + escaped_utils + r')\b')
        self.v3_directive_pattern = re.compile(r'@tailwind\s+(base|components|utilities)')
        self.v4_import_pattern = re.compile(r"@import\s+['\"]tailwindcss['\"]")
        self.arbitrary_opacity_pattern = re.compile(
            r'(bg|text|border|divide|ring|placeholder|fill|stroke|backdrop)-opacity-\[([^\]]+)\]'
        )
        self.rgba_var_pattern = re.compile(
            r'rgba\(\s*var\([^)]+\)\s*,\s*[0-9.]+\s*\)',
            re.IGNORECASE
        )
        self.apply_opacity_pattern = re.compile(
            r'@apply\s+[^;]*\b(bg|text|border|divide|ring|placeholder|fill|stroke|backdrop)-opacity-[0-9]+'
        )

    def _clean_version(self, version: str) -> str:
        return re.sub(r'^[^0-9]*', '', version)

    def check_tailwind_version(self):
        package_json = self.project_path / 'package.json'
        package_lock = self.project_path / 'package-lock.json'

        if package_json.exists():
            try:
                with open(package_json, 'r', encoding='utf-8') as f:
                    pkg = json.load(f)
                    deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
                    if 'tailwindcss' in deps:
                        self.tailwind_version = self._clean_version(deps['tailwindcss'])
            except Exception:
                pass

        if self.tailwind_version == "unknown" and package_lock.exists():
            try:
                with open(package_lock, 'r', encoding='utf-8') as f:
                    lock = json.load(f)
                    packages = lock.get('packages', {})
                    for key, val in packages.items():
                        if 'tailwindcss' in key:
                            self.tailwind_version = self._clean_version(val.get('version', 'unknown'))
                            break
            except Exception:
                pass

        config_files = [
            self.project_path / 'tailwind.config.js',
            self.project_path / 'tailwind.config.ts',
            self.project_path / 'tailwind.config.mjs',
        ]
        for cf in config_files:
            if cf.exists():
                self.has_tailwind_config = True
                break

    def scan_file(self, file_path: Path) -> List[Issue]:
        issues = []
        relative_path = str(file_path.relative_to(self.project_path))

        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                lines = content.split('\n')
        except Exception as e:
            return [Issue(
                file=relative_path, line=0, column=0,
                severity='error', category='config-issue',
                message=f"Could not read file: {e}",
                original="", suggestion="", context=""
            )]

        if file_path.suffix in ('.css', '.scss'):
            for i, line in enumerate(lines, 1):
                if self.v3_directive_pattern.search(line):
                    issues.append(Issue(
                        file=relative_path, line=i, column=line.find('@tailwind') + 1,
                        severity='error', category='v3-directive',
                        message="v3 @tailwind directives found - v4 uses @import 'tailwindcss'",
                        original=line.strip(),
                        suggestion="@import 'tailwindcss';",
                        context=line.strip()
                    ))
                    self.has_v3_directives = True

                if self.v4_import_pattern.search(line):
                    self.has_v4_import = True

                for match in self.rgba_var_pattern.finditer(line):
                    issues.append(Issue(
                        file=relative_path, line=i, column=match.start() + 1,
                        severity='warning', category='custom-color-opacity',
                        message="rgba(var(--*), opacity) pattern detected - likely broken in v4",
                        original=match.group(0),
                        suggestion="Use color-mix(in oklab, var(--color) 50%, transparent) or Tailwind slash syntax",
                        context=line.strip()[:80]
                    ))

                for match in self.apply_opacity_pattern.finditer(line):
                    issues.append(Issue(
                        file=relative_path, line=i, column=match.start() + 1,
                        severity='error', category='apply-opacity',
                        message="@apply with removed opacity utility - will fail silently in v4",
                        original=match.group(0),
                        suggestion="Replace with color-mix() or use inline utility classes",
                        context=line.strip()[:80]
                    ))

        for i, line in enumerate(lines, 1):
            for match in self.opacity_pattern.finditer(line):
                utility = match.group(0)
                parts = utility.rsplit('-', 1)
                if len(parts) == 2:
                    prefix, opacity_val = parts
                    mapping = {
                        'bg-opacity': 'bg-<color>/<opacity> (e.g., bg-black/50)',
                        'text-opacity': 'text-<color>/<opacity> (e.g., text-white/75)',
                        'border-opacity': 'border-<color>/<opacity> (e.g., border-gray-200/25)',
                        'divide-opacity': 'divide-<color>/<opacity>',
                        'ring-opacity': 'ring-<color>/<opacity>',
                        'placeholder-opacity': 'placeholder-<color>/<opacity>',
                        'fill-opacity': 'fill-<color>/<opacity>',
                        'stroke-opacity': 'stroke-<color>/<opacity>',
                        'backdrop-opacity': 'backdrop-<color>/<opacity> or use bg-<color>/<opacity> on pseudo-element',
                    }
                    suggestion = mapping.get(prefix, f"Use {prefix.replace('-opacity', '')}-<color>/<opacity>")

                    issues.append(Issue(
                        file=relative_path, line=i, column=match.start() + 1,
                        severity='error', category='removed-utility',
                        message=f"Removed utility: {utility} is not available in Tailwind v4",
                        original=utility,
                        suggestion=suggestion,
                        context=line.strip()[:80]
                    ))

            for match in self.arbitrary_opacity_pattern.finditer(line):
                issues.append(Issue(
                    file=relative_path, line=i, column=match.start() + 1,
                    severity='warning', category='removed-utility',
                    message=f"Arbitrary opacity utility {match.group(0)} may not work in v4",
                    original=match.group(0),
                    suggestion=f"Use {match.group(1)}-<color>/{match.group(2)}",
                    context=line.strip()[:80]
                ))

        return issues

    def analyze_css_output(self):
        css_paths = list(self.project_path.rglob('*.css'))
        for css_path in css_paths:
            if 'node_modules' in str(css_path):
                continue
            try:
                with open(css_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    if '--tw-bg-opacity' in content:
                        self.has_tw_bg_opacity_in_css = True
                        if 'color-mix' not in content:
                            rel = str(css_path.relative_to(self.project_path))
                            self.issues.append(Issue(
                                file=rel, line=1, column=1,
                                severity='warning', category='config-issue',
                                message="CSS contains v3 --tw-bg-opacity but not v4 color-mix()",
                                original="--tw-bg-opacity",
                                suggestion="Rebuild with Tailwind v4 to generate color-mix() based styles",
                                context="Generated CSS appears to be from v3"
                            ))
                    if 'color-mix(in oklab' in content:
                        self.has_color_mix_in_css = True
                        rel = str(css_path.relative_to(self.project_path))
                        self.issues.append(Issue(
                            file=rel, line=1, column=1,
                            severity='info', category='config-issue',
                            message="CSS contains v4 color-mix() - good",
                            original="color-mix()",
                            suggestion="None",
                            context="Generated CSS is using v4 modern syntax"
                        ))
            except Exception:
                pass

    def run(self) -> MigrationReport:
        print(f"Scanning project: {self.project_path}")
        self.check_tailwind_version()
        print(f"Tailwind version detected: {self.tailwind_version}")

        if self.has_tailwind_config:
            print("WARNING: tailwind.config.js found - v4 prefers CSS-based configuration")

        is_v4 = self.tailwind_version.startswith('4.') or self.tailwind_version == 'latest'
        if not is_v4 and self.tailwind_version != "unknown":
            print(f"WARNING: Project uses Tailwind {self.tailwind_version}, not v4.")

        for ext in SCAN_EXTENSIONS:
            for file_path in self.project_path.rglob(f'*{ext}'):
                if 'node_modules' in str(file_path) or '.git' in str(file_path):
                    continue
                self.files_scanned += 1
                issues = self.scan_file(file_path)
                self.issues.extend(issues)

        self.analyze_css_output()

        by_category = defaultdict(int)
        by_file = defaultdict(int)
        errors = warnings = infos = 0

        for issue in self.issues:
            by_category[issue.category] += 1
            by_file[issue.file] += 1
            if issue.severity == 'error':
                errors += 1
            elif issue.severity == 'warning':
                warnings += 1
            else:
                infos += 1

        return MigrationReport(
            total_files_scanned=self.files_scanned,
            issues_found=len(self.issues),
            errors=errors,
            warnings=warnings,
            infos=infos,
            by_category=dict(by_category),
            by_file=dict(by_file),
            issues=self.issues,
            tailwind_version=self.tailwind_version,
            has_v3_directives=self.has_v3_directives,
            has_v4_import=self.has_v4_import,
            has_tailwind_config=self.has_tailwind_config,
            has_color_mix_in_css=self.has_color_mix_in_css,
            has_tw_bg_opacity_in_css=self.has_tw_bg_opacity_in_css,
        )

    def print_report(self, report: MigrationReport):
        print("\n" + "=" * 70)
        print("TAILWIND V4 OPACITY MIGRATION DIAGNOSTIC REPORT")
        print("=" * 70)

        print(f"\nSUMMARY")
        print(f"   Tailwind Version: {report.tailwind_version}")
        print(f"   Files Scanned: {report.total_files_scanned}")
        print(f"   Issues Found: {report.issues_found}")
        print(f"   Errors: {report.errors}")
        print(f"   Warnings: {report.warnings}")
        print(f"   Infos: {report.infos}")

        print(f"\nCONFIG STATUS")
        if report.has_tailwind_config:
            print("   tailwind.config.js EXISTS - v4 uses CSS-based config (@theme)")
        else:
            print("   No tailwind.config.js found - good for v4")
        if report.has_v3_directives and not report.has_v4_import:
            print("   CRITICAL: v3 @tailwind directives detected but no v4 @import found!")
        if report.has_tw_bg_opacity_in_css and not report.has_color_mix_in_css:
            print("   CRITICAL: Generated CSS uses v3 --tw-bg-opacity, not v4 color-mix()")
        if report.has_color_mix_in_css:
            print("   OK: Generated CSS contains v4 color-mix()")

        print(f"\nBREAKDOWN BY CATEGORY")
        for cat, count in sorted(report.by_category.items()):
            print(f"   {cat}: {count}")

        if report.issues:
            print(f"\nDETAILED ISSUES (first 30 shown)")
            for issue in report.issues[:30]:
                print(f"\n   {issue.file}:{issue.line}:{issue.column}")
                print(f"      [{issue.severity.upper()}] {issue.category}")
                print(f"      {issue.message}")
                print(f"      Original: {issue.original}")
                print(f"      Suggestion: {issue.suggestion}")
                if issue.context:
                    print(f"      Context: ...{issue.context}...")

        print(f"\nMIGRATION GUIDE")
        print("   v3 (REMOVED)                      -> v4 (USE THIS)")
        print("   bg-red-500 bg-opacity-50          -> bg-red-500/50")
        print("   text-white text-opacity-75        -> text-white/75")
        print("   border-gray-200 border-opacity-25 -> border-gray-200/25")
        print("   fill-blue-500 fill-opacity-50     -> fill-blue-500/50")
        print("   stroke-red-500 stroke-opacity-50  -> stroke-red-500/50")
        print("   backdrop-opacity-50               -> backdrop:bg-black/50 (or custom)")

        print(f"\nCUSTOM COLOR OPACITY PATTERNS")
        print("   If using rgba(var(--color), 0.5) in custom CSS:")
        print("   v4 outputs OKLCH colors, not RGB. The var() will contain OKLCH values.")
        print("   FIX: Use color-mix(in oklab, var(--color) 50%, transparent)")
        print("   OR:  Define opacity in @theme: --color-primary: oklch(...) and use bg-primary/50")

        print(f"\nBROWSER COMPATIBILITY")
        print("   v4 uses CSS color-mix() which requires:")
        print("   - Chrome/Edge: 111+")
        print("   - Firefox: 128+")
        print("   - Safari: 16.4+")

        print(f"\nQUICK FIXES")
        print("   1. Run: npx @tailwindcss/upgrade@next")
        print("   2. Migrate tailwind.config.js colors to @theme in CSS")
        print("   3. Replace rgba(var(--x), 0.5) with color-mix() or slash syntax")
        print("   4. Ensure CSS entry point uses: @import 'tailwindcss';")
        print("   5. Check DevTools: inspect element -> Computed -> background-color")
        print("      Should show 'color-mix(in oklab, ...)' not 'rgba(...)'")

        print("\n" + "=" * 70)

def main():
    project_path = sys.argv[1] if len(sys.argv) > 1 else '.'
    diagnostic = TailwindOpacityDiagnostic(project_path)
    report = diagnostic.run()
    diagnostic.print_report(report)

    if report.errors > 0 or (report.has_v3_directives and not report.has_v4_import) or (report.has_tw_bg_opacity_in_css and not report.has_color_mix_in_css):
        print("\nMigration issues detected. Fix before deploying.")
        sys.exit(1)
    else:
        print("\nNo critical opacity migration issues found in source files.")
        print("If opacity still looks wrong, check:")
        print("  - Browser DevTools for the computed background-color value")
        print("  - Whether custom CSS with rgba(var(--*), x) is overriding Tailwind")
        print("  - Whether @apply in custom CSS references removed utilities")
        sys.exit(0)

if __name__ == '__main__':
    main()
PYEOF