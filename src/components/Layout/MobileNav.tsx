import React, { useRef, useEffect, useState, useCallback } from "react";

import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { supabase } from "../../supabase";
import ThemeEditor from "../ThemeEditor/ThemeEditorPanel";
import {
  BarChart2, FileJson, Table2, Database,
  Package, FlaskConical, Hash, FolderOpen,
  Plus, Pencil, Trash2,
  AlertTriangle, XCircle, CheckCircle, Check, X,
  Upload, Download, Settings, Palette,
  Sun, Moon, LogOut, Minus,
  Users, ScrollText, MoreHorizontal, LayoutDashboard, ClipboardList,
} from "lucide-react";

// ─── All tables to dump (FK-safe order for SQL inserts) ───────────────────
const ALL_TABLES = [
  "profiles",
  "modules",
  "tests",
  "test_steps",
  "module_tests",
  "step_results",
  "test_locks",
  "audit_log",
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
  const data   = {} as AllData;
  const errors: string[] = [];
  await Promise.all(
    ALL_TABLES.map(async (table) => {
      const { data: rows, error } = await supabase.from(table).select("*");
      if (error) errors.push(`${table}: ${error.message}`);
      else        data[table] = rows ?? [];
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
    v == null             ? "NULL"
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
const FORMAT_META: { id: ExportFormat; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "csv_zip", label: "CSV (zip)", icon: <BarChart2 size={20} />, desc: "One CSV per table · re-importable"  },
  { id: "json",    label: "JSON",      icon: <FileJson size={20} />,  desc: "All tables in one nested file"      },
  { id: "tsv_zip", label: "TSV (zip)", icon: <Table2 size={20} />,  desc: "Tab-separated · Excel-friendly"    },
  { id: "sql",     label: "SQL",       icon: <Database size={20} />,  desc: "INSERT statements · full backup"    },
];
type ExportStage = "idle" | "fetching" | "ready" | "exporting" | "done" | "error";

const ExportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [stage,       setStage]       = useState<ExportStage>("idle");
  const [allData,     setAllData]     = useState<AllData | null>(null);
  const [fetchErrors, setFetchErrors] = useState<string[]>([]);
  const [format,      setFormat]      = useState<ExportFormat>("csv_zip");
  const [errMsg,      setErrMsg]      = useState<string | null>(null);

  const counts    = allData ? ALL_TABLES.map(t => ({ table: t, count: allData[t].length })) : null;
  const totalRows = counts?.reduce((s, c) => s + c.count, 0) ?? 0;

  useEffect(() => {
    let mounted = true;
    setStage("fetching");
    fetchAllTables().then(({ data, errors }) => {
      if (!mounted) return;
      setAllData(data);
      setFetchErrors(errors);
      setStage(errors.length === ALL_TABLES.length ? "error" : "ready");
    });
    return () => { mounted = false; };
  }, []);

  const handleExport = useCallback(async () => {
    if (!allData) return;
    setStage("exporting");
    try {
      const stamp = today();
      if (format === "json") {
        downloadBlob(
          new Blob([JSON.stringify({ exported_at: new Date().toISOString(), tables: allData }, null, 2)], { type: "application/json" }),
          `testpro_full_${stamp}.json`
        );
      } else if (format === "sql") {
        const lines = [`-- TestPro full dump — ${new Date().toLocaleString()}`, `-- Tables: ${ALL_TABLES.join(", ")}`, ""];
        for (const t of ALL_TABLES) lines.push(`-- ── ${t} ─────────────────────────────────────`, toSql(t, allData[t]), "");
        downloadBlob(new Blob([lines.join("\n")], { type: "text/plain" }), `testpro_full_${stamp}.sql`);
      } else {
        const JSZip = (await import("jszip")).default;
        const zip   = new JSZip();
        const sep   = format === "tsv_zip" ? "\t" : ",";
        const ext   = format === "tsv_zip" ? "tsv" : "csv";
        for (const t of ALL_TABLES) zip.file(`${t}.${ext}`, "\uFEFF" + toCsv(allData[t], sep));
        downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `testpro_full_${stamp}.zip`);
      }
      setStage("done");
    } catch (e: any) { setErrMsg(e?.message ?? "Export failed."); setStage("error"); }
  }, [allData, format]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full md:max-w-md mx-auto bg-bg-surface/80 backdrop-blur-md border-t md:border border-[var(--border-color)] rounded-t-2xl md:rounded-2xl px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden shrink-0" />
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-t-primary flex items-center gap-1.5"><Upload size={16} />Export All Data</h2>
            <p className="text-xs text-t-muted mt-0.5">
              {stage === "fetching"  && "Fetching from Supabase…"}
              {stage === "ready"     && `${ALL_TABLES.length} tables · ${totalRows} rows`}
              {stage === "exporting" && "Building file…"}
              {stage === "done"      && "Download started ✓"}
              {stage === "error"     && "Something went wrong"}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors shrink-0"><X size={16} /></button>
        </div>

        {stage === "fetching" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="w-10 h-10 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-t-muted">Loading all tables…</p>
          </div>
        )}

        {stage === "error" && errMsg && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{errMsg}</div>
        )}

        {(stage === "ready" || stage === "exporting" || stage === "done") && counts && (
          <>
            {fetchErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 flex flex-col gap-1">
                <p className="font-semibold">Some tables failed to load:</p>
                {fetchErrors.map((e, i) => <p key={i}>• {e}</p>)}
              </div>
            )}

            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="bg-bg-card px-3 py-2 border-b border-[var(--border-color)]">
                <p className="text-xs font-semibold text-t-muted uppercase tracking-wider">Tables</p>
              </div>
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
                <button key={f.id} onClick={() => setFormat(f.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${format === f.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                  {f.icon}
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${format === f.id ? "text-c-brand" : "text-t-primary"}`}>{f.label}</p>
                    <p className="text-xs text-t-muted">{f.desc}</p>
                  </div>
                  {format === f.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
                </button>
              ))}
            </div>

            <button onClick={handleExport} disabled={stage === "exporting" || stage === "done"}
              className="btn-primary text-sm w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {stage === "exporting"
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Building…</>
                : stage === "done"
                ? <><Check size={14} /> Downloaded!</>
                : <><Download size={14} /> Download {FORMAT_META.find(f => f.id === format)?.label}</>}
            </button>
            {stage === "done" && (
              <button onClick={onClose} className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">Close</button>
            )}
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
  title: string; subtitle?: string; icon: React.ReactNode;
  onClose: () => void; children: React.ReactNode;
}> = ({ title, subtitle, icon, onClose, children }) => (
  <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
    <div className="absolute inset-0 bg-black/50" onClick={onClose} />
    <div className="relative w-full md:max-w-md mx-auto bg-bg-surface/80 backdrop-blur-md border-t md:border border-[var(--border-color)] rounded-t-2xl md:rounded-2xl px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
      <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden shrink-0" />
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-bold text-t-primary flex items-center gap-1.5">{icon}{title}</h2>
          {subtitle && <p className="text-xs text-t-muted mt-0.5">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors shrink-0"><X size={16} /></button>
      </div>
      {children}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────
// SHARED TYPES + HELPERS
// ─────────────────────────────────────────────────────────────────────────
interface TestOption   { serial_no: number; name: string; }
interface ModuleOption { name: string; }

const Row: React.FC<{ label: string; value: string; mono?: boolean; brand?: boolean }> = ({ label, value, mono, brand }) => (
  <div className="flex gap-2">
    <span className="text-t-muted w-20 shrink-0">{label}:</span>
    <span className={`${mono ? "font-mono font-bold" : ""} ${brand ? "text-c-brand" : "text-t-primary"} break-all`}>{value}</span>
  </div>
);

const DiffRow: React.FC<{ label: string; before: string; after: string }> = ({ label, before, after }) => {
  const changed = before !== after;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-t-muted">{label}:</span>
      {changed ? (
        <div className="pl-2 flex flex-col gap-0.5">
          <span className="text-red-400 line-through break-all">{before || "(empty)"}</span>
          <span className="text-green-400 break-all">→ {after || "(empty)"}</span>
        </div>
      ) : (
        <span className="pl-2 text-t-muted italic">unchanged</span>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// IMPORT MODULES MODAL
// ─────────────────────────────────────────────────────────────────────────
type ModuleOp          = "create" | "update" | "delete";
type ModuleManualStage = "select_op" | "select_module" | "fill_form" | "confirm" | "submitting" | "done";

const MODULE_OP_META = [
  { id: "create" as ModuleOp, label: "Create", icon: <Plus size={20} />,   desc: "Add a new module"             },
  { id: "update" as ModuleOp, label: "Update", icon: <Pencil size={20} />, desc: "Rename an existing module"    },
  { id: "delete" as ModuleOp, label: "Delete", icon: <Trash2 size={20} />, desc: "Remove a module permanently"  },
];

const STAGE_SUBTITLE_MODULE: Record<ModuleManualStage, (op: ModuleOp) => string> = {
  select_op:     ()   => "Choose operation",
  select_module: ()   => "Select module",
  fill_form:     (op) => op === "create" ? "Enter module name" : "Edit module name",
  confirm:       ()   => "Review & confirm",
  submitting:    ()   => "Processing…",
  done:          ()   => "Complete",
};

const ImportModulesModal: React.FC<{ onClose: () => void; onBack: () => void }> = ({ onClose, onBack }) => {
  const [stage,       setStage]       = useState<ModuleManualStage>("select_op");
  const [op,          setOp]          = useState<ModuleOp>("create");
  const [modules,     setModules]     = useState<ModuleOption[]>([]);
  const [loadingMods, setLoadingMods] = useState(false);
  const [selectedMod, setSelectedMod] = useState<ModuleOption | null>(null);
  const [form,        setForm]        = useState({ name: "" });
  const [errMsg,      setErrMsg]      = useState("");
  const [resultMsg,   setResultMsg]   = useState("");

  useEffect(() => {
    if (stage !== "select_module") return;
    setLoadingMods(true);
    supabase.from("modules").select("name").order("name")
      .then(({ data }) => { if (data) setModules(data as ModuleOption[]); setLoadingMods(false); });
  }, [stage]);

  const handleSubmit = useCallback(async () => {
    setStage("submitting"); setErrMsg("");
    try {
      if (op === "create") {
        const trimmed = form.name.trim();
        if (!trimmed) throw new Error("Module name is required.");
        const { error } = await supabase.from("modules").insert({ name: trimmed });
        if (error) throw error;
        setResultMsg(`Module "${trimmed}" created successfully.`);
      } else if (op === "update") {
        if (!selectedMod) throw new Error("No module selected.");
        const newName = form.name.trim();
        if (!newName) throw new Error("New name is required.");
        const { error } = await supabase.from("modules").update({ name: newName }).eq("name", selectedMod.name);
        if (error) throw error;
        setResultMsg(`"${selectedMod.name}" renamed to "${newName}".`);
      } else {
        if (!selectedMod) throw new Error("No module selected.");
        const { error } = await supabase.from("modules").delete().eq("name", selectedMod.name);
        if (error) throw error;
        setResultMsg(`Module "${selectedMod.name}" deleted.`);
      }
      setStage("done");
    } catch (e: any) { setErrMsg(e?.message ?? "Unexpected error."); setStage("confirm"); }
  }, [op, form, selectedMod]);

  const resetAll = useCallback(() => {
    setStage("select_op"); setSelectedMod(null); setForm({ name: "" }); setResultMsg(""); setErrMsg("");
  }, []);

  const subtitle = STAGE_SUBTITLE_MODULE[stage](op);

  if (stage === "select_op") return (
    <ModalShell icon={<Package size={16} />} title="Import · Modules" subtitle={subtitle} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {MODULE_OP_META.map(m => (
            <button key={m.id} onClick={() => setOp(m.id)}
              className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all text-left ${op === m.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
              {m.icon}
              <div className="flex-1">
                <p className={`text-sm font-semibold ${op === m.id ? "text-c-brand" : "text-t-primary"}`}>{m.label}</p>
                <p className="text-xs text-t-muted">{m.desc}</p>
              </div>
              {op === m.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onBack} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button onClick={() => op === "create" ? (setForm({ name: "" }), setStage("fill_form")) : setStage("select_module")}
            className="flex-1 btn-primary text-sm">Next →</button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "select_module") return (
    <ModalShell icon={<Package size={16} />} title="Import · Modules" subtitle={subtitle} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Module</label>
        {loadingMods ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-muted text-sm">
            <span className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin" /> Loading…
          </div>
        ) : modules.length === 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">No modules found.</div>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {modules.map(m => (
              <button key={m.name} onClick={() => setSelectedMod(m)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${selectedMod?.name === m.name ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <Package size={18} />
                <span className={`text-sm font-medium flex-1 ${selectedMod?.name === m.name ? "text-c-brand" : "text-t-primary"}`}>{m.name}</span>
                {selectedMod?.name === m.name && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => setStage("select_op")} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button
            onClick={() => {
              if (op === "update") { setForm({ name: selectedMod?.name ?? "" }); setStage("fill_form"); }
              else setStage("confirm");
            }}
            disabled={!selectedMod}
            className={`flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
            {op === "delete" ? "Review Delete →" : "Next →"}
          </button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "fill_form") return (
    <ModalShell icon={<Package size={16} />} title="Import · Modules" subtitle={subtitle} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {selectedMod && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <Package size={14} />
            <span className="text-t-primary font-medium">{selectedMod.name}</span>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">
            {op === "create" ? "Module Name" : "New Name"}
          </label>
          <input type="text" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder={op === "create" ? "Enter module name…" : "New module name…"}
            className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={() => op === "create" ? setStage("select_op") : setStage("select_module")}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button onClick={() => setStage("confirm")} className="flex-1 btn-primary text-sm">Review →</button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "confirm") return (
    <ModalShell icon={<Package size={16} />} title="Import · Modules" subtitle={subtitle} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className={`rounded-xl border p-4 flex flex-col gap-3 ${op === "delete" ? "border-red-500/40 bg-red-500/10" : "border-[var(--border-color)] bg-bg-card"}`}>
          <div className="flex items-center gap-2 pb-1 border-b border-[var(--border-color)]">
            {op === "create" ? <Plus size={18} /> : op === "update" ? <Pencil size={18} /> : <Trash2 size={18} />}
            <p className={`text-sm font-bold ${op === "delete" ? "text-red-400" : "text-t-primary"}`}>
              {op === "create" ? "Creating new module" : op === "update" ? "Updating module" : "Deleting module"}
            </p>
          </div>
          {op === "create" && (
            <div className="flex flex-col gap-2 text-xs"><Row label="Name" value={form.name.trim() || "(empty)"} /></div>
          )}
          {op === "update" && selectedMod && (
            <div className="flex flex-col gap-2 text-xs"><DiffRow label="Name" before={selectedMod.name} after={form.name.trim()} /></div>
          )}
          {op === "delete" && selectedMod && (
            <div className="flex flex-col gap-2 text-xs">
              <Row label="Module" value={selectedMod.name} />
              <div className="mt-1 flex items-center gap-2 text-red-400 font-semibold"><AlertTriangle size={14} /><span>This action cannot be undone.</span></div>
            </div>
          )}
        </div>
        {errMsg && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-start gap-2">
            <XCircle size={14} className="shrink-0 mt-0.5" /><p>{errMsg}</p>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => op === "delete" ? setStage("select_module") : setStage("fill_form")}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
            ← {op === "delete" ? "Back" : "Edit"}
          </button>
          <button onClick={handleSubmit}
            className={`flex-1 btn-primary text-sm ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
            {op === "create" ? "✅ Confirm Create" : op === "update" ? "✅ Confirm Update" : "🗑 Confirm Delete"}
          </button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "submitting") return (
    <ModalShell icon={<Package size={16} />} title="Import · Modules" subtitle="Processing…" onClose={onClose}>
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
        <p className="text-sm text-t-secondary">Writing to Supabase…</p>
      </div>
    </ModalShell>
  );

  return (
    <ModalShell icon={<Package size={16} />} title="Import · Modules" subtitle="Complete" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm flex items-start gap-3 text-green-400">
          <CheckCircle size={20} className="shrink-0" />
          <p className="font-medium">{resultMsg}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={resetAll} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Another</button>
          <button onClick={onClose} className="flex-1 btn-primary text-sm">Done</button>
        </div>
      </div>
    </ModalShell>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// IMPORT TESTS MODAL
// ─────────────────────────────────────────────────────────────────────────
type TestOp          = "create" | "update" | "delete";
type TestManualStage = "select_op" | "select_test" | "fill_form" | "confirm" | "submitting" | "done";
interface TestFormData { serial_no: string; name: string; }

const TEST_OP_META = [
  { id: "create" as TestOp, label: "Create", icon: <Plus size={20} />,   desc: "Add a new test"             },
  { id: "update" as TestOp, label: "Update", icon: <Pencil size={20} />, desc: "Rename an existing test"    },
  { id: "delete" as TestOp, label: "Delete", icon: <Trash2 size={20} />, desc: "Remove a test permanently"  },
];

const ImportTestsModal: React.FC<{ onClose: () => void; onBack: () => void }> = ({ onClose, onBack }) => {
  const [stage,        setStage]        = useState<TestManualStage>("select_op");
  const [op,           setOp]           = useState<TestOp>("create");
  const [tests,        setTests]        = useState<TestOption[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [selectedTest, setSelectedTest] = useState<TestOption | null>(null);
  const [form,         setForm]         = useState<TestFormData>({ serial_no: "", name: "" });
  const [errMsg,       setErrMsg]       = useState("");
  const [resultMsg,    setResultMsg]    = useState("");

  useEffect(() => {
    if (stage !== "select_test") return;
    setLoadingTests(true);
    supabase.from("tests").select("serial_no, name").order("serial_no", { ascending: true })
      .then(({ data }) => { if (data) setTests(data as TestOption[]); setLoadingTests(false); });
  }, [stage]);

  const handleSubmit = useCallback(async () => {
    setStage("submitting"); setErrMsg("");
    try {
      if (op === "create") {
        const snVal = parseFloat(form.serial_no);
        if (isNaN(snVal)) throw new Error("Serial number must be a valid number.");
        const trimmed = form.name.trim();
        if (!trimmed) throw new Error("Test name is required.");
        const { error } = await supabase.from("tests").insert({ serial_no: snVal, name: trimmed });
        if (error) throw error;
        setResultMsg(`Test SN ${snVal} "${trimmed}" created.`);
      } else if (op === "update") {
        if (!selectedTest) throw new Error("No test selected.");
        const newName = form.name.trim();
        if (!newName) throw new Error("New name is required.");
        const { error } = await supabase.from("tests").update({ name: newName }).eq("name", selectedTest.name);
        if (error) throw error;
        setResultMsg(`SN ${selectedTest.serial_no} renamed to "${newName}".`);
      } else {
        if (!selectedTest) throw new Error("No test selected.");
        const { error } = await supabase.from("tests").delete().eq("name", selectedTest.name);
        if (error) throw error;
        setResultMsg(`Test SN ${selectedTest.serial_no} "${selectedTest.name}" deleted.`);
      }
      setStage("done");
    } catch (e: any) { setErrMsg(e?.message ?? "Unexpected error."); setStage("confirm"); }
  }, [op, form, selectedTest]);

  const resetAll = useCallback(() => {
    setStage("select_op"); setSelectedTest(null); setForm({ serial_no: "", name: "" }); setResultMsg(""); setErrMsg("");
  }, []);

  if (stage === "select_op") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import · Tests" subtitle="Choose operation" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {TEST_OP_META.map(m => (
            <button key={m.id} onClick={() => setOp(m.id)}
              className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all text-left ${op === m.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
              {m.icon}
              <div className="flex-1">
                <p className={`text-sm font-semibold ${op === m.id ? "text-c-brand" : "text-t-primary"}`}>{m.label}</p>
                <p className="text-xs text-t-muted">{m.desc}</p>
              </div>
              {op === m.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onBack} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button onClick={() => op === "create" ? (setForm({ serial_no: "", name: "" }), setStage("fill_form")) : setStage("select_test")}
            className="flex-1 btn-primary text-sm">Next →</button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "select_test") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import · Tests" subtitle="Select test" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Test</label>
        {loadingTests ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-muted text-sm">
            <span className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin" /> Loading…
          </div>
        ) : tests.length === 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">No tests found.</div>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {tests.map(t => (
              <button key={t.name} onClick={() => setSelectedTest(t)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${selectedTest?.name === t.name ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <FlaskConical size={18} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${selectedTest?.name === t.name ? "text-c-brand" : "text-t-primary"}`}>{t.name}</p>
                  <p className="text-xs text-t-muted">SN {t.serial_no}</p>
                </div>
                {selectedTest?.name === t.name && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => setStage("select_op")} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button
            onClick={() => {
              if (op === "update") { setForm({ serial_no: String(selectedTest?.serial_no ?? ""), name: selectedTest?.name ?? "" }); setStage("fill_form"); }
              else setStage("confirm");
            }}
            disabled={!selectedTest}
            className={`flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
            {op === "delete" ? "Review Delete →" : "Next →"}
          </button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "fill_form") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import · Tests" subtitle={op === "create" ? "Enter test details" : "Edit test name"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {selectedTest && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <FlaskConical size={14} />
            <div>
              <p className="text-t-primary font-medium">{selectedTest.name}</p>
              <p className="text-t-muted">SN {selectedTest.serial_no}</p>
            </div>
          </div>
        )}
        {op === "create" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Serial No</label>
            <input type="number" step="0.1" value={form.serial_no}
              onChange={e => setForm(f => ({ ...f, serial_no: e.target.value }))}
              placeholder="e.g. 1.1"
              className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">
            {op === "create" ? "Test Name" : "New Name"}
          </label>
          <input type="text" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder={op === "create" ? "Enter test name…" : "New test name…"}
            className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={() => op === "create" ? setStage("select_op") : setStage("select_test")}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button onClick={() => setStage("confirm")} className="flex-1 btn-primary text-sm">Review →</button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "confirm") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import · Tests" subtitle="Review & confirm" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className={`rounded-xl border p-4 flex flex-col gap-3 ${op === "delete" ? "border-red-500/40 bg-red-500/10" : "border-[var(--border-color)] bg-bg-card"}`}>
          <div className="flex items-center gap-2 pb-1 border-b border-[var(--border-color)]">
            {op === "create" ? <Plus size={18} /> : op === "update" ? <Pencil size={18} /> : <Trash2 size={18} />}
            <p className={`text-sm font-bold ${op === "delete" ? "text-red-400" : "text-t-primary"}`}>
              {op === "create" ? "Creating new test" : op === "update" ? "Updating test" : "Deleting test"}
            </p>
          </div>
          {op === "create" && (
            <div className="flex flex-col gap-2 text-xs">
              <Row label="Serial No" value={form.serial_no} mono brand />
              <Row label="Name"      value={form.name.trim() || "(empty)"} />
            </div>
          )}
          {op === "update" && selectedTest && (
            <div className="flex flex-col gap-2 text-xs">
              <Row label="Serial No" value={String(selectedTest.serial_no)} mono brand />
              <DiffRow label="Name"  before={selectedTest.name} after={form.name.trim()} />
            </div>
          )}
          {op === "delete" && selectedTest && (
            <div className="flex flex-col gap-2 text-xs">
              <Row label="Serial No" value={String(selectedTest.serial_no)} mono brand />
              <Row label="Name"      value={selectedTest.name} />
              <div className="mt-1 flex items-center gap-2 text-red-400 font-semibold"><AlertTriangle size={14} /><span>This action cannot be undone.</span></div>
            </div>
          )}
        </div>
        {errMsg && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-start gap-2">
            <XCircle size={14} className="shrink-0 mt-0.5" /><p>{errMsg}</p>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => op === "delete" ? setStage("select_test") : setStage("fill_form")}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
            ← {op === "delete" ? "Back" : "Edit"}
          </button>
          <button onClick={handleSubmit}
            className={`flex-1 btn-primary text-sm ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
            {op === "create" ? "✅ Confirm Create" : op === "update" ? "✅ Confirm Update" : "🗑 Confirm Delete"}
          </button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "submitting") return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import · Tests" subtitle="Processing…" onClose={onClose}>
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
        <p className="text-sm text-t-secondary">Writing to Supabase…</p>
      </div>
    </ModalShell>
  );

  return (
    <ModalShell icon={<FlaskConical size={16} />} title="Import · Tests" subtitle="Complete" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm flex items-start gap-3 text-green-400">
          <CheckCircle size={20} className="shrink-0" />
          <p className="font-medium">{resultMsg}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={resetAll} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Another</button>
          <button onClick={onClose} className="flex-1 btn-primary text-sm">Done</button>
        </div>
      </div>
    </ModalShell>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// IMPORT STEPS MODAL — CSV flow
// ─────────────────────────────────────────────────────────────────────────
type StepOp = "create" | "update" | "delete";
type StepImportStage = "select_test" | "select_op" | "upload" | "preview" | "importing" | "done";

interface StepCsvRow       { serial_no: number; action: string; expected_result: string; is_divider: boolean; }
interface StepImportSummary { written: number; skipped: number; errors: string[]; }

const STEP_CSV_OP_META = [
  { id: "create" as StepOp, label: "Create", icon: <Plus size={20} />,   desc: "Add new steps from CSV"         },
  { id: "update" as StepOp, label: "Update", icon: <Pencil size={20} />, desc: "Overwrite existing steps by SN"  },
  { id: "delete" as StepOp, label: "Delete", icon: <Trash2 size={20} />, desc: "Remove steps by serial_no"       },
];

function parseStepsCsv(text: string): { rows: StepCsvRow[]; errors: string[] } {
  const lines  = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const errors: string[] = [];
  const rows:   StepCsvRow[] = [];

  if (lines.length < 2) { errors.push("File is empty."); return { rows, errors }; }

  const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const iSn  = header.indexOf("serial_no");
  const iAct = header.indexOf("action");
  const iRes = header.indexOf("expected_result");
  const iDiv = header.indexOf("is_divider");
  const missing = ([iSn < 0 && "serial_no", iAct < 0 && "action", iRes < 0 && "expected_result", iDiv < 0 && "is_divider"] as (string | false)[]).filter(Boolean) as string[];
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
      serial_no:       snVal,
      action:          cells[iAct] ?? "",
      expected_result: cells[iRes] ?? "",
      is_divider:      /^(true|1|yes)$/i.test(cells[iDiv] ?? ""),
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
    supabase.from("tests").select("serial_no, name").order("serial_no", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setTests(data as TestOption[]);
        setTestsLoading(false);
      });
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows: parsed, errors } = parseStepsCsv(ev.target?.result as string);
      setRows(parsed); setParseErrors(errors); setStage("preview");
    };
    reader.onerror = () => setParseErrors(["Failed to read file."]);
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImport = useCallback(async () => {
    if (!selectedTest) return;
    setStage("importing");
    const result: StepImportSummary = { written: 0, skipped: 0, errors: [] };

    try {
      if (op === "create") {
        const payload = rows.map(row => ({
          tests_name:      selectedTest.name,
          serial_no:       row.serial_no,
          action:          row.action,
          expected_result: row.expected_result,
          is_divider:      row.is_divider,
        }));
        const { data: inserted, error } = await supabase.from("test_steps").insert(payload).select("id");
        if (error) {
          result.errors.push(error.message);
          result.skipped += rows.length;
        } else {
          result.written = inserted?.length ?? rows.length;
        }
      } else {
        for (const row of rows) {
          const { data: existing, error: fe } = await supabase
            .from("test_steps")
            .select("id")
            .eq("tests_name", selectedTest.name)
            .eq("serial_no", row.serial_no)
            .maybeSingle();
          if (fe || !existing) { result.errors.push(`SN ${row.serial_no}: not found — skipped.`); result.skipped++; continue; }

          if (op === "update") {
            const { error } = await supabase.from("test_steps").update({
              action: row.action, expected_result: row.expected_result, is_divider: row.is_divider,
            }).eq("id", existing.id);
            if (error) { result.errors.push(`SN ${row.serial_no}: ${error.message}`); result.skipped++; }
            else result.written++;
          } else {
            const { error } = await supabase.from("test_steps").delete().eq("id", existing.id);
            if (error) { result.errors.push(`SN ${row.serial_no}: ${error.message}`); result.skipped++; }
            else result.written++;
          }
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
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (CSV)" subtitle={stageLabel} onClose={onClose}>

      {stage === "select_test" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Select Test</label>
            {testsLoading ? (
              <div className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-muted text-sm flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin inline-block" /> Loading tests…
              </div>
            ) : tests.length === 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">No tests found. Import tests first.</div>
            ) : (
              <select defaultValue="" onChange={e => setSelectedTest(tests.find(t => t.name === e.target.value) ?? null)}
                className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm focus:outline-none focus:border-c-brand transition-colors appearance-none cursor-pointer">
                <option value="" disabled>Choose a test…</option>
                {tests.map(t => <option key={t.name} value={t.name}>SN {t.serial_no} — {t.name}</option>)}
              </select>
            )}
          </div>
          {selectedTest && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-c-brand/30 bg-c-brand-bg">
              <FlaskConical size={20} />
              <div>
                <p className="text-sm font-semibold text-c-brand">{selectedTest.name}</p>
                <p className="text-xs text-t-muted">SN {selectedTest.serial_no}</p>
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={onBack} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
            <button onClick={() => setStage("select_op")} disabled={!selectedTest}
              className="flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">Next →</button>
          </div>
        </div>
      )}

      {stage === "select_op" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-bg-card">
            <FlaskConical size={18} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-t-primary truncate">{selectedTest?.name}</p>
              <p className="text-xs text-t-muted">SN {selectedTest?.serial_no}</p>
            </div>
            <button onClick={() => setStage("select_test")} className="text-xs text-c-brand hover:underline shrink-0">Change</button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Operation</label>
            <div className="flex flex-col gap-2">
              {STEP_CSV_OP_META.map(m => (
                <button key={m.id} onClick={() => setOp(m.id)}
                  className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all text-left ${op === m.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                  {m.icon}
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
              <p>CSV only needs <code className="font-mono">serial_no</code> column for delete. Other columns are ignored.</p>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setStage("select_test")} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
            <button onClick={() => setStage("upload")} className="flex-1 btn-primary text-sm">Next →</button>
          </div>
        </div>
      )}

      {stage === "upload" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <FlaskConical size={14} />
            <span className="text-t-primary font-medium truncate">{selectedTest?.name}</span>
            <span className="mx-1 text-t-muted">·</span>
            <span className="text-c-brand font-semibold">{STEP_CSV_OP_META.find(m => m.id === op)?.label}</span>
          </div>
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
            <FolderOpen size={32} />
            <span className="text-sm font-medium text-t-secondary">Tap to choose CSV file</span>
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          <button onClick={() => setStage("select_op")} className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
        </div>
      )}

      {stage === "preview" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs">
            <FlaskConical size={14} />
            <span className="text-t-primary font-medium truncate">{selectedTest?.name}</span>
            <span className="mx-1 text-t-muted">·</span>
            <span className="text-c-brand font-semibold">{STEP_CSV_OP_META.find(m => m.id === op)?.label}</span>
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
                  {STEP_CSV_OP_META.find(m => m.id === op)?.icon} {STEP_CSV_OP_META.find(m => m.id === op)?.label} {rows.length} Steps →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {stage === "importing" && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
          <p className="text-sm text-t-secondary">Writing to Supabase…</p>
        </div>
      )}

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

// ─────────────────────────────────────────────────────────────────────────
// STEP CONTEXT STRIP
// ─────────────────────────────────────────────────────────────────────────
interface StepOption   { id: string; serial_no: number; tests_name: string; action: string; expected_result: string; is_divider: boolean; }
interface StepFormData { serial_no: string; action: string; expected_result: string; is_divider: boolean; }
const EMPTY_STEP_FORM: StepFormData = { serial_no: "", action: "", expected_result: "", is_divider: false };

const StepContextStrip: React.FC<{
  selectedModule: ModuleOption | null;
  selectedTest:   TestOption   | null;
  selectedStep?:  StepOption   | null;
}> = ({ selectedModule, selectedTest, selectedStep }) => (
  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-xs flex-wrap">
    {selectedModule && (
      <>
        <Package size={13} className="text-t-muted shrink-0" />
        <span className="text-t-primary font-medium">{selectedModule.name}</span>
      </>
    )}
    {selectedTest && (
      <>
        <span className="text-t-muted mx-0.5">›</span>
        <FlaskConical size={13} className="text-t-muted shrink-0" />
        <span className="text-t-primary font-medium truncate max-w-[120px]">{selectedTest.name}</span>
      </>
    )}
    {selectedStep && (
      <>
        <span className="text-t-muted mx-0.5">›</span>
        <span className="text-c-brand font-semibold font-mono">SN {selectedStep.serial_no}</span>
      </>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────
// IMPORT STEPS MANUAL MODAL
// ─────────────────────────────────────────────────────────────────────────
type StepManualOp    = "create" | "update" | "delete";
type StepManualStage = "select_op" | "select_module" | "select_test" | "select_step" | "fill_form" | "confirm" | "submitting" | "done";

const STEP_MANUAL_OP_META = [
  { id: "create" as StepManualOp, label: "Create", icon: <Plus size={20} />,   desc: "Add a new step to a test"  },
  { id: "update" as StepManualOp, label: "Update", icon: <Pencil size={20} />, desc: "Edit an existing step"     },
  { id: "delete" as StepManualOp, label: "Delete", icon: <Trash2 size={20} />, desc: "Remove a step permanently" },
];

const ImportStepsManualModal: React.FC<{ onClose: () => void; onBack: () => void }> = ({ onClose, onBack }) => {
  const [stage,          setStage]          = useState<StepManualStage>("select_op");
  const [op,             setOp]             = useState<StepManualOp>("create");
  const [modules,        setModules]        = useState<ModuleOption[]>([]);
  const [tests,          setTests]          = useState<TestOption[]>([]);
  const [steps,          setSteps]          = useState<StepOption[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [loadingTests,   setLoadingTests]   = useState(false);
  const [loadingSteps,   setLoadingSteps]   = useState(false);
  const [selectedModule, setSelectedModule] = useState<ModuleOption | null>(null);
  const [selectedTest,   setSelectedTest]   = useState<TestOption   | null>(null);
  const [selectedStep,   setSelectedStep]   = useState<StepOption   | null>(null);
  const [form,           setForm]           = useState<StepFormData>(EMPTY_STEP_FORM);
  const [errMsg,         setErrMsg]         = useState("");
  const [resultMsg,      setResultMsg]      = useState("");

  useEffect(() => {
    if (stage !== "select_module") return;
    setLoadingModules(true);
    supabase.from("modules").select("name").order("name")
      .then(({ data }) => { if (data) setModules(data as ModuleOption[]); setLoadingModules(false); });
  }, [stage]);

  useEffect(() => {
    if (stage !== "select_test" || !selectedModule) return;
    setLoadingTests(true);
    supabase.from("module_tests")
      .select("tests_name, tests(serial_no, name)")
      .eq("module_name", selectedModule.name)
      .then(({ data }) => {
        if (data) {
          const ts = (data as any[]).map(r => r.tests).filter(Boolean) as TestOption[];
          ts.sort((a, b) => a.serial_no - b.serial_no);
          setTests(ts);
        }
        setLoadingTests(false);
      });
  }, [stage, selectedModule]);

  useEffect(() => {
    if (stage !== "select_step" || !selectedTest) return;
    setLoadingSteps(true);
    supabase.from("test_steps")
      .select("id, serial_no, tests_name, action, expected_result, is_divider")
      .eq("tests_name", selectedTest.name)
      .order("serial_no", { ascending: true })
      .then(({ data }) => { if (data) setSteps(data as StepOption[]); setLoadingSteps(false); });
  }, [stage, selectedTest]);

  const handleSubmit = useCallback(async () => {
    setStage("submitting"); setErrMsg("");
    try {
      if (op === "create") {
        const snVal = parseFloat(form.serial_no);
        if (isNaN(snVal)) throw new Error("Invalid serial number.");
        if (!selectedTest) throw new Error("No test selected.");
        const { error } = await supabase.from("test_steps").insert({
          tests_name:      selectedTest.name,
          serial_no:       snVal,
          action:          form.action.trim(),
          expected_result: form.expected_result.trim(),
          is_divider:      form.is_divider,
        });
        if (error) throw error;
        setResultMsg(`Step SN ${snVal} "${form.action.trim() || "(divider)"}" created in "${selectedTest.name}".`);
      } else if (op === "update") {
        if (!selectedStep) throw new Error("No step selected.");
        const { error } = await supabase.from("test_steps").update({
          action:          form.action.trim(),
          expected_result: form.expected_result.trim(),
          is_divider:      form.is_divider,
        }).eq("id", selectedStep.id);
        if (error) throw error;
        setResultMsg(`Step SN ${selectedStep.serial_no} updated successfully.`);
      } else {
        if (!selectedStep) throw new Error("No step selected.");
        const { error } = await supabase.from("test_steps").delete().eq("id", selectedStep.id);
        if (error) throw error;
        setResultMsg(`Step SN ${selectedStep.serial_no} "${selectedStep.action || "(divider)"}" deleted.`);
      }
      setStage("done");
    } catch (e: any) { setErrMsg(e?.message ?? "Unexpected error."); setStage("confirm"); }
  }, [op, form, selectedTest, selectedStep]);

  const resetAll = useCallback(() => {
    setStage("select_op"); setSelectedModule(null); setSelectedTest(null);
    setSelectedStep(null); setForm(EMPTY_STEP_FORM); setResultMsg(""); setErrMsg("");
  }, []);

  const stageSubtitle: Record<StepManualStage, string> = {
    select_op:     "Choose operation",
    select_module: "Step 1 — Select module",
    select_test:   "Step 2 — Select test",
    select_step:   "Step 3 — Select step",
    fill_form:     op === "create" ? "Step 3 — Enter step details" : "Step 4 — Edit step details",
    confirm:       "Review & confirm",
    submitting:    "Processing…",
    done:          "Complete",
  };

  if (stage === "select_op") return (
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (Manual)" subtitle={stageSubtitle.select_op} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {STEP_MANUAL_OP_META.map(m => (
            <button key={m.id} onClick={() => setOp(m.id)}
              className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all text-left ${op === m.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
              {m.icon}
              <div className="flex-1">
                <p className={`text-sm font-semibold ${op === m.id ? "text-c-brand" : "text-t-primary"}`}>{m.label}</p>
                <p className="text-xs text-t-muted">{m.desc}</p>
              </div>
              {op === m.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onBack} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button onClick={() => setStage("select_module")} className="flex-1 btn-primary text-sm">Next →</button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "select_module") return (
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (Manual)" subtitle={stageSubtitle.select_module} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Module</label>
        {loadingModules ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-muted text-sm">
            <span className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin" /> Loading…
          </div>
        ) : modules.length === 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">No modules found.</div>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {modules.map(m => (
              <button key={m.name} onClick={() => setSelectedModule(m)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${selectedModule?.name === m.name ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <Package size={18} />
                <span className={`text-sm font-medium flex-1 ${selectedModule?.name === m.name ? "text-c-brand" : "text-t-primary"}`}>{m.name}</span>
                {selectedModule?.name === m.name && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => setStage("select_op")} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button onClick={() => { setSelectedTest(null); setStage("select_test"); }} disabled={!selectedModule}
            className="flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">Next →</button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "select_test") return (
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (Manual)" subtitle={stageSubtitle.select_test} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <StepContextStrip selectedModule={selectedModule} selectedTest={selectedTest} />
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Test</label>
        {loadingTests ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-muted text-sm">
            <span className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin" /> Loading…
          </div>
        ) : tests.length === 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">No tests found for this module.</div>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {tests.map(t => (
              <button key={t.name} onClick={() => setSelectedTest(t)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${selectedTest?.name === t.name ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <FlaskConical size={18} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${selectedTest?.name === t.name ? "text-c-brand" : "text-t-primary"}`}>{t.name}</p>
                  <p className="text-xs text-t-muted">SN {t.serial_no}</p>
                </div>
                {selectedTest?.name === t.name && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => setStage("select_module")} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button
            onClick={() => {
              if (op === "create") { setForm(EMPTY_STEP_FORM); setStage("fill_form"); }
              else { setSelectedStep(null); setStage("select_step"); }
            }}
            disabled={!selectedTest}
            className="flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">Next →</button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "select_step") return (
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (Manual)" subtitle={stageSubtitle.select_step} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <StepContextStrip selectedModule={selectedModule} selectedTest={selectedTest} />
        <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Step</label>
        {loadingSteps ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-muted text-sm">
            <span className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin" /> Loading steps…
          </div>
        ) : steps.length === 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">No steps found for this test.</div>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
            {steps.map(s => (
              <button key={s.id}
                onClick={() => {
                  setSelectedStep(s);
                  if (op === "update") setForm({ serial_no: String(s.serial_no), action: s.action, expected_result: s.expected_result, is_divider: s.is_divider });
                }}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all text-left ${selectedStep?.id === s.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                <span className={`text-xs font-bold font-mono px-2 py-1 rounded-lg shrink-0 min-w-[2.5rem] text-center ${selectedStep?.id === s.id ? "bg-c-brand text-white" : "bg-bg-base text-c-brand"}`}>
                  {s.serial_no}
                </span>
                <div className="flex-1 min-w-0">
                  {s.is_divider
                    ? <p className="text-xs italic text-t-muted">— divider —</p>
                    : <>
                        <p className={`text-sm truncate ${selectedStep?.id === s.id ? "text-c-brand" : "text-t-primary"}`}>{s.action || <span className="italic text-t-muted">No action text</span>}</p>
                        {s.expected_result && <p className="text-xs text-t-muted truncate mt-0.5">{s.expected_result}</p>}
                      </>
                  }
                </div>
                {selectedStep?.id === s.id && <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0"><Check size={10} /></span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => setStage("select_test")} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button
            onClick={() => op === "update" ? setStage("fill_form") : setStage("confirm")}
            disabled={!selectedStep}
            className={`flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
            {op === "delete" ? "Review Delete →" : "Next →"}
          </button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "fill_form") return (
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (Manual)" subtitle={stageSubtitle.fill_form} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <StepContextStrip selectedModule={selectedModule} selectedTest={selectedTest} selectedStep={selectedStep} />
        {op === "create" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Serial No</label>
            <input type="number" step="1" min="1" value={form.serial_no}
              onChange={e => setForm(f => ({ ...f, serial_no: e.target.value }))}
              placeholder="e.g. 5"
              className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Action</label>
          <textarea rows={3} value={form.action}
            onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
            placeholder="Describe the action to perform…"
            className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors resize-none" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-t-muted uppercase tracking-wider">Expected Result</label>
          <textarea rows={3} value={form.expected_result}
            onChange={e => setForm(f => ({ ...f, expected_result: e.target.value }))}
            placeholder="What should happen after this step…"
            className="w-full px-4 py-3 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary text-sm placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors resize-none" />
        </div>
        <button onClick={() => setForm(f => ({ ...f, is_divider: !f.is_divider }))}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${form.is_divider ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
          <Minus size={18} />
          <div className="flex-1">
            <p className={`text-sm font-semibold ${form.is_divider ? "text-c-brand" : "text-t-primary"}`}>Section Divider</p>
            <p className="text-xs text-t-muted">Mark this step as a visual divider row</p>
          </div>
          <div className={`w-10 h-5 rounded-full transition-colors duration-200 shrink-0 relative ${form.is_divider ? "bg-c-brand" : "bg-bg-base border border-[var(--border-color)]"}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${form.is_divider ? "left-[calc(100%-1.1rem)]" : "left-0.5"}`} />
          </div>
        </button>
        <div className="flex gap-2 pt-1">
          <button onClick={() => op === "create" ? setStage("select_test") : setStage("select_step")}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Back</button>
          <button onClick={() => setStage("confirm")} className="flex-1 btn-primary text-sm">Review →</button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "confirm") return (
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (Manual)" subtitle={stageSubtitle.confirm} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <StepContextStrip selectedModule={selectedModule} selectedTest={selectedTest} selectedStep={selectedStep} />
        <div className={`rounded-xl border p-4 flex flex-col gap-3 ${op === "delete" ? "border-red-500/40 bg-red-500/10" : "border-[var(--border-color)] bg-bg-card"}`}>
          <div className="flex items-center gap-2 pb-1 border-b border-[var(--border-color)]">
            {op === "create" ? <Plus size={18} /> : op === "update" ? <Pencil size={18} /> : <Trash2 size={18} />}
            <p className={`text-sm font-bold ${op === "delete" ? "text-red-400" : "text-t-primary"}`}>
              {op === "create" ? "Creating new step" : op === "update" ? "Updating step" : "Deleting step"}
            </p>
          </div>
          {op === "create" && (
            <div className="flex flex-col gap-2 text-xs">
              <Row label="Module"    value={selectedModule?.name ?? "—"} />
              <Row label="Test"      value={selectedTest?.name  ?? "—"} />
              <Row label="Serial No" value={form.serial_no}              mono brand />
              <Row label="Action"    value={form.action         || "(empty)"} />
              <Row label="Expected"  value={form.expected_result|| "(empty)"} />
              <Row label="Divider"   value={form.is_divider ? "Yes" : "No"} />
            </div>
          )}
          {op === "update" && selectedStep && (
            <div className="flex flex-col gap-2 text-xs">
              <Row label="Test"      value={selectedTest?.name ?? "—"} />
              <Row label="Serial No" value={String(selectedStep.serial_no)} mono brand />
              <DiffRow label="Action"   before={selectedStep.action}          after={form.action} />
              <DiffRow label="Expected" before={selectedStep.expected_result} after={form.expected_result} />
              <DiffRow label="Divider"  before={selectedStep.is_divider ? "Yes" : "No"} after={form.is_divider ? "Yes" : "No"} />
            </div>
          )}
          {op === "delete" && selectedStep && (
            <div className="flex flex-col gap-2 text-xs">
              <Row label="Module"    value={selectedModule?.name ?? "—"} />
              <Row label="Test"      value={selectedTest?.name  ?? "—"} />
              <Row label="Serial No" value={String(selectedStep.serial_no)} mono />
              <Row label="Action"    value={selectedStep.action || "(divider)"} />
              <div className="mt-1 flex items-center gap-2 text-red-400 font-semibold">
                <span>⚠️</span><span>This action cannot be undone.</span>
              </div>
            </div>
          )}
        </div>
        {errMsg && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-start gap-2">
            <XCircle size={14} className="shrink-0 mt-0.5" /><p>{errMsg}</p>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => op === "delete" ? setStage("select_step") : setStage("fill_form")}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
            ← {op === "delete" ? "Back" : "Edit"}
          </button>
          <button onClick={handleSubmit}
            className={`flex-1 btn-primary text-sm ${op === "delete" ? "!bg-red-500 hover:!bg-red-600" : ""}`}>
            {op === "create" ? "✅ Confirm Create" : op === "update" ? "✅ Confirm Update" : "🗑 Confirm Delete"}
          </button>
        </div>
      </div>
    </ModalShell>
  );

  if (stage === "submitting") return (
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (Manual)" subtitle="Processing…" onClose={onClose}>
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-12 h-12 rounded-full border-4 border-c-brand border-t-transparent animate-spin" />
        <p className="text-sm text-t-secondary">Writing to Supabase…</p>
      </div>
    </ModalShell>
  );

  return (
    <ModalShell icon={<Hash size={16} />} title="Import · Steps (Manual)" subtitle="Complete" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm flex items-start gap-3 text-green-400">
          <CheckCircle size={20} className="shrink-0" />
          <p className="font-medium">{resultMsg}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={resetAll} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">← Another</button>
          <button onClick={onClose} className="flex-1 btn-primary text-sm">Done</button>
        </div>
      </div>
    </ModalShell>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// IMPORT MODAL (router)
// ─────────────────────────────────────────────────────────────────────────
type ImportTarget = "modules" | "tests" | "steps" | "steps_manual" | null;

const ImportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [target, setTarget] = useState<ImportTarget>(null);

  if (target === "modules")      return <ImportModulesModal     onClose={onClose} onBack={() => setTarget(null)} />;
  if (target === "tests")        return <ImportTestsModal       onClose={onClose} onBack={() => setTarget(null)} />;
  if (target === "steps")        return <ImportStepsModal       onClose={onClose} onBack={() => setTarget(null)} />;
  if (target === "steps_manual") return <ImportStepsManualModal onClose={onClose} onBack={() => setTarget(null)} />;

  const options: { id: ImportTarget; icon: React.ReactNode; label: string; desc: string; badge: string }[] = [
    { id: "modules",      icon: <Package size={22} />,     label: "Modules",     desc: "Create · update · delete module records", badge: "Manual" },
    { id: "tests",        icon: <FlaskConical size={22} />, label: "Tests",       desc: "Manual create · update · delete",         badge: "Manual" },
    { id: "steps_manual", icon: <Hash size={22} />,         label: "Steps",       desc: "Search by module › test › step",          badge: "Manual" },
    { id: "steps",        icon: <FolderOpen size={22} />,   label: "Steps (CSV)", desc: "Select test · op · upload CSV",            badge: "CSV"    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full md:max-w-md mx-auto bg-bg-surface/80 backdrop-blur-md border-t md:border border-[var(--border-color)] rounded-t-2xl md:rounded-2xl px-6 pt-5 pb-10 md:pb-6 z-10 flex flex-col gap-4">
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden" />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-t-primary flex items-center gap-1.5"><Download size={16} />Import Data</h2>
            <p className="text-xs text-t-muted mt-0.5">Choose what to import</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors text-lg"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-2">
          {options.map(opt => (
            <button key={opt.id as string} onClick={() => setTarget(opt.id)}
              className="flex items-center gap-4 px-4 py-4 rounded-xl bg-bg-card hover:bg-bg-base border border-[var(--border-color)] transition-colors text-left group">
              {opt.icon}
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
  icon: React.ReactNode; label: string; desc: string; onClick: () => void;
}> = ({ icon, label, desc, onClick }) => (
  <button onClick={onClick}
    className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-bg-card hover:bg-bg-base border border-[var(--border-color)] transition-colors text-t-primary w-full text-left">
    <span className="flex items-center justify-center w-6 h-6">{icon}</span>
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-t-muted">{desc}</p>
    </div>
  </button>
);

// ─────────────────────────────────────────────────────────────────────────
// OUTSIDE CLICK HOOK
// ─────────────────────────────────────────────────────────────────────────
function useOutsideClick(ref: React.RefObject<HTMLElement>, active: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [ref, active, onOutside]);
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN MOBILE NAV
// ─────────────────────────────────────────────────────────────────────────
interface Props { activePage: string; onNavigate: (page: string) => void; }

const MobileNav: React.FC<Props> = ({ activePage, onNavigate }) => {
  const { user, signOut }      = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [showMore,        setShowMore]        = useState(false);
  const [showAdminPanel,  setShowAdminPanel]  = useState(false);
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [showImport,      setShowImport]      = useState(false);
  const [showExport,      setShowExport]      = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const adminRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === "admin";

  const items = [
    { id: "dashboard", icon: <LayoutDashboard size={20} />, label: "Home"   },
    { id: "report",    icon: <ClipboardList size={20} />,   label: "Report" },
    { id: "auditlog",  icon: <ScrollText size={20} />,      label: "Audit"  },
    ...(isAdmin ? [{ id: "users", icon: <Users size={20} />, label: "Users" }] : []),
  ];

  const closeMore       = useCallback(() => setShowMore(false),       []);
  const closeAdminPanel = useCallback(() => setShowAdminPanel(false), []);

  useOutsideClick(sheetRef, showMore,       closeMore);
  useOutsideClick(adminRef, showAdminPanel, closeAdminPanel);

  // Release test lock then sign out
  const handleSignOut = useCallback(async () => {
    try {
      if (user?.id) {
        await supabase.from("test_locks").delete().eq("user_id", user.id);
      }
      await signOut();
    } catch (err) {
      console.error("Sign out failed:", err);
    }
    setShowMore(false);
  }, [user?.id, signOut]);

  return (
    <>
      {/* ── Admin-only modals ─────────────────────────────────────────── */}
      {isAdmin && showThemeEditor && <ThemeEditor onClose={() => setShowThemeEditor(false)} />}
      {isAdmin && showImport      && <ImportModal onClose={() => setShowImport(false)} />}
      {isAdmin && showExport      && <ExportModal onClose={() => setShowExport(false)} />}

      {/* ── Admin Tools bottom sheet ──────────────────────────────────── */}
      {isAdmin && showAdminPanel && (
        <div className="md:hidden fixed inset-0 z-[60] flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAdminPanel(false)} />
          <div ref={adminRef} className="relative w-full bg-bg-surface/80 backdrop-blur-md border-t border-[var(--border-color)] rounded-t-2xl px-6 pt-4 pb-10 flex flex-col gap-3 z-10">
            <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mb-1" />
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-sm font-bold text-t-primary">⚙️ Admin Tools</p>
                <p className="text-xs text-t-muted">Signed in as {user?.email}</p>
              </div>
              <button onClick={() => setShowAdminPanel(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors text-lg"><X size={16} /></button>
            </div>
            <div className="border-t border-[var(--border-color)]" />
            <SheetButton icon={<Palette size={22} />} label="Theme Editor" desc="Customize colors & palette"
              onClick={() => { setShowAdminPanel(false); setShowThemeEditor(true); }} />
            <SheetButton icon={<Download size={22} />} label="Import Data"  desc="Modules · Tests · Steps"
              onClick={() => { setShowAdminPanel(false); setShowImport(true); }} />
            <SheetButton icon={<Upload size={22} />} label="Export Data"  desc="All tables · CSV · JSON · SQL"
              onClick={() => { setShowAdminPanel(false); setShowExport(true); }} />
          </div>
        </div>
      )}

      {/* ── More bottom sheet ─────────────────────────────────────────── */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMore(false)} />
          <div ref={sheetRef} className="relative w-full bg-bg-surface/80 backdrop-blur-md border-t border-[var(--border-color)] rounded-t-2xl px-6 pt-4 pb-10 flex flex-col gap-3 z-10">
            <div className="w-10 h-1 bg-bg-card rounded-full mx-auto mb-2" />
            {isAdmin && (
              <SheetButton icon={<Settings size={22} />} label="Admin Tools" desc="Theme · Import · Export"
                onClick={() => { setShowMore(false); setShowAdminPanel(true); }} />
            )}
            <button onClick={() => { toggleTheme(); setShowMore(false); }}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-bg-card hover:bg-bg-base border border-[var(--border-color)] transition-colors text-t-primary">
              {theme === "dark" ? <Sun size={22} /> : <Moon size={22} />}
              <div className="text-left">
                <p className="text-sm font-semibold">{theme === "dark" ? "Light Mode" : "Dark Mode"}</p>
                <p className="text-xs text-t-muted">Switch appearance</p>
              </div>
            </button>
            <div className="border-t border-[var(--border-color)]" />
            <button onClick={handleSignOut}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20">
              <LogOut size={22} />
              <div className="text-left">
                <p className="text-sm font-semibold">Sign Out</p>
                <p className="text-xs text-red-400/60">Signed in as {user?.email ?? "you"}</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom nav bar ────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg-nav backdrop-blur border-t border-[var(--border-color)] flex items-center justify-around px-2 py-2">
        {items.map(item => (
          <button key={item.id} onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors ${activePage === item.id ? "text-c-brand" : "text-t-muted"}`}>
            <span className="flex items-center justify-center">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
        <button onClick={() => setShowMore(prev => !prev)}
          className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors ${showMore ? "text-c-brand" : "text-t-muted"}`}>
          <MoreHorizontal size={20} />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
};

export default MobileNav;