// src/components/ModuleDashboard/ModuleDashboard.tsx
import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import { supabase } from "../../supabase";
import Spinner from "../UI/Spinner";
import Topbar from "../Layout/Topbar";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import {
  Lock,
  Play,
  FileSpreadsheet,
  FileText,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
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

// ── Animation keyframes ───────────────────────────────────────────────────────
const ANIM_STYLE = `
@keyframes fadeSlideIn    { from{opacity:0;transform:translateY(10px)}  to{opacity:1;transform:translateY(0)} }
@keyframes fadeSlideInRow { from{opacity:0;transform:translateX(-6px)}  to{opacity:1;transform:translateX(0)} }
@keyframes fadeScaleIn    { from{opacity:0;transform:scale(.95) translateY(-4px)} to{opacity:1;transform:scale(1) translateY(0)} }
@keyframes neonPulse      { 0%,100%{box-shadow:0 0 0 0 rgba(34,211,238,0.0),0 0 12px 2px rgba(34,211,238,0.18)} 50%{box-shadow:0 0 0 0 rgba(34,211,238,0.0),0 0 22px 6px rgba(34,211,238,0.32)} }
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
      animation: "fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both",
      animationDelay: `${index * 45}ms`,
    }}
  >
    {children}
  </div>
);

// ── Constants ─────────────────────────────────────────────────────────────────
type ChartType = "bar" | "area" | "line" | "pie" | "radar";
const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "bar", label: "Bar" },
  { type: "area", label: "Area" },
  { type: "line", label: "Line" },
  { type: "pie", label: "Pie" },
  { type: "radar", label: "Radar" },
];

// ── Props & DB types ──────────────────────────────────────────────────────────
interface Props {
  module_name: string;
  onBack: () => void;
  onExecute: (module_test_id: string) => void;
  onViewReport: (module_test_id: string) => void;
}

// Matches actual test_locks table schema
interface LockRow {
  module_test_id: string;
  user_id: string;
  locked_by_name: string;
  locked_at: string;
}

interface TrimmedStepResult {
  id: string;
  status: "pass" | "fail" | "pending";
  step: { id: string; is_divider: boolean; tests_name: string } | null;
}

interface ModuleTestRow {
  id: string;
  tests_name: string;
  test: { serial_no: number; name: string };
  step_results: TrimmedStepResult[];
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const ModuleDashboard: React.FC<Props> = ({
  module_name,
  onBack,
  onExecute,
  onViewReport,
}) => {
  useInjectStyle();

  const { user } = useAuth();
  const { theme } = useTheme();

  const [module_tests, setmodule_tests] = useState<ModuleTestRow[]>([]);
  const [locks, setLocks] = useState<Record<string, LockRow>>({});
  const [loading, setLoading] = useState(true); // initial load only
  const [refreshing, setRefreshing] = useState(false); // silent background refresh
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── ChartTheme derived from CSS vars ──────────────────────────────────────
  const ct = useMemo<ChartTheme>(() => {
    const s = getComputedStyle(document.documentElement);
    const get = (v: string) => s.getPropertyValue(v).trim();
    const isDark = theme === "dark";
    return {
      panel: isDark ? "#0f172a" : "#ffffff",
      text: get("--text-primary") || (isDark ? "#f1f5f9" : "#1e293b"),
      muted: get("--text-muted") || (isDark ? "#64748b" : "#94a3b8"),
      grid: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
      border: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      tooltipBg: isDark ? "#1e293b" : "#ffffff",
      tooltipText: isDark ? "#f1f5f9" : "#1e293b",
      tooltipName: isDark ? "#94a3b8" : "#64748b",
    };
  }, [theme]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  // isBackground=true → silent refresh (no spinner); false → full load spinner
  const fetchData = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setLoading(true);
      else setRefreshing(true);

      // Step 1 — fetch module_tests and step_results in parallel
      const [mtRes, srRes] = await Promise.all([
        supabase
          .from("module_tests")
          .select(
            "id, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name)"
          )
          .eq("module_name", module_name)
          .order("tests_name"),
        supabase
          .from("step_results")
          .select(
            "id, status, test_steps_id, step:test_steps!step_results_test_steps_id_fkey(id, is_divider, tests_name)"
          )
          .eq("module_name", module_name),
      ]);

      if (!mountedRef.current) return;

      if (mtRes.error) {
        setError(mtRes.error.message);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (srRes.error) {
        setError(srRes.error.message);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Step 2 — fetch locks filtered by the actual module_test ids we just got
      // (test_locks has no module_name column — only module_test_id)
      const moduleTestIds = (mtRes.data ?? []).map((mt: any) => mt.id);

      const lockRes =
        moduleTestIds.length > 0
          ? await supabase
              .from("test_locks")
              .select("module_test_id, user_id, locked_by_name, locked_at")
              .in("module_test_id", moduleTestIds)
          : { data: [], error: null };

      if (!mountedRef.current) return;

      // Always update locks — reset to {} if no rows or query error
      const lockMap =
        !lockRes.error && lockRes.data
          ? (lockRes.data as LockRow[]).reduce<Record<string, LockRow>>(
              (acc, l) => {
                acc[l.module_test_id] = l;
                return acc;
              },
              {}
            )
          : {};
      setLocks(lockMap);

      // Step 3 — join step_results onto module_tests
      const srByTestsName = (srRes.data ?? []).reduce((acc: any, sr: any) => {
        const key = sr.step?.tests_name;
        if (!key) return acc;
        if (!acc[key]) acc[key] = [];
        acc[key].push(sr);
        return acc;
      }, {});

      const joined = (mtRes.data ?? []).map((mt: any) => ({
        ...mt,
        step_results: srByTestsName[mt.tests_name] ?? [],
      }));

      setmodule_tests(joined as ModuleTestRow[]);
      setError(null);
      setLoading(false);
      setRefreshing(false);
    },
    [module_name]
  );

  // Initial load
  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  // ── Realtime — background refresh only, no spinner ────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`module-dashboard-${module_name}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "step_results" },
        () => fetchData(true)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "test_locks" },
        () => fetchData(true)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [module_name, fetchData]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const chartData = useMemo<ChartRow[]>(
    () =>
      module_tests.map((mt) => {
        const real = mt.step_results.filter((sr) => !sr.step?.is_divider);
        return {
          name: mt.test?.name ?? mt.tests_name,
          pass: real.filter((sr) => sr.status === "pass").length,
          fail: real.filter((sr) => sr.status === "fail").length,
          pending: real.filter((sr) => sr.status === "pending").length,
        };
      }),
    [module_tests]
  );

  const globalStats = useMemo(() => {
    const pass = chartData.reduce((a, x) => a + x.pass, 0);
    const fail = chartData.reduce((a, x) => a + x.fail, 0);
    const pending = chartData.reduce((a, x) => a + x.pending, 0);
    const total = pass + fail + pending;
    return {
      pass,
      fail,
      pending,
      total,
      passRate: total > 0 ? Math.round((pass / total) * 100) : 0,
    };
  }, [chartData]);

  // ── Build export data ─────────────────────────────────────────────────────
  const buildFlatData = (): FlatData[] =>
    module_tests.flatMap((mt) =>
      mt.step_results
        .filter((sr) => !sr.step?.is_divider)
        .map((sr) => ({
          module: module_name,
          test: mt.test?.name ?? mt.tests_name,
          serial: 0,
          action: "",
          expected: "",
          remarks: "",
          status: sr.status,
        }))
    );

  // ── Loading / error states ────────────────────────────────────────────────
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
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-500 text-sm">
            Failed to load module: {error}
          </div>
        </div>
      </div>
    );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title={module_name}
        subtitle={`${module_tests.length} test${
          module_tests.length !== 1 ? "s" : ""
        } · ${globalStats.total} steps${refreshing ? " · syncing…" : ""}`}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportModuleDetailCSV(buildFlatData())}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition"
            >
              <FileSpreadsheet size={13} />
              CSV
            </button>
            <button
              onClick={() => exportModuleDetailPDF(buildFlatData())}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition"
            >
              <FileText size={13} />
              PDF
            </button>
          </div>
        }
      />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
        {/* ── Global stat pills ── */}
        <div className="flex flex-wrap gap-2">
          {[
            {
              label: "Total",
              value: globalStats.total,
              cls: "bg-bg-card text-t-primary",
            },
            {
              label: "Pass",
              value: globalStats.pass,
              cls: "bg-green-500/10 text-green-400",
            },
            {
              label: "Fail",
              value: globalStats.fail,
              cls: "bg-red-500/10 text-red-400",
            },
            {
              label: "Pending",
              value: globalStats.pending,
              cls: "bg-amber-500/10 text-amber-400",
            },
            {
              label: "Pass %",
              value: `${globalStats.passRate}%`,
              cls: "bg-c-brand-bg text-c-brand",
            },
          ].map((s) => (
            <span
              key={s.label}
              className={`flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full border border-[var(--border-color)] ${s.cls}`}
            >
              {s.label}: {s.value}
            </span>
          ))}
        </div>

        {/* ── Chart ── */}
        {module_tests.length > 0 && (
          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-semibold text-t-primary">
                Step Results by Test
              </p>
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
            </div>
            <FadeWrapper animKey={chartType}>
              {chartType === "bar" && <RBarChart data={chartData} ct={ct} />}
              {chartType === "area" && <RAreaChart data={chartData} ct={ct} />}
              {chartType === "line" && <RLineChart data={chartData} ct={ct} />}
              {chartType === "pie" && <RPieChart data={chartData} ct={ct} />}
              {chartType === "radar" && (
                <RRadarChart data={chartData} ct={ct} />
              )}
            </FadeWrapper>
          </div>
        )}

        {/* ── Test list ── */}
        <div className="flex flex-col gap-3">
          {module_tests.length === 0 && (
            <div className="text-center text-t-muted py-12">
              No tests assigned to this module yet.
            </div>
          )}

          {module_tests.map((mt, idx) => {
            const real = mt.step_results.filter((sr) => !sr.step?.is_divider);
            const pass = real.filter((sr) => sr.status === "pass").length;
            const fail = real.filter((sr) => sr.status === "fail").length;
            const pending = real.filter((sr) => sr.status === "pending").length;
            const total = real.length;
            const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;
            const failPct = total > 0 ? Math.round((fail / total) * 100) : 0;

            const lock = locks[mt.id];

            // Compare against user_id (UUID) — matches test_locks.user_id
            const isMyLock = !!lock && lock.user_id === user?.id;
            const isOtherLock = !!lock && !isMyLock;

            // ── Per-card style ────────────────────────────────────────────
            const cardStyle: React.CSSProperties = isMyLock
              ? {
                  border: "1.5px solid rgba(34,211,238,0.55)",
                  background:
                    "linear-gradient(135deg, rgba(34,211,238,0.07) 0%, transparent 60%)",
                  animation: "neonPulse 2.6s ease-in-out infinite",
                }
              : {};

            const cardCls = [
              "card flex flex-col gap-3 relative transition-all duration-200",
              isOtherLock ? "opacity-40 grayscale-[0.35]" : "",
            ].join(" ");

            return (
              <StaggerRow key={mt.id} index={idx}>
                <div className={cardCls} style={cardStyle}>
                  {/* ── MY lock badge ───────────────────────────────────── */}
                  {isMyLock && (
                    <div
                      className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg w-fit
                      bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 text-xs font-semibold"
                    >
                      <Lock size={11} className="text-cyan-400" />
                      <span>Locked by me</span>
                      <span className="text-cyan-400/50">·</span>
                      <span className="text-cyan-400/70">
                        {new Date(lock.locked_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  )}

                  {/* ── OTHER lock badge ─────────────────────────────────── */}
                  {isOtherLock && (
                    <div
                      className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg w-fit
                      bg-amber-500/15 border border-amber-500/35 text-amber-400 text-xs font-semibold"
                    >
                      <Lock size={11} />
                      {/* locked_by_name holds the display name from your table */}
                      <span>In use by {lock.locked_by_name}</span>
                      <span className="text-amber-400/50">·</span>
                      <span className="text-amber-400/70">
                        {new Date(lock.locked_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  )}

                  {/* ── Header ──────────────────────────────────────────── */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span
                        className={`font-mono text-xs font-bold shrink-0 ${
                          isMyLock ? "text-cyan-400" : "text-c-brand"
                        }`}
                      >
                        {mt.test?.serial_no}
                      </span>
                      <h3 className="font-semibold text-t-primary text-sm truncate">
                        {mt.test?.name ?? mt.tests_name}
                      </h3>
                    </div>

                    {/* ── Buttons ─────────────────────────────────────────── */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onViewReport(mt.id)}
                        disabled={isOtherLock}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors
                          bg-bg-card hover:bg-bg-surface border border-[var(--border-color)]
                          text-t-secondary hover:text-t-primary
                          disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight size={12} />
                        Report
                      </button>

                      {isMyLock ? (
                        /* Resume — cyan neon, same style as execution UI */
                        <button
                          onClick={() => onExecute(mt.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                            bg-cyan-500 hover:bg-cyan-400 text-gray-950
                            shadow-[0_0_14px_3px_rgba(34,211,238,0.40)]
                            hover:shadow-[0_0_20px_5px_rgba(34,211,238,0.55)]"
                        >
                          <RotateCcw size={12} />
                          Resume
                        </button>
                      ) : (
                        /* Execute — normal brand */
                        <button
                          onClick={() => onExecute(mt.id)}
                          disabled={isOtherLock}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                            bg-c-brand hover:bg-c-brand-hover text-white
                            disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Play size={12} />
                          Execute
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Stats row ───────────────────────────────────────── */}
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span className="badge-pass">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1" />
                      {pass} Pass
                    </span>
                    <span className="badge-fail">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block mr-1" />
                      {fail} Fail
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-t-muted bg-bg-card border border-[var(--border-color)] rounded-full px-2.5 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] inline-block" />
                      {pending} Pending
                    </span>
                  </div>

                  {/* ── Progress bar ─────────────────────────────────────── */}
                  <div>
                    <div className="flex justify-between text-xs text-t-muted mb-1">
                      <span>Progress</span>
                      <span
                        className="font-semibold"
                        style={{
                          color:
                            passRate === 100
                              ? "#22c55e"
                              : failPct === 100
                              ? "#ef4444"
                              : undefined,
                        }}
                      >
                        {total > 0 ? `${passRate}%` : "—"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full overflow-hidden flex">
                      {passRate > 0 && (
                        <div
                          className="h-full bg-green-500 transition-all duration-700"
                          style={{ width: `${passRate}%` }}
                        />
                      )}
                      {failPct > 0 && (
                        <div
                          className="h-full bg-red-500 transition-all duration-700"
                          style={{ width: `${failPct}%` }}
                        />
                      )}
                      {100 - passRate - failPct > 0 && (
                        <div
                          className="h-full transition-all duration-700"
                          style={{
                            width: `${100 - passRate - failPct}%`,
                            backgroundColor: "var(--text-muted)",
                            opacity: 0.3,
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </StaggerRow>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ModuleDashboard;
