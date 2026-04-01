import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { exportReportCSV, exportReportPDF, FlatData } from "../../utils/export";
import { useTheme } from "../../context/ThemeContext";

const COLORS = { pass: "#22c55e", fail: "#ef4444", pending: "#f59e0b" };

// ── Types ──────────────────────────────────────────────────────────────────────
interface Step {
  serial_no: number; action: string; expected_result: string;
  remarks: string; status: string; is_divider: boolean;
}
interface Test { id: string; name: string; steps: Step[]; }
interface ModuleWithTests {
  id: string; name: string; description: string; accent_color: string; tests: Test[];
}
interface ChartRow { name: string; pass: number; fail: number; pending: number; }
interface ChartTheme {
  panel: string; text: string; muted: string; grid: string;
  border: string; tooltipBg: string; tooltipText: string; tooltipName: string;
}
type ChartType = "bar" | "area" | "line" | "pie" | "radar";

const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "bar",   label: "Bar"   },
  { type: "area",  label: "Area"  },
  { type: "line",  label: "Line"  },
  { type: "pie",   label: "Pie"   },
  { type: "radar", label: "Radar" },
];

// ── SVG layout constants ───────────────────────────────────────────────────────
const W = 560; const H = 220;
const PAD = { top: 14, right: 16, bottom: 44, left: 38 };
const CW = W - PAD.left - PAD.right;
const CH = H - PAD.top - PAD.bottom;

function yScale(val: number, maxVal: number) {
  return PAD.top + CH - (val / maxVal) * CH;
}
function makeYTicks(maxVal: number) {
  return Array.from({ length: 5 }, (_, i) => ({
    y: PAD.top + (i / 4) * CH,
    val: Math.round(maxVal * (1 - i / 4)),
  }));
}
function shortName(name: string) {
  return name.length > 10 ? name.slice(0, 9) + "…" : name;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
const SVGTooltip: React.FC<{ tip: { x: number; y: number; row: ChartRow }; ct: ChartTheme }> = ({ tip, ct }) => (
  <div className="fixed z-50 pointer-events-none px-3 py-2 rounded-xl border shadow-xl text-xs"
    style={{ left: tip.x + 12, top: tip.y - 44,
      backgroundColor: ct.tooltipBg, borderColor: ct.border, color: ct.tooltipText }}>
    <div className="font-semibold mb-1">{tip.row.name}</div>
    {(["pass", "fail", "pending"] as const).map(k => (
      <div key={k} className="flex items-center justify-between gap-4">
        <span style={{ color: ct.tooltipName }} className="capitalize">{k}</span>
        <span style={{ color: COLORS[k], fontWeight: 700 }}>{tip.row[k]}</span>
      </div>
    ))}
  </div>
);

// ── Empty state ───────────────────────────────────────────────────────────────
const EmptyChart: React.FC<{ ct: ChartTheme }> = ({ ct }) => (
  <div className="flex items-center justify-center h-40">
    <span style={{ color: ct.muted }} className="text-sm">No data to display</span>
  </div>
);

// ── Legend ────────────────────────────────────────────────────────────────────
const ChartLegend: React.FC<{ ct: ChartTheme }> = ({ ct }) => (
  <div className="flex items-center gap-5 mb-3">
    {(["pass", "fail", "pending"] as const).map(k => (
      <div key={k} className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: COLORS[k] }} />
        <span className="text-xs capitalize" style={{ color: ct.muted }}>{k}</span>
      </div>
    ))}
  </div>
);

// ── Bar Chart ─────────────────────────────────────────────────────────────────
const BarChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  const [tip, setTip] = useState<{ x: number; y: number; row: ChartRow } | null>(null);
  const maxVal = Math.max(...data.flatMap(d => [d.pass, d.fail, d.pending]), 1);
  const groupW = data.length > 0 ? CW / data.length : CW;
  const bw = Math.min(13, groupW / 4.5);
  const keys: (keyof typeof COLORS)[] = ["pass", "fail", "pending"];

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {makeYTicks(maxVal).map(({ y, val }) => (
          <g key={y}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={ct.grid} strokeWidth={0.5} strokeDasharray="4 3" />
            <text x={PAD.left - 5} y={y + 4} textAnchor="end" fontSize={9} fill={ct.muted}>{val}</text>
          </g>
        ))}
        {data.map((row, i) => {
          const cx = PAD.left + i * groupW + groupW / 2;
          return (
            <g key={i} onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, row })} style={{ cursor: "default" }}>
              {keys.map((k, ki) => {
                const x = cx - (1.5 * bw + bw * 0.4) + ki * (bw + bw * 0.4);
                const bh = Math.max((row[k] / maxVal) * CH, 0);
                return <rect key={k} x={x} y={PAD.top + CH - bh} width={bw} height={bh} rx={2} fill={COLORS[k]} opacity={0.85} />;
              })}
              <text x={cx} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill={ct.muted}>{shortName(row.name)}</text>
            </g>
          );
        })}
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + CH} stroke={ct.grid} strokeWidth={1} />
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + CH} y2={PAD.top + CH} stroke={ct.grid} strokeWidth={1} />
      </svg>
      {tip && <SVGTooltip tip={tip} ct={ct} />}
    </div>
  );
};

// ── Area Chart ────────────────────────────────────────────────────────────────
const AreaChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  const [tip, setTip] = useState<{ x: number; y: number; row: ChartRow } | null>(null);
  const maxVal = Math.max(...data.flatMap(d => [d.pass, d.fail, d.pending]), 1);
  const keys: (keyof typeof COLORS)[] = ["pending", "fail", "pass"];
  if (data.length === 0) return <EmptyChart ct={ct} />;

  const xAt = (i: number) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * CW : CW / 2);
  const areaPath = (key: keyof ChartRow) => {
    const pts = data.map((d, i) => `${xAt(i)},${yScale(d[key] as number, maxVal)}`).join(" L");
    return `M${pts} L${xAt(data.length - 1)},${PAD.top + CH} L${xAt(0)},${PAD.top + CH} Z`;
  };
  const linePath = (key: keyof ChartRow) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yScale(d[key] as number, maxVal)}`).join(" ");

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          {keys.map(k => (
            <linearGradient key={k} id={`ag-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={COLORS[k]} stopOpacity={0.4} />
              <stop offset="100%" stopColor={COLORS[k]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {makeYTicks(maxVal).map(({ y, val }) => (
          <g key={y}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={ct.grid} strokeWidth={0.5} strokeDasharray="4 3" />
            <text x={PAD.left - 5} y={y + 4} textAnchor="end" fontSize={9} fill={ct.muted}>{val}</text>
          </g>
        ))}
        {keys.map(k => (
          <g key={k}>
            <path d={areaPath(k)} fill={`url(#ag-${k})`} />
            <path d={linePath(k)} fill="none" stroke={COLORS[k]} strokeWidth={2.5} strokeLinejoin="round" />
          </g>
        ))}
        {data.map((row, i) => (
          <g key={i} onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, row })} style={{ cursor: "default" }}>
            <circle cx={xAt(i)} cy={yScale(row.pass, maxVal)} r={4} fill={COLORS.pass} />
            <text x={xAt(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill={ct.muted}>{shortName(row.name)}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + CH} stroke={ct.grid} strokeWidth={1} />
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + CH} y2={PAD.top + CH} stroke={ct.grid} strokeWidth={1} />
      </svg>
      {tip && <SVGTooltip tip={tip} ct={ct} />}
    </div>
  );
};

// ── Line Chart ────────────────────────────────────────────────────────────────
const LineChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  const [tip, setTip] = useState<{ x: number; y: number; row: ChartRow } | null>(null);
  const maxVal = Math.max(...data.flatMap(d => [d.pass, d.fail, d.pending]), 1);
  const keys: (keyof typeof COLORS)[] = ["pass", "fail", "pending"];
  if (data.length === 0) return <EmptyChart ct={ct} />;

  const xAt = (i: number) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * CW : CW / 2);
  const linePath = (key: keyof ChartRow) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yScale(d[key] as number, maxVal)}`).join(" ");

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {makeYTicks(maxVal).map(({ y, val }) => (
          <g key={y}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={ct.grid} strokeWidth={0.5} strokeDasharray="4 3" />
            <text x={PAD.left - 5} y={y + 4} textAnchor="end" fontSize={9} fill={ct.muted}>{val}</text>
          </g>
        ))}
        {keys.map(k => (
          <path key={k} d={linePath(k)} fill="none" stroke={COLORS[k]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {data.map((row, i) => (
          <g key={i} onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, row })} style={{ cursor: "default" }}>
            {keys.map(k => (
              <circle key={k} cx={xAt(i)} cy={yScale(row[k] as number, maxVal)} r={3.5}
                fill={COLORS[k]} stroke={ct.panel} strokeWidth={1.5} />
            ))}
            <text x={xAt(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill={ct.muted}>{shortName(row.name)}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + CH} stroke={ct.grid} strokeWidth={1} />
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + CH} y2={PAD.top + CH} stroke={ct.grid} strokeWidth={1} />
      </svg>
      {tip && <SVGTooltip tip={tip} ct={ct} />}
    </div>
  );
};

// ── Pie Chart ─────────────────────────────────────────────────────────────────
const PieChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  const totals = data.reduce(
    (acc, d) => ({ pass: acc.pass + d.pass, fail: acc.fail + d.fail, pending: acc.pending + d.pending }),
    { pass: 0, fail: 0, pending: 0 }
  );
  const total = totals.pass + totals.fail + totals.pending;
  const slices = (["pass", "fail", "pending"] as const).map(k => ({ key: k, val: totals[k] }));
  const cx = W / 2; const cy = H / 2 + 4;
  const r = Math.min(CH, CW) / 2 - 6; const ir = r * 0.52;

  if (total === 0) return <EmptyChart ct={ct} />;

  const arc = (a0: number, a1: number) => {
    const cos0 = Math.cos(a0); const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1); const sin1 = Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return [
      `M${cx + ir * cos0},${cy + ir * sin0}`,
      `L${cx + r * cos0},${cy + r * sin0}`,
      `A${r},${r} 0 ${large} 1 ${cx + r * cos1},${cy + r * sin1}`,
      `L${cx + ir * cos1},${cy + ir * sin1}`,
      `A${ir},${ir} 0 ${large} 0 ${cx + ir * cos0},${cy + ir * sin0} Z`,
    ].join(" ");
  };

  let angle = -Math.PI / 2;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {slices.map(({ key, val }) => {
          if (val === 0) return null;
          const sweep = (val / total) * 2 * Math.PI;
          const mid = angle + sweep / 2;
          const d = arc(angle, angle + sweep);
          const lx = cx + (r + 16) * Math.cos(mid);
          const ly = cy + (r + 16) * Math.sin(mid);
          angle += sweep;
          return (
            <g key={key}>
              <path d={d} fill={COLORS[key]} opacity={0.88} />
              {sweep > 0.35 && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fill={ct.muted} fontWeight={600}>
                  {Math.round((val / total) * 100)}%
                </text>
              )}
            </g>
          );
        })}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize={20} fontWeight={700} fill={ct.text}>{total}</text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize={9} fill={ct.muted}>total steps</text>
      </svg>
      <div className="flex justify-center gap-6 -mt-1">
        {slices.map(({ key, val }) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: COLORS[key] }} />
            <span className="text-xs capitalize" style={{ color: ct.muted }}>{key} · {val}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Radar Chart ───────────────────────────────────────────────────────────────
const RadarChart: React.FC<{ data: ChartRow[]; ct: ChartTheme }> = ({ data, ct }) => {
  const cx = W / 2; const cy = H / 2 + 4;
  const r = Math.min(CH, CW) / 2 - 12;
  const keys: (keyof typeof COLORS)[] = ["pass", "fail", "pending"];
  const n = data.length;
  if (n === 0) return <EmptyChart ct={ct} />;

  const maxVal = Math.max(...data.flatMap(d => [d.pass, d.fail, d.pending]), 1);
  const ang = (i: number) => (2 * Math.PI * i) / n - Math.PI / 2;
  const pt = (i: number, val: number) => ({
    x: cx + (val / maxVal) * r * Math.cos(ang(i)),
    y: cy + (val / maxVal) * r * Math.sin(ang(i)),
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0.25, 0.5, 0.75, 1].map(frac => (
        <polygon key={frac}
          points={data.map((_, i) => `${cx + frac * r * Math.cos(ang(i))},${cy + frac * r * Math.sin(ang(i))}`).join(" ")}
          fill="none" stroke={ct.grid} strokeWidth={0.7} />
      ))}
      {data.map((_, i) => (
        <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(ang(i))} y2={cy + r * Math.sin(ang(i))}
          stroke={ct.grid} strokeWidth={0.7} />
      ))}
      {keys.map(k => (
        <polygon key={k}
          points={data.map((row, i) => { const p = pt(i, row[k] as number); return `${p.x},${p.y}`; }).join(" ")}
          fill={COLORS[k]} fillOpacity={0.18} stroke={COLORS[k]} strokeWidth={2} />
      ))}
      {data.map((row, i) => {
        const lx = cx + (r + 18) * Math.cos(ang(i));
        const ly = cy + (r + 18) * Math.sin(ang(i));
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill={ct.muted}>
            {shortName(row.name)}
          </text>
        );
      })}
    </svg>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const TestReport: React.FC = () => {
  const { theme } = useTheme();
  const [modules, setModules]                   = useState<ModuleWithTests[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal]   = useState(false);
  const [view, setView]                         = useState<"graph" | "table">("graph");
  const [chartType, setChartType]               = useState<ChartType>("bar");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: modulesData, error: modulesError } = await supabase
          .from("modules")
          .select("id, name, description, accent_color")
          .order("name", { ascending: true });

        if (modulesError) throw new Error(modulesError.message);

        const modulesWithTests = await Promise.all(
          (modulesData ?? []).map(async (mod) => {
            const { data: testsData, error: testsError } = await supabase
              .from("tests")
              .select("id, name, steps(serial_no, action, expected_result, remarks, status, is_divider)")
              .eq("module_id", mod.id)
              .order("name", { ascending: true });

            if (testsError) throw new Error(`Failed to load tests for "${mod.name}": ${testsError.message}`);
            return { ...mod, tests: (testsData ?? []) as Test[] };
          })
        );

        setModules(modulesWithTests);
      } catch (err: any) {
        console.error("TestReport fetch error:", err);
        setError(err.message ?? "Failed to load report data.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = selectedModuleId
    ? modules.filter((m) => m.id === selectedModuleId)
    : modules;

  const chartTheme: ChartTheme = theme === "dark"
    ? { panel: "#111827", text: "#e5e7eb", muted: "#94a3b8", grid: "#334155",
        border: "#334155", tooltipBg: "#0f172a", tooltipText: "#f8fafc", tooltipName: "#cbd5e1" }
    : { panel: "#ffffff", text: "#0f172a", muted: "#475569", grid: "#cbd5e1",
        border: "#cbd5e1", tooltipBg: "#ffffff", tooltipText: "#0f172a", tooltipName: "#475569" };

  const chartData = useMemo(() => filtered.map((m) => {
    const allSteps = (m.tests ?? []).flatMap((t) => (t.steps ?? []).filter((s) => !s.is_divider));
    return {
      name:    m.name,
      pass:    allSteps.filter((s) => s.status === "pass").length,
      fail:    allSteps.filter((s) => s.status === "fail").length,
      pending: allSteps.filter((s) => s.status === "pending").length,
    };
  }), [filtered]);

  const buildFlatData = (mods: ModuleWithTests[]): FlatData[] => {
    const flat: FlatData[] = [];
    mods.forEach((m) => {
      (m.tests ?? []).forEach((t) => {
        (t.steps ?? []).filter((s) => !s.is_divider).forEach((s) => {
          flat.push({ module: m.name, test: t.name, serial: s.serial_no,
            action: s.action, expected: s.expected_result, remarks: s.remarks || "", status: s.status });
        });
      });
    });
    return flat;
  };

  const exportStats = () => {
    const flat = buildFlatData(filtered);
    return [
      { label: "Total Steps", value: flat.length },
      { label: "Pass",        value: flat.filter((s) => s.status === "pass").length },
      { label: "Fail",        value: flat.filter((s) => s.status === "fail").length },
    ];
  };

  const renderChart = () => {
    switch (chartType) {
      case "bar":   return <BarChart   data={chartData} ct={chartTheme} />;
      case "area":  return <AreaChart  data={chartData} ct={chartTheme} />;
      case "line":  return <LineChart  data={chartData} ct={chartTheme} />;
      case "pie":   return <PieChart   data={chartData} ct={chartTheme} />;
      case "radar": return <RadarChart data={chartData} ct={chartTheme} />;
    }
  };

  return (
    <>
      <Topbar
        title="Test Report"
        subtitle="Module-wise execution summary"
        actions={
          <button onClick={() => setShowExportModal(true)} disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition border border-white/10">
            📤 Export
          </button>
        }
      />

      <ExportModal
        isOpen={showExportModal} onClose={() => setShowExportModal(false)}
        title="Export Report"
        subtitle={selectedModuleId ? modules.find((m) => m.id === selectedModuleId)?.name : "All Modules"}
        stats={exportStats()}
        options={[
          { label: "CSV", icon: "📥", color: "bg-green-600", hoverColor: "hover:bg-green-700",
            onConfirm: () => exportReportCSV([], buildFlatData(filtered)) },
          { label: "PDF", icon: "📋", color: "bg-red-600", hoverColor: "hover:bg-red-700",
            onConfirm: () => exportReportPDF([], buildFlatData(filtered)) },
        ]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner /></div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-2xl">⚠️</span>
          <p className="text-sm text-red-400 font-medium">{error}</p>
          <button onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm text-gray-300 border border-white/10 transition">
            Retry
          </button>
        </div>
      ) : (
        <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">

          {/* ── Filter + Graph/Table toggle ── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-400">Filter by Module</label>
              <select value={selectedModuleId ?? ""} onChange={(e) => setSelectedModuleId(e.target.value || null)}
                className="input text-sm">
                <option value="">All Modules</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-xl p-1 bg-white/5 border border-white/10 w-fit">
              {(["graph", "table"] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  style={view === v ? { color: "#ffffff" } : undefined}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition capitalize ${
                    view === v ? "bg-blue-700" : "text-gray-400 hover:text-gray-700 dark:hover:text-white"}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* ── Graph view ── */}
          {view === "graph" ? (
            <div className="p-4 rounded-xl border"
              style={{ backgroundColor: chartTheme.panel, borderColor: chartTheme.border }}>

              {/* Title + chart type switcher */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-semibold" style={{ color: chartTheme.text }}>
                  Execution Graph
                </h3>
                <div className="flex items-center gap-0.5 rounded-lg p-0.5 border"
                  style={{ backgroundColor: theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                    borderColor: chartTheme.border }}>
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

              {chartType !== "pie" && <ChartLegend ct={chartTheme} />}
              {renderChart()}
            </div>

          ) : (
            /* ── Table view ── */
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/5 text-gray-400 text-xs uppercase">
                    <th className="px-4 py-3 text-left">Module</th>
                    <th className="px-4 py-3 text-center">Tests</th>
                    <th className="px-4 py-3 text-center">Total Steps</th>
                    <th className="px-4 py-3 text-center text-green-400">Pass</th>
                    <th className="px-4 py-3 text-center text-red-400">Fail</th>
                    <th className="px-4 py-3 text-center text-amber-400">Pending</th>
                    <th className="px-4 py-3 text-center">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((m) => {
                    const allSteps = (m.tests ?? []).flatMap((t) => (t.steps ?? []).filter((s) => !s.is_divider));
                    const total   = allSteps.length;
                    const pass    = allSteps.filter((s) => s.status === "pass").length;
                    const fail    = allSteps.filter((s) => s.status === "fail").length;
                    const pending = allSteps.filter((s) => s.status === "pending").length;
                    const rate    = total > 0 ? Math.round((pass / total) * 100) : 0;
                    return (
                      <tr key={m.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 font-semibold text-white">{m.name}</td>
                        <td className="px-4 py-3 text-center text-gray-300">{m.tests?.length ?? 0}</td>
                        <td className="px-4 py-3 text-center font-bold text-white">{total}</td>
                        <td className="px-4 py-3 text-center font-semibold text-green-400">{pass}</td>
                        <td className="px-4 py-3 text-center font-semibold text-red-400">{fail}</td>
                        <td className="px-4 py-3 text-center font-semibold text-amber-400">{pending}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center gap-2 justify-center">
                            <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full rounded-full"
                                style={{ width: `${rate}%`, backgroundColor: COLORS.pass }} />
                            </div>
                            <span className="font-bold text-white text-xs">{rate}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default TestReport;
