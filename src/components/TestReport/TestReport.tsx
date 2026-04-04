import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { exportReportCSV, exportReportPDF, FlatData } from "../../utils/export";
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

// ── Local joined types ────────────────────────────────────────────────────────
interface StepResultRow {
  id: string;
  status: "pass" | "fail" | "pending";
  remarks: string;
  step: {
    id: string;
    serial_no: number;
    action: string;
    expected_result: string;
    is_divider: boolean;
  };
}

interface ModuleTestRow {
  id: string;
  test: { id: string; serial_no: number; name: string };
  step_results: StepResultRow[];
}

interface ModuleRow {
  id: string;
  name: string;
  description: string;
  module_tests: ModuleTestRow[];
}

// FIX: lightweight type for dropdown — no step data needed
interface ModuleOption {
  id: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getNonDividerResults(moduleTests: ModuleTestRow[]): StepResultRow[] {
  return moduleTests.flatMap(mt =>
    (mt.step_results ?? []).filter(sr => !sr.step?.is_divider)
  );
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
  <ResponsiveContainer width="100%" height={240}>
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
  <ResponsiveContainer width="100%" height={240}>
    <AreaChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }}>
      <defs>
        {(["pass", "fail", "pending"] as const).map(k => (
          <linearGradient key={k} id={`rg-${k}`} x1="0" y1="0" x2="0" y2="1">
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
      <Area type="monotone" dataKey="pending" stroke={COLORS.pending} fill="url(#rg-pending)" strokeWidth={2.5} dot={false} isAnimationActive />
      <Area type="monotone" dataKey="fail"    stroke={COLORS.fail}    fill="url(#rg-fail)"    strokeWidth={2.5} dot={false} isAnimationActive />
      <Area type="monotone" dataKey="pass"    stroke={COLORS.pass}    fill="url(#rg-pass)"    strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 1.5, fill: COLORS.pass }} isAnimationActive />
    </AreaChart>
  </ResponsiveContainer>
);

const RLineChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={240}>
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
    <ResponsiveContainer width="100%" height={240}>
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
    <ResponsiveContainer width="100%" height={240}>
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
const TestReport: React.FC = () => {
  useInjectStyle();
  const { theme } = useTheme();

  // FIX: separate lightweight state for dropdown — avoids re-fetching full data
  // just to populate the filter select
  const [moduleOptions, setModuleOptions]       = useState<ModuleOption[]>([]);
  const [modules, setModules]                   = useState<ModuleRow[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal]   = useState(false);
  const [view, setView]                         = useState<"graph" | "table">("graph");
  const [chartType, setChartType]               = useState<ChartType>("bar");

  // FIX: fetch just id+name for the dropdown once — no joins needed
  useEffect(() => {
    supabase
      .from("modules")
      .select("id, name")
      .order("name")
      .then(({ data }) => setModuleOptions((data ?? []) as ModuleOption[]));
  }, []);

  // FIX: re-fetch when selectedModuleId changes and filter at DB level —
  // previously fetched everything once and filtered in JS, meaning all
  // module/step data was always loaded even when viewing a single module
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        let query = supabase
  .from("modules")
  .select(`
    id, name, description,
    module_tests!module_id (
      id,
      test_id,
      tests ( id, serial_no, name ),
      step_results!module_tests_id (
        id, status, remarks,
        step:steps ( id, serial_no, action, expected_result, is_divider )
      )
    )
  `)
          .order("name", { ascending: true });

        // FIX: apply filter at DB level instead of JS .filter()
        if (selectedModuleId) query = (query as any).eq("id", selectedModuleId);

        const { data, error: err } = await query;
        if (err) throw new Error(err.message);
        setModules((data ?? []) as unknown as ModuleRow[]);
      } catch (err: any) {
        setError(err.message ?? "Failed to load report data.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedModuleId]); // re-runs on filter change

  // FIX: `modules` is already DB-filtered — no JS filter needed
  const chartTheme: ChartTheme = theme === "dark"
    ? { panel: "#111827", text: "#e5e7eb", muted: "#94a3b8", grid: "#334155",
        border: "#334155", tooltipBg: "#0f172a", tooltipText: "#f8fafc", tooltipName: "#cbd5e1" }
    : { panel: "#ffffff", text: "#0f172a", muted: "#475569", grid: "#cbd5e1",
        border: "#cbd5e1", tooltipBg: "#ffffff", tooltipText: "#0f172a", tooltipName: "#475569" };

  const chartData = useMemo<ChartRow[]>(() =>
    modules.map(m => {
      const results = getNonDividerResults(m.module_tests ?? []);
      return {
        name:    m.name,
        pass:    results.filter(sr => sr.status === "pass").length,
        fail:    results.filter(sr => sr.status === "fail").length,
        pending: results.filter(sr => sr.status === "pending").length,
      };
    }), [modules]);

  const buildFlatData = (mods: ModuleRow[]): FlatData[] => {
    const flat: FlatData[] = [];
    mods.forEach(m => {
      (m.module_tests ?? []).forEach(mt => {
        (mt.step_results ?? [])
          .filter(sr => !sr.step?.is_divider)
          .forEach(sr => {
            flat.push({
              module:   m.name,
              test:     mt.test?.name ?? "",
              serial:   sr.step?.serial_no ?? 0,
              action:   sr.step?.action ?? "",
              expected: sr.step?.expected_result ?? "",
              remarks:  sr.remarks || "",
              status:   sr.status,
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
      { label: "Pass",        value: flat.filter(s => s.status === "pass").length },
      { label: "Fail",        value: flat.filter(s => s.status === "fail").length },
    ];
  };

  const chartAnimKey = `${selectedModuleId ?? "all"}-${chartType}`;
  const viewAnimKey  = view;

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
              text-sm font-semibold rounded-lg transition border border-[var(--border-color)]">
            📤 Export
          </button>
        }
      />

      <ExportModal
        isOpen={showExportModal} onClose={() => setShowExportModal(false)}
        title="Export Report"
        subtitle={selectedModuleId ? moduleOptions.find(m => m.id === selectedModuleId)?.name : "All Modules"}
        stats={exportStats()}
        options={[
          { label: "CSV", icon: "📥", color: "bg-green-600", hoverColor: "hover:bg-green-700",
            onConfirm: () => exportReportCSV([], buildFlatData(modules)) },
          { label: "PDF", icon: "📋", color: "bg-red-600", hoverColor: "hover:bg-red-700",
            onConfirm: () => exportReportPDF([], buildFlatData(modules)) },
        ]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner /></div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-2xl">⚠️</span>
          <p className="text-sm text-red-400 font-medium">{error}</p>
          <button onClick={() => setSelectedModuleId(prev => prev)}
            className="px-4 py-2 rounded-xl bg-bg-card hover:bg-bg-surface text-sm
              text-t-secondary border border-[var(--border-color)] transition">
            Retry
          </button>
        </div>
      ) : (
        <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">

          {/* ── Filter + View toggle ── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-t-muted">Filter by Trainset</label>
              <select
                value={selectedModuleId ?? ""}
                onChange={e => setSelectedModuleId(e.target.value || null)}
                className="input text-sm">
                <option value="">All Modules</option>
                {/* FIX: uses lightweight moduleOptions instead of full modules */}
                {moduleOptions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-xl p-1 bg-bg-card border border-[var(--border-color)] w-fit">
              {(["graph", "table"] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition capitalize ${
                    view === v ? "bg-c-brand text-white" : "text-t-muted hover:text-t-primary"
                  }`}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* ── View panel ── */}
          <FadeWrapper animKey={viewAnimKey}>
            {view === "graph" ? (
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
                        style={chartType === type
                          ? { backgroundColor: "#1d4ed8", color: "#ffffff" }
                          : { color: chartTheme.muted }}
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

            ) : (
              /* ── Table view ── */
              <div className="overflow-x-auto rounded-xl border border-[var(--border-color)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-card text-t-muted uppercase text-xs">
                      <th className="px-4 py-3 text-left">Trainset</th>
                      <th className="px-4 py-3 text-center">Tests</th>
                      <th className="px-4 py-3 text-center">Total Steps</th>
                      <th className="px-4 py-3 text-center text-green-600 dark:text-green-400">Pass</th>
                      <th className="px-4 py-3 text-center text-red-600 dark:text-red-400">Fail</th>
                      <th className="px-4 py-3 text-center text-amber-600 dark:text-amber-400">Pending</th>
                      <th className="px-4 py-3 text-center">Pass Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {modules.map(m => {
                      const results = getNonDividerResults(m.module_tests ?? []);
                      const total   = results.length;
                      const pass    = results.filter(sr => sr.status === "pass").length;
                      const fail    = results.filter(sr => sr.status === "fail").length;
                      const pending = results.filter(sr => sr.status === "pending").length;
                      const rate    = total > 0 ? Math.round((pass / total) * 100) : 0;
                      return (
                        <tr key={m.id} className="hover:bg-bg-card transition-colors">
                          <td className="px-4 py-3 font-semibold text-t-primary">{m.name}</td>
                          <td className="px-4 py-3 text-center text-t-secondary">{m.module_tests?.length ?? 0}</td>
                          <td className="px-4 py-3 text-center font-bold text-t-primary">{total}</td>
                          <td className="px-4 py-3 text-center font-semibold text-green-600 dark:text-green-400">{pass}</td>
                          <td className="px-4 py-3 text-center font-semibold text-red-600 dark:text-red-400">{fail}</td>
                          <td className="px-4 py-3 text-center font-semibold text-amber-600 dark:text-amber-400">{pending}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center gap-2 justify-center">
                              <div className="w-20 h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
                                <div className="h-full rounded-full"
                                  style={{ width: `${rate}%`, backgroundColor: COLORS.pass }} />
                              </div>
                              <span className="font-bold text-t-primary">{rate}%</span>
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
      )}
    </>
  );
};

export default TestReport;