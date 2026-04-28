import React from "react";
import { ArrowLeft } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  onBack?: () => void;
}

const Topbar: React.FC<Props> = ({ title, subtitle, actions, onBack }) => (
  <header
    className="sticky top-0 z-30 flex items-center gap-4 px-6 py-4
    glass-surface border-b border-(--border-color) rounded-none"
  >
    {onBack && (
      <button
        onClick={onBack}
        className="w-8 h-8 flex items-center justify-center rounded-xl
          text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
      >
        <ArrowLeft size={16} />
      </button>
    )}
    <div className="flex-1">
      <h1 className="text-lg font-semibold text-t-primary leading-tight">
        {title}
      </h1>
      {subtitle && <p className="text-xs text-t-muted mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </header>
);

export default Topbar;