// src/components/UI/ModalShell.tsx
// Phase 2 — B1: Generic modal wrapper extracted from MobileNav.tsx.
// Uses glass-frost and backdrop-dim for theme-aware styling.

import React from "react";
import { X } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

const ModalShell: React.FC<Props> = ({
  title,
  subtitle,
  icon,
  onClose,
  children,
}) => (
  <div className="fixed inset-0 z-70 flex items-end md:items-center justify-center">
    {/* Backdrop */}
    <div className="absolute inset-0 backdrop-dim" onClick={onClose} />

    {/* Sheet */}
    <div
      className="relative w-full md:max-w-md mx-auto glass-frost
      border-t md:border border-[var(--border-color)]
      rounded-t-2xl md:rounded-2xl
      px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
    >
      {/* Mobile drag handle */}
      <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden shrink-0" />

      {/* Header row */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-bold text-t-primary flex items-center gap-1.5">
            {icon}
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-t-muted mt-0.5">{subtitle}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full
            text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      {children}
    </div>
  </div>
);

export default ModalShell;
