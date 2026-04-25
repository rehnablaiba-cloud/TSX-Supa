import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Hash,
  Plus,
  Pencil,
  Trash2,
  CheckCircle,
  ArrowLeft,
} from "lucide-react";

import { supabase } from "../../supabase";
import {
  fetchModuleOptions,
  fetchTestsForModule,
} from "../../lib/supabase/queries";
import { Row, DiffRow } from "../UI/ReviewRow";
import type { ModuleOption } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type StepOp = "create" | "update" | "delete";
type Stage =
  | "selectop"
  | "selectmodule"
  | "selecttest"
  | "selectstep"
  | "fillform"
  | "confirm"
  | "submitting"
  | "done";

interface ExistingStep {
  id: string;
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}

interface Props {
  onClose: () => void;
  onBack: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const ImportStepsManualModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage, setStage] = useState<Stage>("selectop");
  const [op, setOp] = useState<StepOp>("create");
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [tests, setTests] = useState<{ id: string; tests_name: string }[]>([]);
  const [steps, setSteps] = useState<ExistingStep[]>([]);
  const [selMod, setSelMod] = useState("");
  const [selTest, setSelTest] = useState("");
  const [selStep, setSelStep] = useState<ExistingStep | null>(null);

  const [sn, setSn] = useState("");
  const [action, setAction] = useState("");
  const [expected, setExpected] = useState("");
  const [is_divider, setIsDivider] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModuleOptions()
      .then(setModules)
      .catch(() => {});
  }, []);

  const handleModuleSelect = async (mod: string) => {
    setSelMod(mod);
    const rows = await fetchTestsForModule(mod).catch(() => []);
    setTests(rows);
    setStage("selecttest");
  };

  const handleTestSelect = async (tests_name: string) => {
    setSelTest(tests_name);
    if (op !== "create") {
      const { data } = await supabase
        .from("test_steps")
        .select("id, serial_no, action, expected_result, is_divider")
        .eq("tests_name", tests_name)
        .order("serial_no");
      setSteps((data ?? []) as ExistingStep[]);
      setStage("selectstep");
    } else {
      setStage("fillform");
    }
  };

  const handleStepSelect = (step: ExistingStep) => {
    setSelStep(step);
    if (op === "update") {
      setSn(String(step.serial_no));
      setAction(step.action);
      setExpected(step.expected_result);
      setIsDivider(step.is_divider);
    }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleSubmit = async () => {
    setStage("submitting");
    setError(null);
    try {
      if (op === "create") {
        const { error: e } = await supabase.from("test_steps").insert({
          serial_no: parseFloat(sn),
          action,
          expected_result: expected,
          is_divider,
          tests_name: selTest,
        });
        if (e) throw new Error(e.message);
      } else if (op === "update" && selStep) {
        const { error: e } = await supabase
          .from("test_steps")
          .update({
            serial_no: parseFloat(sn),
            action,
            expected_result: expected,
            is_divider,
          })
          .eq("id", selStep.id);
        if (e) throw new Error(e.message);
      } else if (op === "delete" && selStep) {
        const { error: e } = await supabase
          .from("test_steps")
          .delete()
          .eq("id", selStep.id);
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
      : stage === "selectmodule"
      ? "Pick trainset"
      : stage === "selecttest"
      ? "Pick test"
      : stage === "selectstep"
      ? "Pick step"
      : stage === "fillform"
      ? "Enter details"
      : stage === "confirm"
      ? "Review & confirm"
      : stage === "done"
      ? "Done!"
      : "…";

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
              <Hash size={16} /> Steps (Manual)
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
            {(["create", "update", "delete"] as StepOp[]).map((o) => (
              <button
                key={o}
                onClick={() => {
                  setOp(o);
                  setStage("selectmodule");
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)]
                  bg-bg-card hover:bg-bg-base text-left transition-all"
              >
                <span className="text-t-muted">
                  {o === "create" ? (
                    <Plus size={20} />
                  ) : o === "update" ? (
                    <Pencil size={20} />
                  ) : (
                    <Trash2 size={20} />
                  )}
                </span>
                <p className="text-sm font-semibold text-t-primary capitalize">
                  {o}
                </p>
              </button>
            ))}
          </div>
        )}

        {/* ── selectmodule ── */}
        {stage === "selectmodule" && (
          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
            {modules.length === 0 && (
              <p className="text-sm text-t-muted text-center py-4">
                No modules found.
              </p>
            )}
            {modules.map((m) => (
              <button
                key={m.name}
                onClick={() => handleModuleSelect(m.name)}
                className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)]
                  bg-bg-card hover:bg-bg-base text-sm text-t-primary"
              >
                {m.name}
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
                key={t.id}
                onClick={() => handleTestSelect(t.tests_name)}
                className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)]
                  bg-bg-card hover:bg-bg-base text-sm text-t-primary"
              >
                {t.tests_name}
              </button>
            ))}
          </div>
        )}

        {/* ── selectstep ── */}
        {stage === "selectstep" && (
          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
            {steps.length === 0 && (
              <p className="text-sm text-t-muted text-center py-4">
                No steps found.
              </p>
            )}
            {steps.map((s) => (
              <button
                key={s.id}
                onClick={() => handleStepSelect(s)}
                className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)]
                  bg-bg-card hover:bg-bg-base text-xs text-t-primary"
              >
                <span className="font-mono text-c-brand mr-2">
                  {s.serial_no}
                </span>
                {s.is_divider ? (
                  <em className="text-t-muted">divider</em>
                ) : (
                  s.action
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── fillform ── */}
        {stage === "fillform" && (
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-t-muted mb-1">
                Serial No
              </label>
              <input
                value={sn}
                onChange={(e) => setSn(e.target.value)}
                className="input text-sm"
                type="number"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-xs text-t-muted mb-1">Action</label>
              <textarea
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="input text-sm resize-none"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-xs text-t-muted mb-1">
                Expected Result
              </label>
              <textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                className="input text-sm resize-none"
                rows={3}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-t-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={is_divider}
                onChange={(e) => setIsDivider(e.target.checked)}
                className="rounded"
              />
              Is Divider
            </label>
            <button
              onClick={() => setStage("confirm")}
              disabled={!sn.trim()}
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
              <Row label="Op" value={op.toUpperCase()} brand />
              <Row label="Trainset" value={selMod} />
              <Row label="Test" value={selTest} />
              {op === "delete" && selStep && (
                <Row label="Step S/N" value={String(selStep.serial_no)} mono />
              )}
              {op === "create" && (
                <>
                  <Row label="S/N" value={sn} mono />
                  <Row label="Action" value={action} />
                  <Row label="Expected" value={expected} />
                </>
              )}
              {op === "update" && selStep && (
                <>
                  <DiffRow
                    label="S/N"
                    before={String(selStep.serial_no)}
                    after={sn}
                  />
                  <DiffRow
                    label="Action"
                    before={selStep.action}
                    after={action}
                  />
                  <DiffRow
                    label="Expected"
                    before={selStep.expected_result}
                    after={expected}
                  />
                  <DiffRow
                    label="Divider"
                    before={String(selStep.is_divider)}
                    after={String(is_divider)}
                  />
                </>
              )}
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setStage("fillform")}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary text-sm"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white ${
                  op === "delete"
                    ? "bg-red-500 hover:bg-red-600"
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
            <CheckCircle size={32} className="text-green-400" />
            <p className="text-sm font-semibold text-t-primary">Done!</p>
            <button onClick={onClose} className="btn-primary text-sm px-6">
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ImportStepsManualModal;
