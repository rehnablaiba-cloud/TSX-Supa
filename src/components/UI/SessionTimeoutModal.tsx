import React from "react";
import { Clock, LogOut, RefreshCw } from "lucide-react";

interface Props {
  secondsLeft: number;
  onStay: () => void;
  onSignOut: () => void;
}

const SessionTimeoutModal: React.FC<Props> = ({
  secondsLeft,
  onStay,
  onSignOut,
}) => {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const display = `${mins}:${String(secs).padStart(2, "0")}`;
  const urgent = secondsLeft <= 60;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-dim">
      {/* Card */}
      <div className="relative w-full max-w-sm mx-4 glass-frost p-6 flex flex-col gap-5 shadow-2xl z-10">
        {/* Icon + title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors
            ${urgent ? "bg-fail/20" : "bg-[color-mix(in_srgb,var(--color-warn)_20%,transparent)]"}`}
          >
            <Clock
              size={28}
              className={`transition-colors ${
                urgent ? "text-fail" : "text-(--color-warn)"
              }`}
            />
          </div>

          <div>
            <h2 className="text-lg font-bold text-t-primary">
              Session Expiring
            </h2>
            <p className="text-sm text-t-muted mt-1">
              No activity detected. You'll be logged out in:
            </p>
          </div>

          {/* Countdown */}
          <div
            className={`text-5xl font-mono font-bold tabular-nums transition-colors
            ${urgent ? "text-fail" : "text-(--color-warn)"}`}
          >
            {display}
          </div>

          {urgent && (
            <p className="text-xs text-fail font-medium animate-pulse">
              Your test lock will also be released.
            </p>
          )}
        </div>

        {/* Progress bar — drains from full to empty */}
        <div className="w-full h-1.5 rounded-full bg-bg-card overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000
              ${urgent ? "bg-fail" : "bg-(--color-warn)"}`}
            style={{ width: `${(secondsLeft / (5 * 60)) * 100}%` }}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onStay}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
          >
            <RefreshCw size={15} />
            Stay Logged In
          </button>
          <button
            onClick={onSignOut}
            className="w-full px-4 py-2.5 rounded-xl border border-(--border-color)
              text-t-secondary hover:text-fail hover:border-[color-mix(in_srgb,var(--color-fail)_40%,transparent)]
              text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={15} />
            Sign Out Now
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionTimeoutModal;
