import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Hash, FlaskConical, Plus, Pencil, Trash2,
  AlertTriangle, Check, FolderOpen,
} from "lucide-react";

import ModalShell from "../UI/ModalShell";
import {
  fetchTests,
  findStepBySerialNo,
  bulkCreateSteps,
  updateStep,
  deleteStep,
} from "../../lib/supabase/queries";
import type { TestOption, StepCsvRow, StepImportSummary, StepImportStage, StepOp } from "./shared/types";

// ─────────────────────────────────────────────────────────────────────────────
// RFC-4180 CSV parser — handles quoted fields with embedded newlines (Alt+Enter)
// Unchanged from original
// ─────────────────────────────────────────────────────────────────────────────

function parseCsvToRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuote = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = false;
      } else {
        cell += ch;
      }
    } else {
      if      (ch === '"')  { inQuote = true; }
      else if (ch === ",")  { row.push(cell); cell = ""; }
      else if (ch === "\n") {
        row.push(cell); cell = "";
        if (row.some(c => c !== "")) records.push(row);
        row = [];
      } else { cell += ch; }
    }
  }
  row.push(cell);
  if (row.some(c => c !== "")) records.push(row);
  return records;
}

function parseStepsCsv(text: string): { rows: StepCsvRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows:   StepCsvRow[] = [];

  const records = parseCsvToRecords(text);
  if (records.length < 2) { errors.push("File is empty."); return { rows, errors }; }

  const header = records[0].map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const iSn  = header.indexOf("serialno");
  const iAct = header.indexOf("action");
  const iRes = header.indexOf("expected_result");
  const iDiv = header.indexOf("is_divider");

  const missing = [
    iSn  < 0 && "serialno",
    iAct < 0 && "action",
    iRes < 0 && "expected_result",
    iDiv < 0 && "is_divider",
  ].filter(Boolean) as string[];

  if (missing.length) { errors.push(`Missing columns: ${missing.join(", ")}`); return { rows, errors }; }

  for (let i = 1; i < records.length; i++) {
    const cells = records[i];
    const snVal = parseInt(cells[iSn]?.trim() ?? "", 10);
    if (isNaN(snVal) || snVal < 1) { errors.push(`Row ${i + 1}: invalid serialno — skipped.`); continue; }
    rows.push({
      serialno:        snVal,
      action:          cells[iAct] ?? "",
      expected_result: cells[iRes] ?? "",
      is_divider:      /^(true|1|yes)$/i.test(cells[iDiv]?.trim() ?? ""),
    });
  }
  return { rows, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STEP_CSV_OP_META: { id: StepOp; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "create", label: "Create", icon: <Plus   size={20} />, desc: "Add new steps from CSV"          },
  { id: "update", label: "Update", icon: <Pencil size={20} />, desc: "Overwrite existing steps by SN"  },
  { id: "delete", label: "Delete", icon: <Trash2 size={20} />, desc: "Remove steps by serial number"   },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface Props { onClose: () => void; onBack: () => void; }

const ImportStepsModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,        setStage]       = useState<StepImportStage>("selecttest");
  const [tests,        setTests]       = useState<TestOption[]>([]);
  const [testsLoading, setTestsLoading] = useState(true);
  const [selectedTest, setSelectedTest] = useState<TestOption | null>(null);
  const [op,           setOp]          = useState<StepOp>("create");
  const [rows,         setRows]        = useState<StepCsvRow[]>([]);
  const [parseErrors,  setParseErrors] = useState<string[]>([]);
  const [summary,      setSummary]     = useState<StepImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── CHANGED: fetchTests() from queries.ts ─────────────────────────────────
  useEffect(() => {
    fetchTests()
      .then(data => { setTests(data); setTestsLoading(false); })
      .catch(() => setTestsLoading(false));
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows: parsed, errors } = parseStepsCsv(ev.target?.result as string);
      setRows(parsed);
      setParseErrors(errors);
      setStage("preview");
    };
    reader.onerror = () => setParseErrors(["Failed to read file."]);
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── CHANGED: all supabase.from() calls replaced with queries.ts fns ───────
  const handleImport = useCallback(async () => {
    if (!selectedTest) return;
    setStage("importing");
    const result: StepImportSummary = { written: 0, skipped: 0, errors: [] };

    try {
      if (op === "create") {
        // bulkCreateSteps handles the full insert in one call
        const { written, errors } = await bulkCreateSteps(
          selectedTest.name,
          rows.map(r => ({
            serialno:        r.serialno,
            action:          r.action,
            expected_result: r.expected_result,
            is_divider:      r.is_divider,
          }))
        );
        result.written = written;
        result.skipped = rows.length - written;
        result.errors  = errors;
      } else {
        // update / delete — row-by-row lookup then act
        for (const row of rows) {
          const existing = await findStepBySerialNo(selectedTest.name, row.serialno);
          if (!existing) {
            result.errors.push(`SN ${row.serialno}: not found — skipped.`);
            result.skipped++;
            continue;
          }
          try {
            if (op === "update") {
              await updateStep(existing.id, {
                action:          row.action,
                expected_result: row.expected_result,
                is_divider:      row.is_divider,
              });
            } else {
              await deleteStep(existing.id);
            }
            result.written++;
          } catch (e: any) {
            result.errors.push(`SN ${row.serialno}: ${e?.message}`);
            result.skipped++;
          }
        }
      }
    } catch (e: any) {
      result.errors.push(e?.message ?? "Unexpected error.");
    }

    setSummary(result);
    setStage("done");
  }, [selectedTest, op, rows]);

  const stageLabel: Record<StepImportStage, string> = {
    selecttest: "Step 1 of 3 — Select test",
    selectop:   "Step 2 of 3 — Choose operation",
    upload:     "Step 3 of 3 — Upload CSV",
    preview:    `${rows.length} rows ready to ${op}`,
    importing:  "Writing to Supabase…",
    done:       "Import complete",
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <ModalShell icon={<Hash size={16} />} title="Import Steps — CSV" subtitle={stageLabel[stage]} onClose={onClose}>

      {/* ── STEP 1: Select test ─────────────────────────────────────────── */}
      {stage === "selecttest" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Select Test</label>
            {testsLoading ? (
              <div className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-muted text-sm flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin inline-block" />
                Loading tests…
              </div>
            ) : tests.length === 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">
                No tests found. Import tests first.
              </div>
            ) : (
              <select
                defaultValue=""
                onChange={e => setSelectedTest(tests.find(t => t.name === e.target.value) ?? null)}
                className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm focus:outline-none focus:border-c-brand transition-colors appearance-none cursor-pointer">
                <option value="" disabled>Choose a test</option>
                {tests.map(t => <option key={t.name} value={t.name}>SN {t.serialno} · {t.name}</option>)}
              </select>
            )}
          </div>

          {selectedTest && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-c-brand/30 bg-c-brand-bg">
              <FlaskConical size={20} className="text-c-brand" />
              <div>
                <p className="text-sm font-semibold text-c-brand">{selectedTest.name}</p>
                <p className="text-xs text-t-muted">SN {selectedTest.serialno}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onBack}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
              Back
            </button>
            <button onClick={() => setStage("selectop")} disabled={!selectedTest}
              className="flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Choose operation ─────────────────────────────────────── */}
      {stage === "selectop" && (
        <div className="flex flex-col gap-4">
          {/* Test context strip */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-bg-card">
            <FlaskConical size={18} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-t-primary truncate">{selectedTest?.name}</p>
              <p className="text-xs text-t-muted">SN {selectedTest?.serialno}</p>
            </div>
            <button onClick={() => setStage("selecttest")} className="text-xs text-c-brand hover:underline shrink-0">Change</button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Operation</label>
            <div className="flex flex-col gap-2">
              {STEP_CSV_OP_META.map(m => (
                <button key={m.id} onClick={() => setOp(m.id)}
                  className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all text-left
                    ${op === m.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                  <span className={op === m.id ? "text-c-brand" : "text-t-muted"}>{m.icon}</span>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${op === m.id ? "text-c-brand" : "text-t-primary"}`}>{m.label}</p>
                    <p className="text-xs text-t-muted">{m.desc}</p>
                  </div>
                  {op === m.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
                </button>
              ))}
            </div>
          </div>

          {op === "delete" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <p>CSV only needs <code className="font-mono">serialno</code> column for delete. Other columns are ignored.</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => setStage("selecttest")}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
              Back
            </button>
            <button onClick={() => setStage("upload")} className="flex-1 btn-primary text-sm">Next</button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Upload CSV ───────────────────────────────────────────── */}
      {stage === "upload" && (
        <div className="flex flex-col gap-4">
          {/* Context strip */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <FlaskConical size={14} />
            <span className="text-t-primary font-medium truncate">{selectedTest?.name}</span>
            <span className="mx-1 text-t-muted">·</span>
            <span className="text-c-brand font-semibold">{STEP_CSV_OP_META.find(m => m.id === op)?.label}</span>
          </div>

          {/* Column reference */}
          <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-4 text-xs">
            <p className="text-t-secondary font-semibold mb-2 uppercase tracking-wider">Required columns</p>
            <div className="flex flex-col gap-1.5">
              {(op === "delete"
                ? [["serialno", "Step serial no. (int)"]]
                : [
                    ["serialno",        "Step serial no. (int)"],
                    ["action",          "Step action text"],
                    ["expected_result", "Expected outcome"],
                    ["is_divider",      "true / false"],
                  ]
              ).map(([c, d]) => (
                <div key={c} className="flex items-start gap-3">
                  <code className="text-c-brand font-bold w-28 shrink-0">{c}</code>
                  <span className="text-t-muted">{d}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Example */}
          <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-4 text-xs font-mono text-t-muted">
            <p className="text-t-secondary font-semibold mb-1.5 not-italic font-sans uppercase tracking-wider">Example</p>
            {op === "delete" ? (
              <p className="text-c-brand">serialno<br/>1<br/>2<br/>3</p>
            ) : (
              <>
                <p className="text-c-brand">serialno,action,expected_result,is_divider</p>
                <p>1,Open login page,Login page loads,false</p>
                <p>2,Enter credentials,Fields accept input,false</p>
                <p>3,Click submit,Dashboard shown,false</p>
              </>
            )}
          </div>

          {/* File picker */}
          <button onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-[var(--border-color)] hover:border-c-brand/60 hover:bg-bg-card transition-colors cursor-pointer">
            <FolderOpen size={32} className="text-t-muted" />
            <span className="text-sm font-medium text-t-secondary">Tap to choose CSV file</span>
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />

          <button onClick={() => setStage("selectop")}
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
            Back
          </button>
        </div>
      )}

      {/* ── PREVIEW ──────────────────────────────────────────────────────── */}
      {stage === "preview" && (
        <div className="flex flex-col gap-3">
          {/* Context strip */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <FlaskConical size={14} />
            <span className="text-t-primary font-medium truncate">{selectedTest?.name}</span>
            <span className="mx-1 text-t-muted">·</span>
            <span className="text-c-brand font-semibold">{STEP_CSV_OP_META.find(m => m.id === op)?.label}</span>
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 flex flex-col gap-1">
              <p className="font-semibold">Warnings ({parseErrors.length})</p>
              {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-red-400 text-center py-4">No valid rows found.</p>
          ) : (
            <>
              <div className="rounded-xl bg-bg-card border border-[var(--border-color)] p-3 text-center">
                <p className="text-3xl font-bold text-c-brand">{rows.length}</p>
                <p className="text-xs text-t-muted mt-0.5">Steps to {op}</p>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] overflow-hidden max-h-52 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-bg-card sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left text-t-muted font-semibold">SN</th>
                      {op !== "delete" && <th className="px-2 py-2 text-left text-t-muted font-semibold">Action</th>}
                      {op !== "delete" && <th className="px-2 py-2 text-center text-t-muted font-semibold">Div?</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-bg-card">
                        <td className="px-2 py-2 font-mono text-c-brand">{r.serialno}</td>
                        {op !== "delete" && <td className="px-2 py-2 text-t-primary truncate max-w-[160px]">{r.action}</td>}
                        {op !== "delete" && <td className="px-2 py-2 text-center text-t-muted">{r.is_divider ? "✓" : ""}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex gap-2">
            <button onClick={() => { setStage("upload"); setRows([]); setParseErrors([]); }}
              className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
              Back
            </button>
            <button onClick={handleImport} disabled={rows.length === 0}
              className={`flex-1 btn-primary text-sm flex items-center justify-center gap-2 disabled:opacity-50
                ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
              {STEP_CSV_OP_META.find(m => m.id === op)?.icon}
              {STEP_CSV_OP_META.find(m => m.id === op)?.label} {rows.length} Steps
            </button>
          </div>
        </div>
      )}

      {/* ── IMPORTING ────────────────────────────────────────────────────── */}
      {stage === "importing" && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
          <p className="text-sm text-t-secondary">Writing to Supabase…</p>
        </div>
      )}

      {/* ── DONE ─────────────────────────────────────────────────────────── */}
      {stage === "done" && summary && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Written", value: summary.written, color: "text-green-400" },
              { label: "Skipped", value: summary.skipped, color: "text-amber-400" },
            ].map(s => (
              <div key={s.label} className="rounded-xl bg-bg-card border border-[var(--border-color)] p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-t-muted mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {summary.errors.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 max-h-32 overflow-y-auto flex flex-col gap-1">
              <p className="font-semibold">Errors ({summary.errors.length})</p>
              {summary.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          <button onClick={onClose} className="btn-primary text-sm w-full">Done</button>
        </div>
      )}

    </ModalShell>
  );
};

export default ImportStepsModal;
