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
import { supabase } from "../../supabase";
import { Row, DiffRow } from "../UI/ReviewRow";
import type { TestOption } from "../../types";

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
    supabase
      .from("tests")
      .select("serial_no, name")
      .order("serial_no")
      .then(({ data }: { data: any }) =>
        setTests((data ?? []) as TestOption[])
      );
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
        const { error: e } = await supabase
          .from("tests")
          .insert({ serial_no: sn.trim(), name: name.trim() });
        if (e) throw new Error(e.message);
      } else if (op === "update" && selectedTest) {
        const newName = name.trim();
        const newSn = sn.trim();
        const oldName = selectedTest.name;

        // FIX: tests.name is the PK. Postgres blocks renaming it while
        // teststeps.testsname still references the old value (no ON UPDATE
        // CASCADE on the FK). Rename child rows first, then the parent.
        if (newName !== oldName) {
          const { error: stepErr } = await supabase
            .from("teststeps")
            .update({ testsname: newName })
            .eq("testsname", oldName);
          if (stepErr)
            throw new Error(`Step ref update failed: ${stepErr.message}`);
        }

        const { error: e } = await supabase
          .from("tests")
          .update({ serial_no: newSn, name: newName })
          .eq("name", oldName);

        if (e) {
          // Rollback: revert teststeps so DB stays consistent
          if (newName !== oldName) {
            await supabase
              .from("teststeps")
              .update({ testsname: oldName })
              .eq("testsname", newName);
          }
          throw new Error(e.message);
        }
      } else if (op === "delete" && selectedTest) {
        const targetName = selectedTest.name;

        // FIX: FK also blocks deleting a test that has steps.
        // Delete teststeps first, then the parent test row.
        const { error: stepErr } = await supabase
          .from("teststeps")
          .delete()
          .eq("testsname", targetName);
        if (stepErr) throw new Error(`Step cleanup failed: ${stepErr.message}`);

        const { error: e } = await supabase
          .from("tests")
          .delete()
          .eq("name", targetName);
        if (e) throw new Error(e.message);
      }

      setStage("done");
    } catch (e: any) {
      setError(e.message);
      setStage("confirm");
    }
  };

  const subtitle =
    stage === "selectop"
      ? "Choose operation"
      : stage === "selecttest"
      ? "Pick a test"
      : stage === "fillform"
      ? "Enter details"
      : stage === "confirm"
      ? "Review & confirm"
      : stage === "done"
      ? "Done!"
      : "…";

  return (
    // FIX: ModalShell.title is typed as string — passing JSX caused TS2322.
    // Use the icon prop for the FlaskConical icon instead.
    <ModalShell
      title={
        <span className="flex items-center gap-1.5">
          <FlaskConical size={16} /> Tests
        </span>
      }
      onClose={onClose}
    >
      <div className="flex items-center justify-between -mt-1 mb-3">
        <p className="text-xs text-t-muted">{subtitle}</p>
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
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-left transition-all"
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
              className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-sm text-t-primary"
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
              placeholder="e.g. TXXX"
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
          <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-3 flex flex-col gap-1.5 text-xs">
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
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() =>
                setStage(op === "create" ? "fillform" : "selecttest")
              }
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
