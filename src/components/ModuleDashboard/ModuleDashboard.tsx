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
@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
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

interface ChartRow   { name: string; pass: number; fail: number; pending: number; }
interface ChartTheme {
  panel: string; text: string; muted: string; grid: string;
  border: string; tooltipBg: string; tooltipText: string; tooltipName: string;
}

interface Props {
  moduleId: string;
  moduleName: string;
  onBack: () => void;
  onExecute: (testId: string) => void;
}

// ── Modal backdrop ────────────────────────────────────────────────────────────
const Backdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
  >
    <div style={{ animation: "slideUp 0.25s cubic-bezier(0.22,1,0.36,1) both" }}>
      {children}
    </div>
  </div>
);

// ── Request-to-finish modal (shown to the person clicking a locked test) ──────
const RequestModal: React.FC<{
  testName: string;
  lockedByName: string;
  sent: boolean;
  onSend: () => void;
  onClose: () => void;
}> = ({ testName, lockedByName, sent, onSend, onClose }) => (
  <Backdrop>
    <div className="w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
      style={{ backgroundColor: "#0f172a" }}>
      <div className="px-5 pt-5 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔒</span>
          <div>
            <p className="font-semibold text-white text-sm">Test In Progress</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{testName}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        {sent ? (
          <div className="flex flex-col items-center gap-3 text-center py-1">
            <span className="text-3xl">✅</span>
            <p className="text-sm font-semibold text-green-400">Request sent!</p>
            <p className="text-xs text-gray-400">
              <span className="text-white font-medium">{lockedByName}</span> has been notified to wrap up.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-300 leading-relaxed">
            <span className="text-amber-400 font-semibold">{lockedByName}</span> is currently executing this test.
            Send them a request to finish so you can proceed?
          </p>
        )}
      </div>

      <div className="px-5 pb-5 flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition"
        >
          {sent ? "Close" : "Cancel"}
        </button>
        {!sent && (
          <button
            onClick={onSend}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 transition"
          >
            📨 Send Request
          </button>
        )}
      </div>
    </div>
  </Backdrop>
);

// ── Incoming notification modal (shown to the lock holder) ────────────────────
const IncomingModal: React.FC<{
  testName: string;
  requesterName: string;
  onDismiss: () => void;
}> = ({ testName, requesterName, onDismiss }) => (
  <Backdrop>
    <div className="w-full max-w-sm rounded-2xl border border-amber-500/30 shadow-2xl overflow-hidden"
      style={{ backgroundColor: "#0f172a" }}>
      <div className="h-1 w-full bg-amber-500" />
      <div className="px-5 pt-5 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📨</span>
          <div>
            <p className="font-semibold text-amber-400 text-sm">Finish Request Received</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{testName}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        <p className="text-sm text-gray-300 leading-relaxed">
          <span className="text-white font-semibold">{requesterName}</span> is waiting to execute{" "}
          <span className="text-white font-semibold">"{testName}"</span>.
          Please finish and release the test when you're ready.
        </p>
      </div>

      <div className="px-5 pb-5 flex justify-end">
        <button
          onClick={onDismiss}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 transition"
        >
          Got it
        </button>
      </div>
    </div>
  </Backdrop>
);

// ── Chart components ──────────────────────────────────────────────────────────
const CustomTooltip: React.FC<{ active?: boolean; payload?: any[]; label?: string; ct: ChartTheme }> = ({ active, payload, label, ct }) => {
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

const PieTooltip: React.FC<{ active?: boolean; payload?: any[]; ct: ChartTheme }> = ({ active, payload, ct }) => {
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

const RBarChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={220}>
    <BarChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }} barCategoryGap="28%" barGap={3}>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.length > 10 ? v.slice(0, 9) + "…" : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
      <Legend iconType="square" iconSize={10} formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v}</span>} />
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
        {(["pass","fail","pending"] as const).map(k => (
          <linearGradient key={k} id={`md-rg-${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={COLORS[k]} stopOpacity={0.35} />
            <stop offset="95%" stopColor={COLORS[k]} stopOpacity={0.02} />
          </linearGradient>
        ))}
      </defs>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.length > 10 ? v.slice(0, 9) + "…" : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} />
      <Legend iconType="square" iconSize={10} formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v}</span>} />
      <Area type="monotone" dataKey="pending" stroke={COLORS.pending} fill="url(#md-rg-pending)" strokeWidth={2.5} dot={false} isAnimationActive />
      <Area type="monotone" dataKey="fail"    stroke={COLORS.fail}    fill="url(#md-rg-fail)"    strokeWidth={2.5} dot={false} isAnimationActive />
      <Area type="monotone" dataKey="pass"    stroke={COLORS.pass}    fill="url(#md-rg-pass)"    strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 1.5, fill: COLORS.pass }} isAnimationActive />
    </AreaChart>
  </ResponsiveContainer>
);

const RLineChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={220}>
    <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }}>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.length > 10 ? v.slice(0, 9) + "…" : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} />
      <Legend iconType="square" iconSize={10} formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v}</span>} />
      <Line type="monotone" dataKey="pass"    stroke={COLORS.pass}    strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive />
      <Line type="monotone" dataKey="fail"    stroke={COLORS.fail}    strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive />
      <Line type="monotone" dataKey="pending" stroke={COLORS.pending} strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive />
    </LineChart>
  </ResponsiveContainer>
);

const RPieChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  const totals = data.reduce(
    (acc, d) => ({ pass: acc.pass + d.pass, fail: acc.fail + d.fail, pending: acc.pending + d.pending }),
    { pass: 0, fail: 0, pending: 0 }
  );
  const total = totals.pass + totals.fail + totals.pending;
  const pieData = (["pass","fail","pending"] as const).map(k => ({ name: k, value: totals[k], ...totals })).filter(d => d.value > 0);
  if (total === 0) return <div className="flex items-center justify-center h-40"><span className="text-sm" style={{ color: ct.muted }}>No data</span></div>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={pieData} cx="50%" cy="50%" innerRadius="46%" outerRadius="72%" paddingAngle={3}
          dataKey="value" nameKey="name"
          label={(props: PieLabelRenderProps): string => `${props.name}: ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%`}
          labelLine={false} style={{ fontSize: 11 }} isAnimationActive>
          {pieData.map(e => <Cell key={e.name} fill={COLORS[e.name as keyof typeof COLORS]} opacity={0.88} />)}
        </Pie>
        <Tooltip content={<PieTooltip ct={ct} />} />
        <Legend iconType="circle" iconSize={10} formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v} · {totals[v as keyof typeof totals]}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
};

const RRadarChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  if (!data.length) return <div className="flex items-center justify-center h-40"><span className="text-sm" style={{ color: ct.muted }}>No data</span></div>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart cx="50%" cy="50%" outerRadius="72%" data={data}>
        <PolarGrid stroke={ct.grid} />
        <PolarAngleAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} tickFormatter={(v) => v.length > 10 ? v.slice(0, 9) + "…" : v} />
        <PolarRadiusAxis tick={{ fill: ct.muted, fontSize: 10 }} axisLine={false} />
        <Tooltip content={<CustomTooltip ct={ct} />} />
        <Legend iconType="square" iconSize={10} formatter={(v) => <span style={{ color: ct.muted, fontSize: 11, textTransform: "capitalize" }}>{v}</span>} />
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

  // ── Finish-request modal (shown to person clicking a locked test) ──────────
  const [requestTarget, setRequestTarget] = useState<{
    testId: string; testName: string; lockedByName: string; lockedByUserId: string;
  } | null>(null);
  const [requestSent, setRequestSent] = useState(false);

  // ── Incoming notification (shown to the lock holder) ─────────────────────
  const [incomingRequest, setIncomingRequest] = useState<{
    testName: string; requesterName: string;
  } | null>(null);

  // ── Tests + steps ─────────────────────────────────────────────────────────
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
        const { data: stepsData } = await supabase.from("steps").select("*").in("test_id", ids);
        setAllSteps(stepsData ?? []);
      }
      setLoading(false);
    };
    load();
  }, [moduleId]);

  // ── Locks + finish-request broadcast ─────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    supabase.from("testlocks").select("*")
      .then(({ data }) => setLocks(data ?? []));

    const channel = supabase.channel("module-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "testlocks" },
        () => { supabase.from("testlocks").select("*").then(({ data }) => setLocks(data ?? [])); })
      // Listen for finish requests directed at this user
      .on("broadcast", { event: "finish-request" }, ({ payload }) => {
        if (payload.targetUserId === user.id) {
          setIncomingRequest({ testName: payload.testName, requesterName: payload.requesterName });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // ── Chart theme ───────────────────────────────────────────────────────────
  const chartTheme: ChartTheme = theme === "dark"
    ? { panel: "#111827", text: "#e5e7eb", muted: "#94a3b8", grid: "#334155",
        border: "#334155", tooltipBg: "#0f172a", tooltipText: "#f8fafc", tooltipName: "#cbd5e1" }
    : { panel: "#ffffff", text: "#0f172a", muted: "#475569", grid: "#cbd5e1",
        border: "#cbd5e1", tooltipBg: "#ffffff", tooltipText: "#0f172a", tooltipName: "#475569" };

  const filteredTests = selectedTestId ? tests.filter(t => t.id === selectedTestId) : tests;

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

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleExecute = (testId: string) => {
    const lock = locks.find(l => l.test_id === testId);
    if (lock && lock.user_id !== user?.id) return;
    onExecute(testId);
  };

  const handleLockedClick = (testId: string, testName: string, lock: any) => {
    setRequestSent(false);
    setRequestTarget({
      testId,
      testName,
      lockedByName:   lock.locked_by_name ?? "Someone",
      lockedByUserId: lock.user_id,
    });
  };

  const handleSendRequest = async () => {
    if (!requestTarget || !user) return;
    await supabase.channel("module-dashboard").send({
      type:    "broadcast",
      event:   "finish-request",
      payload: {
        targetUserId:  requestTarget.lockedByUserId,
        testName:      requestTarget.testName,
        requesterName: user.user_metadata?.full_name ?? user.email ?? "Someone",
      },
    });
    setRequestSent(true);
  };

  const listAnimKey  = selectedTestId ?? "all";
  const chartAnimKey = `${selectedTestId ?? "all"}-${chartType}`;

  if (loading) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>;

  return (
    <div className="flex-1 flex flex-col">

      {/* ── Request-to-finish modal ── */}
      {requestTarget && (
        <RequestModal
          testName={requestTarget.testName}
          lockedByName={requestTarget.lockedByName}
          sent={requestSent}
          onSend={handleSendRequest}
          onClose={() => setRequestTarget(null)}
        />
      )}

      {/* ── Incoming finish-request notification ── */}
      {incomingRequest && (
        <IncomingModal
          testName={incomingRequest.testName}
          requesterName={incomingRequest.requesterName}
          onDismiss={() => setIncomingRequest(null)}
        />
      )}

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

        {/* ── Filter ── */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-400">Filter by Test</label>
          <select
            value={selectedTestId ?? ""}
            onChange={(e) => setSelectedTestId(e.target.value || null)}
            className="input text-sm"
          >
            <option value="">All Tests</option>
            {tests.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
                        onLockedClick={() => handleLockedClick(test.id, test.name, lock)}
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
  onLockedClick: () => void;
  isLockedByOther: boolean;
  isLockedByMe: boolean;
  lockedByName: string;
}> = ({ test, steps, onExecute, onLockedClick, isLockedByOther, isLockedByMe, lockedByName }) => {
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
      className={`card flex flex-col sm:flex-row sm:items-center gap-4 transition-all ${isLockedByOther ? "select-none" : ""}`}
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="flex-1">
        {/* Name + lock badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`font-medium text-white ${isLockedByOther ? "opacity-40" : ""}`}>{test.name}</p>
          {isLockedByOther && (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-500 bg-amber-500/15 border border-amber-500/40 rounded-full px-2.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
              🔒 {lockedByName} is executing
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

        {/* Progress bar */}
        <div className={`mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden ${isLockedByOther ? "opacity-40" : ""}`}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${rate}%`, backgroundColor: isLockedByOther ? "#6b7280" : "#22c55e" }} />
        </div>
      </div>

      {/* Button */}
      {isLockedByOther ? (
        <button
          onClick={onLockedClick}
          className="whitespace-nowrap shrink-0 px-4 py-2 rounded-xl font-semibold text-sm transition-all cursor-pointer
            text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 hover:border-amber-500/60"
        >
          🔒 Request to Finish
        </button>
      ) : (
        <button
          onClick={onExecute}
          className="whitespace-nowrap shrink-0 px-4 py-2 rounded-xl font-semibold text-sm transition-all btn-primary cursor-pointer"
        >
          {isLockedByMe ? "▶ Resume Test" : "Execute Tests"}
        </button>
      )}
    </div>
  );
};

export default ModuleDashboard;
