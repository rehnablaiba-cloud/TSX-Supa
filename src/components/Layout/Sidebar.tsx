import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { Module } from "../../types";
import ThemeToggle from "../UI/ThemeToggle";

interface Props {
  activePage: string;
  onNavigate: (page: string, moduleId?: string) => void;
  modules:    Module[];
}

// Base nav items visible to all authenticated users
const BASE_NAV = [
  { id: "dashboard", label: "Dashboard",  icon: "📊" },
  { id: "report",    label: "Test Report", icon: "📋" },
];

// Admin-only nav items
const ADMIN_NAV = [
  { id: "auditlog", label: "Audit Log", icon: "📜" },
  { id: "users",    label: "Users",     icon: "👥" },
];

const Sidebar: React.FC<Props> = ({ activePage, onNavigate, modules }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch]       = useState("");
  const { user, signOut } = useAuth();
  const isAdmin = user?.defaultRole === "admin";

  const navItems = isAdmin ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV;

  const filtered = modules.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className={`hidden md:flex flex-col
      bg-bg-nav border-r border-[var(--border-color)]
      transition-all duration-300 ${collapsed ? "w-16" : "w-64"} h-screen sticky top-0 shrink-0`}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border-color)]">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="text-xl">🧪</span>
            <span className="font-bold text-t-primary">TestPro</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(p => !p)}
          className="w-8 h-8 flex items-center justify-center rounded-lg
            text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors">
          {collapsed ? "→" : "←"}
        </button>
      </div>

      {/* Module search */}
      {!collapsed && (
        <div className="px-3 pt-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search modules…"
            className="input text-sm py-2"
          />
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-1">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
              transition-colors w-full text-left
              ${activePage === item.id
                ? "bg-c-brand-bg text-c-brand"
                : "text-t-secondary hover:bg-bg-card hover:text-t-primary"}`}>
            <span className="text-base">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}

        {/* Modules list */}
        {!collapsed && filtered.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-t-muted uppercase tracking-wider px-3 mb-2">Modules</p>
            {filtered.map(m => (
              <button
                key={m.id}
                onClick={() => onNavigate("module", m.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm
                  text-t-secondary hover:bg-bg-card hover:text-t-primary
                  transition-colors w-full text-left">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: m.accent_color || "var(--color-brand)" }}
                />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Footer: theme toggle + user info */}
      <div className="border-t border-[var(--border-color)] p-3 flex flex-col gap-2">
        <div className={`flex ${collapsed ? "justify-center" : "justify-start"}`}>
          <ThemeToggle />
        </div>

        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-c-brand flex items-center justify-center
              text-sm font-bold text-white shrink-0">
              {(user?.displayName || user?.email || "U")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-t-primary truncate">
                {user?.displayName || user?.email}
              </p>
              <span className={isAdmin ? "badge-admin" : "badge-tester"}>
                {user?.defaultRole}
              </span>
            </div>
            <button
              onClick={() => signOut()}
              className="text-t-muted hover:text-red-500 transition-colors text-lg">
              ⎋
            </button>
          </div>
        ) : (
          <button
            onClick={() => signOut()}
            className="w-full flex justify-center text-t-muted hover:text-red-500 text-lg">
            ⎋
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;