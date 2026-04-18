import React, { useEffect, useState, useCallback } from "react";
import supabase from "../../supabase";
import ModalShell from "../UI/ModalShell";
import { Package, Plus, Pencil, Trash2, AlertTriangle, Check } from "lucide-react";
import {
  Row, DiffRow, OpCard, LoadingList, EmptyList, ErrBanner, SuccessBanner, NavButtons,
} from "./shared/RowHelpers";
import type { ModuleOption, ModuleOp, ModuleManualStage } from "./shared/types";

const OP_META: { id: ModuleOp; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "create", label: "Create", icon: <Plus   size={20} />, desc: "Add a new module"            },
  { id: "update", label: "Update", icon: <Pencil size={20} />, desc: "Rename an existing module"   },
  { id: "delete", label: "Delete", icon: <Trash2 size={20} />, desc: "Remove a module permanently" },
];

const SUBTITLE: Record<ModuleManualStage, (op: ModuleOp) => string> = {
  selectop:    ()   => "Choose operation",
  selectmodule:()   => "Select module",
  fillform:    (op) => op === "create" ? "Enter module name" : "Edit module name",
  confirm:     ()   => "Review & confirm",
  submitting:  ()   => "Processing…",
  done:        ()   => "Complete",
};

interface Props { onClose: () => void; onBack: () => void; }

const ImportModulesModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,       setStage]      = useState<ModuleManualStage>("selectop");
  const [op,          setOp]         = useState<ModuleOp>("create");
  const [modules,     setModules]    = useState<ModuleOption[]>([]);
  const [loading,     setLoading]    = useState(false);
  const [selected,    setSelected]   = useState<ModuleOption | null>(null);
  const [name,        setName]       = useState("");
  const [errMsg,      setErrMsg]     = useState("");
  const [resultMsg,   setResultMsg]  = useState("");

  useEffect(() => {
    if (stage !== "selectmodule") return;
    setLoading(true);
    supabase.from("modules").select("name").order("name")
      .then(({ data }) => { if (data) setModules(data as ModuleOption[]); setLoading(false); });
  }, [stage]);

  const handleSubmit = useCallback(async () => {
    setStage("submitting"); setErrMsg("");
    try {
      if (op === "create") {
        const trimmed = name.trim();
        if (!trimmed) throw new Error("Module name is required.");
        const { error } = await supabase.from("modules").insert({ name: trimmed });
        if (error) throw error;
        setResultMsg(`Module "${trimmed}" created successfully.`);
      } else if (op === "update") {
        if (!selected) throw new Error("No module selected.");
        const newName = name.trim();
        if (!newName) throw new Error("New name is required.");
        const { error } = await supabase.from("modules").update({ name: newName }).eq("name", selected.name);
        if (error) throw error;
        setResultMsg(`"${selected.name}" renamed to "${newName}".`);
      } else {
        if (!selected) throw new Error("No module selected.");
        const { error } = await supabase.from("modules").delete().eq("name", selected.name);
        if (error) throw error;
        setResultMsg(`Module "${selected.name}" deleted.`);
      }
      setStage("done");
    } catch (e: any) { setErrMsg(e?.message ?? "Unexpected error."); setStage("confirm"); }
  }, [op, name, selected]);

  const reset = useCallback(() => {
    setStage("selectop"); setSelected(null); setName(""); setResultMsg(""); setErrMsg("");
  }, []);

  const sub = SUBTITLE[stage](op);

  if (stage === "selectop") return (
    <ModalShell icon={<Package size={16} />} title="Import Modules" subtitle={sub} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {OP_META.map(m => (
            <OpCard key={m.id} id={m.id} label={m.label} desc={m.desc} icon={m.icon}
              selected={op === m.id} danger={m.id === "delete"} onClick={() => setOp(m.id)} />
          ))}
        </div>
        <NavButtons
          onBack={onBack}
          onNext={() => op === "create" ? (setName(""), setStage("fillform")) : setStage("selectmodule")} />
      </div>
    </ModalShell>
  );

  if (stage === "selectmodule") return (
    <ModalShell icon={<Package size={16} />} title="Import Modules" subtitle={sub} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Module</label>
        {loading ? <LoadingList /> : modules.length === 0 ? <EmptyList label="No modules found." /> : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {modules.map(m => (
              <button key={m.name} onClick={() => setSelected(m)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
                  ${selected?.name === m.name ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <Package size={18} />
                <span className={`text-sm font-medium flex-1 ${selected?.name === m.name ? "text-c-brand" : "text-t-primary"}`}>{m.name}</span>
                {selected?.name === m.name && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <NavButtons
          onBack={() => setStage("selectop")}
          onNext={() => op === "update" ? (setName(selected?.name ?? ""), setStage("fillform")) : setStage("confirm")}
          nextLabel={op === "delete" ? "Review Delete" : "Next"}
          nextDisabled={!selected}
          nextDanger={op === "delete"} />
      </div>
    </ModalShell>
  );

  if (stage === "fillform") return (
    <ModalShell icon={<Package size={16} />} title="Import Modules" subtitle={sub} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {selected && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <Package size={14} /><span className="text-t-primary font-medium">{selected.name}</span>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">
            {op === "create" ? "Module Name" : "New Name"}
          </label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder={op === "create" ? "Enter module name" : "New module name"}
            className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
        </div>
        <NavButtons
          onBack={() => op === "create" ? setStage("selectop") : setStage("selectmodule")}
          onNext={() => setStage("confirm")}
          nextLabel="Review" />
      </div>
    </ModalShell>
  );

  if (stage === "confirm") return (
    <ModalShell icon={<Package size={16} />} title="Import Modules" subtitle={sub} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className={`rounded-xl border p-4 flex flex-col gap-3 ${op === "delete" ? "border-red-500/40 bg-red-500/10" : "border-[var(--border-color)] bg-bg-card"}`}>
          <div className="flex items-center gap-2 pb-1 border-b border-[var(--border-color)]">
            {op === "create" ? <Plus size={18} /> : op === "update" ? <Pencil size={18} /> : <Trash2 size={18} />}
            <p className={`text-sm font-bold ${op === "delete" ? "text-red-400" : "text-t-primary"}`}>
              {op === "create" ? "Creating module" : op === "update" ? "Updating module" : "Deleting module"}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-xs">
            {op === "create"  && <Row label="Name" value={name.trim()} />}
            {op === "update"  && selected && <DiffRow label="Name" before={selected.name} after={name.trim()} />}
            {op === "delete"  && selected && (
              <>
                <Row label="Module" value={selected.name} />
                <div className="mt-1 flex items-center gap-2 text-red-400 font-semibold">
                  <AlertTriangle size={14} /><span>This action cannot be undone.</span>
                </div>
              </>
            )}
          </div>
        </div>
        {errMsg && <ErrBanner msg={errMsg} />}
        <NavButtons
          onBack={() => op === "delete" ? setStage("selectmodule") : setStage("fillform")}
          onNext={handleSubmit}
          nextLabel={op === "create" ? "Confirm Create" : op === "update" ? "Confirm Update" : "Confirm Delete"}
          nextDanger={op === "delete"} />
      </div>
    </ModalShell>
  );

  if (stage === "submitting") return (
    <ModalShell icon={<Package size={16} />} title="Import Modules" subtitle="Processing…" onClose={onClose}>
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
        <p className="text-sm text-t-secondary">Writing to Supabase…</p>
      </div>
    </ModalShell>
  );

  return (
    <ModalShell icon={<Package size={16} />} title="Import Modules" subtitle="Complete" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <SuccessBanner msg={resultMsg} />
        <div className="flex gap-2">
          <button onClick={reset} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">Another</button>
          <button onClick={onClose} className="flex-1 btn-primary text-sm">Done</button>
        </div>
      </div>
    </ModalShell>
  );
};

export default ImportModulesModal;
