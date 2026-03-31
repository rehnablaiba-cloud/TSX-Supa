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
const LockedScreen: React.FC<{
  lockedByName: string;
  testName: string;
  onBack: () => void;
}> = ({ lockedByName, testName, onBack }) => (
  <div className="flex flex-col h-full items-center justify-center gap-6 p-8 text-center">
    <div className="w-20 h-20 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-4xl">
      🔒
    </div>
    <div>
      <h2 className="text-xl font-bold text-white mb-2">Test In Progress</h2>
      <p className="text-gray-400 text-sm max-w-sm">
        <span className="text-amber-400 font-semibold">{lockedByName}</span> is currently
        executing <span className="text-white font-semibold">"{testName}"</span>.
        You cannot enter until they finish.
      </p>
    </div>
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
      <span className="text-xs text-amber-400 font-medium">
        You'll be unblocked instantly when they finish.
      </span>
    </div>
    <button
      onClick={onBack}
      className="w-full max-w-xs py-2.5 rounded-xl border border-white/10 text-gray-300 hover:text-white hover:border-white/20 text-sm font-medium transition-colors"
    >
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

  // ── keepalive release on tab/window close ─────────────────
  useReleaseLockOnUnload(currentTestId, user?.id ?? "");

  // ── Tests ──────────────────────────────────────────────────
  const [tests, setTests] = useState<Test[]>([]);
  useEffect(() => {
    supabase
      .from("tests")
      .select("*")
      .eq("module_id", moduleId)
      .order("order_index")
      .then(({ data }) => setTests(data ?? []));
  }, [moduleId]);

  const currentIdx  = tests.findIndex(t => t.id === currentTestId);
  const currentTest = tests[currentIdx];

  // ── Steps ──────────────────────────────────────────────────
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSteps = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("steps")
      .select("*")
      .eq("test_id", currentTestId)
      .order("serial_no");
    setSteps(data ?? []);
    setLoading(false);
  }, [currentTestId]);

  useEffect(() => { fetchSteps(); }, [fetchSteps]);

  const refetch = fetchSteps; // keep existing refetch calls working

  // ── Lock — real-time subscription ─────────────────────────
  const [lock, setLock] = useState<any>(null);
  const [lockLoading, setLockLoading] = useState(true);

  useEffect(() => {
    // Fetch initial lock state
    supabase
      .from("testlocks")
      .select("*")
      .eq("test_id", currentTestId)
      .then(({ data }) => { setLock(data?.[0] ?? null); setLockLoading(false); });

    // Subscribe to lock changes
    const channel = supabase
      .channel(`lock:${currentTestId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "testlocks",
        filter: `test_id=eq.${currentTestId}`,
      }, ({ eventType, new: newRow }: any) => {
        if (eventType === "DELETE") setLock(null);
        else setLock(newRow);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentTestId]);

  const isLockedByOther = !!(lock && lock.user_id !== user?.id);

  // ── Real-time step sync ────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`steps:${currentTestId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "steps",
        filter: `test_id=eq.${currentTestId}`,
      }, ({ new: updated }: any) => {
        setSteps(prev => prev.map(s =>
          s.id === updated.id
            ? { ...s, status: updated.status, remarks: updated.remarks }
            : s
        ));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentTestId]);

  // ── Heartbeat helpers ──────────────────────────────────────
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      if (user) {
        await supabase.from("testlocks")
          .update({ locked_at: new Date().toISOString() })
          .eq("test_id", currentTestId)
          .eq("user_id", user.id);
      }
    }, 15000);
  }, [currentTestId, user]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  // ── Lock lifecycle — runs once per test ───────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.from("testlocks").upsert(
        {
          test_id:        currentTestId,
          user_id:        user.id,
          locked_by_name: user.displayName || user.email || "User",
          locked_at:      new Date().toISOString(),
        },
        { onConflict: "test_id", ignoreDuplicates: true }
      ).select().single();

      if (cancelled) return;
      // upsert with ignoreDuplicates: only start heartbeat if lock is actually ours
      if (!error && data?.user_id === user.id) {
        setLockAcquired(true);
        startHeartbeat();
      }
    })();

    return () => {
      cancelled = true;
      stopHeartbeat();
      setLockAcquired(false);
      // Normal unmount — back button / navigate away
      supabase.from("testlocks")
        .delete()
        .eq("test_id", currentTestId)
        .eq("user_id", user.id);
    };
  // Intentionally minimal deps — only re-run when test or user changes
  }, [currentTestId, user?.id]);

  // ── Handlers ───────────────────────────────────────────────
  const handleStepUpdate = useCallback(async (stepId: string, status: "pass" | "fail", remarks: string) => {
    await supabase.from("steps")
      .update({ status, remarks })
      .eq("id", stepId);
    refetch();
  }, [refetch]);

  const handleFinish = async () => {
    stopHeartbeat();
    if (user) {
      await supabase.from("testlocks")
        .delete()
        .eq("test_id", currentTestId)
        .eq("user_id", user.id);
    }
    log(`Finished test: ${currentTest?.name}`, "pass");
    addToast(`Test "${currentTest?.name}" completed!`, "success");
    onBack();
  };

  // ── Export helpers ─────────────────────────────────────────
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

  // ── Spinner while subscription first connects ─────────────
  if (lockLoading) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title="Test Execution" subtitle={moduleName} />
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <Spinner />
          <p className="text-xs text-gray-500">Checking lock status…</p>
        </div>
      </div>
    );
  }

  // ── Block if locked by another user ───────────────────────
  if (isLockedByOther) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={currentTest?.name ?? "Test Execution"} subtitle={moduleName} />
        <LockedScreen
          lockedByName={lock.locked_by_name}
          testName={currentTest?.name ?? "this test"}
          onBack={onBack}
        />
      </div>
    );
  }

  // ── Normal execution view ──────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Test Results"
        subtitle={`${moduleName} · ${currentTest?.name ?? ""}`}
        stats={exportStats()}
        options={[
          {
            label: "CSV", icon: "📥",
            color: "bg-green-600", hoverColor: "hover:bg-green-700",
            onConfirm: () => exportExecutionCSV(moduleName, currentTest?.name ?? "test", buildFlatData()),
          },
          {
            label: "PDF", icon: "📋",
            color: "bg-red-600", hoverColor: "hover:bg-red-700",
            onConfirm: () => exportExecutionPDF(moduleName, currentTest?.name ?? "test", buildFlatData()),
          },
        ]}
      />

      <Topbar
        title={currentTest?.name ?? "Test Execution"}
        subtitle={moduleName}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowExportModal(true)}
              disabled={steps.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition border border-white/10"
            >
              📤 Export
            </button>
            <button
              disabled={currentIdx === 0}
              onClick={() => setCurrentTestId(tests[currentIdx - 1].id)}
              className="btn-ghost text-sm disabled:opacity-30"
            >
              ← Prev
            </button>
            <button
              disabled={currentIdx >= tests.length - 1}
              onClick={() => setCurrentTestId(tests[currentIdx + 1].id)}
              className="btn-ghost text-sm disabled:opacity-30"
            >
              Next →
            </button>
            <button onClick={handleFinish} className="btn-primary text-sm">
              Finish Test
            </button>
          </div>
        }
      />

      {lockAcquired && (
        <div className="mx-4 mt-3 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-xs flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          You have an active lock on this test
        </div>
      )}

      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 flex-wrap">
        <div className="flex gap-1">
          {(["all", "pass", "fail", "pending"] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                filter === f ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search steps…"
          className="input text-sm py-2 max-w-xs"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 pb-24 md:pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-500 py-20">No steps match your filter.</div>
        ) : (
          filtered.map(step =>
            step.is_divider ? (
              <div key={step.id} className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">
                  {step.action}
                </span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
            ) : (
              <StepCard key={step.id} step={step} readonly={false} onUpdate={handleStepUpdate} />
            )
          )
        )}
      </div>
    </div>
  );
};

// ── Step Card ──────────────────────────────────────────────────
const StepCard: React.FC<{
  step: Step; readonly: boolean;
  onUpdate: (id: string, status: "pass" | "fail", remarks: string) => void;
}> = ({ step, readonly, onUpdate }) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => { setRemarks(step.remarks || ""); }, [step.remarks]);

  const borderColor = step.status === "pass" ? "#22c55e"
    : step.status === "fail" ? "#ef4444" : "#374151";

  return (
    <div className="card flex flex-col gap-3" style={{ borderLeftColor: borderColor, borderLeftWidth: 3 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-xs text-gray-500 mb-1">#{step.serial_no} · Action</p>
          <p className="text-sm text-white font-medium">{step.action}</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize shrink-0 ${
          step.status === "pass" ? "bg-green-500/15 text-green-400"
          : step.status === "fail" ? "bg-red-500/15 text-red-400"
          : "bg-gray-500/15 text-gray-400"
        }`}>
          {step.status}
        </span>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1">Expected Result</p>
        <p className="text-sm text-gray-300">{step.expected_result}</p>
      </div>
      <textarea
        value={remarks} onChange={e => setRemarks(e.target.value)}
        disabled={readonly} placeholder="Add remarks…" rows={2}
        className="input text-sm resize-none disabled:opacity-50"
      />
      {!readonly && (
        <div className="flex gap-2">
          <button onClick={() => onUpdate(step.id, "pass", remarks)}
            className="flex-1 py-2 rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-400 font-medium text-sm transition-colors border border-green-500/20">
            ✓ Pass
          </button>
          <button onClick={() => onUpdate(step.id, "fail", remarks)}
            className="flex-1 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium text-sm transition-colors border border-red-500/20">
            ✗ Fail
          </button>
        </div>
      )}
    </div>
  );
};

export default TestExecution;