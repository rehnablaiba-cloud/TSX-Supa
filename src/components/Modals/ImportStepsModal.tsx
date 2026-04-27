// src/components/Modals/ImportStepsModal.tsx
import React, { useEffect, useState } from "react";
import {
  ListChecks,
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

type StepOp = "create" | "update" | "delete";
type Stage =
  | "selecttest"
  | "selectop"
  | "selectstep"
  | "fillform"
  | "confirm"
  | "submitting"
  | "done";

interface StepOption {
  id: string;
  serial_no: string;
  description: string;
  tests_name: string;
}

const OP_META: {
  id: StepOp;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  {
    id: "create",
    label: "Create",
    icon: <Plus size={20} />,
    desc: "Add a new step",
  },
  {
    id: "update",
    label: "Update",
    icon: <Pencil size={20} />,
    desc: "Edit step details",
  },
  {
    id: "delete",
    label: "Delete",
    icon: <Trash2 size={20} />,
    desc: "Remove a step",
  },
];

interface Props {
  onClose: () => void;
  onBack: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

const ImportStepsModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage, setStage] = useState<Stage>("selecttest");
  const [op, setOp] = useState<StepOp>("create");

  // parent test
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTest, setSelectedTest] = useState<TestOption | null>(null);

  // steps for selected test
  const [steps, setSteps] = useState<StepOption[]>([]);
  const [selectedStep, setSelectedStep] = useState<StepOption | null>(null);

  // form fields
  const [sn, setSn] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load all tests for the initial picker
  useEffect(() => {
    supabase
      .from("tests")
      .select("serial_no, name")
      .order("serial_no")
      .then(({ data }: { data: any }) =>
        setTests((data ?? []) as TestOption[])
      );
  }, []);

  // Load steps whenever the selected test changes
  useEffect(() => {
    if (!selectedTest) return;
    supabase
      .from("test_steps")
      .select("id, serial_no, description, tests_name")
      .eq("tests_name", selectedTest.name)
      .order("serial_no")
      .then(({ data }: { data: any }) =>
        setSteps((data ?? []) as StepOption[])
      );
  }, [selectedTest]);

  const handleTestSelect = (t: TestOption) => {
    setSelectedTest(t);
    setSelectedStep(null);
    setSn("");
    setDescription("");
    setStage("selectop");
  };

  const handleOpSelect = (o: StepOp) => {
    setOp(o);
    setStage(o === "create" ? "fillform" : "selectstep");
  };

  const handleStepSelect = (s: StepOption) => {
    setSelectedStep(s);
    if (op === "update") {
      setSn(s.serial_no);
      setDescription(s.description);
    }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleSubmit = async () => {
    if (!selectedTest) return;
    setStage("submitting");
    setError(null);

    try {
      if (op === "create") {
        const { error: e } = await supabase.from("test_steps").insert({
          serial_no: sn.trim(),
          description: description.trim(),
          tests_name: selectedTest.name,
        });
        if (e) throw new Error(e.message);
      } else if (op === "update" && selectedStep) {
        const { error: e } = await supabase
          .from("test_steps")
          .update({
            serial_no: sn.trim(),
            description: description.trim(),
          })
          .eq("id", selectedStep.id);
        if (e) throw new Error(e.message);
      } else if (op === "delete" && selectedStep) {
        // step_results FK references test_steps — clean up children first
        const { error: resultErr } = await supabase
          .from("step_results")
          .delete()
          .eq("test_steps_id", selectedStep.id);
        if (resultErr)
          throw new Error(`Result cleanup failed: ${resultErr.message}`);

        const { error: e } = await supabase
          .from("test_steps")
          .delete()
          .eq("id", selectedStep.id);
        if (e) throw new Error(e.message);
      }

      setStage("done");
    } catch (e: any) {
      setError(e.message);
      setStage("confirm");
    }
  };

  const subtitle =
    stage === "selecttest"
      ? "Pick a test"
      : stage === "selectop"
      ? "Choose operation"
      : stage === "selectstep"
      ? "Pick a step"
      : stage === "fillform"
      ? "Enter details"
      : stage === "confirm"
      ? "Review & confirm"
      : stage === "done"
      ? "Done!"
      : "…";

  // Back button logic per stage
  const handleBack = () => {
    if (stage === "selectop") return setStage("selecttest");
    if (stage === "selectstep") return setStage("selectop");
    if (stage === "fillform")
      return setStage(op === "create" ? "selectop" : "selectstep");
    if (stage === "confirm")
      return setStage(op === "delete" ? "selectstep" : "fillform");
    onBack();
  };

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-1.5">
          <ListChecks size={16} /> Steps
        </span>
      }
      onClose={onClose}
    >
      <div className="flex items-center justify-between -mt-1 mb-3">
        <p className="text-xs text-t-muted">{subtitle}</p>
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
      </div>

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

      {/* ── selectop ── */}
      {stage === "selectop" && (
        <div className="flex flex-col gap-2">
          {selectedTest && (
            <p className="text-xs text-t-muted mb-1">
              Test:{" "}
              <span className="font-mono text-c-brand">
                {selectedTest.serial_no}
              </span>{" "}
              {selectedTest.name}
            </p>
          )}
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

      {/* ── selectstep ── */}
      {stage === "selectstep" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {steps.length === 0 && (
            <p className="text-sm text-t-muted text-center py-4">
              No steps found for this test.
            </p>
          )}
          {steps.map((s) => (
            <button
              key={s.id}
              onClick={() => handleStepSelect(s)}
              className="text-left px-3 py-2 rounded-xl border border-(--border-color) bg-bg-card hover:bg-bg-base text-sm text-t-primary"
            >
              <span className="font-mono text-c-brand mr-2">{s.serial_no}</span>
              {s.description}
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
              placeholder="e.g. S001"
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input text-sm resize-none"
              rows={3}
              placeholder="Step description…"
            />
          </div>
          <button
            onClick={() => setStage("confirm")}
            disabled={!description.trim() || !sn.trim()}
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
            {selectedTest && (
              <Row label="Test" value={selectedTest.name} mono />
            )}
            {op === "create" && (
              <>
                <Row label="S/N" value={sn} mono />
                <Row label="Description" value={description} />
              </>
            )}
            {op === "update" && selectedStep && (
              <>
                <DiffRow
                  label="Serial No"
                  before={selectedStep.serial_no}
                  after={sn}
                />
                <DiffRow
                  label="Description"
                  before={selectedStep.description}
                  after={description}
                />
              </>
            )}
            {op === "delete" && selectedStep && (
              <>
                <Row label="S/N" value={selectedStep.serial_no} mono />
                <Row label="Description" value={selectedStep.description} />
              </>
            )}
          </div>
          {op === "delete" && (
            <p className="text-xs text-t-muted">
              ⚠ All associated step results will also be deleted.
            </p>
          )}
          {error && <p className="text-xs text-fail">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() =>
                setStage(op === "delete" ? "selectstep" : "fillform")
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

export default ImportStepsModal;
