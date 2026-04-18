import React, { useCallback, useEffect, useState } from "react";
import {
  BarChart2, FileJson, Table2, Database,
  Upload, Download, Check,
} from "lucide-react";

// ── CHANGED: use central query layer instead of inline supabase calls ─────────
import { fetchAllTables, ALL_TABLES } from "../../lib/supabase/queries";
import type { AllData }               from "../../lib/supabase/queries";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (no supabase — pure utils, unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const today = new Date().toISOString().split("T")[0];

function toCsv(rows: Record<string, unknown>[], sep = ","): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(sep) || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [headers.join(sep), ...rows.map(r => headers.map(h => esc(r[h])).join(sep))].join("\n");
}

function toSql(table: string, rows: Record<string, unknown>[]): string {
  if (!rows.length) return `-- ${table}: no rows`;
  const esc = (v: unknown) =>
    v == null      ? "NULL"
    : typeof v === "boolean" ? String(v)
    : typeof v === "number"  ? String(v)
    : `'${String(v).replace(/'/g, "''")}'`;
  const cols = Object.keys(rows[0]);
  return rows
    .map(r => `INSERT INTO public.${table} (${cols.join(", ")}) VALUES (${cols.map(c => esc(r[c])).join(", ")}) ON CONFLICT DO NOTHING;`)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ExportFormat = "csv+zip" | "json" | "tsv+zip" | "sql";
type ExportStage  = "idle" | "fetching" | "ready" | "exporting" | "done" | "error";

const FORMAT_META: { id: ExportFormat; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "csv+zip", label: "CSV zip",  icon: <BarChart2 size={20} />, desc: "One CSV per table — re-importable"   },
  { id: "json",    label: "JSON",     icon: <FileJson  size={20} />, desc: "All tables in one nested file"       },
  { id: "tsv+zip", label: "TSV zip",  icon: <Table2    size={20} />, desc: "Tab-separated — Excel-friendly"     },
  { id: "sql",     label: "SQL",      icon: <Database  size={20} />, desc: "INSERT statements — full backup"    },
];

interface Props { onClose: () => void; }

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const ExportAllModal: React.FC<Props> = ({ onClose }) => {
  const [stage,       setStage]       = useState<ExportStage>("idle");
  const [allData,     setAllData]     = useState<AllData | null>(null);
  const [fetchErrors, setFetchErrors] = useState<string[]>([]);
  const [format,      setFormat]      = useState<ExportFormat>("csv+zip");
  const [errMsg,      setErrMsg]      = useState<string | null>(null);

  const counts = allData
    ? ALL_TABLES.map(t => ({ table: t, count: allData[t].length }))
    : null;
  const totalRows = counts?.reduce((s, c) => s + c.count, 0) ?? 0;

  // ── CHANGED: fetchAllTables() from queries.ts instead of inline loop ───────
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
      const stamp = today;
      if (format === "json") {
        downloadBlob(
          new Blob([JSON.stringify({ exported_at: new Date().toISOString(), tables: allData }, null, 2)], { type: "application/json" }),
          `testpro-full-${stamp}.json`
        );
      } else if (format === "sql") {
        const lines = [`-- TestPro full dump ${new Date().toLocaleString()}`, `-- Tables: ${ALL_TABLES.join(", ")}`];
        for (const t of ALL_TABLES) { lines.push(`\n-- ${t}\n`, toSql(t, allData[t])); }
        downloadBlob(new Blob([lines.join("\n")], { type: "text/plain" }), `testpro-full-${stamp}.sql`);
      } else {
        const JSZip = (await import("jszip")).default;
        const zip   = new JSZip();
        const sep   = format === "tsv+zip" ? "\t" : ",";
        const ext   = format === "tsv+zip" ? "tsv" : "csv";
        for (const t of ALL_TABLES) zip.file(`${t}.${ext}`, toCsv(allData[t], sep));
        downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `testpro-full-${stamp}.zip`);
      }
      setStage("done");
    } catch (e: any) {
      setErrMsg(e?.message ?? "Export failed.");
      setStage("error");
    }
  }, [allData, format]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-full md:max-w-md mx-auto
        bg-bg-surface/80 backdrop-blur-md
        border-t md:border border-[var(--border-color)]
        rounded-t-2xl md:rounded-2xl
        px-6 pt-5 pb-10 md:pb-6 z-10
        flex flex-col gap-4 max-h-[90vh] overflow-y-auto">

        {/* Drag pill (mobile) */}
        <div className="w-10 h-1 bg-bg-card rounded-full mx-auto md:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-t-primary flex items-center gap-1.5">
              <Upload size={16} /> Export All Data
            </h2>
            <p className="text-xs text-t-muted mt-0.5">
              {stage === "fetching"  && "Fetching from Supabase…"}
              {stage === "ready"     && `${ALL_TABLES.length} tables · ${totalRows} rows`}
              {stage === "exporting" && "Building file…"}
              {stage === "done"      && "Download started ✓"}
              {stage === "error"     && "Something went wrong"}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted hover:text-t-primary hover:bg-bg-card transition-colors shrink-0">
            ✕
          </button>
        </div>

        {/* Fetching spinner */}
        {stage === "fetching" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="w-10 h-10 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-t-muted">Loading all tables…</p>
          </div>
        )}

        {/* Error */}
        {stage === "error" && errMsg && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{errMsg}</div>
        )}

        {/* Main body — ready / exporting / done */}
        {(stage === "ready" || stage === "exporting" || stage === "done") && counts && (
          <>
            {/* Partial fetch warnings */}
            {fetchErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 flex flex-col gap-1">
                <p className="font-semibold">Some tables failed to load</p>
                {fetchErrors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            {/* Table row counts */}
            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="bg-bg-card px-3 py-2 border-b border-[var(--border-color)]">
                <p className="text-xs font-semibold text-t-muted uppercase tracking-wider">Tables</p>
              </div>
              <div className="divide-y divide-[var(--border-color)]">
                {counts.map(({ table, count }) => (
                  <div key={table} className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm font-mono text-t-secondary">{table}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${count > 0 ? "bg-c-brand-bg text-c-brand" : "bg-bg-card text-t-muted"}`}>
                      {count} rows
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Format picker */}
            <div className="flex flex-col gap-2">
              <p className="text-xs text-t-muted font-semibold uppercase tracking-wider">Format</p>
              {FORMAT_META.map(f => (
                <button key={f.id} onClick={() => setFormat(f.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
                    ${format === f.id ? "border-c-brand bg-c-brand-bg" : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"}`}>
                  <span className={format === f.id ? "text-c-brand" : "text-t-muted"}>{f.icon}</span>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${format === f.id ? "text-c-brand" : "text-t-primary"}`}>{f.label}</p>
                    <p className="text-xs text-t-muted">{f.desc}</p>
                  </div>
                  {format === f.id && (
                    <span className="w-4 h-4 rounded-full bg-c-brand flex items-center justify-center text-white shrink-0">
                      <Check size={10} />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Download button */}
            <button onClick={handleExport}
              disabled={stage === "exporting" || stage === "done"}
              className="btn-primary text-sm w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {stage === "exporting"
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Building…</>
                : stage === "done"
                  ? <><Check size={14} />Downloaded!</>
                  : <><Download size={14} />Download {FORMAT_META.find(f => f.id === format)?.label}</>
              }
            </button>

            {stage === "done" && (
              <button onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors">
                Close
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ExportAllModal;
