// src/components/Modals/ImportTestsModal.tsx
import React, { useEffect, useState } from "react";
import { FlaskConical, Plus, Pencil, Trash2, CheckCircle, ArrowLeft } from "lucide-react";
import ModalShell from "../UI/ModalShell";
import { Row, DiffRow } from "../UI/ReviewRow";
import {
  fetchTestOptions,
  createTest,
  updateTest,
  deleteTestCascade,
} from "../../lib/supabase/queries.mobilenav";
import type { TestOption } from "../../lib/supabase/queries.mobilenav";

type TestOp = "create" | "update" | "delete";
type Stage = "selectop" | "selecttest" | "fillform" | "confirm" | "submitting" | "done";

const OP_META: { id: TestOp; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "create", label: "Create", icon: <Plus size={20} />,   desc: "Add a new test" },
  { id: "update", label: "Update", icon: <Pencil size={20} />, desc: "Edit test details" },
  { id: "delete", label: "Delete", icon: <Trash2 size={20} />, desc: "Remove a test" },
];

interface Props { onClose: () => void; onBack: () => void }

const ImportTestsModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage, setStage]           = useState<Stage>("selectop");
  const [op, setOp]                 = useState<TestOp>("create");
  const [tests, setTests]           = useState<TestOption[]>([]);
  const [selectedTest, setSelected] = useState<TestOption | null>(null);
  const [sn, setSn]                 = useState("");
  const [name, setName]             = useState("");
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => { fetchTestOptions().then(setTests).catch(console.error); }, []);

  const handleBack = () => {
    switch (stage) {
      case "selectop":   return onBack();
      case "selecttest": return setStage("selectop");
      case "fillform":   return setStage(op === "create" ? "selectop" : "selecttest");
      case "confirm":    return setStage(op === "delete" ? "selecttest" : "fillform");
      default: break;
    }
  };

  const handleOpSelect = (o: TestOp) => {
    setOp(o);
    setStage(o === "create" ? "fillform" : "selecttest");
  };

  const handleTestSelect = (t: TestOption) => {
    setSelected(t);
    if (op === "update") { setSn(String(t.serial_no)); setName(t.name); }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleSubmit = async () => {
    setStage("submitting");
    setError(null);
    try {
      if (op === "create")                      await createTest(sn.trim(), name.trim());
      else if (op === "update" && selectedTest) await updateTest(selectedTest.name, name.trim(), sn.trim());
      else if (op === "delete" && selectedTest) await deleteTestCascade(selectedTest.name);
      setStage("done");
    } catch (e: any) { setError(e.message); setStage("confirm"); }
  };

  const subtitle: Record<Stage, string> = {
    selectop:   "Choose operation",
    selecttest: "Pick a test",
    fillform:   "Enter details",
    confirm:    "Review & confirm",
    submitting: "...",
    done:       "Done!",
  };

  return (
    <ModalShell
      title="Tests"
      icon={<FlaskConical size={16} />}
      subtitle={subtitle[stage]}
      onClose={onClose}
    >
      {/* back button */}
      {stage !== "submitting" && stage !== "done" && (
        <button onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted
            hover:text-t-primary transition-colors">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {stage === "selectop" && (
        <div className="flex flex-col gap-2">
          {OP_META.map((m) => (
            <button key={m.id} onClick={() => handleOpSelect(m.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-(--border-color)
                bg-bg-card hover:bg-bg-base text-left transition-all">
              <span className="text-t-muted">{m.icon}</span>
              <div>
                <p className="text-sm font-semibold text-t-primary">{m.label}</p>
                <p className="text-xs text-t-muted">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {stage === "selecttest" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {tests.length === 0 && <p className="text-sm text-t-muted text-center py-4">No tests found.</p>}
          {tests.map((t) => (
            <button key={t.name} onClick={() => handleTestSelect(t)}
              className="text-left px-3 py-2 rounded-xl border border-(--border-color)
                bg-bg-card hover:bg-bg-base text-sm text-t-primary">
              <span className="font-mono text-c-brand mr-2 text-xs">{t.serial_no}</span>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {stage === "fillform" && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-t-muted mb-1">Serial No</label>
            <input value={sn} onChange={(e) => setSn(e.target.value)}
              className="input text-sm" placeholder="e.g. T001" />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">Test Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="input text-sm" placeholder="e.g. Pantograph Test" />
          </div>
          <button onClick={() => setStage("confirm")} disabled={!name.trim() || !sn.trim()}
            className="btn-primary text-sm disabled:opacity-50">
            Review
          </button>
        </div>
      )}

      {stage === "confirm" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3 flex flex-col gap-1.5 text-xs">
            <Row label="Op" value={op.toUpperCase()} brand />
            {op === "create" && (
              <><Row label="S/N" value={sn} mono /><Row label="Name" value={name} /></>
            )}
            {op === "update" && selectedTest && (
              <>
                <DiffRow label="S/N"  before={String(selectedTest.serial_no)} after={sn} />
                <DiffRow label="Name" before={selectedTest.name}              after={name} />
              </>
            )}
            {op === "delete" && selectedTest && <Row label="Test" value={selectedTest.name} />}
            {op === "delete" && (
              <p className="text-amber-400 mt-1">
                Warning: All steps and step results will also be deleted.
              </p>
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleBack} className="flex-1 btn-ghost text-sm">Back</button>
            <button onClick={handleSubmit}
              className={"flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white " +
                (op === "delete" ? "bg-red-500 hover:bg-red-600" : "btn-primary")}>
              Confirm {op}
            </button>
          </div>
        </div>
      )}

      {stage === "submitting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Done!</p>
          <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
        </div>
      )}
    </ModalShell>
  );
};

export default ImportTestsModal;
