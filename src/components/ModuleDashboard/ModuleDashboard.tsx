import React, { useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "../../supabase";
import Spinner from "../UI/Spinner";
import Topbar from "../Layout/Topbar";
import { Step, Test } from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  LineChart, Line,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { PieLabelRenderProps } from "recharts";

// ── Animation keyframes (injected once into <head>) ───────────────────────────
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
  const injected = useRef(false);
  useEffect(() => {
    if (injected.current) return;
    injected.current = true;
    const el = document.createElement("style");
    el.textContent = ANIM_STYLE;
    document.head.appendChild(el);
  }, []);
}

// ── FadeWrapper ───────────────────────────────────────────────────────────────
const FadeWrapper: React.FC<{ animKey: string | number; children: React.ReactNode }> = ({ animKey, children }) => (
  <div key={animKey} style={{ animation: "fadeSlideIn 0.28s cubic-bezier(0.22,1,0.36,1) both" }}>
    {children}
  </div>
);

// ── StaggerRow ────────────────────────────────────────────────────────────────
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

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  moduleId: string;
  moduleName: string;
  onBack: () => void;
  onExecute: (testId: string) => void;
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────
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

// ── Custom Pie Tooltip ────────────────────────────────────────────────────────
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

// ── Chart components ──────────────────────────────────────────────────────────
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
          paddingAngle={3} dataKey="value" nameKey="name"
          label={(props: PieLabelRenderProps): string => {
            const name = props.name ?? "";
            const percent = ((props.percent as number) ?? 0) * 100;
            return `${name}: ${percent.toFixed(0)}%`;
          }}
          labelLine={false} style={{ fontSize: 11 }} isAnimationActive>
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
const ModuleDashboard: React.FC<Props> = ({ moduleId, moduleName, onBack, onExecute }) => {
  useInjectStyle();
  const { user } = useAuth();
  const { theme } = useTheme();

  const [tests, setTests]                   = useState<Test[]>([]);
  const [allSteps, setAllSteps]             = useState<(Step & { test_id: string })[]>([]);
  const [loading, setLoading]               = useState(true);
  const [locks, setLocks]                   = useState<any[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [chartType, setChartType]           = useState<ChartType>("bar");

  // ── Tests + steps in one go ────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: testsData } = await supabase
        .from("tests").select("*")
        .eq("module_id", moduleId).order("order_index");

      const fetchedTests = testsData ?? [];
      setTests(fetchedTests);

      if (fetchedTests.length > 0) {
        const ids = fetchedTests.map((t: Test) => t.id);
        const { data: stepsData } = await supabase
          .from("steps").select("*")
          .in("test_id", ids);
        setAllSteps(stepsData ?? []);
      }

      setLoading(false);
    };
    load();
  }, [moduleId]);

  // ── Locks — initial fetch + real-time subscription ────────────────────────
  useEffect(() => {
    supabase.from("testlocks").select("*")
      .then(({ data }) => setLocks(data ?? []));

    const channel = supabase.channel("all-locks")
      .on("postgres_changes", { event: "*", schema: "public", table: "testlocks" },
        () => { supabase.from("testlocks").select("*").then(({ data }) => setLocks(data ?? [])); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Chart theme ────────────────────────────────────────────────────────────
  const chartTheme: ChartTheme = theme === "dark"
    ? { panel: "#111827", text: "#e5e7eb", muted: "#94a3b8", grid: "#334155",
        border: "#334155", tooltipBg: "#0f172a", tooltipText: "#f8fafc", tooltipName: "#cbd5e1" }
    : { panel: "#ffffff", text: "#0f172a", muted: "#475569", grid: "#cbd5e1",
        border: "#cbd5e1", tooltipBg: "#ffffff", tooltipText: "#0f172a", tooltipName: "#475569" };

  const filteredTests = selectedTestId ? tests.filter(t => t.id === selectedTestId) : tests;

  // ── Chart data: one bar per test (respects filter) ────────────────────────
  const chartData = useMemo<ChartRow[]>(() =>
    filteredTests.map(t => {
      const steps = allSteps.filter(s => s.test_id === t.id && !s.is_divider);
      return {
        name:    t.name,
        pass:    steps.filter(s => s.status === "pass").length,
        fail:    steps.filter(s => s.status === "fail").length,
        pending: steps.filter(s => s.status === "pending").length,
      };
    }), [filteredTests, allSteps]);

  // ── Execute guard ──────────────────────────────────────────────────────────
  const handleExecute = (testId: string) => {
    const lock = locks.find(l => l.test_id === testId);
    if (lock && lock.user_id !== user?.id) return;
    onExecute(testId);
  };
  const listAnimKey   = selectedTestId ?? "all";
  const chartAnimKey  = `${selectedTestId ?? "all"}-${chartType}`;

  if (loading) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>;

  return (
    <div className="flex-1 flex flex-col">
      <Topbar title={moduleName} subtitle={`${tests.length} tests`} onBack={onBack} />

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

        {/* ── Toolbar: filter only ── */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-400">Filter by Test</label>
          <select
            value={selectedTestId ?? ""}
            onChange={(e) => setSelectedTestId(e.target.value || null)}
            className="input text-sm"
          >
            <option value="">All Tests</option>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* ── Test list ── */}
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-300 mb-2">Test Cases</h3>

          <FadeWrapper animKey={listAnimKey}>
            <div className="flex flex-col gap-3">
              {filteredTests.length === 0 ? (
                <p className="text-sm text-gray-500">No tests found.</p>
              ) : (
                filteredTests.map((test, index) => {
                  const lock            = locks.find(l => l.test_id === test.id);
                  const isLockedByOther = !!(lock && lock.user_id !== user?.id);
                  const isLockedByMe    = !!(lock && lock.user_id === user?.id);
                  const steps           = allSteps.filter(s => s.test_id === test.id && !s.is_divider);
                  return (
                    <StaggerRow key={test.id} index={index}>
                      <TestRow
                        test={test}
                        steps={steps}
                        onExecute={() => handleExecute(test.id)}
                        isLockedByOther={isLockedByOther}
                        isLockedByMe={isLockedByMe}
                        lockedByName={lock?.locked_by_name ?? ""}
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
  test: Test;
  steps: Step[];
  onExecute: () => void;
  isLockedByOther: boolean;
  isLockedByMe: boolean;
  lockedByName: string;
}> = ({ test, steps, onExecute, isLockedByOther, isLockedByMe, lockedByName }) => {
  const passed  = steps.filter(s => s.status === "pass").length;
  const failed  = steps.filter(s => s.status === "fail").length;
  const pending = steps.filter(s => s.status === "pending").length;
  const total   = steps.length || 1;
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
        {/* Name + lock badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Test name dimmed when locked */}
          <p className={`font-medium text-white ${isLockedByOther ? "opacity-40" : ""}`}>
            {test.name}
          </p>
          {isLockedByOther && (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-500 bg-amber-500/15 border border-amber-500/40 rounded-full px-2.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
              🔒 {lockedByName} is executing. Ask them to Finish.
            </span>
          )}
          {isLockedByMe && (
            <span className="flex items-center gap-1 text-xs font-semibold text-blue-500 bg-blue-500/15 border border-blue-500/40 rounded-full px-2.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
              ✏️ You are executing
            </span>
          )}
        </div>

        {/* Status badges — always full opacity */}
        <div className="flex gap-2 mt-1.5 flex-wrap">
          <span className="badge-pass">{passed} Pass</span>
          <span className="badge-fail">{failed} Fail</span>
          <span className="badge-pend">{pending} Pend</span>
        </div>

        {/* Progress bar — dimmed when locked */}
        <div className={`mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden ${isLockedByOther ? "opacity-40" : ""}`}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${rate}%`, backgroundColor: isLockedByOther ? "#6b7280" : "#22c55e" }}
          />
        </div>
      </div>

      {/* Execute button */}
      <button
        onClick={(e) => {
          if (isLockedByOther) { e.preventDefault(); e.stopPropagation(); return; }
          onExecute();
        }}
        disabled={isLockedByOther}
        className={`whitespace-nowrap shrink-0 px-4 py-2 rounded-xl font-semibold transition-all text-sm ${
          isLockedByOther
            ? "bg-gray-500/20 text-gray-500 cursor-not-allowed pointer-events-none border border-gray-500/30"
            : "btn-primary cursor-pointer"
        }`}
      >
        {isLockedByOther ? "🔒 Locked" : isLockedByMe ? "▶ Resume Test" : "Execute Tests"}
      </button>
    </div>
  );
};

export default ModuleDashboard;
