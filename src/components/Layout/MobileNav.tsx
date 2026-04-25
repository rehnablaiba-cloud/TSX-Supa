// src/components/Layout/MobileNav.tsx
// iOS 26 Liquid Glass design + GSAP animations

import React, { useRef, useEffect, useState, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import {
  Package,
  FlaskConical,
  Hash,
  FolderOpen,
  X,
  Download,
  Upload,
  Palette,
  Sun,
  Moon,
  LogOut,
  Users,
  ScrollText,
  MoreHorizontal,
  LayoutDashboard,
  ClipboardList,
  FileText,
} from "lucide-react";
import gsap from "gsap";

import ThemeEditor from "../ThemeEditor/ThemeEditorPanel";
import type { ModuleOption } from "../../types";
import {
  releaseLocksAndSignOut,
  fetchModuleOptions,
} from "../../lib/supabase/queries";

import ExportDataModal from "../Modals/ExportAllModal";
import ImportModulesModal from "../Modals/ImportModulesModal";
import ImportTestsModal from "../Modals/ImportTestsModal";
import ImportStepsModal from "../Modals/ImportStepsModal";
import ImportStepsManualModal from "../Modals/ImportStepsManualModal";
import ExportTestDocxModal from "../Modals/ExportTestDocxModal";
import type { AppTheme } from "../../context/ThemeContext";

// ══════════════════════════════════════════════════════════════════════════════
// REMOVED: useThemeColor() and useBorderColor() hooks
// REPLACED BY: CSS color-mix() in style objects below
// color-mix(in srgb, var(--x) N%, transparent) works with any CSS custom
// property value (hex, rgb, hsl) without JS parsing.
// ══════════════════════════════════════════════════════════════════════════════

interface Props {
  activePage: string;
  onNavigate: (page: string, module_name?: string) => void;
}
type ActiveModal =
  | "export"
  | "modules"
  | "tests"
  | "steps-csv"
  | "steps-manual"
  | "theme"
  | "test-docx"
  | null;

const MobileNav: React.FC<Props> = ({ activePage, onNavigate }) => {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [activeModal, setModal] = useState<ActiveModal>(null);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const navRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isAdmin = user?.role === "admin";

  // ── Dynamic glass colors via CSS color-mix() ────────────────────────────
  // No parsing, no rAF, no hardcoded fallbacks. The browser resolves
  // var(--bg-surface) etc. instantly and correctly, even if overridden
  // by the ThemeEditor.

  const glassNav = useMemo(
    (): React.CSSProperties => ({
      background: `color-mix(in srgb, var(--bg-surface) 40%, transparent)`,
      backdropFilter: "blur(28px) saturate(180%) brightness(1.06)",
      WebkitBackdropFilter: "blur(28px) saturate(180%) brightness(1.06)",
      border: `1px solid color-mix(in srgb, var(--border-color) 55%, transparent)`,
      boxShadow:
        "0 8px 32px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.06)",
    }),
    [] // ← no dependencies! CSS vars are resolved by browser at paint time
  );

  const glassSheet = useMemo(
    (): React.CSSProperties => ({
      background: `color-mix(in srgb, var(--bg-surface) 55%, transparent)`,
      backdropFilter: "blur(40px) saturate(180%)",
      WebkitBackdropFilter: "blur(40px) saturate(180%)",
      borderTop: `1px solid color-mix(in srgb, var(--border-color) 55%, transparent)`,
      borderLeft: `1px solid color-mix(in srgb, var(--border-color) 55%, transparent)`,
      borderRight: `1px solid color-mix(in srgb, var(--border-color) 55%, transparent)`,
      boxShadow: "0 -8px 32px rgba(0,0,0,0.12)",
    }),
    []
  );

  const glassItem = useMemo(
    (): React.CSSProperties => ({
      background: `color-mix(in srgb, var(--bg-card) 28%, transparent)`,
      border: `1px solid color-mix(in srgb, var(--border-color) 55%, transparent)`,
    }),
    []
  );

  // ── Sheet drag-handle color ─────────────────────────────────────────────
  // Was previously `border` from useBorderColor(); now uses same color-mix.
  const dragHandleColor = `color-mix(in srgb, var(--border-color) 55%, transparent)`;

  useEffect(() => {
    fetchModuleOptions()
      .then(setModules)
      .catch(() => {});
  }, []);

  // ... rest of component unchanged below this point ...
  // ── Navbar entrance ───────────────────────────────────────────────────────
  useEffect(() => {
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
  }, []);

  // ── More sheet open/close ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sheetRef.current || !overlayRef.current) return;
    if (menuOpen) {
      gsap.set(sheetRef.current, { display: "flex" });
      gsap.fromTo(
        sheetRef.current,
        { y: "100%", opacity: 0 },
        { y: "0%", opacity: 1, duration: 0.42, ease: "expo.out" }
      );
      gsap.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.28, ease: "power2.out" }
      );
      const items = sheetRef.current.querySelectorAll(".sheet-item");
      gsap.fromTo(
        items,
        { x: -16, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.3,
          stagger: 0.04,
          ease: "power3.out",
          delay: 0.12,
        }
      );
    } else {
      gsap.to(sheetRef.current, {
        y: "100%",
        opacity: 0,
        duration: 0.28,
        ease: "power3.in",
        onComplete: () => {
          if (sheetRef.current) gsap.set(sheetRef.current, { display: "none" });
        },
      });
      gsap.to(overlayRef.current, { opacity: 0, duration: 0.2 });
    }
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const handleSignOut = async () => {
    if (user?.id) await releaseLocksAndSignOut(user.id, signOut);
    else await signOut();
  };

  const handleNavPress = (
    el: HTMLButtonElement | null,
    id: string,
    moduleName?: string
  ) => {
    if (!el) return;
    gsap
      .timeline()
      .to(el, { scale: 0.82, duration: 0.1, ease: "power2.in" })
      .to(el, { scale: 1.08, duration: 0.18, ease: "back.out(2)" })
      .to(el, { scale: 1, duration: 0.14, ease: "power2.out" });
    onNavigate(id, moduleName);
  };

  const close = () => setModal(null);

  const navItems = [
    { id: "dashboard", label: "Home", icon: <LayoutDashboard size={19} /> },
    { id: "report", label: "Report", icon: <ClipboardList size={19} /> },
    ...(isAdmin
      ? [
          { id: "users", label: "Users", icon: <Users size={19} /> },
          { id: "audit_log", label: "Audit", icon: <ScrollText size={19} /> },
        ]
      : []),
  ];

  const allNavItems = [
    ...navItems,
    ...(modules.length > 0
      ? [{ id: "__module__", label: "Module", icon: <FolderOpen size={19} /> }]
      : []),
    { id: "__more__", label: "More", icon: <MoreHorizontal size={19} /> },
  ];

  return (
    <>
      {/* ── Overlay ──────────────────────────────────────────────────────────
          bottom:80 — overlay stops before the nav so the nav is never covered.
          No backdropFilter here — backdrop-filter creates a stacking context
          which makes z-index comparisons with siblings unreliable. */}
      <div
        ref={overlayRef}
        className="fixed top-0 left-0 right-0 md:hidden"
        style={{
          bottom: 60,
          background: "rgba(0,0,0,0.48)",
          opacity: 0,
          display: menuOpen ? "block" : "none",
          pointerEvents: menuOpen ? "auto" : "none",
          zIndex: 55,
        }}
        onClick={closeMenu}
      />

      {/* ── Sheet  z-[60] ────────────────────────────────────────────────── */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 inset-x-0 z-[60] md:hidden rounded-t-[28px] flex-col"
        style={{ ...glassSheet, display: "none", maxHeight: "80vh" }}
      >
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div
            className="w-9 h-1 rounded-full"
            style={{ border: "1px solid var(--border-color)" }}
          />
        </div>

        <div className="flex items-center justify-between px-5 pb-3 shrink-0">
          <div>
            <p className="text-sm font-bold text-t-primary tracking-tight">
              Options
            </p>
            <p className="text-[11px] text-t-muted font-medium">
              {user?.email}
            </p>
          </div>
          <button
            onClick={closeMenu}
            className="w-8 h-8 rounded-full flex items-center justify-center text-t-muted hover:text-t-primary transition"
            style={glassItem}
          >
            <X size={14} />
          </button>
        </div>

        <div
          className="overflow-y-auto flex-1 px-3 flex flex-col gap-1"
          style={{
            paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Theme row */}
          <div className="sheet-item flex gap-2 mb-1">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex-1 flex items-center gap-2.5 px-4 py-3 rounded-2xl transition-colors"
              style={glassItem}
            >
              <span className="text-t-muted">
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </span>
              <span className="text-sm text-t-secondary font-medium">
                {theme === "dark" ? "Light Mode" : "Dark Mode"}
              </span>
            </button>
            <button
              onClick={() => {
                setModal("theme");
                closeMenu();
              }}
              className="flex items-center gap-2.5 px-4 py-3 rounded-2xl transition-colors"
              style={glassItem}
            >
              <Palette size={16} className="text-t-muted" />
              <span className="text-sm text-t-secondary font-medium">
                Theme
              </span>
            </button>
          </div>

          {isAdmin && (
            <>
              <p className="sheet-item text-[10px] font-bold text-t-muted uppercase tracking-widest px-2 mt-1 mb-0.5">
                Data Management
              </p>
              {(
                [
                  {
                    icon: <Download size={15} />,
                    label: "Export All Data",
                    modal: "export" as ActiveModal,
                  },
                  {
                    icon: <FileText size={15} />,
                    label: "Export Test (DOCX)",
                    modal: "test-docx" as ActiveModal,
                  },
                  {
                    icon: <Package size={15} />,
                    label: "Manage Modules",
                    modal: "modules" as ActiveModal,
                  },
                  {
                    icon: <FlaskConical size={15} />,
                    label: "Manage Tests",
                    modal: "tests" as ActiveModal,
                  },
                  {
                    icon: <Upload size={15} />,
                    label: "Import Steps (CSV)",
                    modal: "steps-csv" as ActiveModal,
                  },
                  {
                    icon: <Hash size={15} />,
                    label: "Manage Steps",
                    modal: "steps-manual" as ActiveModal,
                  },
                ] as {
                  icon: React.ReactNode;
                  label: string;
                  modal: ActiveModal;
                }[]
              ).map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setModal(item.modal);
                    closeMenu();
                  }}
                  className="sheet-item w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors"
                  style={glassItem}
                >
                  <span className="text-c-brand/70">{item.icon}</span>
                  <span className="text-sm text-t-secondary font-medium">
                    {item.label}
                  </span>
                </button>
              ))}
            </>
          )}

          <div
            className="h-px my-2 sheet-item"
            className="border border-[var(--border-color)]"
          />
          <button
            onClick={handleSignOut}
            className="sheet-item w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors hover:bg-red-500/10"
            style={{ ...glassItem, borderColor: "rgba(239,68,68,0.25)" }}
          >
            <LogOut size={15} className="text-red-400/70" />
            <span className="text-sm text-red-400/80 font-medium">
              Sign Out
            </span>
          </button>
        </div>
      </div>

      {/* ── Nav  z-[62] — above overlay(55) and sheet(60) ────────────────────
          Rendered last in the DOM so it's the topmost painted sibling.
          display is only hidden when a full-screen modal is open. */}
      <nav
        ref={navRef}
        className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[62] md:hidden
          rounded-[26px] flex items-center px-2 py-2 gap-1"
        style={{
          ...glassNav,
          width: "calc(100% - 32px)",
          maxWidth: 420,
          marginBottom: "env(safe-area-inset-bottom, 0px)",
          display: activeModal !== null ? "none" : undefined,
        }}
      >
        {allNavItems.map((item, i) => {
          const isActive =
            item.id === activePage ||
            (item.id === "__module__" && activePage === "module");
          const isMore = item.id === "__more__";
          const isModule = item.id === "__module__";
          const highlighted = isActive || (menuOpen && isMore);

          return (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={() => {
                if (isMore) {
                  setMenuOpen((p) => !p);
                  return;
                }
                if (isModule && modules[0]) {
                  handleNavPress(
                    itemRefs.current[i],
                    "module",
                    modules[0].name
                  );
                  return;
                }
                handleNavPress(itemRefs.current[i], item.id);
              }}
              className="relative flex flex-col items-center justify-center gap-0.5 flex-1 py-2 px-1 rounded-[18px] transition-all duration-200"
              style={
                isActive
                  ? {
                      background:
                        "color-mix(in srgb, var(--c-brand) 16%, transparent)",
                      boxShadow:
                        "0 0 14px color-mix(in srgb, var(--c-brand) 22%, transparent)",
                    }
                  : undefined
              }
            >
              {isActive && (
                <span
                  className="absolute top-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full"
                  style={{
                    background: "var(--c-brand)",
                    boxShadow: "0 0 8px var(--c-brand)",
                  }}
                />
              )}
              <span
                className="transition-colors duration-200"
                style={{
                  color: highlighted ? "var(--c-brand)" : "var(--t-secondary)",
                  opacity: highlighted ? 1 : 0.6,
                }}
              >
                {item.icon}
              </span>
              <span
                className="text-[9.5px] font-semibold tracking-wide transition-colors duration-200"
                style={{
                  color: highlighted ? "var(--c-brand)" : "var(--t-secondary)",
                  opacity: highlighted ? 1 : 0.45,
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {activeModal === "export" && <ExportDataModal onClose={close} />}
      {activeModal === "test-docx" && <ExportTestDocxModal onClose={close} />}
      {activeModal === "modules" && (
        <ImportModulesModal onClose={close} onBack={close} />
      )}
      {activeModal === "tests" && (
        <ImportTestsModal onClose={close} onBack={close} />
      )}
      {activeModal === "steps-csv" && (
        <ImportStepsModal onClose={close} onBack={close} />
      )}
      {activeModal === "steps-manual" && (
        <ImportStepsManualModal onClose={close} onBack={close} />
      )}
      {activeModal === "theme" && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <div className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto bg-bg-surface rounded-t-2xl border-t border-[var(--border-color)]">
            <ThemeEditor onClose={close} />
          </div>
        </div>
      )}
    </>
  );
};

export default MobileNav;
