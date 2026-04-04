import React from "react";

interface ExportOption {
  label: string;
  icon: React.ReactNode;   // ← accepts JSX elements
  color: string;
  hoverColor: string;
  onConfirm: () => void;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  stats: { label: string; value: string | number }[];
  options: ExportOption[];
}

const ExportModal: React.FC<Props> = ({ isOpen, onClose, title, subtitle, stats, options }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative
          bg-bg-surface
          border border-[var(--border-color)]
          rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-t-primary">{title}</h2>
            {subtitle && (
              <p className="text-sm text-t-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-t-muted hover:text-t-primary transition-colors text-xl leading-none mt-0.5"
          >
            ✕
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s, i) => (
            <div key={i}
              className="bg-bg-card
                border border-[var(--border-color)]
                rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-t-primary">{s.value}</div>
              <div className="text-xs text-t-muted mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="text-xs text-t-muted uppercase tracking-widest font-semibold">
          Choose Format
        </div>

        {/* Export Options */}
        <div className="flex flex-col gap-2">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => { opt.onConfirm(); onClose(); }}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-white font-semibold text-sm transition-all ${opt.color} ${opt.hoverColor}`}
            >
              <span className="text-lg">{opt.icon}</span>
              <span>Download as {opt.label}</span>
              <span className="ml-auto text-white/60 text-xs">↓</span>
            </button>
          ))}
        </div>

        {/* Cancel */}
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl
            border border-[var(--border-color)]
            text-t-muted
            hover:text-t-primary
            hover:border-c-brand
            text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ExportModal;