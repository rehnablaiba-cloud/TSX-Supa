/**
 * TestReport.tsx
 * Session History Only — shows today's executed tests with revision badges
 */
import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import FadeWrapper from "../UI/FadeWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useInjectStyle } from "../../utils/animation";
import { exportReportCSV, exportReportPDF } from "../../utils/export";
import { getChartTheme } from "../../utils/chartTheme";
import { RBarChart } from "../ModuleDashboard/charts";
import type { ChartRow } from "../ModuleDashboard/charts/types";
import {
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  User,
  ChevronRight,
  X,
  FileSpreadsheet,
  FileText,
  Upload,
} from "lucide-react";
import {
  useSessionHistory,
  useModuleOptions,
  type SessionHistoryEntry,
  type SessionGroup,
  type ModuleOption,
} from "../../lib/hooks";

// ─── Constants ─────────────────────────────────────────────────────────────────
const SESSION_STORAGE_KEY = "testreport_session_start";

const STATUS_ICON: Record<string, React.ReactNode> = {
  pass:    <CheckCircle2 size={13} className="text-pass shrink-0" />,
  fail:    <XCircle      size={13} className="text-fail shrink-0" />,
  pending: <Clock        size={13} className="text-pend shrink-0" />,
};

const STATUS_BADGE: Record<string, React.CSSProperties> = {
  pass: {
    background: "color-mix(in srgb, var(--color-pass) 10%, transparent)",
    color:      "var(--color-pass)",
    border:     "1px solid color-mix(in srgb, var(--color-pass) 25%, transparent)",
  },
  fail: {
    background: "color-mix(in srgb, var(--color-fail) 10%, transparent)",
    color:      "var(--color-fail)",
    border:     "1px solid color-mix(in srgb, var(--color-fail) 25%, transparent)",
  },
  pending: {
    background: "color-mix(in srgb, var(--color-pend) 10%, transparent)",
    color:      "var(--color-pend)",
    border:     "1px solid color-mix(in srgb, var(--color-pend) 25%, transparent)",
  },
};

function getOrCreateSessionStart(): string {
  const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const iso = startOfDay.toISOString();
  sessionStorage.setItem(SESSION_STORAGE_KEY, iso);
  return iso;
}

function clearSessionStart() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

// ─── Revision Badge ───────────────────────────────────────────────────────────
const RevisionTag: React.FC<{ revision: string }> = ({ revision }) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
      text-[10px] font-bold uppercase tracking-wider select-none shrink-0"
    style={{
      background: "color-mix(in srgb, var(--color-warn) 12%, transparent)",
      color:      "color-mix(in srgb, var(--color-warn), black 15%)",
      border:     "1px solid color-mix(in srgb, var(--color-warn) 30%, transparent)",
    }}
  >
    <GitBranch size={9} className="shrink-0" />
    {revision}
  </span>
);

// ─── Session Detail Modal ──────────────────────────────────────────────────────
interface SessionModalProps {
  group:   SessionGroup;
  onClose: () => void;
}

const SessionDetailModal: React.FC<SessionModalProps> = ({ group, onClose }) => {
  const sorted = useMemo(
    () =>
      [...group.steps].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ),
    [group.steps]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        backgroundColor: "rgba(0,0,0,0.6)",
        backdropFilter:  "blur(var(--glass-blur))",
      }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-3xl max-h-[80vh] rounded-2xl
          bg-bg-card border border-(--border-color) shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-(--border-color)">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-t-primary">{group.test_name}</p>
              {group.revision && <RevisionTag revision={group.revision} />}
            </div>
            <p className="text-xs text-t-muted">{group.module_name}</p>
          </div>
          <div className="flex items-center gap-2">
            {[
              {
                label: "Pass",
                style: {
                  color:      "var(--color-pass)",
                  background: "color-mix(in srgb, var(--color-pass) 10%, transparent)",
                  border:     "1px solid color-mix(in srgb, var(--color-pass) 25%, transparent)",
                } as React.CSSProperties,
                count: group.pass,
              },
              {
                label: "Fail",
                style: {
                  color:      "var(--color-fail)",
                  background: "color-mix(in srgb, var(--color-fail) 10%, transparent)",
                  border:     "1px solid color-mix(in srgb, var(--color-fail) 25%, transparent)",
                } as React.CSSProperties,
                count: group.fail,
              },
              {
                label: "Undo",
                style: {
                  color:      "var(--color-pend)",
                  background: "color-mix(in srgb, var(--color-pend) 10%, transparent)",
                  border:     "1px solid color-mix(in srgb, var(--color-pend) 25%, transparent)",
                } as React.CSSProperties,
                count: group.undo,
              },
            ].map(({ label, style, count }) => (
              <span
                key={label}
                className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                style={style}
              >
                {label}: {count}
              </span>
            ))}
            <button
              onClick={onClose}
              className="ml-2 p-1.5 rounded-lg hover:bg-bg-surface text-t-muted
                hover:text-t-primary transition"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Scrollable table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-card z-10">
              <tr className="text-t-muted uppercase">
                <th className="px-4 py-2.5 text-left">Updated</th>
                <th className="px-4 py-2.5 text-left">Test</th>
                <th className="px-4 py-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border-color)">
              {sorted.map((step) => (
                <tr key={step.id} className="hover:bg-bg-surface transition-colors">
                  <td className="px-4 py-2.5 text-t-muted font-mono text-[11px]">
                    {new Date(step.updated_at).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2.5 text-t-primary">{step.test_name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full"
                      style={STATUS_BADGE[step.status] ?? STATUS_BADGE.pending}
                    >
                      {STATUS_ICON[step.status]}
                      {step.status === "pending" ? "undo" : step.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-(--border-color) text-xs text-t-muted">
          {group.total} execution{group.total !== 1 ? "s" : ""} this session
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT — Session History Only
// ══════════════════════════════════════════════════════════════════════════════

const TestReport: React.FC = () => {
  useInjectStyle();
  const { theme } = useTheme();
  const { user }  = useAuth();
  const ct        = useMemo(() => getChartTheme(theme), [theme]);

  const sessionUser = user?.display_name ?? user?.email ?? null;

  // ── State ─────────────────────────────────────────────────────────────────
  const [selectedModuleName, setSelectedModuleName] = useState<string | null>(null);
  const [activeGroup,        setActiveGroup]         = useState<SessionGroup | null>(null);
  const [showExportModal,    setShowExportModal]     = useState(false);

  // ── Clear session on sign-out ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) clearSessionStart();
  }, [user]);

  // ── Queries (cache — no manual fetches) ───────────────────────────────────
  const sessionStart = useMemo(() => getOrCreateSessionStart(), []);

  const historyQuery       = useSessionHistory(sessionUser ?? "", sessionStart, {
    enabled: !!sessionUser,
  });
  const moduleOptionsQuery = useModuleOptions();

  const history       = historyQuery.data      ?? [];
  const moduleOptions = moduleOptionsQuery.data ?? [];
  const loading       = historyQuery.isLoading;
  const error         = historyQuery.isError
    ? (historyQuery.error instanceof Error ? historyQuery.error.message : "Failed to load")
    : null;

  // ── Group by test (module + serial_no) ────────────────────────────────────
  const sessionGroups = useMemo<SessionGroup[]>(() => {
    if (!history.length) return [];
    const map = new Map<string, SessionGroup>();

    history
      .filter((s) => !s.is_divider)
      .forEach((s) => {
        const key = `${s.module_name}::${s.tests_serial_no}`;
        if (!map.has(key)) {
          map.set(key, {
            module_name:     s.module_name,
            tests_serial_no: s.tests_serial_no,
            test_name:       s.test_name,
            revision:        s.revision,
            steps:           [],
            pass:            0,
            fail:            0,
            undo:            0,
            total:           0,
            last_updated:    s.updated_at,
          });
        }
        const g = map.get(key)!;
        g.steps.push(s);
        g.total++;
        if (s.status === "pass")         g.pass++;
        else if (s.status === "fail")    g.fail++;
        else if (s.status === "pending") g.undo++;
        if (new Date(s.updated_at) > new Date(g.last_updated))
          g.last_updated = s.updated_at;
      });

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
    );
  }, [history]);

  // ── Filtered groups ───────────────────────────────────────────────────────
  const displayGroups = useMemo(
    () =>
      selectedModuleName
        ? sessionGroups.filter((g) => g.module_name === selectedModuleName)
        : sessionGroups,
    [sessionGroups, selectedModuleName]
  );

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = useMemo<ChartRow[]>(
    () =>
      displayGroups.map((g) => ({
        name:    g.test_name,
        pass:    g.pass,
        fail:    g.fail,
        pending: g.undo,
      })),
    [displayGroups]
  );

  // ── Export stats — derived from cache, no FlatData shim ──────────────────
  const exportStats = useMemo(() => {
    const nd = history.filter((s) => !s.is_divider);
    return [
      { label: "Total Steps", value: nd.length },
      { label: "Pass",        value: nd.filter((s) => s.status === "pass").length },
      { label: "Fail",        value: nd.filter((s) => s.status === "fail").length },
    ];
  }, [history]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title="Session History" />
        <div className="flex items-center justify-center flex-1">
          <Spinner />
        </div>
      </div>
    );

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title="Session History" />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-sm font-medium" style={{ color: "var(--color-fail)" }}>
            {error}
          </p>
          <button
            onClick={() => historyQuery.refetch()}
            className="px-4 py-2 rounded-xl bg-bg-card hover:bg-bg-surface text-sm
              text-t-secondary border border-(--border-color) transition"
          >
            Retry
          </button>
        </div>
      </div>
    );

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!sessionUser || sessionGroups.length === 0)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title="Session History" />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <User size={32} className="text-t-muted" />
          <p className="text-sm text-t-muted">
            {sessionUser ? "No tests executed today" : "Sign in to view session history"}
          </p>
        </div>
      </div>
    );

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <>
      {activeGroup && (
        <SessionDetailModal group={activeGroup} onClose={() => setActiveGroup(null)} />
      )}

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Report"
        subtitle="Session Log"
        stats={exportStats}
        options={[
          {
            label:      "CSV",
            icon:       <FileSpreadsheet size={16} />,
            color:      "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm:  () => exportReportCSV(history),
          },
          {
            label:      "PDF",
            icon:       <FileText size={16} />,
            color:      "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm:  () => exportReportPDF(history),
          },
        ]}
      />

      <Topbar
        title="Session History"
        subtitle={`${sessionGroups.length} test${sessionGroups.length !== 1 ? "s" : ""} executed today`}
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowExportModal(true)}
              disabled={history.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-bg-card hover:bg-bg-surface
                disabled:opacity-40 disabled:cursor-not-allowed text-t-primary
                text-sm font-semibold rounded-lg transition border border-(--border-color)"
            >
              <Upload size={14} /> Export
            </button>
            <select
              value={selectedModuleName ?? ""}
              onChange={(e) => setSelectedModuleName(e.target.value || null)}
              className="input text-sm"
            >
              <option value="">All Modules</option>
              {moduleOptions.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="p-6 flex flex-col gap-6 pb-24 md:pb-6">
        {/* ── Summary Chart ─────────────────────────────────────────────── */}
        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-t-primary">Today's Activity</p>
          </div>
          <FadeWrapper animKey="session-chart">
            <RBarChart data={chartData} ct={ct} />
          </FadeWrapper>
        </div>

        {/* ── Session Panel ─────────────────────────────────────────────── */}
        <div className="card flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            <User size={14} className="text-c-brand" />
            <p className="text-sm font-semibold text-t-primary">Your Session</p>
            <span className="ml-auto text-xs text-t-muted">{sessionUser}</span>
          </div>

          {/* Summary pills */}
          <div className="flex gap-2">
            {[
              {
                label: "Pass",
                style: {
                  color:      "var(--color-pass)",
                  background: "color-mix(in srgb, var(--color-pass) 10%, transparent)",
                  border:     "1px solid color-mix(in srgb, var(--color-pass) 25%, transparent)",
                } as React.CSSProperties,
                count: sessionGroups.reduce((n, g) => n + g.pass, 0),
              },
              {
                label: "Fail",
                style: {
                  color:      "var(--color-fail)",
                  background: "color-mix(in srgb, var(--color-fail) 10%, transparent)",
                  border:     "1px solid color-mix(in srgb, var(--color-fail) 25%, transparent)",
                } as React.CSSProperties,
                count: sessionGroups.reduce((n, g) => n + g.fail, 0),
              },
              {
                label: "Undo",
                style: {
                  color:      "var(--color-pend)",
                  background: "color-mix(in srgb, var(--color-pend) 10%, transparent)",
                  border:     "1px solid color-mix(in srgb, var(--color-pend) 25%, transparent)",
                } as React.CSSProperties,
                count: sessionGroups.reduce((n, g) => n + g.undo, 0),
              },
            ].map(({ label, style, count }) => (
              <span
                key={label}
                className="text-xs font-bold px-3 py-1 rounded-full"
                style={style}
              >
                {label}: {count}
              </span>
            ))}
          </div>

          {/* Test rows */}
          <div className="flex flex-col gap-1 pt-1 border-t border-(--border-color)">
            {displayGroups.map((g) => (
              <button
                key={`${g.module_name}::${g.tests_serial_no}`}
                onClick={() => setActiveGroup(g)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg
                  bg-bg-base hover:bg-bg-surface border border-(--border-color)
                  transition-colors text-left group"
              >
                {/* Module tag */}
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-c-brand-bg text-c-brand shrink-0">
                  {g.module_name}
                </span>

                {/* Test name */}
                <span className="flex-1 text-xs font-semibold text-t-primary truncate">
                  {g.test_name}
                </span>

                {/* Revision badge */}
                {g.revision && <RevisionTag revision={g.revision} />}

                {/* Counts */}
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] font-bold text-t-muted">{g.total}</span>
                  {g.pass > 0 && (
                    <span className="text-[11px] font-bold" style={{ color: "var(--color-pass)" }}>
                      {g.pass}✓
                    </span>
                  )}
                  {g.fail > 0 && (
                    <span className="text-[11px] font-bold" style={{ color: "var(--color-fail)" }}>
                      {g.fail}✗
                    </span>
                  )}
                  {g.undo > 0 && (
                    <span className="text-[11px] font-bold" style={{ color: "var(--color-pend)" }}>
                      {g.undo}↩
                    </span>
                  )}
                </span>

                <ChevronRight
                  size={13}
                  className="text-t-muted group-hover:text-t-primary transition-colors shrink-0"
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default TestReport;