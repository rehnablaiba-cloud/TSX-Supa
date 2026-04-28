import React, { useState } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  ScrollText,
  Users,
  TrainFront,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Search,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import { Module } from "../../types";
import ThemeToggle from "../UI/ThemeToggle";

interface Props {
  activePage: string;
  onNavigate: (page: string, module_name?: string) => void;
  modules: Module[];
}

const BASE_NAV = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "report", label: "Test Report", Icon: ClipboardList },
];

const ADMIN_NAV = [
  { id: "audit_log", label: "Audit Log", Icon: ScrollText },
  { id: "users", label: "Users", Icon: Users },
];

const Sidebar: React.FC<Props> = ({ activePage, onNavigate, modules }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const { user, signOut, isLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const navItems = isAdmin ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV;

  const filtered = modules
    .filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );

  // Release test lock then sign out
  const handleSignOut = async () => {
    try {
      if (user?.id) {
        await supabase.from("test_locks").delete().eq("user_id", user.id);
      }
      await signOut();
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  };

  const handleCollapseToggle = () => {
    setCollapsed((p) => !p);
    setSearch("");
  };

  return (
    <aside
      className={`hidden md:flex flex-col
        bg-bg-nav border-r border-(--border-color)
        [backdrop-filter:blur(var(--glass-blur))_saturate(var(--glass-saturation))_brightness(var(--glass-brightness))]
        [-webkit-backdrop-filter:blur(var(--glass-blur))_saturate(var(--glass-saturation))_brightness(var(--glass-brightness))]
        transition-all duration-300 ${
          collapsed ? "w-16" : "w-64"
        } h-screen sticky top-0 shrink-0`}
    >
      {/* Header */}
      <div
        className={`flex items-center px-4 py-4 border-b border-(--border-color)
        ${collapsed ? "justify-center" : "justify-between"}`}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <TrainFront size={20} className="text-c-brand shrink-0" />
            <span className="font-bold text-t-primary">TestPro</span>
          </div>
        )}
        <button
          onClick={handleCollapseToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-8 h-8 flex items-center justify-center rounded-lg
            text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Module search */}
      {!collapsed && (
        <div className="px-3 pt-3 relative">
          <Search
            size={14}
            className="absolute left-6 top-1/2 -translate-y-[calc(50%-6px)] text-t-muted pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search modules…"
            className="input text-sm pl-8"
          />
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-1">
        {isLoading ? (
          <div className="flex flex-col gap-1 px-1">
            {[...Array(2)].map((_, i) => (
              <div
                key={i}
                className="h-10 rounded-xl bg-bg-card animate-pulse"
              />
            ))}
          </div>
        ) : (
          navItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                transition-colors w-full text-left
                ${
                  activePage === id
                    ? "bg-c-brand-bg text-c-brand"
                    : "text-t-secondary hover:bg-bg-card hover:text-t-primary"
                }`}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </button>
          ))
        )}

        {/* Modules list */}
        {!collapsed && filtered.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-t-muted uppercase tracking-wider px-3 mb-2">
              Modules
            </p>
            {filtered.map((m) => (
              <button
                key={m.name}
                onClick={() => onNavigate("module", m.name)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm
                  text-t-secondary hover:bg-bg-card hover:text-t-primary
                  transition-colors w-full text-left shrink-0"
              >
                {/* ✅ Use mapped Tailwind token, not raw CSS var */}
                <span className="w-2 h-2 rounded-full shrink-0 bg-c-brand" />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-(--border-color) p-3 flex flex-col gap-2">
        <div
          className={`flex ${collapsed ? "justify-center" : "justify-start"}`}
        >
          <ThemeToggle />
        </div>

        {!isLoading &&
          (!collapsed ? (
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-full bg-c-brand flex items-center justify-center
                text-sm font-bold text-t-primary shrink-0"
              >
                {(user?.display_name || user?.email || "U")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-t-primary truncate">
                  {user?.display_name || user?.email}
                </p>
                <span className={isAdmin ? "badge-admin" : "badge-tester"}>
                  {user?.role}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                aria-label="Sign out"
                className="p-1.5 text-t-muted hover:text-fail hover:bg-bg-card rounded-lg transition-colors"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="w-full flex justify-center p-1.5 rounded-lg text-t-muted hover:text-fail hover:bg-bg-card transition-colors"
            >
              <LogOut size={15} />
            </button>
          ))}
      </div>
    </aside>
  );
};

export default Sidebar;
