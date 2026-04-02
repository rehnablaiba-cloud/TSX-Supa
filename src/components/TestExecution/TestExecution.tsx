import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { useToast } from "../../context/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import { exportExecutionCSV, exportExecutionPDF, FlatData } from "../../utils/export";

// Props now receive moduleTestId (module_tests.id) instead of raw testId
interface Props {
  moduleId: string;
  moduleName: string;
  initialModuleTestId: string;
  onBack: () => void;
}

type Filter = "all" | "pass" | "fail" | "pending";

// Combined type: step definition merged with its per-module result
interface ExecutionStep {
  stepId:        string;
  stepResultId:  string;
  moduleTestId:  string;
  serial_no:     number;
  action:        string;
  expected_result: string;
  is_divider:    boolean;
  status:        "pass" | "fail" | "pending";
  remarks:       string;
}

// Shape returned by Supabase for module_tests list
interface ModuleTestItem {
  id:          string;
  order_index: number;
  test: { id: string; serial_no: number; name: string };
}

// ── Locked Screen ─────────────────────────────────────────────
const LockedScreen: React.FC<{ lockedByName: string; testName: string; onBack: () => void }> = ({
  lockedByName, testName, onBack,
}) => (
  <div className="flex flex-col h-full items-center justify-center gap-6 p-8 text-center">
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

// ── Main Component ────────────────────────────────────────────
const TestExecution: React.FC<Props> = ({ moduleId, moduleName, initialModuleTestId, onBack }) => {
  const { user }      = useAuth();
  const { addToast }  = useToast();
  const { log }       = useAuditLog();

  const [currentMtId, setCurrentMtId]         = useState(initialModuleTestId);
  const [filter, setFilter]                   = useState<Filter>("all");
  const [search, setSearch]                   = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [lockAcquired, setLockAcquired]       = useState(false);
  const [scrollTarget, setScrollTarget]       = useState<string | null>(null);

  const heartbeatRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRefs           = useRef<Record<string, HTMLTableRowElement | HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Module test list (for navigation) ────────────────────────
  const [moduleTests, setModuleTests] = useState<ModuleTestItem[]>([]);
  useEffect(() => {
    supabase
      .from("module_tests")
      .select("id, order_index, test:tests(id, serial_no, name)")
      .eq("module_id", moduleId)
      .order("order_index")
      .then(({ data }) => setModuleTests((data ?? []) as ModuleTestItem[]));
  }, [moduleId]);

  const currentMt   = moduleTests.find(mt => mt.id === currentMtId);
  const currentTest = currentMt?.test;

  // ── Steps + step results + lock ────────────────────────────
  const [steps, setSteps]             = useState<ExecutionStep[]>([]);
  const [lock, setLock]               = useState<any>(null);
  const [loading, setLoading]         = useState(true);
  const [lockLoading, setLockLoading] = useState(true);

  useEffect(() => {
    if (!currentTest?.id) return;
    setLoading(true);
    setLockLoading(true);

    Promise.all([
      // Step definitions + results joined in one query
      supabase
        .from("step_results")
        .select(`
          id, module_test_id, step_id, status, remarks,
          step:steps ( id, serial_no, action, expected_result, is_divider )
        `)
        .eq("module_test_id", currentMtId),
      supabase
        .from("testlocks")
        .select("*")
        .eq("module_test_id", currentMtId),
    ]).then(([srRes, lockRes]) => {
      // Flatten into ExecutionStep[], sorted by serial_no
      const merged: ExecutionStep[] = ((srRes.data ?? []) as any[])
        .map((sr) => ({
          stepId:          sr.step.id,
          stepResultId:    sr.id,
          moduleTestId:    sr.module_test_id,
          serial_no:       sr.step.serial_no,
          action:          sr.step.action,
          expected_result: sr.step.expected_result,
          is_divider:      sr.step.is_divider,
          status:          sr.status,
          remarks:         sr.remarks,
        }))
        .sort((a, b) => a.serial_no - b.serial_no);

      setSteps(merged);
      setLock(lockRes.data?.[0] ?? null);
      setLoading(false);
      setLockLoading(false);
    });

    // Real-time: lock changes for this module_test
    const lockChannel = supabase.channel(`lock:${currentMtId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "testlocks",
        filter: `module_test_id=eq.${currentMtId}`,
      }, ({ eventType, new: newRow }: any) => {
        if (eventType === "DELETE") setLock(null); else setLock(newRow);
      })
      .subscribe();

    // Real-time: step_result updates for this module_test
    const srChannel = supabase.channel(`step_results:${currentMtId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "step_results",
        filter: `module_test_id=eq.${currentMtId}`,
      }, ({ new: updated }: any) => {
        setSteps(prev => prev.map(s =>
          s.stepResultId === updated.id
            ? { ...s, status: updated.status, remarks: updated.remarks }
            : s
        ));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(lockChannel);
      supabase.removeChannel(srChannel);
    };
  }, [currentMtId, currentTest?.id]);

  const isLockedByOther = !!(lock && lock.user_id !== user?.id);

  // ── Heartbeat ─────────────────────────────────────────────
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

  // ── Lock lifecycle ────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("testlocks").upsert(
        {
          module_test_id: currentMtId,
          user_id:        user.id,
          locked_by_name: user.displayName || user.email || "User",
          locked_at:      new Date().toISOString(),
        },
        { onConflict: "module_test_id", ignoreDuplicates: true }
      ).select().single();
      if (cancelled) return;
      if (!error && data?.user_id === user.id) { setLockAcquired(true); startHeartbeat(); }
    })();

    return () => {
      cancelled = true;
      stopHeartbeat();
      setLockAcquired(false);
      supabase.from("testlocks")
        .delete()
        .eq("module_test_id", currentMtId)
        .eq("user_id", user.id);
    };
  }, [currentMtId, user?.id]);

  // Release lock on tab/window close
  useEffect(() => {
    if (!user) return;
    const release = () => {
      navigator.sendBeacon
        ? navigator.sendBeacon(`/api/release-lock?mtId=${currentMtId}&userId=${user.id}`)
        : supabase.from("testlocks").delete()
            .eq("module_test_id", currentMtId).eq("user_id", user.id);
    };
    window.addEventListener("beforeunload", release);
    return () => window.removeEventListener("beforeunload", release);
  }, [currentMtId, user?.id]);

  // ── Auto-scroll ───────────────────────────────────────────
  useLayoutEffect(() => {
    if (!scrollTarget) return;
    const el        = stepRefs.current[scrollTarget];
    const container = scrollContainerRef.current;
    if (el && container) {
      const elRect        = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollTo      =
        elRect.top - containerRect.top + container.scrollTop
        - container.clientHeight / 2 + elRect.height / 2;
      container.scrollTo({ top: scrollTo, behavior: "smooth" });
      setScrollTarget(null);
    }
  }, [scrollTarget]);

  // ── Step update — optimistic, writes to step_results ────
  const handleStepUpdate = useCallback(async (
    stepId: string, status: "pass" | "fail" | "pending", remarks: string
  ) => {
    const currentIndex = steps.findIndex(s => s.stepId === stepId);
    const nextPending  = steps.slice(currentIndex + 1).find(s => !s.is_divider && s.status === "pending");

    // Optimistic update
    setSteps(prev => prev.map(s => s.stepId === stepId ? { ...s, status, remarks } : s));

    if (status !== "pending" && nextPending) {
      setScrollTarget(nextPending.stepId);
    }

    // Write to step_results via RPC (tester-safe)
    await supabase.rpc("update_step_result", {
      p_module_test_id: currentMtId,
      p_step_id:        stepId,
      p_status:         status,
      p_remarks:        remarks,
    });
  }, [steps, currentMtId]);

  const handleFinish = async () => {
    stopHeartbeat();
    if (user) await supabase.from("testlocks")
      .delete()
      .eq("module_test_id", currentMtId)
      .eq("user_id", user.id);
    log(`Finished test: ${currentTest?.name}`, "pass");
    addToast(`Test "${currentTest?.name}" completed!`, "success");
    onBack();
  };

  // ── Export ─────────────────────────────────────────────
  const buildFlatData = (): FlatData[] =>
    steps.filter(s => !s.is_divider).map(s => ({
      module:   moduleName,
      test:     currentTest?.name ?? "",
      serial:   s.serial_no,
      action:   s.action,
      expected: s.expected_result,
      remarks:  s.remarks || "",
      status:   s.status,
    }));

  const exportStats = () => {
    const flat = buildFlatData();
    return [
      { label: "Total Steps", value: flat.length },
      { label: "Pass",        value: flat.filter(s => s.status === "pass").length },
      { label: "Fail",        value: flat.filter(s => s.status === "fail").length },
    ];
  };

  // ── Filtered steps ────────────────────────────────────
  const filtered = steps.filter(s => {
    if (s.is_divider) return true;
    if (filter !== "all" && s.status !== filter) return false;
    if (search && !`${s.action} ${s.expected_result} ${s.remarks}`
      .toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // ── Progress ──────────────────────────────────────────
  const nonDividers = steps.filter(s => !s.is_divider);
  const passCount   = nonDividers.filter(s => s.status === "pass").length;
  const failCount   = nonDividers.filter(s => s.status === "fail").length;
  const totalCount  = nonDividers.length;
  const doneCount   = passCount + failCount;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  if (lockLoading) return (
    <div className="flex flex-col h-full">
      <Topbar title="Test Execution" subtitle={moduleName} />
      <div className="flex flex-col items-center justify-center flex-1 gap-3">
        <Spinner /><p className="text-xs text-t-muted">Checking lock status…</p>
      </div>
    </div>
  );

  if (isLockedByOther) return (
    <div className="flex flex-col h-full">
      <Topbar title={currentTest?.name ?? "Test Execution"} subtitle={moduleName} />
      <LockedScreen
        lockedByName={lock.locked_by_name}
        testName={currentTest?.name ?? "this test"}
        onBack={onBack}
      />
    </div>
  );

  return (
    <div className="flex flex-col h-full">

      <ExportModal
        isOpen={showExportModal} onClose={() => setShowExportModal(false)}
        title="Export Test Results" subtitle={`${moduleName} · ${currentTest?.name ?? ""}`}
        stats={exportStats()}
        options={[
          { label: "CSV", icon: "📥", color: "bg-green-600", hoverColor: "hover:bg-green-700",
            onConfirm: () => exportExecutionCSV(moduleName, currentTest?.name ?? "test", buildFlatData()) },
          { label: "PDF", icon: "📋", color: "bg-red-600", hoverColor: "hover:bg-red-700",
            onConfirm: () => exportExecutionPDF(moduleName, currentTest?.name ?? "test", buildFlatData()) },
        ]}
      />

      <Topbar
        title={currentTest ? `#${currentTest.serial_no} — ${currentTest.name}` : "Test Execution"}
        subtitle={moduleName}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowExportModal(true)}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-bg-card hover:bg-bg-surface
                disabled:opacity-40 disabled:cursor-not-allowed text-t-primary
                text-sm font-semibold rounded-lg transition border border-[var(--border-color)]">
              📤 Export
            </button>
            <button onClick={handleFinish} className="btn-primary text-sm">Finish Test</button>
          </div>
        }
      />

      {/* ── Progress bar ── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-4 text-xs text-t-muted">
            <span><span className="text-green-400 font-semibold">{passCount}</span> pass</span>
            <span><span className="text-red-400 font-semibold">{failCount}</span> fail</span>
            <span><span className="text-t-muted font-semibold">{totalCount - doneCount}</span> pending</span>
          </div>
          <span className="text-xs text-t-muted font-medium">{progressPct}%</span>
        </div>
        <div className="h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%`, background: failCount > 0 ? "linear-gradient(90deg,#22c55e,#ef4444)" : "#22c55e" }} />
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] flex-wrap">
        <div className="flex gap-1">
          {(["all", "pass", "fail", "pending"] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
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

      {/* ── Scroll container ── */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto pb-24 md:pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-t-muted py-20 text-sm">No steps match your filter.</div>
        ) : (
          <>
            {/* ── Desktop table ── */}
            <table className="hidden md:table w-full text-sm border-collapse table-fixed">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[6%]">S.No</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[32%]">Action</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[32%]">Expected Result</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[14%]">Remarks</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[9%]">Status</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[7%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(step =>
                  step.is_divider ? (
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
                      readonly={false}
                      onUpdate={handleStepUpdate}
                      rowRef={(el) => { stepRefs.current[step.stepId] = el; }}
                    />
                  )
                )}
              </tbody>
            </table>

            {/* ── Mobile ── */}
            <div className="md:hidden flex flex-col">
              <div className="sticky top-0 z-10 grid grid-cols-[64px_1fr] border-b border-[var(--border-color)] bg-bg-surface/90 backdrop-blur-sm">
                <div className="px-3 py-2 border-r border-[var(--border-color)]">
                  <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">S.No</span>
                </div>
                <div className="px-3 py-2">
                  <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">Step Details</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 p-3">
                {filtered.map(step =>
                  step.is_divider ? (
                    <div key={step.stepId} className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-[var(--border-color)]" />
                      <span className="text-xs font-semibold text-c-brand uppercase tracking-widest">{step.action}</span>
                      <div className="flex-1 h-px bg-[var(--border-color)]" />
                    </div>
                  ) : (
                    <MobileStepCard
                      key={step.stepId}
                      step={step}
                      readonly={false}
                      onUpdate={handleStepUpdate}
                      cardRef={(el) => { stepRefs.current[step.stepId] = el; }}
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

// ── Desktop Table Row ─────────────────────────────────────────
const TableStepRow: React.FC<{
  step: ExecutionStep;
  readonly: boolean;
  onUpdate: (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
}> = ({ step, readonly, onUpdate, rowRef }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);

  const rowBg = step.status === "pass" ? "bg-green-500/5"
    : step.status === "fail" ? "bg-red-500/5" : "";

  return (
    <tr ref={rowRef}
      className={`border-b border-[var(--border-color)] hover:bg-bg-card transition-colors ${rowBg}`}>
      <td className="px-2 py-3 text-center">
        <span className="text-xs font-mono text-t-muted">{step.serial_no}</span>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-t-primary leading-snug break-words">{step.action}</p>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-t-secondary leading-snug break-words">{step.expected_result}</p>
      </td>
      <td className="px-3 py-3">
        <textarea
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onUpdate(step.stepId, "pass", remarks);
            }
          }}
          disabled={readonly}
          placeholder="Remarks… (Enter to pass)"
          rows={2}
          className="input text-sm resize-none disabled:opacity-50 w-full"
        />
      </td>
      <td className="px-2 py-3 text-center">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
          step.status === "pass" ? "bg-green-500/15 text-green-400"
          : step.status === "fail" ? "bg-red-500/15 text-red-400"
          : "bg-[var(--border-color)] text-t-muted"}`}>
          {step.status}
        </span>
      </td>
      {!readonly && (
        <td className="px-2 py-3">
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1 w-full">
              <button onClick={() => onUpdate(step.stepId, "pass", remarks)} title="Pass"
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "pass"
                    ? "bg-green-500 text-white"
                    : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
                }`}>✓</button>
              <button onClick={() => onUpdate(step.stepId, "fail", remarks)} title="Fail"
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "fail"
                    ? "bg-red-500 text-white"
                    : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
                }`}>✗</button>
            </div>
            {step.status !== "pending" && (
              <button onClick={() => onUpdate(step.stepId, "pending", "")}
                className="w-full h-7 rounded-md text-xs font-bold text-t-muted hover:text-t-primary
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] transition-colors
                  flex items-center justify-center">
                ↩
              </button>
            )}
          </div>
        </td>
      )}
      {readonly && <td className="px-2 py-3" />}
    </tr>
  );
};

// ── Mobile Step Card ──────────────────────────────────────────
const MobileStepCard: React.FC<{
  step: ExecutionStep;
  readonly: boolean;
  onUpdate: (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
}> = ({ step, readonly, onUpdate, cardRef }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);

  const rowBg = step.status === "pass" ? "bg-green-500/5"
    : step.status === "fail" ? "bg-red-500/5" : "";

  const accentColor = step.status === "pass" ? "#22c55e"
    : step.status === "fail" ? "#ef4444" : "#374151";

  return (
    <div
      ref={cardRef}
      className={`rounded-xl overflow-hidden border border-[var(--border-color)] w-full ${rowBg}`}
      style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-bg-card">
        <span className="text-xs font-mono text-t-muted tracking-wide">#{step.serial_no}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
          step.status === "pass" ? "bg-green-500/15 text-green-400"
          : step.status === "fail" ? "bg-red-500/15 text-red-400"
          : "bg-[var(--border-color)] text-t-muted"}`}>
          {step.status}
        </span>
      </div>

      <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
        <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start shrink-0">
          <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Action</span>
        </div>
        <div className="px-3 py-2.5 min-w-0">
          <p className="text-sm text-t-primary leading-snug break-words">{step.action}</p>
        </div>
      </div>

      <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
        <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start shrink-0">
          <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Expected</span>
        </div>
        <div className="px-3 py-2.5 min-w-0">
          <p className="text-sm text-t-secondary leading-snug break-words">{step.expected_result}</p>
        </div>
      </div>

      <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
        <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start shrink-0">
          <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Remarks</span>
        </div>
        <div className="px-3 py-2 min-w-0">
          <textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onUpdate(step.stepId, "pass", remarks);
              }
            }}
            disabled={readonly}
            placeholder="Remarks… (Enter to pass)"
            rows={2}
            className="input text-sm resize-none disabled:opacity-50 w-full"
          />
        </div>
      </div>

      {!readonly && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border-color)] bg-bg-card">
          <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">Actions</span>
          <div className="flex items-center gap-2">
            {step.status !== "pending" && (
              <button onClick={() => onUpdate(step.stepId, "pending", "")}
                className="w-8 h-8 rounded-md text-xs font-bold text-t-muted hover:text-t-primary
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)]
                  transition-colors flex items-center justify-center">
                ↩
              </button>
            )}
            <button onClick={() => onUpdate(step.stepId, "pass", remarks)} title="Pass"
              className={`w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "pass"
                  ? "bg-green-500 text-white"
                  : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
              }`}>✓</button>
            <button onClick={() => onUpdate(step.stepId, "fail", remarks)} title="Fail"
              className={`w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "fail"
                  ? "bg-red-500 text-white"
                  : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
              }`}>✗</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TestExecution;