// src/components/Dashboard/Dashboard.tsx
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import gsap from "gsap";
import ExportModal from "../UI/ExportModal";
import SegmentedBar from "../UI/SegmentedBar";
import LockWarningBanner from "../UI/LockWarningBanner";
import SkeletonCard from "../UI/SkeletonCard";
import { supabase } from "../../supabase";
import {
  Upload,
  FileText,
  FileDown,
  FileSpreadsheet,
  Lock,
  Activity,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  exportDashboardCSV,
  exportDashboardPDF,
  exportDashboardDocx,
} from "../../utils/export";
import type { ModuleSummary } from "../../utils/export";
import { getModuleStats, buildSummaries } from "../../utils/stats";
import { getChartTheme } from "../../utils/chartTheme";
import { useTheme } from "../../context/ThemeContext";
import type { ActiveLock } from "../../types";
import {
  fetchDashboardShell,
  streamStepResults,
  fetchActiveLocks,
  fetchOtherActiveLockModules,
} from "../../lib/supabase/queries.dashboard";
import type {
  DashboardModule,
  DashboardShell,
  FetchProgressCallback,
  StreamCancellationToken,
} from "../../lib/supabase/queries.dashboard";
import RBarChart from "../ModuleDashboard/charts/RBarChart";
import RPieChart from "../ModuleDashboard/charts/RPieChart";
import RAreaChart from "../ModuleDashboard/charts/RAreaChart";
import RLineChart from "../ModuleDashboard/charts/RLineChart";
import RRadarChart from "../ModuleDashboard/charts/RRadarChart";

const ANIM_STYLE = `
@keyframes neonPulse {
  0%,100% { box-shadow: 0 0 0 1.5px rgba(var(--neon-cyan),0.45), 0 0 12px 2px rgba(var(--neon-cyan),0.18); }
  50%      { box-shadow: 0 0 0 1.5px rgba(var(--neon-cyan),0.45), 0 0 22px 6px rgba(var(--neon-cyan),0.32); }
}
@keyframes amberPulse {
  0%,100% { box-shadow: 0 0 0 1.5px rgba(var(--neon-amber),0.45), 0 0 12px 2px rgba(var(--neon-amber),0.18); }
  50%      { box-shadow: 0 0 0 1.5px rgba(var(--neon-amber),0.45), 0 0 22px 6px rgba(var(--neon-amber),0.32); }
}
@keyframes dualPulse {
  0%,100% {
    box-shadow:
      0 0 0 1.5px rgba(var(--neon-cyan),0.5), 0 0 0 3px rgba(var(--neon-amber),0.35),
      0 0 14px 3px rgba(var(--neon-cyan),0.2), 0 0 22px 6px rgba(var(--neon-amber),0.15);
  }
  50% {
    box-shadow:
      0 0 0 1.5px rgba(var(--neon-cyan),0.6), 0 0 0 3px rgba(var(--neon-amber),0.45),
      0 0 22px 6px rgba(var(--neon-cyan),0.32), 0 0 32px 10px rgba(var(--neon-amber),0.25);
  }
}
@keyframes qmSpin  { to { transform: rotate(360deg); } }
@keyframes qmPulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
@keyframes stepFill {
  from { opacity: 0.4; transform: scaleX(0.96); }
  to   { opacity: 1;   transform: scaleX(1); }
}
`;

function useInjectStyle() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = ANIM_STYLE;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);
}

interface Props {
  onNavigate: (page: string, module_name?: string) => void;
}

type ChartTab = "bar" | "area" | "line" | "radar" | "pie";

interface QueryProgress {
  phase: string;
  done: number;
  total: number;
}


// ─────────────────────────────────────────────────────────────────────────────
// ChartErrorBoundary
// ─────────────────────────────────────────────────────────────────────────────

class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError)
      return <div className="text-t-muted text-sm text-center py-8">Chart unavailable — try refreshing</div>;
    return this.props.children;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// QueryMonitor — admin-only panel
// ─────────────────────────────────────────────────────────────────────────────

interface QueryMonitorProps {
  progress: QueryProgress | null;
  history: QueryProgress[];
  isCollapsed: boolean;
  onToggle: () => void;
  totalStepIds: number;
}

const QueryMonitor: React.FC<QueryMonitorProps> = ({
  progress, history, isCollapsed, onToggle, totalStepIds,
}) => {
  const isActive = progress !== null;
  const pct = isActive && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  const totalBatches = Math.ceil(totalStepIds / 100);

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: isActive
          ? "color-mix(in srgb, var(--color-brand) 50%, transparent)"
          : "var(--border-color)",
        background: "var(--bg-card)",
        transition: "border-color 0.3s",
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 gap-2"
      >
        <div className="flex items-center gap-2">
          <span style={{
            display: "inline-flex",
            color: isActive ? "var(--color-brand)" : "var(--text-muted)",
            animation: isActive ? "qmSpin 1.1s linear infinite" : "none",
          }}>
            <Activity size={13} />
          </span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border tracking-wider" style={{
            color: "var(--color-brand)",
            borderColor: "color-mix(in srgb, var(--color-brand) 40%, transparent)",
            background: "color-mix(in srgb, var(--color-brand) 8%, transparent)",
          }}>ADMIN</span>
          <span className="text-xs font-semibold text-t-primary">Query Monitor</span>
          {isActive && (
            <span className="text-[10px] text-t-muted" style={{ animation: "qmPulse 1.4s ease-in-out infinite" }}>
              live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {totalStepIds > 0 && (
            <span className="text-[10px] text-t-muted hidden sm:inline">
              {totalStepIds.toLocaleString()} step IDs · {totalBatches} batch{totalBatches !== 1 ? "es" : ""} · sequential ×100
            </span>
          )}
          <span className="text-t-muted">
            {isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </span>
        </div>
      </button>

      {!isCollapsed && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          {/* Current phase + bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-t-muted truncate max-w-[70%]">
                {isActive ? progress.phase : (history.length > 0 ? "Complete" : "Idle")}
              </span>
              {isActive && (
                <span className="text-xs font-bold text-t-primary tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              )}
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: isActive ? `${pct}%` : "100%",
                  background: isActive
                    ? "var(--color-brand)"
                    : "color-mix(in srgb, var(--color-pass) 70%, transparent)",
                  transition: "width 0.2s ease, background 0.3s",
                }}
              />
            </div>
          </div>

          {/* Phase log */}
          {(history.length > 0 || isActive) && (
            <div className="rounded-lg p-2 flex flex-col gap-1" style={{ background: "var(--bg-surface)" }}>
              <p className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mb-0.5">
                Phase log
              </p>
              {history.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-pass)" }} />
                  <span className="text-[11px] text-t-muted truncate">{h.phase}</span>
                  <span className="text-[10px] text-t-muted ml-auto tabular-nums shrink-0">{h.done}/{h.total}</span>
                </div>
              ))}
              {isActive && (
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-brand)", animation: "qmPulse 1s ease-in-out infinite" }} />
                  <span className="text-[11px] truncate" style={{ color: "var(--color-brand)" }}>{progress.phase}</span>
                  <span className="text-[10px] ml-auto tabular-nums shrink-0" style={{ color: "var(--color-brand)" }}>{progress.done}/{progress.total}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

const Dashboard: React.FC<Props> = ({ onNavigate }) => {
  useInjectStyle();

  const { theme } = useTheme();
  const [showExportModal, setShowExportModal] = useState(false);
  const [modules, setModules] = useState<DashboardModule[]>([]);
  // true  = skeleton (Phase 1 not done yet)
  // false = cards are visible (Phase 2 may still be streaming)
  const [initialLoad, setInitialLoad] = useState(true);
  const [stepsStreaming, setStepsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLocks, setActiveLocks] = useState<ActiveLock[]>([]);
  const [activeChart, setActiveChart] = useState<ChartTab>("bar");
  const [otherLockedModules, setOtherLockedModules] = useState<Map<string, number>>(new Map());

  // Admin + query monitor
  const [isAdmin, setIsAdmin] = useState(false);
  const [queryProgress, setQueryProgress] = useState<QueryProgress | null>(null);
  const [progressHistory, setProgressHistory] = useState<QueryProgress[]>([]);
  const [monitorCollapsed, setMonitorCollapsed] = useState(false);
  const [totalStepIds, setTotalStepIds] = useState(0);

  const gridRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const lastPhaseRef = useRef("");
  // Cancellation token for the active stream — replaced on every fetchModules call
  const streamTokenRef = useRef<StreamCancellationToken>({ cancelled: false });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Detect admin role once on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const role =
        user?.user_metadata?.defaultRole ??
        user?.app_metadata?.role ??
        user?.user_metadata?.role;
      setIsAdmin(role === "admin");
    });
  }, []);

  // Build a fresh progress callback — resets history at the start of each fetch
  const makeProgressCallback = useCallback((): FetchProgressCallback | undefined => {
    if (!isAdmin) return undefined;
    setProgressHistory([]);
    lastPhaseRef.current = "";

    return (phase, done, total) => {
      if (!mountedRef.current) return;

      // Snapshot completed phase into history on phase change
      if (lastPhaseRef.current && lastPhaseRef.current !== phase) {
        setProgressHistory((prev) => [
          ...prev,
          { phase: lastPhaseRef.current, done: total, total },
        ]);
      }
      lastPhaseRef.current = phase;

      // Track total step IDs from batch count
      if (phase.startsWith("Loading step results") && total > 0) {
        setTotalStepIds(total * 100);
      }

      setQueryProgress({ phase, done, total });
    };
  }, [isAdmin]);

  const finishProgress = useCallback(() => {
    if (!mountedRef.current) return;
    if (lastPhaseRef.current) {
      setProgressHistory((prev) => [...prev, { phase: lastPhaseRef.current, done: 1, total: 1 }]);
      lastPhaseRef.current = "";
    }
    setQueryProgress(null);
  }, []);

  // ── Two-phase fetch ──────────────────────────────────────────────────────
  const fetchModules = useCallback(
    async (isInitial = false) => {
      // Cancel any in-flight stream from a previous call
      streamTokenRef.current.cancelled = true;
      const token: StreamCancellationToken = { cancelled: false };
      streamTokenRef.current = token;

      const onProgress = makeProgressCallback();

      try {
        // ── Phase 1: fast — modules + revisions ─────────────────────────
        const shell: DashboardShell = await fetchDashboardShell(onProgress);
        if (!mountedRef.current || token.cancelled) return;

        setModules(shell.modules);          // render cards immediately
        setError(null);
        if (isInitial) setInitialLoad(false); // drop skeleton NOW

        // ── Phase 2: sequential step streaming ──────────────────────────
        if (shell._allStepIds.length > 0 || shell._serialNosWithoutRevision.size > 0) {
          setStepsStreaming(true);
          await streamStepResults(
            shell,
            (updated) => {
              if (!mountedRef.current || token.cancelled) return;
              setModules(updated);            // numbers tick up each batch
            },
            onProgress,
            token
          );
        }
      } catch (e: any) {
        if (!mountedRef.current || token.cancelled) return;
        setError(e?.message ?? "Failed to load modules");
      } finally {
        if (mountedRef.current && !token.cancelled) {
          setStepsStreaming(false);
          finishProgress();
        }
        if (isInitial && mountedRef.current) setInitialLoad(false);
      }
    },
    [makeProgressCallback, finishProgress]
  );

  const fetchActiveLocksData = useCallback(async () => {
    try {
      const [locks, otherModules] = await Promise.all([
        fetchActiveLocks(),
        fetchOtherActiveLockModules(),
      ]);
      if (!mountedRef.current) return;
      setActiveLocks(locks);
      setOtherLockedModules(otherModules);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    Promise.all([fetchModules(true), fetchActiveLocksData()]);
  }, [fetchModules, fetchActiveLocksData]);

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "step_results" }, () => fetchModules(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "modules" }, () => fetchModules(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "test_locks" }, fetchActiveLocksData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchModules, fetchActiveLocksData]);

  // GSAP card entrance — only after Phase 1 completes
  useLayoutEffect(() => {
    if (!initialLoad && gridRef.current && gridRef.current.children.length > 0) {
      const ctx = gsap.context(() => {
        gsap.fromTo(
          gridRef.current!.children,
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, stagger: 0.06, duration: 0.4, ease: "power2.out", clearProps: "opacity,transform" }
        );
      });
      return () => ctx.revert();
    }
  }, [initialLoad, modules.length]);

  const summaries = useMemo(() => buildSummaries(modules), [modules]);

  const globalStats = useMemo(() => [
    { label: "Total Steps", value: summaries.reduce((a, x) => a + x.total, 0) },
    { label: "Pass",        value: summaries.reduce((a, x) => a + x.pass, 0) },
    { label: "Fail",        value: summaries.reduce((a, x) => a + x.fail, 0) },
  ], [summaries]);

  const myLockCountByModule = useMemo(() => {
    const map = new Map<string, number>();
    for (const lock of activeLocks)
      map.set(lock.module_name, (map.get(lock.module_name) ?? 0) + 1);
    return map;
  }, [activeLocks]);

  const chartTheme = useMemo(() => getChartTheme(theme), [theme]);
  const chartData = useMemo(() => summaries.map((s) => ({
    name: s.name, pass: s.pass, fail: s.fail, pending: s.pending,
  })), [summaries]);

  const buildSummariesWithTests = useCallback((): ModuleSummary[] =>
    summaries.map((s) => {
      const mod = modules.find((m) => m.name === s.name);
      const tests = (mod?.module_tests ?? []).map((mt) => {
        const testSteps = (mod?.step_results ?? []).filter(
          (sr) => !sr.is_divider && sr.tests_serial_no === mt.test?.serial_no
        );
        const pass    = testSteps.filter((sr) => sr.status === "pass").length;
        const fail    = testSteps.filter((sr) => sr.status === "fail").length;
        const pending = testSteps.filter((sr) => sr.status === "pending").length;
        const total   = testSteps.length;
        return {
          name: mt.test?.name ?? mt.tests_name ?? "Unknown",
          serialno: mt.test?.serial_no ?? null,
          total, pass, fail, pending,
          passRate: total > 0 ? Math.round((pass / total) * 100) : 0,
        };
      });
      return { ...s, tests };
    }), [summaries, modules]);

  const handleExportCSV  = useCallback(() => exportDashboardCSV(summaries), [summaries]);
  const handleExportPDF  = useCallback(() => exportDashboardPDF(buildSummariesWithTests()), [buildSummariesWithTests]);
  const handleExportDOCX = useCallback(() => exportDashboardDocx(buildSummariesWithTests()), [buildSummariesWithTests]);

  if (error)
    return (
      <div className="p-6">
        <div className="rounded-xl p-4 text-sm" style={{
          background: "color-mix(in srgb, var(--color-fail) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--color-fail) 30%, transparent)",
          color: "var(--color-fail)",
        }}>
          Failed to load modules: {error}
        </div>
      </div>
    );

  const chartTabs: { key: ChartTab; label: string }[] = [
    { key: "bar", label: "Bar" }, { key: "area", label: "Area" },
    { key: "line", label: "Line" }, { key: "radar", label: "Radar" },
    { key: "pie", label: "Pie" },
  ];

  const hasAnyLocks = activeLocks.length > 0 || otherLockedModules.size > 0;

  return (
    <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
      {/* Export Modal */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Dashboard"
        subtitle="Fleet summary"
        stats={globalStats}
        options={[
          { label: "CSV",  icon: <FileSpreadsheet size={16} />, color: "bg-(--bg-card) border border-(--border-color) text-(--text-primary)", hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)", onConfirm: handleExportCSV },
          { label: "PDF",  icon: <FileText size={16} />,        color: "bg-(--bg-card) border border-(--border-color) text-(--text-primary)", hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)", onConfirm: handleExportPDF },
          { label: "DOCX", icon: <FileDown size={16} />,        color: "bg-(--bg-card) border border-(--border-color) text-(--text-primary)", hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)", onConfirm: handleExportDOCX },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-t-primary">Fleet</h2>
          <p className="text-sm text-t-muted mt-1">
            {initialLoad
              ? "Loading…"
              : stepsStreaming
              ? `${modules.length} Trainset${modules.length !== 1 ? "s" : ""} — loading steps…`
              : `${modules.length} Trainset${modules.length !== 1 ? "s" : ""} tracked`}
          </p>
        </div>
        <button
          onClick={() => setShowExportModal(true)}
          disabled={modules.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload size={14} /> Export
        </button>
      </div>

      {/* Admin Query Monitor */}
      {isAdmin && (queryProgress !== null || progressHistory.length > 0) && (
        <QueryMonitor
          progress={queryProgress}
          history={progressHistory}
          isCollapsed={monitorCollapsed}
          onToggle={() => setMonitorCollapsed((c) => !c)}
          totalStepIds={totalStepIds}
        />
      )}

      {!initialLoad && hasAnyLocks && (
        <LockWarningBanner
          locks={activeLocks}
          otherLockedModules={otherLockedModules}
          onNavigate={onNavigate}
        />
      )}

      {/* Fleet Overview Charts */}
      {!initialLoad && modules.length > 0 && (
        <div className="card p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold text-t-primary">Fleet Overview</p>
              <p className="text-xs text-t-muted mt-0.5">Pass / Fail / Pending across all trainsets</p>
            </div>
            <div className="flex items-center gap-1 bg-bg-surface rounded-lg p-1 border border-(--border-color)">
              {chartTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveChart(tab.key)}
                  className="px-3 py-1 text-xs font-semibold rounded-md transition-all"
                  style={activeChart === tab.key
                    ? { background: "var(--color-brand)", color: "#fff" }
                    : { color: "var(--text-muted)" }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <ChartErrorBoundary>
            {activeChart === "pie" ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
                <div className="flex flex-col items-center justify-center">
                  <p className="text-xs text-t-muted mb-2 self-start">Fleet Total Distribution</p>
                  <RPieChart key="pie-chart" data={chartData} ct={chartTheme} height={260} showLabel />
                </div>
                <div className="flex flex-col gap-3">
                  {[
                    { label: "Total Steps", value: globalStats[0].value, color: "var(--color-brand)" },
                    { label: "Pass",        value: globalStats[1].value, color: "var(--color-pass)"  },
                    { label: "Fail",        value: globalStats[2].value, color: "var(--color-fail)"  },
                    { label: "Pending",     value: globalStats[0].value - globalStats[1].value - globalStats[2].value, color: "var(--text-muted)" },
                  ].map((stat) => (
                    <div key={stat.label} className="flex items-center justify-between px-4 py-3 rounded-xl border border-(--border-color) bg-bg-surface">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stat.color }} />
                        <span className="text-sm text-t-muted">{stat.label}</span>
                      </div>
                      <span className="text-sm font-bold text-t-primary tabular-nums">{stat.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="w-full">
                {activeChart === "bar"   && <RBarChart   key="bar-chart"   data={chartData} ct={chartTheme} />}
                {activeChart === "area"  && <RAreaChart  key="area-chart"  data={chartData} ct={chartTheme} />}
                {activeChart === "line"  && <RLineChart  key="line-chart"  data={chartData} ct={chartTheme} />}
                {activeChart === "radar" && <RRadarChart key="radar-chart" data={chartData} ct={chartTheme} />}
              </div>
            )}
          </ChartErrorBoundary>
        </div>
      )}

      {/* Module grid */}
      {initialLoad ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {modules.map((m) => {
            const { total, pass, fail, pending, passRate, failPct, pendingPct, testCount } =
              getModuleStats(m.module_tests ?? [], m.step_results ?? []);

            const myLockCount    = myLockCountByModule.get(m.name) ?? 0;
            const otherLockCount = otherLockedModules.get(m.name) ?? 0;

            const passLabelColor =
              total === 0      ? "var(--text-muted)"   :
              passRate === 100 ? "var(--color-pass)"   :
              failPct === 100  ? "var(--color-fail)"   :
                                 "var(--text-primary)";

            const hasBoth  = myLockCount > 0 && otherLockCount > 0;
            const myOnly   = myLockCount > 0 && otherLockCount === 0;
            const otherOnly = otherLockCount > 0 && myLockCount === 0;

            const cardStyle: React.CSSProperties = hasBoth
              ? { animation: "dualPulse 2.6s ease-in-out infinite" }
              : myOnly
              ? { border: "1.5px solid rgba(var(--neon-cyan),0.55)", background: "linear-gradient(135deg,rgba(var(--neon-cyan),0.07) 0%,transparent 60%)", animation: "neonPulse 2.6s ease-in-out infinite" }
              : otherOnly
              ? { animation: "amberPulse 2.6s ease-in-out infinite" }
              : {};

            return (
              <button
                key={m.name}
                onClick={() => onNavigate("module", m.name)}
                className="card text-left hover:border-c-brand/50 hover:shadow-xl transition-all duration-300 cursor-pointer group"
                style={cardStyle}
              >
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-3 h-3 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: "var(--color-brand)" }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-t-primary group-hover:text-c-brand transition-colors truncate">{m.name}</h3>
                    {m.description && <p className="text-xs text-t-muted mt-0.5 truncate">{m.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {myLockCount > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ color: "var(--color-my-lock)", borderColor: "color-mix(in srgb,var(--color-my-lock) 40%,transparent)", background: "color-mix(in srgb,var(--color-my-lock) 10%,transparent)" }}>
                        <Lock size={9} /> {myLockCount} My Lock{myLockCount > 1 ? "s" : ""}
                      </span>
                    )}
                    {otherLockCount > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ color: "var(--color-pend)", borderColor: "color-mix(in srgb,var(--color-pend) 53%,transparent)", background: "color-mix(in srgb,var(--color-pend) 10%,transparent)" }}>
                        <Lock size={9} /> {otherLockCount} Locked
                      </span>
                    )}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap tracking-wide" style={{ color: "var(--color-brand)", borderColor: "var(--color-brand)", background: "color-mix(in srgb,var(--color-brand) 8%,transparent)" }}>
                      {testCount} {testCount === 1 ? "Test" : "Tests"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-t-muted">Total Steps</span>
                  <span
                    className="text-sm font-bold text-t-primary tabular-nums"
                    style={stepsStreaming && total > 0 ? { animation: "stepFill 0.25s ease-out" } : undefined}
                  >
                    {total > 0 ? total : stepsStreaming ? "—" : "0"}
                  </span>
                </div>

                <div className="flex gap-2 mb-3">
                  <span className="badge-pass">
                    <span className="w-1.5 h-1.5 rounded-full bg-pass inline-block mr-1" />
                    {pass} Pass
                  </span>
                  <span className="badge-fail">
                    <span className="w-1.5 h-1.5 rounded-full bg-fail inline-block mr-1" />
                    {fail} Fail
                  </span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-t-muted bg-bg-card border border-(--border-color) rounded-full px-2.5 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-(--text-muted) inline-block" />
                    {pending} Pending
                  </span>
                </div>

                <div className="mt-1">
                  <div className="flex justify-between text-xs text-t-muted mb-1">
                    <span>Progress</span>
                    <span className="font-semibold" style={{ color: passLabelColor }}>
                      {total > 0 ? `${passRate}%` : stepsStreaming ? "…" : "—"}
                    </span>
                  </div>
                  {/* SegmentedBar has transition-all so width animates naturally */}
                  <SegmentedBar
                    passRate={passRate}
                    failPct={failPct}
                    pendingPct={pendingPct}
                    total={total}
                  />
                </div>
              </button>
            );
          })}

          {modules.length === 0 && (
            <div className="col-span-3 text-center text-t-muted py-20">No modules yet.</div>
          )}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
