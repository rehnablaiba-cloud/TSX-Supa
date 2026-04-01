import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import { Module } from "../../types";
import ThemeToggle from "../UI/ThemeToggle";

interface Props { activePage: string; onNavigate: (page: string, moduleId?: string) => void; }

const navItems = [
  { id: "dashboard", label: "Dashboard",  icon: "📊" },
  { id: "report",    label: "Test Report", icon: "📋" },
  { id: "auditlog",  label: "Audit Log",   icon: "📜" },
];

const Sidebar: React.FC<Props> = ({ activePage, onNavigate }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch]       = useState("");
  const [modules, setModules]     = useState<Module[]>([]);
  const { user, signOut } = useAuth();
  const isAdmin = user?.defaultRole === "admin";

  useEffect(() => {
    supabase
      .from("modules")
      .select("*")
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (data) setModules(data as Module[]);
        if (error) console.error("Sidebar modules error:", error.message);
      });
  }, []);

  const filtered = modules.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className={`hidden md:flex flex-col bg-gray-900/80 backdrop-blur border-r border-white/5
      transition-all duration-300 ${collapsed ? "w-16" : "w-64"} h-screen sticky top-0 shrink-0`}>
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="text-xl">🧪</span>
            <span className="font-bold text-white">TestPro</span>
          </div>
        )}
        <button onClick={() => setCollapsed(p => !p)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-gray-400">
          {collapsed ? "→" : "←"}
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 pt-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search modules…" className="input text-sm py-2" />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-1">
        {navItems.map(item => (
          <button key={item.id} onClick={() => onNavigate(item.id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
              transition-colors w-full text-left
              ${activePage === item.id ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}>
            <span className="text-base">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}

        {isAdmin && (
          <button onClick={() => onNavigate("users")}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
              transition-colors w-full text-left
              ${activePage === "users" ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}>
            <span className="text-base">👥</span>
            {!collapsed && <span>Users</span>}
          </button>
        )}

        {!collapsed && filtered.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-600 uppercase tracking-wider px-3 mb-2">Modules</p>
            {filtered.map(m => (
              <button key={m.id} onClick={() => onNavigate("module", m.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-400
                  hover:bg-white/5 hover:text-white transition-colors w-full text-left">
                <span className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: m.accent_color || "#3b82f6" }} />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* ── Bottom bar ── */}
      <div className="border-t border-white/5 p-3 flex flex-col gap-2">
        <div className={`flex ${collapsed ? "justify-center" : "justify-start"}`}>
          <ThemeToggle />
        </div>

        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
              {(user?.displayName || user?.email || "U")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.displayName || user?.email}
              </p>
              <span className={isAdmin ? "badge-admin" : "badge-tester"}>{user?.defaultRole}</span>
            </div>
            <button onClick={() => signOut()}
              className="text-gray-500 hover:text-red-400 transition-colors text-lg">⎋</button>
          </div>
        ) : (
          <button onClick={() => signOut()}
            className="w-full flex justify-center text-gray-500 hover:text-red-400 text-lg">⎋</button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;