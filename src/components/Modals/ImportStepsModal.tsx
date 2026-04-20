import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Hash, Upload, CheckCircle, ArrowLeft } from "lucide-react";

import { supabase }                            from "../../supabase";
import { fetchModuleOptions, fetchTestsForModule } from "../../lib/supabase/queries";
import { parseStepsCsv }                       from "../../utils/csvParser";
import type { ModuleOption, StepInput }        from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Stage =
  | "selectmodule"
  | "selecttest"
  | "upload"
  | "preview"
  | "confirm"
  | "submitting"
  | "done"
  | "error";

interface Props {
  onClose: () => void;
  onBack:  () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const ImportStepsModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,       setStage]      = useState<Stage>("selectmodule");
  const [modules,     setModules]    = useState<ModuleOption[]>([]);
  const [tests,       setTests]      = useState<{ id: string; testsname: string }[]>([]);
  const [selMod,      setSelMod]     = useState("");
  const [selTest,     setSelTest]    = useState("");
  const [parsed,      setParsed]     = useState<StepInput[]>([]);
  const [parseErrors, setParseErrors]= useState<string[]>([]);
  const [submitError, setSubmitError]= useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchModuleOptions().then(setModules).catch(() => {});
  }, []);

  const handleModuleSelect = async (mod: string) => {
    setSelMod(mod);
    const rows = await fetchTestsForModule(mod).catch(() => []);
    setTests(rows);
    setStage("selecttest");
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const { rows, errors } = parseStepsCsv(text);
      setParsed(rows);
      setParseErrors(errors);
      setStage(errors.length > 0 && rows.length === 0 ? "error" : "preview");
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    setStage("submitting");
    setSubmitError(null);
    try {
      const payload = parsed.map(r => ({
        serial_no:       r.serial_no,
        action:          r.action,
        expected_result: r.expected_result,
        is_divider:      r.is_divider,
        testsname:       selTest,
      }));
      const { error: e } = await supabase
        .from("test_steps")
        .upsert(payload, { onConflict: "testsname,serial_no" });
      if (e) throw new Error(e.message);
      setStage("done");
    } catch (e: any) {
      setSubmitError(e.message);
      setStage("confirm");
    }
  };

  const subtitle =
    stage === "selectmodule" ? "Pick a trainset"        :
    stage === "selecttest"   ? "Pick a test"            :
    stage === "upload"       ? "Upload CSV"             :
    stage === "preview"      ? `${parsed.length} steps parsed` :
    stage === "confirm"      ? "Review & confirm"       :
    stage === "done"         ? "Done!"                  : "…";

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
              <Hash size={16} /> Import Steps (CSV)
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

        {/* ── selectmodule ── */}
        {stage === "selectmodule" && (
          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
            {modules.length === 0 && (
              <p className="text-sm text-t-muted text-center py-4">No modules found.</p>
            )}
            {modules.map(m => (
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
              <p className="text-sm text-t-muted text-center py-4">No tests found.</p>
            )}
            {tests.map(t => (
              <button
                key={t.id}
                onClick={() => { setSelTest(t.testsname); setStage("upload"); }}
                className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)]
                  bg-bg-card hover:bg-bg-base text-sm text-t-primary"
              >
                {t.testsname}
              </button>
            ))}
          </div>
        )}

        {/* ── upload ── */}
        {stage === "upload" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-t-muted">
              CSV must have columns:{" "}
              <span className="font-mono text-t-primary">
                serial_no, action, expected_result, is_divider
              </span>
            </p>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-primary text-sm flex items-center justify-center gap-2"
            >
              <Upload size={14} /> Choose CSV file
            </button>
          </div>
        )}

        {/* ── preview / confirm ── */}
        {(stage === "preview" || stage === "confirm") && (
          <div className="flex flex-col gap-3">
            {parseErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
                {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}
            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden max-h-48 overflow-y-auto">
              <div className="bg-bg-card px-3 py-2 border-b border-[var(--border-color)]">
                <p className="text-xs font-semibold text-t-muted uppercase tracking-wider">
                  {parsed.length} Steps — {selMod} › {selTest}
                </p>
              </div>
              {parsed.slice(0, 20).map(r => (
                <div
                  key={r.serial_no}
                  className="flex items-start gap-2 px-3 py-2 border-b border-[var(--border-color)] last:border-b-0 text-xs"
                >
                  <span className="font-mono text-c-brand w-6 shrink-0">{r.serial_no}</span>
                  <span className="text-t-primary flex-1 break-all">
                    {r.is_divider ? <em className="text-t-muted">divider</em> : r.action}
                  </span>
                </div>
              ))}
              {parsed.length > 20 && (
                <div className="px-3 py-2 text-xs text-t-muted">…and {parsed.length - 20} more</div>
              )}
            </div>
            {submitError && <p className="text-xs text-red-400">{submitError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setStage("upload")}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary text-sm"
              >
                Back
              </button>
              <button onClick={handleSubmit} className="flex-1 btn-primary text-sm">
                Upsert {parsed.length} steps
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

        {/* ── error ── */}
        {stage === "error" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
              {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
            <button onClick={() => setStage("upload")} className="btn-primary text-sm">
              Try again
            </button>
          </div>
        )}

        {/* ── done ── */}
        {stage === "done" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle size={32} className="text-green-400" />
            <p className="text-sm font-semibold text-t-primary">Steps imported!</p>
            <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ImportStepsModal;