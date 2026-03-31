import React, { useState } from "react";
import { useQuery, gql } from "@apollo/client";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { Module } from "../../types";
import { exportReportCSV, exportReportPDF, FlatData } from "../../utils/export";

const GET_REPORT_DATA = gql`
  query GetReportData {
    modules(order_by: { name: asc }) {
      id name description accent_color
      tests {
        id name
        steps {
          serial_no action expected_result remarks status is_divider
        }
      }
    }
  }
`;

const COLORS = { pass: "#22c55e", fail: "#ef4444", pending: "#f59e0b" };

const TestReport: React.FC = () => {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  const { data, loading } = useQuery(GET_REPORT_DATA, { fetchPolicy: "network-only" });
  const modules: any[] = data?.modules ?? [];
  const filtered = selectedModuleId ? modules.filter(m => m.id === selectedModuleId) : modules;

  const buildFlatData = (mods: any[]): FlatData[] => {
    const flat: FlatData[] = [];
    mods.forEach(m => {
      (m.tests ?? []).forEach((t: any) => {
        (t.steps ?? []).filter((s: any) => !s.is_divider).forEach((s: any) => {
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
    const pass    = flat.filter(s => s.status === "pass").length;
    const fail    = flat.filter(s => s.status === "fail").length;
    const pending = flat.filter(s => s.status === "pending").length;
    return [
      { label: "Total Steps", value: flat.length },
      { label: "Pass",        value: pass         },
      { label: "Fail",        value: fail          },
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

      {/* ── Export Modal ── */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Report"
        subtitle={selectedModuleId ? modules.find(m => m.id === selectedModuleId)?.name : "All Modules"}
        stats={exportStats()}
        options={[
          {
            label: "CSV",
            icon: "📥",
            color: "bg-green-600",
            hoverColor: "hover:bg-green-700",
            onConfirm: () => exportReportCSV([], buildFlatData(filtered)),
          },
          {
            label: "PDF",
            icon: "📋",
            color: "bg-red-600",
            hoverColor: "hover:bg-red-700",
            onConfirm: () => exportReportPDF([], buildFlatData(filtered)),
          },
        ]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner /></div>
      ) : (
        <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">

          {/* ── Filter ── */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-400">Filter by Module</label>
            <select
              value={selectedModuleId ?? ""}
              onChange={e => setSelectedModuleId(e.target.value || null)}
              className="input text-sm"
            >
              <option value="">All Modules</option>
              {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          {/* ── Table ── */}
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
                {filtered.map((m: any) => {
                  const allSteps = (m.tests ?? []).flatMap((t: any) =>
                    (t.steps ?? []).filter((s: any) => !s.is_divider)
                  );
                  const total   = allSteps.length;
                  const pass    = allSteps.filter((s: any) => s.status === "pass").length;
                  const fail    = allSteps.filter((s: any) => s.status === "fail").length;
                  const pending = allSteps.filter((s: any) => s.status === "pending").length;
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
        </div>
      )}
    </>
  );
};

export default TestReport;