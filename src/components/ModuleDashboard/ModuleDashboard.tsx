// src/components/ModuleDashboard/ModuleDashboard.tsx
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {supabase} from '../../supabase';
import Spinner from '../UI/Spinner';
import Topbar from '../Layout/Topbar';
import {useAuth} from '../../context/AuthContext';
import {useTheme} from '../../context/ThemeContext';
import {useToast} from '../../context/ToastContext';
import useaudit_log from '../../hooks/useAuditlog';
import { Lock, Pencil, Play, Download, FileSpreadsheet, FileText, X } from 'lucide-react';
import { exportModuleDetailCSV, exportModuleDetailPDF, FlatData } from '../../utils/export';

import {
  RBarChart,
  RAreaChart,
  RLineChart,
  RPieChart,
  RRadarChart,
} from './charts';
import type { ChartRow, ChartTheme } from './charts';

// ── Animation keyframes ───────────────────────────────────────────────────────
const ANIM_STYLE = `
@keyframes fadeSlideIn    { from{opacity:0;transform:translateY(10px)}  to{opacity:1;transform:translateY(0)} }
@keyframes fadeSlideInRow { from{opacity:0;transform:translateX(-6px)}  to{opacity:1;transform:translateX(0)} }
@keyframes fadeScaleIn    { from{opacity:0;transform:scale(.95) translateY(-4px)} to{opacity:1;transform:scale(1) translateY(0)} }
`;

function useInjectStyle() {
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = ANIM_STYLE;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);
}

const FadeWrapper: React.FC<{ animKey: string | number; children: React.ReactNode }> = ({ animKey, children }) => (
  <div key={animKey} style={{ animation: 'fadeSlideIn 0.28s cubic-bezier(0.22,1,0.36,1) both' }}>{children}</div>
);

const StaggerRow: React.FC<{ index: number; children: React.ReactNode }> = ({ index, children }) => (
  <div style={{ animation: 'fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both', animationDelay: `${index * 45}ms` }}>
    {children}
  </div>
);

// ── Constants ─────────────────────────────────────────────────────────────────
type ChartType = 'bar' | 'area' | 'line' | 'pie' | 'radar';
const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: 'bar',   label: 'Bar'   },
  { type: 'area',  label: 'Area'  },
  { type: 'line',  label: 'Line'  },
  { type: 'pie',   label: 'Pie'   },
  { type: 'radar', label: 'Radar' },
];

// ── Props & DB types ──────────────────────────────────────────────────────────
interface Props {
  module_name: string;
  onBack: () => void;
  onExecute: (module_test_id: string) => void;
}

interface TrimmedStepResult {
  id: string;
  status: 'pass' | 'fail' | 'pending';
  step: { id: string; is_divider: boolean; testsname: string } | null;
}

interface ModuleTestRow {
  id: string;
  testsname: string;
  test: { serial_no: number; name: string; description?: string };
  step_results: TrimmedStepResult[];
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const ModuleDashboard: React.FC<Props> = ({ module_name, onBack, onExecute }) => {
  useInjectStyle();

  const { user }        = useAuth();
  const { theme }       = useTheme();
  const { addToast }    = useToast();
  const log             = useaudit_log();

  const [module_tests, setmodule_tests] = useState<ModuleTestRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [chartType, setChartType]     = useState<ChartType>('bar');
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const [descDraft, setDescDraft]     = useState('');
  const [savingDesc, setSavingDesc]   = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── ChartTheme derived from CSS vars ──────────────────────────────────────
  const ct = useMemo<ChartTheme>(() => {
    const s = getComputedStyle(document.documentElement);
    const get = (v: string) => s.getPropertyValue(v).trim();
    const isDark = theme === 'dark';
    return {
      panel:       isDark ? '#0f172a' : '#ffffff',
      text:        get('--text-primary')   || (isDark ? '#f1f5f9' : '#1e293b'),
      muted:       get('--text-muted')     || (isDark ? '#64748b' : '#94a3b8'),
      grid:        isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      border:      isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
      tooltipBg:   isDark ? '#1e293b' : '#ffffff',
      tooltipText: isDark ? '#f1f5f9' : '#1e293b',
      tooltipName: isDark ? '#94a3b8' : '#64748b',
    };
  }, [theme]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('module_tests')
      .select(`
        id, testsname,
        test:tests!testsname ( serial_no, name, description ),
        step_results:step_results!module_test_id (
          id, status,
          step:test_steps!test_stepsid ( id, is_divider, testsname )
        )
      `)
      .eq('module_name', module_name)
      .order('testsname');

    if (!mountedRef.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setmodule_tests((data ?? []) as unknown as ModuleTestRow[]);
    setError(null);
    setLoading(false);
  }, [module_name]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`module-dashboard-${module_name}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'step_results' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [module_name, fetchData]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const chartData = useMemo<ChartRow[]>(() =>
    module_tests.map(mt => {
      const real = mt.step_results.filter(sr => !sr.step?.is_divider);
      return {
        name:    mt.test?.name ?? mt.testsname,
        pass:    real.filter(sr => sr.status === 'pass').length,
        fail:    real.filter(sr => sr.status === 'fail').length,
        pending: real.filter(sr => sr.status === 'pending').length,
      };
    }), [module_tests]);

  const globalStats = useMemo(() => {
    const pass    = chartData.reduce((a, x) => a + x.pass, 0);
    const fail    = chartData.reduce((a, x) => a + x.fail, 0);
    const pending = chartData.reduce((a, x) => a + x.pending, 0);
    const total   = pass + fail + pending;
    return { pass, fail, pending, total, passRate: total > 0 ? Math.round((pass / total) * 100) : 0 };
  }, [chartData]);

  // ── Save description ──────────────────────────────────────────────────────
  const saveDesc = async (module_test_id: string) => {
    setSavingDesc(true);
    const { error: e } = await supabase
      .from('module_tests')
      .update({ description: descDraft.trim() || null })
      .eq('id', module_test_id);
    setSavingDesc(false);
    if (e) { addToast('Failed to save description', 'error'); return; }
    setEditingDesc(null);
    log(`Updated description for test in ${module_name}`);
    fetchData();
  };

  // ── Build export data ─────────────────────────────────────────────────────
  const buildFlatData = (): FlatData[] =>
    module_tests.flatMap(mt =>
      mt.step_results
        .filter(sr => !sr.step?.is_divider)
        .map(sr => ({
          module:   module_name,
          test:     mt.test?.name ?? mt.testsname,
          serial:   0,
          action:   '',
          expected: '',
          remarks:  '',
          status:   sr.status,
        }))
    );

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) return (
    <div className="flex-1 flex flex-col">
      <Topbar title={module_name} onBack={onBack} />
      <div className="flex items-center justify-center flex-1"><Spinner /></div>
    </div>
  );

  if (error) return (
    <div className="flex-1 flex flex-col">
      <Topbar title={module_name} onBack={onBack} />
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-500 text-sm">
          Failed to load module: {error}
        </div>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title={module_name}
        subtitle={`${module_tests.length} test${module_tests.length !== 1 ? 's' : ''} · ${globalStats.total} steps`}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportModuleDetailCSV(buildFlatData())}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition">
              <FileSpreadsheet size={13} />CSV
            </button>
            <button onClick={() => exportModuleDetailPDF(buildFlatData())}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition">
              <FileText size={13} />PDF
            </button>
          </div>
        }
      />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">

        {/* ── Global stat pills ── */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Total',   value: globalStats.total,   cls: 'bg-bg-card text-t-primary'  },
            { label: 'Pass',    value: globalStats.pass,    cls: 'bg-green-500/10 text-green-400' },
            { label: 'Fail',    value: globalStats.fail,    cls: 'bg-red-500/10 text-red-400'     },
            { label: 'Pending', value: globalStats.pending, cls: 'bg-amber-500/10 text-amber-400' },
            { label: 'Pass %',  value: `${globalStats.passRate}%`, cls: 'bg-c-brand-bg text-c-brand' },
          ].map(s => (
            <span key={s.label} className={`flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full border border-[var(--border-color)] ${s.cls}`}>
              {s.label}: {s.value}
            </span>
          ))}
        </div>

        {/* ── Chart type selector + chart ── */}
        {module_tests.length > 0 && (
          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-semibold text-t-primary">Step Results by Test</p>
              <div className="flex items-center gap-1 bg-bg-base rounded-xl p-1">
                {CHART_TYPES.map(({ type, label }) => (
                  <button key={type} onClick={() => setChartType(type)}
                    className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${chartType === type ? 'bg-c-brand text-white' : 'text-t-muted hover:text-t-primary'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <FadeWrapper animKey={chartType}>
              {chartType === 'bar'   && <RBarChart   data={chartData} ct={ct} />}
              {chartType === 'area'  && <RAreaChart  data={chartData} ct={ct} />}
              {chartType === 'line'  && <RLineChart  data={chartData} ct={ct} />}
              {chartType === 'pie'   && <RPieChart   data={chartData} ct={ct} />}
              {chartType === 'radar' && <RRadarChart data={chartData} ct={ct} />}
            </FadeWrapper>
          </div>
        )}

        {/* ── Test list ── */}
        <div className="flex flex-col gap-3">
          {module_tests.length === 0 && (
            <div className="text-center text-t-muted py-12">No tests assigned to this module yet.</div>
          )}
          {module_tests.map((mt, idx) => {
            const real    = mt.step_results.filter(sr => !sr.step?.is_divider);
            const pass    = real.filter(sr => sr.status === 'pass').length;
            const fail    = real.filter(sr => sr.status === 'fail').length;
            const pending = real.filter(sr => sr.status === 'pending').length;
            const total   = real.length;
            const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;
            const failPct  = total > 0 ? Math.round((fail / total) * 100) : 0;

            return (
              <StaggerRow key={mt.id} index={idx}>
                <div className="card flex flex-col gap-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-c-brand font-bold">{mt.test?.serial_no}</span>
                        <h3 className="font-semibold text-t-primary text-sm truncate">{mt.test?.name ?? mt.testsname}</h3>
                      </div>

                      {/* Description */}
                      {editingDesc === mt.id ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <input value={descDraft} onChange={e => setDescDraft(e.target.value)}
                            className="input text-xs py-1 flex-1" placeholder="Short description…" autoFocus />
                          <button onClick={() => saveDesc(mt.id)} disabled={savingDesc}
                            className="text-green-400 hover:text-green-300 p-1"><Download size={13} /></button>
                          <button onClick={() => setEditingDesc(null)} className="text-t-muted hover:text-red-400 p-1"><X size={13} /></button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingDesc(mt.id); setDescDraft(mt.test?.description ?? ''); }}
                          className="mt-0.5 flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors group">
                          <span className="truncate max-w-xs">{mt.test?.description || <em>Add description…</em>}</span>
                          <Pencil size={10} className="opacity-0 group-hover:opacity-100 shrink-0" />
                        </button>
                      )}
                    </div>

                    {/* Execute button */}
                    <button onClick={() => onExecute(mt.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-c-brand hover:bg-c-brand-hover text-white text-xs font-semibold transition-colors shrink-0">
                      <Play size={12} />Execute
                    </button>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span className="badge-pass"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1" />{pass} Pass</span>
                    <span className="badge-fail"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block mr-1" />{fail} Fail</span>
                    <span className="flex items-center gap-1 font-semibold text-t-muted bg-bg-card border border-[var(--border-color)] rounded-full px-2.5 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] inline-block" />{pending} Pending
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-xs text-t-muted mb-1">
                      <span>Progress</span>
                      <span className="font-semibold" style={{ color: passRate === 100 ? '#22c55e' : failPct === 100 ? '#ef4444' : undefined }}>
                        {total > 0 ? `${passRate}%` : '—'}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full overflow-hidden flex">
                      {passRate > 0  && <div className="h-full bg-green-500 transition-all duration-700" style={{ width: `${passRate}%` }} />}
                      {failPct > 0   && <div className="h-full bg-red-500 transition-all duration-700"   style={{ width: `${failPct}%` }} />}
                      {(100 - passRate - failPct) > 0 && (
                        <div className="h-full transition-all duration-700" style={{ width: `${100 - passRate - failPct}%`, backgroundColor: 'var(--text-muted)', opacity: 0.3 }} />
                      )}
                    </div>
                  </div>
                </div>
              </StaggerRow>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ModuleDashboard;