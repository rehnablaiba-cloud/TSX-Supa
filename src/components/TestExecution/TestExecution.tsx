import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Lock, Upload, RotateCcw, User, Check, X,
  ArrowLeft, AlertTriangle, FileSpreadsheet, FileText,
  ChevronLeft, ChevronRight,
} from "lucide-react";

import { useAuth }        from "../../context/AuthContext";
import { useToast }       from "../../context/ToastContext";
import { supabase }       from "../../supabase";
import Topbar             from "../Layout/Topbar";
import Spinner            from "../UI/Spinner";
import ExportModal        from "../UI/ExportModal";
import MassImageUploadModal from "../UI/MassImageUploadModal";
import useaudit_log        from "../../hooks/useAuditLog";
import { exportExecutionCSV, exportExecutionPDF } from "../../utils/export";
import type { FlatData }  from "../../utils/export";

import {
  fetchTestExecution,
  acquireLock,
  releaseLock,
  forceReleaseLock,
  upsertStepResult,
  resetAllstep_results,
  fetchSignedUrls,
} from "../../lib/supabase/queries.testexecution";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  module_name:          string;
  initialmodule_test_id: string;
  isAdmin?:            boolean;
  onBack:              () => void;
}

type Filter = "all" | "pass" | "fail" | "pending";

interface ExecutionStep {
  stepId:            string;
  stepResultId:      string;
  module_test_id:      string;
  serial_no:          number;
  action:            string;
  expected_result:   string;
  action_image_urls:   string[];
  expected_image_urls: string[];
  is_divider:        boolean;
  status:            "pass" | "fail" | "pending";
  remarks:           string;
  display_name:      string;
}

interface ModuleTestItem {
  id:        string;
  testsname: string;
  test:      { serial_no: string; name: string } | null;
}

type SignedImageMap = Record<string, string>;

interface ImagePreviewState {
  urls:  string[];
  idx:   number;
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Divider level config
// ─────────────────────────────────────────────────────────────────────────────

const MOBILE_DIVIDER_LEVELS: Record<number, {
  bg: string; border: string; textClass: string; dotClass: string;
  dotSize: number; fontSize: string; ml: string; py: string;
}> = {
  1: { bg: "bg-teal-500/10",  border: "border-l-[3px] border-teal-500",  textClass: "text-teal-400",  dotClass: "bg-teal-500",  dotSize: 7, fontSize: "text-[14px] font-bold tracking-widest uppercase",  ml: "ml-0", py: "py-2.5" },
  2: { bg: "bg-amber-500/10", border: "border-l-[2px] border-amber-400", textClass: "text-amber-400", dotClass: "bg-amber-400", dotSize: 5, fontSize: "text-[12px] font-semibold tracking-wide uppercase", ml: "ml-4", py: "py-2"   },
  3: { bg: "bg-sky-500/10",   border: "border-l-[2px] border-sky-400",   textClass: "text-sky-400",   dotClass: "bg-sky-400",   dotSize: 4, fontSize: "text-[11px] font-medium tracking-wide",            ml: "ml-8", py: "py-1.5" },
};

const getDividerLevel = (expected_result: string): number =>
  Math.min(Math.max(parseInt(expected_result, 10) || 1, 1), 3);

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const UndoAllModal: React.FC<{
  doneCount: number; totalCount: number;
  onConfirm: () => void; onCancel: () => void;
}> = ({ doneCount, totalCount, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
    style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
    onClick={onCancel}>
    <div className="relative w-full max-w-sm rounded-2xl border shadow-2xl p-6 flex flex-col gap-4"
      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-color)" }}
      onClick={e => e.stopPropagation()}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
          <AlertTriangle size={26} className="text-amber-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-t-primary">Reset All Steps?</h2>
          <p className="text-sm text-t-muted mt-1">
            This will mark all <span className="font-semibold text-t-primary">{doneCount}</span> completed
            step{doneCount !== 1 ? "s" : ""} out of{" "}
            <span className="font-semibold text-t-primary">{totalCount}</span> back to{" "}
            <span className="font-semibold text-amber-500">pending</span>.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/25 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span>All remarks and results will be cleared. <strong>This cannot be undone.</strong></span>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-xl border text-sm font-semibold text-t-secondary hover:text-t-primary hover:border-[var(--color-brand)] border-[var(--border-color)] bg-bg-card transition-colors">
          Cancel
        </button>
        <button onClick={onConfirm}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 active:bg-amber-700 transition-colors flex items-center justify-center gap-1.5">
          <RotateCcw size={14} /> Yes, Reset All
        </button>
      </div>
    </div>
  </div>
);

const ImagePreviewModal: React.FC<{
  images: string[]; initialIndex: number; label: string; onClose: () => void;
}> = ({ images, initialIndex, label, onClose }) => {
  const [idx, setIdx] = useState(initialIndex);
  const total = images.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")     onClose();
      if (e.key === "ArrowRight") setIdx(i => (i + 1) % total);
      if (e.key === "ArrowLeft")  setIdx(i => (i - 1 + total) % total);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, total]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)" }}
      onClick={onClose}>
      <button onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors z-10">
        <X size={16} />
      </button>
      <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
        <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">{label}</span>
        {total > 1 && <span className="text-xs text-white/40">{idx + 1} / {total}</span>}
      </div>
      {total > 1 && (
        <button onClick={e => { e.stopPropagation(); setIdx(i => (i - 1 + total) % total); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors z-10">
          <ChevronLeft size={20} />
        </button>
      )}
      <div className="relative max-w-4xl max-h-[80vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
        <img src={images[idx]} alt={`${label} ${idx + 1}`}
          className="max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl border border-white/10" />
      </div>
      {total > 1 && (
        <button onClick={e => { e.stopPropagation(); setIdx(i => (i + 1) % total); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors z-10">
          <ChevronRight size={20} />
        </button>
      )}
      {total > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10" onClick={e => e.stopPropagation()}>
          {images.map((url, i) => (
            <button key={i} onClick={() => setIdx(i)}
              className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${i === idx ? "border-white scale-110" : "border-white/25 opacity-55 hover:opacity-90"}`}>
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const LockedScreen: React.FC<{ locked_by_name: string; test_name: string; onBack: () => void }> = ({ locked_by_name, test_name, onBack }) => (
  <div className="flex flex-col flex-1 items-center justify-center gap-6 p-8 text-center">
    <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
      <Lock size={28} className="text-amber-500" />
    </div>
    <div>
      <h2 className="text-lg font-bold text-t-primary mb-1">Test In Progress</h2>
      <p className="text-t-secondary text-sm max-w-sm">
        <span className="text-amber-600 dark:text-amber-400 font-semibold">{locked_by_name}</span> is currently
        executing <span className="text-t-primary font-semibold">{test_name}</span>. You cannot enter until they finish.
      </p>
    </div>
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">You'll be unblocked instantly when they finish.</span>
    </div>
    <button onClick={onBack}
      className="flex items-center gap-1.5 px-6 py-2 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary hover:border-[var(--color-brand)] text-sm font-medium transition-colors">
      <ArrowLeft size={14} /> Go Back
    </button>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const TestExecution: React.FC<Props> = ({
  module_name, initialmodule_test_id, isAdmin = false, onBack,
}) => {
  const { user }     = useAuth();
  const { addToast } = useToast();
  const log          = useaudit_log();

  const currentMtId = initialmodule_test_id;
  const testsName   = currentMtId.slice(module_name.length + 1);

  const [filter,          setFilter]          = useState<Filter>("all");
  const [search,          setSearch]          = useState("");
  const [steps,           setSteps]           = useState<ExecutionStep[]>([]);
  const [module_tests,     setmodule_tests]     = useState<ModuleTestItem[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState<string | null>(null);
  const [lockedByOther,   setLockedByOther]   = useState<string | null>(null);
  const [showUndoModal,   setShowUndoModal]   = useState(false);
  const [showExport,      setShowExport]      = useState(false);
  const [showMassUpload,  setShowMassUpload]  = useState(false);
  const [signedImages,    setSignedImages]    = useState<SignedImageMap>({});
  const [imagePreview,    setImagePreview]    = useState<ImagePreviewState | null>(null);
  const [expandedRemarks, setExpandedRemarks] = useState<Set<string>>(new Set());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Load data ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const { step_results, module_tests: mts } = await fetchTestExecution(currentMtId);
      if (!mountedRef.current) return;

      setmodule_tests(mts as ModuleTestItem[]);

      const mapped: ExecutionStep[] = step_results.map(sr => ({
        stepId:            sr.step?.id ?? "",
        stepResultId:      sr.id,
        module_test_id:      currentMtId,
        serial_no:          sr.step?.serial_no ?? 0,
        action:            sr.step?.action ?? "",
        expected_result:   sr.step?.expected_result ?? "",
        action_image_urls:   sr.step?.action_image_urls ?? [],
        expected_image_urls: sr.step?.expected_image_urls ?? [],
        is_divider:        sr.step?.is_divider ?? false,
        status:            sr.status,
        remarks:           sr.remarks,
        display_name:      sr.display_name,
      }));
      setSteps(mapped);

      const allPaths = mapped.flatMap(s => [...s.action_image_urls, ...s.expected_image_urls]);
      if (allPaths.length > 0) {
        const map = await fetchSignedUrls(allPaths);
        if (mountedRef.current) setSignedImages(prev => ({ ...prev, ...map }));
      }
    } catch (e: any) {
      addToast(e?.message ?? "Failed to load test execution", "error");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [currentMtId, addToast]);

  // ── Acquire lock on mount ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await acquireLock(
          currentMtId,
          user?.id ?? "",
          user?.display_name ?? user?.email ?? ""
        );
        if (!cancelled) {
          if (!result.success) {
            setLockedByOther(result.holder ?? "Another user");
            setLoading(false);
          } else {
            await load();
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setLockedByOther("Another user");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [currentMtId, user, load]);

  // ── Release lock on unmount ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      releaseLock(currentMtId, user?.id ?? "").catch(() => {});
    };
  }, [currentMtId, user]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`execution-${currentMtId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "step_results",
        filter: `module_test_id=eq.${currentMtId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "test_locks",
        filter: `module_test_id=eq.${currentMtId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentMtId, load]);

  // ── Set step status ───────────────────────────────────────────────────────
  const handleSetStatus = useCallback(async (
    step: ExecutionStep,
    status: "pass" | "fail" | "pending",
    remarks?: string
  ) => {
    setSaving(step.stepId);
    try {
      await upsertStepResult({
        test_stepsid:  step.stepId,
        module_test_id: currentMtId,
        status,
        remarks:      remarks ?? step.remarks,
        display_name: user?.display_name ?? user?.email ?? "",
        user_id:      user?.id ?? "",
      });
      setSteps(prev => prev.map(s =>
        s.stepId === step.stepId ? { ...s, status, remarks: remarks ?? s.remarks } : s
      ));
      log(`Step ${step.serial_no} → ${status}`);
    } catch (e: any) {
      addToast(e?.message ?? "Failed to save result", "error");
    } finally {
      setSaving(null);
    }
  }, [currentMtId, user, log, addToast]);

  // ── Reset all ─────────────────────────────────────────────────────────────
  const handleUndoAll = useCallback(async () => {
    setShowUndoModal(false);
    setSaving("all");
    try {
      await resetAllstep_results(currentMtId);
      setSteps(prev => prev.map(s => ({ ...s, status: "pending", remarks: "" })));
      log("Reset all step results");
      addToast("All steps reset to pending", "info");
    } catch (e: any) {
      addToast(e?.message ?? "Failed to reset steps", "error");
    } finally {
      setSaving(null);
    }
  }, [currentMtId, log, addToast]);

  // ── Force release lock ────────────────────────────────────────────────────
  const handleForceRelease = useCallback(async () => {
    if (!isAdmin) return;
    try {
      await forceReleaseLock(currentMtId);
      addToast("Lock force-released", "success");
      await load();
    } catch (e: any) {
      addToast(e?.message ?? "Failed to force-release lock", "error");
    }
  }, [isAdmin, currentMtId, load, addToast]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const doneSteps    = useMemo(() => steps.filter(s => !s.is_divider && s.status !== "pending"), [steps]);
  const totalSteps   = useMemo(() => steps.filter(s => !s.is_divider), [steps]);
  const passCount    = useMemo(() => steps.filter(s => !s.is_divider && s.status === "pass").length,    [steps]);
  const failCount    = useMemo(() => steps.filter(s => !s.is_divider && s.status === "fail").length,    [steps]);
  const pendingCount = useMemo(() => steps.filter(s => !s.is_divider && s.status === "pending").length, [steps]);
  const progressPct  = totalSteps.length > 0 ? Math.round((doneSteps.length / totalSteps.length) * 100) : 0;

  const filteredSteps = useMemo(() => steps.filter(s => {
    if (s.is_divider)                                   return true;
    if (filter !== "all" && s.status !== filter)        return false;
    if (search && !s.action.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [steps, filter, search]);

  const test_name = module_tests.find(mt => mt.id === currentMtId)?.test?.name ?? testsName;

  const exportData: FlatData[] = useMemo(() => steps
    .filter(s => !s.is_divider)
    .map(s => ({
      module:   module_name,
      test:     test_name,
      serial:   s.serial_no,
      action:   s.action,
      expected: s.expected_result,
      remarks:  s.remarks,
      status:   s.status,
    })), [steps, module_name, test_name]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex-1 flex flex-col">
      <Topbar title={test_name} subtitle={module_name} onBack={onBack} />
      <div className="flex-1 flex items-center justify-center"><Spinner /></div>
    </div>
  );

  if (lockedByOther) return (
    <div className="flex-1 flex flex-col">
      <Topbar title={test_name} subtitle={module_name} onBack={onBack} />
      <LockedScreen locked_by_name={lockedByOther} test_name={test_name} onBack={onBack} />
      {isAdmin && (
        <div className="p-4 flex justify-center">
          <button onClick={handleForceRelease}
            className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2 transition-colors">
            Force-release lock (admin)
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col">
      {/* Topbar */}
      <Topbar
        title={test_name}
        subtitle={module_name}
        onBack={() => { releaseLock(currentMtId, user?.id ?? "").catch(() => {}); onBack(); }}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowMassUpload(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium text-t-secondary hover:text-t-primary transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--color-primary)] active:scale-[0.97]"
              style={{ borderColor: "var(--border-color)" }}>
              <Upload size={13} /> Images
            </button>
            <button onClick={() => setShowExport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium text-t-secondary hover:text-t-primary transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--color-primary)] active:scale-[0.97]"
              style={{ borderColor: "var(--border-color)" }}>
              <Upload size={13} /> Export
            </button>
            {doneSteps.length > 0 && (
              <button onClick={() => setShowUndoModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium text-amber-500 border-amber-500/40 hover:bg-amber-500/10 transition-all active:scale-[0.97]">
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </div>
        }
      />

      {/* Progress bar */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-center justify-between text-xs text-t-muted mb-1.5">
          <div className="flex items-center gap-3">
            <span className="badge-pass"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1" />{passCount} Pass</span>
            <span className="badge-fail"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block mr-1"   />{failCount} Fail</span>
            <span className="flex items-center gap-1 text-xs font-semibold text-t-muted bg-bg-card border border-[var(--border-color)] rounded-full px-2.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: "var(--text-muted)" }} />{pendingCount} Pending
            </span>
          </div>
          <span className="font-semibold text-t-primary">{progressPct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-bg-card overflow-hidden flex">
          {passCount > 0 && <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${totalSteps.length > 0 ? (passCount / totalSteps.length) * 100 : 0}%` }} />}
          {failCount > 0 && <div className="h-full bg-red-500   transition-all duration-500" style={{ width: `${totalSteps.length > 0 ? (failCount / totalSteps.length) * 100 : 0}%` }} />}
        </div>
      </div>

      {/* Filter + Search */}
      <div className="px-6 py-2 flex items-center gap-2 flex-wrap">
        {(["all", "pass", "fail", "pending"] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide transition-colors ${
              filter === f ? "bg-c-brand text-white" : "bg-bg-card text-t-muted hover:text-t-primary"
            }`}>
            {f}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search steps…"
          className="ml-auto text-xs px-3 py-1.5 rounded-xl bg-bg-card border border-[var(--border-color)] text-t-primary placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors w-40" />
      </div>

      {/* Step list */}
      <div className="flex-1 overflow-y-auto px-6 pb-28 md:pb-6 flex flex-col gap-2 pt-2">
        {filteredSteps.length === 0 && (
          <p className="text-sm text-t-muted text-center py-12">No steps match this filter.</p>
        )}

        {filteredSteps.map(step => {
          if (step.is_divider) {
            const lvl = getDividerLevel(step.expected_result);
            const cfg = MOBILE_DIVIDER_LEVELS[lvl] ?? MOBILE_DIVIDER_LEVELS[1];
            return (
              <div key={step.stepId}
                className={`rounded-xl ${cfg.bg} ${cfg.border} ${cfg.ml} ${cfg.py} px-4 flex items-center gap-2`}>
                <span className={`rounded-full shrink-0 ${cfg.dotClass}`}
                  style={{ width: cfg.dotSize, height: cfg.dotSize }} />
                <span className={`${cfg.textClass} ${cfg.fontSize}`}>{step.action}</span>
              </div>
            );
          }

          const isSaving   = saving === step.stepId || saving === "all";
          const isExpanded = expandedRemarks.has(step.stepId);
          const actionSigned   = step.action_image_urls.map(p => signedImages[p]).filter(Boolean);
          const expectedSigned = step.expected_image_urls.map(p => signedImages[p]).filter(Boolean);

          return (
            <div key={step.stepId}
              className={`card flex flex-col gap-3 transition-all ${
                step.status === "pass" ? "border-green-500/20" :
                step.status === "fail" ? "border-red-500/20"   : ""
              }`}>

              {/* Step header */}
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono font-bold text-c-brand bg-c-brand-bg px-2 py-1 rounded-lg shrink-0 min-w-[2.5rem] text-center">
                  {step.serial_no}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-t-primary">{step.action || <span className="italic text-t-muted">No action text</span>}</p>
                  {step.expected_result && (
                    <p className="text-xs text-t-muted mt-1">{step.expected_result}</p>
                  )}
                  {step.display_name && step.status !== "pending" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-t-muted mt-1">
                      <User size={10} /> {step.display_name}
                    </span>
                  )}
                </div>
              </div>

              {/* Image thumbnails */}
              {(actionSigned.length > 0 || expectedSigned.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {actionSigned.map((url, i) => (
                    <button key={`a-${i}`} onClick={() => setImagePreview({ urls: actionSigned, idx: i, label: "Action" })}
                      className="w-14 h-14 rounded-lg overflow-hidden border border-[var(--border-color)] hover:border-c-brand transition-colors">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                  {expectedSigned.map((url, i) => (
                    <button key={`e-${i}`} onClick={() => setImagePreview({ urls: expectedSigned, idx: i, label: "Expected" })}
                      className="w-14 h-14 rounded-lg overflow-hidden border border-[var(--border-color)] hover:border-c-brand transition-colors">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Remarks */}
              {(isExpanded || step.status === "fail") && (
                <textarea
                  value={step.remarks}
                  onChange={e => setSteps(prev => prev.map(s => s.stepId === step.stepId ? { ...s, remarks: e.target.value } : s))}
                  onBlur={e => { if (e.target.value !== step.remarks) handleSetStatus(step, step.status, e.target.value); }}
                  placeholder="Add remarks…"
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-bg-base border border-[var(--border-color)] text-t-primary text-xs placeholder:text-t-muted focus:outline-none focus:border-c-brand transition-colors resize-none"
                />
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => handleSetStatus(step, "pass")} disabled={isSaving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    step.status === "pass"
                      ? "bg-green-500 text-white"
                      : "bg-bg-card border border-[var(--border-color)] text-t-muted hover:text-green-400 hover:border-green-500/40"
                  } disabled:opacity-50`}>
                  {isSaving && step.status === "pass" ? <Spinner size={12} /> : <Check size={12} />} Pass
                </button>
                <button onClick={() => handleSetStatus(step, "fail")} disabled={isSaving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    step.status === "fail"
                      ? "bg-red-500 text-white"
                      : "bg-bg-card border border-[var(--border-color)] text-t-muted hover:text-red-400 hover:border-red-500/40"
                  } disabled:opacity-50`}>
                  {isSaving && step.status === "fail" ? <Spinner size={12} /> : <X size={12} />} Fail
                </button>
                {step.status !== "pending" && (
                  <button onClick={() => handleSetStatus(step, "pending")} disabled={isSaving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-bg-card border border-[var(--border-color)] text-t-muted hover:text-amber-400 hover:border-amber-500/40 transition-all disabled:opacity-50">
                    <RotateCcw size={11} /> Reset
                  </button>
                )}
                <button onClick={() => setExpandedRemarks(prev => {
                  const n = new Set(prev);
                  n.has(step.stepId) ? n.delete(step.stepId) : n.add(step.stepId);
                  return n;
                })} className="ml-auto text-xs text-t-muted hover:text-t-primary transition-colors">
                  {isExpanded ? "Hide remarks" : "Add remarks"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      {showUndoModal && (
        <UndoAllModal
          doneCount={doneSteps.length}
          totalCount={totalSteps.length}
          onConfirm={handleUndoAll}
          onCancel={() => setShowUndoModal(false)}
        />
      )}
      {imagePreview && (
        <ImagePreviewModal
          images={imagePreview.urls}
          initialIndex={imagePreview.idx}
          label={imagePreview.label}
          onClose={() => setImagePreview(null)}
        />
      )}
      {showMassUpload && (
        <MassImageUploadModal
          isOpen={showMassUpload}
          onClose={() => { setShowMassUpload(false); load(); }}
        />
      )}
      {showExport && (
        <ExportModal
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          title={test_name}
          subtitle={module_name}
          stats={[
            { label: "Pass",    value: passCount    },
            { label: "Fail",    value: failCount    },
            { label: "Pending", value: pendingCount },
          ]}
          options={[
            {
              label:      "CSV",
              icon:       <FileSpreadsheet size={16} />,
              color:      "bg-[var(--color-primary)]",
              hoverColor: "hover:bg-[var(--color-primary-hover)]",
              onConfirm:  () => exportExecutionCSV(module_name, test_name, exportData),
            },
            {
              label:      "PDF",
              icon:       <FileText size={16} />,
              color:      "bg-[var(--color-blue)]",
              hoverColor: "hover:bg-[var(--color-blue-hover)]",
              onConfirm:  () => exportExecutionPDF(module_name, test_name, exportData),
            },
          ]}
        />
      )}
    </div>
  );
};

export default TestExecution;