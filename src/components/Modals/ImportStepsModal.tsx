// src/components/Modals/ImportStepsModal.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Hash,
  CheckCircle,
  ArrowLeft,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Lock,
  Upload,
  AlertCircle,
  Info,
  Play,
  Eye,
  Pencil,
} from "lucide-react";
import ModalShell from "../UI/ModalShell";
import { Row } from "../UI/ReviewRow";
import { supabase } from "../../supabase";

import {
  parseCsv,
  computeDiff,
  buildFirstRevisionPayload,
  buildDiffRevisionPayload,
  getNextRevisionId,
  resolveBaseSteps,
  type DiffResult,
  type DiffItem,
  type RevisionPayload,
  type BaseStep,
  type ParseResult,
} from "../../utils/revisionDiffEngine.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage =
  | "selectaction"
  | "revctrl-test"
  | "rev-control"
  | "rev-info"
  | "rev-diff"
  | "rev-confirm"
  | "submitting"
  | "done"
  | "vis-module"
  | "vis-list";

interface ActiveRevInfo {
  id: string;
  step_order: string[];
  created_at: string;
  notes: string | null;
  status: string;
}

interface RevisionListItem {
  id: string;
  status: string;
  created_at: string;
  notes: string | null;
  /** count of step_order entries from DB — no full fetch */
  step_count: number;
}

interface ModuleTestVisRow {
  id: string;
  module_name: string;
  tests_name: string;
  is_visible: boolean;
  lockInfo: { user_id: string; locked_by_name: string } | null;
}

interface Props {
  onClose: () => void;
  onBack: () => void;
}

// ─── Diff type colours ────────────────────────────────────────────────────────

const TYPE_STYLES: Record<string, { badge: string; row: string }> = {
  UNCHANGED: {
    badge: "bg-green-500/15 text-green-400 border-green-500/20",
    row:   "hover:bg-green-500/5",
  },
  EDIT: {
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    row:   "hover:bg-amber-500/5",
  },
  INSERT: {
    badge: "bg-sky-500/15 text-sky-400 border-sky-500/20",
    row:   "hover:bg-sky-500/5",
  },
  DELETE: {
    badge: "bg-red-500/15 text-red-400 border-red-500/20",
    row:   "hover:bg-red-500/5",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, n = 52): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const parseStepOrder = (so: any): string[] =>
  typeof so === "string" ? JSON.parse(so) : (so ?? []);

// ─── Inline Progress Bar ──────────────────────────────────────────────────────

interface ProgressState { show: boolean; percent: number; message: string; }

const InlineProgress: React.FC<ProgressState> = ({ show, percent, message }) => {
  if (!show) return null;
  return (
    <div className="w-full rounded-lg border border-(--border-color) bg-bg-card p-3 flex flex-col gap-2">
      <div className="flex justify-between text-[11px] font-medium text-t-muted">
        <span>{message}</span>
        <span className="text-c-brand font-bold">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-bg-base overflow-hidden border border-(--border-color)">
        <div
          className="h-full rounded-full bg-c-brand transition-[width] duration-200 ease-out"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
};

// ─── Diff Table ───────────────────────────────────────────────────────────────

const DiffTableRow: React.FC<{ item: DiffItem; index: number }> = ({ item, index }) => {
  const [open, setOpen] = useState(false);
  const style = TYPE_STYLES[item.type];

  const previewAction =
    item.type === "UNCHANGED" ? item.step.action
    : item.type === "EDIT"    ? item.old.action
    : item.type === "INSERT"  ? item.row.action
    : item.step.action;

  const previewExpected =
    item.type === "UNCHANGED" ? item.step.expected_result
    : item.type === "EDIT"    ? item.old.expected_result
    : item.type === "INSERT"  ? item.row.expected_result
    : item.step.expected_result;

  return (
    <>
      <tr
        onClick={() => setOpen(o => !o)}
        className={`cursor-pointer border-b border-(--border-color) transition-colors ${style.row} ${
          item.type === "DELETE" ? "opacity-60" : ""
        }`}
      >
        <td className="px-3 py-2.5 text-[11px] font-mono text-t-muted text-right whitespace-nowrap w-8">
          {item.type === "DELETE" ? "—" : `#${item.position}`}
        </td>
        <td className="px-2 py-2.5 w-10">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border leading-none ${style.badge}`}>
            {item.type[0]}
          </span>
        </td>
        <td className="px-2 py-2.5 text-[11px] font-mono text-t-muted whitespace-nowrap w-10">
          {item.serialNo}
        </td>
        <td className="px-2 py-2.5 text-xs text-t-secondary max-w-[180px]">
          <p className="truncate">{truncate(previewAction ?? "")}</p>
        </td>
        <td className="px-2 py-2.5 text-xs text-t-muted max-w-[140px]">
          <p className="truncate">{truncate(previewExpected ?? "", 40)}</p>
        </td>
        <td className="px-2 py-2.5 w-6 text-right">
          {open
            ? <ChevronDown  size={12} className="text-t-muted inline" />
            : <ChevronRight size={12} className="text-t-muted inline" />}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-(--border-color)">
          <td colSpan={6} className="px-4 pb-3 pt-2 bg-bg-base/40">
            {item.type === "UNCHANGED" && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[10px] text-t-muted uppercase tracking-wide mb-1">Step ID</p>
                  <p className="font-mono text-t-secondary text-[11px]">{item.step.id}</p>
                </div>
                <div>
                  <p className="text-[10px] text-t-muted uppercase tracking-wide mb-1">S/N</p>
                  <p className="font-mono text-t-secondary">{item.step.serial_no}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] text-t-muted uppercase tracking-wide mb-1">Action</p>
                  <p className="text-t-primary whitespace-pre-wrap">{item.step.action}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] text-t-muted uppercase tracking-wide mb-1">Expected</p>
                  <p className="text-t-secondary">{item.step.expected_result || "—"}</p>
                </div>
              </div>
            )}
            {item.type === "EDIT" && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-2.5">
                  <p className="text-[10px] text-red-400 font-bold uppercase tracking-wide mb-2">Before</p>
                  <p className="text-[10px] text-t-muted mb-0.5">ID</p>
                  <p className="font-mono text-t-secondary text-[11px] mb-2">{item.old.id}</p>
                  <p className="text-[10px] text-t-muted mb-0.5">Action</p>
                  <p className="text-t-primary whitespace-pre-wrap mb-2">{item.old.action}</p>
                  <p className="text-[10px] text-t-muted mb-0.5">Expected</p>
                  <p className="text-t-secondary">{item.old.expected_result || "—"}</p>
                </div>
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-2.5">
                  <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wide mb-2">After</p>
                  <p className="text-[10px] text-t-muted mb-0.5">New ID</p>
                  <p className="font-mono text-t-muted text-[11px] italic mb-2">minted on save</p>
                  <p className="text-[10px] text-t-muted mb-0.5">Action</p>
                  <p className="text-t-primary whitespace-pre-wrap mb-2">{item.new.action}</p>
                  <p className="text-[10px] text-t-muted mb-0.5">Expected</p>
                  <p className="text-t-secondary">{item.new.expected_result || "—"}</p>
                </div>
              </div>
            )}
            {item.type === "INSERT" && (
              <div className="rounded-lg bg-sky-500/5 border border-sky-500/15 p-2.5 text-xs">
                <p className="text-[10px] text-sky-400 font-bold uppercase tracking-wide mb-2">New Step</p>
                <p className="text-[10px] text-t-muted mb-0.5">Action</p>
                <p className="text-t-primary whitespace-pre-wrap mb-2">{item.row.action}</p>
                <p className="text-[10px] text-t-muted mb-0.5">Expected</p>
                <p className="text-t-secondary">{item.row.expected_result || "—"}</p>
              </div>
            )}
            {item.type === "DELETE" && (
              <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-2.5 text-xs">
                <p className="text-[10px] text-red-400 font-bold uppercase tracking-wide mb-2">
                  Removed from order (row preserved)
                </p>
                <p className="text-[10px] text-t-muted mb-0.5">Step ID</p>
                <p className="font-mono text-t-secondary text-[11px] mb-2">{item.step.id}</p>
                <p className="text-[10px] text-t-muted mb-0.5">Action</p>
                <p className="text-t-primary whitespace-pre-wrap">{item.step.action}</p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

const DiffTable: React.FC<{ items: DiffItem[] }> = ({ items }) => (
  <div className="rounded-xl border border-(--border-color) overflow-hidden">
    <div className="overflow-y-auto" style={{ maxHeight: "420px" }}>
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="border-b border-(--border-color)">
            <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted text-right w-8">Pos</th>
            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted w-10">Type</th>
            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted w-10">S/N</th>
            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted">Action</th>
            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted">Expected</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <DiffTableRow key={i} item={item} index={i} />
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const FirstImportTable: React.FC<{ rows: ParseResult["rows"] }> = ({ rows }) => (
  <div className="rounded-xl border border-(--border-color) overflow-hidden">
    <div className="overflow-y-auto" style={{ maxHeight: "420px" }}>
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="border-b border-(--border-color)">
            <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted w-10">S/N</th>
            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted">Action</th>
            <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted">Expected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-(--border-color) hover:bg-sky-500/5 transition-colors">
              <td className="px-3 py-2.5 text-[11px] font-mono text-sky-400 w-10">{r.serial_no}</td>
              <td className="px-2 py-2.5 text-xs text-t-secondary max-w-[200px]">
                <p className="truncate">{r.action || "—"}</p>
              </td>
              <td className="px-2 py-2.5 text-xs text-t-muted max-w-[140px]">
                <p className="truncate">{r.expected_result || "—"}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// ─── Step Order Table ─────────────────────────────────────────────────────────

const STEP_PAGE = 10;

const StepOrderTable: React.FC<{
  stepOrder: string[];
  newStepIds: Set<string>;
}> = ({ stepOrder, newStepIds }) => {
  const [visible, setVisible] = useState(STEP_PAGE);
  const remaining = stepOrder.length - visible;

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-(--border-color) overflow-hidden">
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "360px" }}
          onScroll={e => {
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 60)
              setVisible(v => Math.min(v + STEP_PAGE, stepOrder.length));
          }}
        >
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-bg-card">
              <tr className="border-b border-(--border-color)">
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted w-10 text-right">#</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted">Step ID</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted w-20 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {stepOrder.slice(0, visible).map((id, i) => {
                const isNew = newStepIds.has(id);
                return (
                  <tr
                    key={id}
                    className={`border-b border-(--border-color) transition-colors ${
                      isNew ? "hover:bg-sky-500/5" : "hover:bg-bg-base/50"
                    }`}
                  >
                    <td className="px-3 py-2.5 text-[11px] font-mono text-t-muted text-right w-10">{i + 1}</td>
                    <td className="px-3 py-2.5 text-[11px] font-mono">
                      <span className={isNew ? "text-sky-400" : "text-t-secondary"}>{id}</span>
                    </td>
                    <td className="px-3 py-2.5 w-20 text-center">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border leading-none ${
                          isNew
                            ? "bg-sky-500/15 text-sky-400 border-sky-500/20"
                            : "bg-bg-base text-t-muted border-(--border-color)"
                        }`}
                      >
                        {isNew ? "NEW" : "REUSED"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {remaining > 0 && (
        <button
          onClick={() => setVisible(v => Math.min(v + STEP_PAGE, stepOrder.length))}
          className="w-full py-2 rounded-xl border border-(--border-color) text-xs
            text-t-muted hover:text-t-primary hover:border-c-brand/40 transition-colors"
        >
          Show {Math.min(remaining, STEP_PAGE)} more
          <span className="ml-1 text-[10px] text-t-muted">({remaining} remaining)</span>
        </button>
      )}
      <p className="text-[10px] text-t-muted">
        <span className="text-sky-400 font-bold">NEW</span> = new step rows ·{" "}
        <span className="font-bold">REUSED</span> = unchanged from previous revision
      </p>
    </div>
  );
};

// ─── Diff stat card ───────────────────────────────────────────────────────────

const DiffStats: React.FC<{ summary: DiffResult["summary"] }> = ({ summary }) => (
  <div className="grid grid-cols-4 gap-1.5">
    {(
      [
        ["Unchanged", summary.unchanged, "green"],
        ["Edited",    summary.edited,    "amber"],
        ["Inserted",  summary.inserted,  "sky"],
        ["Deleted",   summary.deleted,   "red"],
      ] as const
    ).map(([label, count, color]) => (
      <div
        key={label}
        className={`rounded-lg border px-2 py-2 text-center bg-${color}-500/5 border-${color}-500/20`}
      >
        <p className={`text-base font-bold leading-none text-${color}-400`}>{count}</p>
        <p className="text-[9px] text-t-muted uppercase tracking-wide mt-1">{label}</p>
      </div>
    ))}
  </div>
);

// ─── Main Modal ───────────────────────────────────────────────────────────────

const ImportStepsModal: React.FC<Props> = ({ onClose, onBack }) => {

  // ── Shared ────────────────────────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>("selectaction");
  const [tests,  setTests]  = useState<{ serial_no: string; name: string }[]>([]);
  const [error,  setError]  = useState<string | null>(null);

  // ── Progress ──────────────────────────────────────────────────────────────────
  const [progress, setProgress] = useState<ProgressState>({ show: false, percent: 0, message: "" });

  const showProgress = (message: string, percent: number) =>
    setProgress({ show: true, message, percent });

  const hideProgress = async (delay = 300) => {
    setProgress(p => ({ ...p, percent: 100 }));
    await sleep(delay);
    setProgress({ show: false, percent: 0, message: "" });
  };

  // ── Revision control state ────────────────────────────────────────────────────
  const [revSelTest,     setRevSelTest]     = useState("");
  const [allRevisions,   setAllRevisions]   = useState<RevisionListItem[]>([]);
  const [activeRev,      setActiveRev]      = useState<ActiveRevInfo | null>(null);
  const [revLoading,     setRevLoading]     = useState(false);
  const [existingRevIds, setExistingRevIds] = useState<string[]>([]);
  const [baseSteps,      setBaseSteps]      = useState<BaseStep[]>([]);
  const [newRevId,       setNewRevId]       = useState("");
  const [revMode,        setRevMode]        = useState<"iterate" | "branch">("iterate");
  const [csvText,        setCsvText]        = useState("");
  const [parseResult,    setParseResult]    = useState<ParseResult | null>(null);
  const [diffResult,     setDiffResult]     = useState<DiffResult | null>(null);
  const [revNotes,       setRevNotes]       = useState("");
  const [revPayload,     setRevPayload]     = useState<RevisionPayload | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Visibility state ──────────────────────────────────────────────────────────
  const [visModules,   setVisModules]   = useState<string[]>([]);
  const [visSelModule, setVisSelModule] = useState("");
  const [visRows,      setVisRows]      = useState<ModuleTestVisRow[]>([]);
  const [visLoading,   setVisLoading]   = useState(false);

  // ── Load test list on mount (RPC-style single select) ─────────────────────────
  useEffect(() => {
    supabase
      .from("tests")
      .select("serial_no, name")
      .order("serial_no")
      .then(({ data }) =>
        setTests((data ?? []) as { serial_no: string; name: string }[])
      );
  }, []);

  // ─── Navigation ───────────────────────────────────────────────────────────────

  const handleBack = () => {
    switch (stage) {
      case "selectaction": return onBack();
      case "revctrl-test":  return setStage("selectaction");
      case "rev-control":   return setStage("revctrl-test");
      case "rev-info":      return setStage("rev-control");
      case "rev-diff":      return setStage("rev-info");
      case "rev-confirm":   return setStage("rev-diff");
      case "vis-module": return setStage("selectaction");
      case "vis-list":   return setStage("vis-module");
      default: break;
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // REVISION CONTROL — loadRevisionControl
  //
  // RPC strategy:
  //   1. supabase.rpc("get_revision_list", { p_tests_serial_no })
  //      Returns: id, status, created_at, notes, step_count (jsonb_array_length)
  //      No test_steps rows fetched here at all.
  //
  //   2. step_order array count for active rev comes from the RPC itself.
  //      baseSteps stays [] until "Generate Diff" is clicked.
  // ─────────────────────────────────────────────────────────────────────────────

  const loadRevisionControl = async (testSerialNo: string) => {
    setRevLoading(true);
    setStage("rev-control");
    setActiveRev(null);
    setAllRevisions([]);
    setBaseSteps([]);           // reset — will be populated lazily on diff click
    setExistingRevIds([]);
    setError(null);

    try {
      // ── Single RPC: get all revision metadata + step_count from Postgres ──
      // Deploy this function in Supabase:
      //
      //   create or replace function get_revision_list(p_tests_serial_no text)
      //   returns table (
      //     id          text,
      //     status      text,
      //     step_order  jsonb,
      //     created_at  timestamptz,
      //     notes       text,
      //     step_count  int
      //   )
      //   language sql stable security definer as $$
      //     select
      //       id,
      //       status,
      //       step_order,
      //       created_at,
      //       notes,
      //       jsonb_array_length(step_order) as step_count
      //     from test_revisions
      //     where tests_serial_no = p_tests_serial_no
      //     order by created_at asc;
      //   $$;
      //
      const { data: revRows, error: revsErr } = await supabase
        .rpc("get_revision_list", { p_tests_serial_no: testSerialNo });
      if (revsErr) throw new Error(revsErr.message);

      const allRevs = (revRows ?? []) as Array<{
        id: string;
        status: string;
        step_order: any;
        created_at: string;
        notes: string | null;
        step_count: number;
      }>;

      const codes = allRevs.map(r =>
        r.id.startsWith(testSerialNo + "-") ? r.id.slice(testSerialNo.length + 1) : r.id
      );
      setExistingRevIds(codes);
      setNewRevId(getNextRevisionId(codes, "iterate"));

      const activeRaw = allRevs.find(r => r.status === "active") ?? null;
      const active = activeRaw
        ? {
            ...activeRaw,
            step_order: parseStepOrder(activeRaw.step_order),
          }
        : null;
      setActiveRev(active);

      setAllRevisions(
        allRevs.map(r => ({
          id:         r.id,
          status:     r.status,
          created_at: r.created_at,
          notes:      r.notes,
          step_count: r.step_count ?? 0, // comes from jsonb_array_length in RPC
        }))
      );

      // ── No test_steps fetch here — deferred to handleGenerateDiff ──
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRevLoading(false);
    }
  };

  const handleRevTestSelect = async (testSerialNo: string) => {
    setRevSelTest(testSerialNo);
    setError(null);
    await loadRevisionControl(testSerialNo);
  };

  const handleActivateRevision = async (revId: string) => {
    setRevLoading(true);
    setError(null);
    try {
      if (activeRev) {
        const { error: deactErr } = await supabase
          .from("test_revisions")
          .update({ status: "archived" })
          .eq("id", activeRev.id);
        if (deactErr) throw new Error(deactErr.message);
      }
      const { error: actErr } = await supabase
        .from("test_revisions")
        .update({ status: "active" })
        .eq("id", revId);
      if (actErr) throw new Error(actErr.message);
      await loadRevisionControl(revSelTest);
    } catch (e: any) {
      setError(e.message);
      setRevLoading(false);
    }
  };

  const handleStartNewRevision = () => {
    setCsvText("");
    setParseResult(null);
    setDiffResult(null);
    setRevPayload(null);
    setRevNotes("");
    setBaseSteps([]); // will be loaded lazily when diff is triggered
    setStage("rev-info");
  };

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showProgress("Reading CSV file…", 10);
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => resolve((ev.target?.result as string) ?? "");
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file, "UTF-8");
      });
      setCsvText(text);
      await sleep(150);
      showProgress("Reading CSV file…", 100);
      await hideProgress(200);
    } catch (e: any) {
      setError(e.message);
      setProgress({ show: false, percent: 0, message: "" });
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // handleGenerateDiff
  //
  // This is the ONLY place test_steps rows are fetched.
  // Fires after the user clicks "Generate Diff →" (i.e. after CSV import).
  //
  // Steps:
  //   1. Parse CSV (local, no network)
  //   2. If active revision exists → fetch test_steps for its step_order IDs
  //      filtered by eq(tests_serial_no) + eq(introduced_in_rev / active rev id)
  //      using .in("id", activeRev.step_order) which is already the narrowest
  //      possible filter (exact IDs).
  //   3. Resolve baseSteps → computeDiff
  // ─────────────────────────────────────────────────────────────────────────────

  const handleGenerateDiff = async () => {
    setError(null);
    showProgress("Parsing CSV…", 5);
    await sleep(50);

    const parsed = parseCsv(csvText);
    setParseResult(parsed);

    if (parsed.errors.length > 0) {
      await hideProgress(200);
      return;
    }

    showProgress("Parsing CSV…", 40);
    await sleep(50);

    const isFirst = !activeRev || activeRev.step_order.length === 0;

    if (!isFirst && activeRev) {
      showProgress("Fetching step rows…", 50);
      await sleep(50);

      // ── Fetch test_steps only now, filtered by exact step_order IDs ──
      const BATCH = 200;
      const batches = chunk(activeRev.step_order, BATCH);
      const allStepRows: any[] = [];

      for (const batch of batches) {
        const { data: stepRows, error: stepsErr } = await supabase
          .from("test_steps")
          .select("id, serial_no, action, expected_result, is_divider, introduced_in_rev, origin_step_id")
          .eq("tests_serial_no", revSelTest)
          .in("id", batch);
        if (stepsErr) throw new Error(stepsErr.message);
        allStepRows.push(...(stepRows ?? []));
      }

      const stepMap = new Map(allStepRows.map(s => [s.id, s]));
      const resolved = resolveBaseSteps(activeRev.step_order, stepMap as any);
      setBaseSteps(resolved);

      showProgress("Calculating differences…", 80);
      await sleep(50);

      const diff = computeDiff(resolved, parsed.rows);
      setDiffResult(diff);
    } else {
      setDiffResult(null);
    }

    showProgress("Done", 100);
    await hideProgress(250);
    setStage("rev-diff");
  };

  const handleBuildPayload = async () => {
    setError(null);
    showProgress("Generating step IDs & row numbers…", 10);
    await sleep(50);

    const { data: { user } } = await supabase.auth.getUser();
    const userId  = user?.id ?? "unknown";
    const isFirst = !activeRev || activeRev.step_order.length === 0;

    showProgress("Generating step IDs & row numbers…", 55);
    await sleep(50);

    const payload = isFirst
      ? buildFirstRevisionPayload(parseResult!.rows, newRevId, revSelTest, userId, revNotes)
      : buildDiffRevisionPayload(diffResult!, newRevId, revSelTest, userId, revNotes);
    setRevPayload(payload);

    showProgress("Generating step IDs & row numbers…", 100);
    await hideProgress(250);
    setStage("rev-confirm");
  };

  const handleRevisionSubmit = async () => {
    if (!revPayload) return;
    setStage("submitting");
    setError(null);
    showProgress("Uploading revision to Supabase…", 5);

    try {
      showProgress("Uploading revision to Supabase…", 25);
      const { error: revErr } = await supabase.from("test_revisions").insert({
        tests_serial_no: revSelTest,
        revision:        revPayload.revision.id,
        status:          "draft",
        step_order:      revPayload.revision.step_order,
        created_by:      revPayload.revision.created_by,
        notes:           revPayload.revision.notes || null,
        created_at:      new Date().toISOString(),
      });
      if (revErr) throw new Error(`test_revisions: ${revErr.message}`);

      showProgress("Saving step rows to Supabase…", 60);
      if (revPayload.newSteps.length > 0) {
        const { error: stepsErr } = await supabase
          .from("test_steps")
          .upsert(revPayload.newSteps, { onConflict: "id", ignoreDuplicates: true });
        if (stepsErr) throw new Error(`test_steps: ${stepsErr.message}`);
      }

      showProgress("Finalizing…", 90);
      await sleep(200);
      showProgress("Finalizing…", 100);
      await hideProgress(300);
      setStage("done");
    } catch (e: any) {
      setError(e.message);
      setStage("rev-confirm");
      setProgress({ show: false, percent: 0, message: "" });
    }
  };

  const handleRevModeChange = (mode: "iterate" | "branch") => {
    setRevMode(mode);
    try { setNewRevId(getNextRevisionId(existingRevIds, mode)); } catch { /* keep current */ }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // VISIBILITY BRANCH
  //
  // RPC strategy:
  //   vis-module: single RPC get_module_names_from_module_tests()
  //               → distinct module_name list, no other tables
  //
  //   vis-list:   single .from("module_tests") with locks joined in one call
  //               via an RPC get_module_tests_with_locks(p_module_name)
  //               — see SQL below. No step_order or any other table.
  //
  // ─────────────────────────────────────────────────────────────────────────────

  const handleVisibilityClick = async () => {
    setVisLoading(true);
    setStage("vis-module");
    setVisModules([]);
    setVisRows([]);
    setError(null);
    try {
      // ── Single RPC: distinct module names from module_tests only ──
      //
      //   create or replace function get_module_names_from_module_tests()
      //   returns table (module_name text)
      //   language sql stable security definer as $$
      //     select distinct module_name
      //     from   module_tests
      //     order  by module_name;
      //   $$;
      //
      const { data, error: modErr } = await supabase
        .rpc("get_module_names_from_module_tests");
      if (modErr) throw new Error(modErr.message);
      setVisModules(((data ?? []) as Array<{ module_name: string }>).map(r => r.module_name));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setVisLoading(false);
    }
  };

  const loadVisibilityList = async (moduleName: string) => {
    setVisLoading(true);
    setStage("vis-list");
    setVisRows([]);
    setError(null);
    try {
      // ── Single RPC: module_tests + locks joined server-side ──
      //
      //   create or replace function get_module_tests_with_locks(p_module_name text)
      //   returns table (
      //     id              uuid,
      //     module_name     text,
      //     tests_name      text,
      //     is_visible      boolean,
      //     lock_user_id    uuid,
      //     lock_user_name  text
      //   )
      //   language sql stable security definer as $$
      //     select
      //       mt.id,
      //       mt.module_name,
      //       mt.tests_name,
      //       mt.is_visible,
      //       tl.user_id        as lock_user_id,
      //       tl.locked_by_name as lock_user_name
      //     from  module_tests mt
      //     left join test_locks tl on tl.module_test_id = mt.id
      //     where mt.module_name = p_module_name
      //     order by mt.tests_name;
      //   $$;
      //
      const { data, error: rpcErr } = await supabase
        .rpc("get_module_tests_with_locks", { p_module_name: moduleName });
      if (rpcErr) throw new Error(rpcErr.message);

      const rows: ModuleTestVisRow[] = ((data ?? []) as any[]).map(r => ({
        id:          r.id as string,       // text from RPC
        module_name: r.module_name,
        tests_name:  r.tests_name,
        is_visible:  r.is_visible,
        lockInfo:    r.lock_user_id
          ? { user_id: r.lock_user_id, locked_by_name: r.lock_user_name }
          : null,
      }));
      setVisRows(rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setVisLoading(false);
    }
  };

  const handleModuleSelect = async (moduleName: string) => {
    setVisSelModule(moduleName);
    setError(null);
    await loadVisibilityList(moduleName);
  };

  const handleToggleVisibility = async (row: ModuleTestVisRow) => {
    setVisLoading(true);
    setError(null);
    try {
      const { error: updErr } = await supabase
        .from("module_tests")
        .update({ is_visible: !row.is_visible })
        .eq("id", row.id);
      if (updErr) throw new Error(updErr.message);
      await loadVisibilityList(visSelModule);
    } catch (e: any) {
      setError(e.message);
      setVisLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────

  const subtitle: Record<Stage, string> = {
    selectaction:  "Select action",
    "revctrl-test": "Revision Control · Pick test",
    "rev-control":  "Revision Control",
    "rev-info":     "New Revision",
    "rev-diff":     "Diff preview",
    "rev-confirm":  "Create revision",
    submitting:     "Working…",
    done:           "Done!",
    "vis-module":   "Visibility · Pick module",
    "vis-list":     "Visibility",
  };

  const isFirst = !activeRev || activeRev.step_order.length === 0;

  const newStepIdSet = revPayload
    ? new Set(revPayload.newSteps.map(s => s.id))
    : new Set<string>();

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <ModalShell
      title="Steps"
      icon={<Hash size={16} />}
      subtitle={subtitle[stage]}
      onClose={onClose}
    >
      {stage !== "submitting" && stage !== "done" && (
        <button
          onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted
            hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <InlineProgress {...progress} />

      {/* ══ selectaction ══ */}
      {stage === "selectaction" && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setStage("revctrl-test")}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border
              border-(--border-color) bg-bg-card hover:bg-bg-base text-left transition-all"
          >
            <span className="text-c-brand shrink-0"><GitBranch size={20} /></span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-t-primary">Revision Control</p>
              <p className="text-[11px] text-t-muted mt-0.5 leading-snug">
                Create, activate and manage revisions ·{" "}
                <span className="font-mono">test_revisions</span>
              </p>
            </div>
            <ChevronRight size={14} className="text-t-muted shrink-0 ml-auto" />
          </button>

          <button
            onClick={handleVisibilityClick}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border
              border-(--border-color) bg-bg-card hover:bg-bg-base text-left transition-all"
          >
            <span className="text-sky-400 shrink-0"><Eye size={20} /></span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-t-primary">Visibility</p>
              <p className="text-[11px] text-t-muted mt-0.5 leading-snug">
                Toggle execute / view-only per test in a module ·{" "}
                <span className="font-mono">module_tests.is_visible</span>
              </p>
            </div>
            <ChevronRight size={14} className="text-t-muted shrink-0 ml-auto" />
          </button>
        </div>
      )}

      {/* ══ revctrl-test ══ */}
      {stage === "revctrl-test" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {tests.length === 0 && (
            <p className="text-sm text-t-muted text-center py-4">No tests found.</p>
          )}
          {tests.map(t => (
            <button
              key={t.serial_no}
              onClick={() => handleRevTestSelect(t.serial_no)}
              className="text-left px-3 py-2 rounded-xl border border-(--border-color)
                bg-bg-card hover:bg-bg-base text-sm text-t-primary transition-colors"
            >
              <span className="font-mono text-t-muted text-xs mr-2">{t.serial_no}</span>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* ══ rev-control ══ */}
      {stage === "rev-control" && (
        <div className="flex flex-col gap-3">
          {revLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-(--border-color) bg-bg-card p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-2">
                  Currently Active
                </p>
                {activeRev ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono
                        bg-green-500/15 text-green-400 border border-green-500/20
                        px-2 py-0.5 rounded-full">
                        {activeRev.id}
                      </span>
                      <span className="text-xs text-t-muted">{activeRev.step_order.length} steps</span>
                    </div>
                    <span className="text-[11px] text-t-muted">{formatDate(activeRev.created_at)}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <Info size={13} />
                    <span>No active revision for this test.</span>
                  </div>
                )}
              </div>

              <button
                onClick={handleStartNewRevision}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-(--border-color)
                  bg-bg-card hover:bg-bg-base text-left transition-all"
              >
                <span className="text-c-brand"><GitBranch size={20} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-t-primary">Create New Revision</p>
                  <p className="text-[11px] text-t-muted mt-0.5 leading-snug">
                    Import CSV → create new immutable revision
                  </p>
                </div>
              </button>

              {allRevisions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
                    All Revisions
                  </p>
                  <div className="rounded-xl border border-(--border-color) overflow-hidden">
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 z-10 bg-bg-card">
                          <tr className="border-b border-(--border-color)">
                            <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted">Revision</th>
                            <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted w-16 text-right">Steps</th>
                            <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted">Date</th>
                            <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted w-20 text-center">Status</th>
                            <th className="w-20" />
                          </tr>
                        </thead>
                        <tbody>
                          {allRevisions.map(rev => {
                            const isActive = rev.status === "active";
                            return (
                              <tr
                                key={rev.id}
                                className={`border-b border-(--border-color) transition-colors ${
                                  isActive ? "bg-green-500/5" : "hover:bg-bg-base/50"
                                }`}
                              >
                                <td className="px-3 py-2.5">
                                  <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full ${
                                    isActive
                                      ? "bg-green-500/15 text-green-400 border border-green-500/20"
                                      : "bg-bg-base text-t-muted border border-(--border-color)"
                                  }`}>
                                    {rev.id}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-[11px] text-t-muted text-right">{rev.step_count}</td>
                                <td className="px-3 py-2.5 text-[11px] text-t-muted">{formatDate(rev.created_at)}</td>
                                <td className="px-3 py-2.5 text-center">
                                  {isActive && <span className="text-[11px] font-medium text-green-400">Active</span>}
                                  {rev.status === "draft" && <span className="text-[11px] font-medium text-amber-400">Draft</span>}
                                  {rev.status === "archived" && <span className="text-[11px] font-medium text-t-muted">Archived</span>}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {!isActive && (
                                    <button
                                      onClick={() => handleActivateRevision(rev.id)}
                                      disabled={revLoading}
                                      className="flex items-center gap-1 text-[11px] font-medium
                                        text-c-brand hover:text-c-brand/80 transition-colors disabled:opacity-50 ml-auto"
                                    >
                                      <Play size={11} /> Activate
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>
      )}

      {/* ══ rev-info ══ */}
      {stage === "rev-info" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-2">
              Current Active Revision
            </p>
            {activeRev ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold font-mono bg-green-500/15 text-green-400
                    border border-green-500/20 px-2 py-0.5 rounded-full">
                    {activeRev.id}
                  </span>
                  <span className="text-xs text-t-muted">{activeRev.step_order.length} steps</span>
                </div>
                <span className="text-[11px] text-t-muted">{formatDate(activeRev.created_at)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <Info size={13} />
                <span>No active revision — this CSV will create the first draft.</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3 flex flex-col gap-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">New Revision</p>
            {activeRev && (
              <div className="flex gap-1.5">
                {(["iterate", "branch"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => handleRevModeChange(m)}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors font-medium ${
                      revMode === m
                        ? "bg-c-brand/15 border-c-brand/40 text-c-brand"
                        : "border-(--border-color) text-t-muted hover:text-t-primary"
                    }`}
                  >
                    {m === "iterate" ? "Iterate" : "Branch"}
                  </button>
                ))}
              </div>
            )}
            <div>
              <label className="block text-[10px] text-t-muted mb-1">
                Revision code (e.g. R0, RA-1, RB-2)
              </label>
              <input
                value={newRevId}
                onChange={e => setNewRevId(e.target.value.toUpperCase())}
                className="input text-sm font-mono"
                placeholder="e.g. RA-2"
              />
              {existingRevIds.length > 0 && (
                <p className="text-[10px] text-t-muted mt-1.5">
                  Existing: {existingRevIds.join(" · ")}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3 flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">CSV Input</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCsvFile}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center justify-center gap-2 w-full py-2.5
                rounded-lg border border-dashed border-(--border-color)
                text-xs text-t-muted hover:text-t-primary hover:border-c-brand/40 transition-colors"
            >
              <Upload size={14} /> Select CSV file
            </button>
            <div className="flex items-center gap-2 text-[10px] text-t-muted">
              <div className="flex-1 border-t border-(--border-color)" />
              or paste
              <div className="flex-1 border-t border-(--border-color)" />
            </div>
            <textarea
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              className="input text-xs font-mono resize-none"
              style={{ minHeight: "8rem" }}
              spellCheck={false}
              placeholder={"action,expected_result,is_divider\nClick login,Page loads,false"}
            />
            <p className="text-[10px] text-t-muted">
              3-col (action, expected, divider) or 4-col (serial_no, action, expected, divider). Header optional.
            </p>
          </div>

          {parseResult && parseResult.errors.length > 0 && (
            <div className="flex flex-col gap-1">
              {parseResult.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-red-400
                  bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  {e}
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleGenerateDiff}
            disabled={!csvText.trim() || !newRevId.trim() || progress.show}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Generate Diff →
          </button>
        </div>
      )}

      {/* ══ rev-diff ══ */}
      {stage === "rev-diff" && parseResult && (
        <div className="flex flex-col gap-3">
          {isFirst ? (
            <div className="text-xs font-semibold text-green-400
              bg-green-500/8 border border-green-500/20 rounded-lg px-3 py-2.5">
              ✦ First import — {parseResult.rows.length} steps →&nbsp;
              <span className="font-mono">{newRevId}</span>. All rows become new step records.
            </div>
          ) : diffResult ? (
            <>
              <div className="text-xs font-semibold text-c-brand
                bg-c-brand/8 border border-c-brand/20 rounded-lg px-3 py-2.5">
                ⇄ Diff: <span className="font-mono">{activeRev?.id}</span>
                &nbsp;→&nbsp;<span className="font-mono">{revSelTest}-{newRevId}</span>
                &nbsp;·&nbsp;{diffResult.summary.total} items
              </div>
              <DiffStats summary={diffResult.summary} />
            </>
          ) : null}

          {isFirst
            ? <FirstImportTable rows={parseResult.rows} />
            : diffResult
              ? <DiffTable items={diffResult.items} />
              : null
          }

          {parseResult.warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              {parseResult.warnings.map((w, i) => (
                <div key={i} className="text-[11px] text-amber-400
                  bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-1.5">
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleBuildPayload}
            disabled={progress.show}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Continue →
          </button>
        </div>
      )}

      {/* ══ rev-confirm ══ */}
      {stage === "rev-confirm" && revPayload && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3
            flex flex-col gap-1.5 text-xs">
            <Row label="Revision ID"    value={`${revSelTest}-${newRevId}`} brand />
            <Row label="Test serial"    value={revSelTest} mono />
            <Row label="Status"         value="draft" />
            <Row label="Steps in order" value={String(revPayload.revision.step_order.length)} mono />
            <Row label="New step rows"  value={String(revPayload.newSteps.length)} mono />
            {!isFirst && diffResult && (
              <>
                <Row label="Unchanged (reused)"  value={String(diffResult.summary.unchanged)} mono />
                <Row label="Edited (new rows)"   value={String(diffResult.summary.edited)}    mono />
                <Row label="Inserted (new rows)" value={String(diffResult.summary.inserted)}  mono />
                <Row label="Deleted from order"  value={String(diffResult.summary.deleted)}   mono />
              </>
            )}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-2">
              Step Order · {revPayload.revision.step_order.length} steps
            </p>
            <StepOrderTable
              stepOrder={revPayload.revision.step_order}
              newStepIds={newStepIdSet}
            />
          </div>

          <div>
            <label className="block text-xs text-t-muted mb-1">Notes (optional)</label>
            <textarea
              value={revNotes}
              onChange={e => setRevNotes(e.target.value)}
              className="input text-sm resize-none"
              rows={2}
              placeholder="e.g. Updated 3DS flow, removed step 12"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button onClick={handleBack} className="flex-1 btn-ghost text-sm">Back</button>
            <button
              onClick={handleRevisionSubmit}
              disabled={progress.show}
              className="flex-1 btn-primary text-sm disabled:opacity-50"
            >
              Create Draft Revision
            </button>
          </div>
        </div>
      )}

      {/* ══ submitting ══ */}
      {stage === "submitting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ══ done ══ */}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">
            {`Revision ${revSelTest}-${newRevId} created as draft`}
          </p>
          <p className="text-xs text-t-muted text-center max-w-48">
            Activate it from Revision Control when you're ready to use it.
          </p>
          <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
        </div>
      )}

      {/* ══ vis-module ══ */}
      {stage === "vis-module" && (
        <div className="flex flex-col gap-2">
          {visLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : visModules.length === 0 ? (
            <p className="text-sm text-t-muted text-center py-4">No modules found.</p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
              {visModules.map(name => (
                <button
                  key={name}
                  onClick={() => handleModuleSelect(name)}
                  className="text-left px-3 py-2.5 rounded-xl border border-(--border-color)
                    bg-bg-card hover:bg-bg-base text-sm text-t-primary transition-colors"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {/* ══ vis-list ══ */}
      {stage === "vis-list" && (
        <div className="flex flex-col gap-3">
          {visLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : visRows.length === 0 ? (
            <p className="text-sm text-t-muted text-center py-8">
              No tests found in this module.
            </p>
          ) : (
            <>
              <div className="rounded-xl border border-(--border-color) bg-bg-card px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-0.5">Module</p>
                <p className="text-sm font-semibold text-t-primary">{visSelModule}</p>
              </div>

              <div className="rounded-xl border border-(--border-color) overflow-hidden">
                <div className="overflow-y-auto" style={{ maxHeight: "420px" }}>
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-bg-card">
                      <tr className="border-b border-(--border-color)">
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted">Test</th>
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-t-muted w-28 text-center">Visibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visRows.map(row => (
                        <tr key={row.id} className="border-b border-(--border-color) hover:bg-bg-base/50 transition-colors">
                          <td className="px-3 py-2.5 text-sm text-t-primary font-medium">
                            {row.tests_name}
                          </td>
                          <td className="px-3 py-2.5 w-28 text-center">
                            {row.lockInfo ? (
                              <div
                                title={`Locked by ${row.lockInfo.locked_by_name} — finish test to unlock`}
                                className="inline-flex items-center gap-1.5 text-[11px]
                                  font-semibold px-2.5 py-1 rounded-lg border
                                  text-amber-400 border-amber-500/30 bg-amber-500/8
                                  cursor-not-allowed select-none"
                              >
                                <Lock size={11} />
                                <span className="max-w-[70px] truncate">{row.lockInfo.locked_by_name}</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleToggleVisibility(row)}
                                disabled={visLoading}
                                title={
                                  row.is_visible
                                    ? "Execute mode — click to make view-only"
                                    : "View-only — click to enable execution"
                                }
                                className={`inline-flex items-center gap-1.5 text-[11px]
                                  font-semibold px-2.5 py-1 rounded-lg border transition-colors
                                  disabled:opacity-50
                                  ${row.is_visible
                                    ? "text-sky-400 border-sky-500/30 bg-sky-500/8 hover:bg-sky-500/15"
                                    : "text-t-muted border-(--border-color) bg-bg-base hover:text-t-primary"
                                  }`}
                              >
                                {row.is_visible
                                  ? <><Pencil size={11} /> Execute</>
                                  : <><Eye size={11} /> View Only</>
                                }
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </ModalShell>
  );
};

export default ImportStepsModal;