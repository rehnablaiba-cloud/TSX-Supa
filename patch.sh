#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  patch.sh  —  Safe @gsap/react migration
#  Usage:   chmod +x patch.sh && ./patch.sh
#  Rules:   Skips missing files, skips already-patched blocks, reports all
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")"

python3 << 'PYEOF'
import os, sys

RED    = "\033[0;31m"
GREEN  = "\033[0;32m"
YELLOW = "\033[1;33m"
CYAN   = "\033[0;36m"
NC     = "\033[0m"

patched = 0
skipped = 0
failed  = 0

def add_import(path):
    global patched, skipped
    if not os.path.exists(path):
        print(f"{RED}[MISSING]{NC} {path} does not exist — cannot add import")
        return False
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if "useGSAP" in content:
        print(f"{YELLOW}[SKIP]{NC} useGSAP already imported in {path}")
        return True
    if 'import gsap from "gsap";' in content:
        content = content.replace(
            'import gsap from "gsap";',
            'import gsap from "gsap";\nimport { useGSAP } from "@gsap/react";'
        )
        print(f"{GREEN}[OK]{NC} Added useGSAP import after gsap import in {path}")
    else:
        content = 'import { useGSAP } from "@gsap/react";\n' + content
        print(f"{YELLOW}[WARN]{NC} No gsap import found — added useGSAP at top of {path}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    patched += 1
    return True

def replace_block(path, label, old, new):
    global patched, skipped, failed
    if not os.path.exists(path):
        print(f"{RED}[MISSING]{NC} {path} — {label}")
        skipped += 1
        return
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if old not in content:
        print(f"{YELLOW}[SKIP]{NC} {label} — pattern not found in {path}")
        skipped += 1
        return
    content = content.replace(old, new)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"{GREEN}[OK]{NC} {label}")
    patched += 1

print(f"{CYAN}═══════════════════════════════════════════════════════════════════{NC}")
print(f"{CYAN}  GSAP → @gsap/react  Migration Patch{NC}")
print(f"{CYAN}═══════════════════════════════════════════════════════════════════\n{NC}")

# ── 1. Imports ──────────────────────────────────────────────────────
for f in [
    "src/components/Auth/LoginPage.tsx",
    "src/components/Dashboard/Dashboard.tsx",
    "src/components/Layout/MobileNav.tsx",
    "src/components/Layout/ModalShell.tsx",
    "src/components/UI/DonutChart.tsx",
    "src/components/UI/LockWarningBanner.tsx",
]:
    add_import(f)

print()

# ── 2. LoginPage.tsx ────────────────────────────────────────────────
replace_block(
    "src/components/Auth/LoginPage.tsx",
    "LoginPage: useEffect → useGSAP (card entrance)",
    '''  useEffect(() => {
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 40, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.4)" }
    );
  }, []);''',
    '''  useGSAP(() => {
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 40, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.4)" }
    );
  }, { scope: cardRef });'''
)

# ── 3. Dashboard.tsx ────────────────────────────────────────────────
replace_block(
    "src/components/Dashboard/Dashboard.tsx",
    "Dashboard: useLayoutEffect → useGSAP (grid stagger)",
    '''  useLayoutEffect(() => {
    if (!initialLoad && gridRef.current && gridRef.current.children.length > 0)
      gsap.fromTo(
        gridRef.current.children,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.06,
          duration: 0.4,
          ease: "power2.out",
          clearProps: "opacity,transform",
        }
      );
  }, [initialLoad, modules.length]);''',
    '''  useGSAP(() => {
    if (!initialLoad && gridRef.current && gridRef.current.children.length > 0) {
      gsap.fromTo(
        gridRef.current.children,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.06,
          duration: 0.4,
          ease: "power2.out",
          clearProps: "opacity,transform",
        }
      );
    }
  }, { scope: gridRef, dependencies: [initialLoad, modules.length] });'''
)

# ── 4. MobileNav.tsx — nav entrance ─────────────────────────────────
replace_block(
    "src/components/Layout/MobileNav.tsx",
    "MobileNav: useEffect → useGSAP (nav entrance)",
    '''  useEffect(() => {
    if (!navRef.current) return;
    gsap.fromTo(
      navRef.current,
      { y: 80, opacity: 0, scale: 0.92 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.65,
        ease: "back.out(1.4)",
        delay: 0.1,
      }
    );
  }, []);''',
    '''  useGSAP(() => {
    if (!navRef.current) return;
    gsap.fromTo(
      navRef.current,
      { y: 80, opacity: 0, scale: 0.92 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.65,
        ease: "back.out(1.4)",
        delay: 0.1,
      }
    );
  }, { scope: navRef });'''
)

# ── 5. MobileNav.tsx — more popup ───────────────────────────────────
replace_block(
    "src/components/Layout/MobileNav.tsx",
    "MobileNav: useEffect → useGSAP (more popup)",
    '''  useEffect(() => {
    if (!moreRef.current) return;
    if (moreOpen) {
      gsap.set(moreRef.current, { display: "flex" });
      gsap.fromTo(
        moreRef.current,
        { opacity: 0, scale: 0.92, y: 8 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.3,
          ease: "back.out(1.4)",
        }
      );
      const items = moreRef.current.querySelectorAll(".more-item");
      gsap.fromTo(
        items,
        { opacity: 0, scale: 0.85 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.25,
          stagger: 0.02,
          ease: "back.out(1.4)",
          delay: 0.08,
        }
      );
    } else {
      gsap.to(moreRef.current, {
        opacity: 0,
        scale: 0.95,
        y: 8,
        duration: 0.2,
        ease: "power2.in",
        onComplete: () => {
          if (moreRef.current) gsap.set(moreRef.current, { display: "none" });
        },
      });
    }
  }, [moreOpen]);''',
    '''  useGSAP(() => {
    if (!moreRef.current) return;
    if (moreOpen) {
      gsap.set(moreRef.current, { display: "flex" });
      gsap.fromTo(
        moreRef.current,
        { opacity: 0, scale: 0.92, y: 8 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.3,
          ease: "back.out(1.4)",
        }
      );
      const items = moreRef.current.querySelectorAll(".more-item");
      gsap.fromTo(
        items,
        { opacity: 0, scale: 0.85 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.25,
          stagger: 0.02,
          ease: "back.out(1.4)",
          delay: 0.08,
        }
      );
    } else {
      gsap.to(moreRef.current, {
        opacity: 0,
        scale: 0.95,
        y: 8,
        duration: 0.2,
        ease: "power2.in",
        onComplete: () => {
          if (moreRef.current) gsap.set(moreRef.current, { display: "none" });
        },
      });
    }
  }, { scope: moreRef, dependencies: [moreOpen] });'''
)

# ── 6. MobileNav.tsx — handleNavPress timeline ──────────────────────
replace_block(
    "src/components/Layout/MobileNav.tsx",
    "MobileNav: timeline overwrite",
    '''    gsap
      .timeline()
      .to(el, { scale: 0.82, duration: 0.1, ease: "power2.in" })
      .to(el, { scale: 1.08, duration: 0.18, ease: "back.out(2)" })
      .to(el, { scale: 1, duration: 0.14, ease: "power2.out" });''',
    '''    gsap
      .timeline({ overwrite: true })
      .to(el, { scale: 0.82, duration: 0.1, ease: "power2.in" })
      .to(el, { scale: 1.08, duration: 0.18, ease: "back.out(2)" })
      .to(el, { scale: 1, duration: 0.14, ease: "power2.out" });'''
)

# ── 7. ModalShell.tsx — entrance ────────────────────────────────────
replace_block(
    "src/components/Layout/ModalShell.tsx",
    "ModalShell: useEffect → useGSAP (entrance)",
    '''  useEffect(() => {
    if (!backdropRef.current || !cardRef.current) return;

    gsap.fromTo(
      backdropRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 0.25, ease: "power2.out" }
    );
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, scale: 0.96, y: 16 },
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.35,
        ease: "back.out(1.4)",
        delay: 0.05,
      }
    );
  }, []);''',
    '''  useGSAP(() => {
    if (!backdropRef.current || !cardRef.current) return;

    gsap.fromTo(
      backdropRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 0.25, ease: "power2.out" }
    );
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, scale: 0.96, y: 16 },
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.35,
        ease: "back.out(1.4)",
        delay: 0.05,
      }
    );
  }, { scope: cardRef });'''
)

# ── 8. ModalShell.tsx — handleClose ─────────────────────────────────
replace_block(
    "src/components/Layout/ModalShell.tsx",
    "ModalShell: handleClose killTweensOf",
    '''  const handleClose = () => {
    if (!backdropRef.current || !cardRef.current) {
      onClose();
      return;
    }
    gsap.to(cardRef.current, {
      opacity: 0,
      scale: 0.96,
      y: 12,
      duration: 0.2,
      ease: "power2.in",
    });
    gsap.to(backdropRef.current, {
      opacity: 0,
      duration: 0.2,
      ease: "power2.in",
      onComplete: onClose,
    });
  };''',
    '''  const handleClose = () => {
    if (!backdropRef.current || !cardRef.current) {
      onClose();
      return;
    }
    gsap.killTweensOf([cardRef.current, backdropRef.current]);
    gsap.to(cardRef.current, {
      opacity: 0,
      scale: 0.96,
      y: 12,
      duration: 0.2,
      ease: "power2.in",
    });
    gsap.to(backdropRef.current, {
      opacity: 0,
      duration: 0.2,
      ease: "power2.in",
      onComplete: onClose,
    });
  };'''
)

# ── 9. DonutChart.tsx ───────────────────────────────────────────────
replace_block(
    "src/components/UI/DonutChart.tsx",
    "DonutChart: useEffect → useGSAP",
    '''  useEffect(() => {
    refs.current.forEach((el, i) => {
      if (!el) return;
      gsap.fromTo(el,
        { strokeDasharray: `0 ${circ}` },
        { strokeDasharray: `${arcs[i].dash} ${arcs[i].gap}`, duration: 1, ease: "power2.out", delay: i * 0.1 }
      );
    });
  }, [segments]);''',
    '''  useGSAP(() => {
    refs.current.forEach((el, i) => {
      if (!el) return;
      gsap.fromTo(el,
        { strokeDasharray: `0 ${circ}` },
        { strokeDasharray: `${arcs[i].dash} ${arcs[i].gap}`, duration: 1, ease: "power2.out", delay: i * 0.1 }
      );
    });
  }, { dependencies: [segments] });'''
)

# ── 10. LockWarningBanner.tsx ───────────────────────────────────────
replace_block(
    "src/components/UI/LockWarningBanner.tsx",
    "LockWarningBanner: useLayoutEffect → useGSAP",
    '''  useLayoutEffect(() => {
    if (bannerRef.current)
      gsap.fromTo(
        bannerRef.current,
        { opacity: 0, y: -8 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
      );
  }, []);''',
    '''  useGSAP(() => {
    if (bannerRef.current)
      gsap.fromTo(
        bannerRef.current,
        { opacity: 0, y: -8 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
      );
  }, { scope: bannerRef });'''
)

print(f"\n{CYAN}═══════════════════════════════════════════════════════════════════{NC}")
print(f"{CYAN}  PATCH SUMMARY{NC}")
print(f"{CYAN}═══════════════════════════════════════════════════════════════════{NC}")
print(f"  {GREEN}Patched:{NC} {patched}")
print(f"  {YELLOW}Skipped:{NC} {skipped}")
print(f"  {RED}Failed: {NC} {failed}")
print(f"{CYAN}═══════════════════════════════════════════════════════════════════{NC}")

if failed > 0:
    sys.exit(1)
PYEOF
