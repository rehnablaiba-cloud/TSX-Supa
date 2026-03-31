import React from "react";

interface ExportOption {
  label: string;
  icon: string;
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
          bg-white dark:bg-[#1a1d2e]
          border border-gray-200 dark:border-white/10
          rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
            {subtitle && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors text-xl leading-none mt-0.5"
          >
            ✕
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s, i) => (
            <div key={i}
              className="bg-gray-100 dark:bg-white/5
                border border-gray-200 dark:border-white/10
                rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{s.value}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-widest font-semibold">
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
            border border-gray-200 dark:border-white/10
            text-gray-500 dark:text-gray-400
            hover:text-gray-900 dark:hover:text-white
            hover:border-gray-400 dark:hover:border-white/20
            text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ExportModal;