import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import gsap from "gsap";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { exportDashboardCSV, exportDashboardPDF, exportDashboardDocx, ModuleSummary } from "../../utils/export";

interface Props {
  onNavigate: (page: string, moduleId?: string) => void;
}

function getModuleStats(tests: any[]) {
  let total = 0, pass = 0, fail = 0, pending = 0;
  for (const t of tests ?? []) {
    for (const s of t.steps ?? []) {
      total++;
      if (s.status === "pass")      pass++;
      else if (s.status === "fail") fail++;
      else                          pending++;
    }
  }
  return { total, pass, fail, pending, passRate: total > 0 ? Math.round((pass / total) * 100) : 0 };
}

function buildSummaries(modules: any[]): ModuleSummary[] {
  return modules.map(m => {
    const stats = getModuleStats(m.tests);
    return { name: m.name, description: m.description, ...stats };
  });
}

const Dashboard: React.FC<Props> = ({ onNavigate }) => {
  const [showExportModal, setShowExportModal] = useState(false);
  const [modules, setModules]                 = useState<any[]>([]);
  const [initialLoad, setInitialLoad]         = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const fetchModules = async (isInitial = false) => {
    const { data, error: err } = await supabase
      .from("modules").select("*, tests(steps(status))").order("name");
    if (err) setError(err.message);
    else { setModules(data ?? []); setError(null); }
    if (isInitial) setInitialLoad(false);
  };

  useEffect(() => {
    fetchModules(true);
    const timer = setInterval(() => fetchModules(false), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!initialLoad && gridRef.current) {
      gsap.fromTo(
        gridRef.current.children,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, stagger: 0.08, duration: 0.5, ease: "power2.out" }
      );
    }
  }, [initialLoad]);

  const globalStats = () => {
    const s = buildSummaries(modules);
    return [
      { label: "Total Steps", value: s.reduce((a, x) => a + x.total, 0) },
      { label: "Pass",        value: s.reduce((a, x) => a + x.pass,  0) },
      { label: "Fail",        value: s.reduce((a, x) => a + x.fail,  0) },
    ];
  };

  if (error) return (
    <div className="p-6">
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-500 text-sm">
        Failed to load modules: {error}
      </div>
    </div>
  );

  return (
    <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
      <ExportModal
        isOpen={showExportModal} onClose={() => setShowExportModal(false)}
        title="Export Dashboard" subtitle="All modules summary"
        stats={globalStats()}
        options={[
          { label: "CSV",  icon: "📥", color: "bg-green-600", hoverColor: "hover:bg-green-700",
            onConfirm: () => exportDashboardCSV(buildSummaries(modules)) },
          { label: "PDF",  icon: "📋", color: "bg-red-600",   hoverColor: "hover:bg-red-700",
            onConfirm: () => exportDashboardPDF(buildSummaries(modules)) },
          { label: "DOCX", icon: "📄", color: "bg-blue-600",  hoverColor: "hover:bg-blue-700",
            onConfirm: () => exportDashboardDocx(buildSummaries(modules)) },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-t-primary">All Modules</h2>
          <p className="text-sm text-t-muted mt-1">
            {modules.length} module{modules.length !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <button
          onClick={() => setShowExportModal(true)}
          disabled={modules.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition
            bg-bg-card hover:bg-bg-surface
            border border-[var(--border-color)]
            text-t-primary
            disabled:opacity-40 disabled:cursor-not-allowed">
          📤 Export
        </button>
      </div>

      {/* Grid */}
      {initialLoad ? (
        <div className="flex items-center justify-center py-20"><Spinner /></div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {modules.map((m: any) => {
            const { total, pass, fail, pending, passRate } = getModuleStats(m.tests);
            const accent = m.accent_color || "var(--color-brand)";
            return (
              <button
                key={m.id}
                onClick={() => onNavigate("module", m.id)}
                className="card text-left hover:border-c-brand/50 hover:shadow-xl transition-all duration-300 cursor-pointer group">
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-3 h-3 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: accent }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-t-primary group-hover:text-c-brand transition-colors truncate">
                      {m.name}
                    </h3>
                    {m.description && (
                      <p className="text-xs text-t-muted mt-0.5 truncate">{m.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-t-muted">Total Steps</span>
                  <span className="text-sm font-bold text-t-primary">{total}</span>
                </div>

                <div className="flex gap-2 mb-3">
                  <span className="badge-pass"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1" />{pass} Pass</span>
                  <span className="badge-fail"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block mr-1" />{fail} Fail</span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-t-muted bg-bg-card border border-[var(--border-color)] rounded-full px-2.5 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] inline-block" />{pending} Pending
                  </span>
                </div>

                <div className="mt-1">
                  <div className="flex justify-between text-xs text-t-muted mb-1">
                    <span>Progress</span>
                    <span className="font-semibold text-t-primary">{passRate}%</span>
                  </div>
                  <div className="h-1.5 bg-bg-card rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${passRate}%`, backgroundColor: passRate === 100 ? "#22c55e" : accent }} />
                  </div>
                </div>
              </button>
            );
          })}
          {modules.length === 0 && (
            <div className="col-span-3 text-center text-t-muted py-20">No modules yet.</div>
          )}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
