import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { useToast } from "../../context/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import { exportExecutionCSV, exportExecutionPDF, FlatData } from "../../utils/export";
import { Lock, Upload, RotateCcw, User, Check, X, ArrowLeft, AlertTriangle, FileSpreadsheet, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import MassImageUploadModal from "../UI/MassImageUploadModal";

interface Props {
  moduleName:          string;
  initialModuleTestId: string;
  isAdmin?:            boolean;
  onBack:              () => void;
}

type Filter = "all" | "pass" | "fail" | "pending";

interface ExecutionStep {
  stepId:            string;
  stepResultId:      string;
  moduleTestId:      string;
  serialno:          number;
  action:            string;
  expectedresult:    string;
  actionImageUrls:   string[];
  expectedImageUrls: string[];
  isdivider:         boolean;
  status:            "pass" | "fail" | "pending";
  remarks:           string;
  displayname:       string;
}

interface ModuleTestItem {
  id:         string;
  tests_name: string;
  test:       { serialno: number; name: string } | null;
}

type SignedImageMap = Record<string, string>;

interface ImagePreviewState {
  urls:  string[];
  idx:   number;
  label: string;
}

// ── Divider Level Config ───────────────────────────────────────
const DIVIDER_LEVELS: Record<number, {
  dot: string; text: string; bg: string; border: string;
  indent: string; size: string;
}> = {
  1: {
    dot:    "bg-c-brand",
    text:   "text-c-brand",
    bg:     "bg-c-brand-bg",
    border: "border-l-[3px] border-c-brand",
    indent: "px-4",
    size:   "text-xs font-bold tracking-widest uppercase",
  },
  2: {
    dot:    "bg-amber-400",
    text:   "text-amber-400",
    bg:     "bg-amber-500/5",
    border: "border-l-[2px] border-amber-400",
    indent: "px-8",
    size:   "text-xs font-semibold tracking-wider uppercase",
  },
  3: {
    dot:    "bg-sky-400",
    text:   "text-sky-400",
    bg:     "bg-sky-500/5",
    border: "border-l-[2px] border-sky-400",
    indent: "px-12",
    size:   "text-[11px] font-medium tracking-wide",
  },
};

const getDividerLevel = (expectedresult: string): number =>
  parseInt(expectedresult, 10) || 1;

// ── Mobile Divider Config ─────────────────────────────────────
const MOBILE_DIVIDER_LEVELS: Record<number, {
  bg: string; border: string; textClass: string; dotClass: string;
  dotSize: number; fontSize: string; ml: string; py: string;
}> = {
  1: {
    bg:        "bg-teal-500/10",
    border:    "border-l-[3px] border-teal-500",
    textClass: "text-teal-400",
    dotClass:  "bg-teal-500",
    dotSize:   7,
    fontSize:  "text-[14px] font-bold tracking-widest uppercase",
    ml:        "ml-0",
    py:        "py-2.5",
  },
  2: {
    bg:        "bg-amber-500/10",
    border:    "border-l-[2px] border-amber-400",
    textClass: "text-amber-400",
    dotClass:  "bg-amber-400",
    dotSize:   5,
    fontSize:  "text-[12px] font-semibold tracking-wide uppercase",
    ml:        "ml-4",
    py:        "py-2",
  },
  3: {
    bg:        "bg-sky-500/10",
    border:    "border-l-[2px] border-sky-400",
    textClass: "text-sky-400",
    dotClass:  "bg-sky-400",
    dotSize:   4,
    fontSize:  "text-[11px] font-medium tracking-wide",
    ml:        "ml-8",
    py:        "py-1.5",
  },
};


// ── Undo All Confirmation Modal ────────────────────────────────
const UndoAllModal: React.FC<{
  doneCount:  number;
  totalCount: number;
  onConfirm:  () => void;
  onCancel:   () => void;
}> = ({ doneCount, totalCount, onConfirm, onCancel }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
    onClick={onCancel}
  >
    <div
      className="relative w-full max-w-sm rounded-2xl border shadow-2xl p-6 flex flex-col gap-4"
      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-color)" }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
          <AlertTriangle size={26} className="text-amber-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-t-primary">Reset All Steps?</h2>
          <p className="text-sm text-t-muted mt-1">
            This will mark all{" "}
            <span className="font-semibold text-t-primary">{doneCount}</span> completed step{doneCount !== 1 ? "s" : ""} (out of{" "}
            <span className="font-semibold text-t-primary">{totalCount}</span>) back to{" "}
            <span className="font-semibold text-amber-500">pending</span>.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/25 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span>All remarks and results will be cleared. <strong>This cannot be undone.</strong></span>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-xl border text-sm font-semibold text-t-secondary
            hover:text-t-primary hover:border-[var(--color-brand)] border-[var(--border-color)]
            bg-bg-card transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white
            bg-amber-500 hover:bg-amber-600 active:bg-amber-700 transition-colors
            flex items-center justify-center gap-1.5"
        >
          <RotateCcw size={14} /> Yes, Reset All
        </button>
      </div>
    </div>
  </div>
);

// ── Image Preview Modal ────────────────────────────────────────
const ImagePreviewModal: React.FC<{
  images:       string[];
  initialIndex: number;
  label:        string;
  onClose:      () => void;
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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20
          border border-white/20 flex items-center justify-center text-white transition-colors z-10"
      >
        <X size={16} />
      </button>

      <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
        <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">{label}</span>
        {total > 1 && <span className="text-xs text-white/40">{idx + 1} / {total}</span>}
      </div>

      {total > 1 && (
        <button
          onClick={e => { e.stopPropagation(); setIdx(i => (i - 1 + total) % total); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full
            bg-white/10 hover:bg-white/20 border border-white/20
            flex items-center justify-center text-white transition-colors z-10"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      <div
        className="relative max-w-4xl max-h-[80vh] flex items-center justify-center"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={images[idx]}
          alt={`${label} ${idx + 1}`}
          className="max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl border border-white/10"
        />
      </div>

      {total > 1 && (
        <button
          onClick={e => { e.stopPropagation(); setIdx(i => (i + 1) % total); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full
            bg-white/10 hover:bg-white/20 border border-white/20
            flex items-center justify-center text-white transition-colors z-10"
        >
          <ChevronRight size={20} />
        </button>
      )}

      {total > 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10"
          onClick={e => e.stopPropagation()}
        >
          {images.map((url, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${
                i === idx ? "border-white scale-110" : "border-white/25 opacity-55 hover:opacity-90"
              }`}
            >
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Locked Screen ──────────────────────────────────────────────
const LockedScreen: React.FC<{
  lockedByName: string;
  testName:     string;
  onBack:       () => void;
}> = ({ lockedByName, testName, onBack }) => (
  <div className="flex flex-col flex-1 items-center justify-center gap-6 p-8 text-center">
    <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
      <Lock size={28} className="text-amber-500" />
    </div>
    <div>
      <h2 className="text-lg font-bold text-t-primary mb-1">Test In Progress</h2>
      <p className="text-t-secondary text-sm max-w-sm">
        <span className="text-amber-600 dark:text-amber-400 font-semibold">{lockedByName}</span> is currently executing{" "}
        <span className="text-t-primary font-semibold">"{testName}"</span>. You cannot enter until they finish.
      </p>
    </div>
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">You'll be unblocked instantly when they finish.</span>
    </div>
    <button onClick={onBack}
      className="flex items-center gap-1.5 px-6 py-2 rounded-xl border border-[var(--border-color)] text-t-secondary
        hover:text-t-primary hover:border-[var(--color-brand)] text-sm font-medium transition-colors">
      <ArrowLeft size={14} /> Go Back
    </button>
  </div>
);

// ── Main Component ─────────────────────────────────────────────
const TestExecution: React.FC<Props> = ({
  moduleName, initialModuleTestId, isAdmin = false, onBack,
}) => {
  const { user }     = useAuth();
  const { addToast } = useToast();
  const { log }      = useAuditLog();

  const currentMtId = initialModuleTestId;
  const testsName   = currentMtId.slice(moduleName.length + 1);

  const [filter, setFilter]                           = useState<Filter>("all");
  const [search, setSearch]                           = useState("");
  const [showExportModal, setShowExportModal]         = useState(false);
  const [showUndoModal, setShowUndoModal]             = useState(false);
  const [showMassImageUpload, setShowMassImageUpload] = useState(false);
  const [scrollTarget, setScrollTarget]               = useState<string | null>(null);
  const [focusedStepId, setFocusedStepId]             = useState<string | null>(null);
  const [signedImageUrls, setSignedImageUrls]         = useState<SignedImageMap>({});
  const [imagePreview, setImagePreview]               = useState<ImagePreviewState | null>(null);

  const openImagePreview = useCallback((
    paths: string[], clickedIdx: number, label: string,
  ) => {
    const urls = paths.map(p => signedImageUrls[p]).filter(Boolean);
    if (urls.length) setImagePreview({ urls, idx: clickedIdx, label });
  }, [signedImageUrls]);

  const stepsInitialized   = useRef(false);
  const remarksMap         = useRef<Record<string, string>>({});
  const heartbeatRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const trRefs             = useRef<Record<string, HTMLTableRowElement | null>>({});
  const cardRefs           = useRef<Record<string, HTMLDivElement   | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [moduleTests, setModuleTests] = useState<ModuleTestItem[]>([]);
  const [steps, setSteps]             = useState<ExecutionStep[]>([]);
  const [lock, setLock]               = useState<any>(null);
  const [loading, setLoading]         = useState(true);
  const [lockLoading, setLockLoading] = useState(true);

  const getSignedUrlsForPaths = useCallback(async (paths: string[]) => {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    if (!uniquePaths.length) return {};
    const results = await Promise.all(
      uniquePaths.map(async (path) => {
        const { data, error } = await supabase.storage
          .from("test_steps")
          .createSignedUrl(path, 60 * 60);
        if (error || !data?.signedUrl) return [path, ""] as const;
        return [path, data.signedUrl] as const;
      })
    );
    return Object.fromEntries(results.filter(([, url]) => !!url));
  }, []);

  useEffect(() => {
    setLoading(true);
    setLockLoading(true);
    stepsInitialized.current = false;
    setFocusedStepId(null);
    remarksMap.current = {};

    (async () => {
      const [mtRes, srRes, lockRes] = await Promise.all([
        supabase
          .from("module_tests")
          .select("id, tests_name")
          .eq("module_name", moduleName)
          .order("id"),
        supabase.rpc("get_step_results_for_module", { p_module_name: moduleName }),
        supabase
          .from("test_locks")
          .select("module_test_id, user_id, locked_by_name")
          .eq("module_test_id", currentMtId),
      ]);

      const rawMts = (mtRes.data ?? []) as { id: string; tests_name: string }[];
      const rawSrs = (srRes.data ?? []) as {
        id: string; modulename: string; teststepsid: string;
        status: string; remarks: string; displayname: string;
      }[];

      const testNames = Array.from(new Set(rawMts.map(m => m.tests_name)));
      const testsRes = testNames.length
        ? await supabase.rpc("get_tests_by_names", { p_names: testNames })
        : { data: [] };
      const testsMap = Object.fromEntries(
        ((testsRes.data ?? []) as { name: string; serialno: number }[]).map(t => [t.name, t])
      );

      setModuleTests(rawMts.map(m => ({
        id:         m.id,
        tests_name: m.tests_name,
        test:       testsMap[m.tests_name] ?? null,
      })));

      const stepIds = rawSrs.map(sr => sr.teststepsid);
      const stepsRes = stepIds.length
        ? await supabase.rpc("get_test_steps_by_ids", { p_ids: stepIds })
        : { data: [] };
      const stepsMap = Object.fromEntries(
        ((stepsRes.data ?? []) as any[]).map(s => [s.id, s])
      );

      const merged: ExecutionStep[] = rawSrs
        .filter(sr => {
          const step = stepsMap[sr.teststepsid];
          return step && step.testsname === testsName;
        })
        .map(sr => {
          const step = stepsMap[sr.teststepsid];
          return {
            stepId:            sr.teststepsid,
            stepResultId:      sr.id,
            moduleTestId:      currentMtId,
            serialno:          step.serialno,
            action:            step.action,
            expectedresult:    step.expectedresult,
            actionImageUrls:   step.action_image_urls   || [],
            expectedImageUrls: step.expected_image_urls || [],
            isdivider:         step.isdivider,
            status:            sr.status as "pass" | "fail" | "pending",
            remarks:           sr.remarks,
            displayname:       sr.displayname ?? "",
          };
        })
        .sort((a, b) => {
          if (a.serialno !== b.serialno) return a.serialno - b.serialno;
          return (a.isdivider ? 0 : 1) - (b.isdivider ? 0 : 1);
        });

      setSteps(merged);
      setLock(lockRes.data?.[0] ?? null);
      setLoading(false);
      setLockLoading(false);
    })();

    const lockChannel = supabase.channel(`lock:${currentMtId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "test_locks",
        filter: `module_test_id=eq.${currentMtId}`,
      }, ({ eventType, new: newRow }: any) => {
        if (eventType === "DELETE") setLock(null); else setLock(newRow);
      })
      .subscribe();

    const srChannel = supabase.channel(`step_results:${moduleName}:${testsName}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "step_results",
        filter: `modulename=eq.${moduleName}`,
      }, ({ new: updated }: any) => {
        setSteps(prev => {
          const match = prev.find(s => s.stepResultId === updated.id);
          if (!match) return prev;
          return prev.map(s =>
            s.stepResultId === updated.id
              ? { ...s, status: updated.status, remarks: updated.remarks, displayname: updated.displayname ?? "" }
              : s
          );
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(lockChannel);
      supabase.removeChannel(srChannel);
    };
  }, [moduleName, currentMtId, testsName]);

  useEffect(() => {
    const allPaths = steps.flatMap(step => [
      ...(step.actionImageUrls   || []),
      ...(step.expectedImageUrls || []),
    ]);
    if (!allPaths.length) { setSignedImageUrls({}); return; }
    let cancelled = false;
    (async () => {
      const map = await getSignedUrlsForPaths(allPaths);
      if (!cancelled) setSignedImageUrls(map);
    })();
    return () => { cancelled = true; };
  }, [steps, getSignedUrlsForPaths]);

  const currentMt   = moduleTests.find(mt => mt.id === currentMtId);
  const currentTest = currentMt?.test;

  useEffect(() => {
    const live = new Set(steps.map(s => s.stepId));
    for (const id of Object.keys(trRefs.current))   { if (!live.has(id)) delete trRefs.current[id]; }
    for (const id of Object.keys(cardRefs.current)) { if (!live.has(id)) delete cardRefs.current[id]; }
  }, [steps]);

  useEffect(() => {
    if (steps.length === 0 || stepsInitialized.current) return;
    stepsInitialized.current = true;
    const firstPending = steps.find(s => !s.isdivider && s.status === "pending");
    if (firstPending) { setFocusedStepId(firstPending.stepId); setScrollTarget(firstPending.stepId); }
  }, [steps]);

  const isLockedByOther = !!(lock && lock.user_id !== user?.id);

  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      if (user) await supabase.from("test_locks")
        .update({ locked_at: new Date().toISOString() })
        .eq("module_test_id", currentMtId)
        .eq("user_id", user.id);
    }, 15000);
  }, [currentMtId, user]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      await supabase.from("test_locks").upsert(
        {
          module_test_id: currentMtId,
          user_id:        user.id,
          locked_by_name: user.displayName || user.email || "User",
          locked_at:      new Date().toISOString(),
        },
        { onConflict: "module_test_id", ignoreDuplicates: true }
      );
      if (cancelled) return;
      const { data: owned } = await supabase
        .from("test_locks")
        .select("user_id")
        .eq("module_test_id", currentMtId)
        .single();
      if (!cancelled && owned?.user_id === user.id) startHeartbeat();
    })();
    return () => {
      cancelled = true;
      stopHeartbeat();
      supabase.from("test_locks").delete()
        .eq("module_test_id", currentMtId).eq("user_id", user.id);
    };
  }, [currentMtId, user?.id, startHeartbeat, stopHeartbeat]);

  useEffect(() => {
    if (!user) return;
    const release = () => {
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      fetch(
        `${supabaseUrl}/rest/v1/test_locks?module_test_id=eq.${currentMtId}&user_id=eq.${user.id}`,
        {
          method: "DELETE", keepalive: true,
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        }
      );
    };
    window.addEventListener("beforeunload", release);
    return () => window.removeEventListener("beforeunload", release);
  }, [currentMtId, user?.id]);

  useEffect(() => {
    if (!scrollTarget || loading) return;
    let rafId1: number, rafId2: number;
    rafId1 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        const isDesktop = window.innerWidth >= 768;
        const el        = isDesktop ? trRefs.current[scrollTarget] : cardRefs.current[scrollTarget];
        const container = scrollContainerRef.current;
        if (!el || !container) return;
        const elRect      = el.getBoundingClientRect();
        const cRect       = container.getBoundingClientRect();
        const theadHeight = isDesktop
          ? (container.querySelector("thead") as HTMLElement | null)?.offsetHeight ?? 0
          : 0;
        const scrollTo = elRect.top - cRect.top + container.scrollTop
                         - (cRect.height - theadHeight) / 2 + elRect.height / 2
                         + theadHeight;
        container.scrollTo({ top: Math.max(0, scrollTo), behavior: "smooth" });
        setScrollTarget(null);
      });
    });
    return () => { cancelAnimationFrame(rafId1); cancelAnimationFrame(rafId2); };
  }, [scrollTarget, loading]);

  const handleStepUpdate = useCallback(async (
    stepId: string, status: "pass" | "fail" | "pending", remarks: string,
  ) => {
    const idx         = steps.findIndex(s => s.stepId === stepId);
    const nextPending = steps.slice(idx + 1).find(s => !s.isdivider && s.status === "pending");
    const displayName = user?.displayName || user?.email || "User";
    const prevSteps   = steps;

    setSteps(prev => prev.map(s =>
      s.stepId === stepId ? { ...s, status, remarks, displayname: displayName } : s
    ));

    if (status !== "pending") {
      if (nextPending) { setFocusedStepId(nextPending.stepId); setScrollTarget(nextPending.stepId); }
      else setFocusedStepId(null);
    } else {
      setFocusedStepId(stepId);
      setScrollTarget(stepId);
    }

    try {
      const rpcRes = await supabase.rpc("update_step_result", {
        p_module_name:   moduleName,
        p_test_steps_id: stepId,
        p_status:        status,
        p_remarks:       remarks,
        p_displayname:   displayName,
      });
      if (rpcRes.error) throw rpcRes.error;
    } catch {
      setSteps(prevSteps);
      addToast("Failed to save step result. Please try again.", "error");
    }
  }, [steps, moduleName, user, addToast]);

  const handleUndoAll = useCallback(async () => {
    setShowUndoModal(false);
    const actionable = steps.filter(s => !s.isdivider);
    const prevSteps  = steps;
    const undoName   = user?.displayName || user?.email || "User";

    setSteps(prev => prev.map(s =>
      s.isdivider ? s : { ...s, status: "pending", remarks: "", displayname: undoName }
    ));
    remarksMap.current = {};
    const first = actionable[0];
    if (first) { setFocusedStepId(first.stepId); setScrollTarget(first.stepId); }

    try {
      const rpcResults = await Promise.all(
        actionable.map(s => supabase.rpc("update_step_result", {
          p_module_name:   moduleName,
          p_test_steps_id: s.stepId,
          p_status:        "pending",
          p_remarks:       "",
          p_displayname:   undoName,
        }))
      );
      const rpcFailed = rpcResults.find(r => r.error);
      if (rpcFailed) throw rpcFailed.error;
      addToast("All steps reset to pending.", "info");
      log("Undo all steps", "info");
    } catch {
      setSteps(prevSteps);
      addToast("Failed to reset steps. Please try again.", "error");
    }
  }, [steps, moduleName, user, addToast, log]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON") return;
      if (!focusedStepId || isLockedByOther) return;
      const focused = steps.find(s => s.stepId === focusedStepId);
      if (!focused || focused.isdivider) return;
      handleStepUpdate(focusedStepId, "pass", remarksMap.current[focusedStepId] ?? focused.remarks ?? "");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusedStepId, steps, isLockedByOther, handleStepUpdate]);

  const handleFinish = async () => {
    stopHeartbeat();
    if (user) await supabase.from("test_locks").delete()
      .eq("module_test_id", currentMtId).eq("user_id", user.id);
    log(`Finished test: ${currentTest?.name}`, "pass");
    addToast(`Test "${currentTest?.name}" completed!`, "success");
    onBack();
  };

  const filtered = useMemo(() => steps.filter(s => {
    if (s.isdivider) return true;
    if (filter !== "all" && s.status !== filter) return false;
    if (search && !`${s.action} ${s.expectedresult} ${s.remarks}`
      .toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [steps, filter, search]);

  const flatData = useMemo<FlatData[]>(() =>
    steps.map(s =>
      s.isdivider
        ? { module: moduleName, test: currentTest?.name ?? "", serial: 0, action: s.action, expected: "", remarks: "", status: "", isDivider: true }
        : { module: moduleName, test: currentTest?.name ?? "", serial: s.serialno, action: s.action, expected: s.expectedresult, remarks: s.remarks || "", status: s.status }
    ),
  [steps, moduleName, currentTest?.name]);

  const exportStats = useMemo(() => {
    const nd = flatData.filter(s => !s.isDivider);
    return [
      { label: "Total Steps", value: nd.length },
      { label: "Pass",        value: nd.filter(s => s.status === "pass").length },
      { label: "Fail",        value: nd.filter(s => s.status === "fail").length },
    ];
  }, [flatData]);

  const { passCount, failCount, totalCount, doneCount, progressPct, passPct, failPct } =
    useMemo(() => {
      const nd    = steps.filter(s => !s.isdivider);
      const pass  = nd.filter(s => s.status === "pass").length;
      const fail  = nd.filter(s => s.status === "fail").length;
      const total = nd.length;
      const done  = pass + fail;
      return {
        passCount:   pass,
        failCount:   fail,
        totalCount:  total,
        doneCount:   done,
        progressPct: total > 0 ? Math.round((done / total) * 100) : 0,
        passPct:     total > 0 ? (pass / total) * 100 : 0,
        failPct:     total > 0 ? (fail / total) * 100 : 0,
      };
    }, [steps]);

  if (lockLoading) return (
    <div className="flex flex-col items-center justify-center gap-3" style={{ height: "100dvh" }}>
      <Spinner /><p className="text-xs text-t-muted">Checking lock status…</p>
    </div>
  );

  if (isLockedByOther) return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>
      <Topbar title={currentTest?.name ?? "Test Execution"} subtitle={moduleName} />
      <LockedScreen lockedByName={lock.locked_by_name} testName={currentTest?.name ?? "this test"} onBack={onBack} />
    </div>
  );

  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>

      {imagePreview && (
        <ImagePreviewModal
          images={imagePreview.urls}
          initialIndex={imagePreview.idx}
          label={imagePreview.label}
          onClose={() => setImagePreview(null)}
        />
      )}

      {showUndoModal && (
        <UndoAllModal
          doneCount={doneCount}
          totalCount={totalCount}
          onConfirm={handleUndoAll}
          onCancel={() => setShowUndoModal(false)}
        />
      )}

      <ExportModal
        isOpen={showExportModal} onClose={() => setShowExportModal(false)}
        title="Export Test Results" subtitle={`${moduleName} · ${currentTest?.name ?? ""}`}
        stats={exportStats}
        options={[
          {
            label: "CSV",
            icon: <FileSpreadsheet size={16} />,
            color: "bg-[var(--color-primary)]",
            hoverColor: "hover:bg-[var(--color-primary-hover)]",
            onConfirm: () => exportExecutionCSV(moduleName, currentTest?.name ?? "test", flatData),
          },
          {
            label: "PDF",
            icon: <FileText size={16} />,
            color: "bg-[var(--color-blue)]",
            hoverColor: "hover:bg-[var(--color-blue-hover)]",
            onConfirm: () => exportExecutionPDF(moduleName, currentTest?.name ?? "test", flatData),
          },
        ]}
      />

      <MassImageUploadModal
        isOpen={showMassImageUpload}
        onClose={() => setShowMassImageUpload(false)}
      />

      {/* Fixed header */}
      <div className="flex-shrink-0">
        <Topbar
          title={currentTest ? `${currentTest.serialno}. ${currentTest.name}` : "Test Execution"}
          subtitle={moduleName}
          actions={
            <>
              {isAdmin && (
                <button
                  onClick={() => setShowMassImageUpload(true)}
                  className="px-3 py-2 rounded-xl border border-[var(--border-color)] bg-bg-card text-t-primary text-sm font-semibold hover:bg-bg-surface transition-colors"
                >
                  Mass Upload Images
                </button>
              )}
              <button onClick={handleFinish} className="btn-primary text-sm">
                Finish Test
              </button>
            </>
          }
        />

        {/* Progress bar */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-4 text-xs text-t-muted">
              <span><span className="text-green-400 font-semibold">{passCount}</span> pass</span>
              <span><span className="text-red-400 font-semibold">{failCount}</span> fail</span>
              <span><span className="text-t-muted font-semibold">{totalCount - doneCount}</span> pending</span>
            </div>
            <div className="flex items-center gap-3">
              {focusedStepId && (
                <span className="hidden md:flex items-center gap-1.5 text-xs text-t-muted">
                  <kbd className="px-1.5 py-0.5 rounded bg-[var(--border-color)] text-t-secondary font-mono text-[10px] border border-[var(--border-color)]">Enter</kbd>
                  to pass
                </span>
              )}
              <span className="text-xs text-t-muted font-medium">{progressPct}%</span>
            </div>
          </div>
          <div className="h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden flex">
            <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${passPct}%` }} />
            <div className="h-full bg-red-500 transition-all duration-500"  style={{ width: `${failPct}%` }} />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 px-4 py-2">
            <button
              onClick={() => setShowExportModal(true)}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-color)]
                bg-bg-card hover:bg-bg-surface disabled:opacity-40 disabled:cursor-not-allowed
                text-t-primary text-xs font-semibold transition shrink-0"
            >
              <Upload size={13} /> Export
            </button>
            <div className="flex-1" />
            <div className="flex gap-1">
              {(["all", "pass", "fail", "pending"] as Filter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={filter === f ? { color: "#ffffff" } : undefined}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${
                    filter === f ? "bg-c-brand" : "text-t-muted hover:text-t-primary"
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 pb-2">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search steps…"
              className="input text-xs py-1.5 w-full"
            />
          </div>
        </div>
      </div>

      {/* Scroll container */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto" style={{ scrollBehavior: "smooth" }}>
        {loading ? (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-t-muted py-20 text-sm">No steps match your filter.</div>
        ) : (
          <>
            {/* ── Desktop table ─────────────────────────────────── */}
            <table className="hidden md:table w-full text-sm border-collapse table-fixed">
              <thead className="sticky top-0 z-10">
                <tr className="bg-bg-surface border-b border-[var(--border-color)]">
                  <th className="text-left px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[6%]  border-r border-[var(--border-color)]">S.No</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[28%] border-r border-[var(--border-color)]">Action</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[28%] border-r border-[var(--border-color)]">Expected Result</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[13%] border-r border-[var(--border-color)]">Remarks</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[11%] border-r border-[var(--border-color)]">Status</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[14%]">Result</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(step =>
                  step.isdivider ? (() => {
                    const level = getDividerLevel(step.expectedresult);
                    const s     = DIVIDER_LEVELS[level] ?? DIVIDER_LEVELS[1];
                    return (
                      <tr key={step.stepId} className={`border-b border-[var(--border-color)] ${s.bg}`}>
                        <td colSpan={6} className={`py-2 ${s.indent} ${s.border}`}>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full ${s.dot} inline-block shrink-0`}
                              style={{
                                width:  level === 1 ? 6 : level === 2 ? 5 : 4,
                                height: level === 1 ? 6 : level === 2 ? 5 : 4,
                              }}
                            />
                            <span className={`${s.size} ${s.text}`}>{step.action}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })() : (
                    <TableStepRow
                      key={step.stepId}
                      step={step}
                      signedImageUrls={signedImageUrls}
                      readonly={false}
                      isFocused={focusedStepId === step.stepId}
                      onUpdate={handleStepUpdate}
                      onFocus={() => setFocusedStepId(step.stepId)}
                      onRemarksChange={(val: string) => (remarksMap.current[step.stepId] = val)}
                      onImageClick={openImagePreview}
                      rowRef={(el: HTMLTableRowElement | null) => (trRefs.current[step.stepId] = el)}
                    />
                  )
                )}
              </tbody>
            </table>

            {/* ── Mobile cards ──────────────────────────────────── */}
            <div className="md:hidden flex flex-col">
              <div className="sticky top-0 z-10 grid grid-cols-[64px_1fr] border-b border-[var(--border-color)] bg-bg-surface/80 backdrop-blur-md">
                <div className="px-3 py-2 border-r border-[var(--border-color)]">
                  <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">S.No</span>
                </div>
                <div className="px-3 py-2 flex items-center">
                  <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">Step Details</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 p-3">
                {filtered.map(step =>
                  step.isdivider ? (() => {
                    const level = getDividerLevel(step.expectedresult);
                    const ms    = MOBILE_DIVIDER_LEVELS[level] ?? MOBILE_DIVIDER_LEVELS[1];
                    return (
                      <div
                        key={step.stepId}
                        className={`flex items-center gap-2 ${ms.py} pl-3 pr-3 rounded-r-lg ${ms.bg} ${ms.border} ${ms.ml}`}
                      >
                        <span
                          className={`rounded-full shrink-0 ${ms.dotClass}`}
                          style={{ width: ms.dotSize, height: ms.dotSize }}
                        />
                        <span className={`${ms.fontSize} ${ms.textClass}`}>{step.action}</span>
                      </div>
                    );
                  })() : (
                    <MobileStepCard
                      key={step.stepId}
                      step={step}
                      signedImageUrls={signedImageUrls}
                      readonly={false}
                      isFocused={focusedStepId === step.stepId}
                      onUpdate={handleStepUpdate}
                      onFocus={() => setFocusedStepId(step.stepId)}
                      onRemarksChange={(val: string) => (remarksMap.current[step.stepId] = val)}
                      onImageClick={openImagePreview}
                      cardRef={(el: HTMLDivElement | null) => (cardRefs.current[step.stepId] = el)}
                    />
                  )
                )}
              </div>
            </div>

            {/* Undo All */}
            {isAdmin && doneCount > 0 && (
              <div className="flex items-center justify-center py-6 px-4">
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5">
                  <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                  <span className="text-xs text-t-muted">Admin action — resets all progress</span>
                  <button
                    onClick={() => setShowUndoModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                      text-amber-600 dark:text-amber-400
                      bg-amber-500/10 hover:bg-amber-500/20
                      border border-amber-500/30 hover:border-amber-500/60
                      transition-colors whitespace-nowrap"
                  >
                    <RotateCcw size={12} /> Undo All
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Tester Badge ──────────────────────────────────────────────
const TesterBadge: React.FC<{ name: string; status: "pass" | "fail" | "pending" }> = ({ name, status }) => {
  if (!name) return null;
  const color = status === "pass" ? "text-green-400" : status === "fail" ? "text-red-400" : "text-t-muted";
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium ${color} opacity-80`}>
      <User size={10} />
      <span className="truncate max-w-[96px]">{name}</span>
    </span>
  );
};

// ── Desktop Table Row ─────────────────────────────────────────
const TableStepRow: React.FC<{
  step:            ExecutionStep;
  signedImageUrls: Record<string, string>;
  readonly:        boolean;
  isFocused:       boolean;
  onUpdate:        (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus:         () => void;
  onRemarksChange: (val: string) => void;
  onImageClick:    (paths: string[], idx: number, label: string) => void;
  rowRef?:         (el: HTMLTableRowElement | null) => void;
}> = ({ step, signedImageUrls, readonly, isFocused, onUpdate, onFocus, onRemarksChange, onImageClick, rowRef }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);

  const rowBg: string                    = step.status === "pass" ? "bg-green-500/5" : step.status === "fail" ? "bg-red-500/5" : "";
  const focusStyle: React.CSSProperties = isFocused ? { outline: "2px solid #38bdf8", outlineOffset: "-2px" } : {};

  return (
    <tr
      ref={rowRef}
      onClick={onFocus}
      style={focusStyle}
      className={`border-b border-[var(--border-color)] hover:bg-bg-card transition-colors cursor-pointer ${rowBg}`}
    >
      <td className="px-2 py-3 text-center border-r border-[var(--border-color)]">
        <span className="text-xs font-mono text-t-muted">{step.serialno}</span>
      </td>

      {/* ── Action — whitespace-pre-wrap preserves Alt+Enter line breaks */}
      <td className="px-4 py-3 border-r border-[var(--border-color)] align-top">
        <p className="text-sm text-t-primary leading-snug break-words whitespace-pre-wrap">{step.action}</p>
        {!!step.actionImageUrls?.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {step.actionImageUrls.map((path, i) =>
              signedImageUrls[path] ? (
                <img
                  key={path}
                  src={signedImageUrls[path]}
                  alt={`Action ${i + 1}`}
                  onClick={e => { e.stopPropagation(); onImageClick(step.actionImageUrls, i, "Action"); }}
                  className="w-16 h-16 rounded-lg object-cover border border-[var(--border-color)]
                    cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                />
              ) : null
            )}
          </div>
        )}
      </td>

      {/* ── Expected Result — whitespace-pre-wrap preserves Alt+Enter line breaks */}
      <td className="px-4 py-3 border-r border-[var(--border-color)] align-top">
        <p className="text-sm text-t-secondary leading-snug break-words whitespace-pre-wrap">{step.expectedresult}</p>
        {!!step.expectedImageUrls?.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {step.expectedImageUrls.map((path, i) =>
              signedImageUrls[path] ? (
                <img
                  key={path}
                  src={signedImageUrls[path]}
                  alt={`Expected ${i + 1}`}
                  onClick={e => { e.stopPropagation(); onImageClick(step.expectedImageUrls, i, "Expected"); }}
                  className="w-16 h-16 rounded-lg object-cover border border-[var(--border-color)]
                    cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                />
              ) : null
            )}
          </div>
        )}
      </td>

      <td className="px-3 py-3 border-r border-[var(--border-color)]">
        <textarea
          value={remarks}
          onChange={e => { setRemarks(e.target.value); onRemarksChange(e.target.value); }}
          onFocus={onFocus}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onUpdate(step.stepId, "pass", remarks); } }}
          disabled={readonly}
          placeholder="Remarks… (Enter to pass)"
          rows={2}
          className="input text-sm resize-none disabled:opacity-50 w-full"
        />
      </td>

      <td className="px-2 py-3 text-center border-r border-[var(--border-color)]">
        <div className="flex flex-col items-center gap-1.5">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
            step.status === "pass" ? "bg-green-500/15 text-green-400"
            : step.status === "fail" ? "bg-red-500/15 text-red-400"
            : "bg-[var(--border-color)] text-t-muted"}`}>
            {step.status}
          </span>
          <TesterBadge name={step.displayname} status={step.status} />
        </div>
      </td>

      {!readonly ? (
        <td className="px-2 py-3">
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1 w-full">
              <button
                onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "pass", remarks); }}
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "pass" ? "bg-green-500 text-white" : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
                }`}
              ><Check size={13} /></button>
              <button
                onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "fail", remarks); }}
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "fail" ? "bg-red-500 text-white" : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
                }`}
              ><X size={13} /></button>
            </div>
            {step.status !== "pending" && (
              <button
                onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "pending", ""); }}
                className="w-full h-7 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] transition-colors
                  flex items-center justify-center"
              >
                Undo
              </button>
            )}
          </div>
        </td>
      ) : <td className="px-2 py-3" />}
    </tr>
  );
};

// ── Mobile Step Card ──────────────────────────────────────────
const MobileStepCard: React.FC<{
  step:            ExecutionStep;
  signedImageUrls: Record<string, string>;
  readonly:        boolean;
  isFocused:       boolean;
  onUpdate:        (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus:         () => void;
  onRemarksChange: (val: string) => void;
  onImageClick:    (paths: string[], idx: number, label: string) => void;
  cardRef?:        (el: HTMLDivElement | null) => void;
}> = ({ step, signedImageUrls, readonly, isFocused, onUpdate, onFocus, onRemarksChange, onImageClick, cardRef }) => {
  const [remarks, setRemarks]             = useState(step.remarks || "");
  const [showRemarksDialog, setShowRemarksDialog] = useState(false);
  const [draftRemarks, setDraftRemarks]   = useState(remarks);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);

  const openDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftRemarks(remarks);
    setShowRemarksDialog(true);
    // Slight delay so the dialog is mounted before we focus
    setTimeout(() => textareaRef.current?.focus(), 80);
  };

  const saveRemarks = () => {
    setRemarks(draftRemarks);
    onRemarksChange(draftRemarks);
    setShowRemarksDialog(false);
  };

  const discardRemarks = () => {
    setDraftRemarks(remarks);
    setShowRemarksDialog(false);
  };

  const rowBg       = step.status === "pass" ? "bg-green-500/5" : step.status === "fail" ? "bg-red-500/5" : "";
  const accentColor = isFocused ? "#38bdf8" : step.status === "pass" ? "#22c55e" : step.status === "fail" ? "#ef4444" : "#374151";

  return (
    <>
      {/* ── Remarks bottom-sheet dialog ── */}
      {showRemarksDialog && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={discardRemarks}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl border border-[var(--border-color)] shadow-2xl p-4 flex flex-col gap-3"
            style={{ backgroundColor: "var(--bg-surface)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Dialog header */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-t-muted uppercase tracking-wider">
                Remarks — Step #{step.serialno}
              </span>
              <button
                onClick={discardRemarks}
                className="w-7 h-7 rounded-full bg-[var(--border-color)] flex items-center justify-center
                  text-t-muted hover:text-t-primary transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={draftRemarks}
              onChange={e => setDraftRemarks(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveRemarks(); }
                if (e.key === "Escape") discardRemarks();
              }}
              placeholder="Enter remarks… (Enter to save, Shift+Enter for new line)"
              rows={4}
              className="input text-sm resize-none w-full"
            />

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={discardRemarks}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)]
                  text-sm font-semibold text-t-secondary hover:text-t-primary transition-colors"
              >
                Discard
              </button>
              <button
                onClick={saveRemarks}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white
                  bg-c-brand hover:bg-c-brand/90 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Card ── */}
      <div
        ref={cardRef}
        onClick={onFocus}
        className={`rounded-xl overflow-hidden border border-[var(--border-color)] w-full cursor-pointer transition-shadow ${rowBg} ${isFocused ? "ring-2 ring-sky-400" : ""}`}
        style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
      >
        {/* Card header: serial + status badge */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-bg-card">
          <span className="text-xs font-mono text-t-muted tracking-wide">#{step.serialno}</span>
          <div className="flex items-center gap-2 min-w-0">
            {isFocused && (
              <span className="flex items-center gap-1 text-[10px] text-sky-400 font-medium shrink-0">
                <kbd className="px-1 py-0.5 rounded bg-sky-400/10 border border-sky-400/20 font-mono text-[9px]">Enter</kbd>
                to pass
              </span>
            )}
            <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
              step.status === "pass" ? "bg-green-500/15 text-green-400"
              : step.status === "fail" ? "bg-red-500/15 text-red-400"
              : "bg-[var(--border-color)] text-t-muted"}`}>
              {step.status}
            </span>
            <TesterBadge name={step.displayname} status={step.status} />
          </div>
        </div>

        {/* Action row — whitespace-pre-wrap preserves Alt+Enter line breaks */}
        <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
          <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
            <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Action</span>
          </div>
          <div className="px-3 py-2.5 min-w-0">
            <p className="text-sm leading-snug break-words text-t-primary whitespace-pre-wrap">{step.action}</p>
            {!!step.actionImageUrls?.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {step.actionImageUrls.map((path, i) =>
                  signedImageUrls[path] ? (
                    <img
                      key={path}
                      src={signedImageUrls[path]}
                      alt={`Action ${i + 1}`}
                      onClick={e => { e.stopPropagation(); onImageClick(step.actionImageUrls, i, "Action"); }}
                      className="w-[72px] h-[72px] rounded-lg object-cover border border-[var(--border-color)]
                        cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                    />
                  ) : null
                )}
              </div>
            )}
          </div>
        </div>

        {/* Expected row — whitespace-pre-wrap preserves Alt+Enter line breaks */}
        <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
          <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
            <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Expected</span>
          </div>
          <div className="px-3 py-2.5 min-w-0">
            <p className="text-sm leading-snug break-words text-t-secondary whitespace-pre-wrap">{step.expectedresult}</p>
            {!!step.expectedImageUrls?.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {step.expectedImageUrls.map((path, i) =>
                  signedImageUrls[path] ? (
                    <img
                      key={path}
                      src={signedImageUrls[path]}
                      alt={`Expected ${i + 1}`}
                      onClick={e => { e.stopPropagation(); onImageClick(step.expectedImageUrls, i, "Expected"); }}
                      className="w-[72px] h-[72px] rounded-lg object-cover border border-[var(--border-color)]
                        cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                    />
                  ) : null
                )}
              </div>
            )}
          </div>
        </div>

        {/* Result row: remarks pill + undo + pass/fail buttons */}
        {!readonly && (
          <div className="flex items-center gap-2 px-3 py-2 bg-bg-card">
            {/* Remarks pill — opens dialog on tap */}
            <button
              onClick={openDialog}
              className={`flex-1 min-w-0 flex items-center gap-1.5 px-3 h-8 rounded-full border
                text-xs font-medium transition-colors truncate
                ${remarks
                  ? "border-c-brand/40 bg-c-brand/8 text-t-primary hover:bg-c-brand/15"
                  : "border-[var(--border-color)] bg-bg-surface text-t-muted hover:border-c-brand/40 hover:text-t-primary"
                }`}
            >
              <span className="truncate">{remarks || "Add remarks…"}</span>
              {remarks && (
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-c-brand" />
              )}
            </button>

            {/* Undo — only visible when step is not pending */}
            {step.status !== "pending" && (
              <button
                onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "pending", ""); }}
                className="shrink-0 px-2.5 h-8 rounded-md text-xs font-semibold text-t-muted
                  hover:text-t-primary bg-bg-surface hover:bg-bg-card
                  border border-[var(--border-color)] transition-colors"
              >
                Undo
              </button>
            )}

            {/* Pass */}
            <button
              onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "pass", remarks); }}
              className={`shrink-0 w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "pass"
                  ? "bg-green-500 text-white"
                  : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
              }`}
            ><Check size={14} /></button>

            {/* Fail */}
            <button
              onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "fail", remarks); }}
              className={`shrink-0 w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "fail"
                  ? "bg-red-500 text-white"
                  : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
              }`}
            ><X size={14} /></button>
          </div>
        )}
      </div>
    </>
  );
};

export default TestExecution;