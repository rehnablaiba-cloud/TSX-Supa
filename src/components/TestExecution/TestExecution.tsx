// TestExecution.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { useToast } from "../../context/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import { Step, Test } from "../../types";
import { exportExecutionCSV, exportExecutionPDF, FlatData } from "../../utils/export";
import useReleaseLockOnUnload from "../../hooks/useReleaseLockOnUnload";

interface Props { moduleId: string; moduleName: string; initialTestId: string; onBack: () => void; }
type Filter = "all" | "pass" | "fail" | "pending";

// ── Locked Screen ──────────────────────────────────────────────
const LockedScreen: React.FC<{ lockedByName: string; testName: string; onBack: () => void }> = ({
  lockedByName, testName, onBack,
}) => (
  <div className="flex flex-col h-full items-center justify-center gap-6 p-8 text-center">
    <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-3xl">🔒</div>
    <div>
      <h2 className="text-lg font-bold text-white mb-1">Test In Progress</h2>
      <p className="text-gray-400 text-sm max-w-sm">
        <span className="text-amber-400 font-semibold">{lockedByName}</span> is currently executing{" "}
        <span className="text-white font-semibold">"{testName}"</span>. You cannot enter until they finish.
      </p>
    </div>
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
      <span className="text-xs text-amber-400 font-medium">You'll be unblocked instantly when they finish.</span>
    </div>
    <button onClick={onBack}
      className="px-6 py-2 rounded-xl border border-white/10 text-gray-300 hover:text-white hover:border-white/20 text-sm font-medium transition-colors">
      ← Go Back
    </button>
  </div>
);

// ── Main Component ─────────────────────────────────────────────
const TestExecution: React.FC<Props> = ({ moduleId, moduleName, initialTestId, onBack }) => {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { log } = useAuditLog();

  const [currentTestId, setCurrentTestId]     = useState(initialTestId);
  const [filter, setFilter]                   = useState<Filter>("all");
  const [search, setSearch]                   = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [lockAcquired, setLockAcquired]       = useState(false);

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRefs     = useRef<Record<string, HTMLTableRowElement | null>>({});

  useReleaseLockOnUnload(currentTestId, user?.id ?? "");

  // ── Tests ──────────────────────────────────────────────────
  const [tests, setTests] = useState<Test[]>([]);
  useEffect(() => {
    supabase.from("tests").select("*").eq("module_id", moduleId).order("order_index")
      .then(({ data }) => setTests(data ?? []));
  }, [moduleId]);

  const currentIdx  = tests.findIndex(t => t.id === currentTestId);
  const currentTest = tests[currentIdx];

  // ── Steps ──────────────────────────────────────────────────
  const [steps, setSteps]     = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase.from("steps").select("*").eq("test_id", currentTestId).order("serial_no")
      .then(({ data }) => { setSteps(data ?? []); setLoading(false); });
  }, [currentTestId]);

  // ── Lock ───────────────────────────────────────────────────
  const [lock, setLock]               = useState<any>(null);
  const [lockLoading, setLockLoading] = useState(true);

  useEffect(() => {
    setLockLoading(true);
    supabase.from("testlocks").select("*").eq("test_id", currentTestId)
      .then(({ data }) => { setLock(data?.[0] ?? null); setLockLoading(false); });

    const channel = supabase.channel(`lock:${currentTestId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "testlocks",
        filter: `test_id=eq.${currentTestId}` },
        ({ eventType, new: newRow }: any) => {
          if (eventType === "DELETE") setLock(null); else setLock(newRow);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentTestId]);

  const isLockedByOther = !!(lock && lock.user_id !== user?.id);

  // ── Real-time step sync ────────────────────────────────────
  useEffect(() => {
    const channel = supabase.channel(`steps:${currentTestId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "steps",
        filter: `test_id=eq.${currentTestId}` },
        ({ new: updated }: any) => {
          setSteps(prev => prev.map(s =>
            s.id === updated.id ? { ...s, status: updated.status, remarks: updated.remarks } : s
          ));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentTestId]);

  // ── Heartbeat ──────────────────────────────────────────────
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      if (user) await supabase.from("testlocks")
        .update({ locked_at: new Date().toISOString() })
        .eq("test_id", currentTestId).eq("user_id", user.id);
    }, 15000);
  }, [currentTestId, user]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  }, []);

  // ── Lock lifecycle ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("testlocks").upsert(
        { test_id: currentTestId, user_id: user.id,
          locked_by_name: user.displayName || user.email || "User",
          locked_at: new Date().toISOString() },
        { onConflict: "test_id", ignoreDuplicates: true }
      ).select().single();
      if (cancelled) return;
      if (!error && data?.user_id === user.id) { setLockAcquired(true); startHeartbeat(); }
    })();
    return () => {
      cancelled = true; stopHeartbeat(); setLockAcquired(false);
      supabase.from("testlocks").delete().eq("test_id", currentTestId).eq("user_id", user.id);
    };
  }, [currentTestId, user?.id]);

  // ── Step update — optimistic ───────────────────────────────
  const handleStepUpdate = useCallback(async (
    stepId: string, status: "pass" | "fail" | "pending", remarks: string
  ) => {
    const currentIndex = steps.findIndex(s => s.id === stepId);
    const nextPending  = steps.slice(currentIndex + 1).find(s => !s.is_divider && s.status === "pending");

    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, status, remarks } : s));

    if (status !== "pending" && nextPending) {
      setTimeout(() => {
        stepRefs.current[nextPending.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }

    await supabase.from("steps").update({ status, remarks }).eq("id", stepId);
  }, [steps]);

  const handleFinish = async () => {
    stopHeartbeat();
    if (user) await supabase.from("testlocks").delete().eq("test_id", currentTestId).eq("user_id", user.id);
    log(`Finished test: ${currentTest?.name}`, "pass");
    addToast(`Test "${currentTest?.name}" completed!`, "success");
    onBack();
  };

  // ── Export ─────────────────────────────────────────────────
  const buildFlatData = (): FlatData[] =>
    steps.filter(s => !s.is_divider).map(s => ({
      module: moduleName, test: currentTest?.name ?? "",
      serial: s.serial_no, action: s.action,
      expected: s.expected_result, remarks: s.remarks || "", status: s.status,
    }));

  const exportStats = () => {
    const flat = buildFlatData();
    return [
      { label: "Total Steps", value: flat.length },
      { label: "Pass",        value: flat.filter(s => s.status === "pass").length },
      { label: "Fail",        value: flat.filter(s => s.status === "fail").length },
    ];
  };

  // ── Filtered steps ─────────────────────────────────────────
  const filtered = steps.filter(s => {
    if (s.is_divider) return true;
    if (filter !== "all" && s.status !== filter) return false;
    if (search && !`${s.action} ${s.expected_result} ${s.remarks}`
      .toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // ── Progress ───────────────────────────────────────────────
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
        <Spinner /><p className="text-xs text-gray-500">Checking lock status…</p>
      </div>
    </div>
  );

  if (isLockedByOther) return (
    <div className="flex flex-col h-full">
      <Topbar title={currentTest?.name ?? "Test Execution"} subtitle={moduleName} />
      <LockedScreen lockedByName={lock.locked_by_name}
        testName={currentTest?.name ?? "this test"} onBack={onBack} />
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
        title={currentTest?.name ?? "Test Execution"}
        subtitle={moduleName}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowExportModal(true)} disabled={steps.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition border border-white/10">
              📤 Export
            </button>
            <button onClick={handleFinish} className="btn-primary text-sm">Finish Test</button>
          </div>
        }
      />

      {/* ── Progress bar ── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span><span className="text-green-400 font-semibold">{passCount}</span> pass</span>
            <span><span className="text-red-400 font-semibold">{failCount}</span> fail</span>
            <span><span className="text-gray-400 font-semibold">{totalCount - doneCount}</span> pending</span>
          </div>
          <span className="text-xs text-gray-500 font-medium">{progressPct}%</span>
        </div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%`, background: failCount > 0 ? "linear-gradient(90deg,#22c55e,#ef4444)" : "#22c55e" }} />
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 flex-wrap">
        <div className="flex gap-1">
          {(["all", "pass", "fail", "pending"] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${
                filter === f ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
              {f}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search steps…" className="input text-xs py-1.5 w-48" />
      </div>

      {/* ── Table (desktop) / Cards (mobile) ── */}
      <div className="flex-1 overflow-auto pb-24 md:pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-500 py-20 text-sm">No steps match your filter.</div>
        ) : (
          <>
            {/* ── Desktop table ── */}
            <table className="hidden md:table w-full text-sm border-collapse table-fixed">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-2 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[6%]">S.No</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[32%]">Action</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[32%]">Expected Result</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[14%]">Remarks</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[9%]">Status</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[7%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(step =>
                  step.is_divider ? (
                    <tr key={step.id} className="border-b border-white/5">
                      <td colSpan={6} className="px-4 py-2 bg-blue-500/5">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                          <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">{step.action}</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <TableStepRow
                      key={step.id}
                      step={step}
                      readonly={false}
                      onUpdate={handleStepUpdate}
                      rowRef={(el) => { stepRefs.current[step.id] = el; }}
                    />
                  )
                )}
              </tbody>
            </table>

            {/* ── Mobile: sticky column header + cards ── */}
            <div className="md:hidden flex flex-col">
              {/* Sticky column header row */}
              <div className="sticky top-0 z-10 grid grid-cols-[64px_1fr] border-b border-white/10 bg-black/80 backdrop-blur-sm">
                <div className="px-3 py-2 border-r border-white/10">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">S.No</span>
                </div>
                <div className="px-3 py-2">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Step Details</span>
                </div>
              </div>

              {/* Step cards */}
              <div className="flex flex-col gap-2 p-3">
                {filtered.map(step =>
                  step.is_divider ? (
                    <div key={step.id} className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-white/10" />
                      <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">{step.action}</span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>
                  ) : (
                    <MobileStepCard
                      key={step.id}
                      step={step}
                      readonly={false}
                      onUpdate={handleStepUpdate}
                      cardRef={(el) => { stepRefs.current[step.id] = el as any; }}
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

// ── Desktop Table Row ──────────────────────────────────────────
const TableStepRow: React.FC<{
  step: Step;
  readonly: boolean;
  onUpdate: (id: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
}> = ({ step, readonly, onUpdate, rowRef }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);

  const rowBg = step.status === "pass" ? "bg-green-500/5"
    : step.status === "fail" ? "bg-red-500/5" : "";

  return (
    <tr ref={rowRef}
      className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${rowBg}`}>

      {/* S.No */}
      <td className="px-2 py-3 text-center">
        <span className="text-xs font-mono text-gray-500">{step.serial_no}</span>
      </td>

      {/* Action */}
      <td className="px-4 py-3">
        <p className="text-sm text-white leading-snug break-words">{step.action}</p>
      </td>

      {/* Expected Result */}
      <td className="px-4 py-3">
        <p className="text-sm text-gray-300 leading-snug break-words">{step.expected_result}</p>
      </td>

      {/* Remarks */}
      <td className="px-3 py-3">
        <textarea
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          disabled={readonly}
          placeholder="Remarks…"
          rows={2}
          className="input text-sm resize-none disabled:opacity-50 w-full"
        />
      </td>

      {/* Status — badge only */}
      <td className="px-2 py-3 text-center">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
          step.status === "pass" ? "bg-green-500/15 text-green-400"
          : step.status === "fail" ? "bg-red-500/15 text-red-400"
          : "bg-gray-500/15 text-gray-400"}`}>
          {step.status}
        </span>
      </td>

      {/* Actions — ✓ / ✗ buttons */}
      {!readonly && (
        <td className="px-2 py-3">
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1 w-full">
              <button onClick={() => onUpdate(step.id, "pass", remarks)}
                title="Pass"
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "pass"
                    ? "bg-green-500 text-white"
                    : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
                }`}>
                ✓
              </button>
              <button onClick={() => onUpdate(step.id, "fail", remarks)}
                title="Fail"
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                  step.status === "fail"
                    ? "bg-red-500 text-white"
                    : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
                }`}>
                ✗
              </button>
            </div>
            {step.status !== "pending" && (
              <button onClick={() => onUpdate(step.id, "pending", "")}
                title="Undo"
                className="w-full h-7 rounded-md text-xs font-bold text-gray-500 hover:text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center justify-center">
                ↩
              </button>
            )}
          </div>
        </td>
      )}
      {readonly && (
        <td className="px-2 py-3" />
      )}
    </tr>
  );
};

// ── Mobile Step Card ───────────────────────────────────────────
const MobileStepCard: React.FC<{
  step: Step;
  readonly: boolean;
  onUpdate: (id: string, status: "pass" | "fail" | "pending", remarks: string) => void;
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
      className={`rounded-xl overflow-hidden border border-white/10 ${rowBg}`}
      style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
    >
      {/* ── Row 1: S.No + Status badge ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.02]">
        <span className="text-xs font-mono text-gray-500 tracking-wide">#{step.serial_no}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
          step.status === "pass" ? "bg-green-500/15 text-green-400"
          : step.status === "fail" ? "bg-red-500/15 text-red-400"
          : "bg-gray-500/15 text-gray-400"}`}>
          {step.status}
        </span>
      </div>

      {/* ── Row 2: Action ── */}
      <div className="grid grid-cols-[80px_1fr] border-b border-white/10">
        <div className="px-3 py-2.5 border-r border-white/10 bg-white/[0.02] flex items-start">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mt-0.5">Action</span>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-sm text-white leading-snug">{step.action}</p>
        </div>
      </div>

      {/* ── Row 3: Expected Result ── */}
      <div className="grid grid-cols-[80px_1fr] border-b border-white/10">
        <div className="px-3 py-2.5 border-r border-white/10 bg-white/[0.02] flex items-start">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mt-0.5">Expected</span>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-sm text-gray-300 leading-snug">{step.expected_result}</p>
        </div>
      </div>

      {/* ── Row 4: Remarks ── */}
      <div className="grid grid-cols-[80px_1fr] border-b border-white/10">
        <div className="px-3 py-2.5 border-r border-white/10 bg-white/[0.02] flex items-start">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mt-0.5">Remarks</span>
        </div>
        <div className="px-3 py-2">
          <textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            disabled={readonly}
            placeholder="Remarks…"
            rows={2}
            className="input text-sm resize-none disabled:opacity-50 w-full"
          />
        </div>
      </div>

      {/* ── Row 5: Pass / Fail buttons (interactive only) ── */}
      {!readonly && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-white/10 bg-white/[0.02]">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Actions</span>
          <div className="flex items-center gap-2">
            {step.status !== "pending" && (
              <button onClick={() => onUpdate(step.id, "pending", "")}
                className="w-8 h-8 rounded-md text-xs font-bold text-gray-500 hover:text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center justify-center">
                ↩
              </button>
            )}
            <button
              onClick={() => onUpdate(step.id, "pass", remarks)}
              title="Pass"
              className={`w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "pass"
                  ? "bg-green-500 text-white"
                  : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
              }`}>
              ✓
            </button>
            <button
              onClick={() => onUpdate(step.id, "fail", remarks)}
              title="Fail"
              className={`w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "fail"
                  ? "bg-red-500 text-white"
                  : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
              }`}>
              ✗
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TestExecution;
