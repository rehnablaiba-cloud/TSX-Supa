// src/components/TestReport/TestReport.tsx
// Phase 2.1 applied:
//   2.1-A1  COLORS / ChartRow / ChartTheme / CHART_TYPES / ChartType → MD/charts/types
//   2.1-A2  CustomTooltip  → MD/charts/CustomTooltip
//   2.1-A3  PieTooltip     → MD/charts/PieTooltip
//   2.1-A4  RBarChart / RLineChart / RRadarChart → MD/charts/
//   2.1-A5  RAreaChart (unified gradient IDs)   → MD/charts/
//   2.1-A6  RPieChart  (showLabel=true)          → MD/charts/
//   2.1-A7  useInjectStyle / FadeWrapper         → utils/animation + UI/FadeWrapper
//   2.1-B1  SegmentedBar                         → UI/SegmentedBar
//   2.1-C1  getChartTheme                        → utils/chartTheme

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import supabase from '../../../supabase';
import Spinner from '../UI/Spinner';
import Topbar from '../Layout/Topbar';
import useTheme from '../../../context/ThemeContext';
import {
  FileSpreadsheet, FileText, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, BarChart2, TableIcon,
} from 'lucide-react';
import { exportTestReportCSV, exportTestReportPDF } from '../../../utils/export';

// ── Phase 2.1 shared imports ──────────────────────────────────────────────────
import { useInjectStyle }  from '../../../utils/animation';
import FadeWrapper         from '../UI/FadeWrapper';
import { getChartTheme }   from '../../../utils/chartTheme';
import SegmentedBar        from '../UI/SegmentedBar';
import {
  RBarChart,
  RAreaChart,
  RLineChart,
  RPieChart,
  RRadarChart,
} from '../ModuleDashboard/charts';
import type { ChartRow, CHART_TYPES } from '../ModuleDashboard/charts';
import { CHART_TYPES }              from '../ModuleDashboard/charts';

// ── Props / DB types ──────────────────────────────────────────────────────────
interface Props {
  moduleTestId: string;
  onBack: () => void;
}

interface StepResultRow {
  id:     string;
  status: 'pass' | 'fail' | 'pending';
  step: {
    id:             string;
    serialno:       number;
    action:         string;
    expectedresult: string;
    isdivider:      boolean;
    testsname:      string;
  } | null;
  imageurl: string | null;
  note:     string | null;
}

interface ModuleTestMeta {
  modulename: string;
  testsname:  string;
  test: { serialno: number; name: string; description?: string } | null;
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
const TestReport: React.FC<Props> = ({ moduleTestId, onBack }) => {
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

    const [{ data: metaData, error: metaErr }, { data: srData, error: srErr }] = await Promise.all([
      supabase
        .from('moduletests')
        .select('modulename, testsname, test:tests!testsname(serialno, name, description)')
        .eq('id', moduleTestId)
        .single(),
      supabase
        .from('stepresults')
        .select(`
          id, status, imageurl, note,
          step:teststeps!teststepsid(id, serialno, action, expectedresult, isdivider, testsname)
        `)
        .eq('moduletestid', moduleTestId)
        .order('id'),
    ]);

    if (!mountedRef.current) return;
    if (metaErr || srErr) { setError((metaErr || srErr)!.message); setLoading(false); return; }

    setMeta(metaData as ModuleTestMeta);
    setResults((srData ?? []) as StepResultRow[]);
    setError(null);
    setLoading(false);
  }, [moduleTestId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const real = useMemo(() => results.filter(r => !r.step?.isdivider), [results]);

  const stats = useMemo(() => {
    const pass    = real.filter(r => r.status === 'pass').length;
    const fail    = real.filter(r => r.status === 'fail').length;
    const pending = real.filter(r => r.status === 'pending').length;
    const total   = real.length;
    return {
      pass, fail, pending, total,
      passRate: total > 0 ? Math.round((pass / total) * 100) : 0,
      failPct:  total > 0 ? Math.round((fail / total) * 100) : 0,
      pendingPct: total > 0 ? 100 - Math.round((pass / total) * 100) - Math.round((fail / total) * 100) : 0,
    };
  }, [real]);

  // ── Chart data (single row — this is a single test) ───────────────────────
  const chartData = useMemo<ChartRow[]>(() => [{
    name:    meta?.test?.name ?? meta?.testsname ?? 'Test',
    pass:    stats.pass,
    fail:    stats.fail,
    pending: stats.pending,
  }], [meta, stats]);

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
        title={meta.test?.name ?? meta.testsname}
        subtitle={`${meta.modulename} · ${stats.total} steps`}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportTestReportCSV(results, meta)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition">
              <FileSpreadsheet size={13} />CSV
            </button>
            <button onClick={() => exportTestReportPDF(results, meta)}
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
          {/* 2.1-B1 — SegmentedBar imported from UI/ */}
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
              if (r.step?.isdivider) return (
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
                        <span className="font-mono text-[11px] text-c-brand font-bold">{r.step?.serialno}</span>
                        <span className="text-sm text-t-primary truncate">{r.step?.action}</span>
                      </div>
                      {!isExpanded && r.step?.expectedresult && (
                        <p className="text-xs text-t-muted mt-0.5 truncate">{r.step.expectedresult}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-t-muted mt-1">
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 pl-7 flex flex-col gap-2 text-xs text-t-muted border-t border-[var(--border-color)] pt-3">
                      <div><span className="font-semibold text-t-primary">Expected: </span>{r.step?.expectedresult}</div>
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
