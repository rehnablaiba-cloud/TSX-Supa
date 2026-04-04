import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { supabase } from "../../supabase";
import Spinner from "../UI/Spinner";
import Topbar from "../Layout/Topbar";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useToast } from "../../context/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  LineChart, Line,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

// ── Animation keyframes ───────────────────────────────────────────────────────
const ANIM_STYLE = `
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0);    }
}
@keyframes fadeSlideInRow {
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0);    }
}
`;

function useInjectStyle() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = ANIM_STYLE;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);
}

const FadeWrapper: React.FC<{ animKey: string | number; children: React.ReactNode }> = ({ animKey, children }) => (
  <div key={animKey} style={{ animation: "fadeSlideIn 0.28s cubic-bezier(0.22,1,0.36,1) both" }}>
    {children}
  </div>
);

const StaggerRow: React.FC<{ index: number; children: React.ReactNode }> = ({ index, children }) => (
  <div style={{
    animation: "fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both",
    animationDelay: `${index * 45}ms`,
  }}>
    {children}
  </div>
);

// ── Constants ─────────────────────────────────────────────────────────────────
const COLORS = { pass: "#22c55e", fail: "#ef4444", pending: "#f59e0b" };

type ChartType = "bar" | "area" | "line" | "pie" | "radar";
const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "bar",   label: "Bar"   },
  { type: "area",  label: "Area"  },
  { type: "line",  label: "Line"  },
  { type: "pie",   label: "Pie"   },
  { type: "radar", label: "Radar" },
];

interface ChartRow { name: string; pass: number; fail: number; pending: number; }
interface ChartTheme {
  panel: string; text: string; muted: string; grid: string;
  border: string; tooltipBg: string; tooltipText: string; tooltipName: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  moduleName: string;
  onBack: () => void;
  onExecute: (moduleTestId: string) => void;
}

// step_results for a module (all of them; matched to module_tests in JS)
interface TrimmedStepResult {
  id: string;
  status: "pass" | "fail" | "pending";
  step: { id: string; is_divider: boolean; tests_name: string } | null;
}

interface ModuleTestRow {
  id: string;
  tests_name: string;
  test: { serial_no: number; name: string; description?: string };
  // populated in JS by matching step.tests_name
  step_results: TrimmedStepResult[];
}

// ── Tooltips ──────────────────────────────────────────────────────────────────
const CustomTooltip: React.FC<{
  active?: boolean; payload?: any[]; label?: string; ct: ChartTheme;
}> = ({ active, payload, label, ct }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl border shadow-xl text-xs"
      style={{ backgroundColor: ct.tooltipBg, borderColor: ct.border, color: ct.tooltipText }}>
      <div className="font-semibold mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: ct.tooltipName }} className="capitalize">{p.dataKey}</span>
          <span style={{ color: p.fill || p.stroke, fontWeight: 700 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
};

const PieTooltip: React.FC<{
  active?: boolean; payload?: any[]; ct: ChartTheme;
}> = ({ active, payload, ct }) => {
  if (!active || !payload?.length) return null;
  const { name, value, payload: inner } = payload[0];
  const total = (inner?.pass ?? 0) + (inner?.fail ?? 0) + (inner?.pending ?? 0);
  return (
    <div className="px-3 py-2 rounded-xl border shadow-xl text-xs"
      style={{ backgroundColor: ct.tooltipBg, borderColor: ct.border, color: ct.tooltipText }}>
      <div className="font-semibold capitalize mb-1">{name}</div>
      <div style={{ color: COLORS[name as keyof typeof COLORS], fontWeight: 700 }}>
        {value} ({total > 0 ? Math.round((value / total) * 100) : 0}%)
      </div>
    </div>
  );
};

// ── Chart sub-components ──────────────────────────────────────────────────────
const RBarChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={220}>
    <BarChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }} barCategoryGap="28%" barGap={3}>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false}
        tickFormatter={(v) => v.length > 10 ? v.slice(0, 9) + "…" : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
      <Legend iconType="square" iconSize={10}
        formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v}</span>} />
      <Bar dataKey="pass"    fill={COLORS.pass}    radius={[3,3,0,0]} maxBarSize={18} isAnimationActive />
      <Bar dataKey="fail"    fill={COLORS.fail}    radius={[3,3,0,0]} maxBarSize={18} isAnimationActive />
      <Bar dataKey="pending" fill={COLORS.pending} radius={[3,3,0,0]} maxBarSize={18} isAnimationActive />
    </BarChart>
  </ResponsiveContainer>
);

const RAreaChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={220}>
    <AreaChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }}>
      <defs>
        {(["pass", "fail", "pending"] as const).map(k => (
          <linearGradient key={k} id={`md-rg-${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={COLORS[k]} stopOpacity={0.35} />
            <stop offset="95%" stopColor={COLORS[k]} stopOpacity={0.02} />
          </linearGradient>
        ))}
      </defs>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false}
        tickFormatter={(v) => v.length > 10 ? v.slice(0, 9) + "…" : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} />
      <Legend iconType="square" iconSize={10}
        formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v}</span>} />
      <Area type="monotone" dataKey="pending" stroke={COLORS.pending} fill="url(#md-rg-pending)" strokeWidth={2.5} dot={false} isAnimationActive />
      <Area type="monotone" dataKey="fail"    stroke={COLORS.fail}    fill="url(#md-rg-fail)"    strokeWidth={2.5} dot={false} isAnimationActive />
      <Area type="monotone" dataKey="pass"    stroke={COLORS.pass}    fill="url(#md-rg-pass)"    strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 1.5, fill: COLORS.pass }} isAnimationActive />
    </AreaChart>
  </ResponsiveContainer>
);

const RLineChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={220}>
    <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }}>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false}
        tickFormatter={(v) => v.length > 10 ? v.slice(0, 9) + "…" : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} />
      <Legend iconType="square" iconSize={10}
        formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v}</span>} />
      <Line type="monotone" dataKey="pass"    stroke={COLORS.pass}    strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive />
      <Line type="monotone" dataKey="fail"    stroke={COLORS.fail}    strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive />
      <Line type="monotone" dataKey="pending" stroke={COLORS.pending} strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive />
    </LineChart>
  </ResponsiveContainer>
);

const RPieChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  const totals = data.reduce(
    (acc, d) => ({ pass: acc.pass + d.pass, fail: acc.fail + d.fail, pending: acc.pending + d.pending }),
    { pass: 0, fail: 0, pending: 0 }
  );
  const total = totals.pass + totals.fail + totals.pending;
  const pieData = (["pass", "fail", "pending"] as const)
    .map(k => ({ name: k, value: totals[k], ...totals }))
    .filter(d => d.value > 0);

  if (total === 0) return (
    <div className="flex items-center justify-center h-40">
      <span className="text-sm" style={{ color: ct.muted }}>No data to display</span>
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={pieData} cx="50%" cy="50%" innerRadius="46%" outerRadius="72%"
          paddingAngle={3} dataKey="value" nameKey="name" isAnimationActive>
          {pieData.map((entry) => (
            <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS]} opacity={0.88} />
          ))}
        </Pie>
        <Tooltip content={<PieTooltip ct={ct} />} />
        <Legend iconType="circle" iconSize={10}
          formatter={(v) => (
            <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>
              {v} · {totals[v as keyof typeof totals]}
            </span>
          )} />
      </PieChart>
    </ResponsiveContainer>
  );
};

const RRadarChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  if (data.length === 0) return (
    <div className="flex items-center justify-center h-40">
      <span className="text-sm" style={{ color: ct.muted }}>No data to display</span>
    </div>
  );
  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart cx="50%" cy="50%" outerRadius="72%" data={data}>
        <PolarGrid stroke={ct.grid} />
        <PolarAngleAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }}
          tickFormatter={(v) => v.length > 10 ? v.slice(0, 9) + "…" : v} />
        <PolarRadiusAxis tick={{ fill: ct.muted, fontSize: 10 }} axisLine={false} />
        <Tooltip content={<CustomTooltip ct={ct} />} />
        <Legend iconType="square" iconSize={10}
          formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v}</span>} />
        <Radar name="pass"    dataKey="pass"    stroke={COLORS.pass}    fill={COLORS.pass}    fillOpacity={0.18} strokeWidth={2} isAnimationActive />
        <Radar name="fail"    dataKey="fail"    stroke={COLORS.fail}    fill={COLORS.fail}    fillOpacity={0.18} strokeWidth={2} isAnimationActive />
        <Radar name="pending" dataKey="pending" stroke={COLORS.pending} fill={COLORS.pending} fillOpacity={0.18} strokeWidth={2} isAnimationActive />
      </RadarChart>
    </ResponsiveContainer>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const ModuleDashboard: React.FC<Props> = ({ moduleName, onBack, onExecute }) => {
  useInjectStyle();
  const { user }     = useAuth();
  const isAdmin      = user?.role === "admin";
  const { addToast } = useToast();
  const { log }      = useAuditLog();
  const { theme }    = useTheme();

  const [moduleTests, setModuleTests]   = useState<ModuleTestRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [locks, setLocks]               = useState<any[]>([]);
  const [selectedMtId, setSelectedMtId] = useState<string | null>(null);
  const [chartType, setChartType]       = useState<ChartType>("bar");

  const lockRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeq = useRef(0);

  const refetchLocks = useCallback(() => {
    if (lockRefetchTimer.current) clearTimeout(lockRefetchTimer.current);
    lockRefetchTimer.current = setTimeout(() => {
      const seq = ++fetchSeq.current;
      supabase
        .from("test_locks")
        .select("module_test_id, user_id, locked_by_name")
        .then(({ data }) => {
          if (seq === fetchSeq.current) setLocks(data ?? []);
        });
    }, 300);
  }, []);

  // ── Load: fetch module_tests + step_results in parallel ──────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      const [mtRes, srRes, locksRes] = await Promise.all([
        // module_tests with test info; ordered by test serial_no in JS
        supabase
          .from("module_tests")
          .select("id, tests_name, test:tests!tests_name(serial_no, name, description)")
          .eq("module_name", moduleName),
        // step_results for the whole module; match to test via step.tests_name
        supabase
          .from("step_results")
          .select("id, status, step:test_steps!test_steps_id(id, is_divider, tests_name)")
          .eq("module_name", moduleName),
        supabase
          .from("test_locks")
          .select("module_test_id, user_id, locked_by_name"),
      ]);

      if (cancelled) return;

      if (mtRes.error) { setError(mtRes.error.message); setLoading(false); return; }
      if (srRes.error) { setError(srRes.error.message); setLoading(false); return; }

      const allStepResults: TrimmedStepResult[] = (srRes.data ?? []) as any[];

      // Build merged ModuleTestRow[] — attach step_results per test by tests_name match
      const merged: ModuleTestRow[] = ((mtRes.data ?? []) as any[])
        .map(mt => ({
          id: mt.id,
          tests_name: mt.tests_name,
          test: mt.test,
          step_results: allStepResults.filter(
            sr => sr.step?.tests_name === mt.tests_name
          ),
        }))
        .sort((a, b) => (a.test?.serial_no ?? 0) - (b.test?.serial_no ?? 0));

      setModuleTests(merged);
      setLocks(locksRes.data ?? []);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [moduleName]);

  // ── Locks — real-time ──────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const channel = supabase.channel("all-locks")
      .on("postgres_changes", { event: "*", schema: "public", table: "test_locks" }, () => {
        if (mounted) refetchLocks();
      })
      .subscribe();
    return () => {
      mounted = false;
      if (lockRefetchTimer.current) clearTimeout(lockRefetchTimer.current);
      supabase.removeChannel(channel);
    };
  }, [refetchLocks]);

  // ── Chart theme ────────────────────────────────────────────────────────────
  const chartTheme: ChartTheme = theme === "dark"
    ? { panel: "#111827", text: "#e5e7eb", muted: "#94a3b8", grid: "#334155",
        border: "#334155", tooltipBg: "#0f172a", tooltipText: "#f8fafc", tooltipName: "#cbd5e1" }
    : { panel: "#ffffff", text: "#0f172a", muted: "#475569", grid: "#cbd5e1",
        border: "#cbd5e1", tooltipBg: "#ffffff", tooltipText: "#0f172a", tooltipName: "#475569" };

  const filteredMts = useMemo(() =>
    selectedMtId ? moduleTests.filter(mt => mt.id === selectedMtId) : moduleTests,
    [moduleTests, selectedMtId]
  );

  const chartData = useMemo<ChartRow[]>(() =>
    filteredMts.map(mt => {
      const results = (mt.step_results ?? []).filter(sr => !sr.step?.is_divider);
      return {
        name:    mt.test?.name ?? "",
        pass:    results.filter(sr => sr.status === "pass").length,
        fail:    results.filter(sr => sr.status === "fail").length,
        pending: results.filter(sr => sr.status === "pending").length,
      };
    }), [filteredMts]);

  // Scope locks to this module's module_tests only
  const moduleTestIdSet = useMemo(() => new Set(moduleTests.map(mt => mt.id)), [moduleTests]);
  const scopedLocks     = useMemo(() => locks.filter(l => moduleTestIdSet.has(l.module_test_id)), [locks, moduleTestIdSet]);

  const handleExecute = (mtId: string) => {
    const lock = scopedLocks.find(l => l.module_test_id === mtId);
    if (lock && user && lock.user_id !== user.id) return;
    onExecute(mtId);
  };

  const handleForceRelease = async (mtId: string, lockedByName: string) => {
    const { error } = await supabase
      .from("test_locks")
      .delete()
      .eq("module_test_id", mtId);

    if (error) {
      addToast("Failed to release lock: " + error.message, "error");
    } else {
      log(`Force-released lock held by ${lockedByName}`, "warn");
      addToast(`Lock held by ${lockedByName} released`, "success");
    }
  };

  const listAnimKey  = selectedMtId ?? "all";
  const chartAnimKey = `${selectedMtId ?? "all"}-${chartType}`;

  if (loading) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>;

  if (error) return (
    <div className="flex-1 flex flex-col">
      <Topbar title={moduleName} subtitle="Error" onBack={onBack} />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-sm font-semibold text-red-500 mb-1">Failed to load module data</p>
          <p className="text-xs text-t-muted">{error}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col">
      <Topbar title={moduleName} subtitle={`${moduleTests.length} tests`} onBack={onBack} />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">

        {/* ── Chart panel ── */}
        <div className="p-4 rounded-xl border"
          style={{ backgroundColor: chartTheme.panel, borderColor: chartTheme.border }}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold" style={{ color: chartTheme.text }}>Execution Graph</h3>
            <div className="flex items-center gap-0.5 rounded-lg p-0.5 border"
              style={{
                backgroundColor: theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                borderColor: chartTheme.border,
              }}>
              {CHART_TYPES.map(({ type, label }) => (
                <button key={type} onClick={() => setChartType(type)}
                  style={chartType === type ? { backgroundColor: "#1d4ed8", color: "#ffffff" } : { color: chartTheme.muted }}
                  className="px-2.5 py-1 rounded-md text-xs font-medium transition-all">
                  {label}
                </button>
              ))}
            </div>
          </div>

          <FadeWrapper animKey={chartAnimKey}>
            {(() => {
              switch (chartType) {
                case "bar":   return <RBarChart   data={chartData} ct={chartTheme} />;
                case "area":  return <RAreaChart  data={chartData} ct={chartTheme} />;
                case "line":  return <RLineChart  data={chartData} ct={chartTheme} />;
                case "pie":   return <RPieChart   data={chartData} ct={chartTheme} />;
                case "radar": return <RRadarChart data={chartData} ct={chartTheme} />;
              }
            })()}
          </FadeWrapper>
        </div>

        {/* ── Filter ── */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-t-muted">Filter by Test</label>
          <select
            value={selectedMtId ?? ""}
            onChange={(e) => setSelectedMtId(e.target.value || null)}
            className="input text-sm"
          >
            <option value="">All Tests</option>
            {moduleTests.map((mt) => (
              <option key={mt.id} value={mt.id}>
                {mt.test?.serial_no} — {mt.test?.name}
              </option>
            ))}
          </select>
        </div>

        {/* ── Test list ── */}
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-t-secondary mb-2">Test Cases</h3>

          <FadeWrapper animKey={listAnimKey}>
            <div className="flex flex-col gap-3">
              {filteredMts.length === 0 ? (
                <p className="text-sm text-t-muted">No tests found.</p>
              ) : (
                filteredMts.map((mt, index) => {
                  const lock            = scopedLocks.find(l => l.module_test_id === mt.id);
                  const isLockedByOther = !!(lock && user && lock.user_id !== user.id);
                  const isLockedByMe    = !!(lock && user && lock.user_id === user.id);
                  const results = (mt.step_results ?? []).filter(sr => !sr.step?.is_divider);
                  return (
                    <StaggerRow key={mt.id} index={index}>
                      <TestRow
                        testName={mt.test?.name ?? ""}
                        testSerialNo={mt.test?.serial_no ?? 0}
                        results={results}
                        onExecute={() => handleExecute(mt.id)}
                        isLockedByOther={isLockedByOther}
                        isLockedByMe={isLockedByMe}
                        lockedByName={lock?.locked_by_name ?? ""}
                        isAdmin={isAdmin}
                        onForceRelease={() => handleForceRelease(mt.id, lock?.locked_by_name ?? "unknown")}
                      />
                    </StaggerRow>
                  );
                })
              )}
            </div>
          </FadeWrapper>
        </div>
      </div>
    </div>
  );
};

// ── Test Row ──────────────────────────────────────────────────────────────────
const TestRow: React.FC<{
  testName: string;
  testSerialNo: number;
  results: TrimmedStepResult[];
  onExecute: () => void;
  isLockedByOther: boolean;
  isLockedByMe: boolean;
  lockedByName: string;
  isAdmin: boolean;
  onForceRelease: () => void;
}> = ({ testName, testSerialNo, results, onExecute, isLockedByOther, isLockedByMe, lockedByName, isAdmin, onForceRelease }) => {
  const passed  = results.filter(r => r.status === "pass").length;
  const failed  = results.filter(r => r.status === "fail").length;
  const pending = results.filter(r => r.status === "pending").length;
  const total   = results.length || 1;
  const rate    = Math.round((passed / total) * 100);

  const borderColor = isLockedByOther
    ? "#6b7280"
    : rate > 70 ? "#22c55e" : rate > 30 ? "#f59e0b" : "#ef4444";

  return (
    <div
      className={`card flex flex-col sm:flex-row sm:items-center gap-4 transition-all ${
        isLockedByOther ? "select-none" : ""
      }`}
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-t-muted">#{testSerialNo}</span>
          <p className={`font-medium text-t-primary ${isLockedByOther ? "opacity-40" : ""}`}>
            {testName}
          </p>
          {isLockedByOther && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-500 bg-amber-500/15 border border-amber-500/40 rounded-full px-2.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
              🔒 {lockedByName} is executing.
              {isAdmin ? (
                <button
                  onClick={e => { e.stopPropagation(); onForceRelease(); }}
                  className="ml-1 underline underline-offset-2 hover:text-red-500 transition-colors"
                  title="Force-release this lock (admin only)"
                >
                  Force release
                </button>
              ) : (
                <span className="font-normal opacity-80">Contact user to finish.</span>
              )}
            </span>
          )}
          {isLockedByMe && (
            <span className="flex items-center gap-1 text-xs font-semibold text-c-brand bg-c-brand-bg border border-[var(--color-brand)] rounded-full px-2.5 py-0.5 opacity-70">
              <span className="w-1.5 h-1.5 rounded-full bg-c-brand animate-pulse inline-block" />
              ✏️ You are executing
            </span>
          )}
        </div>

        <div className="flex gap-2 mt-1.5 flex-wrap">
          <span className="badge-pass">{passed} Pass</span>
          <span className="badge-fail">{failed} Fail</span>
          <span className="badge-pend">{pending} Pend</span>
        </div>

        <div className={`mt-2 h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden ${isLockedByOther ? "opacity-40" : ""}`}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${rate}%`, backgroundColor: isLockedByOther ? "#6b7280" : "#22c55e" }}
          />
        </div>
      </div>

      <button
        onClick={(e) => {
          if (isLockedByOther) { e.preventDefault(); e.stopPropagation(); return; }
          onExecute();
        }}
        disabled={isLockedByOther}
        className={`whitespace-nowrap shrink-0 px-4 py-2 rounded-xl font-semibold transition-all text-sm ${
          isLockedByOther
            ? "bg-bg-card text-t-muted cursor-not-allowed pointer-events-none border border-[var(--border-color)]"
            : "btn-primary cursor-pointer"
        }`}
      >
        {isLockedByOther ? "🔒 Locked" : isLockedByMe ? "▶ Resume Test" : "Execute Tests"}
      </button>
    </div>
  );
};

export default ModuleDashboard;