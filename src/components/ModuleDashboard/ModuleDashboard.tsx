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
import ExportModal from "../UI/ExportModal";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import {
  Lock,
  Unlock,
  Play,
  FileSpreadsheet,
  FileText,
  ChevronRight,
  RotateCcw,
  Upload,
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

const ANIM_STYLE = `
@keyframes fadeSlideIn    { from{opacity:0;transform:translateY(10px)}  to{opacity:1;transform:translateY(0)} }
@keyframes fadeSlideInRow { from{opacity:0;transform:translateX(-6px)}  to{opacity:1;transform:translateX(0)} }
@keyframes fadeScaleIn    { from{opacity:0;transform:scale(.95) translateY(-4px)} to{opacity:1;transform:scale(1) translateY(0)} }
@keyframes neonPulse      { 0%,100%{box-shadow:0 0 0 0 rgba(var(--neon-cyan),0.0),0 0 12px 2px rgba(var(--neon-cyan),0.18)} 50%{box-shadow:0 0 0 0 rgba(var(--neon-cyan),0.0),0 0 22px 6px rgba(var(--neon-cyan),0.32)} }
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

// ── Strip all leading %, , and whitespace from divider labels ─────────────
const cleanDividerLabel = (action: string): string =>
  action.replace(/^[^a-zA-Z0-9]+/, "");

type ChartType = "bar" | "area" | "line" | "pie" | "radar";
const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "bar", label: "Bar" },
  { type: "area", label: "Area" },
  { type: "line", label: "Line" },
  { type: "pie", label: "Pie" },
  { type: "radar", label: "Radar" },
];

interface Props {
  module_name: string;
  onBack: () => void;
  onExecute: (module_test_id: string) => void;
  onViewReport: (module_test_id: string) => void;
}

interface LockRow {
  module_test_id: string;
  user_id: string;
  locked_by_name: string;
  locked_at: string;
}

interface TrimmedStepResult {
  id: string;
  status: "pass" | "fail" | "pending";
  step: {
    id: string;
    is_divider: boolean;
    tests_name: string;
    serial_no: number | null;
    action: string | null;
    expected_result: string | null;
  } | null;
}

interface ModuleTestRow {
  id: string;
  tests_name: string;
  test: { serial_no: string; name: string };
  step_results: TrimmedStepResult[];
}

const ModuleDashboard: React.FC<Props> = ({
  module_name,
  onBack,
  onExecute,
  onViewReport,
}) => {
  useInjectStyle();

  const { user } = useAuth();
  const { theme } = useTheme();
  const isAdmin = user?.role === "admin";

  const [module_tests, setmodule_tests] = useState<ModuleTestRow[]>([]);
  const [locks, setLocks] = useState<Record<string, LockRow>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [showExportModal, setShowExportModal] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  const fetchData = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setLoading(true);
      else setRefreshing(true);

      const [mtRes, srRes] = await Promise.all([
        supabase
          .from("module_tests")
          .select(
            "id, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name)"
          )
          .eq("module_name", module_name),
        supabase
          .from("step_results")
          .select(
            "id, status, test_steps_id, step:test_steps!step_results_test_steps_id_fkey(id, is_divider, tests_name, serial_no, action, expected_result)"
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

      const moduleTestIds = (mtRes.data ?? []).map((mt: any) => mt.id);
      const lockRes =
        moduleTestIds.length > 0
          ? await supabase
              .from("test_locks")
              .select("module_test_id, user_id, locked_by_name, locked_at")
              .in("module_test_id", moduleTestIds)
          : { data: [], error: null };

      if (!mountedRef.current) return;

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

      const srByTestsName = (srRes.data ?? []).reduce((acc: any, sr: any) => {
        const key = sr.step?.tests_name;
        if (!key) return acc;
        if (!acc[key]) acc[key] = [];
        acc[key].push(sr);
        return acc;
      }, {});

      // ── Sort by original test serial_no, not alphabetically ─────────────────
      const joined = (mtRes.data ?? [])
        .map((mt: any) => ({
          ...mt,
          step_results: srByTestsName[mt.tests_name] ?? [],
        }))
        .sort(
          (a: any, b: any) =>
            (a.test?.serial_no ?? 0) - (b.test?.serial_no ?? 0)
        );

      setmodule_tests(joined as ModuleTestRow[]);
      setError(null);
      setLoading(false);
      setRefreshing(false);
    },
    [module_name]
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const forceReleaseLock = useCallback(
    async (module_test_id: string, lockedByName: string) => {
      if (!confirm(`Force-release the lock held by ${lockedByName}?`)) return;
      const { error } = await supabase
        .from("test_locks")
        .delete()
        .eq("module_test_id", module_test_id);
      if (error) alert(`Failed to release lock: ${error.message}`);
      else fetchData(true);
    },
    [fetchData]
  );

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

  // ── Build export data — sorted + divider labels cleaned ──────────────────
  const buildFlatData = (): FlatData[] =>
    module_tests.flatMap((mt) =>
      mt.step_results
        .slice()
        .sort((a, b) => {
          const sa = a.step?.serial_no ?? 0;
          const sb = b.step?.serial_no ?? 0;
          if (sa !== sb) return sa - sb;
          return (a.step?.is_divider ? 0 : 1) - (b.step?.is_divider ? 0 : 1);
        })
        .map((sr) => ({
          module: module_name,
          test: mt.test?.name ?? mt.tests_name,
          test_serial_no: mt.test?.serial_no ?? "",
          serial: sr.step?.serial_no ?? 0,
          action: cleanDividerLabel(sr.step?.action ?? ""),
          expected: sr.step?.expected_result ?? "",
          remarks: "",
          status: sr.status,
          isdivider: sr.step?.is_divider ?? false,
        }))
    );

  // ── Export stats for modal ────────────────────────────────────────────────
  const exportStats = useMemo(() => {
    const flat = buildFlatData();
    const nd = flat.filter((d) => !d.isdivider);
    return [
      { label: "Total Steps", value: nd.length },
      { label: "Pass", value: nd.filter((d) => d.status === "pass").length },
      { label: "Fail", value: nd.filter((d) => d.status === "fail").length },
    ];
  }, [module_tests]);

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
              background:
                "color-mix(in srgb, var(--color-fail) 10%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--color-fail) 30%, transparent)",
              color: "var(--color-fail)",
            }}
          >
            Failed to load module: {error}
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex-1 flex flex-col">
      {/* ── Export Modal — uniform theme-aware buttons ─────────────────────── */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Module Results"
        subtitle={module_name}
        stats={exportStats}
        options={[
          {
            label: "CSV",
            icon: <FileSpreadsheet size={16} />,
            color:
              "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor:
              "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm: () => exportModuleDetailCSV(buildFlatData()),
          },
          {
            label: "PDF",
            icon: <FileText size={16} />,
            color:
              "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor:
              "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm: () =>
              exportModuleDetailPDF(buildFlatData(), module_name),
          },
        ]}
      />

      <Topbar
        title={module_name}
        subtitle={`${module_tests.length} test${
          module_tests.length !== 1 ? "s" : ""
        } · ${globalStats.total} steps${refreshing ? " · syncing…" : ""}`}
        onBack={onBack}
        actions={
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition"
          >
            <Upload size={13} />
            Export
          </button>
        }
      />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
        <div className="flex flex-wrap gap-2">
          {[
            {
              label: "Total",
              value: globalStats.total,
              style: {
                background: "var(--bg-card)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
              } as React.CSSProperties,
            },
            {
              label: "Pass",
              value: globalStats.pass,
              style: {
                background:
                  "color-mix(in srgb, var(--color-pass) 10%, transparent)",
                color: "var(--color-pass)",
                border:
                  "1px solid color-mix(in srgb, var(--color-pass) 25%, transparent)",
              } as React.CSSProperties,
            },
            {
              label: "Fail",
              value: globalStats.fail,
              style: {
                background:
                  "color-mix(in srgb, var(--color-fail) 10%, transparent)",
                color: "var(--color-fail)",
                border:
                  "1px solid color-mix(in srgb, var(--color-fail) 25%, transparent)",
              } as React.CSSProperties,
            },
            {
              label: "Pending",
              value: globalStats.pending,
              style: {
                background:
                  "color-mix(in srgb, var(--color-pend) 10%, transparent)",
                color: "var(--color-pend)",
                border:
                  "1px solid color-mix(in srgb, var(--color-pend) 25%, transparent)",
              } as React.CSSProperties,
            },
            {
              label: "Pass %",
              value: `${globalStats.passRate}%`,
              style: {
                background: "var(--color-brand-bg)",
                color: "var(--color-brand)",
                border:
                  "1px solid color-mix(in srgb, var(--color-brand) 25%, transparent)",
              } as React.CSSProperties,
            },
          ].map((s) => (
            <span
              key={s.label}
              className="flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full"
              style={s.style}
            >
              {s.label}: {s.value}
            </span>
          ))}
        </div>

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
            const isMyLock = !!lock && lock.user_id === user?.id;
            const isOtherLock = !!lock && !isMyLock;

            const cardStyle: React.CSSProperties = isMyLock
              ? {
                  border: "1.5px solid rgba(var(--neon-cyan), 0.55)",
                  background:
                    "linear-gradient(135deg, rgba(var(--neon-cyan), 0.07) 0%, transparent 60%)",
                  animation: "neonPulse 2.6s ease-in-out infinite",
                }
              : {};

            return (
              <StaggerRow key={mt.id} index={idx}>
                <div
                  className={[
                    "card flex flex-col gap-3 relative transition-all duration-200",
                    isOtherLock ? "opacity-40 grayscale-[0.35]" : "",
                  ].join(" ")}
                  style={cardStyle}
                >
                  {isMyLock && (
                    <div
                      className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg w-fit text-xs font-semibold"
                      style={{
                        color: "var(--color-my-lock)",
                        borderColor:
                          "color-mix(in srgb, var(--color-my-lock) 40%, transparent)",
                        background:
                          "color-mix(in srgb, var(--color-my-lock) 10%, transparent)",
                        border: "1px solid",
                      }}
                    >
                      <Lock
                        size={11}
                        style={{ color: "var(--color-my-lock)" }}
                      />
                      <span>Locked by me</span>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span style={{ opacity: 0.7 }}>
                        {new Date(lock.locked_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  )}

                  {isOtherLock && (
                    <div
                      className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg w-fit text-xs font-semibold"
                      style={{
                        color: "var(--color-other-lock)",
                        borderColor:
                          "color-mix(in srgb, var(--color-other-lock) 40%, transparent)",
                        background:
                          "color-mix(in srgb, var(--color-other-lock) 10%, transparent)",
                        border: "1px solid",
                      }}
                    >
                      <Lock size={11} />
                      <span>In use by {lock.locked_by_name}</span>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span style={{ opacity: 0.7 }}>
                        {new Date(lock.locked_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {isAdmin && (
                        <>
                          <span style={{ opacity: 0.65 }} className="mx-0.5">
                            |
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              forceReleaseLock(mt.id, lock.locked_by_name);
                            }}
                            className="flex items-center gap-1 text-[11px] font-bold rounded-md px-1.5 py-0.5 transition-colors"
                            style={{
                              color: "var(--color-fail)",
                              background:
                                "color-mix(in srgb, var(--color-fail) 10%, transparent)",
                              border:
                                "1px solid color-mix(in srgb, var(--color-fail) 30%, transparent)",
                            }}
                          >
                            <Unlock size={10} />
                            Release
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span
                        className="font-mono text-xs font-bold shrink-0"
                        style={{
                          color: isMyLock
                            ? "var(--color-my-lock)"
                            : "var(--color-brand)",
                        }}
                      >
                        {mt.test?.serial_no}
                      </span>
                      <h3 className="font-semibold text-t-primary text-sm truncate">
                        {mt.test?.name ?? mt.tests_name}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onViewReport(mt.id)}
                        disabled={isOtherLock}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-secondary hover:text-t-primary disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight size={12} />
                        Report
                      </button>

                      {isMyLock ? (
                        <button
                          onClick={() => onExecute(mt.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                          style={{
                            background: "var(--color-my-lock)",
                            color: "#000",
                            boxShadow:
                              "0 0 14px 3px rgba(var(--neon-cyan), 0.40)",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow =
                              "0 0 20px 5px rgba(var(--neon-cyan), 0.55)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow =
                              "0 0 14px 3px rgba(var(--neon-cyan), 0.40)";
                          }}
                        >
                          <RotateCcw size={12} />
                          Resume
                        </button>
                      ) : (
                        <button
                          onClick={() => onExecute(mt.id)}
                          disabled={isOtherLock}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-c-brand hover:bg-c-brand-hover text-(--bg-surface) disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Play size={12} />
                          Execute
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span className="badge-pass">
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block mr-1"
                        style={{ background: "var(--color-pass)" }}
                      />
                      {pass} Pass
                    </span>
                    <span className="badge-fail">
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block mr-1"
                        style={{ background: "var(--color-fail)" }}
                      />
                      {fail} Fail
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-t-muted bg-bg-card border border-(--border-color) rounded-full px-2.5 py-0.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block"
                        style={{ background: "var(--text-muted)" }}
                      />
                      {pending} Pending
                    </span>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-t-muted mb-1">
                      <span>Progress</span>
                      <span
                        className="font-semibold"
                        style={{
                          color:
                            passRate === 100
                              ? "var(--color-pass)"
                              : failPct === 100
                              ? "var(--color-fail)"
                              : undefined,
                        }}
                      >
                        {total > 0 ? `${passRate}%` : "—"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full overflow-hidden flex">
                      {passRate > 0 && (
                        <div
                          className="h-full transition-all duration-700"
                          style={{
                            width: `${passRate}%`,
                            background: "var(--color-pass)",
                          }}
                        />
                      )}
                      {failPct > 0 && (
                        <div
                          className="h-full transition-all duration-700"
                          style={{
                            width: `${failPct}%`,
                            background: "var(--color-fail)",
                          }}
                        />
                      )}
                      {100 - passRate - failPct > 0 && (
                        <div
                          className="h-full transition-all duration-700"
                          style={{
                            width: `${100 - passRate - failPct}%`,
                            background: "var(--color-pend)",
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
