/**
 * TestReport.tsx
 * Drill-down mode  → pass module_test_id + onBack
 * Standalone mode  → render with no props
 * All queries via queries.testreport.ts
 */
import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import FadeWrapper from "../UI/FadeWrapper";
import SegmentedBar from "../UI/SegmentedBar";
import { useTheme } from "../../context/ThemeContext";
import { useInjectStyle } from "../../utils/animation";
import { exportReportCSV, exportReportPDF } from "../../utils/export";
import type { FlatData } from "../../utils/export";
import { getChartTheme } from "../../utils/chartTheme";
import {
  RBarChart,
  RAreaChart,
  RLineChart,
  RPieChart,
  RRadarChart,
} from "../ModuleDashboard/charts";
import type { ChartRow, ChartType } from "../ModuleDashboard/charts/types";
import { CHART_TYPES } from "../ModuleDashboard/charts";
import {
  FileSpreadsheet,
  FileText,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart2,
  TableIcon,
  Upload,
  AlertTriangle,
} from "lucide-react";
import {
  fetchTestReportData,
  fetchModuleOptions,
  fetchModuleReports,
  type ReportMeta,
  type ReportStepResult,
  type ModuleRow,
  type ModuleOption,
} from "../../lib/supabase/queries.testreport";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  module_test_id?: string;
  onBack?: () => void;
}

type ViewMode = "table" | "chart";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 size={14} className="text-green-400 shrink-0" />,
  fail: <XCircle size={14} className="text-red-400   shrink-0" />,
  pending: <Clock size={14} className="text-amber-400 shrink-0" />,
};

const STATUS_ROW: Record<string, string> = {
  pass: "border-l-2 border-green-500/40",
  fail: "border-l-2 border-red-500/40",
  pending: "",
};

function getNonDividerResults(rows: ReportStepResult[]) {
  return rows.filter((r) => !r.step?.is_divider);
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

const TestReport: React.FC<Props> = ({ module_test_id, onBack }) => {
  useInjectStyle();
  const { theme } = useTheme();
  const ct = useMemo(() => getChartTheme(theme), [theme]);

  // ── Drill-down state ──────────────────────────────────────────────────────
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [results, setResults] = useState<ReportStepResult[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // ── Standalone state ──────────────────────────────────────────────────────
  const [moduleOptions, setModuleOptions] = useState<ModuleOption[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [selectedModuleName, setSelectedModuleName] = useState<string | null>(
    null
  );
  const [showExportModal, setShowExportModal] = useState(false);
  const [view, setView] = useState<"graph" | "table">("graph");

  // ── Shared state ──────────────────────────────────────────────────────────
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Drill-down fetch ──────────────────────────────────────────────────────
  const fetchDrillDown = useCallback(async () => {
    if (!module_test_id) return;
    setLoading(true);
    try {
      const { meta: m, results: r } = await fetchTestReportData(module_test_id);
      if (!mountedRef.current) return;
      setMeta(m);
      setResults(r);
      setError(null);
    } catch (err: any) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [module_test_id]);

  // ── Standalone fetch ──────────────────────────────────────────────────────
  const fetchStandalone = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchModuleReports(selectedModuleName);
      if (!mountedRef.current) return;
      setModules(data);
    } catch (err: any) {
      if (mountedRef.current)
        setError(err.message ?? "Failed to load report data.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedModuleName]);

  useEffect(() => {
    if (module_test_id) {
      fetchDrillDown();
    } else {
      fetchModuleOptions().then(setModuleOptions);
      fetchStandalone();
    }
  }, [module_test_id, fetchDrillDown, fetchStandalone]);

  // ── Drill-down derived stats ──────────────────────────────────────────────
  const real = useMemo(() => getNonDividerResults(results), [results]);

  const stats = useMemo(() => {
    const pass = real.filter((r) => r.status === "pass").length;
    const fail = real.filter((r) => r.status === "fail").length;
    const pending = real.filter((r) => r.status === "pending").length;
    const total = real.length;
    return {
      pass,
      fail,
      pending,
      total,
      passRate: total > 0 ? Math.round((pass / total) * 100) : 0,
      failPct: total > 0 ? Math.round((fail / total) * 100) : 0,
      pendingPct:
        total > 0
          ? 100 -
            Math.round((pass / total) * 100) -
            Math.round((fail / total) * 100)
          : 0,
    };
  }, [real]);

  const drillChartData = useMemo<ChartRow[]>(
    () => [
      {
        name: meta?.test?.name ?? meta?.tests_name ?? "Test",
        pass: stats.pass,
        fail: stats.fail,
        pending: stats.pending,
      },
    ],
    [meta, stats]
  );

  // ── Standalone chart data ─────────────────────────────────────────────────
  const moduleChartData = useMemo<ChartRow[]>(
    () =>
      modules.map((m) => {
        const r = getNonDividerResults(m.step_results ?? []);
        return {
          name: m.name,
          pass: r.filter((s) => s.status === "pass").length,
          fail: r.filter((s) => s.status === "fail").length,
          pending: r.filter((s) => s.status === "pending").length,
        };
      }),
    [modules]
  );

  // ── Export helpers ────────────────────────────────────────────────────────
  const toFlatData = (): FlatData[] =>
    results
      .filter((r) => !r.step?.is_divider)
      .map((r) => ({
        module: meta?.module_name ?? "",
        test: meta?.test?.name ?? meta?.tests_name ?? "",
        serial: r.step?.serial_no ?? 0,
        action: r.step?.action ?? "",
        expected: r.step?.expected_result ?? "",
        remarks: r.remarks ?? "",
        status: r.status,
        is_divider: false,
      }));

  const buildFlatData = (mods: ModuleRow[]): FlatData[] => {
    const flat: FlatData[] = [];
    mods.forEach((m) => {
      [...(m.module_tests ?? [])]
        .sort((a, b) => (a.test?.serial_no ?? 0) - (b.test?.serial_no ?? 0))
        .forEach((mt) => {
          (m.step_results ?? [])
            .filter(
              (sr) =>
                sr.step?.tests_name === mt.tests_name && !sr.step?.is_divider
            )
            .sort((a, b) => (a.step?.serial_no ?? 0) - (b.step?.serial_no ?? 0))
            .forEach((sr) => {
              flat.push({
                module: m.name,
                test: mt.test?.name ?? "",
                serial: sr.step?.serial_no ?? 0,
                action: sr.step?.action ?? "",
                expected: sr.step?.expected_result ?? "",
                remarks: sr.remarks || "",
                status: sr.status,
              });
            });
        });
    });
    return flat;
  };

  const exportStats = () => {
    const flat = buildFlatData(modules);
    return [
      { label: "Total Steps", value: flat.length },
      { label: "Pass", value: flat.filter((s) => s.status === "pass").length },
      { label: "Fail", value: flat.filter((s) => s.status === "fail").length },
    ];
  };

  // ── Chart renderer (shared) ───────────────────────────────────────────────
  const renderChart = (data: ChartRow[]) => (
    <FadeWrapper animKey={chartType}>
      {chartType === "bar" && <RBarChart data={data} ct={ct} />}
      {chartType === "area" && <RAreaChart data={data} ct={ct} />}
      {chartType === "line" && <RLineChart data={data} ct={ct} />}
      {chartType === "pie" && <RPieChart data={data} ct={ct} showLabel />}
      {chartType === "radar" && <RRadarChart data={data} ct={ct} />}
    </FadeWrapper>
  );

  const chartTypeSelector = (
    <div className="flex items-center gap-1 bg-bg-base rounded-xl p-1">
      {CHART_TYPES.map(({ type, label }) => (
        <button
          key={type}
          onClick={() => setChartType(type)}
          className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${
            chartType === type
              ? "bg-c-brand text-white"
              : "text-t-muted hover:text-t-primary"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title="Test Report" onBack={onBack} />
        <div className="flex items-center justify-center flex-1">
          <Spinner />
        </div>
      </div>
    );

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title="Test Report" onBack={onBack} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertTriangle size={32} className="text-red-400" />
          <p className="text-sm text-red-400 font-medium">{error}</p>
          <button
            onClick={() =>
              module_test_id ? fetchDrillDown() : fetchStandalone()
            }
            className="px-4 py-2 rounded-xl bg-bg-card hover:bg-bg-surface text-sm
              text-t-secondary border border-[var(--border-color)] transition"
          >
            Retry
          </button>
        </div>
      </div>
    );

  // ══════════════════════════════════════════════════════════════════════════
  // DRILL-DOWN MODE
  // ══════════════════════════════════════════════════════════════════════════
  if (module_test_id) {
    if (!meta) return null;
    return (
      <div className="flex-1 flex flex-col">
        <Topbar
          title={meta.test?.name ?? meta.tests_name}
          subtitle={`${meta.module_name} · ${stats.total} steps`}
          onBack={onBack}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportReportCSV([], toFlatData())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition"
              >
                <FileSpreadsheet size={13} /> CSV
              </button>
              <button
                onClick={() => exportReportPDF([], toFlatData())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition"
              >
                <FileText size={13} /> PDF
              </button>
            </div>
          }
        />

        <div className="p-6 flex flex-col gap-5 pb-24 md:pb-6">
          {/* Stat pills */}
          <div className="flex flex-wrap gap-2">
            {[
              {
                label: "Total",
                value: stats.total,
                cls: "bg-bg-card text-t-primary",
              },
              {
                label: "Pass",
                value: stats.pass,
                cls: "bg-green-500/10 text-green-400",
              },
              {
                label: "Fail",
                value: stats.fail,
                cls: "bg-red-500/10 text-red-400",
              },
              {
                label: "Pending",
                value: stats.pending,
                cls: "bg-amber-500/10 text-amber-400",
              },
              {
                label: "Pass %",
                value: `${stats.passRate}%`,
                cls: "bg-c-brand-bg text-c-brand",
              },
            ].map((s) => (
              <span
                key={s.label}
                className={`flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full
                  border border-[var(--border-color)] ${s.cls}`}
              >
                {s.label}: {s.value}
              </span>
            ))}
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-t-muted mb-1">
              <span>Overall Progress</span>
              <span
                className="font-semibold"
                style={{
                  color:
                    stats.passRate === 100
                      ? "#22c55e"
                      : stats.failPct === 100
                      ? "#ef4444"
                      : undefined,
                }}
              >
                {stats.total > 0 ? `${stats.passRate}%` : "—"}
              </span>
            </div>
            <SegmentedBar
              passRate={stats.passRate}
              failPct={stats.failPct}
              pendingPct={stats.pendingPct}
              total={stats.total}
            />
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-2 bg-bg-base rounded-xl p-1 self-start">
            {(
              [
                {
                  mode: "table",
                  icon: <TableIcon size={13} />,
                  label: "Table",
                },
                {
                  mode: "chart",
                  icon: <BarChart2 size={13} />,
                  label: "Chart",
                },
              ] as const
            ).map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                  viewMode === mode
                    ? "bg-c-brand text-white"
                    : "text-t-muted hover:text-t-primary"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          {/* Table view */}
          {viewMode === "table" && (
            <div className="flex flex-col gap-2">
              {results.length === 0 && (
                <div className="text-center text-t-muted py-12">
                  No steps recorded for this test.
                </div>
              )}
              {results.map((r, idx) => {
                if (r.step?.is_divider)
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 px-4 py-2 rounded-lg bg-bg-surface border border-[var(--border-color)]"
                      style={{
                        animation:
                          "fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both",
                        animationDelay: `${idx * 30}ms`,
                      }}
                    >
                      <span className="flex-1 h-px bg-[var(--border-color)]" />
                      <span className="text-[11px] font-bold text-t-muted uppercase tracking-widest shrink-0 px-2">
                        {r.step.action || "Section"}
                      </span>
                      <span className="flex-1 h-px bg-[var(--border-color)]" />
                    </div>
                  );

                const isExpanded = expandedId === r.id;
                return (
                  <div
                    key={r.id}
                    className={`card ${STATUS_ROW[r.status] ?? ""}`}
                    style={{
                      animation:
                        "fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both",
                      animationDelay: `${idx * 30}ms`,
                    }}
                  >
                    <button
                      className="w-full flex items-start gap-3 text-left"
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    >
                      <span className="shrink-0 mt-0.5">
                        {STATUS_ICON[r.status]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] text-c-brand font-bold">
                            {r.step?.serial_no}
                          </span>
                          <span className="text-sm text-t-primary truncate">
                            {r.step?.action}
                          </span>
                        </div>
                        {!isExpanded && r.step?.expected_result && (
                          <p className="text-xs text-t-muted mt-0.5 truncate">
                            {r.step.expected_result}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-t-muted mt-1">
                        {isExpanded ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="mt-3 pl-7 flex flex-col gap-2 text-xs text-t-muted border-t border-[var(--border-color)] pt-3">
                        <div>
                          <span className="font-semibold text-t-primary">
                            Expected:{" "}
                          </span>
                          {r.step?.expected_result}
                        </div>
                        {r.remarks && (
                          <div>
                            <span className="font-semibold text-t-primary">
                              Remarks:{" "}
                            </span>
                            {r.remarks}
                          </div>
                        )}
                        {r.display_name && (
                          <div>
                            <span className="font-semibold text-t-primary">
                              Tested by:{" "}
                            </span>
                            {r.display_name}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Chart view */}
          {viewMode === "chart" && (
            <div className="card flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-semibold text-t-primary">
                  Step Results
                </p>
                {chartTypeSelector}
              </div>
              {renderChart(drillChartData)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STANDALONE MODE
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <>
      <Topbar
        title="Test Report"
        subtitle="Trainset-wise execution summary"
        actions={
          <button
            onClick={() => setShowExportModal(true)}
            disabled={modules.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-bg-card hover:bg-bg-surface
              disabled:opacity-40 disabled:cursor-not-allowed text-t-primary
              text-sm font-semibold rounded-lg transition border border-[var(--border-color)]"
          >
            <Upload size={14} /> Export
          </button>
        }
      />

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Report"
        subtitle={selectedModuleName ?? "All Modules"}
        stats={exportStats()}
        options={[
          {
            label: "CSV",
            icon: <FileSpreadsheet size={16} />,
            color: "bg-[var(--color-primary)]",
            hoverColor: "hover:bg-[var(--color-primary-hover)]",
            onConfirm: () => exportReportCSV([], buildFlatData(modules)),
          },
          {
            label: "PDF",
            icon: <FileText size={16} />,
            color: "bg-[var(--color-blue)]",
            hoverColor: "hover:bg-[var(--color-blue-hover)]",
            onConfirm: () => exportReportPDF([], buildFlatData(modules)),
          },
        ]}
      />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
        {/* Filter + View toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-t-muted">Filter by Trainset</label>
            <select
              value={selectedModuleName ?? ""}
              onChange={(e) => setSelectedModuleName(e.target.value || null)}
              className="input text-sm"
            >
              <option value="">All Modules</option>
              {moduleOptions.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 rounded-xl p-1 bg-bg-card border border-[var(--border-color)] w-fit">
            {(["graph", "table"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition capitalize ${
                  view === v
                    ? "bg-c-brand text-white"
                    : "text-t-muted hover:text-t-primary"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <FadeWrapper animKey={view}>
          {view === "graph" ? (
            <div className="card flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-semibold text-t-primary">
                  Execution Graph
                </p>
                {chartTypeSelector}
              </div>
              {renderChart(moduleChartData)}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border-color)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-card text-t-muted uppercase text-xs">
                    <th className="px-4 py-3 text-left">Trainset</th>
                    <th className="px-4 py-3 text-center">Tests</th>
                    <th className="px-4 py-3 text-center">Total Steps</th>
                    <th className="px-4 py-3 text-center text-green-600 dark:text-green-400">
                      Pass
                    </th>
                    <th className="px-4 py-3 text-center text-red-600 dark:text-red-400">
                      Fail
                    </th>
                    <th className="px-4 py-3 text-center text-amber-600 dark:text-amber-400">
                      Pending
                    </th>
                    <th className="px-4 py-3 text-center">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {modules.map((m) => {
                    const r = getNonDividerResults(m.step_results ?? []);
                    const total = r.length;
                    const pass = r.filter((s) => s.status === "pass").length;
                    const fail = r.filter((s) => s.status === "fail").length;
                    const pending = r.filter(
                      (s) => s.status === "pending"
                    ).length;
                    const rate =
                      total > 0 ? Math.round((pass / total) * 100) : 0;
                    return (
                      <tr
                        key={m.name}
                        className="hover:bg-bg-card transition-colors"
                      >
                        <td className="px-4 py-3 font-semibold text-t-primary">
                          {m.name}
                        </td>
                        <td className="px-4 py-3 text-center text-t-secondary">
                          {m.module_tests?.length ?? 0}
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-t-primary">
                          {total}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-green-600 dark:text-green-400">
                          {pass}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-red-600 dark:text-red-400">
                          {fail}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-amber-600 dark:text-amber-400">
                          {pending}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center gap-2 justify-center">
                            <div className="w-20 h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${rate}%`,
                                  backgroundColor: "#22c55e",
                                }}
                              />
                            </div>
                            <span className="font-bold text-t-primary">
                              {rate}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </FadeWrapper>
      </div>
    </>
  );
};

export default TestReport;
