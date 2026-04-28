import React, { useEffect } from "react";
import { createPortal } from "react-dom";

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
  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[100]" style={{ isolation: "isolate" }}>
      {/* Backdrop — fills viewport, no backdrop-filter */}
      <div
        className="absolute inset-0 backdrop-dim"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Centered panel — blurs through backdrop */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className="relative w-full max-w-md p-6 flex flex-col gap-5 glass-frost"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-title"
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2
                id="export-title"
                className="text-lg font-bold text-t-primary"
              >
                {title}
              </h2>
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
                className="bg-bg-card border border-(--border-color) rounded-xl p-3 text-center"
              >
                <div className="text-lg font-bold text-t-primary">
                  {s.value}
                </div>
                <div className="text-xs text-t-muted mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Section divider */}
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
    </div>
  );

  return createPortal(modal, document.body);
};

export default ExportModal;
