/**
 * TestReport.tsx
 * Drill-down mode  → pass module_test_id + onBack
 * Standalone mode  → pass modules[] from Dashboard (NO own fetch)
 *
 * Data ownership:
 *  - Standalone: consumes DashboardModule[] passed as prop — zero extra queries
 *  - Drill-down: own two-phase fetch (fetchTestReportShell + streamTestReportResults)
 *  - Session:    own independent query (fetchSessionSteps) — always fresh
 */
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import SegmentedBar from "../UI/SegmentedBar";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { exportReportCSV, exportReportPDF } from "../../utils/export";
import type { FlatData } from "../../utils/export";
import { getChartTheme } from "../../utils/chartTheme";
import {
  RBarChart, RAreaChart, RLineChart, RPieChart, RRadarChart,
} from "../ModuleDashboard/charts";
import type { ChartRow, ChartType } from "../ModuleDashboard/charts/types";
import { CHART_TYPES } from "../ModuleDashboard/charts";
import {
  FileSpreadsheet, FileText, CheckCircle2, XCircle, Clock,
  BarChart2, TableIcon, Upload, AlertTriangle, User, X,
  ChevronRight, GitBranch,
} from "lucide-react";
import { supabase } from "../../supabase";
import {
  fetchTestReportShell,
  streamTestReportResults,
  fetchModuleOptions,
  fetchSessionSteps,
  type ReportMeta,
  type ReportStepResult,
  type ModuleOption,
  type SessionStepEntry,
  type SessionTestGroup,
  type StreamCancellationToken,
} from "../../lib/supabase/queries.testreport";
import type {
  DashboardModule,
} from "../../lib/supabase/queries.dashboard";


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
  index, children,
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


// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, React.ReactNode> = {
  pass:    <CheckCircle2 size={13} className="text-pass shrink-0" />,
  fail:    <XCircle      size={13} className="text-fail shrink-0" />,
  pending: <Clock        size={13} className="text-pend shrink-0" />,
};

const STATUS_BADGE: Record<string, React.CSSProperties> = {
  pass: {
    background: "color-mix(in srgb, var(--color-pass) 10%, transparent)",
    color:      "var(--color-pass)",
    border:     "1px solid color-mix(in srgb, var(--color-pass) 25%, transparent)",
  },
  fail: {
    background: "color-mix(in srgb, var(--color-fail) 10%, transparent)",
    color:      "var(--color-fail)",
    border:     "1px solid color-mix(in srgb, var(--color-fail) 25%, transparent)",
  },
  pending: {
    background: "color-mix(in srgb, var(--color-pend) 10%, transparent)",
    color:      "var(--color-pend)",
    border:     "1px solid color-mix(in srgb, var(--color-pend) 25%, transparent)",
  },
};

const SESSION_STORAGE_KEY = "testreport_session_start";

function getNonDividerResultsFlat(rows: DashboardModule["step_results"]) {
  return rows.filter((r) => !r.is_divider);
}

function getNonDividerResults(rows: ReportStepResult[]) {
  return rows.filter((r) => !r.step?.is_divider);
}

function getOrCreateSessionStart(): string {
  const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const iso = startOfDay.toISOString();
  sessionStorage.setItem(SESSION_STORAGE_KEY, iso);
  return iso;
}

function clearSessionStart() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}


// ─── Revision Badge ───────────────────────────────────────────────────────────

const RevisionTag: React.FC<{ revision: string }> = ({ revision }) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
      text-[10px] font-bold uppercase tracking-wider select-none shrink-0"
    style={{
      background: "color-mix(in srgb, var(--color-warn) 12%, transparent)",
      color:      "color-mix(in srgb, var(--color-warn), black 15%)",
      border:     "1px solid color-mix(in srgb, var(--color-warn) 30%, transparent)",
    }}
  >
    <GitBranch size={9} className="shrink-0" />
    {revision}
  </span>
);


// ─── Session Step Detail Modal ────────────────────────────────────────────────

interface SessionModalProps {
  group:         SessionTestGroup;
  displayName:   string;
  revisionLabel: string | null;
  onClose:       () => void;
}

const SessionDetailModal: React.FC<SessionModalProps> = ({
  group, displayName, revisionLabel, onClose,
}) => {
  const sorted = useMemo(
    () => [...group.steps].sort((a, b) => a.serial_no - b.serial_no),
    [group.steps]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(var(--glass-blur))" }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-3xl max-h-[80vh] rounded-2xl
          bg-bg-card border border-(--border-color) shadow-2xl"
        style={{ animation: "fadeSlideIn 0.28s cubic-bezier(0.22,1,0.36,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-(--border-color)">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-t-primary">{displayName}</p>
              {revisionLabel && <RevisionTag revision={revisionLabel} />}
            </div>
            <p className="text-xs text-t-muted">{group.module_name}</p>
          </div>
          <div className="flex items-center gap-2">
            {[
              { label: "Pass", style: STATUS_BADGE.pass,    count: group.pass },
              { label: "Fail", style: STATUS_BADGE.fail,    count: group.fail },
              { label: "Undo", style: STATUS_BADGE.pending, count: group.undo },
            ].map(({ label, style, count }) => (
              <span key={label} className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={style}>
                {label}: {count}
              </span>
            ))}
            <button onClick={onClose} className="ml-2 p-1.5 rounded-lg hover:bg-bg-surface text-t-muted hover:text-t-primary transition">
              <X size={15} />
            </button>
          </div>
        </div>

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
            <tbody className="divide-y divide-(--border-color)">
              {sorted.map((step, idx) => (
                <StaggerRow key={step.id} index={idx}>
                  <tr className="hover:bg-bg-surface transition-colors">
                    <td className="px-4 py-2.5 text-t-muted font-mono">{step.serial_no}</td>
                    <td className="px-4 py-2.5 text-t-primary max-w-[220px]">
                      <span className="line-clamp-2">{step.action || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-t-secondary max-w-[220px]">
                      <span className="line-clamp-2">{step.expected_result || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-t-muted max-w-[140px]">
                      <span className="line-clamp-2">{step.remarks || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full"
                        style={STATUS_BADGE[step.status] ?? STATUS_BADGE.pending}
                      >
                        {STATUS_ICON[step.status]}
                        {step.status === "pending" ? "undo" : step.status}
                      </span>
                    </td>
                  </tr>
                </StaggerRow>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-(--border-color) text-xs text-t-muted">
          {group.total} step{group.total !== 1 ? "s" : ""} executed this session
        </div>
      </div>
    </div>
  );
};


// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  module_test_id?: string;
  onBack?:         () => void;
  /** Dashboard passes its already-loaded modules — standalone uses this, no extra fetch */
  modules?:        DashboardModule[];
}

type ViewMode = "table" | "chart";


// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

const TestReport: React.FC<Props> = ({ module_test_id, onBack, modules: propModules }) => {
  const { theme } = useTheme();
  const { user }  = useAuth();
  const ct        = useMemo(() => getChartTheme(theme), [theme]);

  const sessionUser = user?.display_name ?? user?.email ?? null;

  // ── Drill-down state ──────────────────────────────────────────────────────
  const [meta,       setMeta]      = useState<ReportMeta | null>(null);
  const [results,    setResults]   = useState<ReportStepResult[]>([]);
  const [refreshing, setRefreshing]= useState(false);
  const [viewMode,   setViewMode]  = useState<ViewMode>("chart");

  // ── Standalone state — sourced from props, no fetch ───────────────────────
  const [modules,            setModules]           = useState<DashboardModule[]>(propModules ?? []);
  const [moduleOptions,      setModuleOptions]     = useState<ModuleOption[]>([]);
  const [selectedModuleName, setSelectedModuleName]= useState<string | null>(null);
  const [showExportModal,    setShowExportModal]   = useState(false);
  const [view,               setView]              = useState<"graph" | "table">("graph");

  // Keep modules in sync if dashboard re-streams and passes fresh data
  useEffect(() => {
    if (propModules) setModules(propModules);
  }, [propModules]);

  // ── Session state — own independent query ─────────────────────────────────
  const [sessionSteps,       setSessionSteps]       = useState<SessionStepEntry[]>([]);
  const [activeSessionGroup, setActiveSessionGroup] = useState<SessionTestGroup | null>(null);

  // ── Shared ────────────────────────────────────────────────────────────────
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [loading,   setLoading]   = useState(!!module_test_id); // only drill-down loads
  const [error,     setError]     = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef<StreamCancellationToken>({ cancelled: false });


  // ── Inject animation keyframes once ──────────────────────────────────────
  useLayoutEffect(() => {
    const id = "__report_anim__";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id    = id;
    el.textContent = `
      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0);    }
      }
      @keyframes fadeSlideInRow {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0);   }
      }
    `;
    document.head.appendChild(el);
  }, []);


  // ── Clear session on sign-out ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      clearSessionStart();
      setSessionSteps([]);
    }
  }, [user]);


  // ── Drill-down: two-phase load ────────────────────────────────────────────
  const loadDrillDown = useCallback(async () => {
    if (!module_test_id) return;

    abortRef.current?.abort();
    tokenRef.current.cancelled = true;

    const controller = new AbortController();
    const token: StreamCancellationToken = { cancelled: false };
    abortRef.current = controller;
    tokenRef.current = token;

    setLoading(true);
    setError(null);

    try {
      // Phase 1 — shell renders immediately with all statuses as "pending"
      const shell = await fetchTestReportShell(module_test_id);
      if (token.cancelled) return;

      setMeta(shell.meta);
      setResults(shell.results);
      setLoading(false);

      // Phase 2 — real statuses stream in progressively
      setRefreshing(true);
      await streamTestReportResults(
        shell,
        (updated) => { if (!token.cancelled) setResults(updated); },
        controller.signal,
        token
      );
    } catch (e: any) {
      if (e?.name === "AbortError" || token.cancelled) return;
      setError(e?.message ?? "Failed to load report data.");
      setLoading(false);
    } finally {
      if (!tokenRef.current.cancelled) setRefreshing(false);
    }
  }, [module_test_id]);


  // ── Session fetch — always independent ───────────────────────────────────
  const loadSessionSteps = useCallback(async (username: string) => {
    try {
      const sessionStart = getOrCreateSessionStart();
      const data = await fetchSessionSteps(username, sessionStart);
      setSessionSteps(data);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    if (sessionUser) loadSessionSteps(sessionUser);
  }, [sessionUser, loadSessionSteps]);


  // ── Standalone: module options for the filter dropdown ───────────────────
  useEffect(() => {
    if (!module_test_id) {
      setSelectedModuleName(null);
      fetchModuleOptions().then(setModuleOptions).catch(() => {});
    }
  }, [module_test_id]);


  // ── Initial load (drill-down only) ───────────────────────────────────────
  useEffect(() => {
    if (module_test_id) loadDrillDown();
    return () => {
      abortRef.current?.abort();
      tokenRef.current.cancelled = true;
    };
  }, [module_test_id, loadDrillDown]);


  // ── Realtime (drill-down only) ───────────────────────────────────────────
  useEffect(() => {
    if (!module_test_id || !meta) return;

    const channel = supabase
      .channel(`report-${module_test_id}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "step_results", filter: `module_name=eq.${meta.module_name}` },
        () => loadDrillDown()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [module_test_id, meta?.module_name, loadDrillDown]);


  // ── Lookup maps (built from prop modules) ─────────────────────────────────
  const serialToNameMap = useMemo(() => {
    const map = new Map<string, string>();
    modules.forEach((m) => {
      m.module_tests?.forEach((mt) => {
        if (mt.test?.serial_no && mt.test?.name)
          map.set(String(mt.test.serial_no), mt.test.name);
      });
    });
    return map;
  }, [modules]);

  const serialToRevisionMap = useMemo(() => {
    const map = new Map<string, string>();
    modules.forEach((m) => {
      m.module_tests?.forEach((mt) => {
        if (mt.test?.serial_no && mt.active_revision?.revision)
          map.set(String(mt.test.serial_no), mt.active_revision.revision);
      });
    });
    return map;
  }, [modules]);


  // ── Session groups ────────────────────────────────────────────────────────
  const sessionGroups = useMemo<SessionTestGroup[]>(() => {
    if (!sessionSteps.length) return [];
    const map = new Map<string, SessionTestGroup>();
    sessionSteps
      .filter((s) => !s.is_divider)
      .forEach((s) => {
        const key = `${s.module_name}::${s.tests_serial_no}`;
        if (!map.has(key)) {
          map.set(key, {
            module_name: s.module_name, tests_serial_no: s.tests_serial_no,
            steps: [], pass: 0, fail: 0, undo: 0, total: 0,
          });
        }
        const g = map.get(key)!;
        g.steps.push(s);
        g.total++;
        if (s.status === "pass")         g.pass++;
        else if (s.status === "fail")    g.fail++;
        else if (s.status === "pending") g.undo++;
      });
    return Array.from(map.values());
  }, [sessionSteps]);


  // ── Drill-down derived stats ──────────────────────────────────────────────
  const real = useMemo(() => getNonDividerResults(results), [results]);

  const stats = useMemo(() => {
    const pass    = real.filter((r) => r.status === "pass").length;
    const fail    = real.filter((r) => r.status === "fail").length;
    const pending = real.filter((r) => r.status === "pending").length;
    const total   = real.length;
    return {
      pass, fail, pending, total,
      passRate:   total > 0 ? Math.round((pass / total) * 100) : 0,
      failPct:    total > 0 ? Math.round((fail / total) * 100) : 0,
      pendingPct: total > 0
        ? 100 - Math.round((pass / total) * 100) - Math.round((fail / total) * 100)
        : 0,
    };
  }, [real]);

  const drillChartData = useMemo<ChartRow[]>(
    () => [{ name: meta?.test?.name ?? meta?.tests_name ?? "Test", ...stats }],
    [meta, stats]
  );


  // ── Standalone chart data (from prop modules — no fetch) ──────────────────
  const displayModules = useMemo(
    () => selectedModuleName ? modules.filter((m) => m.name === selectedModuleName) : modules,
    [modules, selectedModuleName]
  );

  const moduleChartData = useMemo<ChartRow[]>(
    () => displayModules.map((m) => {
      const real = getNonDividerResultsFlat(m.step_results ?? []);
      return {
        name:    m.name,
        pass:    real.filter((s) => s.status === "pass").length,
        fail:    real.filter((s) => s.status === "fail").length,
        pending: real.filter((s) => s.status === "pending").length,
      };
    }),
    [displayModules]
  );


  // ── Export helpers ────────────────────────────────────────────────────────
  const sessionFlatData = useMemo<FlatData[]>(
    () => sessionSteps.map((s) => ({
      module:         s.module_name,
      test:           serialToNameMap.get(String(s.tests_serial_no)) ?? s.tests_serial_no,
      test_serial_no: s.tests_serial_no,
      serial:         s.serial_no,
      action:         s.action || "",
      expected:       s.expected_result || "",
      remarks:        s.remarks || "",
      status:         s.status,
      isdivider:      s.is_divider,
    })),
    [sessionSteps, serialToNameMap]
  );

  const toFlatData = useCallback((): FlatData[] =>
    results.filter((r) => !r.step?.is_divider).map((r) => ({
      module:         meta?.module_name ?? "",
      test:           meta?.test?.name ?? meta?.tests_name ?? "",
      test_serial_no: meta?.test?.serial_no ?? "",
      serial:         r.step?.serial_no ?? 0,
      action:         r.step?.action ?? "",
      expected:       r.step?.expected_result ?? "",
      remarks:        r.remarks ?? "",
      status:         r.status,
      isdivider:      false,
    })),
  [results, meta]);

  const exportStats = () => {
    const flat = sessionFlatData.filter((s) => !s.isdivider);
    return [
      { label: "Total Steps", value: flat.length },
      { label: "Pass",        value: flat.filter((s) => s.status === "pass").length },
      { label: "Fail",        value: flat.filter((s) => s.status === "fail").length },
    ];
  };


  // ── Shared UI fragments ───────────────────────────────────────────────────
  const renderChart = (data: ChartRow[]) => (
    <FadeWrapper animKey={chartType}>
      {chartType === "bar"   && <RBarChart   data={data} ct={ct} />}
      {chartType === "area"  && <RAreaChart  data={data} ct={ct} />}
      {chartType === "line"  && <RLineChart  data={data} ct={ct} />}
      {chartType === "pie"   && <RPieChart   data={data} ct={ct} showLabel />}
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
            chartType === type ? "bg-c-brand text-(--bg-surface)" : "text-t-muted hover:text-t-primary"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const moduleDropdown = (
    <div className="flex items-center gap-3">
      <label className="text-sm text-t-muted shrink-0">Filter by Trainset</label>
      <select
        value={selectedModuleName ?? ""}
        onChange={(e) => setSelectedModuleName(e.target.value || null)}
        className="input text-sm"
      >
        <option value="">All Modules</option>
        {moduleOptions.map((m) => (
          <option key={m.name} value={m.name}>{m.name}</option>
        ))}
      </select>
    </div>
  );

  const sessionPanel = user && sessionGroups.length > 0 ? (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <User size={14} className="text-c-brand" />
        <p className="text-sm font-semibold text-t-primary">Your Session</p>
        <span className="ml-auto text-xs text-t-muted">{sessionUser}</span>
      </div>

      <div className="flex gap-2">
        {[
          { label: "Pass", style: STATUS_BADGE.pass,    count: sessionGroups.reduce((n, g) => n + g.pass, 0) },
          { label: "Fail", style: STATUS_BADGE.fail,    count: sessionGroups.reduce((n, g) => n + g.fail, 0) },
          { label: "Undo", style: STATUS_BADGE.pending, count: sessionGroups.reduce((n, g) => n + g.undo, 0) },
        ].map(({ label, style, count }) => (
          <span key={label} className="text-xs font-bold px-3 py-1 rounded-full" style={style}>
            {label}: {count}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1 pt-1 border-t border-(--border-color)">
        {sessionGroups.map((g, idx) => {
          const testDisplayName = serialToNameMap.get(String(g.tests_serial_no)) ?? g.tests_serial_no;
          const revisionLabel   = serialToRevisionMap.get(String(g.tests_serial_no)) ?? null;
          return (
            <StaggerRow key={`${g.module_name}::${g.tests_serial_no}`} index={idx}>
              <button
                onClick={() => setActiveSessionGroup(g)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                  bg-bg-base hover:bg-bg-surface border border-(--border-color)
                  transition-colors text-left group"
              >
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-c-brand-bg text-c-brand shrink-0">
                  {g.module_name}
                </span>
                <span className="flex-1 text-xs font-semibold text-t-primary truncate">
                  {testDisplayName}
                </span>
                {revisionLabel && <RevisionTag revision={revisionLabel} />}
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] font-bold text-t-muted">{g.total}</span>
                  {g.pass > 0 && <span className="text-[11px] font-bold" style={{ color: "var(--color-pass)" }}>{g.pass}✓</span>}
                  {g.fail > 0 && <span className="text-[11px] font-bold" style={{ color: "var(--color-fail)" }}>{g.fail}✗</span>}
                  {g.undo > 0 && <span className="text-[11px] font-bold" style={{ color: "var(--color-pend)" }}>{g.undo}↩</span>}
                </span>
                <ChevronRight size={13} className="text-t-muted group-hover:text-t-primary transition-colors shrink-0" />
              </button>
            </StaggerRow>
          );
        })}
      </div>
    </div>
  ) : null;


  // ── Loading (drill-down only) ─────────────────────────────────────────────
  if (loading && module_test_id)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title="Test Report" onBack={onBack} />
        <div className="flex items-center justify-center flex-1"><Spinner /></div>
      </div>
    );

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title="Test Report" onBack={onBack} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertTriangle size={32} style={{ color: "var(--color-fail)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--color-fail)" }}>{error}</p>
          <button
            onClick={loadDrillDown}
            className="px-4 py-2 rounded-xl bg-bg-card hover:bg-bg-surface text-sm
              text-t-secondary border border-(--border-color) transition"
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
            displayName={serialToNameMap.get(String(activeSessionGroup.tests_serial_no)) ?? activeSessionGroup.tests_serial_no}
            revisionLabel={serialToRevisionMap.get(String(activeSessionGroup.tests_serial_no)) ?? null}
            onClose={() => setActiveSessionGroup(null)}
          />
        )}

        <Topbar
          title={meta.test?.name ?? meta.tests_name}
          subtitle={`${meta.module_name} · ${stats.total} steps${
            meta.active_revision ? ` · ${meta.active_revision.revision}` : ""
          }${refreshing ? " · syncing…" : ""}`}
          onBack={onBack}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportReportCSV([], toFlatData())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg
                  bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition"
              >
                <FileSpreadsheet size={13} /> CSV
              </button>
              <button
                onClick={() => exportReportPDF([], toFlatData())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg
                  bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition"
              >
                <FileText size={13} /> PDF
              </button>
            </div>
          }
        />

        <div className="p-6 flex flex-col gap-5 pb-24 md:pb-6">
          <FadeWrapper animKey="drill-stats">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Total",   value: stats.total,          style: { background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-color)" } as React.CSSProperties },
                { label: "Pass",    value: stats.pass,           style: STATUS_BADGE.pass },
                { label: "Fail",    value: stats.fail,           style: STATUS_BADGE.fail },
                { label: "Pending", value: stats.pending,        style: STATUS_BADGE.pending },
                { label: "Pass %",  value: `${stats.passRate}%`, style: { background: "var(--color-brand-bg)", color: "var(--color-brand)", border: "1px solid color-mix(in srgb, var(--color-brand) 25%, transparent)" } as React.CSSProperties },
              ].map((s) => (
                <span key={s.label} className="flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full" style={s.style}>
                  {s.label}: {s.value}
                </span>
              ))}
            </div>
          </FadeWrapper>

          <div>
            <div className="flex justify-between text-xs text-t-muted mb-1">
              <span>Overall Progress</span>
              <span className="font-semibold" style={{ color: stats.passRate === 100 ? "var(--color-pass)" : stats.failPct === 100 ? "var(--color-fail)" : undefined }}>
                {stats.total > 0 ? `${stats.passRate}%` : "—"}
              </span>
            </div>
            <SegmentedBar passRate={stats.passRate} failPct={stats.failPct} pendingPct={stats.pendingPct} total={stats.total} />
          </div>

          <div className="flex items-center gap-2 bg-bg-base rounded-xl p-1 self-start">
            {([
              { mode: "chart", icon: <BarChart2  size={13} />, label: "Chart" },
              { mode: "table", icon: <TableIcon  size={13} />, label: "Table" },
            ] as const).map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                  viewMode === mode ? "bg-c-brand text-(--bg-surface)" : "text-t-muted hover:text-t-primary"
                }`}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          <FadeWrapper animKey={viewMode}>
            {viewMode === "chart" && (
              <div className="card flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-semibold text-t-primary">Step Results</p>
                  {chartTypeSelector}
                </div>
                {renderChart(drillChartData)}
              </div>
            )}

            {viewMode === "table" && (
              <div className="overflow-x-auto rounded-xl border border-(--border-color)">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-card text-t-muted uppercase text-xs">
                      <th className="px-4 py-3 text-left">Test</th>
                      <th className="px-4 py-3 text-center">Total</th>
                      <th className="px-4 py-3 text-center" style={{ color: "var(--color-pass)" }}>Pass</th>
                      <th className="px-4 py-3 text-center" style={{ color: "var(--color-fail)" }}>Fail</th>
                      <th className="px-4 py-3 text-center" style={{ color: "var(--color-pend)" }}>Pending</th>
                      <th className="px-4 py-3 text-center">Pass Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--border-color)">
                    <tr className="hover:bg-bg-card transition-colors">
                      <td className="px-4 py-3 font-semibold text-t-primary">
                        <div className="flex items-center gap-2">
                          {meta.test?.name ?? meta.tests_name}
                          {meta.active_revision && <RevisionTag revision={meta.active_revision.revision} />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-t-primary">{stats.total}</td>
                      <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-pass)" }}>{stats.pass}</td>
                      <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-fail)" }}>{stats.fail}</td>
                      <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-pend)" }}>{stats.pending}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-20 h-1.5 bg-(--border-color) rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${stats.passRate}%`, backgroundColor: "var(--color-pass)" }} />
                          </div>
                          <span className="font-bold text-t-primary">{stats.passRate}%</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </FadeWrapper>

          {sessionPanel}
        </div>
      </div>
    );
  }


  // ══════════════════════════════════════════════════════════════════════════
  // STANDALONE MODE — uses prop modules, no fetch
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <>
      {activeSessionGroup && (
        <SessionDetailModal
          group={activeSessionGroup}
          displayName={serialToNameMap.get(String(activeSessionGroup.tests_serial_no)) ?? activeSessionGroup.tests_serial_no}
          revisionLabel={serialToRevisionMap.get(String(activeSessionGroup.tests_serial_no)) ?? null}
          onClose={() => setActiveSessionGroup(null)}
        />
      )}

      <Topbar
        title="Test Report"
        subtitle="Trainset-wise execution summary"
        actions={
          <button
            onClick={() => setShowExportModal(true)}
            disabled={sessionFlatData.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-bg-card hover:bg-bg-surface
              disabled:opacity-40 disabled:cursor-not-allowed text-t-primary
              text-sm font-semibold rounded-lg transition border border-(--border-color)"
          >
            <Upload size={14} /> Export
          </button>
        }
      />

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Report"
        subtitle="Session Log"
        stats={exportStats()}
        options={[
          { label: "CSV", icon: <FileSpreadsheet size={16} />, color: "bg-(--bg-card) border border-(--border-color) text-(--text-primary)", hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)", onConfirm: () => exportReportCSV([], sessionFlatData) },
          { label: "PDF", icon: <FileText        size={16} />, color: "bg-(--bg-card) border border-(--border-color) text-(--text-primary)", hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)", onConfirm: () => exportReportPDF([], sessionFlatData) },
        ]}
      />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {moduleDropdown}
          <div className="flex items-center gap-2 rounded-xl p-1 bg-bg-card border border-(--border-color) w-fit">
            {(["graph", "table"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition capitalize ${
                  view === v ? "bg-c-brand text-(--bg-surface)" : "text-t-muted hover:text-t-primary"
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
                <p className="text-sm font-semibold text-t-primary">Execution Graph</p>
                {chartTypeSelector}
              </div>
              {renderChart(moduleChartData)}
            </div>
          )}

          {view === "table" && (
            <div className="overflow-x-auto rounded-xl border border-(--border-color)">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-card text-t-muted uppercase text-xs">
                    <th className="px-4 py-3 text-left">Module</th>
                    <th className="px-4 py-3 text-left">Test</th>
                    <th className="px-4 py-3 text-center">Total</th>
                    <th className="px-4 py-3 text-center" style={{ color: "var(--color-pass)" }}>Pass</th>
                    <th className="px-4 py-3 text-center" style={{ color: "var(--color-fail)" }}>Fail</th>
                    <th className="px-4 py-3 text-center" style={{ color: "var(--color-pend)" }}>Pending</th>
                    <th className="px-4 py-3 text-center">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--border-color)">
                  {displayModules.flatMap((m) =>
                    (m.module_tests ?? []).map((mt, idx) => {
                      const testResults = getNonDividerResultsFlat(
                        (m.step_results ?? []).filter((sr) => sr.tests_serial_no === mt.test?.serial_no)
                      );
                      const pass     = testResults.filter((r) => r.status === "pass").length;
                      const fail     = testResults.filter((r) => r.status === "fail").length;
                      const pending  = testResults.filter((r) => r.status === "pending").length;
                      const total    = testResults.length;
                      const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;
                      return (
                        <StaggerRow key={`${m.name}-${mt.id}`} index={idx}>
                          <tr className="hover:bg-bg-card transition-colors">
                            <td className="px-4 py-3 text-t-muted text-xs">{m.name}</td>
                            <td className="px-4 py-3 font-semibold text-t-primary">
                              <div className="flex items-center gap-2">
                                {mt.test?.name ?? mt.tests_name}
                                {mt.active_revision && <RevisionTag revision={mt.active_revision.revision} />}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-t-primary">{total}</td>
                            <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-pass)" }}>{pass}</td>
                            <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-fail)" }}>{fail}</td>
                            <td className="px-4 py-3 text-center font-semibold" style={{ color: "var(--color-pend)" }}>{pending}</td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center gap-2 justify-center">
                                <div className="w-20 h-1.5 bg-(--border-color) rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${passRate}%`, backgroundColor: "var(--color-pass)" }} />
                                </div>
                                <span className="font-bold text-t-primary">{passRate}%</span>
                              </div>
                            </td>
                          </tr>
                        </StaggerRow>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </FadeWrapper>

        {sessionPanel}
      </div>
    </>
  );
};

export default TestReport;