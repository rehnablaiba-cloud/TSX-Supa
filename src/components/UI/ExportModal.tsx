import React from "react";

interface ExportOption {
  label: string;
  icon: React.ReactNode;
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

const ExportModal: React.FC<Props> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  stats,
  options,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-dim"
      onClick={onClose}
    >
      <div
        className="relative glass-frost w-full max-w-md p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
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
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s, i) => (
            <div
              key={i}
              className="bg-bg-card border border-border rounded-xl p-3 text-center"
            >
              <div className="text-lg font-bold text-t-primary">{s.value}</div>
              <div className="text-xs text-t-muted mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Section label */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-(--border-color)" />
          <span className="text-xs text-t-muted uppercase tracking-widest font-semibold">
            Choose Format
          </span>
          <div className="flex-1 h-px bg-(--border-color)" />
        </div>

        {/* Export Options */}
        <div className="flex flex-col gap-2">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => {
                opt.onConfirm();
                onClose();
              }}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl font-semibold text-sm transition-all ${opt.color} ${opt.hoverColor}`}
            >
              <span className="text-base">{opt.icon}</span>
              <span>Download as {opt.label}</span>
              <span className="ml-auto text-t-muted text-xs">↓</span>
            </button>
          ))}
        </div>

        {/* Cancel */}
        <button
          onClick={onClose}
          className="btn-ghost w-full py-2.5 text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ExportModal;
