// src/components/ModuleDashboard/ModuleDashboard.tsx
import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../supabase";
import Spinner from "../UI/Spinner";
import Topbar from "../Layout/Topbar";
import ExportModal from "../UI/ExportModal";
import TestCard from "./TestCard";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { FileSpreadsheet, FileText, RefreshCw, Upload } from "lucide-react";
import {
  exportModuleDashboardCSV,
  exportModuleDashboardPDF,
} from "../../utils/export";
import {
  RBarChart,
  RAreaChart,
  RLineChart,
  RPieChart,
  RRadarChart,
} from "./charts";
import type { ChartRow, ChartTheme } from "./charts";
import {
  useModuleData,
  useModuleLocks,
  useModuleStepDetails,
  useForceReleaseLock,
} from "../../lib/hooks";
import { QK } from "../../lib/queryClient";

// ─── Animation wrappers ───────────────────────────────────────────────────────

const FadeWrapper: React.FC<{
  animKey: string | number;
  children: React.ReactNode;
}> = ({ animKey, children }) => (
  <div
    key={animKey}
    style={{ animation: "fadeSlideIn 0.28s cubic-bezier(0.22,1,0.36,1) both" }}
  >
    {children}
  </div>
);

const StaggerRow: React.FC<{ index: number; children: React.ReactNode }> = ({
  index,
  children,
}) => (
  <div
    style={{
      animation:      "fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both",
      animationDelay: `${index * 45}ms`,
    }}
  >
    {children}
  </div>
);

// ─── Chart type ───────────────────────────────────────────────────────────────

type ChartType = "bar" | "area" | "line" | "pie" | "radar";
const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "bar",   label: "Bar"   },
  { type: "area",  label: "Area"  },
  { type: "line",  label: "Line"  },
  { type: "pie",   label: "Pie"   },
  { type: "radar", label: "Radar" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  module_name:  string;
  onBack:       () => void;
  onExecute:    (module_test_id: string) => void;
  onViewReport: (module_test_id: string) => void;
}

// ─── ModuleDashboard ──────────────────────────────────────────────────────────

const ModuleDashboard: React.FC<Props> = ({
  module_name,
  onBack,
  onExecute,
  onViewReport,
}) => {
  const { user }    = useAuth();
  const { theme }   = useTheme();
  const queryClient = useQueryClient();
  const isAdmin     = user?.role === "admin";

  const [chartType,    setChartType]    = useState<ChartType>("bar");
  const [showExport,   setShowExport]   = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [exporting,    setExporting]    = useState(false);

  const [ct, setCt] = useState<ChartTheme>({
    panel:       "#ffffff",
    text:        "#1e293b",
    muted:       "#94a3b8",
    grid:        "rgba(0,0,0,0.06)",
    border:      "rgba(0,0,0,0.10)",
    tooltipBg:   "#ffffff",
    tooltipText: "#1e293b",
    tooltipName: "#64748b",
  });

  useLayoutEffect(() => {
    const s      = getComputedStyle(document.documentElement);
    const get    = (v: string) => s.getPropertyValue(v).trim();
    const isDark = theme === "dark";
    setCt({
      panel:       isDark ? "#0f172a" : "#ffffff",
      text:        get("--text-primary") || (isDark ? "#f1f5f9" : "#1e293b"),
      muted:       get("--text-muted")   || (isDark ? "#64748b" : "#94a3b8"),
      grid:        isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
      border:      isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      tooltipBg:   isDark ? "#1e293b" : "#ffffff",
      tooltipText: isDark ? "#f1f5f9" : "#1e293b",
      tooltipName: isDark ? "#94a3b8" : "#64748b",
    });
  }, [theme]);

  // ── Query 1: module tests + counts + revisions ────────────────────────────
  const moduleDataQuery = useModuleData(module_name);

  const moduleTestIds = useMemo(
    () => (moduleDataQuery.data?.module_tests ?? []).map((mt) => mt.id),
    [moduleDataQuery.data]
  );

  // ── Query 2: locks ────────────────────────────────────────────────────────
  const locksQuery = useModuleLocks(moduleTestIds, module_name, {
    enabled: moduleTestIds.length > 0,
  });

  // ── Query 3: step details — disabled until export modal triggers refetch ──
  const stepDetailsQuery = useModuleStepDetails(module_name, { enabled: false });

  // ── Mutation: force release lock ──────────────────────────────────────────
  const forceReleaseMutation = useForceReleaseLock(module_name, {
    onError: (err: any) => {
      setReleaseError(`Failed to release lock: ${err?.message ?? "Unknown error"}`);
      setTimeout(() => setReleaseError(null), 5000);
    },
  });

  // ── Realtime: test_locks ──────────────────────────────────────────────────
  useEffect(() => {
    if (moduleTestIds.length === 0) return;
    const channel = supabase
      .channel(`module-locks-${module_name}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "test_locks" },
        () => queryClient.invalidateQueries({ queryKey: QK.moduleLocks(module_name) })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [module_name, moduleTestIds.length, queryClient]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const module_tests = moduleDataQuery.data?.module_tests ?? [];
  const revisions    = moduleDataQuery.data?.revisions    ?? {};
  const locks        = locksQuery.data ?? moduleDataQuery.data?.locks ?? {};

  const chartData = useMemo<ChartRow[]>(
    () => module_tests.map((mt) => ({
      name:    mt.test?.name ?? mt.tests_name ?? "Unnamed Test",
      pass:    mt.pass,
      fail:    mt.fail,
      pending: mt.pending,
    })),
    [module_tests]
  );

  const globalStats = useMemo(() => {
    const pass    = module_tests.reduce((a, mt) => a + mt.pass,    0);
    const fail    = module_tests.reduce((a, mt) => a + mt.fail,    0);
    const pending = module_tests.reduce((a, mt) => a + mt.pending, 0);
    const total   = pass + fail + pending;
    return { pass, fail, pending, total, passRate: total > 0 ? Math.round((pass / total) * 100) : 0 };
  }, [module_tests]);

  const exportStats = useMemo(() => [
    { label: "Total Steps", value: globalStats.total },
    { label: "Pass",        value: globalStats.pass  },
    { label: "Fail",        value: globalStats.fail  },
  ], [globalStats]);

  // ── Force release handler ─────────────────────────────────────────────────
  const handleForceRelease = useCallback(
    (module_test_id: string, lockedByName: string) => {
      if (!confirm(`Force-release the lock held by ${lockedByName}?`)) return;
      forceReleaseMutation.mutate({ module_test_id });
    },
    [forceReleaseMutation]
  );

  // ── Export ────────────────────────────────────────────────────────────────
  // Pass moduleData directly; refetch stepDetails only so we have step rows.
  // No FlatData construction — exportUtils consumes the cache types natively.
  const handleExport = useCallback(
    async (format: "csv" | "pdf") => {
      const data = moduleDataQuery.data;
      if (!data) return;

      setExporting(true);
      try {
        const result     = await stepDetailsQuery.refetch();
        const stepDetails = result.data;   // Record<string, TrimmedStepResult[]> | undefined

        if (format === "csv") exportModuleDashboardCSV(module_name, data, stepDetails);
        else                  exportModuleDashboardPDF(module_name, data, stepDetails);
      } catch (e: any) {
        setReleaseError(`Export failed: ${e?.message}`);
        setTimeout(() => setReleaseError(null), 5000);
      } finally {
        setExporting(false);
        setShowExport(false);
      }
    },
    [module_name, moduleDataQuery.data, stepDetailsQuery]
  );

  // ── Loading / error guards ────────────────────────────────────────────────
  if (moduleDataQuery.isLoading)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title={module_name} onBack={onBack} />
        <div className="flex items-center justify-center flex-1"><Spinner /></div>
      </div>
    );

  if (moduleDataQuery.isError)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title={module_name} onBack={onBack} />
        <div className="p-6">
          <div
            className="rounded-xl p-4 text-sm"
            style={{
              background: "color-mix(in srgb, var(--color-fail) 10%, transparent)",
              border:     "1px solid color-mix(in srgb, var(--color-fail) 30%, transparent)",
              color:      "var(--color-fail)",
            }}
          >
            Failed to load module:{" "}
            {moduleDataQuery.error instanceof Error
              ? moduleDataQuery.error.message
              : "Unknown error"}
          </div>
        </div>
      </div>
    );

  const isRefreshing = moduleDataQuery.isFetching && !moduleDataQuery.isLoading;

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col">
      <ExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        title="Export Module Results"
        subtitle={module_name}
        stats={exportStats}
        options={[
          {
            label:      exporting ? "Preparing…" : "CSV",
            icon:       <FileSpreadsheet size={16} />,
            color:      "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm:  () => handleExport("csv"),
          },
          {
            label:      exporting ? "Preparing…" : "PDF",
            icon:       <FileText size={16} />,
            color:      "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm:  () => handleExport("pdf"),
          },
        ]}
      />

      <Topbar
        title={module_name}
        subtitle={`${module_tests.length} test${module_tests.length !== 1 ? "s" : ""} · ${globalStats.total} steps`}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => moduleDataQuery.refetch()}
              disabled={moduleDataQuery.isFetching}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition disabled:opacity-50"
            >
              <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowExport(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition"
              >
                <Upload size={13} /> Export
              </button>
            )}
          </div>
        }
      />

      {releaseError && (
        <div className="px-6 pt-4">
          <div
            className="rounded-xl p-3 text-sm flex items-center gap-2"
            style={{
              background: "color-mix(in srgb, var(--color-fail) 10%, transparent)",
              border:     "1px solid color-mix(in srgb, var(--color-fail) 30%, transparent)",
              color:      "var(--color-fail)",
            }}
          >
            <span className="font-semibold">Error:</span> {releaseError}
          </div>
        </div>
      )}

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
        {/* Global stat pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Total",   value: globalStats.total,          className: "bg-bg-card border border-(--border-color) text-t-primary" },
            { label: "Pass",    value: globalStats.pass,           className: "bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] text-[var(--color-pass)] border border-[color-mix(in_srgb,var(--color-pass)_25%,transparent)]" },
            { label: "Fail",    value: globalStats.fail,           className: "bg-[color-mix(in_srgb,var(--color-fail)_10%,transparent)] text-[var(--color-fail)] border border-[color-mix(in_srgb,var(--color-fail)_25%,transparent)]" },
            { label: "Pending", value: globalStats.pending,        className: "bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] text-[var(--color-pend)] border border-[color-mix(in_srgb,var(--color-pend)_25%,transparent)]" },
            { label: "Pass %",  value: `${globalStats.passRate}%`, className: "bg-[var(--color-brand-bg)] text-[var(--color-brand)] border border-[color-mix(in_srgb,var(--color-brand)_25%,transparent)]" },
          ].map((s) => (
            <span
              key={s.label}
              className={`flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full ${s.className}`}
            >
              {s.label}: {s.value}
            </span>
          ))}
        </div>

        {/* Chart */}
        {module_tests.length > 0 && (
          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-semibold text-t-primary">Step Results by Test</p>
              <div className="flex items-center gap-1 bg-bg-base rounded-xl p-1">
                {CHART_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() => setChartType(type)}
                    className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${
                      chartType === type
                        ? "bg-c-brand text-(--bg-surface)"
                        : "text-t-muted hover:text-t-primary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <FadeWrapper animKey={chartType}>
              {chartType === "bar"   && <RBarChart   key="bar-chart"   data={chartData} ct={ct} />}
              {chartType === "area"  && <RAreaChart  key="area-chart"  data={chartData} ct={ct} />}
              {chartType === "line"  && <RLineChart  key="line-chart"  data={chartData} ct={ct} />}
              {chartType === "pie"   && <RPieChart   key="pie-chart"   data={chartData} ct={ct} />}
              {chartType === "radar" && <RRadarChart key="radar-chart" data={chartData} ct={ct} />}
            </FadeWrapper>
          </div>
        )}

        {/* Test cards */}
        <div className="flex flex-col gap-3">
          {module_tests.length === 0 && (
            <div className="text-center text-t-muted py-12">
              No tests assigned to this module yet.
            </div>
          )}
          {module_tests.map((mt, idx) => {
            const lock        = locks[mt.id];
            const isMyLock    = !!lock && lock.user_id === user?.id;
            const isOtherLock = !!lock && !isMyLock;
            const isCompleted = !mt.is_visible;
            const activeRev   = mt.test?.serial_no ? revisions[mt.test.serial_no] ?? null : null;
            return (
              <StaggerRow key={mt.id} index={idx}>
                <TestCard
                  mt={mt}
                  lock={lock}
                  isMyLock={isMyLock}
                  isOtherLock={isOtherLock}
                  isCompleted={isCompleted}
                  activeRev={activeRev}
                  isAdmin={isAdmin}
                  onExecute={onExecute}
                  onViewReport={onViewReport}
                  onForceRelease={handleForceRelease}
                />
              </StaggerRow>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ModuleDashboard;