import React, { useEffect, useState, useCallback } from "react";
import supabase from "../../supabase";
import ModalShell from "../UI/ModalShell";
import { Hash, Package, FlaskConical, Plus, Pencil, Trash2, AlertTriangle, Check, Minus } from "lucide-react";
import {
  Row, DiffRow, ContextStrip, OpCard, LoadingList, EmptyList,
  ErrBanner, SuccessBanner, NavButtons,
} from "./shared/RowHelpers";
import type {
  ModuleOption, TestOption, StepOption, StepOp, StepManualStage, StepForm,
} from "./shared/types";
import { EMPTY_STEP_FORM } from "./shared/types";

const OP_META: { id: StepOp; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "create", label: "Create", icon: <Plus   size={20} />, desc: "Add a new step manually"       },
  { id: "update", label: "Update", icon: <Pencil size={20} />, desc: "Edit an existing step"         },
  { id: "delete", label: "Delete", icon: <Trash2 size={20} />, desc: "Remove a step permanently"     },
];

interface Props { onClose: () => void; onBack: () => void; }

const ImportStepsManualModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,          setStage]         = useState<StepManualStage>("selectop");
  const [op,             setOp]            = useState<StepOp>("create");
  const [modules,        setModules]       = useState<ModuleOption[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [selectedModule, setSelectedModule] = useState<ModuleOption | null>(null);
  const [tests,          setTests]         = useState<TestOption[]>([]);
  const [loadingTests,   setLoadingTests]  = useState(false);
  const [selectedTest,   setSelectedTest]  = useState<TestOption | null>(null);
  const [steps,          setSteps]         = useState<StepOption[]>([]);
  const [loadingSteps,   setLoadingSteps]  = useState(false);
  const [selectedStep,   setSelectedStep]  = useState<StepOption | null>(null);
  const [form,           setForm]          = useState<StepForm>(EMPTY_STEP_FORM);
  const [errMsg,         setErrMsg]        = useState("");
  const [resultMsg,      setResultMsg]     = useState("");

  useEffect(() => {
    if (stage !== "selectmodule") return;
    setLoadingModules(true);
    supabase.from("modules").select("name").order("name")
      .then(({ data }) => { if (data) setModules(data as ModuleOption[]); setLoadingModules(false); });
  }, [stage]);

  useEffect(() => {
    if (stage !== "selecttest" || !selectedModule) return;
    setLoadingTests(true);
    supabase.from("module_tests").select("tests:tests_name(name, serialno)")
      .eq("module_name", selectedModule.name)
      .then(({ data }) => {
        if (data) {
          const ts = (data as any[]).map(r => r.tests).filter(Boolean) as TestOption[];
          ts.sort((a, b) => String(a.serialno).localeCompare(String(b.serialno), undefined, { numeric: true }));
          setTests(ts);
        }
        setLoadingTests(false);
      });
  }, [stage, selectedModule]);

  useEffect(() => {
    if (stage !== "selectstep" || !selectedTest) return;
    setLoadingSteps(true);
    supabase.from("test_steps")
      .select("id, serialno, tests_name, action, expected_result, is_divider")
      .eq("tests_name", selectedTest.name)
      .order("serialno", { ascending: true })
      .then(({ data }) => { if (data) setSteps(data as StepOption[]); setLoadingSteps(false); });
  }, [stage, selectedTest]);

  const handleSubmit = useCallback(async () => {
    setStage("submitting"); setErrMsg("");
    try {
      if (op === "create") {
        const snVal = parseFloat(form.serialno);
        if (isNaN(snVal)) throw new Error("Invalid serial number.");
        if (!selectedTest) throw new Error("No test selected.");
        const { error } = await supabase.from("test_steps").insert({
          tests_name: selectedTest.name, serialno: snVal,
          action: form.action.trim(), expected_result: form.expected_result.trim(),
          is_divider: form.is_divider,
        });
        if (error) throw error;
        setResultMsg(`Step SN ${snVal} "${form.action.trim() || "divider"}" created in ${selectedTest.name}.`);
      } else if (op === "update") {
        if (!selectedStep) throw new Error("No step selected.");
        const { error } = await supabase.from("test_steps").update({
          action: form.action.trim(), expected_result: form.expected_result.trim(),
          is_divider: form.is_divider,
        }).eq("id", selectedStep.id);
        if (error) throw error;
        setResultMsg(`Step SN ${selectedStep.serialno} updated successfully.`);
      } else {
        if (!selectedStep) throw new Error("No step selected.");
        const { error } = await supabase.from("test_steps").delete().eq("id", selectedStep.id);
        if (error) throw error;
        setResultMsg(`Step SN ${selectedStep.serialno} "${selectedStep.action || "divider"}" deleted.`);
      }
      setStage("done");
    } catch (e: any) { setErrMsg(e?.message ?? "Unexpected error."); setStage("confirm"); }
  }, [op, form, selectedTest, selectedStep]);

  const reset = useCallback(() => {
    setStage("selectop"); setSelectedModule(null); setSelectedTest(null);
    setSelectedStep(null); setForm(EMPTY_STEP_FORM); setResultMsg(""); setErrMsg("");
  }, []);

  const SUBTITLE: Record<StepManualStage, string> = {
    selectop:    "Choose operation",
    selectmodule:"Step 1 — Select module",
    selecttest:  "Step 2 — Select test",
    selectstep:  "Step 3 — Select step",
    fillform:    op === "create" ? "Step 3 — Enter step details" : "Step 4 — Edit step details",
    confirm:     "Review & confirm",
    submitting:  "Processing…",
    done:        "Complete",
  };

  if (stage === "selectop") return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — Manual" subtitle={SUBTITLE.selectop} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {OP_META.map(m => (
            <OpCard key={m.id} id={m.id} label={m.label} desc={m.desc} icon={m.icon}
              selected={op === m.id} danger={m.id === "delete"} onClick={() => setOp(m.id)} />
          ))}
        </div>
        <NavButtons onBack={onBack} onNext={() => setStage("selectmodule")} />
      </div>
    </ModalShell>
  );

  if (stage === "selectmodule") return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — Manual" subtitle={SUBTITLE.selectmodule} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Module</label>
        {loadingModules ? <LoadingList /> : modules.length === 0 ? <EmptyList label="No modules found." /> : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {modules.map(m => (
              <button key={m.name} onClick={() => setSelectedModule(m)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
                  ${selectedModule?.name === m.name ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <Package size={18} />
                <span className={`text-sm font-medium flex-1 ${selectedModule?.name === m.name ? "text-c-brand" : "text-t-primary"}`}>{m.name}</span>
                {selectedModule?.name === m.name && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <NavButtons onBack={() => setStage("selectop")}
          onNext={() => { setSelectedTest(null); setStage("selecttest"); }}
          nextDisabled={!selectedModule} />
      </div>
    </ModalShell>
  );

  if (stage === "selecttest") return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — Manual" subtitle={SUBTITLE.selecttest} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ContextStrip module={selectedModule} />
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Test</label>
        {loadingTests ? <LoadingList /> : tests.length === 0 ? <EmptyList label="No tests found for this module." /> : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {tests.map(t => (
              <button key={t.name} onClick={() => setSelectedTest(t)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
                  ${selectedTest?.name === t.name ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <FlaskConical size={18} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${selectedTest?.name === t.name ? "text-c-brand" : "text-t-primary"}`}>{t.name}</p>
                  <p className="text-xs text-t-muted">SN {t.serialno}</p>
                </div>
                {selectedTest?.name === t.name && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <NavButtons onBack={() => setStage("selectmodule")}
          onNext={() => op === "create" ? (setForm(EMPTY_STEP_FORM), setStage("fillform")) : (setSelectedStep(null), setStage("selectstep"))}
          nextDisabled={!selectedTest} />
      </div>
    </ModalShell>
  );

  if (stage === "selectstep") return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — Manual" subtitle={SUBTITLE.selectstep} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ContextStrip module={selectedModule} test={selectedTest} />
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Step</label>
        {loadingSteps ? <LoadingList label="Loading steps…" /> : steps.length === 0 ? <EmptyList label="No steps found for this test." /> : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {steps.map(s => (
              <button key={s.id}
                onClick={() => {
                  setSelectedStep(s);
                  if (op === "update") setForm({ serialno: String(s.serialno), action: s.action, expected_result: s.expected_result, is_divider: s.is_divider });
                }}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all text-left
                  ${selectedStep?.id === s.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <span className={`text-xs font-bold font-mono px-2 py-1 rounded-lg shrink-0 min-w-[2.5rem] text-center ${selectedStep?.id === s.id ? "bg-c-brand text-white" : "bg-bg-base text-c-brand"}`}>
                  {s.serialno}
                </span>
                <div className="flex-1 min-w-0">
                  {s.is_divider
                    ? <p className="text-xs italic text-t-muted">— divider —</p>
                    : <p className={`text-sm truncate ${selectedStep?.id === s.id ? "text-c-brand" : "text-t-primary"}`}>{s.action || <em className="text-t-muted">No action text</em>}</p>
                  }
                  {s.expected_result && <p className="text-xs text-t-muted truncate mt-0.5">{s.expected_result}</p>}
                </div>
                {selectedStep?.id === s.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <NavButtons onBack={() => setStage("selecttest")}
          onNext={() => op === "update" ? setStage("fillform") : setStage("confirm")}
          nextLabel={op === "delete" ? "Review Delete" : "Next"}
          nextDisabled={!selectedStep} nextDanger={op === "delete"} />
      </div>
    </ModalShell>
  );

  if (stage === "fillform") return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — Manual" subtitle={SUBTITLE.fillform} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ContextStrip module={selectedModule} test={selectedTest} step={selectedStep ?? undefined} />
        {op === "create" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Serial No</label>
            <input type="number" step={1} min={1} value={form.serialno}
              onChange={e => setForm(f => ({ ...f, serialno: e.target.value }))} placeholder="e.g. 5"
              className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Action</label>
          <textarea rows={3} value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
            placeholder="Describe the action to perform"
            className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors resize-none" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Expected Result</label>
          <textarea rows={3} value={form.expected_result} onChange={e => setForm(f => ({ ...f, expected_result: e.target.value }))}
            placeholder="What should happen after this step?"
            className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors resize-none" />
        </div>
        <button onClick={() => setForm(f => ({ ...f, is_divider: !f.is_divider }))}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
            ${form.is_divider ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
          <Minus size={18} />
          <div className="flex-1">
            <p className={`text-sm font-semibold ${form.is_divider ? "text-c-brand" : "text-t-primary"}`}>Section Divider</p>
            <p className="text-xs text-t-muted">Mark this step as a visual divider row</p>
          </div>
          <div className={`w-10 h-5 rounded-full transition-colors duration-200 shrink-0 relative ${form.is_divider ? "bg-c-brand" : "bg-bg-base border border-[var(--border-color)]"}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${form.is_divider ? "left-[calc(100%-1.1rem)]" : "left-0.5"}`} />
          </div>
        </button>
        <NavButtons onBack={() => op === "create" ? setStage("selecttest") : setStage("selectstep")}
          onNext={() => setStage("confirm")} nextLabel="Review" />
      </div>
    </ModalShell>
  );

  if (stage === "confirm") return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — Manual" subtitle={SUBTITLE.confirm} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ContextStrip module={selectedModule} test={selectedTest} step={selectedStep ?? undefined} />
        <div className={`rounded-xl border p-4 flex flex-col gap-3 ${op === "delete" ? "border-red-500/40 bg-red-500/10" : "border-[var(--border-color)] bg-bg-card"}`}>
          <div className="flex items-center gap-2 pb-1 border-b border-[var(--border-color)]">
            {op === "create" ? <Plus size={18} /> : op === "update" ? <Pencil size={18} /> : <Trash2 size={18} />}
            <p className={`text-sm font-bold ${op === "delete" ? "text-red-400" : "text-t-primary"}`}>
              {op === "create" ? "Creating new step" : op === "update" ? "Updating step" : "Deleting step"}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-xs">
            {op === "create" && (
              <><Row label="Serial No" value={form.serialno} mono brand />
                <Row label="Action"   value={form.action.trim()} />
                <Row label="Expected" value={form.expected_result.trim()} />
                <Row label="Divider"  value={form.is_divider ? "Yes" : "No"} /></>
            )}
            {op === "update" && selectedStep && (
              <><Row label="Serial No" value={String(selectedStep.serialno)} mono brand />
                <DiffRow label="Action"   before={selectedStep.action}          after={form.action.trim()} />
                <DiffRow label="Expected" before={selectedStep.expected_result} after={form.expected_result.trim()} />
                <DiffRow label="Divider"  before={String(selectedStep.is_divider)} after={String(form.is_divider)} /></>
            )}
            {op === "delete" && selectedStep && (
              <><Row label="Serial No" value={String(selectedStep.serialno)} mono brand />
                <Row label="Action" value={selectedStep.action || "— divider —"} />
                <div className="mt-1 flex items-center gap-2 text-red-400 font-semibold">
                  <AlertTriangle size={14} /><span>This action cannot be undone.</span>
                </div>
              </>
            )}
          </div>
        </div>
        {errMsg && <ErrBanner msg={errMsg} />}
        <NavButtons onBack={() => op === "delete" ? setStage("selectstep") : setStage("fillform")}
          onNext={handleSubmit}
          nextLabel={op === "create" ? "Confirm Create" : op === "update" ? "Confirm Update" : "Confirm Delete"}
          nextDanger={op === "delete"} />
      </div>
    </ModalShell>
  );

  if (stage === "submitting") return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — Manual" subtitle="Processing…" onClose={onClose}>
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
        <p className="text-sm text-t-secondary">Writing to Supabase…</p>
      </div>
    </ModalShell>
  );

  return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — Manual" subtitle="Complete" onClose={onClose}>
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

export default ImportStepsManualModal;
