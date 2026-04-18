

import React, {
  useEffect, useLayoutEffect, useRef,
  useState, useCallback, useMemo,
} from 'react';
import {supabase} from '../../supabase';
import gsap from 'gsap';
import ExportModal from '../UI/ExportModal';
import SegmentedBar       from '../UI/SegmentedBar';
import LockWarningBanner  from '../UI/LockWarningBanner';
import SkeletonCard        from '../UI/SkeletonCard';
import { Upload, FileText, FileDown, FileSpreadsheet, Lock } from 'lucide-react';
import { exportDashboardCSV, exportDashboardPDF, exportDashboardDocx, ModuleSummary } from '../../utils/export';
import { getModuleStats, buildSummaries } from '../../utils/stats';
import type { ActiveLock } from '../../types';

interface Props {
  onNavigate: (page: string, module_name?: string) => void;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const Dashboard: React.FC<Props> = ({ onNavigate }) => {
  const [showExportModal, setShowExportModal] = useState(false);
  const [modules, setModules]       = useState<any[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [activeLocks, setActiveLocks] = useState<ActiveLock[]>([]);
  const gridRef    = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchActiveLocks = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userEmail = sessionData?.session?.user?.email;
    if (!userEmail) return;

    const { data: locks, error: lockErr } = await supabase
      .from('test_locks')
      .select('id, module_test_id, locked_by_name, locked_at')
      .eq('locked_by_name', userEmail);
    if (!mountedRef.current || lockErr || !locks || locks.length === 0) return;

    const module_test_ids = locks.map((l: any) => l.module_test_id);
    const { data: module_tests, error: mtErr } = await supabase
      .from('module_tests')
      .select('id, module_name, testsname')
      .in('id', module_test_ids);
    if (!mountedRef.current || mtErr || !module_tests) return;

    const mtMap = Object.fromEntries(module_tests.map((mt: any) => [mt.id, mt]));
    const mapped: ActiveLock[] = locks.map((l: any) => {
      const mt = mtMap[l.module_test_id];
      return {
        module_test_id: l.module_test_id,
        module_name:   mt?.module_name ?? 'Unknown Module',
        test_name:     mt?.testsname  ?? 'Unknown Test',
        locked_at:     l.locked_at ?? '',
      };
    });
    setActiveLocks(mapped);
  }, []);

  const fetchModules = useCallback(async (isInitial = false) => {
    const { data, error: err } = await supabase
      .from('modules')
      .select(`
  name, description,
  module_tests:module_tests!module_name(id),
  step_results:step_results!module_name(status)
`)
      `)
      .order('name');
    if (!mountedRef.current) return;
    if (err) { setError(err.message); }
    else     { setModules(data ?? []); setError(null); }
    if (isInitial) setInitialLoad(false);
  }, []);

  useEffect(() => { Promise.all([fetchModules(true), fetchActiveLocks()]); }, [fetchModules, fetchActiveLocks]);

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'step_results' }, () => fetchModules(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'modules'     }, () => fetchModules(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_locks'   }, fetchActiveLocks)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchModules, fetchActiveLocks]);

  useLayoutEffect(() => {
    if (!initialLoad && gridRef.current && gridRef.current.children.length > 0)
      gsap.fromTo(gridRef.current.children,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, stagger: 0.06, duration: 0.4, ease: 'power2.out', clearProps: 'opacity,transform' });
  }, [initialLoad, modules.length]);

  const summaries   = useMemo(() => buildSummaries(modules), [modules]);
  const globalStats = useMemo(() => [
    { label: 'Total Steps', value: summaries.reduce((a, x) => a + x.total, 0) },
    { label: 'Pass',        value: summaries.reduce((a, x) => a + x.pass,  0) },
    { label: 'Fail',        value: summaries.reduce((a, x) => a + x.fail,  0) },
  ], [summaries]);

  const lockedmodule_names = useMemo(
    () => new Set(activeLocks.map(l => l.module_name)),
    [activeLocks]
  );

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
          { label: 'CSV',  icon: <FileSpreadsheet size={16} />, color: 'bg-[var(--color-primary)]', hoverColor: 'hover:bg-[var(--color-primary-hover)]', onConfirm: () => exportDashboardCSV(summaries) },
          { label: 'PDF',  icon: <FileText  size={16} />, color: 'bg-[var(--color-blue)]', hoverColor: 'hover:bg-[var(--color-blue-hover)]', onConfirm: () => exportDashboardPDF(summaries) },
          { label: 'DOCX', icon: <FileDown  size={16} />, color: 'bg-[var(--color-blue)]', hoverColor: 'hover:bg-[var(--color-blue-hover)]', onConfirm: () => exportDashboardDocx(summaries) },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-t-primary">Fleet</h2>
          <p className="text-sm text-t-muted mt-1">
            {initialLoad ? 'Loading…' : `${modules.length} Trainset${modules.length !== 1 ? 's' : ''} tracked`}
          </p>
        </div>
        <button onClick={() => setShowExportModal(true)} disabled={modules.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary disabled:opacity-40 disabled:cursor-not-allowed">
          <Upload size={14} />Export
        </button>
      </div>

      {/* 2.1-B2: LockWarningBanner */}
      {!initialLoad && activeLocks.length > 0 && (
        <LockWarningBanner locks={activeLocks} onNavigate={onNavigate} />
      )}

      {/* Grid */}
      {initialLoad ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* 2.1-B3: SkeletonCard */}
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {modules.map((m: any) => {
            const { total, pass, fail, pending, passRate, failPct, pendingPct, testCount } =
              getModuleStats(m.module_tests ?? [], m.step_results ?? []);
            const isLocked = lockedmodule_names.has(m.name);
            const passLabelColor =
              total === 0      ? 'var(--text-muted)'
              : passRate === 100 ? '#22c55e'
              : failPct  === 100 ? '#ef4444'
              : 'var(--text-primary)';

            return (
              <button key={m.name} onClick={() => onNavigate('module', m.name)}
                className="card text-left hover:border-c-brand/50 hover:shadow-xl transition-all duration-300 cursor-pointer group"
                style={isLocked ? { borderColor: '#f59e0b55', boxShadow: '0 0 0 1px #f59e0b33' } : undefined}>

                <div className="flex items-start gap-3 mb-3">
                  <span className="w-3 h-3 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: isLocked ? '#f59e0b' : 'var(--color-brand)' }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-t-primary group-hover:text-c-brand transition-colors truncate">{m.name}</h3>
                    {m.description && <p className="text-xs text-t-muted mt-0.5 truncate">{m.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isLocked && (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
                        style={{ color: '#f59e0b', borderColor: '#f59e0b88', background: 'color-mix(in srgb, #f59e0b 10%, transparent)' }}>
                        <Lock size={9} />Locked
                      </span>
                    )}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap tracking-wide"
                      style={{ color: 'var(--color-brand)', borderColor: 'var(--color-brand)', background: 'color-mix(in srgb, var(--color-brand) 8%, transparent)' }}>
                      {testCount} {testCount === 1 ? 'Test' : 'Tests'}
                    </span>
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
                    <span className="font-semibold" style={{ color: passLabelColor }}>
                      {total > 0 ? `${passRate}%` : '—'}
                    </span>
                  </div>
                  {/* 2.1-B1: SegmentedBar */}
                  <SegmentedBar passRate={passRate} failPct={failPct} pendingPct={pendingPct} total={total} />
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
