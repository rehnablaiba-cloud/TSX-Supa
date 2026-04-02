import React, { useRef, useEffect, useState, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import ThemeEditor from "../ThemeEditor/ThemeEditorPanel";
import { supabase } from "../../supabase";

// ─── All tables to dump (FK-safe order for SQL inserts) ───────────────────
const ALL_TABLES = [
  "profiles",
  "modules",
  "tests",
  "steps",
  "module_tests",
  "step_results",
  "testlocks",
  "auditlog",
] as const;

type TableName = typeof ALL_TABLES[number];
type AllData   = Record<TableName, Record<string, unknown>[]>;

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const today = () => new Date().toISOString().split("T")[0];

async function fetchAllTables(): Promise<{ data: AllData; errors: string[] }> {
  const data  = {} as AllData;
  const errors: string[] = [];
  await Promise.all(
    ALL_TABLES.map(async (table) => {
      const { data: rows, error } = await supabase.from(table).select("*");
      if (error) errors.push(`${table}: ${error.message}`);
      else data[table] = rows ?? [];
    })
  );
  return { data, errors };
}

function toCsv(rows: Record<string, unknown>[], sep = ","): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(sep) || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(sep), ...rows.map(r => headers.map(h => esc(r[h])).join(sep))].join("\n");
}

function toSql(table: string, rows: Record<string, unknown>[]): string {
  if (!rows.length) return `-- ${table}: no rows\n`;
  const esc = (v: unknown) =>
    v == null ? "NULL"
    : typeof v === "boolean" ? String(v)
    : typeof v === "number"  ? String(v)
    : `'${String(v).replace(/'/g, "''")}'`;
  const cols = Object.keys(rows[0]);
  return rows.map(r =>
    `INSERT INTO public.${table} (${cols.join(", ")}) VALUES (${cols.map(c => esc(r[c])).join(", ")}) ON CONFLICT DO NOTHING;`
  ).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT MODAL
// ─────────────────────────────────────────────────────────────────────────
type ExportFormat = "csv_zip" | "json" | "tsv_zip" | "sql";
const FORMAT_META: { id: ExportFormat; label: string; icon: string; desc: string }[] = [
  { id: "csv_zip", label: "CSV (zip)", icon: "📊", desc: "One CSV per table · re-importable"  },
  { id: "json",    label: "JSON",      icon: "🗂",  desc: "All tables in one nested file"      },
  { id: "tsv_zip", label: "TSV (zip)", icon: "📋",  desc: "Tab-separated · Excel-friendly"    },
  { id: "sql",     label: "SQL",       icon: "🗄",  desc: "INSERT statements · full backup"    },
];
type ExportStage = "idle" | "fetching" | "ready" | "exporting" | "done" | "error";

const ExportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [stage, setStage]   = useState<ExportStage>("idle");
  const [allData, setAllData] = useState<AllData | null>(null);
  const [fetchErrors, setFetchErrors] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>("csv_zip");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const counts = allData ? ALL_TABLES.map(t => ({ table: t, count: allData[t].length })) : null;
  const totalRows = counts?.reduce((s, c) => s + c.count, 0) ?? 0;

  useEffect(() => {
    setStage("fetching");
    fetchAllTables().then(({ data, errors }) => {
      setAllData(data); setFetchErrors(errors);
      setStage(errors.length === ALL_TABLES.length ? "error" : "ready");
    });
  }, []);

  const handleExport = useCallback(async () => {
    if (!allData) return;
    setStage("exporting");
    try {
      const stamp = today();
      if (format === "json") {
        downloadBlob(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), tables: allData }, null, 2)], { type: "application/json" }), `testpro_full_${stamp}.json`);
      } else if (format === "sql") {
        const lines = [`-- TestPro full dump — ${new Date().toLocaleString()}`, `-- Tables: ${ALL_TABLES.join(", ")}`, ""];
        for (const t of ALL_TABLES) lines.push(`-- ── ${t} ─────────────────────────────────────`, toSql(t, allData[t]), "");
        downloadBlob(new Blob([lines.join("\n")], { type: "text/plain" }), `testpro_full_${stamp}.sql`);
      } else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        const sep = format === "tsv_zip" ? "\t" : ",";
        const ext = format === "tsv_zip" ? "tsv" : "csv";
        for (const t of ALL_TABLES) zip.file(`${t}.${ext}`, "\uFEFF" + toCsv(allData[t], sep));
        downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `testpro_full_${stamp}.zip`);
      }
      setStage("done");
    } catch (e: any) { setErrMsg(e?.message ?? "Export failed."); setStage("error"); }
  }, [allData, format]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full md:max-w-md mx-auto bg-bg-surface border-t md:border border-[var(--border-color)] rounded-t-2xl md:rounded-2xl px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden shrink-0" />
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-t-primary">📤 Export All Data</h2>
            <p className="text-xs text-t-muted mt-0.5">
              {stage === "fetching" && "Fetching from Supabase…"}
              {stage === "ready"    && `${ALL_TABLES.length} tables · ${totalRows} rows`}
              {stage === "exporting" && "Building file…"}
              {stage === "done"    && "Download started ✓"}
              {stage === "error"   && "Something went wrong"}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors text-lg shrink-0">✕</button>
        </div>
        {stage === "fetching" && <div className="flex flex-col items-center gap-3 py-8"><div className="w-10 h-10 border-4 border-c-brand border-t-transparent rounded-full animate-spin" /><p className="text-sm text-t-muted">Loading all tables…</p></div>}
        {stage === "error" && errMsg && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{errMsg}</div>}
        {(stage === "ready" || stage === "exporting" || stage === "done") && counts && (
          <>
            {fetchErrors.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 flex flex-col gap-1"><p className="font-semibold">Some tables failed to load:</p>{fetchErrors.map((e, i) => <p key={i}>• {e}</p>)}</div>}
            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="bg-bg-card px-3 py-2 border-b border-[var(--border-color)]"><p className="text-xs font-semibold text-t-muted uppercase tracking-wider">Tables</p></div>
              <div className="divide-y divide-[var(--border-color)]">
                {counts.map(({ table, count }) => (
                  <div key={table} className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm font-mono text-t-secondary">{table}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${count > 0 ? "bg-c-brand-bg text-c-brand" : "bg-bg-card text-t-muted"}`}>{count} rows</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-t-muted font-semibold uppercase tracking-wider">Format</p>
              {FORMAT_META.map(f => (
                <button key={f.id} onClick={() => setFormat(f.id)} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${format === f.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                  <span className="text-xl">{f.icon}</span>
                  <div className="flex-1"><p className={`text-sm font-semibold ${format === f.id ? "text-c-brand" : "text-t-primary"}`}>{f.label}</p><p className="text-xs text-t-muted">{f.desc}</p></div>
                  {format === f.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white text-[10px] font-bold shrink-0">✓</span>}
                </button>
              ))}
            </div>
            <button onClick={handleExport} disabled={stage === "exporting" || stage === "done"} className="btn-primary text-sm w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {stage === "exporting" ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Building…</> : stage === "done" ? <>✓ Downloaded!</> : <>⬇ Download {FORMAT_META.find(f => f.id === format)?.label}</>}
            </button>
            {stage === "done" && <button onClick={onClose} className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">Close</button>}
          </>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// SHARED MODAL SHELL
// ─────────────────────────────────────────────────────────────────────────
const ModalShell: React.FC<{
  title: string; subtitle?: string; icon: string;
  onClose: () => void; children: React.ReactNode;
}> = ({ title, subtitle, icon, onClose, children }) => (
  <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
    <div className="absolute inset-0 bg-black/50" onClick={onClose} />
    <div className="relative w-full md:max-w-md mx-auto bg-bg-surface border-t md:border border-[var(--border-color)] rounded-t-2xl md:rounded-2xl px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
      <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden shrink-0" />
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-bold text-t-primary">{icon} {title}</h2>
          {subtitle && <p className="text-xs text-t-muted mt-0.5">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors text-lg shrink-0">✕</button>
      </div>
      {children}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────
// IMPORT MODULES MODAL — manual entry: name + operation dropdown
// ─────────────────────────────────────────────────────────────────────────
type ModuleOp = "create" | "update" | "delete";
type ModuleImportStage = "form" | "submitting" | "done" | "error";
interface ModuleResult { op: ModuleOp; name: string; success: boolean; message: string; }

const ImportModulesModal: React.FC<{ onClose: () => void; onBack: () => void }> = ({ onClose, onBack }) => {
  const [stage,   setStage]   = useState<ModuleImportStage>("form");
  const [op,      setOp]      = useState<ModuleOp>("create");
  const [name,    setName]    = useState("");
  const [newName, setNewName] = useState("");
  const [results, setResults] = useState<ModuleResult[]>([]);
  const [errMsg,  setErrMsg]  = useState("");

  const opMeta = [
    { id: "create" as ModuleOp, label: "Create", icon: "➕", color: "text-green-400" },
    { id: "update" as ModuleOp, label: "Update", icon: "✏️",  color: "text-c-brand"  },
    { id: "delete" as ModuleOp, label: "Delete", icon: "🗑",  color: "text-red-400"  },
  ];

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setErrMsg("Module name is required."); return; }
    if (op === "update" && !newName.trim()) { setErrMsg("New name is required for Update."); return; }
    setErrMsg(""); setStage("submitting");
    try {
      if (op === "create") {
        const { error } = await supabase.from("modules").insert({ name: trimmedName });
        if (error) throw error;
        setResults([{ op, name: trimmedName, success: true, message: `Module "${trimmedName}" created.` }]);
      } else if (op === "update") {
        const { data: existing, error: fe } = await supabase.from("modules").select("id").eq("name", trimmedName).maybeSingle();
        if (fe) throw fe;
        if (!existing) throw new Error(`No module found with name "${trimmedName}".`);
        const { error } = await supabase.from("modules").update({ name: newName.trim() }).eq("id", existing.id);
        if (error) throw error;
        setResults([{ op, name: trimmedName, success: true, message: `"${trimmedName}" renamed to "${newName.trim()}".` }]);
      } else {
        const { data: existing, error: fe } = await supabase.from("modules").select("id").eq("name", trimmedName).maybeSingle();
        if (fe) throw fe;
        if (!existing) throw new Error(`No module found with name "${trimmedName}".`);
        const { error } = await supabase.from("modules").delete().eq("id", existing.id);
        if (error) throw error;
        setResults([{ op, name: trimmedName, success: true, message: `Module "${trimmedName}" deleted.` }]);
      }
      setStage("done");
    } catch (e: any) {
      setResults([{ op, name: trimmedName, success: false, message: e?.message ?? "Unexpected error." }]);
      setStage("error");
    }
  }, [op, name, newName]);

  const reset = () => { setStage("form"); setName(""); setNewName(""); setErrMsg(""); setResults([]); };

  return (
    <ModalShell icon="📦" title="Import · Modules"
      subtitle={stage === "form" ? "Manage module records" : stage === "submitting" ? "Processing…" : "Complete"}
      onClose={onClose}>
      {(stage === "form" || stage === "error") && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Operation</label>
            <div className="grid grid-cols-3 gap-2">
              {opMeta.map(m => (
                <button key={m.id} onClick={() => { setOp(m.id); setErrMsg(""); }}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${op === m.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                  <span className="text-xl">{m.icon}</span>
                  <span className={`text-xs font-semibold ${op === m.id ? "text-c-brand" : "text-t-secondary"}`}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">
              {op === "update" ? "Current Name" : "Module Name"}
            </label>
            <input type="text" value={name} onChange={e => { setName(e.target.value); setErrMsg(""); }}
              placeholder={op === "delete" ? "Name of module to delete…" : op === "update" ? "Existing module name…" : "Enter module name…"}
              className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
          </div>
          {op === "update" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">New Name</label>
              <input type="text" value={newName} onChange={e => { setNewName(e.target.value); setErrMsg(""); }}
                placeholder="New module name…"
                className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
            </div>
          )}
          {op === "delete" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-start gap-2">
              <span className="text-base leading-none mt-px">⚠️</span>
              <p>This will permanently delete the module and all associated tests &amp; results.</p>
            </div>
          )}
          {(errMsg || stage === "error") && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
              {errMsg || results[0]?.message}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={onBack} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
            <button onClick={handleSubmit} className={`flex-1 btn-primary text-sm ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
              {opMeta.find(m => m.id === op)?.icon} {opMeta.find(m => m.id === op)?.label}
            </button>
          </div>
        </div>
      )}
      {stage === "submitting" && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
          <p className="text-sm text-t-secondary">Processing…</p>
        </div>
      )}
      {stage === "done" && results[0] && (
        <div className="flex flex-col gap-3">
          <div className={`rounded-xl border p-4 text-sm flex items-start gap-3 ${results[0].success ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
            <span className="text-xl leading-none">{results[0].success ? "✅" : "❌"}</span>
            <p className="font-medium">{results[0].message}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Another</button>
            <button onClick={onClose} className="flex-1 btn-primary text-sm">Done</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// IMPORT TESTS MODAL — CSV with sn (float) + name columns
// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
// IMPORT TESTS MODAL — manual: create / update / delete
// ─────────────────────────────────────────────────────────────────────────
type TestOp = "create" | "update" | "delete";
type TestImportStage = "form" | "submitting" | "done" | "error";
interface TestResult { op: TestOp; success: boolean; message: string; }

const ImportTestsModal: React.FC<{ onClose: () => void; onBack: () => void }> = ({ onClose, onBack }) => {
  const [stage,   setStage]   = useState<TestImportStage>("form");
  const [op,      setOp]      = useState<TestOp>("create");
  const [sn,      setSn]      = useState("");
  const [name,    setName]    = useState("");
  const [newName, setNewName] = useState("");
  const [result,  setResult]  = useState<TestResult | null>(null);
  const [errMsg,  setErrMsg]  = useState("");

  const opMeta = [
    { id: "create" as TestOp, label: "Create", icon: "➕" },
    { id: "update" as TestOp, label: "Update", icon: "✏️"  },
    { id: "delete" as TestOp, label: "Delete", icon: "🗑"  },
  ];

  const handleSubmit = useCallback(async () => {
    const snVal = parseFloat(sn);
    if (isNaN(snVal))                              { setErrMsg("Serial number must be a valid number."); return; }
    if (op === "create" && !name.trim())           { setErrMsg("Test name is required."); return; }
    if (op === "update" && !newName.trim())        { setErrMsg("New name is required for Update."); return; }
    setErrMsg(""); setStage("submitting");
    try {
      if (op === "create") {
        const { error } = await supabase.from("tests").insert({ serial_no: snVal, name: name.trim() });
        if (error) throw error;
        setResult({ op, success: true, message: `Test SN ${snVal} "${name.trim()}" created.` });
      } else {
        const { data: existing, error: fe } = await supabase.from("tests").select("id").eq("serial_no", snVal).maybeSingle();
        if (fe) throw fe;
        if (!existing) throw new Error(`No test found with SN ${snVal}.`);
        if (op === "update") {
          const { error } = await supabase.from("tests").update({ name: newName.trim() }).eq("id", existing.id);
          if (error) throw error;
          setResult({ op, success: true, message: `SN ${snVal} renamed to "${newName.trim()}".` });
        } else {
          const { error } = await supabase.from("tests").delete().eq("id", existing.id);
          if (error) throw error;
          setResult({ op, success: true, message: `Test SN ${snVal} deleted.` });
        }
      }
      setStage("done");
    } catch (e: any) {
      setResult({ op, success: false, message: e?.message ?? "Unexpected error." });
      setStage("error");
    }
  }, [op, sn, name, newName]);

  const reset = () => { setStage("form"); setSn(""); setName(""); setNewName(""); setErrMsg(""); setResult(null); };

  return (
    <ModalShell icon="🧪" title="Import · Tests"
      subtitle={stage === "form" ? "Manage test records" : stage === "submitting" ? "Processing…" : "Complete"}
      onClose={onClose}>

      {(stage === "form" || stage === "error") && (
        <div className="flex flex-col gap-4">
          {/* Op selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Operation</label>
            <div className="grid grid-cols-3 gap-2">
              {opMeta.map(m => (
                <button key={m.id} onClick={() => { setOp(m.id); setErrMsg(""); }}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${op === m.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                  <span className="text-xl">{m.icon}</span>
                  <span className={`text-xs font-semibold ${op === m.id ? "text-c-brand" : "text-t-secondary"}`}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Serial No */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Serial No (SN)</label>
            <input type="number" step="0.1" value={sn} onChange={e => { setSn(e.target.value); setErrMsg(""); }}
              placeholder="e.g. 1.1"
              className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
          </div>

          {/* Name field */}
          {op === "create" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Test Name</label>
              <input type="text" value={name} onChange={e => { setName(e.target.value); setErrMsg(""); }}
                placeholder="Enter test name…"
                className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
            </div>
          )}
          {op === "update" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">New Name</label>
              <input type="text" value={newName} onChange={e => { setNewName(e.target.value); setErrMsg(""); }}
                placeholder="Updated test name…"
                className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
            </div>
          )}
          {op === "delete" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-start gap-2">
              <span className="text-base leading-none mt-px">⚠️</span>
              <p>This will permanently delete the test and all associated steps &amp; results.</p>
            </div>
          )}

          {(errMsg || stage === "error") && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
              {errMsg || result?.message}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={onBack} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
            <button onClick={handleSubmit} className={`flex-1 btn-primary text-sm ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
              {opMeta.find(m => m.id === op)?.icon} {opMeta.find(m => m.id === op)?.label}
            </button>
          </div>
        </div>
      )}

      {stage === "submitting" && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
          <p className="text-sm text-t-secondary">Processing…</p>
        </div>
      )}
      {stage === "done" && result && (
        <div className="flex flex-col gap-3">
          <div className={`rounded-xl border p-4 text-sm flex items-start gap-3 ${result.success ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
            <span className="text-xl leading-none">{result.success ? "✅" : "❌"}</span>
            <p className="font-medium">{result.message}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Another</button>
            <button onClick={onClose} className="flex-1 btn-primary text-sm">Done</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// IMPORT STEPS MODAL
// Flow: select test → select op → upload CSV → preview → import
// CSV columns: serial_no, action, expected_result, is_divider
// ─────────────────────────────────────────────────────────────────────────
type StepOp = "create" | "update" | "delete";
type StepImportStage = "select_test" | "select_op" | "upload" | "preview" | "importing" | "done";

interface TestOption { id: string; serial_no: number; name: string; }
interface StepCsvRow { serial_no: number; action: string; expected_result: string; is_divider: boolean; }
interface StepImportSummary { written: number; skipped: number; errors: string[]; }

function parseStepsCsv(text: string): { rows: StepCsvRow[]; errors: string[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const errors: string[] = []; const rows: StepCsvRow[] = [];
  if (lines.length < 2) { errors.push("File is empty."); return { rows, errors }; }
  const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const iSn  = header.indexOf("serial_no");
  const iAct = header.indexOf("action");
  const iRes = header.indexOf("expected_result");
  const iDiv = header.indexOf("is_divider");
  const missing = ([iSn<0&&"serial_no", iAct<0&&"action", iRes<0&&"expected_result", iDiv<0&&"is_divider"] as (string|false)[]).filter(Boolean) as string[];
  if (missing.length) { errors.push(`Missing columns: ${missing.join(", ")}`); return { rows, errors }; }
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim(); if (!raw) continue;
    const cells: string[] = []; let cur = "", inQ = false;
    for (const ch of raw) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; } else cur += ch;
    }
    cells.push(cur.trim());
    const snVal = parseInt(cells[iSn] ?? "", 10);
    if (isNaN(snVal) || snVal < 1) { errors.push(`Row ${i + 1}: invalid serial_no — skipped.`); continue; }
    rows.push({
      serial_no: snVal,
      action: cells[iAct] ?? "",
      expected_result: cells[iRes] ?? "",
      is_divider: /^(true|1|yes)$/i.test(cells[iDiv] ?? ""),
    });
  }
  return { rows, errors };
}

const ImportStepsModal: React.FC<{ onClose: () => void; onBack: () => void }> = ({ onClose, onBack }) => {
  const [stage,        setStage]        = useState<StepImportStage>("select_test");
  const [tests,        setTests]        = useState<TestOption[]>([]);
  const [testsLoading, setTestsLoading] = useState(true);
  const [selectedTest, setSelectedTest] = useState<TestOption | null>(null);
  const [op,           setOp]           = useState<StepOp>("create");
  const [rows,         setRows]         = useState<StepCsvRow[]>([]);
  const [parseErrors,  setParseErrors]  = useState<string[]>([]);
  const [summary,      setSummary]      = useState<StepImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("tests").select("id, serial_no, name").order("serial_no", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setTests(data as TestOption[]);
        setTestsLoading(false);
      });
  }, []);

  const opMeta = [
    { id: "create" as StepOp, label: "Insert",  icon: "➕", desc: "Add new steps from CSV"          },
    { id: "update" as StepOp, label: "Update",  icon: "✏️",  desc: "Overwrite existing steps by SN"  },
    { id: "delete" as StepOp, label: "Delete",  icon: "🗑",  desc: "Remove steps by serial_no"       },
  ];

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows: parsed, errors } = parseStepsCsv(ev.target?.result as string);
      setRows(parsed); setParseErrors(errors); setStage("preview");
    };
    reader.readAsText(file);
    // reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleImport = useCallback(async () => {
    if (!selectedTest) return;
    setStage("importing");
    const result: StepImportSummary = { written: 0, skipped: 0, errors: [] };
    try {
      for (const row of rows) {
        if (op === "create") {
          const { error } = await supabase.from("steps").insert({
            test_id: selectedTest.id, serial_no: row.serial_no,
            action: row.action, expected_result: row.expected_result, is_divider: row.is_divider,
          });
          if (error) { result.errors.push(`SN ${row.serial_no}: ${error.message}`); result.skipped++; }
          else result.written++;
        } else if (op === "update") {
          const { data: existing, error: fe } = await supabase.from("steps")
            .select("id").eq("test_id", selectedTest.id).eq("serial_no", row.serial_no).maybeSingle();
          if (fe || !existing) { result.errors.push(`SN ${row.serial_no}: not found — skipped.`); result.skipped++; continue; }
          const { error } = await supabase.from("steps").update({
            action: row.action, expected_result: row.expected_result, is_divider: row.is_divider,
          }).eq("id", existing.id);
          if (error) { result.errors.push(`SN ${row.serial_no}: ${error.message}`); result.skipped++; }
          else result.written++;
        } else {
          const { data: existing, error: fe } = await supabase.from("steps")
            .select("id").eq("test_id", selectedTest.id).eq("serial_no", row.serial_no).maybeSingle();
          if (fe || !existing) { result.errors.push(`SN ${row.serial_no}: not found — skipped.`); result.skipped++; continue; }
          const { error } = await supabase.from("steps").delete().eq("id", existing.id);
          if (error) { result.errors.push(`SN ${row.serial_no}: ${error.message}`); result.skipped++; }
          else result.written++;
        }
      }
    } catch (e: any) { result.errors.push(e?.message ?? "Unexpected error."); }
    setSummary(result); setStage("done");
  }, [selectedTest, op, rows]);

  const stageLabel = {
    select_test: "Step 1 of 3 — Select test",
    select_op:   "Step 2 of 3 — Choose operation",
    upload:      "Step 3 of 3 — Upload CSV",
    preview:     `${rows.length} rows · ready to ${op}`,
    importing:   "Writing to Supabase…",
    done:        "Import complete",
  }[stage];

  return (
    <ModalShell icon="🔢" title="Import · Steps" subtitle={stageLabel} onClose={onClose}>

      {/* ── STEP 1: select test ─────────────────────────────── */}
      {stage === "select_test" && (
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
                onChange={e => {
                  const t = tests.find(t => t.id === e.target.value) ?? null;
                  setSelectedTest(t);
                }}
                className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm focus:outline-none focus:border-c-brand transition-colors appearance-none cursor-pointer">
                <option value="" disabled>Choose a test…</option>
                {tests.map(t => (
                  <option key={t.id} value={t.id}>SN {t.serial_no} — {t.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Selected test pill */}
          {selectedTest && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-c-brand/30 bg-c-brand-bg">
              <span className="text-xl">🧪</span>
              <div>
                <p className="text-sm font-semibold text-c-brand">{selectedTest.name}</p>
                <p className="text-xs text-t-muted">SN {selectedTest.serial_no}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onBack} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
            <button onClick={() => setStage("select_op")} disabled={!selectedTest}
              className="flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: select operation ─────────────────────────── */}
      {stage === "select_op" && (
        <div className="flex flex-col gap-4">
          {/* Selected test reminder */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-bg-card">
            <span className="text-lg">🧪</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-t-primary truncate">{selectedTest?.name}</p>
              <p className="text-xs text-t-muted">SN {selectedTest?.serial_no}</p>
            </div>
            <button onClick={() => setStage("select_test")} className="text-xs text-c-brand hover:underline shrink-0">Change</button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Operation</label>
            <div className="flex flex-col gap-2">
              {opMeta.map(m => (
                <button key={m.id} onClick={() => setOp(m.id)}
                  className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all text-left ${op === m.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                  <span className="text-xl">{m.icon}</span>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${op === m.id ? "text-c-brand" : "text-t-primary"}`}>{m.label}</p>
                    <p className="text-xs text-t-muted">{m.desc}</p>
                  </div>
                  {op === m.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white text-[10px] font-bold shrink-0">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {op === "delete" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-start gap-2">
              <span className="text-base leading-none mt-px">⚠️</span>
              <p>CSV only needs <code className="font-mono">serial_no</code> column for delete. Other columns are ignored.</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => setStage("select_test")} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
            <button onClick={() => setStage("upload")} className="flex-1 btn-primary text-sm">Next →</button>
          </div>
        </div>
      )}

      {/* ── STEP 3: upload CSV ──────────────────────────────── */}
      {stage === "upload" && (
        <div className="flex flex-col gap-4">
          {/* Context strip */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <span>🧪</span>
            <span className="text-t-primary font-medium truncate">{selectedTest?.name}</span>
            <span className="mx-1 text-t-muted">·</span>
            <span className="text-c-brand font-semibold">{opMeta.find(m => m.id === op)?.label}</span>
          </div>

          {/* Column reference */}
          <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-4 text-xs">
            <p className="text-t-secondary font-semibold mb-2 uppercase tracking-wider">Required columns</p>
            <div className="flex flex-col gap-1.5">
              {(op === "delete"
                ? [["serial_no", "Step serial no. (int)"]]
                : [["serial_no","Step serial no. (int)"],["action","Step action text"],["expected_result","Expected outcome"],["is_divider","true / false"]]
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
              <><p className="text-c-brand">serial_no</p><p>1</p><p>2</p><p>3</p></>
            ) : (
              <><p className="text-c-brand">serial_no,action,expected_result,is_divider</p>
              <p>1,Open login page,Login page loads,false</p>
              <p>2,Enter credentials,Fields accept input,false</p>
              <p>3,Click submit,Dashboard shown,false</p></>
            )}
          </div>

          <button onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-[var(--border-color)] hover:border-c-brand/60 hover:bg-bg-card transition-colors cursor-pointer">
            <span className="text-3xl">📂</span>
            <span className="text-sm font-medium text-t-secondary">Tap to choose CSV file</span>
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />

          <button onClick={() => setStage("select_op")} className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
        </div>
      )}

      {/* ── PREVIEW ─────────────────────────────────────────── */}
      {stage === "preview" && (
        <div className="flex flex-col gap-3">
          {/* Context strip */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <span>🧪</span>
            <span className="text-t-primary font-medium truncate">{selectedTest?.name}</span>
            <span className="mx-1 text-t-muted">·</span>
            <span className="text-c-brand font-semibold">{opMeta.find(m => m.id === op)?.label}</span>
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 flex flex-col gap-1">
              <p className="font-semibold">Warnings ({parseErrors.length}):</p>
              {parseErrors.map((e, i) => <p key={i}>• {e}</p>)}
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
                        <td className="px-2 py-2 font-mono text-c-brand">{r.serial_no}</td>
                        {op !== "delete" && <td className="px-2 py-2 text-t-primary truncate max-w-[160px]">{r.action || <span className="text-t-muted italic">—</span>}</td>}
                        {op !== "delete" && <td className="px-2 py-2 text-center text-t-muted">{r.is_divider ? "✓" : ""}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <button onClick={() => { setStage("upload"); setRows([]); setParseErrors([]); }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
                <button onClick={handleImport}
                  className={`flex-1 btn-primary text-sm ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
                  {opMeta.find(m => m.id === op)?.icon} {opMeta.find(m => m.id === op)?.label} {rows.length} Steps →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── IMPORTING ───────────────────────────────────────── */}
      {stage === "importing" && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
          <p className="text-sm text-t-secondary">Writing to Supabase…</p>
        </div>
      )}

      {/* ── DONE ────────────────────────────────────────────── */}
      {stage === "done" && summary && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Written",  value: summary.written,  color: "text-green-400" },
              { label: "Skipped",  value: summary.skipped,  color: "text-amber-400" },
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
          <button onClick={onClose} className="btn-primary text-sm w-full">Done</button>
        </div>
      )}
    </ModalShell>
  );
};

type ImportTarget = "modules" | "tests" | "steps" | null;

const ImportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [target, setTarget] = useState<ImportTarget>(null);

  if (target === "modules") return <ImportModulesModal onClose={onClose} onBack={() => setTarget(null)} />;
  if (target === "tests")   return <ImportTestsModal   onClose={onClose} onBack={() => setTarget(null)} />;
  if (target === "steps")   return <ImportStepsModal   onClose={onClose} onBack={() => setTarget(null)} />;

  const options: { id: ImportTarget; icon: string; label: string; desc: string; badge: string }[] = [
    { id: "modules", icon: "📦", label: "Modules", desc: "Create · update · delete module records", badge: "Manual" },
    { id: "tests",   icon: "🧪", label: "Tests",   desc: "Manual create · update · delete",          badge: "Manual" },
    { id: "steps",   icon: "🔢", label: "Steps",   desc: "Select test · op · upload CSV",            badge: "CSV"    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full md:max-w-md mx-auto bg-bg-surface border-t md:border border-[var(--border-color)] rounded-t-2xl md:rounded-2xl px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4">
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden" />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-t-primary">📥 Import Data</h2>
            <p className="text-xs text-t-muted mt-0.5">Choose what to import</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors text-lg">✕</button>
        </div>
        <div className="flex flex-col gap-2">
          {options.map(opt => (
            <button key={opt.id as string} onClick={() => setTarget(opt.id)}
              className="flex items-center gap-4 px-4 py-4 rounded-xl bg-bg-card hover:bg-bg-base border border-[var(--border-color)] transition-colors text-left group">
              <span className="text-2xl">{opt.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-t-primary group-hover:text-c-brand transition-colors">{opt.label}</p>
                <p className="text-xs text-t-muted mt-0.5">{opt.desc}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-c-brand-bg text-c-brand border border-c-brand/20 shrink-0">{opt.badge}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// SHEET BUTTON
// ─────────────────────────────────────────────────────────────────────────
const SheetButton: React.FC<{
  icon: string; label: string; desc: string; badge?: string; onClick: () => void;
}> = ({ icon, label, desc, badge, onClick }) => (
  <button onClick={onClick}
    className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-bg-card hover:bg-bg-base border border-[var(--border-color)] transition-colors text-t-primary">
    <span className="text-2xl">{icon}</span>
    <div className="text-left">
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-t-muted">{desc}</p>
    </div>
    {badge && <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-c-brand-bg text-c-brand border border-c-brand/20 shrink-0">{badge}</span>}
  </button>
);

// ─────────────────────────────────────────────────────────────────────────
// MAIN MOBILE NAV
// ─────────────────────────────────────────────────────────────────────────
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
  const [accessDenied, setAccessDenied] = useState<string | null>(null);

  const open = (setter: (v: boolean) => void) => { setShowMore(false); setter(true); };
  const openProtected = (setter: (v: boolean) => void) => {
    setAccessDenied(null);
    if (!user) { setAccessDenied("No user session found. Please sign out and sign in again."); return; }
    if (!isAdmin) { setAccessDenied("Admin access required. Your current role: " + user.defaultRole + "."); return; }
    open(setter);
  };

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
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("touchstart", handler); };
  }, [showMore]);

  return (
    <>
      {showThemeEditor && <ThemeEditor onClose={() => setShowThemeEditor(false)} />}
      {showImport      && <ImportModal  onClose={() => setShowImport(false)} />}
      {showExport      && <ExportModal  onClose={() => setShowExport(false)} />}

      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowMore(false); setAccessDenied(null); }} />
          <div ref={sheetRef} className="relative w-full bg-bg-surface border-t border-[var(--border-color)] rounded-t-2xl px-6 pt-4 pb-10 flex flex-col gap-3 z-10">
            <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mb-2" />
            <SheetButton icon="🎨" label="Theme Editor" desc="Customize colors & palette"      badge="🔒 Admin" onClick={() => openProtected(setShowThemeEditor)} />
            <SheetButton icon="📥" label="Import Data"  desc="Modules · Tests · Steps"          badge="🔒 Admin" onClick={() => openProtected(setShowImport)} />
            <SheetButton icon="📤" label="Export Data"  desc="All tables · CSV · JSON · SQL"    badge="🔒 Admin" onClick={() => openProtected(setShowExport)} />
            {accessDenied && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-start gap-2">
                <span className="text-base leading-none mt-px">🚫</span>
                <p>{accessDenied}</p>
              </div>
            )}
            <button onClick={() => { toggleTheme(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-bg-card hover:bg-bg-base border border-[var(--border-color)] transition-colors text-t-primary">
              <span className="text-2xl">{theme === "dark" ? "☀️" : "🌙"}</span>
              <div className="text-left">
                <p className="text-sm font-semibold">{theme === "dark" ? "Light Mode" : "Dark Mode"}</p>
                <p className="text-xs text-t-muted">Switch appearance</p>
              </div>
            </button>
            <div className="border-t border-[var(--border-color)]" />
            <button onClick={() => { signOut(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20">
              <span className="text-2xl">⎋</span>
              <div className="text-left">
                <p className="text-sm font-semibold">Sign Out</p>
                <p className="text-xs text-red-400/60">Signed in as {user?.email ?? "you"}</p>
              </div>
            </button>
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg-nav backdrop-blur border-t border-[var(--border-color)] flex items-center justify-around px-2 py-2">
        {items.map(item => (
          <button key={item.id} onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors ${activePage === item.id ? "text-c-brand" : "text-t-muted"}`}>
            <span className="text-xl">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
        <button onClick={() => setShowMore(true)}
          className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors ${showMore ? "text-c-brand" : "text-t-muted"}`}>
          <span className="text-xl">•••</span>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
};

export default MobileNav;
