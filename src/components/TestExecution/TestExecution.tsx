import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { useToast } from "../../context/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import { exportExecutionCSV, exportExecutionPDF, FlatData } from "../../utils/export";
import { Lock, Upload, RotateCcw, User, Check, X, ArrowLeft, AlertTriangle, FileSpreadsheet, FileText } from "lucide-react";
import MassImageUploadModal from "../UI/MassImageUploadModal";

interface Props {
  moduleName:          string;
  initialModuleTestId: string;
  isAdmin?:            boolean;
  onBack:              () => void;
}


type Filter = "all" | "pass" | "fail" | "pending";


interface ExecutionStep {
  stepId: string;
  stepResultId: string;
  moduleTestId: string;
  serialno: number;
  action: string;
  expectedresult: string;
  actionImageUrls: string[];
  expectedImageUrls: string[];
  isdivider: boolean;
  status: "pass" | "fail" | "pending";
  remarks: string;
  displayname: string;
}

interface ModuleTestItem {
  id:          string;
  tests_name:  string;
  test: { serialno: number; name: string };
}

type SignedImageMap = Record<string, string>;

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
      {/* Icon + heading */}
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

      {/* Warning note */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/25 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span>All remarks and results will be cleared. <strong>This cannot be undone.</strong></span>
      </div>

      {/* Actions */}
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
  const testsName = currentMtId.slice(moduleName.length + 1);


  const [filter, setFilter]                   = useState<Filter>("all");
  const [search, setSearch]                   = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [showUndoModal, setShowUndoModal]     = useState(false);
  const [showMassImageUpload, setShowMassImageUpload] = useState(false);
  const [scrollTarget, setScrollTarget]       = useState<string | null>(null);
  const [focusedStepId, setFocusedStepId]     = useState<string | null>(null);
  const [signedImageUrls, setSignedImageUrls] = useState<SignedImageMap>({});


  const stepsInitialized = useRef(false);
  const remarksMap       = useRef<Record<string, string>>({});
  const heartbeatRef     = useRef<ReturnType<typeof setInterval> | null>(null);


  const trRefs   = useRef<Record<string, HTMLTableRowElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement   | null>>({});
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


    Promise.all([
      supabase
        .from("module_tests")
        .select("id, tests_name, test:tests!tests_name(serialno, name)")
        .eq("module_name", moduleName)
        .order("id"),
      supabase
        .from("stepresults")
.select(`
  id,
  modulename,
  teststepsid,
  status,
  remarks,
  displayname,
  step:teststeps!teststepsid(
    id,
    serialno,
    action,
    expectedresult,
    action_image_urls,
    expected_image_urls,
    isdivider,
    testsname
  )
`)
        .eq("module_name", moduleName),
      supabase
        .from("test_locks")
        .select("module_test_id, user_id, locked_by_name")
        .eq("module_test_id", currentMtId),
    ]).then(([mtRes, srRes, lockRes]) => {
      setModuleTests((mtRes.data ?? []) as unknown as ModuleTestItem[]);


      const merged: ExecutionStep[] = ((srRes.data ?? []) as any[])
        .filter(sr => sr.step?.tests_name === testsName)
       .map((sr) => ({
  stepId: sr.teststepsid,
  stepResultId: sr.id,
  moduleTestId: currentMtId,
  serialno: sr.step.serialno,
  action: sr.step.action,
  expectedresult: sr.step.expectedresult,
  actionImageUrls: sr.step.action_image_urls || [],
  expectedImageUrls: sr.step.expected_image_urls || [],
  isdivider: sr.step.isdivider,
  status: sr.status,
  remarks: sr.remarks,
  displayname: sr.displayname ?? "",
}))
        .sort((a, b) => {
          if (a.serialno !== b.serialno) return a.serialno - b.serialno;
          return (a.isdivider ? 0 : 1) - (b.isdivider ? 0 : 1);
        });


      setSteps(merged);
      setLock(lockRes.data?.[0] ?? null);
      setLoading(false);
      setLockLoading(false);
    });


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
        filter: `module_name=eq.${moduleName}`,
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
  const allPaths = steps.flatMap((step) => [
    ...(step.actionImageUrls || []),
    ...(step.expectedImageUrls || []),
  ]);

  if (!allPaths.length) {
    setSignedImageUrls({});
    return;
  }

  let cancelled = false;

  (async () => {
    const map = await getSignedUrlsForPaths(allPaths);
    if (!cancelled) setSignedImageUrls(map);
  })();

  return () => {
    cancelled = true;
  };
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
    if (firstPending) {
      setFocusedStepId(firstPending.stepId);
      setScrollTarget(firstPending.stepId);
    }
  }, [steps]);


  const isLockedByOther = !!(lock && lock.user_id !== user?.id);


  // ── Heartbeat ──────────────────────────────────────────────
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


  // ── Lock lifecycle ─────────────────────────────────────────
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


  // ── Lock release on tab/window close ──────────────────────
  useEffect(() => {
    if (!user) return;
    const release = () => {
      const supabaseUrl  = (supabase as any).supabaseUrl  as string;
      const supabaseKey  = (supabase as any).supabaseKey  as string;
      fetch(
        `${supabaseUrl}/rest/v1/test_locks?module_test_id=eq.${currentMtId}&user_id=eq.${user.id}`,
        {
          method:    "DELETE",
          keepalive: true,
          headers: {
            apikey:        supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        }
      );
    };
    window.addEventListener("beforeunload", release);
    return () => window.removeEventListener("beforeunload", release);
  }, [currentMtId, user?.id]);


  // ── Auto-scroll ────────────────────────────────────────────
  useEffect(() => {
    if (!scrollTarget || loading) return;
    let rafId1: number;
    let rafId2: number;
    rafId1 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        const isDesktop = window.innerWidth >= 768;
        const el        = isDesktop
          ? trRefs.current[scrollTarget]
          : cardRefs.current[scrollTarget];
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
    return () => {
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
    };
  }, [scrollTarget, loading]);


  // ── Step update ────────────────────────────────────────────
  const handleStepUpdate = useCallback(async (
    stepId: string, status: "pass" | "fail" | "pending", remarks: string,
  ) => {
    const idx         = steps.findIndex(s => s.stepId === stepId);
    const nextPending = steps.slice(idx + 1).find(s => !s.isdivider && s.status === "pending");
    const displayName = user?.displayName || user?.email || "User";
    const prevSteps   = steps;


    setSteps(prev => prev.map(s =>
      s.stepId === stepId
        ? { ...s, status, remarks, displayname: displayName }
        : s
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
        p_module_name:    moduleName,
        p_test_steps_id:  stepId,
        p_status:         status,
        p_remarks:        remarks,
        p_displayname:   displayName,
      });
      if (rpcRes.error) throw rpcRes.error;
    } catch (err) {
      setSteps(prevSteps);
      addToast("Failed to save step result. Please try again.", "error");
    }
  }, [steps, moduleName, user, addToast]);


  // ── Undo All (admin) ───────────────────────────────────────
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
          p_displayname:  undoName,
        }))
      );
      const rpcFailed = rpcResults.find(r => r.error);
      if (rpcFailed) throw rpcFailed.error;


      addToast("All steps reset to pending.", "info");
      log("Undo all steps", "info");
    } catch (err) {
      setSteps(prevSteps);
      addToast("Failed to reset steps. Please try again.", "error");
    }
  }, [steps, moduleName, user, addToast, log]);


  // ── Keyboard: Enter to pass focused step ───────────────────
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


  // ── Derived / memoised values ──────────────────────────────
  const filtered = useMemo(() => steps.filter(s => {
    if (s.isdivider) return true;
    if (filter !== "all" && s.status !== filter) return false;
    if (search && !`${s.action} ${s.expectedresult} ${s.remarks}`
      .toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [steps, filter, search]);


  // ── flatData: includes dividers for PDF section headers ────
  const flatData = useMemo<FlatData[]>(() =>
    steps.map(s =>
      s.isdivider
        ? {
            module:     moduleName,
            test:       currentTest?.name ?? "",
            serial:     0,
            action:     s.action,
            expected:   "",
            remarks:    "",
            status:     "",
            isDivider:  true,
          }
        : {
            module:    moduleName,
            test:      currentTest?.name ?? "",
            serial:    s.serialno,
            action:    s.action,
            expected:  s.expectedresult,
            remarks:   s.remarks || "",
            status:    s.status,
          }
    ),
  [steps, moduleName, currentTest?.name]);


  // exportStats uses only non-divider rows
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


  // ── Guards ─────────────────────────────────────────────────
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


  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>

      {/* Undo All confirmation modal */}
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
      {/* Fixed sections */}
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

      <button
        onClick={handleFinish}
        className="btn-primary text-sm"
      >
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

        {/* Filters row */}
        <div className="flex flex-col border-b border-[var(--border-color)]">
          {/* Line 1: Export + Filter pills */}
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

          {/* Line 2: Search */}
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
            {/* Desktop table */}
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
                  step.isdivider ? (
                    <tr key={step.stepId} className="border-b border-[var(--border-color)]">
                      <td colSpan={6} className="px-4 py-2 bg-c-brand-bg">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-c-brand inline-block" />
                          <span className="text-xs font-bold text-c-brand uppercase tracking-widest">{step.action}</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <TableStepRow
  key={step.stepId}
  step={step}
  signedImageUrls={signedImageUrls}
  readonly={false}
  isFocused={focusedStepId === step.stepId}
  onUpdate={handleStepUpdate}
  onFocus={() => setFocusedStepId(step.stepId)}
  onRemarksChange={(val) => (remarksMap.current[step.stepId] = val)}
  rowRef={(el) => (trRefs.current[step.stepId] = el)}
/>
                  )
                )}
              </tbody>
            </table>

            {/* Mobile */}
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
                  step.isdivider ? (
                    <div key={step.stepId} className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-[var(--border-color)]" />
                      <span className="text-xs font-semibold text-c-brand uppercase tracking-widest">{step.action}</span>
                      <div className="flex-1 h-px bg-[var(--border-color)]" />
                    </div>
                  ) : (
                    <MobileStepCard
  key={step.stepId}
  step={step}
  signedImageUrls={signedImageUrls}
  readonly={false}
  isFocused={focusedStepId === step.stepId}
  onUpdate={handleStepUpdate}
  onFocus={() => setFocusedStepId(step.stepId)}
  onRemarksChange={(val) => (remarksMap.current[step.stepId] = val)}
  cardRef={(el) => (cardRefs.current[step.stepId] = el)}
/>
                  )
                )}
              </div>
            </div>

            {/* Undo All — admin danger zone, at the bottom of the list */}
            {isAdmin && doneCount > 0 && (
              <div className="flex items-center justify-center py-6 px-4">
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5">
                  <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                  <span className="text-xs text-t-muted">
                    Admin action — resets all progress
                  </span>
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


// ── Desktop Table Row ──────────────────────────────────────────
const TableStepRow: React.FC<{
  step: ExecutionStep;
  signedImageUrls: Record<string, string>;
  readonly: boolean;
  isFocused: boolean;
  onUpdate: (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus: () => void;
  onRemarksChange: (val: string) => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
}> = ({ step, signedImageUrls, readonly, isFocused, onUpdate, onFocus, onRemarksChange, rowRef }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);


  const rowBg      = step.status === "pass" ? "bg-green-500/5" : step.status === "fail" ? "bg-red-500/5" : "";
  const focusStyle: React.CSSProperties = isFocused ? { outline: "2px solid #38bdf8", outlineOffset: "-2px" } : {};


  return (
    <tr ref={rowRef} onClick={onFocus} style={focusStyle}
      className={`border-b border-[var(--border-color)] hover:bg-bg-card transition-colors cursor-pointer ${rowBg}`}>
      <td className="px-2 py-3 text-center border-r border-[var(--border-color)]">
        <span className="text-xs font-mono text-t-muted">{step.serialno}</span>
      </td>
     <td className="px-4 py-3 border-r border-[var(--border-color)] align-top">
  <p className="text-sm text-t-primary leading-snug break-words">{step.action}</p>

  {!!step.actionImageUrls?.length && (
    <div className="mt-2 flex flex-wrap gap-2">
      {step.actionImageUrls.map((path, i) =>
        signedImageUrls[path] ? (
          <img
            key={path}
            src={signedImageUrls[path]}
            alt={`Action ${i + 1}`}
            className="w-16 h-16 rounded-lg object-cover border border-[var(--border-color)] cursor-pointer"
          />
        ) : null
      )}
    </div>
  )}
</td>

<td className="px-4 py-3 border-r border-[var(--border-color)] align-top">
  <p className="text-sm text-t-secondary leading-snug break-words">{step.expectedresult}</p>

  {!!step.expectedImageUrls?.length && (
    <div className="mt-2 flex flex-wrap gap-2">
      {step.expectedImageUrls.map((path, i) =>
        signedImageUrls[path] ? (
          <img
            key={path}
            src={signedImageUrls[path]}
            alt={`Expected ${i + 1}`}
            className="w-16 h-16 rounded-lg object-cover border border-[var(--border-color)] cursor-pointer"
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
              <button onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "pass", remarks); }}
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "pass" ? "bg-green-500 text-white" : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
                }`}><Check size={13} /></button>
              <button onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "fail", remarks); }}
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "fail" ? "bg-red-500 text-white" : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
                }`}><X size={13} /></button>
            </div>
            {step.status !== "pending" && (
              <button onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "pending", ""); }}
                className="w-full h-7 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] transition-colors
                  flex items-center justify-center">
                Undo
              </button>
            )}
          </div>
        </td>
      ) : <td className="px-2 py-3" />}
    </tr>
  );
};


// ── Mobile Step Card ───────────────────────────────────────────
const MobileStepCard: React.FC<{
  step: ExecutionStep;
  signedImageUrls: Record<string, string>;
  readonly: boolean;
  isFocused: boolean;
  onUpdate: (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus: () => void;
  onRemarksChange: (val: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
}> = ({ step, signedImageUrls, readonly, isFocused, onUpdate, onFocus, onRemarksChange, cardRef }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);


  const rowBg       = step.status === "pass" ? "bg-green-500/5" : step.status === "fail" ? "bg-red-500/5" : "";
  const accentColor = isFocused ? "#38bdf8" : step.status === "pass" ? "#22c55e" : step.status === "fail" ? "#ef4444" : "#374151";


  return (
    <div ref={cardRef} onClick={onFocus}
      className={`rounded-xl overflow-hidden border border-[var(--border-color)] w-full cursor-pointer transition-shadow ${rowBg} ${isFocused ? "ring-2 ring-sky-400" : ""}`}
      style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}>


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

<div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
  <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
    <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">
      Action
    </span>
  </div>
  <div className="px-3 py-2.5 min-w-0">
    <p className="text-sm leading-snug break-words text-t-primary">{step.action}</p>

    {!!step.actionImageUrls?.length && (
      <div className="mt-2 flex flex-wrap gap-2">
        {step.actionImageUrls.map((path, i) =>
          signedImageUrls[path] ? (
            <img
              key={path}
              src={signedImageUrls[path]}
              alt={`Action ${i + 1}`}
              className="w-[72px] h-[72px] rounded-lg object-cover border border-[var(--border-color)]"
            />
          ) : null
        )}
      </div>
    )}
  </div>
</div>

<div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
  <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
    <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">
      Expected
    </span>
  </div>
  <div className="px-3 py-2.5 min-w-0">
    <p className="text-sm leading-snug break-words text-t-secondary">{step.expectedresult}</p>

    {!!step.expectedImageUrls?.length && (
      <div className="mt-2 flex flex-wrap gap-2">
        {step.expectedImageUrls.map((path, i) =>
          signedImageUrls[path] ? (
            <img
              key={path}
              src={signedImageUrls[path]}
              alt={`Expected ${i + 1}`}
              className="w-[72px] h-[72px] rounded-lg object-cover border border-[var(--border-color)]"
            />
          ) : null
        )}
      </div>
    )}
  </div>
</div>


      <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
        <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
          <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Remarks</span>
        </div>
        <div className="px-3 py-2 min-w-0">
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
        </div>
      </div>


      {!readonly && (
        <div className="flex items-center justify-between px-3 py-2 bg-bg-card">
          <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">Result</span>
          <div className="flex items-center gap-2">
            {step.status !== "pending" && (
              <button onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "pending", ""); }}
                className="px-2.5 h-8 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] transition-colors flex items-center justify-center">
                Undo
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "pass", remarks); }}
              className={`w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "pass" ? "bg-green-500 text-white" : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
              }`}><Check size={14} /></button>
            <button onClick={e => { e.stopPropagation(); onUpdate(step.stepId, "fail", remarks); }}
              className={`w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "fail" ? "bg-red-500 text-white" : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
              }`}><X size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
};


export default TestExecution;