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
import { Row, DiffRow } from "../UI/ReviewRow";
import {
  fetchTestOptions,
  fetchStepsByTest,
  createStep,
  updateStep,
  deleteStepWithResults,
} from "../../lib/supabase/queries.mobilenav";
import type {
  TestOption,
  StepOption,
} from "../../lib/supabase/queries.mobilenav";

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

  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTest, setSelectedTest] = useState<TestOption | null>(null);

  const [steps, setSteps] = useState<StepOption[]>([]);
  const [selectedStep, setSelectedStep] = useState<StepOption | null>(null);

  const [serialNo, setSerialNo] = useState("");
  const [action, setAction] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [isDivider, setIsDivider] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load tests once ──────────────────────────────────────────────────────
  useEffect(() => {
    fetchTestOptions().then(setTests).catch(console.error);
  }, []);

  // ── Load steps when selected test changes ────────────────────────────────
  useEffect(() => {
    if (!selectedTest) return;
    fetchStepsByTest(selectedTest.name).then(setSteps).catch(console.error);
  }, [selectedTest]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const resetForm = () => {
    setSerialNo("");
    setAction("");
    setExpectedResult("");
    setIsDivider(false);
  };

  const handleTestSelect = (t: TestOption) => {
    setSelectedTest(t);
    setSelectedStep(null);
    resetForm();
    setStage("selectop");
  };

  const handleOpSelect = (o: StepOp) => {
    setOp(o);
    resetForm();
    setStage(o === "create" ? "fillform" : "selectstep");
  };

  const handleStepSelect = (s: StepOption) => {
    setSelectedStep(s);
    if (op === "update") {
      setSerialNo(String(s.serial_no));
      setAction(s.action);
      setExpectedResult(s.expected_result);
      setIsDivider(s.is_divider);
    }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleBack = () => {
    if (stage === "selectop") return setStage("selecttest");
    if (stage === "selectstep") return setStage("selectop");
    if (stage === "fillform")
      return setStage(op === "create" ? "selectop" : "selectstep");
    if (stage === "confirm")
      return setStage(op === "delete" ? "selectstep" : "fillform");
    onBack();
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedTest) return;
    setStage("submitting");
    setError(null);

    try {
      if (op === "create") {
        await createStep({
          tests_name: selectedTest.name,
          serial_no: Number(serialNo),
          action: action.trim(),
          expected_result: expectedResult.trim(),
          is_divider: isDivider,
        });
      } else if (op === "update" && selectedStep) {
        await updateStep(selectedStep.id, {
          action: action.trim(),
          expected_result: expectedResult.trim(),
          is_divider: isDivider,
        });
      } else if (op === "delete" && selectedStep) {
        await deleteStepWithResults(selectedStep.id);
      }

      setStage("done");
    } catch (e: any) {
      setError(e.message);
      setStage("confirm");
    }
  };

  const canSubmitForm =
    serialNo.trim() !== "" && !isNaN(Number(serialNo)) && action.trim() !== "";

  const subtitle: Record<Stage, string> = {
    selecttest: "Pick a test",
    selectop: "Choose operation",
    selectstep: "Pick a step",
    fillform: "Enter details",
    confirm: "Review & confirm",
    submitting: "…",
    done: "Done!",
  };

  // ── Render ───────────────────────────────────────────────────────────────
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
        <p className="text-xs text-t-muted">{subtitle[stage]}</p>
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
              <span className="truncate">{s.action}</span>
              {s.is_divider && (
                <span className="ml-2 text-[10px] text-t-muted border border-(--border-color) rounded px-1">
                  divider
                </span>
              )}
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
              type="number"
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
              className="input text-sm"
              placeholder="e.g. 1"
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">Action</label>
            <textarea
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="input text-sm resize-none"
              rows={2}
              placeholder="What the tester should do…"
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">
              Expected Result
            </label>
            <textarea
              value={expectedResult}
              onChange={(e) => setExpectedResult(e.target.value)}
              className="input text-sm resize-none"
              rows={2}
              placeholder="What should happen…"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-t-muted cursor-pointer">
            <input
              type="checkbox"
              checked={isDivider}
              onChange={(e) => setIsDivider(e.target.checked)}
              className="accent-c-brand"
            />
            Mark as section divider
          </label>
          <button
            onClick={() => setStage("confirm")}
            disabled={!canSubmitForm}
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
                <Row label="Serial No" value={serialNo} mono />
                <Row label="Action" value={action} />
                {expectedResult && (
                  <Row label="Expected" value={expectedResult} />
                )}
                {isDivider && <Row label="Divider" value="Yes" />}
              </>
            )}

            {op === "update" && selectedStep && (
              <>
                <DiffRow
                  label="Serial No"
                  before={String(selectedStep.serial_no)}
                  after={serialNo}
                />
                <DiffRow
                  label="Action"
                  before={selectedStep.action}
                  after={action}
                />
                <DiffRow
                  label="Expected"
                  before={selectedStep.expected_result}
                  after={expectedResult}
                />
                {isDivider !== selectedStep.is_divider && (
                  <DiffRow
                    label="Divider"
                    before={selectedStep.is_divider ? "Yes" : "No"}
                    after={isDivider ? "Yes" : "No"}
                  />
                )}
              </>
            )}

            {op === "delete" && selectedStep && (
              <>
                <Row
                  label="Serial No"
                  value={String(selectedStep.serial_no)}
                  mono
                />
                <Row label="Action" value={selectedStep.action} />
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
