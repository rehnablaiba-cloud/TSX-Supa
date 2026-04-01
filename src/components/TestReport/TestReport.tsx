import React, { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { exportReportCSV, exportReportPDF, FlatData } from "../../utils/export";
import { useTheme } from "../../context/ThemeContext";

const COLORS = { pass: "#22c55e", fail: "#ef4444", pending: "#f59e0b" };

// ── Types ──────────────────────────────────────────────────────────────────────
interface Step {
  serial_no: number;
  action: string;
  expected_result: string;
  remarks: string;
  status: string;
  is_divider: boolean;
}

interface Test {
  id: string;
  name: string;
  steps: Step[];
}

interface ModuleWithTests {
  id: string;
  name: string;
  description: string;
  accent_color: string;
  tests: Test[];
}

// ── Component ─────────────────────────────────────────────────────────────────
const TestReport: React.FC = () => {
  const { theme } = useTheme();
  const [modules, setModules]                   = useState<ModuleWithTests[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal]   = useState(false);
  const [view, setView]                         = useState<"graph" | "table">("graph");

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

  // ── Chart theme ────────────────────────────────────────────────────────────
  const chartTheme = theme === "dark"
    ? {
        panel:       "#111827",
        text:        "#e5e7eb",
        muted:       "#94a3b8",
        grid:        "#334155",
        border:      "#334155",
        tooltipBg:   "#0f172a",
        tooltipText: "#f8fafc",
        tooltipName: "#cbd5e1",
      }
    : {
        panel:       "#ffffff",
        text:        "#0f172a",
        muted:       "#475569",
        grid:        "#cbd5e1",
        border:      "#cbd5e1",
        tooltipBg:   "#ffffff",
        tooltipText: "#0f172a",
        tooltipName: "#475569",
      };

  // ── Chart data ─────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    return filtered.map((m) => {
      const allSteps = (m.tests ?? []).flatMap((t) =>
        (t.steps ?? []).filter((s) => !s.is_divider)
      );
      return {
        name:    m.name,
        pass:    allSteps.filter((s) => s.status === "pass").length,
        fail:    allSteps.filter((s) => s.status === "fail").length,
        pending: allSteps.filter((s) => s.status === "pending").length,
      };
    });
  }, [filtered]);

  // ── Custom tooltip ─────────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div
        className="rounded-xl border px-4 py-3 shadow-xl"
        style={{ backgroundColor: chartTheme.tooltipBg, borderColor: chartTheme.border }}
      >
        <div className="text-sm font-semibold mb-2" style={{ color: chartTheme.tooltipText }}>
          {label}
        </div>
        {payload.map((item: any) => (
          <div key={item.dataKey} className="flex items-center justify-between gap-6 text-sm">
            <span style={{ color: chartTheme.tooltipName }}>{item.name}</span>
            <span style={{ color: item.color, fontWeight: 700 }}>{item.value}</span>
          </div>
        ))}
      </div>
    );
  };

  // ── Export helpers ─────────────────────────────────────────────────────────
  const buildFlatData = (mods: ModuleWithTests[]): FlatData[] => {
    const flat: FlatData[] = [];
    mods.forEach((m) => {
      (m.tests ?? []).forEach((t) => {
        (t.steps ?? []).filter((s) => !s.is_divider).forEach((s) => {
          flat.push({
            module: m.name, test: t.name, serial: s.serial_no,
            action: s.action, expected: s.expected_result,
            remarks: s.remarks || "", status: s.status,
          });
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

  return (
    <>
      <Topbar
        title="Test Report"
        subtitle="Module-wise execution summary"
        actions={
          <button
            onClick={() => setShowExportModal(true)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition border border-white/10"
          >
            📤 Export
          </button>
        }
      />

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Report"
        subtitle={selectedModuleId ? modules.find((m) => m.id === selectedModuleId)?.name : "All Modules"}
        stats={exportStats()}
        options={[
          {
            label: "CSV", icon: "📥", color: "bg-green-600", hoverColor: "hover:bg-green-700",
            onConfirm: () => exportReportCSV([], buildFlatData(filtered)),
          },
          {
            label: "PDF", icon: "📋", color: "bg-red-600", hoverColor: "hover:bg-red-700",
            onConfirm: () => exportReportPDF([], buildFlatData(filtered)),
          },
        ]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner /></div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-2xl">⚠️</span>
          <p className="text-sm text-red-400 font-medium">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm text-gray-300 border border-white/10 transition">
            Retry
          </button>
        </div>
      ) : (
        <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">

          {/* ── Filter + view toggle ── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-400">Filter by Module</label>
              <select
                value={selectedModuleId ?? ""}
                onChange={(e) => setSelectedModuleId(e.target.value || null)}
                className="input text-sm"
              >
                <option value="">All Modules</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2 rounded-xl p-1 bg-white/5 border border-white/10 w-fit">
              <button
                onClick={() => setView("graph")}
                style={view === "graph" ? { color: "#ffffff" } : undefined}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  view === "graph" ? "bg-blue-700" : "text-gray-400 hover:text-gray-700 dark:hover:text-white"
                }`}
              >
                Graph
              </button>
              <button
                onClick={() => setView("table")}
                style={view === "table" ? { color: "#ffffff" } : undefined}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  view === "table" ? "bg-blue-700" : "text-gray-400 hover:text-gray-700 dark:hover:text-white"
                }`}
              >
                Table
              </button>
            </div>
          </div>

          {/* ── Graph view ── */}
          {view === "graph" ? (
            <div
              className="p-4 rounded-xl border"
              style={{ backgroundColor: chartTheme.panel, borderColor: chartTheme.border }}
            >
              <h3 className="text-sm font-semibold mb-4" style={{ color: chartTheme.text }}>
                Execution Graph
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="passFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={COLORS.pass}    stopOpacity={0.35} />
                        <stop offset="95%" stopColor={COLORS.pass}    stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="failFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={COLORS.fail}    stopOpacity={0.28} />
                        <stop offset="95%" stopColor={COLORS.fail}    stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="pendingFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={COLORS.pending} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={COLORS.pending} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                    <XAxis dataKey="name" stroke={chartTheme.muted} tick={{ fontSize: 12 }} />
                    <YAxis stroke={chartTheme.muted} tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ color: chartTheme.text }} />
                    <Area type="monotone" dataKey="pass"    stroke={COLORS.pass}    fill="url(#passFill)"    strokeWidth={3} name="Pass" />
                    <Area type="monotone" dataKey="fail"    stroke={COLORS.fail}    fill="url(#failFill)"    strokeWidth={3} name="Fail" />
                    <Area type="monotone" dataKey="pending" stroke={COLORS.pending} fill="url(#pendingFill)" strokeWidth={3} name="Pending" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
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
                    const allSteps = (m.tests ?? []).flatMap((t) =>
                      (t.steps ?? []).filter((s) => !s.is_divider)
                    );
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
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${rate}%`, backgroundColor: COLORS.pass }}
                              />
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
