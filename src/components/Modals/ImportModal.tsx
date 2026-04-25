import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  Package,
  FlaskConical,
  Hash,
  FileSpreadsheet,
} from "lucide-react";

import ImportModulesModal from "./ImportModulesModal";
import ImportTestsModal from "./ImportTestsModal";
import ImportStepsModal from "./ImportStepsModal";
import ImportStepsManualModal from "./ImportStepsManualModal";

type ImportTarget = "none" | "modules" | "tests" | "steps_csv" | "steps_manual";

interface Props {
  onClose: () => void;
}

const OPTIONS: {
  id: ImportTarget;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  {
    id: "modules",
    label: "Modules",
    icon: <Package size={20} />,
    desc: "Create, rename, or delete modules",
  },
  {
    id: "tests",
    label: "Tests",
    icon: <FlaskConical size={20} />,
    desc: "Create, rename, or delete tests",
  },
  {
    id: "steps_csv",
    label: "Steps — CSV",
    icon: <FileSpreadsheet size={20} />,
    desc: "Bulk add / update / delete steps via CSV upload",
  },
  {
    id: "steps_manual",
    label: "Steps — Manual",
    icon: <Hash size={20} />,
    desc: "Add, edit, or delete a single step step-by-step",
  },
];

const ImportModal: React.FC<Props> = ({ onClose }) => {
  const [target, setTarget] = useState<ImportTarget>("none");

  // ── Sub-modal routing ──────────────────────────────────────────────────────
  if (target === "modules")
    return (
      <ImportModulesModal onClose={onClose} onBack={() => setTarget("none")} />
    );
  if (target === "tests")
    return (
      <ImportTestsModal onClose={onClose} onBack={() => setTarget("none")} />
    );
  if (target === "steps_csv")
    return (
      <ImportStepsModal onClose={onClose} onBack={() => setTarget("none")} />
    );
  if (target === "steps_manual")
    return (
      <ImportStepsManualModal
        onClose={onClose}
        onBack={() => setTarget("none")}
      />
    );

  // ── Hub view ───────────────────────────────────────────────────────────────
  return createPortal(
    <div
      className="fixed inset-0 flex items-end md:items-center justify-center"
      style={{ zIndex: 9999 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 backdrop-dim" onClick={onClose} />

      <div
        className="relative w-full md:max-w-md mx-auto glass-frost
          border-t md:border border-[var(--border-color)]
          rounded-t-2xl md:rounded-2xl
          px-6 pt-5 z-10 flex flex-col gap-4"
        style={{
          paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* Drag pill (mobile) */}
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-t-primary flex items-center gap-1.5">
              <Download size={16} /> Import Data
            </h2>
            <p className="text-xs text-t-muted mt-0.5">Choose what to import</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setTarget(opt.id)}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-[var(--border-color)]
                bg-bg-card hover:bg-bg-base hover:border-c-brand/50 transition-all text-left"
            >
              <span className="text-t-muted">{opt.icon}</span>
              <div>
                <p className="text-sm font-semibold text-t-primary">
                  {opt.label}
                </p>
                <p className="text-xs text-t-muted">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ImportModal;
