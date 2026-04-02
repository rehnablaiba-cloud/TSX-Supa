import React, { useRef, useEffect, useState, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import ThemeEditor from "../ThemeEditor/ThemeEditorPanel";
import { supabase } from "../../supabase";

// ─── Hardcoded import password ────────────────────────────────────────────────
const IMPORT_PASSWORD = "testpro2024";

// ─── CSV row after parsing ────────────────────────────────────────────────────
interface CsvRow {
  test_serial_no: number;
  test_name:      string;
  step_sn:        number;
  action:         string;
  expected_result: string;
  is_divider:     boolean;
}

// ─── Import result summary ────────────────────────────────────────────────────
interface ImportSummary {
  testsInserted:  number;
  testsSkipped:   number;
  stepsInserted:  number;
  stepsSkipped:   number;
  errors:         string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseCsv(text: string): { rows: CsvRow[]; errors: string[] } {
  const lines  = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const errors: string[] = [];
  const rows:   CsvRow[] = [];

  if (lines.length < 2) {
    errors.push("File appears empty or has no data rows.");
    return { rows, errors };
  }

  // Normalise header
  const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);

  const iTest  = col("test_serial_no");
  const iName  = col("test_name");
  const iSn    = col("step_sn");
  const iAct   = col("action");
  const iRes   = col("expected_result");
  const iDiv   = col("is_divider");

  const missing = (
    [iTest < 0 && "test_serial_no", iName < 0 && "test_name",
     iSn < 0 && "step_sn",         iAct < 0 && "action",
     iRes < 0 && "expected_result", iDiv < 0 && "is_divider"]
  ).filter(Boolean) as string[];

  if (missing.length) {
    errors.push(`Missing columns: ${missing.join(", ")}`);
    return { rows, errors };
  }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    // Minimal CSV split (handles quoted commas)
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (const ch of raw) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());

    const testSno = parseInt(cells[iTest] ?? "", 10);
    const stepSno = parseInt(cells[iSn]   ?? "", 10);

    if (isNaN(testSno) || isNaN(stepSno)) {
      errors.push(`Row ${i + 1}: invalid test_serial_no or step_sn — skipped.`);
      continue;
    }

    rows.push({
      test_serial_no:  testSno,
      test_name:       cells[iName] ?? "",
      step_sn:         stepSno,
      action:          cells[iAct]  ?? "",
      expected_result: cells[iRes]  ?? "",
      is_divider:      /^(true|1|yes)$/i.test(cells[iDiv] ?? ""),
    });
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

// ─── Import modal ─────────────────────────────────────────────────────────────
type ImportStep = "password" | "upload" | "preview" | "importing" | "done";

const CsvImportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [step,        setStep]        = useState<ImportStep>("password");
  const [pwInput,     setPwInput]     = useState("");
  const [pwError,     setPwError]     = useState(false);
  const [rows,        setRows]        = useState<CsvRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName,    setFileName]    = useState("");
  const [summary,     setSummary]     = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePasswordSubmit = () => {
    if (pwInput === IMPORT_PASSWORD) { setPwError(false); setStep("upload"); }
    else { setPwError(true); }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows: parsed, errors } = parseCsv(text);
      setRows(parsed);
      setParseErrors(errors);
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const grouped     = groupByTest(rows);
  const testCount   = grouped.size;
  const stepCount   = rows.length;

  const handleImport = useCallback(async () => {
    setStep("importing");
    setImportError(null);

    const result: ImportSummary = { testsInserted: 0, testsSkipped: 0, stepsInserted: 0, stepsSkipped: 0, errors: [] };

    try {
      for (const [serial_no, { name, steps }] of grouped) {
        // Upsert test — on conflict serial_no update name
        const { data: testData, error: testErr } = await supabase
          .from("tests")
          .upsert({ serial_no, name }, { onConflict: "serial_no" })
          .select("id")
          .single();

        if (testErr || !testData) {
          result.errors.push(`Test SN ${serial_no} ("${name}"): ${testErr?.message ?? "no id returned"}`);
          result.testsSkipped++;
          continue;
        }

        result.testsInserted++;
        const testId = testData.id;

        for (const s of steps) {
          const { error: stepErr } = await supabase
            .from("steps")
            .upsert(
              {
                test_id:         testId,
                serial_no:       s.step_sn,
                action:          s.action,
                expected_result: s.expected_result,
                is_divider:      s.is_divider,
              },
              { onConflict: "test_id,serial_no" }
            );

          if (stepErr) {
            result.errors.push(`Step SN ${s.step_sn} in test ${serial_no}: ${stepErr.message}`);
            result.stepsSkipped++;
          } else {
            result.stepsInserted++;
          }
        }
      }
    } catch (err: any) {
      result.errors.push(err?.message ?? "Unexpected error.");
    }

    setSummary(result);
    setStep("done");
  }, [grouped]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full md:max-w-md mx-auto
        bg-bg-surface border-t md:border border-[var(--border-color)]
        rounded-t-2xl md:rounded-2xl
        px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4">

        {/* Handle (mobile) */}
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-t-primary">📥 Import Test Data</h2>
            <p className="text-xs text-t-muted mt-0.5">
              {step === "password" && "Enter import password to continue"}
              {step === "upload"   && "Upload a CSV file"}
              {step === "preview"  && `${testCount} tests · ${stepCount} steps`}
              {step === "importing" && "Writing to Supabase…"}
              {step === "done"     && "Import complete"}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full
              text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors text-lg">
            ✕
          </button>
        </div>

        {/* ── Password step ── */}
        {step === "password" && (
          <div className="flex flex-col gap-3">
            <input
              type="password"
              value={pwInput}
              onChange={e => { setPwInput(e.target.value); setPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handlePasswordSubmit()}
              placeholder="Import password"
              autoFocus
              className={`input text-sm ${pwError ? "border-red-500 ring-1 ring-red-500/30" : ""}`}
            />
            {pwError && (
              <p className="text-xs text-red-400">Incorrect password.</p>
            )}
            <button onClick={handlePasswordSubmit} className="btn-primary text-sm w-full">
              Unlock →
            </button>
          </div>
        )}

        {/* ── Upload step ── */}
        {step === "upload" && (
          <div className="flex flex-col gap-4">
            {/* Format hint */}
            <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-3 text-xs text-t-muted font-mono leading-relaxed">
              <p className="text-t-secondary font-semibold mb-1">Required CSV columns:</p>
              test_serial_no, test_name, step_sn,<br />
              action, expected_result, is_divider
            </div>

            <button
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center gap-2 p-6 rounded-xl
                border-2 border-dashed border-[var(--border-color)]
                hover:border-c-brand/60 hover:bg-bg-card
                transition-colors text-t-muted cursor-pointer">
              <span className="text-3xl">📂</span>
              <span className="text-sm font-medium text-t-secondary">Tap to choose CSV file</span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv"
              className="hidden" onChange={handleFile} />
          </div>
        )}

        {/* ── Preview step ── */}
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

                {/* Preview table */}
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
                      text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
                    ← Back
                  </button>
                  <button onClick={handleImport}
                    className="flex-1 btn-primary text-sm">
                    Import →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Importing ── */}
        {step === "importing" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
            <p className="text-sm text-t-secondary">Importing to Supabase…</p>
          </div>
        )}

        {/* ── Done ── */}
        {step === "done" && summary && (
          <div className="flex flex-col gap-3">
            {importError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                {importError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Tests written",  value: summary.testsInserted,  color: "text-green-400" },
                { label: "Tests skipped",  value: summary.testsSkipped,   color: "text-amber-400" },
                { label: "Steps written",  value: summary.stepsInserted,  color: "text-green-400" },
                { label: "Steps skipped",  value: summary.stepsSkipped,   color: "text-amber-400" },
              ].map(s => (
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
              ✓ Triggers will auto-populate module_tests & step_results
            </div>

            <button onClick={onClose} className="btn-primary text-sm w-full">Done</button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main MobileNav ───────────────────────────────────────────────────────────
interface Props { activePage: string; onNavigate: (page: string) => void; }

const MobileNav: React.FC<Props> = ({ activePage, onNavigate }) => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showMore,        setShowMore]        = useState(false);
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [showImport,      setShowImport]      = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.defaultRole === "admin";

  const items = [
    { id: "dashboard", icon: "📊", label: "Home" },
    { id: "report",    icon: "📋", label: "Report" },
    { id: "auditlog",  icon: "📜", label: "Audit" },
    ...(isAdmin ? [{ id: "users", icon: "👥", label: "Users" }] : []),
  ];

  useEffect(() => {
    if (!showMore) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [showMore]);

  return (
    <>
      {showThemeEditor && <ThemeEditor onClose={() => setShowThemeEditor(false)} />}
      {showImport      && <CsvImportModal onClose={() => setShowImport(false)} />}

      {/* ── More sheet ── */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMore(false)} />

          <div
            ref={sheetRef}
            className="relative w-full
              bg-bg-surface
              border-t border-[var(--border-color)]
              rounded-t-2xl px-6 pt-4 pb-10 flex flex-col gap-3 z-10"
          >
            <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mb-2" />

            {/* 🎨 Theme Editor */}
            <button
              onClick={() => { setShowMore(false); setShowThemeEditor(true); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl
                bg-bg-card hover:bg-bg-base
                border border-[var(--border-color)]
                transition-colors text-t-primary"
            >
              <span className="text-2xl">🎨</span>
              <div className="text-left">
                <p className="text-sm font-semibold">Theme Editor</p>
                <p className="text-xs text-t-muted">Customize colors & palette</p>
              </div>
              <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-c-brand-bg text-c-brand border border-c-brand/20">
                🔒 Admin
              </span>
            </button>

            {/* 📥 CSV Import */}
            <button
              onClick={() => { setShowMore(false); setShowImport(true); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl
                bg-bg-card hover:bg-bg-base
                border border-[var(--border-color)]
                transition-colors text-t-primary"
            >
              <span className="text-2xl">📥</span>
              <div className="text-left">
                <p className="text-sm font-semibold">Import Data</p>
                <p className="text-xs text-t-muted">Upload tests via CSV</p>
              </div>
              <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-c-brand-bg text-c-brand border border-c-brand/20">
                🔒 PW
              </span>
            </button>

            {/* Theme toggle */}
            <button
              onClick={() => { toggleTheme(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl
                bg-bg-card hover:bg-bg-base
                border border-[var(--border-color)]
                transition-colors text-t-primary"
            >
              <span className="text-2xl">{theme === "dark" ? "☀️" : "🌙"}</span>
              <div className="text-left">
                <p className="text-sm font-semibold">
                  {theme === "dark" ? "Light Mode" : "Dark Mode"}
                </p>
                <p className="text-xs text-t-muted">Switch appearance</p>
              </div>
            </button>

            <div className="border-t border-[var(--border-color)]" />

            {/* Sign out */}
            <button
              onClick={() => { signOut(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl
                bg-red-50 dark:bg-red-500/10
                hover:bg-red-100 dark:hover:bg-red-500/20
                transition-colors text-red-600 dark:text-red-400
                border border-red-200 dark:border-red-500/20"
            >
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40
        bg-bg-nav backdrop-blur
        border-t border-[var(--border-color)]
        flex items-center justify-around px-2 py-2">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors
              ${activePage === item.id ? "text-c-brand" : "text-t-muted"}`}
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}

        <button
          onClick={() => setShowMore(true)}
          className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors
            ${showMore ? "text-c-brand" : "text-t-muted"}`}
        >
          <span className="text-xl">•••</span>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
};

export default MobileNav;
