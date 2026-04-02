import React, { useRef, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";

interface Props { activePage: string; onNavigate: (page: string) => void; }

const MobileNav: React.FC<Props> = ({ activePage, onNavigate }) => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showMore, setShowMore] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.defaultRole === "admin";

  const items = [
    { id: "dashboard", icon: "📊", label: "Home" },
    { id: "report",    icon: "📋", label: "Report" },
    { id: "auditlog",  icon: "📜", label: "Audit" },
    ...(isAdmin ? [{ id: "users", icon: "👥", label: "Users" }] : []),
  ];

  useEffect(() => {
    if (!showMore) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [showMore]);

  return (
    <>
      {/* ── More sheet ── */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMore(false)} />

          {/* Sheet */}
          <div
            ref={sheetRef}
            className="relative w-full
              bg-bg-surface
              border-t border-[var(--border-color)]
              rounded-t-2xl px-6 pt-4 pb-10 flex flex-col gap-3 z-10"
          >
            {/* Handle */}
            <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mb-2" />

            {/* Theme toggle row */}
            <button
              onClick={() => { toggleTheme(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl
                bg-bg-card hover:bg-bg-base
                border border-[var(--border-color)]
                transition-colors text-t-primary"
            >
              <span className="text-2xl">{theme === "dark" ? "☀️" : "🌙"}</span>
              <div className="text-left">
                <p className="text-sm font-semibold">
                  {theme === "dark" ? "Light Mode" : "Dark Mode"}
                </p>
                <p className="text-xs text-t-muted">Switch appearance</p>
              </div>
            </button>

            {/* Divider */}
            <div className="border-t border-[var(--border-color)]" />

            {/* Sign out row */}
            <button
              onClick={() => { signOut(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl
                bg-red-50 dark:bg-red-500/10
                hover:bg-red-100 dark:hover:bg-red-500/20
                transition-colors text-red-600 dark:text-red-400
                border border-red-200 dark:border-red-500/20"
            >
              <span className="text-2xl">⎋</span>
              <div className="text-left">
                <p className="text-sm font-semibold">Sign Out</p>
                <p className="text-xs text-red-400/60">Signed in as {user?.email ?? "you"}</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40
        bg-bg-nav
        backdrop-blur
        border-t border-[var(--border-color)]
        flex items-center justify-around px-2 py-2">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors
              ${activePage === item.id
                ? "text-c-brand"
                : "text-t-muted"}`}
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}

        {/* More button */}
        <button
          onClick={() => setShowMore(true)}
          className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors
            ${showMore ? "text-c-brand" : "text-t-muted"}`}
        >
          <span className="text-xl">•••</span>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
};

export default MobileNav;
