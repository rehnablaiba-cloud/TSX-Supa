import React, { useRef, useEffect, useState, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import ThemeEditor from "../ThemeEditor/ThemeEditorPanel";
import { supabase } from "../../supabase";

// ─── Hardcoded import password ────────────────────────────────────────────────
const IMPORT_PASSWORD = "testpro2024";

// ─── Shared types ─────────────────────────────────────────────────────────────
interface CsvRow {
  test_serial_no:  number;
  test_name:       string;
  step_sn:         number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
}

interface ImportSummary {
  testsInserted: number;
  testsSkipped:  number;
  stepsInserted: number;
  stepsSkipped:  number;
  errors:        string[];
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCsv(text: string): { rows: CsvRow[]; errors: string[] } {
  const lines  = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const errors: string[] = [];
  const rows:   CsvRow[] = [];

  if (lines.length < 2) { errors.push("File appears empty or has no data rows."); return { rows, errors }; }

  const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (n: string) => header.indexOf(n);
  const iTest = col("test_serial_no"), iName = col("test_name"), iSn = col("step_sn"),
        iAct  = col("action"),         iRes  = col("expected_result"), iDiv = col("is_divider");

  const missing = ([iTest < 0 && "test_serial_no", iName < 0 && "test_name",
    iSn < 0 && "step_sn", iAct < 0 && "action", iRes < 0 && "expected_result",
    iDiv < 0 && "is_divider"] as (string | false)[]).filter(Boolean) as string[];

  if (missing.length) { errors.push(`Missing columns: ${missing.join(", ")}`); return { rows, errors }; }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim(); if (!raw) continue;
    const cells: string[] = []; let cur = "", inQ = false;
    for (const ch of raw) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; } else cur += ch;
    }
    cells.push(cur.trim());
    const testSno = parseInt(cells[iTest] ?? "", 10), stepSno = parseInt(cells[iSn] ?? "", 10);
    if (isNaN(testSno) || isNaN(stepSno)) { errors.push(`Row ${i + 1}: invalid serial numbers — skipped.`); continue; }
    rows.push({ test_serial_no: testSno, test_name: cells[iName] ?? "", step_sn: stepSno,
      action: cells[iAct] ?? "", expected_result: cells[iRes] ?? "",
      is_divider: /^(true|1|yes)$/i.test(cells[iDiv] ?? "") });
  }
  return { rows, errors };
}

function groupByTest(rows: CsvRow[]) {
  const map = new Map<number, { name: string; steps: CsvRow[] }>();
  for (const r of rows) {
    if (!map.has(r.test_serial_no)) map.set(r.test_serial_no, { name: r.test_name, steps: [] });
    map.get(r.test_serial_no)!.steps.push(r);
  }
  return map;
}

// ─── Download helper ──────────────────────────────────────────────────────────
function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const today = () => new Date().toISOString().split("T")[0];

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT MODAL
// ─────────────────────────────────────────────────────────────────────────────
type ExportFormat = "csv" | "json" | "tsv" | "sql";

const FORMAT_META: { id: ExportFormat; label: string; icon: string; desc: string }[] = [
  { id: "csv",  label: "CSV",  icon: "📊", desc: "Comma-separated · re-importable" },
  { id: "json", label: "JSON", icon: "🗂", desc: "Structured · tests with steps" },
  { id: "tsv",  label: "TSV",  icon: "📋", desc: "Tab-separated · Excel-friendly" },
  { id: "sql",  label: "SQL",  icon: "🗄", desc: "INSERT statements · portable" },
];

interface ExportRow {
  test_serial_no:  number;
  test_name:       string;
  test_description: string;
  step_sn:         number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
}

const CsvExportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [loading,  setLoading]  = useState(true);
  const [data,     setData]     = useState<ExportRow[]>([]);
  const [error,    setError]    = useState<string | null>(null);
  const [format,   setFormat]   = useState<ExportFormat>("csv");
  const [exporting,setExporting]= useState(false);

  // ── Fetch on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      const { data: tests, error: err } = await supabase
        .from("tests")
        .select("serial_no, name, description, steps(serial_no, action, expected_result, is_divider)")
        .order("serial_no");
      if (err) { setError(err.message); setLoading(false); return; }

      const flat: ExportRow[] = [];
      for (const t of (tests ?? []) as any[]) {
        const steps = [...(t.steps ?? [])].sort((a: any, b: any) => a.serial_no - b.serial_no);
        for (const s of steps) {
          flat.push({
            test_serial_no:   t.serial_no,
            test_name:        t.name,
            test_description: t.description ?? "",
            step_sn:          s.serial_no,
            action:           s.action,
            expected_result:  s.expected_result,
            is_divider:       s.is_divider,
          });
        }
      }
      setData(flat);
      setLoading(false);
    })();
  }, []);

  // ── Export functions ────────────────────────────────────────────────────────
  const exportCsv = useCallback((sep: string, ext: string) => {
    const header = ["test_serial_no","test_name","step_sn","action","expected_result","is_divider"].join(sep);
    const rows = data.map(r =>
      [r.test_serial_no, `"${r.test_name.replace(/"/g,'""')}"`, r.step_sn,
       `"${r.action.replace(/"/g,'""')}"`, `"${r.expected_result.replace(/"/g,'""')}"`,
       r.is_divider].join(sep)
    );
    downloadBlob(
      new Blob(["\uFEFF" + [header, ...rows].join("\n")], { type: "text/plain" }),
      `testpro_export_${today()}.${ext}`
    );
  }, [data]);

  const exportJson = useCallback(() => {
    // Nest steps under each test
    const map = new Map<number, { serial_no: number; name: string; description: string; steps: any[] }>();
    for (const r of data) {
      if (!map.has(r.test_serial_no))
        map.set(r.test_serial_no, { serial_no: r.test_serial_no, name: r.test_name, description: r.test_description, steps: [] });
      map.get(r.test_serial_no)!.steps.push({
        sn: r.step_sn, action: r.action, expected_result: r.expected_result, is_divider: r.is_divider,
      });
    }
    const json = JSON.stringify({ exported_at: new Date().toISOString(), tests: [...map.values()] }, null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), `testpro_export_${today()}.json`);
  }, [data]);

  const exportSql = useCallback(() => {
    const esc = (s: string) => s.replace(/'/g, "''");
    const lines: string[] = [
      "-- TestPro export — " + new Date().toLocaleString(),
      "-- Tests",
    ];
    const testMap = new Map<number, string>();
    for (const r of data) {
      if (!testMap.has(r.test_serial_no)) {
        testMap.set(r.test_serial_no, r.test_name);
        lines.push(
          `INSERT INTO tests (serial_no, name, description) VALUES (${r.test_serial_no}, '${esc(r.test_name)}', '${esc(r.test_description)}') ON CONFLICT (serial_no) DO UPDATE SET name = EXCLUDED.name;`
        );
      }
    }
    lines.push("", "-- Steps");
    for (const r of data) {
      lines.push(
        `INSERT INTO steps (test_id, serial_no, action, expected_result, is_divider)` +
        ` SELECT id, ${r.step_sn}, '${esc(r.action)}', '${esc(r.expected_result)}', ${r.is_divider}` +
        ` FROM tests WHERE serial_no = ${r.test_serial_no}` +
        ` ON CONFLICT (test_id, serial_no) DO UPDATE SET action = EXCLUDED.action, expected_result = EXCLUDED.expected_result, is_divider = EXCLUDED.is_divider;`
      );
    }
    downloadBlob(new Blob([lines.join("\n")], { type: "text/plain" }), `testpro_export_${today()}.sql`);
  }, [data]);

  const handleExport = useCallback(() => {
    setExporting(true);
    try {
      if (format === "csv")  exportCsv(",", "csv");
      if (format === "tsv")  exportCsv("\t", "tsv");
      if (format === "json") exportJson();
      if (format === "sql")  exportSql();
    } finally {
      setTimeout(() => setExporting(false), 600);
    }
  }, [format, exportCsv, exportJson, exportSql]);

  // unique test count
  const testCount = new Set(data.map(r => r.test_serial_no)).size;
  const stepCount = data.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-full md:max-w-md mx-auto
        bg-bg-surface border-t md:border border-[var(--border-color)]
        rounded-t-2xl md:rounded-2xl
        px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4">

        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-t-primary">📤 Export Test Data</h2>
            <p className="text-xs text-t-muted mt-0.5">
              {loading ? "Loading catalog…" : error ? "Failed to load" : `${testCount} tests · ${stepCount} steps`}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full
              text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors text-lg">
            ✕
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10 gap-3">
            <div className="w-8 h-8 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
            <span className="text-sm text-t-muted">Fetching from Supabase…</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400 text-center">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Tests",  value: testCount, color: "text-c-brand" },
                { label: "Steps",  value: stepCount, color: "text-t-primary" },
              ].map(s => (
                <div key={s.label} className="rounded-xl bg-bg-card border border-[var(--border-color)] p-3 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-t-muted mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Format picker */}
            <div className="flex flex-col gap-2">
              <p className="text-xs text-t-muted font-semibold uppercase tracking-wider">Format</p>
              {FORMAT_META.map(f => (
                <button key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
                    ${format === f.id
                      ? "border-c-brand bg-c-brand-bg"
                      : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"
                    }`}>
                  <span className="text-xl">{f.icon}</span>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${format === f.id ? "text-c-brand" : "text-t-primary"}`}>
                      {f.label}
                    </p>
                    <p className="text-xs text-t-muted">{f.desc}</p>
                  </div>
                  {format === f.id && (
                    <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>

            <button
              onClick={handleExport}
              disabled={exporting || data.length === 0}
              className="btn-primary text-sm w-full flex items-center justify-center gap-2
                disabled:opacity-40 disabled:cursor-not-allowed">
              {exporting
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Exporting…</>
                : <>⬇ Download {format.toUpperCase()}</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT MODAL
// ─────────────────────────────────────────────────────────────────────────────
type ImportStep = "password" | "upload" | "preview" | "importing" | "done";

const CsvImportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [step,        setStep]        = useState<ImportStep>("password");
  const [pwInput,     setPwInput]     = useState("");
  const [pwError,     setPwError]     = useState(false);
  const [rows,        setRows]        = useState<CsvRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName,    setFileName]    = useState("");
  const [summary,     setSummary]     = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePasswordSubmit = () => {
    if (pwInput === IMPORT_PASSWORD) { setPwError(false); setStep("upload"); }
    else setPwError(true);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows: parsed, errors } = parseCsv(ev.target?.result as string);
      setRows(parsed); setParseErrors(errors); setStep("preview");
    };
    reader.readAsText(file);
  };

  const grouped   = groupByTest(rows);
  const testCount = grouped.size;
  const stepCount = rows.length;

  const handleImport = useCallback(async () => {
    setStep("importing");
    const result: ImportSummary = { testsInserted: 0, testsSkipped: 0, stepsInserted: 0, stepsSkipped: 0, errors: [] };
    try {
      for (const [serial_no, { name, steps }] of grouped) {
        const { data: testData, error: testErr } = await supabase
          .from("tests")
          .upsert({ serial_no, name }, { onConflict: "serial_no" })
          .select("id").single();
        if (testErr || !testData) {
          result.errors.push(`Test SN ${serial_no}: ${testErr?.message ?? "no id"}`);
          result.testsSkipped++; continue;
        }
        result.testsInserted++;
        for (const s of steps) {
          const { error: stepErr } = await supabase.from("steps").upsert(
            { test_id: testData.id, serial_no: s.step_sn, action: s.action,
              expected_result: s.expected_result, is_divider: s.is_divider },
            { onConflict: "test_id,serial_no" }
          );
          if (stepErr) { result.errors.push(`Step SN ${s.step_sn} in test ${serial_no}: ${stepErr.message}`); result.stepsSkipped++; }
          else result.stepsInserted++;
        }
      }
    } catch (err: any) { result.errors.push(err?.message ?? "Unexpected error."); }
    setSummary(result); setStep("done");
  }, [grouped]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full md:max-w-md mx-auto
        bg-bg-surface border-t md:border border-[var(--border-color)]
        rounded-t-2xl md:rounded-2xl px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4">

        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden" />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-t-primary">📥 Import Test Data</h2>
            <p className="text-xs text-t-muted mt-0.5">
              {step === "password"  && "Enter import password to continue"}
              {step === "upload"    && "Upload a CSV file"}
              {step === "preview"   && `${testCount} tests · ${stepCount} steps`}
              {step === "importing" && "Writing to Supabase…"}
              {step === "done"      && "Import complete"}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full
              text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors text-lg">✕</button>
        </div>

        {/* Password */}
        {step === "password" && (
          <div className="flex flex-col gap-3">
            <input type="password" value={pwInput} autoFocus
              onChange={e => { setPwInput(e.target.value); setPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handlePasswordSubmit()}
              placeholder="Import password"
              className={`input text-sm ${pwError ? "border-red-500 ring-1 ring-red-500/30" : ""}`} />
            {pwError && <p className="text-xs text-red-400">Incorrect password.</p>}
            <button onClick={handlePasswordSubmit} className="btn-primary text-sm w-full">Unlock →</button>
          </div>
        )}

        {/* Upload */}
        {step === "upload" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-3 text-xs text-t-muted font-mono leading-relaxed">
              <p className="text-t-secondary font-semibold mb-1">Required CSV columns:</p>
              test_serial_no, test_name, step_sn,<br />action, expected_result, is_divider
            </div>
            <button onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center gap-2 p-6 rounded-xl
                border-2 border-dashed border-[var(--border-color)]
                hover:border-c-brand/60 hover:bg-bg-card transition-colors cursor-pointer">
              <span className="text-3xl">📂</span>
              <span className="text-sm font-medium text-t-secondary">Tap to choose CSV file</span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>
        )}

        {/* Preview */}
        {step === "preview" && (
          <div className="flex flex-col gap-3">
            {parseErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 flex flex-col gap-1">
                <p className="font-semibold">Parse warnings:</p>
                {parseErrors.map((e, i) => <p key={i}>• {e}</p>)}
              </div>
            )}
            {rows.length === 0 ? (
              <p className="text-sm text-red-400 text-center py-4">No valid rows found.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[{ label: "Tests", value: testCount, color: "text-c-brand" },
                    { label: "Steps", value: stepCount, color: "text-t-primary" }].map(s => (
                    <div key={s.label} className="rounded-xl bg-bg-card border border-[var(--border-color)] p-3 text-center">
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-t-muted mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-[var(--border-color)] overflow-hidden max-h-52 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-bg-card sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left text-t-muted">SN</th>
                        <th className="px-2 py-2 text-left text-t-muted">Test</th>
                        <th className="px-2 py-2 text-center text-t-muted">Steps</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-color)]">
                      {[...grouped.entries()].map(([sno, { name, steps }]) => (
                        <tr key={sno} className="hover:bg-bg-card transition-colors">
                          <td className="px-2 py-2 font-mono text-t-muted">#{sno}</td>
                          <td className="px-2 py-2 text-t-primary font-medium truncate max-w-[140px]">{name}</td>
                          <td className="px-2 py-2 text-center text-t-secondary">{steps.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setStep("upload"); setRows([]); setParseErrors([]); }}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)]
                      text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
                  <button onClick={handleImport} className="flex-1 btn-primary text-sm">Import →</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Importing */}
        {step === "importing" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
            <p className="text-sm text-t-secondary">Importing to Supabase…</p>
          </div>
        )}

        {/* Done */}
        {step === "done" && summary && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              {[{ label: "Tests written",  value: summary.testsInserted,  color: "text-green-400" },
                { label: "Tests skipped",  value: summary.testsSkipped,   color: "text-amber-400" },
                { label: "Steps written",  value: summary.stepsInserted,  color: "text-green-400" },
                { label: "Steps skipped",  value: summary.stepsSkipped,   color: "text-amber-400" }].map(s => (
                <div key={s.label} className="rounded-xl bg-bg-card border border-[var(--border-color)] p-3 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-t-muted mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            {summary.errors.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 max-h-32 overflow-y-auto flex flex-col gap-1">
                <p className="font-semibold">Errors ({summary.errors.length}):</p>
                {summary.errors.map((e, i) => <p key={i}>• {e}</p>)}
              </div>
            )}
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-400 text-center">
              ✓ Triggers auto-populate module_tests &amp; step_results
            </div>
            <button onClick={onClose} className="btn-primary text-sm w-full">Done</button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN MOBILE NAV
// ─────────────────────────────────────────────────────────────────────────────
interface Props { activePage: string; onNavigate: (page: string) => void; }

const MobileNav: React.FC<Props> = ({ activePage, onNavigate }) => {
  const { user, signOut }      = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showMore,        setShowMore]        = useState(false);
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [showImport,      setShowImport]      = useState(false);
  const [showExport,      setShowExport]      = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.defaultRole === "admin";
  const items = [
    { id: "dashboard", icon: "📊", label: "Home"   },
    { id: "report",    icon: "📋", label: "Report" },
    { id: "auditlog",  icon: "📜", label: "Audit"  },
    ...(isAdmin ? [{ id: "users", icon: "👥", label: "Users" }] : []),
  ];

  useEffect(() => {
    if (!showMore) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) setShowMore(false);
    };
    document.addEventListener("mousedown",  handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown",  handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [showMore]);

  const openSheet = (setter: (v: boolean) => void) => { setShowMore(false); setter(true); };

  return (
    <>
      {showThemeEditor && <ThemeEditor onClose={() => setShowThemeEditor(false)} />}
      {showImport      && <CsvImportModal onClose={() => setShowImport(false)} />}
      {showExport      && <CsvExportModal onClose={() => setShowExport(false)} />}

      {/* ── More sheet ── */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMore(false)} />
          <div ref={sheetRef}
            className="relative w-full bg-bg-surface border-t border-[var(--border-color)]
              rounded-t-2xl px-6 pt-4 pb-10 flex flex-col gap-3 z-10">
            <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mb-2" />

            {/* Theme Editor */}
            <SheetButton icon="🎨" label="Theme Editor" desc="Customize colors & palette"
              badge="🔒 Admin" onClick={() => openSheet(setShowThemeEditor)} />

            {/* Import */}
            <SheetButton icon="📥" label="Import Data" desc="Upload tests via CSV"
              badge="🔒 PW" onClick={() => openSheet(setShowImport)} />

            {/* Export */}
            <SheetButton icon="📤" label="Export Data" desc="Download CSV · JSON · TSV · SQL"
              onClick={() => openSheet(setShowExport)} />

            {/* Theme toggle */}
            <button onClick={() => { toggleTheme(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-bg-card hover:bg-bg-base
                border border-[var(--border-color)] transition-colors text-t-primary">
              <span className="text-2xl">{theme === "dark" ? "☀️" : "🌙"}</span>
              <div className="text-left">
                <p className="text-sm font-semibold">{theme === "dark" ? "Light Mode" : "Dark Mode"}</p>
                <p className="text-xs text-t-muted">Switch appearance</p>
              </div>
            </button>

            <div className="border-t border-[var(--border-color)]" />

            {/* Sign out */}
            <button onClick={() => { signOut(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl
                bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20
                transition-colors text-red-600 dark:text-red-400
                border border-red-200 dark:border-red-500/20">
              <span className="text-2xl">⎋</span>
              <div className="text-left">
                <p className="text-sm font-semibold">Sign Out</p>
                <p className="text-xs text-red-400/60">Signed in as {user?.email ?? "you"}</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg-nav backdrop-blur
        border-t border-[var(--border-color)] flex items-center justify-around px-2 py-2">
        {items.map(item => (
          <button key={item.id} onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors
              ${activePage === item.id ? "text-c-brand" : "text-t-muted"}`}>
            <span className="text-xl">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
        <button onClick={() => setShowMore(true)}
          className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors
            ${showMore ? "text-c-brand" : "text-t-muted"}`}>
          <span className="text-xl">•••</span>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
};

// ── Reusable sheet row ────────────────────────────────────────────────────────
const SheetButton: React.FC<{
  icon: string; label: string; desc: string; badge?: string; onClick: () => void;
}> = ({ icon, label, desc, badge, onClick }) => (
  <button onClick={onClick}
    className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-bg-card hover:bg-bg-base
      border border-[var(--border-color)] transition-colors text-t-primary">
    <span className="text-2xl">{icon}</span>
    <div className="text-left">
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-t-muted">{desc}</p>
    </div>
    {badge && (
      <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-c-brand-bg text-c-brand border border-c-brand/20">
        {badge}
      </span>
    )}
  </button>
);

export default MobileNav;
