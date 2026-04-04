import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { supabase } from "../../supabase";
import gsap from "gsap";
import ExportModal from "../UI/ExportModal";
import { Upload, FileText, FileDown } from "lucide-react"; // ✅ Lucide
import {
  exportDashboardCSV,
  exportDashboardPDF,
  exportDashboardDocx,
  ModuleSummary,
} from "../../utils/export";
import { FileSpreadsheet} from "lucide-react";

interface Props {
  onNavigate: (page: string, moduleName?: string) => void;
}

function getModuleStats(
  moduleTests: { id: string }[],
  stepResults: { status: string; step?: { is_divider: boolean } | null }[]
) {
  const testCount = moduleTests?.length ?? 0;
  let total = 0, pass = 0, fail = 0, pending = 0;

  for (const sr of stepResults ?? []) {
    if (sr.step?.is_divider) continue;
    total++;
    if (sr.status === "pass")      pass++;
    else if (sr.status === "fail") fail++;
    else                           pending++;
  }

  const passPct    = total > 0 ? Math.round((pass / total) * 100) : 0;
  const failPct    = total > 0 ? Math.round((fail / total) * 100) : 0;
  const pendingPct = total > 0 ? 100 - passPct - failPct : 0;

  return { total, pass, fail, pending, passRate: passPct, failPct, pendingPct, testCount };
}

function buildSummaries(modules: any[]): ModuleSummary[] {
  return modules.map((m) => {
    const { total, pass, fail, pending, passRate } = getModuleStats(
      m.module_tests ?? [],
      m.step_results ?? []
    );
    return { name: m.name, description: m.description, total, pass, fail, pending, passRate };
  });
}

// ── Segmented progress bar ────────────────────────────────────────────────────
interface SegmentedBarProps {
  passRate:   number;
  failPct:    number;
  pendingPct: number;
  total:      number;
}

const SegmentedBar: React.FC<SegmentedBarProps> = ({ passRate, failPct, pendingPct, total }) => {
  if (total === 0) {
    return <div className="h-1.5 w-full rounded-full bg-bg-card" />;
  }
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden flex">
      {passRate > 0 && (
        <div className="h-full bg-green-500 transition-all duration-700" style={{ width: `${passRate}%` }} />
      )}
      {failPct > 0 && (
        <div className="h-full bg-red-500 transition-all duration-700" style={{ width: `${failPct}%` }} />
      )}
      {pendingPct > 0 && (
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${pendingPct}%`, backgroundColor: "var(--text-muted)", opacity: 0.3 }}
        />
      )}
    </div>
  );
};

// ── Skeleton card ─────────────────────────────────────────────────────────────
const SkeletonCard: React.FC = () => (
  <div className="card animate-pulse">
    <div className="flex items-start gap-3 mb-3">
      <span className="w-3 h-3 rounded-full mt-1.5 shrink-0 bg-bg-surface" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 w-3/5 rounded bg-bg-surface" />
        <div className="h-3 w-4/5 rounded bg-bg-surface" />
      </div>
      <div className="h-5 w-14 rounded-full bg-bg-surface shrink-0" />
    </div>
    <div className="flex items-center justify-between mb-3">
      <div className="h-3 w-16 rounded bg-bg-surface" />
      <div className="h-4 w-8 rounded bg-bg-surface" />
    </div>
    <div className="flex gap-2 mb-3">
      <div className="h-5 w-16 rounded-full bg-bg-surface" />
      <div className="h-5 w-14 rounded-full bg-bg-surface" />
      <div className="h-5 w-20 rounded-full bg-bg-surface" />
    </div>
    <div className="mt-1 space-y-1">
      <div className="flex justify-between">
        <div className="h-3 w-12 rounded bg-bg-surface" />
        <div className="h-3 w-8 rounded bg-bg-surface" />
      </div>
      <div className="h-1.5 w-full rounded-full bg-bg-surface" />
    </div>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────
const Dashboard: React.FC<Props> = ({ onNavigate }) => {
  const [showExportModal, setShowExportModal] = useState(false);
  const [modules, setModules]                 = useState<any[]>([]);
  const [initialLoad, setInitialLoad]         = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const gridRef    = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchModules = useCallback(async (isInitial = false) => {
    const { data, error: err } = await supabase
      .from("modules")
      .select(`
        name,
        description,
        module_tests:module_tests!module_name(id),
        step_results:step_results!module_name(
          status,
          step:test_steps!test_steps_id(is_divider)
        )
      `)
      .order("name");

    if (!mountedRef.current) return;

    if (err) {
      setError(err.message);
    } else {
      setModules(data ?? []);
      setError(null);
    }
    if (isInitial) setInitialLoad(false);
  }, []);

  useEffect(() => {
    fetchModules(true);
  }, [fetchModules]);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "step_results" }, () => fetchModules(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "modules"      }, () => fetchModules(false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchModules]);

  useLayoutEffect(() => {
    if (!initialLoad && gridRef.current && gridRef.current.children.length > 0) {
      gsap.fromTo(
        gridRef.current.children,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, stagger: 0.06, duration: 0.4, ease: "power2.out", clearProps: "opacity,transform" }
      );
    }
  }, [initialLoad, modules.length]);

  const summaries   = useMemo(() => buildSummaries(modules), [modules]);
  const globalStats = useMemo(() => [
    { label: "Total Steps", value: summaries.reduce((a, x) => a + x.total, 0) },
    { label: "Pass",        value: summaries.reduce((a, x) => a + x.pass,  0) },
    { label: "Fail",        value: summaries.reduce((a, x) => a + x.fail,  0) },
  ], [summaries]);

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
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Dashboard"
        subtitle="Fleet summary"
        stats={globalStats}
        options={[
            {
            label: "CSV",
            icon: <FileSpreadsheet size={16} />,
            color: "bg-[var(--color-primary)]",
            hoverColor: "hover:bg-[var(--color-primary-hover)]",
            onConfirm: () => exportDashboardCSV(moduleName, currentTest?.name ?? "test", flatData),
          },
          {
            label: "PDF",
            icon: <FileText size={16} />,
            color: "bg-[var(--color-blue)]",
            hoverColor: "hover:bg-[var(--color-blue-hover)]",
            onConfirm: () => exportDashboardPDF(moduleName, currentTest?.name ?? "test", flatData),
          },
                    {
            label: "DOCX",
            icon: <FileDown size={16} />,
            color: "bg-[var(--color-blue)]",
            hoverColor: "hover:bg-[var(--color-blue-hover)]",
            onConfirm: () => exportDashboardDocx(moduleName, currentTest?.name ?? "test", flatData),
          },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-t-primary">Fleet</h2>
          <p className="text-sm text-t-muted mt-1">
            {initialLoad
              ? "Loading…"
              : `${modules.length} Trainset${modules.length !== 1 ? "s" : ""} tracked`}
          </p>
        </div>
        <button
          onClick={() => setShowExportModal(true)}
          disabled={modules.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition
            bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload size={14} />  {/* ✅ Lucide */}
          Export
        </button>
      </div>

      {/* Grid */}
      {initialLoad ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {modules.map((m: any) => {
            const { total, pass, fail, pending, passRate, failPct, pendingPct, testCount } =
              getModuleStats(m.module_tests ?? [], m.step_results ?? []);

            const passLabelColor =
              total === 0        ? "var(--text-muted)"
              : passRate === 100 ? "#22c55e"
              : failPct  === 100 ? "#ef4444"
              :                    "var(--text-primary)";

            return (
              <button
                key={m.name}
                onClick={() => onNavigate("module", m.name)}
                className="card text-left hover:border-c-brand/50 hover:shadow-xl transition-all duration-300 cursor-pointer group"
              >
                {/* Name + test-count pill */}
                <div className="flex items-start gap-3 mb-3">
                  <span
                    className="w-3 h-3 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: "var(--color-brand)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-t-primary group-hover:text-c-brand transition-colors truncate">
                      {m.name}
                    </h3>
                    {m.description && (
                      <p className="text-xs text-t-muted mt-0.5 truncate">{m.description}</p>
                    )}
                  </div>
                  <span
                    className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap tracking-wide"
                    style={{
                      color:       "var(--color-brand)",
                      borderColor: "var(--color-brand)",
                      background:  "color-mix(in srgb, var(--color-brand) 8%, transparent)",
                    }}
                  >
                    {testCount} {testCount === 1 ? "Test" : "Tests"}
                  </span>
                </div>

                {/* Step count row */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-t-muted">Total Steps</span>
                  <span className="text-sm font-bold text-t-primary">{total}</span>
                </div>

                {/* Status badges */}
                <div className="flex gap-2 mb-3">
                  <span className="badge-pass">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1" />
                    {pass} Pass
                  </span>
                  <span className="badge-fail">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block mr-1" />
                    {fail} Fail
                  </span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-t-muted bg-bg-card border border-[var(--border-color)] rounded-full px-2.5 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] inline-block" />
                    {pending} Pending
                  </span>
                </div>

                {/* Segmented progress bar */}
                <div className="mt-1">
                  <div className="flex justify-between text-xs text-t-muted mb-1">
                    <span>Progress</span>
                    <span className="font-semibold" style={{ color: passLabelColor }}>
                      {total === 0 ? "—" : `${passRate}% pass`}
                    </span>
                  </div>
                  <SegmentedBar
                    passRate={passRate}
                    failPct={failPct}
                    pendingPct={pendingPct}
                    total={total}
                  />
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