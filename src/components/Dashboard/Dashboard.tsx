// src/components/Dashboard/Dashboard.tsx
//
// MIGRATION CHANGES (hooks.ts):
//   - useDashboardSummaries / useActiveLocks / useOtherActiveLocks
//     replace three inline useQuery calls — no QK / STALE / GC imports needed
//   - invalidateModuleLocks helper replaces direct queryClient.invalidateQueries
//   - All rpc / queryClient imports removed; types via "../../lib/hooks"
//
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import gsap from "gsap";
import { useQueryClient } from "@tanstack/react-query";
import ExportModal from "../UI/ExportModal";
import LockWarningBanner from "../UI/LockWarningBanner";
import SkeletonCard from "../UI/SkeletonCard";
import ModuleCard from "./ModuleCard";
import { supabase } from "../../supabase";
import {
  Upload,
  FileText,
  FileDown,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import {
  exportDashboardCSV,
  exportDashboardPDF,
  exportDashboardDocx,
} from "../../utils/export";
import type { ModuleSummary } from "../../utils/export";
import { getChartTheme } from "../../utils/chartTheme";
import { useTheme } from "../../context/ThemeContext";
import {
  useDashboardSummaries,
  useActiveLocks,
  useOtherActiveLocks,
} from "../../lib/hooks";
import { QK } from "../../lib/queryClient";
import RBarChart from "../ModuleDashboard/charts/RBarChart";
import RPieChart from "../ModuleDashboard/charts/RPieChart";
import RAreaChart from "../ModuleDashboard/charts/RAreaChart";
import RLineChart from "../ModuleDashboard/charts/RLineChart";
import RRadarChart from "../ModuleDashboard/charts/RRadarChart";

// ─── Animations ───────────────────────────────────────────────────────────────
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
@keyframes refreshSpin { to { transform: rotate(360deg); } }
`;

function useInjectStyle() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = ANIM_STYLE;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props {
  onNavigate: (page: string, module_name?: string) => void;
}

type ChartTab = "bar" | "area" | "line" | "radar" | "pie";

// ─── ChartErrorBoundary ───────────────────────────────────────────────────────
class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError)
      return (
        <div className="text-t-muted text-sm text-center py-8">
          Chart unavailable — try refreshing
        </div>
      );
    return this.props.children;
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
const Dashboard: React.FC<Props> = ({ onNavigate }) => {
  useInjectStyle();

  const { theme }   = useTheme();
  const queryClient = useQueryClient();

  const [showExportModal, setShowExportModal] = useState(false);
  const [activeChart, setActiveChart]         = useState<ChartTab>("bar");

  const gridRef         = useRef<HTMLDivElement>(null);
  const entranceDoneRef = useRef(false);

  // ── Queries (via hooks.ts) ────────────────────────────────────────────────
  const summariesQuery  = useDashboardSummaries();
  const locksQuery      = useActiveLocks();
  const otherLocksQuery = useOtherActiveLocks();

  // ── Realtime — test_locks only ────────────────────────────────────────────
  // Any change on test_locks invalidates both lock queries.
  // summariesQuery is untouched — lock changes don't affect step counts.
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-locks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "test_locks" },
        () => {
          queryClient.invalidateQueries({ queryKey: QK.activeLocks() });
          queryClient.invalidateQueries({ queryKey: QK.otherActiveLocks() });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // ── GSAP entrance — fires once after first data arrives ──────────────────
  useLayoutEffect(() => {
    if (
      !summariesQuery.isLoading &&
      !entranceDoneRef.current &&
      gridRef.current &&
      gridRef.current.children.length > 0
    ) {
      entranceDoneRef.current = true;
      const ctx = gsap.context(() => {
        gsap.fromTo(
          gridRef.current!.children,
          { opacity: 0, y: 16 },
          {
            opacity:    1,
            y:          0,
            stagger:    0.06,
            duration:   0.4,
            ease:       "power2.out",
            clearProps: "opacity,transform",
          }
        );
      });
      return () => ctx.revert();
    }
  }, [summariesQuery.isLoading, summariesQuery.data?.length]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const modules            = summariesQuery.data  ?? [];
  const activeLocks        = locksQuery.data       ?? [];
  const otherLockedModules = otherLocksQuery.data  ?? new Map<string, number>();

  const globalStats = useMemo(() => [
    { label: "Total Steps", value: modules.reduce((a, m) => a + m.total,   0) },
    { label: "Pass",        value: modules.reduce((a, m) => a + m.pass,    0) },
    { label: "Fail",        value: modules.reduce((a, m) => a + m.fail,    0) },
  ], [modules]);

  const myLockCountByModule = useMemo(() => {
    const map = new Map<string, number>();
    for (const lock of activeLocks)
      map.set(lock.module_name, (map.get(lock.module_name) ?? 0) + 1);
    return map;
  }, [activeLocks]);

  const chartTheme = useMemo(() => getChartTheme(theme), [theme]);

  const chartData = useMemo(() =>
    modules.map((m) => ({
      name:    m.name,
      pass:    m.pass,
      fail:    m.fail,
      pending: m.pending,
    })),
    [modules]
  );

  // ── Export ────────────────────────────────────────────────────────────────
  const buildSummariesWithTests = useCallback((): ModuleSummary[] =>
    modules.map((m) => ({
      name:     m.name,
      total:    m.total,
      pass:     m.pass,
      fail:     m.fail,
      pending:  m.pending,
      passRate: m.total > 0 ? Math.round((m.pass / m.total) * 100) : 0,
    })),
    [modules]
  );

  const handleExportCSV  = useCallback(() => exportDashboardCSV(buildSummariesWithTests()),  [buildSummariesWithTests]);
  const handleExportPDF  = useCallback(() => exportDashboardPDF(buildSummariesWithTests()),  [buildSummariesWithTests]);
  const handleExportDOCX = useCallback(() => exportDashboardDocx(buildSummariesWithTests()), [buildSummariesWithTests]);

  // ── Loading / error states ────────────────────────────────────────────────
  const isInitialLoad = summariesQuery.isLoading;
  const isRefreshing  = summariesQuery.isFetching && !isInitialLoad;
  const hasAnyLocks   = activeLocks.length > 0 || otherLockedModules.size > 0;

  if (summariesQuery.isError)
    return (
      <div className="p-6">
        <div
          className="rounded-xl p-4 text-sm"
          style={{
            background: "color-mix(in srgb, var(--color-fail) 10%, transparent)",
            border:     "1px solid color-mix(in srgb, var(--color-fail) 30%, transparent)",
            color:      "var(--color-fail)",
          }}
        >
          Failed to load modules:{" "}
          {summariesQuery.error instanceof Error
            ? summariesQuery.error.message
            : "Unknown error"}
        </div>
      </div>
    );

  // ── Chart tabs ────────────────────────────────────────────────────────────
  const chartTabs: { key: ChartTab; label: string }[] = [
    { key: "bar",   label: "Bar"   },
    { key: "area",  label: "Area"  },
    { key: "line",  label: "Line"  },
    { key: "radar", label: "Radar" },
    { key: "pie",   label: "Pie"   },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
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
          {
            label:      "CSV",
            icon:       <FileSpreadsheet size={16} />,
            color:      "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm:  handleExportCSV,
          },
          {
            label:      "PDF",
            icon:       <FileText size={16} />,
            color:      "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm:  handleExportPDF,
          },
          {
            label:      "DOCX",
            icon:       <FileDown size={16} />,
            color:      "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm:  handleExportDOCX,
          },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-t-primary">Fleet</h2>
          <p className="text-sm text-t-muted mt-1">
            {isInitialLoad
              ? "Loading…"
              : `${modules.length} Trainset${modules.length !== 1 ? "s" : ""} tracked`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => summariesQuery.refetch()}
            disabled={summariesQuery.isFetching}
            title="Refresh"
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg transition bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw
              size={14}
              style={{ animation: isRefreshing ? "refreshSpin 0.8s linear infinite" : "none" }}
            />
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            disabled={modules.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Upload size={14} /> Export
          </button>
        </div>
      </div>

      {/* Lock warning banner */}
      {!isInitialLoad && hasAnyLocks && (
        <LockWarningBanner
          locks={activeLocks}
          otherLockedModules={otherLockedModules}
          onNavigate={onNavigate}
        />
      )}

      {/* Fleet Overview Charts */}
      {!isInitialLoad && modules.length > 0 && (
        <div className="card p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold text-t-primary">Fleet Overview</p>
              <p className="text-xs text-t-muted mt-0.5">
                Pass / Fail / Pending across all trainsets
              </p>
            </div>
            <div className="flex items-center gap-1 bg-bg-surface rounded-lg p-1 border border-(--border-color)">
              {chartTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveChart(tab.key)}
                  className="px-3 py-1 text-xs font-semibold rounded-md transition-all"
                  style={
                    activeChart === tab.key
                      ? { background: "var(--color-brand)", color: "#fff" }
                      : { color: "var(--text-muted)" }
                  }
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
                    {
                      label: "Pending",
                      value: globalStats[0].value - globalStats[1].value - globalStats[2].value,
                      color: "var(--text-muted)",
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="flex items-center justify-between px-4 py-3 rounded-xl border border-(--border-color) bg-bg-surface"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: stat.color }}
                        />
                        <span className="text-sm text-t-muted">{stat.label}</span>
                      </div>
                      <span className="text-sm font-bold text-t-primary tabular-nums">
                        {stat.value}
                      </span>
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
      {isInitialLoad ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {modules.map((m) => {
            const myLockCount    = myLockCountByModule.get(m.name) ?? 0;
            const otherLockCount = otherLockedModules.get(m.name) ?? 0;

            const hasBoth   = myLockCount > 0 && otherLockCount > 0;
            const myOnly    = myLockCount > 0 && otherLockCount === 0;
            const otherOnly = otherLockCount > 0 && myLockCount === 0;

            const cardStyle: React.CSSProperties = hasBoth
              ? { animation: "dualPulse 2.6s ease-in-out infinite" }
              : myOnly
              ? {
                  border:     "1.5px solid rgba(var(--neon-cyan),0.55)",
                  background: "linear-gradient(135deg,rgba(var(--neon-cyan),0.07) 0%,transparent 60%)",
                  animation:  "neonPulse 2.6s ease-in-out infinite",
                }
              : otherOnly
              ? { animation: "amberPulse 2.6s ease-in-out infinite" }
              : {};

            return (
              <ModuleCard
                key={m.name}
                module={m}
                myLockCount={myLockCount}
                otherLockCount={otherLockCount}
                cardStyle={cardStyle}
                onClick={() => onNavigate("module", m.name)}
              />
            );
          })}

          {modules.length === 0 && (
            <div className="col-span-3 text-center text-t-muted py-20">
              No modules yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Dashboard;