// src/components/ModuleDashboard/TestCard.tsx
import React from "react";
import {
  Lock,
  Unlock,
  Play,
  Eye,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { useCountUp } from "../../hooks/useCountUp";
import type { ActiveRevision, LockRow, ModuleTestRow } from "./ModuleDashboard.types";

// ─── Shimmer style (injected once) ───────────────────────────────────────────
const CARD_STYLE = `
@keyframes shimmerSweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes neonPulse {
  0%,100% { box-shadow: 0 0 0 1.5px rgba(var(--neon-cyan),0.45), 0 0 12px 2px rgba(var(--neon-cyan),0.18); }
  50%      { box-shadow: 0 0 0 1.5px rgba(var(--neon-cyan),0.45), 0 0 22px 6px rgba(var(--neon-cyan),0.32); }
}
@keyframes amberPulse {
  0%,100% { box-shadow: 0 0 0 1.5px rgba(var(--neon-amber),0.45), 0 0 12px 2px rgba(var(--neon-amber),0.18); }
  50%      { box-shadow: 0 0 0 1.5px rgba(var(--neon-amber),0.45), 0 0 22px 6px rgba(var(--neon-amber),0.32); }
}
@keyframes greenPulse {
  0%,100% { box-shadow: 0 0 0 1.5px rgba(var(--neon-green),0.45), 0 0 12px 2px rgba(var(--neon-green),0.18); }
  50%      { box-shadow: 0 0 0 1.5px rgba(var(--neon-green),0.45), 0 0 22px 6px rgba(var(--neon-green),0.32); }
}
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const el = document.createElement("style");
  el.textContent = CARD_STYLE;
  document.head.appendChild(el);
}

// ─── Spring SegmentedBar ──────────────────────────────────────────────────────
interface BarProps {
  passRate:   number;
  failPct:    number;
  pendingPct: number;
  total:      number;
  refreshing: boolean;
}

const SpringBar: React.FC<BarProps> = ({
  passRate, failPct, pendingPct, total, refreshing,
}) => {
  // Show shimmer sweep while a background refresh is running and no data yet
  if (total === 0 && refreshing) {
    return (
      <div
        className="h-1.5 w-full rounded-full overflow-hidden relative"
        style={{ background: "var(--bg-surface)" }}
      >
        <div
          style={{
            position:   "absolute",
            inset:      0,
            background: "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-brand) 30%, transparent) 50%, transparent 100%)",
            animation:  "shimmerSweep 1.4s ease-in-out infinite",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="h-1.5 w-full rounded-full overflow-hidden flex"
      style={{ background: "var(--bg-surface)" }}
    >
      {passRate > 0 && (
        <div
          className="h-full"
          style={{
            width:      `${passRate}%`,
            background: "var(--color-pass)",
            // Spring overshoot — bar feels alive on each update
            transition: "width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
      )}
      {failPct > 0 && (
        <div
          className="h-full"
          style={{
            width:      `${failPct}%`,
            background: "var(--color-fail)",
            transition: "width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
      )}
      {pendingPct > 0 && (
        <div
          className="h-full"
          style={{
            width:      `${pendingPct}%`,
            background: "var(--color-pend)",
            opacity:    0.3,
            transition: "width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
      )}
    </div>
  );
};

// ─── Per-card error boundary ──────────────────────────────────────────────────
class CardErrorBoundary extends React.Component<
  { children: React.ReactNode; name: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="card flex flex-col items-center justify-center gap-2 text-center min-h-[120px]"
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
    }
    return this.props.children;
  }
}

// ─── TestCardInner ────────────────────────────────────────────────────────────
interface TestCardProps {
  mt:             ModuleTestRow;
  lock?:          LockRow;
  isMyLock:       boolean;
  isOtherLock:    boolean;
  isCompleted:    boolean;
  activeRev:      ActiveRevision | null;
  isAdmin:        boolean;
  refreshing:     boolean;
  onExecute:      (id: string) => void;
  onViewReport:   (id: string) => void;
  onForceRelease: (id: string, name: string) => void;
}

const TestCardInner: React.FC<TestCardProps> = ({
  mt, lock, isMyLock, isOtherLock, isCompleted,
  activeRev, isAdmin, refreshing,
  onExecute, onViewReport, onForceRelease,
}) => {
  injectStyle();

  const real    = mt.step_results.filter((sr) => !sr.step?.is_divider);
  const pass    = real.filter((sr) => sr.status === "pass").length;
  const fail    = real.filter((sr) => sr.status === "fail").length;
  const pending = real.filter((sr) => sr.status === "pending").length;
  const total   = real.length;

  const passRate   = total > 0 ? Math.round((pass / total) * 100) : 0;
  const failPct    = total > 0 ? Math.round((fail / total) * 100) : 0;
  const pendingPct = Math.max(0, 100 - passRate - failPct);

  // Count-up: animate whenever refreshing (data arriving from RT/refetch)
  const displayPass    = useCountUp(pass,    400, refreshing);
  const displayFail    = useCountUp(fail,    400, refreshing);
  const displayPending = useCountUp(pending, 400, refreshing);
  const displayRate    = useCountUp(passRate, 400, refreshing);

  const cardStyle: React.CSSProperties = isMyLock
    ? {
        border:     "1.5px solid rgba(var(--neon-cyan), 0.55)",
        background: "linear-gradient(135deg, rgba(var(--neon-cyan), 0.07) 0%, transparent 60%)",
        animation:  "neonPulse 2.6s ease-in-out infinite",
      }
    : isOtherLock
    ? {
        border:     "1.5px solid rgba(var(--neon-amber), 0.55)",
        background: "linear-gradient(135deg, rgba(var(--neon-amber), 0.07) 0%, transparent 60%)",
        animation:  "amberPulse 2.6s ease-in-out infinite",
      }
    : isCompleted
    ? {
        border:     "1.5px solid rgba(var(--neon-green), 0.55)",
        background: "linear-gradient(135deg, rgba(var(--neon-green), 0.07) 0%, transparent 60%)",
        animation:  "greenPulse 2.6s ease-in-out infinite",
      }
    : {};

  return (
    <div
      className="card flex flex-col gap-3 relative transition-all duration-200"
      style={cardStyle}
    >
      {/* My-lock banner */}
      {isMyLock && lock && (
        <div className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg w-fit text-xs font-semibold text-[var(--color-my-lock)] border border-[color-mix(in_srgb,var(--color-my-lock)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-my-lock)_10%,transparent)]">
          <Lock size={11} className="text-[var(--color-my-lock)]" />
          <span>Locked by me</span>
          <span className="opacity-50">·</span>
          <span className="opacity-70">
            {new Date(lock.locked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      )}

      {/* Other-lock banner */}
      {isOtherLock && lock && (
        <div className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg w-fit text-xs font-semibold text-[var(--color-other-lock)] border border-[color-mix(in_srgb,var(--color-other-lock)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-other-lock)_10%,transparent)]">
          <Lock size={11} />
          <span>In use by {lock.locked_by_name}</span>
          <span className="opacity-50">·</span>
          <span className="opacity-70">
            {new Date(lock.locked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {isAdmin && (
            <>
              <span className="opacity-65 mx-0.5">|</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onForceRelease(mt.id, lock.locked_by_name);
                }}
                className="flex items-center gap-1 text-[11px] font-bold rounded-md px-1.5 py-0.5 transition-colors text-[var(--color-fail)] bg-[color-mix(in_srgb,var(--color-fail)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-fail)_30%,transparent)]"
              >
                <Unlock size={10} />
                Release
              </button>
            </>
          )}
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className="font-mono text-xs font-bold shrink-0"
            style={{ color: isMyLock ? "var(--color-my-lock)" : "var(--color-brand)" }}
          >
            {mt.test?.serial_no}
          </span>

          {activeRev && (
            <span
              className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{
                color:       "var(--color-warn)",
                background:  "color-mix(in srgb, var(--color-warn) 10%, transparent)",
                border:      "1px solid color-mix(in srgb, var(--color-warn) 35%, transparent)",
              }}
            >
              {activeRev.revision}
            </span>
          )}

          {isCompleted && (
            <span
              className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{
                color:      "var(--color-pass)",
                background: "color-mix(in srgb, var(--color-pass) 10%, transparent)",
                border:     "1px solid color-mix(in srgb, var(--color-pass) 35%, transparent)",
              }}
            >
              completed
            </span>
          )}

          <h3 className="font-semibold text-t-primary text-sm truncate">
            {mt.test?.name ?? mt.tests_name ?? "Unnamed Test"}
          </h3>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onViewReport(mt.id)}
            disabled={isOtherLock}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-secondary hover:text-t-primary disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={12} />
            Report
          </button>

          {isCompleted ? (
            <button
              onClick={() => onExecute(mt.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-c-brand hover:bg-c-brand-hover text-(--bg-surface)"
            >
              <Eye size={12} />
              View
            </button>
          ) : isMyLock ? (
            <button
              onClick={() => onExecute(mt.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-black"
              style={{
                background: "var(--color-my-lock)",
                boxShadow:  "0 0 14px 3px rgba(var(--neon-cyan), 0.40)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "0 0 20px 5px rgba(var(--neon-cyan), 0.55)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "0 0 14px 3px rgba(var(--neon-cyan), 0.40)";
              }}
            >
              <RotateCcw size={12} />
              Resume
            </button>
          ) : (
            <button
              onClick={() => onExecute(mt.id)}
              disabled={isOtherLock}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-c-brand hover:bg-c-brand-hover text-(--bg-surface) disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Play size={12} />
              Execute
            </button>
          )}
        </div>
      </div>

      {/* Stat badges with count-up */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="badge-pass">
          <span className="w-1.5 h-1.5 rounded-full inline-block mr-1" style={{ background: "var(--color-pass)" }} />
          {displayPass} Pass
        </span>
        <span className="badge-fail">
          <span className="w-1.5 h-1.5 rounded-full inline-block mr-1" style={{ background: "var(--color-fail)" }} />
          {displayFail} Fail
        </span>
        <span className="flex items-center gap-1 font-semibold text-t-muted bg-bg-card border border-(--border-color) rounded-full px-2.5 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "var(--text-muted)" }} />
          {displayPending} Pending
        </span>
      </div>

      {/* Spring progress bar */}
      <div>
        <div className="flex justify-between text-xs text-t-muted mb-1">
          <span>Progress</span>
          <span
            className="font-semibold tabular-nums"
            style={{
              color:
                passRate === 100 ? "var(--color-pass)" :
                failPct  === 100 ? "var(--color-fail)" :
                undefined,
            }}
          >
            {total > 0 ? `${displayRate}%` : "—"}
          </span>
        </div>
        <SpringBar
          passRate={passRate}
          failPct={failPct}
          pendingPct={pendingPct}
          total={total}
          refreshing={refreshing}
        />
      </div>
    </div>
  );
};

// Wrap with per-card error boundary
const TestCard: React.FC<TestCardProps> = (props) => (
  <CardErrorBoundary name={props.mt.test?.name ?? props.mt.tests_name ?? "Test"}>
    <TestCardInner {...props} />
  </CardErrorBoundary>
);

export default TestCard;
