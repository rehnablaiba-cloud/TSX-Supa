import React from "react";
interface Props { title: string; subtitle?: string; actions?: React.ReactNode; onBack?: () => void; }

const Topbar: React.FC<Props> = ({ title, subtitle, actions, onBack }) => (
  <header className="sticky top-0 z-30 flex items-center gap-4 px-6 py-4
    bg-white/80 dark:bg-gray-950/80 backdrop-blur
    border-b border-gray-200 dark:border-white/5">
    {onBack && (
      <button onClick={onBack}
        className="w-9 h-9 flex items-center justify-center rounded-xl
          text-gray-500 dark:text-gray-400
          hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
        ←
      </button>
    )}
    <div className="flex-1">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">{title}</h1>
      {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </header>
);
export default Topbar;