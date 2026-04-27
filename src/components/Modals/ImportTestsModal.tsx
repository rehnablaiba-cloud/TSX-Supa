// src/components/Modals/ImportTestsModal.tsx
import React, { useEffect, useState } from "react";
import {
  FlaskConical,
  Plus,
  Pencil,
  Trash2,
  CheckCircle,
  ArrowLeft,
} from "lucide-react";
import ModalShell from "../Layout/ModalShell";
import { Row, DiffRow } from "../UI/ReviewRow";
import {
  fetchTestOptions,
  createTest,
  updateTest,
  deleteTestCascade,
} from "../../lib/supabase/queries.mobilenav";
import type { TestOption } from "../../lib/supabase/queries.mobilenav";

// ── Types ──────────────────────────────────────────────────────────────────

type TestOp = "create" | "update" | "delete";
type Stage =
  | "selectop"
  | "selecttest"
  | "fillform"
  | "confirm"
  | "submitting"
  | "done";

const OP_META: {
  id: TestOp;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  {
    id: "create",
    label: "Create",
    icon: <Plus size={20} />,
    desc: "Add a new test",
  },
  {
    id: "update",
    label: "Update",
    icon: <Pencil size={20} />,
    desc: "Edit test details",
  },
  {
    id: "delete",
    label: "Delete",
    icon: <Trash2 size={20} />,
    desc: "Remove a test",
  },
];

interface Props {
  onClose: () => void;
  onBack: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

const ImportTestsModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage, setStage] = useState<Stage>("selectop");
  const [op, setOp] = useState<TestOp>("create");
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTest, setSelected] = useState<TestOption | null>(null);
  const [sn, setSn] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTestOptions().then(setTests).catch(console.error);
  }, []);

  const handleOpSelect = (o: TestOp) => {
    setOp(o);
    setStage(o === "create" ? "fillform" : "selecttest");
  };

  const handleTestSelect = (t: TestOption) => {
    setSelected(t);
    if (op === "update") {
      setSn(String(t.serial_no));
      setName(t.name);
    }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleSubmit = async () => {
    setStage("submitting");
    setError(null);
    try {
      if (op === "create") {
        await createTest(sn.trim(), name.trim());
      } else if (op === "update" && selectedTest) {
        await updateTest(selectedTest.name, name.trim(), sn.trim());
      } else if (op === "delete" && selectedTest) {
        await deleteTestCascade(selectedTest.name);
      }
      setStage("done");
    } catch (e: any) {
      setError(e.message);
      setStage("confirm");
    }
  };

  const subtitle: Record<Stage, string> = {
    selectop: "Choose operation",
    selecttest: "Pick a test",
    fillform: "Enter details",
    confirm: "Review & confirm",
    submitting: "…",
    done: "Done!",
  };

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-1.5">
          <FlaskConical size={16} /> Tests
        </span>
      }
      onClose={onClose}
    >
      <div className="flex items-center justify-between -mt-1 mb-3">
        <p className="text-xs text-t-muted">{subtitle[stage]}</p>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
      </div>

      {/* ── selectop ── */}
      {stage === "selectop" && (
        <div className="flex flex-col gap-2">
          {OP_META.map((m) => (
            <button
              key={m.id}
              onClick={() => handleOpSelect(m.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-(--border-color) bg-bg-card hover:bg-bg-base text-left transition-all"
            >
              <span className="text-t-muted">{m.icon}</span>
              <div>
                <p className="text-sm font-semibold text-t-primary">
                  {m.label}
                </p>
                <p className="text-xs text-t-muted">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── selecttest ── */}
      {stage === "selecttest" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {tests.length === 0 && (
            <p className="text-sm text-t-muted text-center py-4">
              No tests found.
            </p>
          )}
          {tests.map((t) => (
            <button
              key={t.name}
              onClick={() => handleTestSelect(t)}
              className="text-left px-3 py-2 rounded-xl border border-(--border-color) bg-bg-card hover:bg-bg-base text-sm text-t-primary"
            >
              <span className="font-mono text-c-brand mr-2">{t.serial_no}</span>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* ── fillform ── */}
      {stage === "fillform" && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-t-muted mb-1">Serial No</label>
            <input
              value={sn}
              onChange={(e) => setSn(e.target.value)}
              className="input text-sm"
              placeholder="e.g. T001"
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">Test Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input text-sm"
              placeholder="e.g. Pantograph Test"
            />
          </div>
          <button
            onClick={() => setStage("confirm")}
            disabled={!name.trim() || !sn.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Review
          </button>
        </div>
      )}

      {/* ── confirm ── */}
      {stage === "confirm" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3 flex flex-col gap-1.5 text-xs">
            <Row label="Operation" value={op.toUpperCase()} brand />
            {op === "create" && (
              <>
                <Row label="S/N" value={sn} mono />
                <Row label="Name" value={name} />
              </>
            )}
            {op === "update" && selectedTest && (
              <>
                <DiffRow
                  label="Serial No"
                  before={String(selectedTest.serial_no)}
                  after={sn}
                />
                <DiffRow label="Name" before={selectedTest.name} after={name} />
              </>
            )}
            {op === "delete" && selectedTest && (
              <Row label="Delete" value={selectedTest.name} mono />
            )}
          </div>

          {op === "delete" && (
            <p className="text-xs text-t-muted">
              ⚠ All steps, step results, and module assignments for this test
              will also be deleted.
            </p>
          )}
          {error && <p className="text-xs text-fail">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() =>
                setStage(op === "create" ? "fillform" : "selecttest")
              }
              className="flex-1 px-4 py-2.5 rounded-xl border border-(--border-color) text-t-secondary text-sm"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-(--bg-surface) ${
                op === "delete"
                  ? "bg-fail hover:bg-[color-mix(in_srgb,var(--color-fail),black_20%)]"
                  : "btn-primary"
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
          <CheckCircle
            size={32}
            className="text-[color-mix(in_srgb,var(--color-pass),white_30%)]"
          />
          <p className="text-sm font-semibold text-t-primary">Done!</p>
          <button onClick={onClose} className="btn-primary text-sm px-6">
            Close
          </button>
        </div>
      )}
    </ModalShell>
  );
};

export default ImportTestsModal;
