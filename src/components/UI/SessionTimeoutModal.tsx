import React from "react";
import { Clock, LogOut, RefreshCw } from "lucide-react";

interface Props {
  secondsLeft: number;
  onStay:      () => void;
  onSignOut:   () => void;
}

const SessionTimeoutModal: React.FC<Props> = ({ secondsLeft, onStay, onSignOut }) => {
  const mins    = Math.floor(secondsLeft / 60);
  const secs    = secondsLeft % 60;
  const display = `${mins}:${String(secs).padStart(2, "0")}`;
  const urgent  = secondsLeft <= 60;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Card */}
      <div className="relative w-full max-w-sm mx-4 bg-bg-surface border border-[var(--border-color)] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl z-10">

        {/* Icon + title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors
            ${urgent ? "bg-red-500/20" : "bg-amber-500/20"}`}>
            <Clock
              size={28}
              className={`transition-colors ${urgent ? "text-red-400" : "text-amber-400"}`}
            />
          </div>

          <div>
            <h2 className="text-lg font-bold text-t-primary">Session Expiring</h2>
            <p className="text-sm text-t-muted mt-1">
              No activity detected. You'll be logged out in:
            </p>
          </div>

          {/* Countdown */}
          <div
            className={`text-5xl font-mono font-bold tabular-nums transition-colors
              ${urgent ? "text-red-400" : "text-amber-400"}`}
          >
            {display}
          </div>

          {urgent && (
            <p className="text-xs text-red-400 font-medium animate-pulse">
              Your test lock will also be released.
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full bg-bg-card overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000
              ${urgent ? "bg-red-500" : "bg-amber-500"}`}
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
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-color)]
              text-t-secondary hover:text-red-400 hover:border-red-400/40
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