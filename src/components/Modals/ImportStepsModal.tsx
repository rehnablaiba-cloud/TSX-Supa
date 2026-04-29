// src/components/Modals/ImportStepsModal.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Hash,
  CheckCircle,
  ArrowLeft,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Upload,
  AlertCircle,
  Info,
  Play,
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
  | "selecttest"
  | "rev-control"
  | "rev-info"
  | "rev-diff"
  | "rev-confirm"
  | "submitting"
  | "done";

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
  step_count: number;
}

interface Props {
  onClose: () => void;
  onBack: () => void;
}

// ─── Diff type colours (Tailwind) ─────────────────────────────────────────────

const TYPE_STYLES: Record<string, { badge: string }> = {
  UNCHANGED: { badge: "bg-green-500/15 text-green-400 border-green-500/20" },
  EDIT:      { badge: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  INSERT:    { badge: "bg-sky-500/15 text-sky-400 border-sky-500/20" },
  DELETE:    { badge: "bg-red-500/15 text-red-400 border-red-500/20" },
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function truncate(s: string, n = 55): string {
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

// ─── Collapsible diff row ─────────────────────────────────────────────────────

const DiffItemRow: React.FC<{ item: DiffItem; index: number }> = ({ item, index }) => {
  const [open, setOpen] = useState(false);
  const style = TYPE_STYLES[item.type];

  const summaryLine =
    item.type === "UNCHANGED" ? item.step.action
    : item.type === "EDIT"    ? item.old.action
    : item.type === "INSERT"  ? item.row.action
    : item.step.action;

  return (
    <div className="rounded-lg border border-(--border-color) overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left
          hover:bg-bg-base/50 transition-colors"
      >
        <span className="text-[10px] font-mono text-t-muted w-5 shrink-0 text-right">
          {item.type === "DELETE" ? "—" : `#${item.position}`}
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${style.badge}`}>
          {item.type[0]}
        </span>
        <span className="text-xs text-t-secondary truncate flex-1">
          S/{item.serialNo} · {truncate(summaryLine ?? "")}
        </span>
        <span className="text-t-muted shrink-0">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2 border-t border-(--border-color) bg-bg-base/30 text-xs">
          {item.type === "UNCHANGED" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-t-muted mb-0.5 uppercase tracking-wide">Step ID</p>
                <p className="font-mono text-t-secondary text-[11px]">{item.step.id}</p>
              </div>
              <div>
                <p className="text-[10px] text-t-muted mb-0.5 uppercase tracking-wide">S/N</p>
                <p className="font-mono text-t-secondary">{item.step.serial_no}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] text-t-muted mb-0.5 uppercase tracking-wide">Action</p>
                <p className="text-t-primary whitespace-pre-wrap">{item.step.action}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] text-t-muted mb-0.5 uppercase tracking-wide">Expected</p>
                <p className="text-t-secondary">{item.step.expected_result || "—"}</p>
              </div>
            </div>
          )}

          {item.type === "EDIT" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-2">
                <p className="text-[10px] text-red-400 font-bold mb-1 uppercase tracking-wide">Before</p>
                <p className="text-[10px] text-t-muted mb-0.5">ID</p>
                <p className="font-mono text-t-secondary text-[11px] mb-1">{item.old.id}</p>
                <p className="text-[10px] text-t-muted mb-0.5">Action</p>
                <p className="text-t-primary whitespace-pre-wrap mb-1">{item.old.action}</p>
                <p className="text-[10px] text-t-muted mb-0.5">Expected</p>
                <p className="text-t-secondary">{item.old.expected_result || "—"}</p>
              </div>
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-2">
                <p className="text-[10px] text-amber-400 font-bold mb-1 uppercase tracking-wide">After</p>
                <p className="text-[10px] text-t-muted mb-0.5">New ID</p>
                <p className="font-mono text-t-muted text-[11px] italic mb-1">minted on save</p>
                <p className="text-[10px] text-t-muted mb-0.5">Action</p>
                <p className="text-t-primary whitespace-pre-wrap mb-1">{item.new.action}</p>
                <p className="text-[10px] text-t-muted mb-0.5">Expected</p>
                <p className="text-t-secondary">{item.new.expected_result || "—"}</p>
              </div>
            </div>
          )}

          {item.type === "INSERT" && (
            <div className="rounded-lg bg-sky-500/5 border border-sky-500/15 p-2">
              <p className="text-[10px] text-sky-400 font-bold mb-1 uppercase tracking-wide">New Step</p>
              <p className="text-[10px] text-t-muted mb-0.5">Action</p>
              <p className="text-t-primary whitespace-pre-wrap mb-1">{item.row.action}</p>
              <p className="text-[10px] text-t-muted mb-0.5">Expected</p>
              <p className="text-t-secondary">{item.row.expected_result || "—"}</p>
            </div>
          )}

          {item.type === "DELETE" && (
            <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-2">
              <p className="text-[10px] text-red-400 font-bold mb-1 uppercase tracking-wide">
                Removed from order (row preserved)
              </p>
              <p className="text-[10px] text-t-muted mb-0.5">Step ID</p>
              <p className="font-mono text-t-secondary text-[11px] mb-1">{item.step.id}</p>
              <p className="text-[10px] text-t-muted mb-0.5">Action</p>
              <p className="text-t-primary whitespace-pre-wrap">{item.step.action}</p>
            </div>
          )}
        </div>
      )}
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
        className={`rounded-lg border px-2 py-2 text-center
          bg-${color}-500/5 border-${color}-500/20`}
      >
        <p className={`text-base font-bold leading-none text-${color}-400`}>{count}</p>
        <p className="text-[9px] text-t-muted uppercase tracking-wide mt-1">{label}</p>
      </div>
    ))}
  </div>
);

// ─── Main Modal ───────────────────────────────────────────────────────────────

const ImportStepsModal: React.FC<Props> = ({ onClose, onBack }) => {

  // ── Shared state ──────────────────────────────────────────────────────────────
  const [stage,   setStage]   = useState<Stage>("selecttest");
  // tests: keyed by serial_no (the PK / FK used throughout DB queries)
  const [tests,   setTests]   = useState<{ serial_no: string; name: string }[]>([]);
  const [selTest, setSelTest] = useState(""); // stores tests.serial_no
  const [error,   setError]   = useState<string | null>(null);

  // ── Revision control state ────────────────────────────────────────────────────
  const [allRevisions, setAllRevisions] = useState<RevisionListItem[]>([]);
  const [activeRev,    setActiveRev]    = useState<ActiveRevInfo | null>(null);
  const [revLoading,   setRevLoading]   = useState(false);

  // ── New revision state ────────────────────────────────────────────────────────
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

  // ── Load test list ────────────────────────────────────────────────────────────
  // tests PK is serial_no — there is no "id" column
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
      case "selecttest":   return onBack();
      case "rev-control":  return setStage("selecttest");
      case "rev-info":     return setStage("rev-control");
      case "rev-diff":     return setStage("rev-info");
      case "rev-confirm":  return setStage("rev-diff");
      default: break;
    }
  };

  // ─── Test selection ───────────────────────────────────────────────────────────
  // Receives tests.serial_no — the FK used in test_revisions.tests_serial_no
  const handleTestSelect = async (testSerialNo: string) => {
    setSelTest(testSerialNo);
    setError(null);
    await loadRevisionControl(testSerialNo);
  };

  // ─── Load revision control / activator ────────────────────────────────────────

  const loadRevisionControl = async (testSerialNo: string) => {
    setRevLoading(true);
    setStage("rev-control");
    setActiveRev(null);
    setAllRevisions([]);
    setBaseSteps([]);
    setExistingRevIds([]);
    setError(null);

    try {
      // test_revisions FK column is tests_serial_no (not test_id)
      const { data: revRows, error: revsErr } = await supabase
        .from("test_revisions")
        .select("id, status, step_order, created_at, notes")
        .eq("tests_serial_no", testSerialNo)
        .order("created_at", { ascending: true });
      if (revsErr) throw new Error(revsErr.message);

      const allRevs = (revRows ?? []) as ActiveRevInfo[];
      const ids   = allRevs.map(r => r.id);
const codes = ids.map(id =>
  id.startsWith(testSerialNo + "-") ? id.slice(testSerialNo.length + 1) : id);
setExistingRevIds(codes);                              
setNewRevId(getNextRevisionId(codes, "iterate"));

      const active = allRevs.find(r => r.status === "active") ?? null;
      setActiveRev(active);

      setAllRevisions(
        allRevs.map(r => ({
          id: r.id,
          status: r.status,
          created_at: r.created_at,
          notes: r.notes,
          step_count: (r.step_order ?? []).length,
        }))
      );

      // Resolve base steps from the active revision's step_order
      if (active) {
        const stepOrder = (active.step_order ?? []) as string[];
        if (stepOrder.length > 0) {
          const { data: stepRows, error: stepsErr } = await supabase
            .from("test_steps")
            .select("id, action, expected_result, is_divider, introduced_in_rev, origin_step_id")
            .in("id", stepOrder);
          if (stepsErr) throw new Error(stepsErr.message);

          const stepMap = new Map(
            ((stepRows ?? []) as any[]).map(s => [s.id, s])
          );
          setBaseSteps(resolveBaseSteps(stepOrder, stepMap as any));
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRevLoading(false);
    }
  };

  // ─── Activate a revision ──────────────────────────────────────────────────────

  const handleActivateRevision = async (revId: string) => {
    setRevLoading(true);
    setError(null);
    try {
      // Deactivate current
      if (activeRev) {
        const { error: deactErr } = await supabase
          .from("test_revisions")
          .update({ status: "archived" })
          .eq("id", activeRev.id);
        if (deactErr) throw new Error(deactErr.message);
      }

      // Activate selected
      const { error: actErr } = await supabase
        .from("test_revisions")
        .update({ status: "active" })
        .eq("id", revId);
      if (actErr) throw new Error(actErr.message);

      // Reload
      await loadRevisionControl(selTest);
    } catch (e: any) {
      setError(e.message);
      setRevLoading(false);
    }
  };

  // ─── Start new revision flow ──────────────────────────────────────────────────

  const handleStartNewRevision = () => {
    setCsvText("");
    setParseResult(null);
    setDiffResult(null);
    setRevPayload(null);
    setRevNotes("");
    setStage("rev-info");
  };

  // ─── CSV file pick ────────────────────────────────────────────────────────────

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsvText((ev.target?.result as string) ?? "");
    reader.readAsText(file, "UTF-8");
  };

  // ─── Generate diff ────────────────────────────────────────────────────────────

  const handleGenerateDiff = () => {
    setError(null);
    const parsed = parseCsv(csvText);
    setParseResult(parsed);
    if (parsed.errors.length > 0) return;

    const isFirst = !activeRev || baseSteps.length === 0;
    setDiffResult(isFirst ? null : computeDiff(baseSteps, parsed.rows));
    setStage("rev-diff");
  };

  // ─── Build payload ────────────────────────────────────────────────────────────

  // ─── Build payload ────────────────────────────────────────────────────────────

  const handleBuildPayload = async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const userId  = user?.id ?? "unknown";
    const isFirst = !activeRev || baseSteps.length === 0;
  
    // ← newRevId is already just the code ("R0-1", "RA-1") — no selTest prefix
    const payload = isFirst
      ? buildFirstRevisionPayload(parseResult!.rows, newRevId, selTest, userId, revNotes)
      : buildDiffRevisionPayload(diffResult!, newRevId, selTest, userId, revNotes);
  
    setRevPayload(payload);
    setStage("rev-confirm");
  };
  // ─── Submit revision to DB ────────────────────────────────────────────────────
// ─── Submit revision to DB ────────────────────────────────────────────────────

const handleRevisionSubmit = async () => {
  if (!revPayload) return;
  setStage("submitting");
  setError(null);

  try {
    // 1. Insert revision FIRST — if this is a retry, the unique constraint
    //    on test_revisions.id fires here cleanly before we touch steps.
    const { error: revErr } = await supabase.from("test_revisions").insert({
      tests_serial_no: selTest,
      revision:        newRevId,     
      status:          "draft",
      step_order:      JSON.stringify(revPayload.revision.step_order),
      created_by:      revPayload.revision.created_by,
      notes:           revPayload.revision.notes || null,
      created_at:      new Date().toISOString(),
    });
    if (revErr) throw new Error(`test_revisions: ${revErr.message}`);

    // 2. Upsert steps — ignoreDuplicates makes retries safe.
    //    Steps are append-only/immutable so skipping an existing row is correct.
    if (revPayload.newSteps.length > 0) {
      const { error: stepsErr } = await supabase
        .from("test_steps")
        .upsert(revPayload.newSteps, { onConflict: "id", ignoreDuplicates: true });
      if (stepsErr) throw new Error(`test_steps: ${stepsErr.message}`);
    }

    setStage("done");
  } catch (e: any) {
    setError(e.message);
    setStage("rev-confirm");
  }
};

  // ─── Revision mode toggle ─────────────────────────────────────────────────────

  const handleRevModeChange = (mode: "iterate" | "branch") => {
    setRevMode(mode);
    try { setNewRevId(getNextRevisionId(existingRevIds, mode)); } catch { /* keep current */ }
  };

  // ─────────────────────────────────────────────────────────────────────────────

  const subtitle: Record<Stage, string> = {
    selecttest:    "Pick test",
    "rev-control": "Revision Control",
    "rev-info":    "New Revision",
    "rev-diff":    "Diff preview",
    "rev-confirm": "Create revision",
    submitting:    "Working…",
    done:          "Done!",
  };

  const isFirst = !activeRev || baseSteps.length === 0;

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
      {/* Back */}
      {stage !== "submitting" && stage !== "done" && (
        <button
          onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted
            hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {/* ──────────────────────────────────
          selecttest
      ────────────────────────────────── */}
      {stage === "selecttest" && (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {tests.length === 0 && (
            <p className="text-sm text-t-muted text-center py-4">No tests found.</p>
          )}
          {tests.map(t => (
            <button
              key={t.serial_no}
              onClick={() => handleTestSelect(t.serial_no)}
              className="text-left px-3 py-2 rounded-xl border border-(--border-color)
                bg-bg-card hover:bg-bg-base text-sm text-t-primary"
            >
              <span className="font-mono text-t-muted text-xs mr-2">{t.serial_no}</span>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* ──────────────────────────────────
          rev-control (Revision Activator & Control)
      ────────────────────────────────── */}
      {stage === "rev-control" && (
        <div className="flex flex-col gap-3">
          {revLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Active revision banner */}
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

              {/* New revision button */}
              <button
                onClick={handleStartNewRevision}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-(--border-color)
                  bg-bg-card hover:bg-bg-base text-left transition-all"
              >
                <span className="text-c-brand">
                  <GitBranch size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-t-primary">Create New Revision</p>
                  <p className="text-[11px] text-t-muted mt-0.5 leading-snug">
                    Import CSV → create new immutable revision
                  </p>
                </div>
              </button>

              {/* Revision history list */}
              {allRevisions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
                    All Revisions
                  </p>
                  <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5">
                    {allRevisions.map(rev => {
                      const isActive = rev.status === "active";
                      return (
                        <div
                          key={rev.id}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-xl border
                            ${isActive
                              ? "bg-green-500/5 border-green-500/20"
                              : "bg-bg-card border-(--border-color)"
                            }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full
                              ${isActive
                                ? "bg-green-500/15 text-green-400 border border-green-500/20"
                                : "bg-bg-base text-t-muted border border-(--border-color)"
                              }`}>
                              {rev.id}
                            </span>
                            <span className="text-[11px] text-t-muted">
                              {rev.step_count} steps · {formatDate(rev.created_at)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isActive && (
                              <button
                                onClick={() => handleActivateRevision(rev.id)}
                                disabled={revLoading}
                                className="flex items-center gap-1 text-[11px] font-medium
                                  text-c-brand hover:text-c-brand/80 transition-colors
                                  disabled:opacity-50"
                              >
                                <Play size={12} />
                                Activate
                              </button>
                            )}
                            {isActive && (
                              <span className="text-[11px] font-medium text-green-400">
                                Active
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>
      )}

      {/* ──────────────────────────────────
          rev-info (New Revision Setup)
      ────────────────────────────────── */}
      {stage === "rev-info" && (
        <div className="flex flex-col gap-3">
          {/* Active revision card */}
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-2">
              Current Active Revision
            </p>
            {activeRev ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold font-mono
                    bg-green-500/15 text-green-400 border border-green-500/20
                    px-2 py-0.5 rounded-full">
                    {activeRev.id}
                  </span>
                  <span className="text-xs text-t-muted">{baseSteps.length} steps</span>
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

          {/* New revision ID + mode */}
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3 flex flex-col gap-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
              New Revision
            </p>

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

          {/* CSV input */}
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3 flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted">
              CSV Input
            </p>

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
                text-xs text-t-muted hover:text-t-primary hover:border-c-brand/40
                transition-colors"
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
              style={{ minHeight: "7rem" }}
              spellCheck={false}
              placeholder={"action,expected_result,is_divider\nClick login,Page loads,false"}
            />
            <p className="text-[10px] text-t-muted">
              3-col (action, expected, divider) or 4-col (serial_no, action, expected, divider).
              Header optional.
            </p>
          </div>

          {/* Parse error/warning feedback */}
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
            disabled={!csvText.trim() || !newRevId.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Generate Diff →
          </button>
        </div>
      )}

      {/* ──────────────────────────────────
          rev-diff
      ────────────────────────────────── */}
      {stage === "rev-diff" && parseResult && (
        <div className="flex flex-col gap-3">

          {isFirst ? (
            <div className="text-xs font-semibold text-green-400
              bg-green-500/8 border border-green-500/20 rounded-lg px-3 py-2.5">
              ✦ First import — {parseResult.rows.length} steps →&nbsp;
              <span className="font-mono">{newRevId}</span>.
              All rows become new step records.
            </div>
          ) : diffResult ? (
            <>
              <div className="text-xs font-semibold text-c-brand
                bg-c-brand/8 border border-c-brand/20 rounded-lg px-3 py-2.5">
                ⇄ Diff: <span className="font-mono">{activeRev?.id}</span>
                &nbsp;→&nbsp;<span className="font-mono">{selTest}-{newRevId}</span>
                &nbsp;·&nbsp;{diffResult.summary.total} items
              </div>
              <DiffStats summary={diffResult.summary} />
            </>
          ) : null}

          {/* Step list */}
          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {isFirst
              ? parseResult.rows.slice(0, 6).map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs
                    border border-(--border-color) rounded-lg px-3 py-2 bg-bg-card">
                    <span className="font-mono text-c-brand shrink-0 w-5 text-right">{r.serial_no}</span>
                    <span className="text-t-secondary truncate">{r.action}</span>
                  </div>
                ))
              : diffResult?.items.map((item, i) => (
                  <DiffItemRow key={i} item={item} index={i} />
                ))
            }
            {isFirst && parseResult.rows.length > 6 && (
              <p className="text-[11px] text-t-muted text-center py-1">
                …and {parseResult.rows.length - 6} more
              </p>
            )}
          </div>

          {/* Warnings */}
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

          <button onClick={handleBuildPayload} className="btn-primary text-sm">
            Continue →
          </button>
        </div>
      )}

      {/* ──────────────────────────────────
          rev-confirm
      ────────────────────────────────── */}
      {stage === "rev-confirm" && revPayload && (
        <div className="flex flex-col gap-3">
          {/* Summary */}
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-3
            flex flex-col gap-1.5 text-xs">
            <Row label="Revision ID"    value={`${selTest}-${newRevId}`} brand />
            <Row label="Test serial"    value={selTest} mono />
            <Row label="Status"         value="draft" />
            <Row label="Steps in order" value={String(revPayload.revision.step_order.length)} mono />
            <Row label="New step rows"  value={String(revPayload.newSteps.length)} mono />
            {!isFirst && diffResult && (
              <>
                <Row label="Unchanged (reused)"   value={String(diffResult.summary.unchanged)} mono />
                <Row label="Edited (new rows)"    value={String(diffResult.summary.edited)}    mono />
                <Row label="Inserted (new rows)"  value={String(diffResult.summary.inserted)}  mono />
                <Row label="Deleted from order"   value={String(diffResult.summary.deleted)}   mono />
              </>
            )}
          </div>

          {/* Step order preview chip strip */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-t-muted mb-1.5">
              Step order preview
            </p>
            <div className="flex flex-wrap gap-1">
              {revPayload.revision.step_order.slice(0, 9).map((id, i) => {
                const isNew = revPayload.newSteps.some(s => s.id === id);
                return (
                  <span
                    key={id}
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      isNew
                        ? "bg-sky-500/10 border-sky-500/20 text-sky-400"
                        : "bg-bg-base border-(--border-color) text-t-muted"
                    }`}
                  >
                    {i + 1}. {id}
                  </span>
                );
              })}
              {revPayload.revision.step_order.length > 9 && (
                <span className="text-[10px] text-t-muted self-center">
                  +{revPayload.revision.step_order.length - 9} more
                </span>
              )}
            </div>
            <p className="text-[10px] text-t-muted mt-1">
              <span className="text-sky-400 font-bold">Blue</span> = new rows ·
              grey = reused unchanged
            </p>
          </div>

          {/* Notes */}
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
            <button onClick={handleRevisionSubmit} className="flex-1 btn-primary text-sm">
              Create Draft Revision
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────
          submitting
      ────────────────────────────────── */}
      {stage === "submitting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ──────────────────────────────────
          done
      ────────────────────────────────── */}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">
            {`Revision ${selTest}-${newRevId} created as draft`}
          </p>
          <p className="text-xs text-t-muted text-center max-w-48">
            Activate it from Revision Control when you're ready to use it.
          </p>
          <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
        </div>
      )}
    </ModalShell>
  );
};

export default ImportStepsModal;