import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";

interface Props { activePage: string; onNavigate: (page: string) => void; }

const MobileNav: React.FC<Props> = ({ activePage, onNavigate }) => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isAdmin = user?.defaultRole === "admin";

  const items = [
    { id: "dashboard", icon: "📊", label: "Home" },
    { id: "report",    icon: "📋", label: "Report" },
    { id: "auditlog",  icon: "📜", label: "Audit" },
    ...(isAdmin ? [{ id: "users", icon: "👥", label: "Users" }] : []),
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-gray-900/95 backdrop-blur border-t border-white/5 flex items-center justify-around px-2 py-2">
      {/* Nav items */}
      {items.map(item => (
        <button key={item.id} onClick={() => onNavigate(item.id)}
          className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors
            ${activePage === item.id ? "text-blue-400" : "text-gray-500"}`}>
          <span className="text-xl">{item.icon}</span>
          <span className="text-[10px] font-medium">{item.label}</span>
        </button>
      ))}

      {/* Theme toggle */}
      <button onClick={toggleTheme}
        className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors text-gray-500 hover:text-white">
        <span className="text-xl">{theme === "dark" ? "☀️" : "🌙"}</span>
        <span className="text-[10px] font-medium">Theme</span>
      </button>

      {/* Sign out */}
      <button onClick={() => signOut()}
        className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors text-gray-500 hover:text-red-400">
        <span className="text-xl">⎋</span>
        <span className="text-[10px] font-medium">Logout</span>
      </button>
    </nav>
  );
};
export default MobileNav;