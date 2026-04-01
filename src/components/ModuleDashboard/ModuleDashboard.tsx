import React, { useEffect, useState, useRef } from "react";
import { supabase } from "../../supabase";
import Spinner from "../UI/Spinner";
import Topbar from "../Layout/Topbar";
import { Step, Test } from "../../types";
import { useAuth } from "../../context/AuthContext";

// ── Animation keyframes (injected once into <head>) ───────────────────────────
const ANIM_STYLE = `
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0);    }
}
@keyframes fadeSlideInRow {
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0);    }
}
`;

function useInjectStyle() {
  const injected = useRef(false);
  useEffect(() => {
    if (injected.current) return;
    injected.current = true;
    const el = document.createElement("style");
    el.textContent = ANIM_STYLE;
    document.head.appendChild(el);
  }, []);
}

// ── FadeWrapper ───────────────────────────────────────────────────────────────
const FadeWrapper: React.FC<{ animKey: string | number; children: React.ReactNode }> = ({ animKey, children }) => (
  <div key={animKey} style={{ animation: "fadeSlideIn 0.28s cubic-bezier(0.22,1,0.36,1) both" }}>
    {children}
  </div>
);

// ── StaggerRow — each row fades in with a slight delay offset ─────────────────
const StaggerRow: React.FC<{ index: number; children: React.ReactNode }> = ({ index, children }) => (
  <div style={{
    animation: "fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both",
    animationDelay: `${index * 45}ms`,
  }}>
    {children}
  </div>
);

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  moduleId: string;
  moduleName: string;
  onBack: () => void;
  onExecute: (testId: string) => void;
}

const FONT_SIZES = [
  { label: "S", value: 12 },
  { label: "M", value: 14 },
  { label: "L", value: 16 },
];

// ── Main Component ────────────────────────────────────────────────────────────
const ModuleDashboard: React.FC<Props> = ({ moduleId, moduleName, onBack, onExecute }) => {
  useInjectStyle();
  const { user } = useAuth();

  const [tests, setTests]                   = useState<Test[]>([]);
  const [loading, setLoading]               = useState(true);
  const [locks, setLocks]                   = useState<any[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [fontSize, setFontSize]             = useState(14);

  // ── Tests ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.from("tests").select("*")
      .eq("module_id", moduleId).order("order_index")
      .then(({ data }) => { setTests(data ?? []); setLoading(false); });
  }, [moduleId]);

  // ── Locks — initial fetch + real-time subscription ────────
  useEffect(() => {
    supabase.from("testlocks").select("*")
      .then(({ data }) => setLocks(data ?? []));

    const channel = supabase.channel("all-locks")
      .on("postgres_changes", { event: "*", schema: "public", table: "testlocks" },
        () => {
          supabase.from("testlocks").select("*")
            .then(({ data }) => setLocks(data ?? []));
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── HARD BLOCK ────────────────────────────────────────────
  const handleExecute = (testId: string) => {
    const lock = locks.find(l => l.test_id === testId);
    if (lock && lock.user_id !== user?.id) return;
    onExecute(testId);
  };

  const filteredTests = selectedTestId
    ? tests.filter(t => t.id === selectedTestId)
    : tests;

  // animKey changes whenever filter changes → triggers FadeWrapper remount
  const listAnimKey = selectedTestId ?? "all";

  if (loading) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>;

  return (
    <div className="flex-1 flex flex-col">
      <Topbar title={moduleName} subtitle={`${tests.length} tests`} onBack={onBack} />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">

        {/* ── Toolbar: filter + font size ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Test filter */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-400">Filter by Test</label>
            <select
              value={selectedTestId ?? ""}
              onChange={(e) => setSelectedTestId(e.target.value || null)}
              className="input text-sm"
            >
              <option value="">All Tests</option>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Font size toggle */}
          <div className="flex items-center gap-0.5 rounded-lg p-0.5 border bg-white/5 border-white/10">
            {FONT_SIZES.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setFontSize(value)}
                title={`Font size ${value}px`}
                className="px-2.5 py-1 rounded-md text-xs font-semibold transition-all w-7"
                style={
                  fontSize === value
                    ? { backgroundColor: "#1d4ed8", color: "#ffffff" }
                    : { color: "#94a3b8" }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Test list — outer wrapper animates on filter change ── */}
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-300 mb-2" style={{ fontSize }}>Test Cases</h3>

          <FadeWrapper animKey={listAnimKey}>
            <div className="flex flex-col gap-3">
              {filteredTests.length === 0 ? (
                <p className="text-sm text-gray-500">No tests found.</p>
              ) : (
                filteredTests.map((test, index) => {
                  const lock            = locks.find(l => l.test_id === test.id);
                  const isLockedByOther = !!(lock && lock.user_id !== user?.id);
                  const isLockedByMe    = !!(lock && lock.user_id === user?.id);
                  return (
                    // Each row staggers in with a delay based on its index
                    <StaggerRow key={test.id} index={index}>
                      <TestRow
                        test={test}
                        onExecute={() => handleExecute(test.id)}
                        isLockedByOther={isLockedByOther}
                        isLockedByMe={isLockedByMe}
                        lockedByName={lock?.locked_by_name ?? ""}
                        fontSize={fontSize}
                      />
                    </StaggerRow>
                  );
                })
              )}
            </div>
          </FadeWrapper>
        </div>
      </div>
    </div>
  );
};

// ── Test Row ──────────────────────────────────────────────────────────────────
const TestRow: React.FC<{
  test: Test;
  onExecute: () => void;
  isLockedByOther: boolean;
  isLockedByMe: boolean;
  lockedByName: string;
  fontSize: number;
}> = ({ test, onExecute, isLockedByOther, isLockedByMe, lockedByName, fontSize }) => {
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    supabase.from("steps").select("*")
      .eq("test_id", test.id)
      .then(({ data }) => setSteps(data ?? []));
  }, [test.id]);

  const passed  = steps.filter(s => !s.is_divider && s.status === "pass").length;
  const failed  = steps.filter(s => !s.is_divider && s.status === "fail").length;
  const pending = steps.filter(s => !s.is_divider && s.status === "pending").length;
  const total   = steps.filter(s => !s.is_divider).length || 1;
  const rate    = Math.round((passed / total) * 100);

  const borderColor = isLockedByOther
    ? "#6b7280"
    : rate > 70 ? "#22c55e" : rate > 30 ? "#f59e0b" : "#ef4444";

  return (
    <div
      className={`card flex flex-col sm:flex-row sm:items-center gap-4 transition-all ${
        isLockedByOther ? "opacity-50 select-none" : "opacity-100"
      }`}
      style={{ borderLeft: `3px solid ${borderColor}`, fontSize }}
    >
      <div className="flex-1">
        {/* Name + lock badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-white">{test.name}</p>
          {isLockedByOther && (
            <span
              className="flex items-center gap-1 font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2.5 py-0.5"
              style={{ fontSize: fontSize - 2 }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
              🔒 {lockedByName} is executing
            </span>
          )}
          {isLockedByMe && (
            <span
              className="flex items-center gap-1 font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-2.5 py-0.5"
              style={{ fontSize: fontSize - 2 }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
              ✏️ You are executing
            </span>
          )}
        </div>

        {/* Status badges */}
        <div className="flex gap-2 mt-1.5 flex-wrap">
          <span className="badge-pass">{passed} Pass</span>
          <span className="badge-fail">{failed} Fail</span>
          <span className="badge-pend">{pending} Pend</span>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${rate}%`, backgroundColor: isLockedByOther ? "#6b7280" : "#22c55e" }}
          />
        </div>
      </div>

      {/* Execute button */}
      <button
        onClick={(e) => {
          if (isLockedByOther) { e.preventDefault(); e.stopPropagation(); return; }
          onExecute();
        }}
        disabled={isLockedByOther}
        style={{ fontSize }}
        className={`whitespace-nowrap shrink-0 px-4 py-2 rounded-xl font-semibold transition-all ${
          isLockedByOther
            ? "bg-gray-700/50 text-gray-500 cursor-not-allowed pointer-events-none border border-gray-600/30"
            : "btn-primary cursor-pointer"
        }`}
      >
        {isLockedByOther ? "🔒 Locked" : isLockedByMe ? "▶ Resume Test" : "Execute Tests"}
      </button>
    </div>
  );
};

export default ModuleDashboard;