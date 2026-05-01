// src/components/ModuleDashboard/ModuleDashboard.tsx
import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import { supabase } from "../../supabase";
import Spinner from "../UI/Spinner";
import Topbar from "../Layout/Topbar";
import ExportModal from "../UI/ExportModal";
import TestCard from "./TestCard";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { FileSpreadsheet, FileText, RefreshCw, Upload } from "lucide-react";
import {
  exportModuleDetailCSV,
  exportModuleDetailPDF,
  FlatData,
} from "../../utils/export";
import {
  RBarChart,
  RAreaChart,
  RLineChart,
  RPieChart,
  RRadarChart,
} from "./charts";
import type { ChartRow, ChartTheme } from "./charts";
import type { LockRow, ModuleTestRow, ActiveRevision, TrimmedStepResult } from "./ModuleDashboard.types";
import {
  fetchModuleData,
  fetchModuleStepDetails,
} from "../../lib/supabase/queries.moduledashboard";


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
  const { user }  = useAuth();
  const { theme } = useTheme();
  const isAdmin   = user?.role === "admin";

  const [module_tests, setModuleTests] = useState<ModuleTestRow[]>([]);
  const [locks,        setLocks]       = useState<Record<string, LockRow>>({});
  const [revisions,    setRevisions]   = useState<Record<string, ActiveRevision>>({});
  const [loading,      setLoading]     = useState(true);
  const [refreshing,   setRefreshing]  = useState(false);
  const [error,        setError]       = useState<string | null>(null);
  const [chartType,    setChartType]   = useState<ChartType>("bar");
  const [showExport,   setShowExport]  = useState(false);
  const [releaseError, setReleaseError]= useState<string | null>(null);
  const [exporting,    setExporting]   = useState(false);

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


  // ── Load ──────────────────────────────────────────────────────────────────
  const loadDashboard = useCallback(async (isRefresh = false) => {
    setError(null);
    if (isRefresh) setRefreshing(true);
    try {
      const { module_tests: mts, locks: lockMap, revisions: revMap } =
        await fetchModuleData(module_name);
      setModuleTests(mts);
      setLocks(lockMap);
      setRevisions(revMap);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load module data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [module_name]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);


  // ── Force release (admin only) ────────────────────────────────────────────
  const forceReleaseLock = useCallback(
    async (module_test_id: string, lockedByName: string) => {
      if (!confirm(`Force-release the lock held by ${lockedByName}?`)) return;
      setReleaseError(null);
      const { error } = await supabase
        .from("test_locks")
        .delete()
        .eq("module_test_id", module_test_id);
      if (error) {
        setReleaseError(`Failed to release lock: ${error.message}`);
        setTimeout(() => setReleaseError(null), 5000);
      } else {
        loadDashboard(true);
      }
    },
    [loadDashboard]
  );


  // ── Derived data ──────────────────────────────────────────────────────────
  const chartData = useMemo<ChartRow[]>(
    () =>
      module_tests.map((mt) => ({
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


  // ── Export — fetch step details lazily ───────────────────────────────────
  const handleExport = useCallback(
    async (format: "csv" | "pdf") => {
      setExporting(true);
      try {
        const bySerial = await fetchModuleStepDetails(module_name);

        const flat: FlatData[] = module_tests.flatMap((mt) => {
          const serialNo = mt.test?.serial_no ?? "";
          const results  = (bySerial[serialNo] ?? []).slice().sort((a: TrimmedStepResult, b: TrimmedStepResult) => {
            const sa = a.step?.serial_no ?? 0;
            const sb = b.step?.serial_no ?? 0;
            if (sa !== sb) return sa - sb;
            return (a.step?.is_divider ? 0 : 1) - (b.step?.is_divider ? 0 : 1);
          });
          return results.map((sr: TrimmedStepResult) => ({
            module:         module_name,
            test:           mt.test?.name ?? mt.tests_name ?? "Unnamed Test",
            test_serial_no: mt.test?.serial_no ?? "",
            serial:         sr.step?.serial_no ?? 0,
            action:         (sr.step?.action ?? "").replace(/^[^a-zA-Z0-9]+/, ""),
            expected:       sr.step?.expected_result ?? "",
            remarks:        "",
            status:         sr.status,
            isdivider:      sr.step?.is_divider ?? false,
          }));
        });

        if (format === "csv") exportModuleDetailCSV(flat);
        else                  exportModuleDetailPDF(flat, module_name);
      } catch (e: any) {
        setReleaseError(`Export failed: ${e?.message}`);
        setTimeout(() => setReleaseError(null), 5000);
      } finally {
        setExporting(false);
        setShowExport(false);
      }
    },
    [module_name, module_tests]
  );


  // ── Render guards ─────────────────────────────────────────────────────────
  if (loading)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title={module_name} onBack={onBack} />
        <div className="flex items-center justify-center flex-1">
          <Spinner />
        </div>
      </div>
    );

  if (error)
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
            Failed to load module: {error}
          </div>
        </div>
      </div>
    );


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
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              onClick={() => setShowExport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition"
            >
              <Upload size={13} />
              Export
            </button>
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
            <span key={s.label} className={`flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full ${s.className}`}>
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
                  onForceRelease={forceReleaseLock}
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