import React, { useEffect, useState, useCallback } from "react";
import {supabase} from "../../supabase";
import ModalShell from "../UI/ModalShell";
import { FlaskConical, Plus, Pencil, Trash2, AlertTriangle, Check } from "lucide-react";
import {
  Row, DiffRow, OpCard, LoadingList, EmptyList, ErrBanner, SuccessBanner, NavButtons,
} from "./shared/RowHelpers";
import type { TestOption, TestOp, TestManualStage } from "./shared/types";

const OP_META: { id: TestOp; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "create", label: "Create", icon: <Plus   size={20} />, desc: "Add a new test"            },
  { id: "update", label: "Update", icon: <Pencil size={20} />, desc: "Rename an existing test"   },
  { id: "delete", label: "Delete", icon: <Trash2 size={20} />, desc: "Remove a test permanently" },
];

interface FormData { serialno: string; name: string; }

interface Props { onClose: () => void; onBack: () => void; }

const ImportTestsModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,      setStage]     = useState<TestManualStage>("selectop");
  const [op,         setOp]        = useState<TestOp>("create");
  const [tests,      setTests]     = useState<TestOption[]>([]);
  const [loading,    setLoading]   = useState(false);
  const [selected,   setSelected]  = useState<TestOption | null>(null);
  const [form,       setForm]      = useState<FormData>({ serialno: "", name: "" });
  const [errMsg,     setErrMsg]    = useState("");
  const [resultMsg,  setResultMsg] = useState("");

  useEffect(() => {
    if (stage !== "selecttest") return;
    setLoading(true);
    supabase.from("tests").select("serialno, name").order("serialno", { ascending: true })
      .then(({ data }) => { if (data) setTests(data as TestOption[]); setLoading(false); });
  }, [stage]);

  const handleSubmit = useCallback(async () => {
    setStage("submitting"); setErrMsg("");
    try {
      if (op === "create") {
        const sn = form.serialno.trim();
        if (!sn) throw new Error("Serial number is required.");
        const trimmed = form.name.trim();
        if (!trimmed) throw new Error("Test name is required.");
        const { error } = await supabase.from("tests").insert({ serialno: sn, name: trimmed });
        if (error) throw error;
        setResultMsg(`Test SN ${sn} "${trimmed}" created.`);
      } else if (op === "update") {
        if (!selected) throw new Error("No test selected.");
        const newName = form.name.trim();
        if (!newName) throw new Error("New name is required.");
        const { error } = await supabase.from("tests").update({ name: newName }).eq("name", selected.name);
        if (error) throw error;
        setResultMsg(`SN ${selected.serialno} renamed to "${newName}".`);
      } else {
        if (!selected) throw new Error("No test selected.");
        const { error } = await supabase.from("tests").delete().eq("name", selected.name);
        if (error) throw error;
        setResultMsg(`Test SN ${selected.serialno} "${selected.name}" deleted.`);
      }
      setStage("done");
    } catch (e: any) { setErrMsg(e?.message ?? "Unexpected error."); setStage("confirm"); }
  }, [op, form, selected]);

  const reset = useCallback(() => {
    setStage("selectop"); setSelected(null);
    setForm({ serialno: "", name: "" }); setResultMsg(""); setErrMsg("");
  }, []);

  const SUBTITLE: Record<TestManualStage, string> = {
    selectop:   "Choose operation",
    selecttest: "Select test",
    fillform:   op === "create" ? "Enter test details" : "Edit test name",
    confirm:    "Review & confirm",
    submitting: "Processing…",
    done:       "Complete",
  };

  if (stage === "selectop") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import Tests" subtitle={SUBTITLE.selectop} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {OP_META.map(m => (
            <OpCard key={m.id} id={m.id} label={m.label} desc={m.desc} icon={m.icon}
              selected={op === m.id} danger={m.id === "delete"} onClick={() => setOp(m.id)} />
          ))}
        </div>
        <NavButtons
          onBack={onBack}
          onNext={() => op === "create" ? (setForm({ serialno: "", name: "" }), setStage("fillform")) : setStage("selecttest")} />
      </div>
    </ModalShell>
  );

  if (stage === "selecttest") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import Tests" subtitle={SUBTITLE.selecttest} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Test</label>
        {loading ? <LoadingList /> : tests.length === 0 ? <EmptyList label="No tests found." /> : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {tests.map(t => (
              <button key={t.name} onClick={() => setSelected(t)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
                  ${selected?.name === t.name ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <FlaskConical size={18} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${selected?.name === t.name ? "text-c-brand" : "text-t-primary"}`}>{t.name}</p>
                  <p className="text-xs text-t-muted">SN {t.serialno}</p>
                </div>
                {selected?.name === t.name && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <NavButtons
          onBack={() => setStage("selectop")}
          onNext={() => op === "update"
            ? (setForm({ serialno: selected?.serialno ?? "", name: selected?.name ?? "" }), setStage("fillform"))
            : setStage("confirm")}
          nextLabel={op === "delete" ? "Review Delete" : "Next"}
          nextDisabled={!selected}
          nextDanger={op === "delete"} />
      </div>
    </ModalShell>
  );

  if (stage === "fillform") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import Tests" subtitle={SUBTITLE.fillform} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {selected && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <FlaskConical size={14} />
            <div><p className="text-t-primary font-medium">{selected.name}</p><p className="text-t-muted">SN {selected.serialno}</p></div>
          </div>
        )}
        {op === "create" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Serial No</label>
            <input type="text" value={form.serialno} onChange={e => setForm(f => ({ ...f, serialno: e.target.value }))}
              placeholder="e.g. 1.1"
              className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">
            {op === "create" ? "Test Name" : "New Name"}
          </label>
          <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder={op === "create" ? "Enter test name" : "New test name"}
            className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
        </div>
        <NavButtons
          onBack={() => op === "create" ? setStage("selectop") : setStage("selecttest")}
          onNext={() => setStage("confirm")}
          nextLabel="Review" />
      </div>
    </ModalShell>
  );

  if (stage === "confirm") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import Tests" subtitle={SUBTITLE.confirm} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className={`rounded-xl border p-4 flex flex-col gap-3 ${op === "delete" ? "border-red-500/40 bg-red-500/10" : "border-[var(--border-color)] bg-bg-card"}`}>
          <div className="flex items-center gap-2 pb-1 border-b border-[var(--border-color)]">
            {op === "create" ? <Plus size={18} /> : op === "update" ? <Pencil size={18} /> : <Trash2 size={18} />}
            <p className={`text-sm font-bold ${op === "delete" ? "text-red-400" : "text-t-primary"}`}>
              {op === "create" ? "Creating test" : op === "update" ? "Updating test" : "Deleting test"}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-xs">
            {op === "create"  && <><Row label="Serial No" value={form.serialno} mono brand /><Row label="Name" value={form.name.trim()} /></>}
            {op === "update"  && selected && <><Row label="Serial No" value={selected.serialno} mono brand /><DiffRow label="Name" before={selected.name} after={form.name.trim()} /></>}
            {op === "delete"  && selected && (
              <><Row label="Serial No" value={selected.serialno} mono brand /><Row label="Name" value={selected.name} />
                <div className="mt-1 flex items-center gap-2 text-red-400 font-semibold"><AlertTriangle size={14} /><span>This action cannot be undone.</span></div>
              </>
            )}
          </div>
        </div>
        {errMsg && <ErrBanner msg={errMsg} />}
        <NavButtons
          onBack={() => op === "delete" ? setStage("selecttest") : setStage("fillform")}
          onNext={handleSubmit}
          nextLabel={op === "create" ? "Confirm Create" : op === "update" ? "Confirm Update" : "Confirm Delete"}
          nextDanger={op === "delete"} />
      </div>
    </ModalShell>
  );

  if (stage === "submitting") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import Tests" subtitle="Processing…" onClose={onClose}>
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
        <p className="text-sm text-t-secondary">Writing to Supabase…</p>
      </div>
    </ModalShell>
  );

  return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import Tests" subtitle="Complete" onClose={onClose}>
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

export default ImportTestsModal;
