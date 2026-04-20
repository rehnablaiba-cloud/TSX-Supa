// src/components/Layout/MobileNav.tsx
// Phase 2 — B1 B2 B3 B4 A3 A4 A5 applied:
//   ModalShell      → imported from UI/ModalShell
//   Row, DiffRow    → imported from UI/ReviewRow
//   toCsv/toSql/downloadBlob    → imported from utils/export
//   parseCsvToRecords/parseStepsCsv → imported from utils/csvParser
//   TestOption/ModuleOption     → imported from types
//   releaseLocksAndSignOut      → imported from lib/supabase/queries
//   fetchModuleOptions          → imported from lib/supabase/queries
//   fetchTestsForModule         → imported from lib/supabase/queries

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { supabase } from "../../supabase";
import ThemeEditor from "../ThemeEditor/ThemeEditorPanel";
import {
  BarChart2,
  FileJson,
  Table2,
  Database,
  Package,
  FlaskConical,
  Hash,
  FolderOpen,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  XCircle,
  CheckCircle,
  Check,
  X,
  Upload,
  Download,
  Settings,
  Palette,
  Sun,
  Moon,
  LogOut,
  Minus,
  Users,
  ScrollText,
  MoreHorizontal,
  LayoutDashboard,
  ClipboardList,
} from "lucide-react";

// ── Phase 2: extracted utilities ──────────────────────────────────────────────
import { downloadBlob, toCsv, toSql } from "../../utils/fileUtils";
import { parseCsvToRecords, parseStepsCsv } from "../../utils/csvParser";
import ModalShell from "../UI/ModalShell";
import { Row, DiffRow } from "../UI/ReviewRow";
import type { TestOption, ModuleOption, StepInput } from "../../types";
import {
  releaseLocksAndSignOut,
  fetchModuleOptions,
  fetchTestsForModule,
} from "../../lib/supabase/queries";

// ── All tables (FK-safe order for SQL inserts) ────────────────────────────────
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

type TableName = (typeof ALL_TABLES)[number];
type AllData = Record<TableName, Record<string, unknown>[]>;

const today = new Date().toISOString().split("T")[0];

async function fetchAllTables(): Promise<{ data: AllData; errors: string[] }> {
  const data = {} as AllData;
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

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT MODAL
// ══════════════════════════════════════════════════════════════════════════════
type ExportFormat = "csvzip" | "json" | "tsvzip" | "sql";
const FORMAT_META: {
  id: ExportFormat;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  {
    id: "csvzip",
    label: "CSV (zip)",
    icon: <BarChart2 size={20} />,
    desc: "One CSV per table — re-importable",
  },
  {
    id: "json",
    label: "JSON",
    icon: <FileJson size={20} />,
    desc: "All tables in one nested file",
  },
  {
    id: "tsvzip",
    label: "TSV (zip)",
    icon: <Table2 size={20} />,
    desc: "Tab-separated — Excel-friendly",
  },
  {
    id: "sql",
    label: "SQL",
    icon: <Database size={20} />,
    desc: "INSERT statements — full backup",
  },
];

type ExportStage =
  | "idle"
  | "fetching"
  | "ready"
  | "exporting"
  | "done"
  | "error";

const ExportDataModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [stage, setStage] = useState<ExportStage>("idle");
  const [allData, setAllData] = useState<AllData | null>(null);
  const [fetchErrors, setFetchErrors] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>("csvzip");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const counts = allData
    ? ALL_TABLES.map((t) => ({ table: t, count: allData[t].length }))
    : null;
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
    return () => {
      mounted = false;
    };
  }, []);

  const handleExport = useCallback(async () => {
    if (!allData) return;
    setStage("exporting");
    try {
      const stamp = today;
      if (format === "json") {
        downloadBlob(
          new Blob(
            [
              JSON.stringify(
                { exportedat: new Date().toISOString(), tables: allData },
                null,
                2
              ),
            ],
            { type: "application/json" }
          ),
          `testpro-full-${stamp}.json`
        );
      } else if (format === "sql") {
        const lines = [
          `-- TestPro full dump ${new Date().toLocaleString()}`,
          `-- Tables: ${ALL_TABLES.join(", ")}`,
        ];
        for (const t of ALL_TABLES) {
          lines.push(`-- ${t}`);
          lines.push(toSql(t, allData[t]));
        }
        downloadBlob(
          new Blob([lines.join("\n")], { type: "text/plain" }),
          `testpro-full-${stamp}.sql`
        );
      } else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        const sep = format === "tsvzip" ? "	" : ",";
        const ext = format === "tsvzip" ? "tsv" : "csv";
        for (const t of ALL_TABLES)
          zip.file(`${t}.${ext}`, toCsv(allData[t], sep));
        downloadBlob(
          await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
          `testpro-full-${stamp}.zip`
        );
      }
      setStage("done");
    } catch (e: any) {
      setErrMsg(e?.message ?? "Export failed.");
      setStage("error");
    }
  }, [allData, format]);

  return (
    <ModalShell
      title="Export All Data"
      icon={<Upload size={16} />}
      onClose={onClose}
      subtitle={
        stage === "fetching"
          ? "Fetching from Supabase…"
          : stage === "ready"
          ? `${ALL_TABLES.length} tables · ${totalRows} rows`
          : stage === "exporting"
          ? "Building file…"
          : stage === "done"
          ? "Download started"
          : stage === "error"
          ? "Something went wrong"
          : ""
      }
    >
      {stage === "fetching" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="w-10 h-10 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-t-muted">Loading all tables…</p>
        </div>
      )}
      {stage === "error" && errMsg && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {errMsg}
        </div>
      )}
      {(stage === "ready" || stage === "exporting" || stage === "done") &&
        counts && (
          <>
            {fetchErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 flex flex-col gap-1">
                <p className="font-semibold">Some tables failed to load</p>
                {fetchErrors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}
            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="bg-bg-card px-3 py-2 border-b border-[var(--border-color)]">
                <p className="text-xs font-semibold text-t-muted uppercase tracking-wider">
                  Tables
                </p>
              </div>
              <div className="divide-y divide-[var(--border-color)]">
                {counts.map(({ table, count }) => (
                  <div
                    key={table}
                    className="flex items-center justify-between px-3 py-2.5"
                  >
                    <span className="text-sm font-mono text-t-secondary">
                      {table}
                    </span>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        count > 0
                          ? "bg-c-brand-bg text-c-brand"
                          : "bg-bg-card text-t-muted"
                      }`}
                    >
                      {count} rows
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-t-muted font-semibold uppercase tracking-wider">
                Format
              </p>
              {FORMAT_META.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                    format === f.id
                      ? "border-c-brand bg-c-brand-bg"
                      : "border-[var(--border-color)] bg-bg-card hover:bg-bg-base"
                  }`}
                >
                  {f.icon}
                  <div className="flex-1">
                    <p
                      className={`text-sm font-semibold ${
                        format === f.id ? "text-c-brand" : "text-t-primary"
                      }`}
                    >
                      {f.label}
                    </p>
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
            <button
              onClick={handleExport}
              disabled={stage === "exporting" || stage === "done"}
              className="btn-primary text-sm w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {stage === "exporting" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Building…
                </>
              ) : stage === "done" ? (
                <>
                  <Check size={14} />
                  Downloaded!
                </>
              ) : (
                <>
                  <Download size={14} />
                  Download {FORMAT_META.find((f) => f.id === format)?.label}
                </>
              )}
            </button>
            {stage === "done" && (
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary text-sm font-medium transition-colors"
              >
                Close
              </button>
            )}
          </>
        )}
    </ModalShell>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT MODULES MODAL
// ══════════════════════════════════════════════════════════════════════════════
type ModuleOp = "create" | "update" | "delete";
type ModuleManualStage =
  | "selectop"
  | "selectmodule"
  | "fillform"
  | "confirm"
  | "submitting"
  | "done";

const MODULE_OP_META = [
  {
    id: "create" as ModuleOp,
    label: "Create",
    icon: <Plus size={20} />,
    desc: "Add a new module",
  },
  {
    id: "update" as ModuleOp,
    label: "Update",
    icon: <Pencil size={20} />,
    desc: "Edit module details",
  },
  {
    id: "delete" as ModuleOp,
    label: "Delete",
    icon: <Trash2 size={20} />,
    desc: "Remove a module",
  },
];

const ImportModulesModal: React.FC<{
  onClose: () => void;
  onDone: () => void;
}> = ({ onClose, onDone }) => {
  const [stage, setStage] = useState<ModuleManualStage>("selectop");
  const [op, setOp] = useState<ModuleOp>("create");
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [selectedModule, setSelected] = useState<ModuleOption | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModuleOptions()
      .then(setModules)
      .catch(() => {});
  }, []);

  const handleOpSelect = (o: ModuleOp) => {
    setOp(o);
    setStage(o === "create" ? "fillform" : "selectmodule");
  };

  const handleModuleSelect = (m: ModuleOption) => {
    setSelected(m);
    if (op === "update") {
      setName(m.name);
      setDesc("");
    }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleSubmit = async () => {
    setStage("submitting");
    setError(null);
    try {
      if (op === "create") {
        const { error: e } = await supabase
          .from("modules")
          .insert({ name: name.trim(), description: desc.trim() || null });
        if (e) throw new Error(e.message);
      } else if (op === "update" && selectedModule) {
        const { error: e } = await supabase
          .from("modules")
          .update({ name: name.trim(), description: desc.trim() || null })
          .eq("name", selectedModule.name);
        if (e) throw new Error(e.message);
      } else if (op === "delete" && selectedModule) {
        const { error: e } = await supabase
          .from("modules")
          .delete()
          .eq("name", selectedModule.name);
        if (e) throw new Error(e.message);
      }
      setStage("done");
      onDone();
    } catch (e: any) {
      setError(e.message);
      setStage("confirm");
    }
  };

  const subtitle =
    stage === "selectop"
      ? "Choose operation"
      : stage === "selectmodule"
      ? "Pick a module"
      : stage === "fillform"
      ? "Enter details"
      : stage === "confirm"
      ? "Review & confirm"
      : stage === "done"
      ? "Done!"
      : "…";

  return (
    <ModalShell
      title="Modules"
      icon={<Package size={16} />}
      subtitle={subtitle}
      onClose={onClose}
    >
      {stage === "selectop" && (
        <div className="flex flex-col gap-2">
          {MODULE_OP_META.map((m) => (
            <button
              key={m.id}
              onClick={() => handleOpSelect(m.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-left transition-all"
            >
              {m.icon}
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
              onClick={() => handleModuleSelect(m)}
              className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-sm text-t-primary transition-colors"
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      {stage === "fillform" && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-t-muted mb-1">
              Module Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input text-sm"
              placeholder="e.g. CAR-01"
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">
              Description (optional)
            </label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="input text-sm"
              placeholder="Short description"
            />
          </div>
          <button
            onClick={() => setStage("confirm")}
            disabled={!name.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Review
          </button>
        </div>
      )}
      {stage === "confirm" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-3 flex flex-col gap-1.5 text-xs">
            <Row label="Operation" value={op.toUpperCase()} brand />
            {op !== "create" && (
              <Row label="Target" value={selectedModule?.name ?? ""} mono />
            )}
            {op !== "delete" && (
              <>
                <Row label="Name" value={name} />
                <Row label="Desc" value={desc || "—"} />
              </>
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() =>
                setStage(
                  op === "create"
                    ? "fillform"
                    : op === "delete"
                    ? "selectmodule"
                    : "fillform"
                )
              }
              className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary text-sm"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white ${
                op === "delete" ? "bg-red-500 hover:bg-red-600" : "btn-primary"
              }`}
            >
              Confirm {op}
            </button>
          </div>
        </div>
      )}
      {stage === "submitting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm text-t-primary font-semibold">Done!</p>
          <button onClick={onClose} className="btn-primary text-sm px-6">
            Close
          </button>
        </div>
      )}
    </ModalShell>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT TESTS MODAL
// ══════════════════════════════════════════════════════════════════════════════
type TestOp = "create" | "update" | "delete";
type TestManualStage =
  | "selectop"
  | "selecttest"
  | "fillform"
  | "confirm"
  | "submitting"
  | "done";

const TEST_OP_META = [
  {
    id: "create" as TestOp,
    label: "Create",
    icon: <Plus size={20} />,
    desc: "Add a new test",
  },
  {
    id: "update" as TestOp,
    label: "Update",
    icon: <Pencil size={20} />,
    desc: "Edit test details",
  },
  {
    id: "delete" as TestOp,
    label: "Delete",
    icon: <Trash2 size={20} />,
    desc: "Remove a test",
  },
];

const ImportTestsModal: React.FC<{
  onClose: () => void;
  onDone: () => void;
}> = ({ onClose, onDone }) => {
  const [stage, setStage] = useState<TestManualStage>("selectop");
  const [op, setOp] = useState<TestOp>("create");
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTest, setSelected] = useState<TestOption | null>(null);
  const [sn, setSn] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("tests")
      .select("serial_no, name")
      .order("serial_no")
      .then(({ data }: { data: any }) =>
        setTests((data ?? []) as TestOption[])
      );
  }, []);

  const handleOpSelect = (o: TestOp) => {
    setOp(o);
    setStage(o === "create" ? "fillform" : "selecttest");
  };

  const handleTestSelect = (t: TestOption) => {
    setSelected(t);
    if (op === "update") {
      setSn(String(t.serial_no));
      setName(t.name);
    }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleSubmit = async () => {
    setStage("submitting");
    setError(null);
    try {
      const snNum = parseFloat(sn);
      if (op === "create") {
        const { error: e } = await supabase
          .from("tests")
          .insert({ serial_no: snNum, name: name.trim() });
        if (e) throw new Error(e.message);
      } else if (op === "update" && selectedTest) {
        const { error: e } = await supabase
          .from("tests")
          .update({ serial_no: snNum, name: name.trim() })
          .eq("name", selectedTest.name);
        if (e) throw new Error(e.message);
      } else if (op === "delete" && selectedTest) {
        const { error: e } = await supabase
          .from("tests")
          .delete()
          .eq("name", selectedTest.name);
        if (e) throw new Error(e.message);
      }
      setStage("done");
      onDone();
    } catch (e: any) {
      setError(e.message);
      setStage("confirm");
    }
  };

  return (
    <ModalShell
      title="Tests"
      icon={<FlaskConical size={16} />}
      subtitle={
        stage === "selectop"
          ? "Choose operation"
          : stage === "selecttest"
          ? "Pick a test"
          : stage === "fillform"
          ? "Enter details"
          : stage === "confirm"
          ? "Review & confirm"
          : "…"
      }
      onClose={onClose}
    >
      {stage === "selectop" && (
        <div className="flex flex-col gap-2">
          {TEST_OP_META.map((m) => (
            <button
              key={m.id}
              onClick={() => handleOpSelect(m.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-left transition-all"
            >
              {m.icon}
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
      {stage === "selecttest" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {tests.map((t) => (
            <button
              key={t.name}
              onClick={() => handleTestSelect(t)}
              className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-sm text-t-primary"
            >
              <span className="font-mono text-c-brand mr-2">{t.serial_no}</span>
              {t.name}
            </button>
          ))}
        </div>
      )}
      {stage === "fillform" && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-t-muted mb-1">Serial No</label>
            <input
              value={sn}
              onChange={(e) => setSn(e.target.value)}
              className="input text-sm"
              placeholder="e.g. 1.1"
              type="number"
              step="0.01"
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">Test Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input text-sm"
              placeholder="e.g. Pantograph Test"
            />
          </div>
          <button
            onClick={() => setStage("confirm")}
            disabled={!name.trim() || !sn.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Review
          </button>
        </div>
      )}
      {stage === "confirm" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-[var(--border-color)] bg-bg-card p-3 flex flex-col gap-1.5 text-xs">
            <Row label="Operation" value={op.toUpperCase()} brand />
            {op !== "create" && selectedTest && (
              <>
                {op === "update" && (
                  <>
                    <DiffRow
                      label="Serial No"
                      before={String(selectedTest.serial_no)}
                      after={sn}
                    />
                    <DiffRow
                      label="Name"
                      before={selectedTest.name}
                      after={name}
                    />
                  </>
                )}
                {op === "delete" && (
                  <Row label="Delete" value={selectedTest.name} mono />
                )}
              </>
            )}
            {op === "create" && (
              <>
                <Row label="S/N" value={sn} mono />
                <Row label="Name" value={name} />
              </>
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() =>
                setStage(op === "create" ? "fillform" : "selecttest")
              }
              className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-t-secondary text-sm"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white ${
                op === "delete" ? "bg-red-500 hover:bg-red-600" : "btn-primary"
              }`}
            >
              Confirm {op}
            </button>
          </div>
        </div>
      )}
      {stage === "submitting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Done!</p>
          <button onClick={onClose} className="btn-primary text-sm px-6">
            Close
          </button>
        </div>
      )}
    </ModalShell>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT STEPS MODAL (CSV)
// ══════════════════════════════════════════════════════════════════════════════
type StepCsvStage =
  | "selectmodule"
  | "selecttest"
  | "upload"
  | "preview"
  | "confirm"
  | "submitting"
  | "done"
  | "error";

const ImportStepsModal: React.FC<{
  onClose: () => void;
  onDone: () => void;
}> = ({ onClose, onDone }) => {
  const [stage, setStage] = useState<StepCsvStage>("selectmodule");
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [tests, setTests] = useState<{ id: string; testsname: string }[]>([]);
  const [selMod, setSelMod] = useState<string>("");
  const [selTest, setSelTest] = useState<string>("");
  const [parsed, setParsed] = useState<StepInput[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      const payload = parsed.map((r) => ({
        serial_no: r.serial_no,
        action: r.action,
        expected_result: r.expected_result,
        is_divider: r.is_divider,
        testsname: selTest,
      }));
      const { error: e } = await supabase
        .from("test_steps")
        .upsert(payload, { onConflict: "testsname,serial_no" });
      if (e) throw new Error(e.message);
      setStage("done");
      onDone();
    } catch (e: any) {
      setSubmitError(e.message);
      setStage("confirm");
    }
  };

  return (
    <ModalShell
      title="Import Steps (CSV)"
      icon={<Hash size={16} />}
      subtitle={
        stage === "selectmodule"
          ? "Pick a trainset"
          : stage === "selecttest"
          ? "Pick a test"
          : stage === "upload"
          ? "Upload CSV"
          : stage === "preview"
          ? `${parsed.length} steps parsed`
          : stage === "confirm"
          ? "Review & confirm"
          : stage === "done"
          ? "Done!"
          : "…"
      }
      onClose={onClose}
    >
      {stage === "selectmodule" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {modules.map((m) => (
            <button
              key={m.name}
              onClick={() => handleModuleSelect(m.name)}
              className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-sm text-t-primary"
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      {stage === "selecttest" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {tests.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setSelTest(t.testsname);
                setStage("upload");
              }}
              className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-sm text-t-primary"
            >
              {t.testsname}
            </button>
          ))}
        </div>
      )}
      {stage === "upload" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            CSV must have columns:{" "}
            <span className="font-mono text-t-primary">
              serial_no, action, expected_result, is_divider
            </span>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="btn-primary text-sm flex items-center justify-center gap-2"
          >
            <Upload size={14} />
            Choose CSV file
          </button>
        </div>
      )}
      {(stage === "preview" || stage === "confirm") && (
        <div className="flex flex-col gap-3">
          {parseErrors.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
              {parseErrors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-[var(--border-color)] overflow-hidden max-h-48 overflow-y-auto">
            <div className="bg-bg-card px-3 py-2 border-b border-[var(--border-color)]">
              <p className="text-xs font-semibold text-t-muted uppercase tracking-wider">
                {parsed.length} Steps — {selMod} › {selTest}
              </p>
            </div>
            {parsed.slice(0, 20).map((r) => (
              <div
                key={r.serial_no}
                className="flex items-start gap-2 px-3 py-2 border-b border-[var(--border-color)] last:border-b-0 text-xs"
              >
                <span className="font-mono text-c-brand w-6 shrink-0">
                  {r.serial_no}
                </span>
                <span className="text-t-primary flex-1 break-all">
                  {r.is_divider ? (
                    <em className="text-t-muted">divider</em>
                  ) : (
                    r.action
                  )}
                </span>
              </div>
            ))}
            {parsed.length > 20 && (
              <div className="px-3 py-2 text-xs text-t-muted">
                …and {parsed.length - 20} more
              </div>
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
            <button
              onClick={handleSubmit}
              className="flex-1 btn-primary text-sm"
            >
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
            {parseErrors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
          <button
            onClick={() => setStage("upload")}
            className="btn-primary text-sm"
          >
            Try again
          </button>
        </div>
      )}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">
            Steps imported!
          </p>
          <button onClick={onClose} className="btn-primary text-sm px-6">
            Close
          </button>
        </div>
      )}
    </ModalShell>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT STEPS MANUAL MODAL
// ══════════════════════════════════════════════════════════════════════════════
type StepManualStage =
  | "selectop"
  | "selectmodule"
  | "selecttest"
  | "selectstep"
  | "fillform"
  | "confirm"
  | "submitting"
  | "done";
type StepOp = "create" | "update" | "delete";

interface ExistingStep {
  id: string;
  serial_no: number;
  action: string;
  expected_result: string;
  is_divider: boolean;
}

const ImportStepsManualModal: React.FC<{
  onClose: () => void;
  onDone: () => void;
}> = ({ onClose, onDone }) => {
  const [stage, setStage] = useState<StepManualStage>("selectop");
  const [op, setOp] = useState<StepOp>("create");
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [tests, setTests] = useState<{ id: string; testsname: string }[]>([]);
  const [steps, setSteps] = useState<ExistingStep[]>([]);
  const [selMod, setSelMod] = useState("");
  const [selTest, setSelTest] = useState("");
  const [selStep, setSelStep] = useState<ExistingStep | null>(null);
  const [sn, setSn] = useState("");
  const [action, setAction] = useState("");
  const [expected, setExpected] = useState("");
  const [is_divider, setis_divider] = useState(false);
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

  const handleTestSelect = async (testsname: string) => {
    setSelTest(testsname);
    if (op !== "create") {
      const { data } = await supabase
        .from("test_steps")
        .select("id, serial_no, action, expected_result, is_divider")
        .eq("testsname", testsname)
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
      setis_divider(step.is_divider);
    }
    setStage(op === "delete" ? "confirm" : "fillform");
  };

  const handleSubmit = async () => {
    setStage("submitting");
    setError(null);
    try {
      if (op === "create") {
        const { error: e } = await supabase
          .from("test_steps")
          .insert({
            serial_no: parseFloat(sn),
            action,
            expected_result: expected,
            is_divider: is_divider,
            testsname: selTest,
          });
        if (e) throw new Error(e.message);
      } else if (op === "update" && selStep) {
        const { error: e } = await supabase
          .from("test_steps")
          .update({
            serial_no: parseFloat(sn),
            action,
            expected_result: expected,
            is_divider: is_divider,
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
      onDone();
    } catch (e: any) {
      setError(e.message);
      setStage("confirm");
    }
  };

  return (
    <ModalShell
      title="Steps (Manual)"
      icon={<Hash size={16} />}
      subtitle={
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
          : "…"
      }
      onClose={onClose}
    >
      {stage === "selectop" && (
        <div className="flex flex-col gap-2">
          {(["create", "update", "delete"] as StepOp[]).map((o) => (
            <button
              key={o}
              onClick={() => {
                setOp(o);
                setStage("selectmodule");
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-left transition-all"
            >
              {o === "create" ? (
                <Plus size={20} />
              ) : o === "update" ? (
                <Pencil size={20} />
              ) : (
                <Trash2 size={20} />
              )}
              <p className="text-sm font-semibold text-t-primary capitalize">
                {o}
              </p>
            </button>
          ))}
        </div>
      )}
      {stage === "selectmodule" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {modules.map((m) => (
            <button
              key={m.name}
              onClick={() => handleModuleSelect(m.name)}
              className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-sm text-t-primary"
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      {stage === "selecttest" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {tests.map((t) => (
            <button
              key={t.id}
              onClick={() => handleTestSelect(t.testsname)}
              className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-sm text-t-primary"
            >
              {t.testsname}
            </button>
          ))}
        </div>
      )}
      {stage === "selectstep" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {steps.map((s) => (
            <button
              key={s.id}
              onClick={() => handleStepSelect(s)}
              className="text-left px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card hover:bg-bg-base text-xs text-t-primary"
            >
              <span className="font-mono text-c-brand mr-2">{s.serial_no}</span>
              {s.is_divider ? (
                <em className="text-t-muted">divider</em>
              ) : (
                s.action
              )}
            </button>
          ))}
        </div>
      )}
      {stage === "fillform" && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-t-muted mb-1">Serial No</label>
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
              onChange={(e) => setis_divider(e.target.checked)}
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
                op === "delete" ? "bg-red-500 hover:bg-red-600" : "btn-primary"
              }`}
            >
              Confirm {op}
            </button>
          </div>
        </div>
      )}
      {stage === "submitting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Done!</p>
          <button onClick={onClose} className="btn-primary text-sm px-6">
            Close
          </button>
        </div>
      )}
    </ModalShell>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN MobileNav COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
interface Props {
  activePage: string;
  onNavigate: (page: string, module_name?: string) => void;
}

type ActiveModal =
  | "export"
  | "modules"
  | "tests"
  | "steps-csv"
  | "steps-manual"
  | "theme"
  | null;

const MobileNav: React.FC<Props> = ({ activePage, onNavigate }) => {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [activeModal, setModal] = useState<ActiveModal>(null);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    fetchModuleOptions()
      .then(setModules)
      .catch(() => {});
  }, []);

  const handleSignOut = async () => {
    if (user?.id) await releaseLocksAndSignOut(user.id, signOut);
    else await signOut();
  };

  const close = () => setModal(null);

  const navItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard size={20} />,
    },
    { id: "report", label: "Report", icon: <ClipboardList size={20} /> }, // ← was 'test-report'
    ...(isAdmin
      ? [
          { id: "users", label: "Users", icon: <Users size={20} /> },
          {
            id: "audit_log",
            label: "Audit Log",
            icon: <ScrollText size={20} />,
          }, // ← was 'audit-log'
        ]
      : []),
  ];

  return (
    <>
      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 inset-x-0 z-50 md:hidden bg-bg-nav border-t border-[var(--border-color)] flex items-center justify-around px-2 h-16">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors text-[10px] font-semibold
              ${
                activePage === item.id
                  ? "text-c-brand"
                  : "text-t-muted hover:text-t-primary"
              }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}

        {/* Module shortcut */}
        {modules.length > 0 && (
          <button
            onClick={() => onNavigate("module", modules[0].name)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors text-[10px] font-semibold
              ${
                activePage === "module"
                  ? "text-c-brand"
                  : "text-t-muted hover:text-t-primary"
              }`}
          >
            <FolderOpen size={20} />
            Module
          </button>
        )}

        {/* More menu */}
        <button
          onClick={() => setMenuOpen((p) => !p)}
          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-t-muted hover:text-t-primary transition-colors"
        >
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>

      {/* More menu overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-60 md:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="absolute bottom-16 right-0 w-56 bg-bg-surface border border-[var(--border-color)] rounded-2xl shadow-2xl p-2 m-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Theme toggle */}
            <button
              onClick={() => {
                setTheme(theme === "dark" ? "light" : "dark");
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>

            {/* Theme editor */}
            <button
              onClick={() => {
                setModal("theme");
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
            >
              <Palette size={16} />
              Theme Editor
            </button>

            {isAdmin && (
              <>
                <div className="h-px bg-[var(--border-color)] my-1" />
                <p className="text-[10px] font-bold text-t-muted uppercase tracking-wider px-3 py-1">
                  Data
                </p>

                <button
                  onClick={() => {
                    setModal("export");
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
                >
                  <Download size={16} />
                  Export all data
                </button>
                <button
                  onClick={() => {
                    setModal("modules");
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
                >
                  <Package size={16} />
                  Manage modules
                </button>
                <button
                  onClick={() => {
                    setModal("tests");
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
                >
                  <FlaskConical size={16} />
                  Manage tests
                </button>
                <button
                  onClick={() => {
                    setModal("steps-csv");
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
                >
                  <Upload size={16} />
                  Import steps (CSV)
                </button>
                <button
                  onClick={() => {
                    setModal("steps-manual");
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-t-secondary hover:bg-bg-card hover:text-t-primary transition-colors"
                >
                  <Hash size={16} />
                  Manage steps
                </button>
              </>
            )}

            <div className="h-px bg-[var(--border-color)] my-1" />
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {activeModal === "export" && <ExportDataModal onClose={close} />}
      {activeModal === "modules" && (
        <ImportModulesModal onClose={close} onDone={close} />
      )}
      {activeModal === "tests" && (
        <ImportTestsModal onClose={close} onDone={close} />
      )}
      {activeModal === "steps-csv" && (
        <ImportStepsModal onClose={close} onDone={close} />
      )}
      {activeModal === "steps-manual" && (
        <ImportStepsManualModal onClose={close} onDone={close} />
      )}
      {activeModal === "theme" && (
        <div className="fixed inset-0 z-70 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <div className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto bg-bg-surface rounded-t-2xl border-t border-[var(--border-color)]">
            <ThemeEditor onClose={close} />
          </div>
        </div>
      )}
    </>
  );
};

export default MobileNav;
