// src/components/Modals/ImportStepsModal.tsx
import React, { useEffect, useRef, useState } from "react";
import { Hash, Upload, CheckCircle } from "lucide-react";
import ModalShell from "../Layout/ModalShell";

import { supabase } from "../../supabase";
import { parseStepsCsv } from "../../utils/csvParser";
import type { StepInput } from "../../types";

type Stage = "selecttest" | "upload" | "preview" | "confirm" | "submitting" | "done" | "error";
interface Props { onClose: () => void; onBack: () => void }

const ImportStepsModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage, setStage]             = useState<Stage>("selecttest");
  const [tests, setTests]             = useState<{ name: string }[]>([]);
  const [selTest, setSelTest]         = useState("");
  const [parsed, setParsed]           = useState<StepInput[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileRef                       = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("tests").select("name").order("name")
      .then(({ data }) => setTests((data ?? []) as { name: string }[]));
  }, []);

  const handleBack = () => {
    switch (stage) {
      case "selecttest": return onBack();
      case "upload":     return setStage("selecttest");
      case "preview":
      case "confirm":
      case "error":      return setStage("upload");
      default: break;
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
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
      const { error: delErr } = await supabase
        .from("test_steps").delete().eq("tests_name", selTest);
      if (delErr) throw new Error(delErr.message);

      const { error: insErr } = await supabase.from("test_steps").insert(
        parsed.map((r) => ({
          serial_no: r.serial_no, action: r.action,
          expected_result: r.expected_result, is_divider: r.is_divider,
          tests_name: selTest,
        }))
      );
      if (insErr) throw new Error(insErr.message);
      setStage("done");
    } catch (e: any) { setSubmitError(e.message); setStage("confirm"); }
  };

  const subtitle: Partial<Record<Stage, string>> = {
    selecttest: "Pick a test",
    upload:     "Upload CSV",
    preview:    parsed.length + " steps parsed",
    confirm:    "Review & confirm",
    done:       "Done!",
  };

  return (
    <ModalShell
      title={<><Hash size={16} /> Import Steps (CSV)</>}
      onClose={onClose}
      onBack={stage !== "submitting" && stage !== "done" ? handleBack : undefined}
    >
      <p className="text-xs text-t-muted -mt-2">{subtitle[stage] ?? "..."}</p>

      {stage === "selecttest" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {tests.length === 0 && <p className="text-sm text-t-muted text-center py-4">No tests found.</p>}
          {tests.map((t) => (
            <button key={t.name} onClick={() => { setSelTest(t.name); setStage("upload"); }}
              className="text-left px-3 py-2 rounded-xl border border-(--border-color)
                bg-bg-card hover:bg-bg-base text-sm text-t-primary">
              {t.name}
            </button>
          ))}
        </div>
      )}

      {stage === "upload" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            Target test: <span className="font-medium text-t-primary">{selTest}</span>
          </p>
          <p className="text-xs text-t-muted">
            CSV columns:{" "}
            <span className="font-mono text-t-primary">
              serial_no, action, expected_result, is_divider
            </span>
          </p>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()}
            className="btn-primary text-sm flex items-center justify-center gap-2">
            <Upload size={14} /> Choose CSV file
          </button>
        </div>
      )}

      {(stage === "preview" || stage === "confirm") && (
        <div className="flex flex-col gap-3">
          {parseErrors.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
              {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
          <div className="rounded-xl border border-(--border-color) overflow-hidden max-h-48 overflow-y-auto">
            <div className="bg-bg-card px-3 py-2 border-b border-(--border-color)">
              <p className="text-xs font-semibold text-t-muted uppercase tracking-wider">
                {parsed.length} Steps to {selTest}
              </p>
            </div>
            {parsed.slice(0, 20).map((r) => (
              <div key={r.serial_no}
                className="flex items-start gap-2 px-3 py-2 border-b border-(--border-color) last:border-b-0 text-xs">
                <span className="font-mono text-c-brand w-6 shrink-0">{r.serial_no}</span>
                <span className="text-t-primary flex-1 break-all">
                  {r.is_divider ? <em className="text-t-muted">divider</em> : r.action}
                </span>
              </div>
            ))}
            {parsed.length > 20 && (
              <div className="px-3 py-2 text-xs text-t-muted">and {parsed.length - 20} more</div>
            )}
          </div>
          {submitError && <p className="text-xs text-red-400">{submitError}</p>}
          <div className="flex gap-2">
            <button onClick={handleBack} className="flex-1 btn-ghost text-sm">Back</button>
            <button onClick={handleSubmit} className="flex-1 btn-primary text-sm">
              Upsert {parsed.length} steps
            </button>
          </div>
        </div>
      )}

      {stage === "submitting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {stage === "error" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
          <button onClick={() => setStage("upload")} className="btn-primary text-sm">Try again</button>
        </div>
      )}

      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Steps imported!</p>
          <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
        </div>
      )}
    </ModalShell>
  );
};

export default ImportStepsModal;
