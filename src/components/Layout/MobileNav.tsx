// src/components/Layout/MobileNav.tsx
// iOS 26 Liquid Glass design + GSAP animations

import React, { useLayoutEffect, useRef, useEffect, useState, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import {
  Package,
  FlaskConical,
  Hash,
  FolderOpen,
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
  | "test-docx"
  | "theme"
  | null;

const MobileNav: React.FC<Props> = ({ activePage, onNavigate }) => {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [activeModal, setModal] = useState<ActiveModal>(null);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);

  const navRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isAdmin = user?.role === "admin";

  const glassNav = useMemo(
    (): React.CSSProperties => ({
      background: `color-mix(in srgb, var(--bg-surface) 40%, transparent)`,
      backdropFilter: "blur(28px) saturate(180%) brightness(1.06)",
      WebkitBackdropFilter: "blur(28px) saturate(180%) brightness(1.06)",
      border: `1px solid color-mix(in srgb, var(--border-color) 55%, transparent)`,
      boxShadow:
        "0 8px 32px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.06)",
    }),
    []
  );

  useEffect(() => {
    fetchModuleOptions()
      .then(setModules)
      .catch(() => {});
  }, []);

  useLayoutEffect(() => {
    if (!navRef.current) return;
    const ctx = gsap.context(() => {
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
    });
    return () => ctx.revert();
  }, []);

  // Click outside to close more menu
  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = () => setMoreOpen(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [moreOpen]);

  // Animate more popup
  useLayoutEffect(() => {
    if (!moreRef.current) return;
    const ctx = gsap.context(() => {
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
        const items = moreRef.current!.querySelectorAll(".more-item");
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
    });
    return () => ctx.revert();
  }, [moreOpen]);

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
      .timeline({ overwrite: true })
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
      {/* More Options Popup — centered above navbar, same width, flex-wrap centered */}
      <div
        ref={moreRef}
        className="fixed left-1/2 -translate-x-1/2 z-70 md:hidden glass-frost p-3"
        style={{
          bottom: "calc(76px + env(safe-area-inset-bottom, 0px))",
          width: "calc(100% - 32px)",
          maxWidth: 420,
          display: "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap justify-center gap-x-2 gap-y-3">
          {/* Theme toggle */}
          <button
            onClick={() => {
              setTheme(theme === "dark" ? "light" : "dark");
              setMoreOpen(false);
            }}
            className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
            style={{ width: 72 }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background:
                  "color-mix(in srgb, var(--bg-card) 50%, transparent)",
              }}
            >
              <span className="text-t-secondary">
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </span>
            </div>
            <span className="text-[9px] font-medium text-t-muted leading-tight text-center">
              {theme === "dark" ? "Light" : "Dark"}
            </span>
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => {
                  setModal("export");
                  setMoreOpen(false);
                }}
                className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
                style={{ width: 72 }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      "color-mix(in srgb, var(--bg-card) 50%, transparent)",
                  }}
                >
                  <span className="text-t-secondary">
                    <Download size={16} />
                  </span>
                </div>
                <span className="text-[9px] font-medium text-t-muted leading-tight text-center">
                  Export
                </span>
              </button>

              <button
                onClick={() => {
                  setModal("test-docx");
                  setMoreOpen(false);
                }}
                className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
                style={{ width: 72 }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      "color-mix(in srgb, var(--bg-card) 50%, transparent)",
                  }}
                >
                  <span className="text-t-secondary">
                    <FileText size={16} />
                  </span>
                </div>
                <span className="text-[9px] font-medium text-t-muted leading-tight text-center">
                  DOCX
                </span>
              </button>

              <button
                onClick={() => {
                  setModal("modules");
                  setMoreOpen(false);
                }}
                className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
                style={{ width: 72 }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      "color-mix(in srgb, var(--bg-card) 50%, transparent)",
                  }}
                >
                  <span className="text-t-secondary">
                    <Package size={16} />
                  </span>
                </div>
                <span className="text-[9px] font-medium text-t-muted leading-tight text-center">
                  Modules
                </span>
              </button>

              <button
                onClick={() => {
                  setModal("tests");
                  setMoreOpen(false);
                }}
                className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
                style={{ width: 72 }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      "color-mix(in srgb, var(--bg-card) 50%, transparent)",
                  }}
                >
                  <span className="text-t-secondary">
                    <FlaskConical size={16} />
                  </span>
                </div>
                <span className="text-[9px] font-medium text-t-muted leading-tight text-center">
                  Tests
                </span>
              </button>

              <button
                onClick={() => {
                  setModal("steps-csv");
                  setMoreOpen(false);
                }}
                className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
                style={{ width: 72 }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      "color-mix(in srgb, var(--bg-card) 50%, transparent)",
                  }}
                >
                  <span className="text-t-secondary">
                    <Upload size={16} />
                  </span>
                </div>
                <span className="text-[9px] font-medium text-t-muted leading-tight text-center">
                  Import
                </span>
              </button>

              <button
                onClick={() => {
                  setModal("steps-manual");
                  setMoreOpen(false);
                }}
                className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
                style={{ width: 72 }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      "color-mix(in srgb, var(--bg-card) 50%, transparent)",
                  }}
                >
                  <span className="text-t-secondary">
                    <Hash size={16} />
                  </span>
                </div>
                <span className="text-[9px] font-medium text-t-muted leading-tight text-center">
                  Steps
                </span>
              </button>

              <button
                onClick={() => {
                  setModal("theme");
                  setMoreOpen(false);
                }}
                className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
                style={{ width: 72 }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background:
                      "color-mix(in srgb, var(--bg-card) 50%, transparent)",
                  }}
                >
                  <span className="text-t-secondary">
                    <Palette size={16} />
                  </span>
                </div>
                <span className="text-[9px] font-medium text-t-muted leading-tight text-center">
                  Theme
                </span>
              </button>
            </>
          )}

          {/* Sign Out */}
          <button
            onClick={() => {
              handleSignOut();
              setMoreOpen(false);
            }}
            className="more-item flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 hover:bg-fail/10 active:scale-90"
            style={{ width: 72 }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background:
                  "color-mix(in srgb, var(--color-fail) 12%, transparent)",
              }}
            >
              <span className="text-fail/80">
                <LogOut size={16} />
              </span>
            </div>
            <span className="text-[9px] font-medium text-fail/70 leading-tight text-center">
              Exit
            </span>
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav
        ref={navRef}
        className="fixed bottom-2 left-1/2 -translate-x-1/2 z-62 md:hidden
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
          const highlighted = isActive || (moreOpen && isMore);

          return (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (isMore) {
                  e.stopPropagation();
                  setMoreOpen((p) => !p);
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

      {/* Modals */}
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
      {activeModal === "theme" && <ThemeEditor onClose={close} />}
    </>
  );
};

export default MobileNav;
