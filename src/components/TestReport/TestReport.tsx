// src/components/TestReport/TestReport.tsx
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {supabase} from '../../supabase';
import Spinner from '../UI/Spinner';
import Topbar from '../Layout/Topbar';
import { useTheme } from '../../context/ThemeContext';
import {
  FileSpreadsheet, FileText, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, BarChart2, TableIcon,
} from 'lucide-react';
import { exportReportCSV, exportReportPDF, FlatData } from '../../utils/export';

import { useInjectStyle }  from '../../utils/animation';
import FadeWrapper         from '../UI/FadeWrapper';
import { getChartTheme }   from '../../utils/chartTheme';
import SegmentedBar        from '../UI/SegmentedBar';
import {
  RBarChart,
  RAreaChart,
  RLineChart,
  RPieChart,
  RRadarChart,
} from '../ModuleDashboard/charts';
import type { ChartRow, ChartType } from '../ModuleDashboard/charts/types';
import { CHART_TYPES }              from '../ModuleDashboard/charts';

// ── Props / DB types ──────────────────────────────────────────────────────────
interface Props {
  module_test_id: string;
  onBack: () => void;
}

interface StepResultRow {
  id:     string;
  status: 'pass' | 'fail' | 'pending';
  step: {
    id:              string;
    serial_no:       number;
    action:          string;
    expected_result: string;
    is_divider:      boolean;
    tests_name:      string;
  } | null;
  imageurl: string | null;
  note:     string | null;
}

interface ModuleTestMeta {
  module_name: string;
  tests_name:  string;
  test: { serial_no: number; name: string; description?: string } | null;
}

type ViewMode = 'table' | 'chart';

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_ICON: Record<string, React.ReactNode> = {
  pass:    <CheckCircle2 size={14} className="text-green-400 shrink-0" />,
  fail:    <XCircle      size={14} className="text-red-400   shrink-0" />,
  pending: <Clock        size={14} className="text-amber-400 shrink-0" />,
};

const STATUS_ROW: Record<string, string> = {
  pass:    'border-l-2 border-green-500/40',
  fail:    'border-l-2 border-red-500/40',
  pending: '',
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const TestReport: React.FC<Props> = ({ module_test_id, onBack }) => {
  useInjectStyle();

  const { theme } = useTheme();
  const ct        = useMemo(() => getChartTheme(theme), [theme]);

  const [meta,       setMeta]       = useState<ModuleTestMeta | null>(null);
  const [results,    setResults]    = useState<StepResultRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [viewMode,   setViewMode]   = useState<ViewMode>('table');
  const [chartType,  setChartType]  = useState<ChartType>('bar');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);

    const { data: metaData, error: metaErr } = await supabase
      .from('module_tests')
      .select('module_name, tests_name, test:tests!module_tests_tests_name_fkey(serial_no, name, description)')
      .eq('id', module_test_id)
      .single();

    if (!mountedRef.current) return;
    if (metaErr) { setError(metaErr.message); setLoading(false); return; }

    const metaResult = metaData as unknown as ModuleTestMeta;

    const { data: srData, error: srErr } = await supabase
      .from('step_results')
      .select(`
        id, status, imageurl, note,
        step:test_steps!step_results_test_steps_id_fkey(id, serial_no, action, expected_result, is_divider, tests_name)
      `)
      .eq('module_name', metaResult.module_name)
      .order('id');

    if (!mountedRef.current) return;
    if (srErr) { setError(srErr.message); setLoading(false); return; }

    setMeta(metaResult);
    setResults((srData ?? []) as unknown as StepResultRow[]);
    setError(null);
    setLoading(false);
  }, [module_test_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const real = useMemo(() => results.filter(r => !r.step?.is_divider), [results]);

  const stats = useMemo(() => {
    const pass    = real.filter(r => r.status === 'pass').length;
    const fail    = real.filter(r => r.status === 'fail').length;
    const pending = real.filter(r => r.status === 'pending').length;
    const total   = real.length;
    return {
      pass, fail, pending, total,
      passRate:   total > 0 ? Math.round((pass / total) * 100) : 0,
      failPct:    total > 0 ? Math.round((fail / total) * 100) : 0,
      pendingPct: total > 0 ? 100 - Math.round((pass / total) * 100) - Math.round((fail / total) * 100) : 0,
    };
  }, [real]);

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = useMemo<ChartRow[]>(() => [{
    name:    meta?.test?.name ?? meta?.tests_name ?? 'Test',
    pass:    stats.pass,
    fail:    stats.fail,
    pending: stats.pending,
  }], [meta, stats]);

  // ── Build FlatData for export ─────────────────────────────────────────────
  const toFlatData = (): FlatData[] =>
    results
      .filter(r => !r.step?.is_divider)
      .map(r => ({
        module:    meta?.module_name ?? '',
        test:      meta?.test?.name ?? meta?.tests_name ?? '',
        serial:    r.step?.serial_no ?? 0,
        action:    r.step?.action ?? '',
        expected:  r.step?.expected_result ?? '',
        remarks:   r.note ?? '',
        status:    r.status,
        is_divider: false,
      }));

  // ── Loading / error ───────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex-1 flex flex-col">
      <Topbar title="Test Report" onBack={onBack} />
      <div className="flex items-center justify-center flex-1"><Spinner /></div>
    </div>
  );

  if (error || !meta) return (
    <div className="flex-1 flex flex-col">
      <Topbar title="Test Report" onBack={onBack} />
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-500 text-sm">
          {error ?? 'Test not found.'}
        </div>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col">
      <Topbar
        title={meta.test?.name ?? meta.tests_name}
        subtitle={`${meta.module_name} · ${stats.total} steps`}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportReportCSV([], toFlatData())}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition">
              <FileSpreadsheet size={13} />CSV
            </button>
            <button onClick={() => exportReportPDF([], toFlatData())}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition">
              <FileText size={13} />PDF
            </button>
          </div>
        }
      />

      <div className="p-6 flex flex-col gap-5 pb-24 md:pb-6">

        {/* ── Stat pills ── */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Total',   value: stats.total,   cls: 'bg-bg-card text-t-primary'     },
            { label: 'Pass',    value: stats.pass,    cls: 'bg-green-500/10 text-green-400' },
            { label: 'Fail',    value: stats.fail,    cls: 'bg-red-500/10 text-red-400'     },
            { label: 'Pending', value: stats.pending, cls: 'bg-amber-500/10 text-amber-400' },
            { label: 'Pass %',  value: `${stats.passRate}%`, cls: 'bg-c-brand-bg text-c-brand' },
          ].map(s => (
            <span key={s.label}
              className={`flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full border border-[var(--border-color)] ${s.cls}`}>
              {s.label}: {s.value}
            </span>
          ))}
        </div>

        {/* ── Progress bar ── */}
        <div>
          <div className="flex justify-between text-xs text-t-muted mb-1">
            <span>Overall Progress</span>
            <span className="font-semibold"
              style={{ color: stats.passRate === 100 ? '#22c55e' : stats.failPct === 100 ? '#ef4444' : undefined }}>
              {stats.total > 0 ? `${stats.passRate}%` : '—'}
            </span>
          </div>
          <SegmentedBar
            passRate={stats.passRate}
            failPct={stats.failPct}
            pendingPct={stats.pendingPct}
            total={stats.total}
          />
        </div>

        {/* ── View toggle ── */}
        <div className="flex items-center gap-2 bg-bg-base rounded-xl p-1 self-start">
          {([{ mode: 'table', icon: <TableIcon size={13} />, label: 'Table' },
             { mode: 'chart', icon: <BarChart2  size={13} />, label: 'Chart' }] as const).map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${viewMode === mode ? 'bg-c-brand text-white' : 'text-t-muted hover:text-t-primary'}`}>
              {icon}{label}
            </button>
          ))}
        </div>

        {/* ── TABLE VIEW ── */}
        {viewMode === 'table' && (
          <div className="flex flex-col gap-2">
            {results.length === 0 && (
              <div className="text-center text-t-muted py-12">No steps recorded for this test.</div>
            )}
            {results.map((r, idx) => {
              if (r.step?.is_divider) return (
                <div key={r.id}
                  className="flex items-center gap-3 px-4 py-2 rounded-lg bg-bg-surface border border-[var(--border-color)]"
                  style={{ animation: `fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${idx * 30}ms` }}>
                  <span className="flex-1 h-px bg-[var(--border-color)]" />
                  <span className="text-[11px] font-bold text-t-muted uppercase tracking-widest shrink-0 px-2">
                    {r.step.action || 'Section'}
                  </span>
                  <span className="flex-1 h-px bg-[var(--border-color)]" />
                </div>
              );

              const isExpanded = expandedId === r.id;
              return (
                <div key={r.id}
                  className={`card ${STATUS_ROW[r.status] ?? ''}`}
                  style={{ animation: `fadeSlideInRow 0.25s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${idx * 30}ms` }}>
                  <button
                    className="w-full flex items-start gap-3 text-left"
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                    <span className="shrink-0 mt-0.5">{STATUS_ICON[r.status]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[11px] text-c-brand font-bold">{r.step?.serial_no}</span>
                        <span className="text-sm text-t-primary truncate">{r.step?.action}</span>
                      </div>
                      {!isExpanded && r.step?.expected_result && (
                        <p className="text-xs text-t-muted mt-0.5 truncate">{r.step.expected_result}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-t-muted mt-1">
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 pl-7 flex flex-col gap-2 text-xs text-t-muted border-t border-[var(--border-color)] pt-3">
                      <div><span className="font-semibold text-t-primary">Expected: </span>{r.step?.expected_result}</div>
                      {r.note     && <div><span className="font-semibold text-t-primary">Note: </span>{r.note}</div>}
                      {r.imageurl && (
                        <img src={r.imageurl} alt="Step evidence"
                          className="mt-1 rounded-xl max-h-48 object-contain border border-[var(--border-color)]" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── CHART VIEW ── */}
        {viewMode === 'chart' && (
          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-semibold text-t-primary">Step Results</p>
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
              {chartType === 'pie'   && <RPieChart   data={chartData} ct={ct} showLabel />}
              {chartType === 'radar' && <RRadarChart data={chartData} ct={ct} />}
            </FadeWrapper>
          </div>
        )}

      </div>
    </div>
  );
};

export default TestReport;
