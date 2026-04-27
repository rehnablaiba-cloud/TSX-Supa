// src/components/Modals/ImportModal.tsx
import React, { useState } from "react";
import { Package, FlaskConical, Hash, FileSpreadsheet } from "lucide-react";
import ModalShell from "../UI/ModalShell";

import ImportModulesModal     from "./ImportModulesModal";
import ImportTestsModal       from "./ImportTestsModal";
import ImportStepsModal       from "./ImportStepsModal";
import ImportStepsManualModal from "./ImportStepsManualModal";

type ImportTarget = "none" | "modules" | "tests" | "steps_csv" | "steps_manual";
interface Props { onClose: () => void }

const OPTIONS: { id: ImportTarget; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "modules",      label: "Modules",       icon: <Package size={20} />,         desc: "Create, rename, or delete modules" },
  { id: "tests",        label: "Tests",          icon: <FlaskConical size={20} />,    desc: "Create, rename, or delete tests" },
  { id: "steps_csv",    label: "Steps — CSV",    icon: <FileSpreadsheet size={20} />, desc: "Bulk-replace steps via CSV upload" },
  { id: "steps_manual", label: "Steps — Manual", icon: <Hash size={20} />,            desc: "Add, edit, or delete a single step" },
];

const ImportModal: React.FC<Props> = ({ onClose }) => {
  const [target, setTarget] = useState<ImportTarget>("none");

  if (target === "modules")
    return <ImportModulesModal    onClose={onClose} onBack={() => setTarget("none")} />;
  if (target === "tests")
    return <ImportTestsModal      onClose={onClose} onBack={() => setTarget("none")} />;
  if (target === "steps_csv")
    return <ImportStepsModal      onClose={onClose} onBack={() => setTarget("none")} />;
  if (target === "steps_manual")
    return <ImportStepsManualModal onClose={onClose} onBack={() => setTarget("none")} />;

  return (
    <ModalShell title="Import Data" subtitle="Choose what to import" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setTarget(opt.id)}
            className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-(--border-color)
              bg-bg-card hover:bg-bg-base hover:border-c-brand/50 transition-all text-left"
          >
            <span className="text-c-brand">{opt.icon}</span>
            <div>
              <p className="text-sm font-semibold text-t-primary">{opt.label}</p>
              <p className="text-xs text-t-muted">{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </ModalShell>
  );
};

export default ImportModal;
