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
  CheckCircle2,
  XCircle,
  Clock,
  BarChart2,
  TableIcon,
  Upload,
  AlertTriangle,
  User,
  X,
  ChevronRight,
} from "lucide-react";
import { supabase } from "../../supabase";
import {
  fetchTestReportData,
  fetchModuleOptions,
  fetchModuleReports,
  fetchSessionSteps,
  type ReportMeta,
  type ReportStepResult,
  type ModuleRow,
  type ModuleOption,
  type SessionStepEntry,
  type SessionTestGroup,
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
  pass: <CheckCircle2 size={13} className="text-green-400 shrink-0" />,
  fail: <XCircle size={13} className="text-red-400 shrink-0" />,
  pending: <Clock size={13} className="text-amber-400 shrink-0" />,
};

const STATUS_BADGE: Record<string, string> = {
  pass: "bg-green-500/10 text-green-400",
  fail: "bg-red-500/10 text-red-400",
  pending: "bg-amber-500/10 text-amber-400",
};

const SESSION_STORAGE_KEY = "testreport_session_start";

function getNonDividerResults(rows: ReportStepResult[]) {
  return rows.filter((r) => !r.step?.is_divider);
}

function getOrCreateSessionStart(): string {
  const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const now = new Date().toISOString();
  sessionStorage.setItem(SESSION_STORAGE_KEY, now);
  return now;
}

function clearSessionStart() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Step Detail Modal
// ─────────────────────────────────────────────────────────────────────────────

interface SessionModalProps {
  group: SessionTestGroup;
  onClose: () => void;
}

const SessionDetailModal: React.FC<SessionModalProps> = ({
  group,
  onClose,
}) => {
  const sorted = useMemo(
    () => [...group.steps].sort((a, b) => a.serial_no - b.serial_no),
    [group.steps]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        backgroundColor: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-3xl max-h-[80vh] rounded-2xl
          bg-bg-card border border-[var(--border-color)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-bold text-t-primary">
              {group.tests_name}
            </p>
            <p className="text-xs text-t-muted">{group.module_name}</p>
          </div>
          <div className="flex items-center gap-2">
            {[
              {
                label: "Pass",
                cls: "text-green-400 bg-green-500/10",
                count: group.pass,
              },
              {
                label: "Fail",
                cls: "text-red-400 bg-red-500/10",
                count: group.fail,
              },
              {
                label: "Undo",
                cls: "text-amber-400 bg-amber-500/10",
                count: group.undo,
              },
            ].map(({ label, cls, count }) => (
              <span
                key={label}
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-[var(--border-color)] ${cls}`}
              >
                {label}: {count}
              </span>
            ))}
            <button
              onClick={onClose}
              className="ml-2 p-1.5 rounded-lg hover:bg-bg-surface text-t-muted
                hover:text-t-primary transition"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Scrollable table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-card z-10">
              <tr className="text-t-muted uppercase">
                <th className="px-4 py-2.5 text-left w-10">#</th>
                <th className="px-4 py-2.5 text-left">Action</th>
                <th className="px-4 py-2.5 text-left">Expected Result</th>
                <th className="px-4 py-2.5 text-left">Remarks</th>
                <th className="px-4 py-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)]">
              {sorted.map((step) => (
                <tr
                  key={step.id}
                  className="hover:bg-bg-surface transition-colors"
                >
                  <td className="px-4 py-2.5 text-t-muted font-mono">
                    {step.serial_no}
                  </td>
                  <td className="px-4 py-2.5 text-t-primary max-w-[220px]">
                    <span className="line-clamp-2">{step.action || "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-t-secondary max-w-[220px]">
                    <span className="line-clamp-2">
                      {step.expected_result || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-t-muted max-w-[140px]">
                    <span className="line-clamp-2">{step.remarks || "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={`inline-flex items-center gap-1 font-bold px-2 py-0.5
                        rounded-full ${
                          STATUS_BADGE[step.status] ?? STATUS_BADGE.pending
                        }`}
                    >
                      {STATUS_ICON[step.status]}
                      {step.status === "pending" ? "undo" : step.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-color)] text-xs text-t-muted">
          {group.total} step{group.total !== 1 ? "s" : ""} executed this session
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

const TestReport: React.FC<Props> = ({ module_test_id, onBack }) => {
  useInjectStyle();
  const { theme } = useTheme();
  const ct = useMemo(() => getChartTheme(theme), [theme]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUser(data?.user?.email ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          clearSessionStart();
          setCurrentUser(null);
          setSessionSteps([]);
        } else {
          setCurrentUser(session?.user?.email ?? null);
        }
      }
    );

    return () => authListener.subscription.unsubscribe();
  }, []);

  // ── Drill-down state ──────────────────────────────────────────────────────
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [results, setResults] = useState<ReportStepResult[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("chart");

  // ── Standalone state ──────────────────────────────────────────────────────
  const [moduleOptions, setModuleOptions] = useState<ModuleOption[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [selectedModuleName, setSelectedModuleName] = useState<string | null>(
    null
  );
  const [showExportModal, setShowExportModal] = useState(false);
  const [view, setView] = useState<"graph" | "table">("graph");

  // ── Session state ─────────────────────────────────────────────────────────
  const [sessionSteps, setSessionSteps] = useState<SessionStepEntry[]>([]);
  const [activeSessionGroup, setActiveSessionGroup] =
    useState<SessionTestGroup | null>(null);

  // ── Shared ────────────────────────────────────────────────────────────────
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

  // ── Session groups (derived) ──────────────────────────────────────────────
  const sessionGroups = useMemo<SessionTestGroup[]>(() => {
    if (!sessionSteps.length) return [];
    const map = new Map<string, SessionTestGroup>();
    sessionSteps
      .filter((s) => !s.is_divider)
      .forEach((s) => {
        const key = `${s.module_name}::${s.tests_name}`;
        if (!map.has(key)) {
          map.set(key, {
            module_name: s.module_name,
            tests_name: s.tests_name,
            steps: [],
            pass: 0,
            fail: 0,
            undo: 0,
            total: 0,
          });
        }
        const g = map.get(key)!;
        g.steps.push(s);
        g.total++;
        if (s.status === "pass") g.pass++;
        else if (s.status === "fail") g.fail++;
        else if (s.status === "pending") g.undo++;
      });
    return Array.from(map.values());
  }, [sessionSteps]);

  // ── Fetch session steps ───────────────────────────────────────────────────
  const loadSessionSteps = useCallback(async (username: string) => {
    try {
      const sessionStart = getOrCreateSessionStart();
      const data = await fetchSessionSteps(username, sessionStart);
      if (mountedRef.current) setSessionSteps(data);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    if (currentUser) loadSessionSteps(currentUser);
  }, [currentUser, loadSessionSteps]);

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

  // ── Standalone fetch — always loads ALL modules; filtering is client-side ──
  const fetchStandalone = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchModuleReports(null);
      if (!mountedRef.current) return;
      setModules(data);
    } catch (err: any) {
      if (mountedRef.current)
        setError(err.message ?? "Failed to load report data.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (module_test_id) {
      fetchDrillDown();
    } else {
      setSelectedModuleName(null);
      fetchModuleOptions().then(setModuleOptions);
      fetchStandalone();
    }
  }, [module_test_id, fetchDrillDown, fetchStandalone]);

  // ── Drill-down stats ──────────────────────────────────────────────────────
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
  // ── Client-side filtered modules (dropdown never triggers re-fetch) ──────
  const displayModules = useMemo(
    () =>
      selectedModuleName
        ? modules.filter((m) => m.name === selectedModuleName)
        : modules,
    [modules, selectedModuleName]
  );

  const moduleChartData = useMemo<ChartRow[]>(
    () =>
      displayModules.map((m) => {
        const r = getNonDividerResults(m.step_results ?? []);
        return {
          name: m.name,
          pass: r.filter((s) => s.status === "pass").length,
          fail: r.filter((s) => s.status === "fail").length,
          pending: r.filter((s) => s.status === "pending").length,
        };
      }),
    [displayModules]
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
        .sort((a, b) =>
          String(a.test?.serial_no ?? "").localeCompare(
            String(b.test?.serial_no ?? "")
          )
        )
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
    const flat = buildFlatData(displayModules);
    return [
      { label: "Total Steps", value: flat.length },
      { label: "Pass", value: flat.filter((s) => s.status === "pass").length },
      { label: "Fail", value: flat.filter((s) => s.status === "fail").length },
    ];
  };

  // ── Chart renderer ────────────────────────────────────────────────────────
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

  const moduleDropdown = (
    <div className="flex items-center gap-3">
      <label className="text-sm text-t-muted shrink-0">
        Filter by Trainset
      </label>
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
  );

  // ── Your Session panel ────────────────────────────────────────────────────
  // Only renders when the current user has executed at least one step this session
  const sessionPanel =
    currentUser && sessionGroups.length > 0 ? (
      <div className="card flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <User size={14} className="text-c-brand" />
          <p className="text-sm font-semibold text-t-primary">Your Session</p>
          <span className="ml-auto text-xs text-t-muted">{currentUser}</span>
        </div>

        {/* Summary pills */}
        <div className="flex gap-2">
          {[
            {
              label: "Pass",
              cls: "text-green-400 bg-green-500/10",
              count: sessionGroups.reduce((n, g) => n + g.pass, 0),
            },
            {
              label: "Fail",
              cls: "text-red-400 bg-red-500/10",
              count: sessionGroups.reduce((n, g) => n + g.fail, 0),
            },
            {
              label: "Undo",
              cls: "text-amber-400 bg-amber-500/10",
              count: sessionGroups.reduce((n, g) => n + g.undo, 0),
            },
          ].map(({ label, cls, count }) => (
            <span
              key={label}
              className={`text-xs font-bold px-3 py-1 rounded-full
                border border-[var(--border-color)] ${cls}`}
            >
              {label}: {count}
            </span>
          ))}
        </div>

        {/* Test rows — click to open detail popup */}
        <div className="flex flex-col gap-1 pt-1 border-t border-[var(--border-color)]">
          {sessionGroups.map((g) => (
            <button
              key={`${g.module_name}::${g.tests_name}`}
              onClick={() => setActiveSessionGroup(g)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg
                bg-bg-base hover:bg-bg-surface border border-[var(--border-color)]
                transition-colors text-left group"
            >
              {/* Module tag */}
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-md
                bg-c-brand-bg text-c-brand shrink-0"
              >
                {g.module_name}
              </span>

              {/* Test name */}
              <span className="flex-1 text-xs font-semibold text-t-primary truncate">
                {g.tests_name}
              </span>

              {/* Counts */}
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-bold text-t-muted">
                  {g.total}
                </span>
                {g.pass > 0 && (
                  <span className="text-[11px] font-bold text-green-400">
                    {g.pass}✓
                  </span>
                )}
                {g.fail > 0 && (
                  <span className="text-[11px] font-bold text-red-400">
                    {g.fail}✗
                  </span>
                )}
                {g.undo > 0 && (
                  <span className="text-[11px] font-bold text-amber-400">
                    {g.undo}↩
                  </span>
                )}
              </span>

              <ChevronRight
                size={13}
                className="text-t-muted group-hover:text-t-primary transition-colors shrink-0"
              />
            </button>
          ))}
        </div>
      </div>
    ) : null;

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
        {activeSessionGroup && (
          <SessionDetailModal
            group={activeSessionGroup}
            onClose={() => setActiveSessionGroup(null)}
          />
        )}

        <Topbar
          title={meta.test?.name ?? meta.tests_name}
          subtitle={`${meta.module_name} · ${stats.total} steps`}
          onBack={onBack}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportReportCSV([], toFlatData())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)]
                  text-t-primary transition"
              >
                <FileSpreadsheet size={13} /> CSV
              </button>
              <button
                onClick={() => exportReportPDF([], toFlatData())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg
                  bg-bg-card hover:bg-bg-surface border border-[var(--border-color)]
                  text-t-primary transition"
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
                  mode: "chart",
                  icon: <BarChart2 size={13} />,
                  label: "Chart",
                },
                {
                  mode: "table",
                  icon: <TableIcon size={13} />,
                  label: "Table",
                },
              ] as const
            ).map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5
                  rounded-lg transition-colors ${
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

          {viewMode === "table" && (
            <div className="overflow-x-auto rounded-xl border border-[var(--border-color)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-card text-t-muted uppercase text-xs">
                    <th className="px-4 py-3 text-left">Test</th>
                    <th className="px-4 py-3 text-center">Total</th>
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
                  <tr className="hover:bg-bg-card transition-colors">
                    <td className="px-4 py-3 font-semibold text-t-primary">
                      {meta.test?.name ?? meta.tests_name}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-t-primary">
                      {stats.total}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-green-600 dark:text-green-400">
                      {stats.pass}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-red-600 dark:text-red-400">
                      {stats.fail}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-amber-600 dark:text-amber-400">
                      {stats.pending}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-20 h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${stats.passRate}%`,
                              backgroundColor: "#22c55e",
                            }}
                          />
                        </div>
                        <span className="font-bold text-t-primary">
                          {stats.passRate}%
                        </span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {sessionPanel}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STANDALONE MODE
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <>
      {activeSessionGroup && (
        <SessionDetailModal
          group={activeSessionGroup}
          onClose={() => setActiveSessionGroup(null)}
        />
      )}

      <Topbar
        title="Test Report"
        subtitle="Trainset-wise execution summary"
        actions={
          <button
            onClick={() => setShowExportModal(true)}
            disabled={displayModules.length === 0}
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
            onConfirm: () => exportReportCSV([], buildFlatData(displayModules)),
          },
          {
            label: "PDF",
            icon: <FileText size={16} />,
            color: "bg-[var(--color-blue)]",
            hoverColor: "hover:bg-[var(--color-blue-hover)]",
            onConfirm: () => exportReportPDF([], buildFlatData(displayModules)),
          },
        ]}
      />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
        {/* ── GLOBAL SECTION ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {moduleDropdown}
          <div
            className="flex items-center gap-2 rounded-xl p-1
            bg-bg-card border border-[var(--border-color)] w-fit"
          >
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
          {view === "graph" && (
            <div className="card flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-semibold text-t-primary">
                  Execution Graph
                </p>
                {chartTypeSelector}
              </div>
              {renderChart(moduleChartData)}
            </div>
          )}

          {view === "table" && (
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
                  {displayModules.map((m) => {
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

        {/* ── YOUR SESSION (only if user has executed steps) ──────────── */}
        {sessionPanel}
      </div>
    </>
  );
};

export default TestReport;
