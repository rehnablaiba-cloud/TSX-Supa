import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Package, Plus, Pencil, Trash2,
  CheckCircle, ArrowLeft,
} from "lucide-react";

import { supabase }                       from "../../supabase";
import { fetchModuleOptions }             from "../../lib/supabase/queries";
import { Row }                            from "../UI/ReviewRow";
import type { ModuleOption }              from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ModuleOp    = "create" | "update" | "delete";
type Stage       = "selectop" | "selectmodule" | "fillform" | "confirm" | "submitting" | "done";

const OP_META: { id: ModuleOp; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "create", label: "Create", icon: <Plus   size={20} />, desc: "Add a new module"    },
  { id: "update", label: "Update", icon: <Pencil size={20} />, desc: "Edit module details" },
  { id: "delete", label: "Delete", icon: <Trash2 size={20} />, desc: "Remove a module"     },
];

interface Props {
  onClose: () => void;
  onBack:  () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const ImportModulesModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,          setStage]   = useState<Stage>("selectop");
  const [op,             setOp]      = useState<ModuleOp>("create");
  const [modules,        setModules] = useState<ModuleOption[]>([]);
  const [selectedModule, setSelected]= useState<ModuleOption | null>(null);
  const [name,           setName]    = useState("");
  const [desc,           setDesc]    = useState("");
  const [error,          setError]   = useState<string | null>(null);

  useEffect(() => {
    fetchModuleOptions().then(setModules).catch(() => {});
  }, []);

  const handleOpSelect = (o: ModuleOp) => {
    setOp(o);
    setStage(o === "create" ? "fillform" : "selectmodule");
  };

  const handleModuleSelect = (m: ModuleOption) => {
    setSelected(m);
    if (op === "update") { setName(m.name); setDesc(""); }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleSubmit = async () => {
    setStage("submitting");
    setError(null);
    try {
      if (op === "create") {
        const { error: e } = await supabase
          .from("modules")
          .insert({ name: name.trim(), description: desc.trim() || null });
        if (e) throw new Error(e.message);
      } else if (op === "update" && selectedModule) {
        const { error: e } = await supabase
          .from("modules")
          .update({ name: name.trim(), description: desc.trim() || null })
          .eq("name", selectedModule.name);
        if (e) throw new Error(e.message);
      } else if (op === "delete" && selectedModule) {
        const { error: e } = await supabase
          .from("modules")
          .delete()
          .eq("name", selectedModule.name);
        if (e) throw new Error(e.message);
      }
      setStage("done");
    } catch (e: any) {
      setError(e.message);
      setStage("confirm");
    }
  };

  const subtitle =
    stage === "selectop"     ? "Choose operation" :
    stage === "selectmodule" ? "Pick a module"    :
    stage === "fillform"     ? "Enter details"    :
    stage === "confirm"      ? "Review & confirm" :
    stage === "done"         ? "Done!"            : "…";

  return createPortal(
    <div
      className="fixed inset-0 flex items-end md:items-center justify-center"
      style={{ zIndex: 9999 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative w-full md:max-w-md mx-auto z-10
          border-t md:border border-[var(--border-color)]
          rounded-t-2xl md:rounded-2xl
          px-6 pt-5 overflow-y-auto flex flex-col gap-4 max-h-[90vh]"
        style={{
          paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          background: "color-mix(in srgb, var(--bg-surface) 92%, transparent)",
        }}
      >
        {/* Drag pill */}
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-t-primary flex items-center gap-1.5">
              <Package size={16} /> Modules
            </h2>
            <p className="text-xs text-t-muted mt-0.5">{subtitle}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onBack}
              className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors"
              title="Back"
            >
              <ArrowLeft size={15} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── selectop ── */}
        {stage === "selectop" && (
          <div className="flex flex-col gap-2">
            {OP_META.map(m => (
              <button
                key={m.id}
                onClick={() => handleOpSelect(m.id)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)]
                  bg-bg-card hover:bg-bg-base text-left transition-all"
              >
                <span className="text-t-muted">{m.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-t-primary">{m.label}</p>
                  <p className="text-xs text-t-muted">{m.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── selectmodule ── */}
        {stage === "selectmodule" && (
          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
            {modules.length === 0 && (
              <p className="text-sm text-t-muted text-center py-4">No modules found.</p>
            )}
            {modules.map(m => (
              <button
                key={m.name}
                onClick={() => handleModuleSelect(m)}
                className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)]
                  bg-bg-card hover:bg-bg-base text-sm text-t-primary transition-colors"
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        {/* ── fillform ── */}
        {stage === "fillform" && (
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-t-muted mb-1">Module Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="input text-sm"
                placeholder="e.g. CAR-01"
              />
            </div>
            <div>
              <label className="block text-xs text-t-muted mb-1">Description (optional)</label>
              <input
                value={desc}
                onChange={e => setDesc(e.target.value)}
                className="input text-sm"
                placeholder="Short description"
              />
            </div>
            <button
              onClick={() => setStage("confirm")}
              disabled={!name.trim()}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Review
            </button>
          </div>
        )}

        {/* ── confirm ── */}
        {stage === "confirm" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-3 flex flex-col gap-1.5 text-xs">
              <Row label="Operation" value={op.toUpperCase()} brand />
              {op !== "create" && <Row label="Target" value={selectedModule?.name ?? ""} mono />}
              {op !== "delete" && (
                <>
                  <Row label="Name" value={name} />
                  <Row label="Desc" value={desc || "—"} />
                </>
              )}
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setStage(op === "create" ? "fillform" : op === "delete" ? "selectmodule" : "fillform")}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary text-sm"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white ${
                  op === "delete" ? "bg-red-500 hover:bg-red-600" : "btn-primary"
                }`}
              >
                Confirm {op}
              </button>
            </div>
          </div>
        )}

        {/* ── submitting ── */}
        {stage === "submitting" && (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ── done ── */}
        {stage === "done" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle size={32} className="text-green-400" />
            <p className="text-sm text-t-primary font-semibold">Done!</p>
            <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ImportModulesModal;