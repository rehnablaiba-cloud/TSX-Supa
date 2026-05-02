// src/components/Dashboard/ModuleCard.tsx
import React from "react";
import { Lock } from "lucide-react";
import type { DashboardModuleSummary } from "../../lib/hooks";

// ─── ModuleCard ───────────────────────────────────────────────────────────────
interface ModuleCardProps {
  module:         DashboardModuleSummary;
  myLockCount:    number;
  otherLockCount: number;
  cardStyle?:     React.CSSProperties;
  onClick:        () => void;
}

// ─── SegmentedBar ─────────────────────────────────────────────────────────────
interface SegmentedBarProps {
  passRate:   number;
  failPct:    number;
  pendingPct: number;
}

const SegmentedBar: React.FC<SegmentedBarProps> = ({ passRate, failPct, pendingPct }) => (
  <div
    className="h-2 rounded-full overflow-hidden flex gap-px"
    style={{ background: "var(--bg-surface)" }}
  >
    {([
      { pct: passRate,   color: "var(--color-pass)" },
      { pct: failPct,    color: "var(--color-fail)" },
      { pct: pendingPct, color: "var(--text-muted)" },
    ] as const).map((seg, i) =>
      seg.pct > 0 ? (
        <div
          key={i}
          style={{
            width:      `${seg.pct}%`,
            background: seg.color,
            height:     "100%",
            transition: "width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
      ) : null
    )}
  </div>
);

// ─── Per-card error boundary ───────────────────────────────────────────────────
class CardErrorBoundary extends React.Component<
  { children: React.ReactNode; name: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }

  render() {
    if (this.state.hasError)
      return (
        <div
          className="card flex flex-col items-center justify-center gap-2 text-center min-h-[160px]"
          style={{ borderColor: "color-mix(in srgb, var(--color-fail) 30%, transparent)" }}
        >
          <span className="text-xs font-semibold text-t-muted truncate max-w-full px-2">
            {this.props.name}
          </span>
          <span className="text-[11px] text-t-muted opacity-60">
            Failed to render — refresh to retry
          </span>
        </div>
      );
    return this.props.children;
  }
}

// ─── Inner card ───────────────────────────────────────────────────────────────
const ModuleCardInner: React.FC<ModuleCardProps> = ({
  module, myLockCount, otherLockCount, cardStyle, onClick,
}) => {
  const { pass, fail, pending, total, test_count } = module;

  const passRate   = total > 0 ? Math.round((pass    / total) * 100) : 0;
  const failPct    = total > 0 ? Math.round((fail    / total) * 100) : 0;
  const pendingPct = total > 0 ? Math.round((pending / total) * 100) : 0;

  const passLabelColor =
    total === 0      ? "var(--text-muted)" :
    passRate === 100 ? "var(--color-pass)" :
    failPct  === 100 ? "var(--color-fail)" :
                       "var(--text-primary)";

  return (
    <button
      onClick={onClick}
      className="card text-left hover:border-c-brand/50 hover:shadow-xl transition-all duration-300 cursor-pointer group"
      style={cardStyle}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <span
          className="w-3 h-3 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: "var(--color-brand)" }}
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-t-primary group-hover:text-c-brand transition-colors truncate">
            {module.name}
          </h3>
          {module.description && (
            <p className="text-xs text-t-muted mt-0.5 truncate">{module.description}</p>
          )}
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {myLockCount > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
              style={{
                color:       "var(--color-my-lock)",
                borderColor: "color-mix(in srgb, var(--color-my-lock) 40%, transparent)",
                background:  "color-mix(in srgb, var(--color-my-lock) 10%, transparent)",
              }}
            >
              <Lock size={9} /> {myLockCount} My Lock{myLockCount > 1 ? "s" : ""}
            </span>
          )}
          {otherLockCount > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
              style={{
                color:       "var(--color-pend)",
                borderColor: "color-mix(in srgb, var(--color-pend) 53%, transparent)",
                background:  "color-mix(in srgb, var(--color-pend) 10%, transparent)",
              }}
            >
              <Lock size={9} /> {otherLockCount} Locked
            </span>
          )}
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap tracking-wide"
            style={{
              color:       "var(--color-brand)",
              borderColor: "var(--color-brand)",
              background:  "color-mix(in srgb, var(--color-brand) 8%, transparent)",
            }}
          >
            {test_count} {test_count === 1 ? "Test" : "Tests"}
          </span>
        </div>
      </div>

      {/* Pass / Fail / Pending / Total badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="badge-pass">
          <span className="w-1.5 h-1.5 rounded-full bg-pass inline-block mr-1" />
          {pass} Pass
        </span>
        <span className="badge-fail">
          <span className="w-1.5 h-1.5 rounded-full bg-fail inline-block mr-1" />
          {fail} Fail
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-t-muted bg-bg-card border border-(--border-color) rounded-full px-2.5 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-(--text-muted) inline-block" />
          {pending} Pending
        </span>
        <span
          className="flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-0.5 border"
          style={{
            color:       "var(--text-primary)",
            borderColor: "var(--border-color)",
            background:  "var(--bg-surface)",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "var(--color-brand)" }} />
          {total} Total
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-1">
        <div className="flex justify-between text-xs text-t-muted mb-1">
          <span>Progress</span>
          <span className="font-semibold tabular-nums" style={{ color: passLabelColor }}>
            {total > 0 ? `${passRate}%` : "—"}
          </span>
        </div>
        <SegmentedBar passRate={passRate} failPct={failPct} pendingPct={pendingPct} />
      </div>
    </button>
  );
};

// Wrap with per-card error boundary
const ModuleCard: React.FC<ModuleCardProps> = (props) => (
  <CardErrorBoundary name={props.module.name}>
    <ModuleCardInner {...props} />
  </CardErrorBoundary>
);

export default ModuleCard;