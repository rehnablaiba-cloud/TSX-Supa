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
  fetchDashboardModules,
  fetchActiveLocks,
  fetchOtherActiveLockModules,
} from "../../lib/supabase/queries.dashboard";
import type { DashboardModule } from "../../lib/supabase/queries.dashboard";
import RBarChart from "../ModuleDashboard/charts/RBarChart";
import RPieChart from "../ModuleDashboard/charts/RPieChart";
import RAreaChart from "../ModuleDashboard/charts/RAreaChart";
import RLineChart from "../ModuleDashboard/charts/RLineChart";
import RRadarChart from "../ModuleDashboard/charts/RRadarChart";

// ─────────────────────────────────────────────────────────────────────────────
// Inject neonPulse keyframe (same as ModuleDashboard)
// ─────────────────────────────────────────────────────────────────────────────
const ANIM_STYLE = `
@keyframes neonPulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(34,211,238,0.0), 0 0 12px 2px rgba(34,211,238,0.18); }
  50%      { box-shadow: 0 0 0 0 rgba(34,211,238,0.0), 0 0 22px 6px rgba(34,211,238,0.32); }
}
`;

function useInjectStyle() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = ANIM_STYLE;
    document.head.appendChild(el);
    return () => {
      document.head.removeChild(el);
    };
  }, []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (page: string, module_name?: string) => void;
}

type ChartTab = "bar" | "area" | "line" | "radar" | "pie";

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

const Dashboard: React.FC<Props> = ({ onNavigate }) => {
  useInjectStyle();

  const { theme } = useTheme();

  const [showExportModal, setShowExportModal] = useState(false);
  const [modules, setModules] = useState<DashboardModule[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLocks, setActiveLocks] = useState<ActiveLock[]>([]);
  const [activeChart, setActiveChart] = useState<ChartTab>("bar");
  const [otherLockedModules, setOtherLockedModules] = useState<Set<string>>(
    new Set()
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Fetch active locks ────────────────────────────────────────────────────
  const fetchActiveLocksData = useCallback(async () => {
    try {
      const [locks, otherModules] = await Promise.all([
        fetchActiveLocks(),
        fetchOtherActiveLockModules(),
      ]);
      if (!mountedRef.current) return;
      setActiveLocks(locks);
      setOtherLockedModules(otherModules);
    } catch {
      // non-critical
    }
  }, []);

  // ── Fetch modules ─────────────────────────────────────────────────────────
  const fetchModules = useCallback(async (isInitial = false) => {
    try {
      const data = await fetchDashboardModules();
      if (!mountedRef.current) return;
      setModules(data);
      setError(null);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message ?? "Failed to load modules");
    } finally {
      if (isInitial && mountedRef.current) setInitialLoad(false);
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([fetchModules(true), fetchActiveLocksData()]);
  }, [fetchModules, fetchActiveLocksData]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "step_results" },
        () => fetchModules(false)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "modules" },
        () => fetchModules(false)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "test_locks" },
        fetchActiveLocksData
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchModules, fetchActiveLocksData]);

  // ── GSAP entrance animation ───────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!initialLoad && gridRef.current && gridRef.current.children.length > 0)
      gsap.fromTo(
        gridRef.current.children,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.06,
          duration: 0.4,
          ease: "power2.out",
          clearProps: "opacity,transform",
        }
      );
  }, [initialLoad, modules.length]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const summaries = useMemo(() => buildSummaries(modules), [modules]);

  const globalStats = useMemo(
    () => [
      {
        label: "Total Steps",
        value: summaries.reduce((a, x) => a + x.total, 0),
      },
      { label: "Pass", value: summaries.reduce((a, x) => a + x.pass, 0) },
      { label: "Fail", value: summaries.reduce((a, x) => a + x.fail, 0) },
    ],
    [summaries]
  );

  // ── Lock sets — fetchActiveLocks returns only current user's locks
  const myLockedModuleNames = useMemo(
    () => new Set(activeLocks.map((l) => l.module_name)),
    [activeLocks]
  );
  // otherLockedModules comes from fetchOtherActiveLockModules
  const otherLockedModuleNames = otherLockedModules;

  const chartTheme = useMemo(() => getChartTheme(theme), [theme]);

  const chartData = useMemo(
    () =>
      summaries.map((s) => ({
        name: s.name,
        pass: s.pass,
        fail: s.fail,
        pending: s.pending,
      })),
    [summaries]
  );

  // ── Error state ───────────────────────────────────────────────────────────
  if (error)
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-500 text-sm">
          Failed to load modules: {error}
        </div>
      </div>
    );

  const chartTabs: { key: ChartTab; label: string }[] = [
    { key: "bar", label: "Bar" },
    { key: "area", label: "Area" },
    { key: "line", label: "Line" },
    { key: "radar", label: "Radar" },
    { key: "pie", label: "Pie" },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Dashboard"
        subtitle="Fleet summary"
        stats={globalStats}
        options={[
          {
            label: "CSV",
            icon: <FileSpreadsheet size={16} />,
            color: "bg-[var(--color-primary)]",
            hoverColor: "hover:bg-[var(--color-primary-hover)]",
            onConfirm: () => exportDashboardCSV(summaries),
          },
          {
            label: "PDF",
            icon: <FileText size={16} />,
            color: "bg-[var(--color-blue)]",
            hoverColor: "hover:bg-[var(--color-blue-hover)]",
            onConfirm: () => exportDashboardPDF(summaries),
          },
          {
            label: "DOCX",
            icon: <FileDown size={16} />,
            color: "bg-[var(--color-blue)]",
            hoverColor: "hover:bg-[var(--color-blue-hover)]",
            onConfirm: () => exportDashboardDocx(summaries),
          },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-t-primary">Fleet</h2>
          <p className="text-sm text-t-muted mt-1">
            {initialLoad
              ? "Loading…"
              : `${modules.length} Trainset${
                  modules.length !== 1 ? "s" : ""
                } tracked`}
          </p>
        </div>
        <button
          onClick={() => setShowExportModal(true)}
          disabled={modules.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload size={14} /> Export
        </button>
      </div>

      {/* Lock warning banner */}
      {!initialLoad && activeLocks.length > 0 && (
        <LockWarningBanner locks={activeLocks} onNavigate={onNavigate} />
      )}

      {/* ── Fleet Overview Charts ─────────────────────────────────────────── */}
      {!initialLoad && modules.length > 0 && (
        <div className="card p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold text-t-primary">
                Fleet Overview
              </p>
              <p className="text-xs text-t-muted mt-0.5">
                Pass / Fail / Pending across all trainsets
              </p>
            </div>
            <div className="flex items-center gap-1 bg-bg-surface rounded-lg p-1 border border-[var(--border-color)]">
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

          {activeChart === "pie" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
              <div className="flex flex-col items-center justify-center">
                <p className="text-xs text-t-muted mb-2 self-start">
                  Fleet Total Distribution
                </p>
                <RPieChart
                  data={chartData}
                  ct={chartTheme}
                  height={260}
                  showLabel
                />
              </div>
              <div className="flex flex-col gap-3">
                {[
                  {
                    label: "Total Steps",
                    value: globalStats[0].value,
                    color: "var(--color-brand)",
                  },
                  {
                    label: "Pass",
                    value: globalStats[1].value,
                    color: "#22c55e",
                  },
                  {
                    label: "Fail",
                    value: globalStats[2].value,
                    color: "#ef4444",
                  },
                  {
                    label: "Pending",
                    value:
                      globalStats[0].value -
                      globalStats[1].value -
                      globalStats[2].value,
                    color: "#94a3b8",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="flex items-center justify-between px-4 py-3 rounded-xl border border-[var(--border-color)] bg-bg-surface"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: stat.color }}
                      />
                      <span className="text-sm text-t-muted">{stat.label}</span>
                    </div>
                    <span className="text-sm font-bold text-t-primary">
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-full">
              {activeChart === "bar" && (
                <RBarChart data={chartData} ct={chartTheme} />
              )}
              {activeChart === "area" && (
                <RAreaChart data={chartData} ct={chartTheme} />
              )}
              {activeChart === "line" && (
                <RLineChart data={chartData} ct={chartTheme} />
              )}
              {activeChart === "radar" && (
                <RRadarChart data={chartData} ct={chartTheme} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Module grid */}
      {initialLoad ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {modules.map((m) => {
            const {
              total,
              pass,
              fail,
              pending,
              passRate,
              failPct,
              pendingPct,
              testCount,
            } = getModuleStats(m.module_tests ?? [], m.step_results ?? []);

            const isMyLock = myLockedModuleNames.has(m.name);
            const isOtherLock = otherLockedModuleNames.has(m.name);

            // ── Card style ────────────────────────────────────────────────
            const cardStyle: React.CSSProperties = isMyLock
              ? {
                  border: "1.5px solid rgba(34,211,238,0.55)",
                  background:
                    "linear-gradient(135deg, rgba(34,211,238,0.07) 0%, transparent 60%)",
                  animation: "neonPulse 2.6s ease-in-out infinite",
                }
              : isOtherLock
              ? { borderColor: "#f59e0b55", boxShadow: "0 0 0 1px #f59e0b33" }
              : {};

            const cardCls = [
              "card text-left hover:border-c-brand/50 hover:shadow-xl transition-all duration-300 cursor-pointer group",
              isOtherLock ? "opacity-60 grayscale-[0.25]" : "",
            ].join(" ");

            const passLabelColor =
              total === 0
                ? "var(--text-muted)"
                : passRate === 100
                ? "#22c55e"
                : failPct === 100
                ? "#ef4444"
                : "var(--text-primary)";

            return (
              <button
                key={m.name}
                onClick={() => onNavigate("module", m.name)}
                className={cardCls}
                style={cardStyle}
              >
                <div className="flex items-start gap-3 mb-3">
                  <span
                    className="w-3 h-3 rounded-full mt-1.5 shrink-0"
                    style={{
                      backgroundColor: isMyLock
                        ? "#22d3ee"
                        : isOtherLock
                        ? "#f59e0b"
                        : "var(--color-brand)",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <h3
                      className={`font-semibold transition-colors truncate ${
                        isMyLock
                          ? "text-cyan-300"
                          : "text-t-primary group-hover:text-c-brand"
                      }`}
                    >
                      {m.name}
                    </h3>
                    {m.description && (
                      <p className="text-xs text-t-muted mt-0.5 truncate">
                        {m.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isMyLock && (
                      <span
                        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap
                        text-cyan-300 border-cyan-400/40 bg-cyan-500/10"
                      >
                        <Lock size={9} /> My Lock
                      </span>
                    )}
                    {isOtherLock && (
                      <span
                        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
                        style={{
                          color: "#f59e0b",
                          borderColor: "#f59e0b88",
                          background:
                            "color-mix(in srgb, #f59e0b 10%, transparent)",
                        }}
                      >
                        <Lock size={9} /> Locked
                      </span>
                    )}
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap tracking-wide"
                      style={{
                        color: "var(--color-brand)",
                        borderColor: "var(--color-brand)",
                        background:
                          "color-mix(in srgb, var(--color-brand) 8%, transparent)",
                      }}
                    >
                      {testCount} {testCount === 1 ? "Test" : "Tests"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-t-muted">Total Steps</span>
                  <span className="text-sm font-bold text-t-primary">
                    {total}
                  </span>
                </div>

                <div className="flex gap-2 mb-3">
                  <span className="badge-pass">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1" />
                    {pass} Pass
                  </span>
                  <span className="badge-fail">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block mr-1" />
                    {fail} Fail
                  </span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-t-muted bg-bg-card border border-[var(--border-color)] rounded-full px-2.5 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] inline-block" />
                    {pending} Pending
                  </span>
                </div>

                <div className="mt-1">
                  <div className="flex justify-between text-xs text-t-muted mb-1">
                    <span>Progress</span>
                    <span
                      className="font-semibold"
                      style={{ color: passLabelColor }}
                    >
                      {total > 0 ? `${passRate}%` : "—"}
                    </span>
                  </div>
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
