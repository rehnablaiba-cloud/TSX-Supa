import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { useToast } from "../../context/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import { exportExecutionCSV, exportExecutionPDF, FlatData } from "../../utils/export";

interface Props {
  moduleId:            string;
  moduleName:          string;
  initialModuleTestId: string;
  isAdmin?:            boolean;
  onBack:              () => void;
}

type Filter = "all" | "pass" | "fail" | "pending";

interface ExecutionStep {
  // Schema v2: steps PK is serial_no (integer), no UUID id.
  stepSerialNo:    number;   // was stepId (UUID string)
  stepResultId:    string;   // composite text id: moduleStepsId_serial_no
  moduleStepsId:   string;   // was moduleTestId; FK → module_tests.id
  serial_no:       number;
  action:          string;
  expected_result: string;
  is_divider:      boolean;
  status:          "pass" | "fail" | "pending";
  remarks:         string;
  display_name:    string;
}

interface ModuleTestItem {
  id:   string;  // composite: module_name_tests_name
  // Schema v2: no order_index; test PK is name (no UUID id)
  test: { serial_no: number; name: string };
}

// ── Locked Screen ──────────────────────────────────────────────
const LockedScreen: React.FC<{
  lockedByName: string;
  testName:     string;
  onBack:       () => void;
}> = ({ lockedByName, testName, onBack }) => (
  <div className="flex flex-col flex-1 items-center justify-center gap-6 p-8 text-center">
    <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-3xl">🔒</div>
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
      className="px-6 py-2 rounded-xl border border-[var(--border-color)] text-t-secondary
        hover:text-t-primary hover:border-[var(--color-brand)] text-sm font-medium transition-colors">
      ← Go Back
    </button>
  </div>
);

// ── Main Component ─────────────────────────────────────────────
const TestExecution: React.FC<Props> = ({
  moduleId, moduleName, initialModuleTestId, isAdmin = false, onBack,
}) => {
  const { user }     = useAuth();
  const { addToast } = useToast();
  const { log }      = useAuditLog();

  // currentMtId is fixed — setCurrentMtId intentionally omitted (no test-switcher UI).
  const currentMtId = initialModuleTestId;

  const [filter, setFilter]                   = useState<Filter>("all");
  const [search, setSearch]                   = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [scrollTarget, setScrollTarget]       = useState<number | null>(null);

  const stepsInitialized = useRef(false);
  const remarksMap       = useRef<Record<number, string>>({});
  const heartbeatRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Schema v2: keyed by serial_no (number as string) instead of UUID
  const trRefs   = useRef<Record<string, HTMLTableRowElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement   | null>>({});

  // Schema v2: focusedStepId is the step's serial_no, not a UUID string
  const [focusedStepId, setFocusedStepId] = useState<number | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Module tests, steps, and lock — all fetched in parallel ──
  // FIX (image 1): was a two-step waterfall; currentMtId is already known so
  // we fetch moduleTests + step_results + testlocks in a single Promise.all.
  const [moduleTests, setModuleTests] = useState<ModuleTestItem[]>([]);
  const [steps, setSteps]             = useState<ExecutionStep[]>([]);
  const [lock, setLock]               = useState<any>(null);
  const [loading, setLoading]         = useState(true);
  const [lockLoading, setLockLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setLockLoading(true);
    stepsInitialized.current = false;
    setFocusedStepId(null);
    remarksMap.current = {};

    Promise.all([
      // Schema v2: FK is module_name (was module_id); no order_index
      supabase
        .from("module_tests")
        .select("id, test:tests(serial_no, name)")
        .eq("module_name", moduleId)
        .order("tests_name"),
      // Schema v2: FK is module_steps_id (was module_test_id)
      // steps have no id; serial_no is the PK
      supabase
        .from("step_results")
        .select(`
          id, module_steps_id, steps_serial_no, status, remarks, display_name,
          step:steps ( serial_no, action, expected_result, is_divider )
        `)
        .eq("module_steps_id", currentMtId),
      supabase
        .from("testlocks")
        .select("module_test_id, user_id, locked_by_name")
        .eq("module_test_id", currentMtId),
    ]).then(([mtRes, srRes, lockRes]) => {
      setModuleTests((mtRes.data ?? []) as unknown as ModuleTestItem[]);

      const merged: ExecutionStep[] = ((srRes.data ?? []) as any[])
        .map(sr => ({
          // Schema v2: use steps_serial_no as the step identifier
          stepSerialNo:    sr.step.serial_no as number,
          stepResultId:    sr.id,
          moduleStepsId:   sr.module_steps_id,
          serial_no:       sr.step.serial_no,
          action:          sr.step.action,
          expected_result: sr.step.expected_result,
          is_divider:      sr.step.is_divider,
          status:          sr.status,
          remarks:         sr.remarks,
          display_name:    sr.display_name ?? "",
        }))
        .sort((a, b) => a.serial_no - b.serial_no);

      setSteps(merged);
      setLock(lockRes.data?.[0] ?? null);

      // Both done at the same time — no flash of undefined test name in LockedScreen.
      setLoading(false);
      setLockLoading(false);
    });

    const lockChannel = supabase.channel(`lock:${currentMtId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "testlocks",
        filter: `module_test_id=eq.${currentMtId}`,
      }, ({ eventType, new: newRow }: any) => {
        if (eventType === "DELETE") setLock(null); else setLock(newRow);
      })
      .subscribe();

    // Schema v2: filter column is module_steps_id (was module_test_id)
    const srChannel = supabase.channel(`step_results:${currentMtId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "step_results",
        filter: `module_steps_id=eq.${currentMtId}`,
      }, ({ new: updated }: any) => {
        setSteps(prev => prev.map(s =>
          s.stepResultId === updated.id
            ? { ...s, status: updated.status, remarks: updated.remarks, display_name: updated.display_name ?? "" }
            : s
        ));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(lockChannel);
      supabase.removeChannel(srChannel);
    };
  }, [moduleId, currentMtId]);

  const currentMt   = moduleTests.find(mt => mt.id === currentMtId);
  const currentTest = currentMt?.test;

  // Clean up stale ref entries when steps change
  useEffect(() => {
    // Schema v2: refs are keyed by String(serial_no) instead of UUID
    const live = new Set(steps.map(s => String(s.stepSerialNo)));
    for (const id of Object.keys(trRefs.current))   { if (!live.has(id)) delete trRefs.current[id]; }
    for (const id of Object.keys(cardRefs.current)) { if (!live.has(id)) delete cardRefs.current[id]; }
  }, [steps]);

  // ── Auto-focus first pending step after load ───────────────
  useEffect(() => {
    if (steps.length === 0 || stepsInitialized.current) return;
    stepsInitialized.current = true;
    const firstPending = steps.find(s => !s.is_divider && s.status === "pending");
    if (firstPending) {
      setFocusedStepId(firstPending.stepSerialNo);
      setScrollTarget(firstPending.stepSerialNo);
    }
  }, [steps]);

  const isLockedByOther = !!(lock && lock.user_id !== user?.id);

  // ── Heartbeat ──────────────────────────────────────────────
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      if (user) await supabase.from("testlocks")
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
      // Insert our lock row (ignore if another user already holds it).
      await supabase.from("testlocks").upsert(
        {
          module_test_id: currentMtId,
          user_id:        user.id,
          locked_by_name: user.displayName || user.email || "User",
          locked_at:      new Date().toISOString(),
        },
        { onConflict: "module_test_id", ignoreDuplicates: true }
      );
      if (cancelled) return;

      // FIX (image 3 — critical): ignoreDuplicates:true returns no data on a no-op
      // (e.g. page refresh where we already own the row), so data?.user_id check
      // always failed → heartbeat never started → lock expired mid-session.
      // Fix: always query ownership explicitly after the upsert attempt.
      const { data: owned } = await supabase
        .from("testlocks")
        .select("user_id")
        .eq("module_test_id", currentMtId)
        .single();
      if (!cancelled && owned?.user_id === user.id) startHeartbeat();
    })();
    return () => {
      cancelled = true;
      stopHeartbeat();
      supabase.from("testlocks").delete()
        .eq("module_test_id", currentMtId).eq("user_id", user.id);
    };
  }, [currentMtId, user?.id, startHeartbeat, stopHeartbeat]);

  // ── Lock release on tab/window close ──────────────────────
  // FIX (image 3 — critical): sendBeacon to /api/release-lock silently fails in a
  // Vite SPA (no such server route). Use fetch with keepalive:true so the request
  // survives page unload without needing a server endpoint.
  useEffect(() => {
    if (!user) return;
    const release = () => {
      const supabaseUrl  = (supabase as any).supabaseUrl  as string;
      const supabaseKey  = (supabase as any).supabaseKey  as string;
      fetch(
        `${supabaseUrl}/rest/v1/testlocks?module_test_id=eq.${currentMtId}&user_id=eq.${user.id}`,
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
        const key       = String(scrollTarget);
        const isDesktop = window.innerWidth >= 768;
        const el        = isDesktop
          ? trRefs.current[key]
          : cardRefs.current[key];
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

  // Schema v2: stepSerialNo (number) replaces stepId (UUID string).
  // The RPC update_step_result is replaced with a direct upsert since the
  // step_results schema changed (module_steps_id / steps_serial_no).
  const handleStepUpdate = useCallback(async (
    stepSerialNo: number, status: "pass" | "fail" | "pending", remarks: string,
  ) => {
    const idx         = steps.findIndex(s => s.stepSerialNo === stepSerialNo);
    const step        = steps[idx];
    const nextPending = steps.slice(idx + 1).find(s => !s.is_divider && s.status === "pending");
    const displayName = user?.displayName || user?.email || "User";

    const prevSteps = steps;

    // Optimistic update
    setSteps(prev => prev.map(s =>
      s.stepSerialNo === stepSerialNo
        ? { ...s, status, remarks, display_name: displayName }
        : s
    ));

    if (status !== "pending") {
      if (nextPending) { setFocusedStepId(nextPending.stepSerialNo); setScrollTarget(nextPending.stepSerialNo); }
      else setFocusedStepId(null);
    } else {
      setFocusedStepId(stepSerialNo);
      setScrollTarget(stepSerialNo);
    }

    try {
      // Schema v2: direct upsert on step_results.
      // id = composite key: moduleStepsId_stepSerialNo
      const compositeId = `${currentMtId}_${stepSerialNo}`;
      const { error } = await supabase.from("step_results").upsert({
        id:              compositeId,
        module_steps_id: currentMtId,
        steps_serial_no: stepSerialNo,
        status,
        remarks,
        display_name:    displayName,
        updated_at:      new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw error;
    } catch (err) {
      setSteps(prevSteps);
      addToast("Failed to save step result. Please try again.", "error");
    }
  }, [steps, currentMtId, user, addToast]);

  // Schema v2: batch upsert all steps to pending using direct table writes.
  const handleUndoAll = useCallback(async () => {
    const actionable = steps.filter(s => !s.is_divider);
    const prevSteps  = steps;

    const undoName = user?.displayName || user?.email || "User";
    setSteps(prev => prev.map(s =>
      s.is_divider ? s : { ...s, status: "pending", remarks: "", display_name: undoName }
    ));
    remarksMap.current = {};
    const first = actionable[0];
    if (first) { setFocusedStepId(first.stepSerialNo); setScrollTarget(first.stepSerialNo); }

    try {
      const upsertRows = actionable.map(s => ({
        id:              `${currentMtId}_${s.stepSerialNo}`,
        module_steps_id: currentMtId,
        steps_serial_no: s.stepSerialNo,
        status:          "pending" as const,
        remarks:         "",
        display_name:    undoName,
        updated_at:      new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("step_results")
        .upsert(upsertRows, { onConflict: "id" });
      if (error) throw error;

      addToast("All steps reset to pending.", "info");
      log("Undo all steps", "info");
    } catch (err) {
      setSteps(prevSteps);
      addToast("Failed to reset steps. Please try again.", "error");
    }
  }, [steps, currentMtId, user, addToast, log]);

  // ── Keyboard: Enter to pass focused step ───────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON") return;
      if (!focusedStepId || isLockedByOther) return;
      // Schema v2: focusedStepId is now a number (serial_no)
      const focused = steps.find(s => s.stepSerialNo === focusedStepId);
      if (!focused || focused.is_divider) return;
      handleStepUpdate(focusedStepId, "pass", remarksMap.current[focusedStepId] ?? focused.remarks ?? "");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusedStepId, steps, isLockedByOther, handleStepUpdate]);

  const handleFinish = async () => {
    stopHeartbeat();
    if (user) await supabase.from("testlocks").delete()
      .eq("module_test_id", currentMtId).eq("user_id", user.id);
    log(`Finished test: ${currentTest?.name}`, "pass");
    addToast(`Test "${currentTest?.name}" completed!`, "success");
    onBack();
  };

  // ── Derived / memoised values ──────────────────────────────
  // FIX (image 2): filtered, buildFlatData, exportStats, and progress stats were
  // all recomputed on every render (every keystroke). Wrapped in useMemo.

  const filtered = useMemo(() => steps.filter(s => {
    if (s.is_divider) return true;
    if (filter !== "all" && s.status !== filter) return false;
    if (search && !`${s.action} ${s.expected_result} ${s.remarks}`
      .toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [steps, filter, search]);

  const flatData = useMemo<FlatData[]>(() =>
    steps.filter(s => !s.is_divider).map(s => ({
      module:   moduleName,
      test:     currentTest?.name ?? "",
      serial:   s.serial_no,
      action:   s.action,
      expected: s.expected_result,
      remarks:  s.remarks || "",
      status:   s.status,
    })),
  [steps, moduleName, currentTest?.name]);

  const exportStats = useMemo(() => [
    { label: "Total Steps", value: flatData.length },
    { label: "Pass",        value: flatData.filter(s => s.status === "pass").length },
    { label: "Fail",        value: flatData.filter(s => s.status === "fail").length },
  ], [flatData]);

  const { passCount, failCount, totalCount, doneCount, progressPct, passPct, failPct } =
    useMemo(() => {
      const nd    = steps.filter(s => !s.is_divider);
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
  // FIX (image 3 — medium): previously lockLoading cleared before moduleTests
  // loaded (two separate effects), so LockedScreen received undefined testName.
  // Now all three fetches share one Promise.all, so lockLoading + moduleTests
  // are always ready together.
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

      <ExportModal
        isOpen={showExportModal} onClose={() => setShowExportModal(false)}
        title="Export Test Results" subtitle={`${moduleName} · ${currentTest?.name ?? ""}`}
        stats={exportStats}
        options={[
          { label: "CSV", icon: "📥", color: "bg-green-600", hoverColor: "hover:bg-green-700",
            onConfirm: () => exportExecutionCSV(moduleName, currentTest?.name ?? "test", flatData) },
          { label: "PDF", icon: "📋", color: "bg-red-600", hoverColor: "hover:bg-red-700",
            onConfirm: () => exportExecutionPDF(moduleName, currentTest?.name ?? "test", flatData) },
        ]}
      />

      {/* Fixed sections */}
      <div className="flex-shrink-0">
        <Topbar
          title={currentTest ? `#${currentTest.serial_no} — ${currentTest.name}` : "Test Execution"}
          subtitle={moduleName}
          actions={
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                <button onClick={() => setShowExportModal(true)} disabled={filtered.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 bg-bg-card hover:bg-bg-surface
                    disabled:opacity-40 disabled:cursor-not-allowed text-t-primary
                    text-sm font-semibold rounded-lg transition border border-[var(--border-color)]">
                  📤 Export
                </button>
                <button onClick={handleFinish} className="btn-primary text-sm">Finish Test</button>
              </div>
              {isAdmin && doneCount > 0 && (
                <button
                  onClick={handleUndoAll}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold
                    text-amber-500 hover:text-amber-400
                    bg-amber-500/10 hover:bg-amber-500/20
                    border border-amber-500/30 hover:border-amber-500/60
                    transition-colors whitespace-nowrap"
                >
                  ↩ Undo All
                </button>
              )}
            </div>
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
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] flex-wrap">
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
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search steps…" className="input text-xs py-1.5 w-48" />
        </div>
      </div>

      {/* Scroll container */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto pb-6" style={{ scrollBehavior: "smooth" }}>
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
                  step.is_divider ? (
                    <tr key={String(step.stepSerialNo)} className="border-b border-[var(--border-color)]">
                      <td colSpan={6} className="px-4 py-2 bg-c-brand-bg">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-c-brand inline-block" />
                          <span className="text-xs font-bold text-c-brand uppercase tracking-widest">{step.action}</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <TableStepRow
                      key={String(step.stepSerialNo)}
                      step={step}
                      readonly={false}
                      isFocused={focusedStepId === step.stepSerialNo}
                      onUpdate={handleStepUpdate}
                      onFocus={() => setFocusedStepId(step.stepSerialNo)}
                      onRemarksChange={val => { remarksMap.current[step.stepSerialNo] = val; }}
                      rowRef={el => { trRefs.current[String(step.stepSerialNo)] = el; }}
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
                  step.is_divider ? (
                    <div key={String(step.stepSerialNo)} className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-[var(--border-color)]" />
                      <span className="text-xs font-semibold text-c-brand uppercase tracking-widest">{step.action}</span>
                      <div className="flex-1 h-px bg-[var(--border-color)]" />
                    </div>
                  ) : (
                    <MobileStepCard
                      key={String(step.stepSerialNo)}
                      step={step}
                      readonly={false}
                      isFocused={focusedStepId === step.stepSerialNo}
                      onUpdate={handleStepUpdate}
                      onFocus={() => setFocusedStepId(step.stepSerialNo)}
                      onRemarksChange={val => { remarksMap.current[step.stepSerialNo] = val; }}
                      cardRef={el => { cardRefs.current[String(step.stepSerialNo)] = el; }}
                    />
                  )
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Tester Badge — shared by both desktop and mobile ──────────
const TesterBadge: React.FC<{ name: string; status: "pass" | "fail" | "pending" }> = ({ name, status }) => {
  if (!name) return null;
  const color = status === "pass" ? "text-green-400" : status === "fail" ? "text-red-400" : "text-t-muted";
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium ${color} opacity-80`}>
      <span>👤</span>
      <span className="truncate max-w-[96px]">{name}</span>
    </span>
  );
};

// ── Desktop Table Row ──────────────────────────────────────────
const TableStepRow: React.FC<{
  step:            ExecutionStep;
  readonly:        boolean;
  isFocused:       boolean;
  onUpdate:        (stepSerialNo: number, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus:         () => void;
  onRemarksChange: (val: string) => void;
  rowRef?:         (el: HTMLTableRowElement | null) => void;
}> = ({ step, readonly, isFocused, onUpdate, onFocus, onRemarksChange, rowRef }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);

  const rowBg      = step.status === "pass" ? "bg-green-500/5" : step.status === "fail" ? "bg-red-500/5" : "";
  const focusStyle: React.CSSProperties = isFocused ? { outline: "2px solid #38bdf8", outlineOffset: "-2px" } : {};

  return (
    <tr ref={rowRef} onClick={onFocus} style={focusStyle}
      className={`border-b border-[var(--border-color)] hover:bg-bg-card transition-colors cursor-pointer ${rowBg}`}>
      <td className="px-2 py-3 text-center border-r border-[var(--border-color)]">
        <span className="text-xs font-mono text-t-muted">{step.serial_no}</span>
      </td>
      <td className="px-4 py-3 border-r border-[var(--border-color)]">
        <p className="text-sm text-t-primary leading-snug break-words">{step.action}</p>
      </td>
      <td className="px-4 py-3 border-r border-[var(--border-color)]">
        <p className="text-sm text-t-secondary leading-snug break-words">{step.expected_result}</p>
      </td>
      <td className="px-3 py-3 border-r border-[var(--border-color)]">
        <textarea
          value={remarks}
          onChange={e => { setRemarks(e.target.value); onRemarksChange(e.target.value); }}
          onFocus={onFocus}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onUpdate(step.stepSerialNo, "pass", remarks); } }}
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
          <TesterBadge name={step.display_name} status={step.status} />
        </div>
      </td>

      {!readonly ? (
        <td className="px-2 py-3">
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1 w-full">
              <button onClick={e => { e.stopPropagation(); onUpdate(step.stepSerialNo, "pass", remarks); }}
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "pass" ? "bg-green-500 text-white" : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
                }`}>✓</button>
              <button onClick={e => { e.stopPropagation(); onUpdate(step.stepSerialNo, "fail", remarks); }}
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "fail" ? "bg-red-500 text-white" : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
                }`}>✗</button>
            </div>
            {step.status !== "pending" && (
              <button onClick={e => { e.stopPropagation(); onUpdate(step.stepSerialNo, "pending", ""); }}
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
  step:            ExecutionStep;
  readonly:        boolean;
  isFocused:       boolean;
  onUpdate:        (stepSerialNo: number, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus:         () => void;
  onRemarksChange: (val: string) => void;
  cardRef?:        (el: HTMLDivElement | null) => void;
}> = ({ step, readonly, isFocused, onUpdate, onFocus, onRemarksChange, cardRef }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);

  const rowBg       = step.status === "pass" ? "bg-green-500/5" : step.status === "fail" ? "bg-red-500/5" : "";
  const accentColor = isFocused ? "#38bdf8" : step.status === "pass" ? "#22c55e" : step.status === "fail" ? "#ef4444" : "#374151";

  return (
    <div ref={cardRef} onClick={onFocus}
      className={`rounded-xl overflow-hidden border border-[var(--border-color)] w-full cursor-pointer transition-shadow ${rowBg} ${isFocused ? "ring-2 ring-sky-400" : ""}`}
      style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}>

      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-bg-card">
        <span className="text-xs font-mono text-t-muted tracking-wide">#{step.serial_no}</span>
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
          <TesterBadge name={step.display_name} status={step.status} />
        </div>
      </div>

      {[
        { label: "Action",   value: step.action,         cls: "text-t-primary" },
        { label: "Expected", value: step.expected_result, cls: "text-t-secondary" },
      ].map(({ label, value, cls }) => (
        <div key={label} className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
          <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
            <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">{label}</span>
          </div>
          <div className="px-3 py-2.5 min-w-0">
            <p className={`text-sm leading-snug break-words ${cls}`}>{value}</p>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
        <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
          <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Remarks</span>
        </div>
        <div className="px-3 py-2 min-w-0">
          <textarea
            value={remarks}
            onChange={e => { setRemarks(e.target.value); onRemarksChange(e.target.value); }}
            onFocus={onFocus}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onUpdate(step.stepSerialNo, "pass", remarks); } }}
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
              <button onClick={e => { e.stopPropagation(); onUpdate(step.stepSerialNo, "pending", ""); }}
                className="px-2.5 h-8 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] transition-colors flex items-center justify-center">
                Undo
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); onUpdate(step.stepSerialNo, "pass", remarks); }}
              className={`w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "pass" ? "bg-green-500 text-white" : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
              }`}>✓</button>
            <button onClick={e => { e.stopPropagation(); onUpdate(step.stepSerialNo, "fail", remarks); }}
              className={`w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "fail" ? "bg-red-500 text-white" : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
              }`}>✗</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TestExecution;