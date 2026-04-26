// src/components/UI/LockWarningBanner.tsx
// Displays all active test locks — current user's (cyan) and others' (amber).
// Uses CSS custom properties for lock colors so ThemeEditor can override them.

import React, { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { AlertTriangle, Lock } from "lucide-react";
import type { ActiveLock } from "../../types";

interface Props {
  locks: ActiveLock[]; // current user's locks
  otherLockedModules: Map<string, number>; // module_name → count (other users)
  onNavigate: (page: string, module_name?: string) => void;
}

const LockWarningBanner: React.FC<Props> = ({
  locks,
  otherLockedModules,
  onNavigate,
}) => {
  const bannerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!bannerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        bannerRef.current,
        { opacity: 0, y: -8 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
      );
    });
    return () => ctx.revert();
  }, []);

  const totalOther = Array.from(otherLockedModules.values()).reduce(
    (a, b) => a + b,
    0
  );
  const totalAll = locks.length + totalOther;

  if (totalAll === 0) return null;

  return (
    <div
      ref={bannerRef}
      className="rounded-xl border px-4 py-3 flex flex-col gap-3"
      style={{
        background: "color-mix(in srgb, var(--text-muted) 6%, transparent)",
        borderColor: "color-mix(in srgb, var(--text-muted) 20%, transparent)",
      }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0 text-t-muted" />
        <span className="text-sm font-bold tracking-wide text-t-primary">
          All active locks
          <span className="ml-2 text-[11px] font-semibold text-t-muted">
            ({totalAll} total)
          </span>
        </span>
      </div>

      {/* ── My locks (cyan) ────────────────────────────────────────────────── */}
      {locks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p
            className="text-[11px] font-bold uppercase tracking-widest pl-1"
            style={{ color: "var(--color-my-lock)" }}
          >
            Locked by me
          </p>
          {locks.map((lock) => (
            <div
              key={lock.module_test_id}
              className="flex items-center justify-between gap-3 flex-wrap pl-2"
            >
              <div
                className="flex items-center gap-2 text-xs"
                style={{
                  color: "color-mix(in srgb, var(--color-my-lock) 80%, white)",
                }}
              >
                <Lock size={11} className="shrink-0" />
                <span>
                  <span className="font-semibold">{lock.module_name}</span>
                  <span className="mx-1 opacity-50">›</span>
                  {lock.test_name}
                </span>
              </div>
              <button
                onClick={() => onNavigate("module", lock.module_name)}
                className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition-colors"
                style={{
                  color: "var(--color-my-lock)",
                  borderColor:
                    "color-mix(in srgb, var(--color-my-lock) 50%, transparent)",
                  background:
                    "color-mix(in srgb, var(--color-my-lock) 12%, transparent)",
                }}
              >
                Resume
              </button>
            </div>
          ))}
          <p
            className="pl-2 text-[11px] leading-snug mt-0.5"
            style={{
              color:
                "color-mix(in srgb, var(--color-my-lock) 75%, transparent)",
              opacity: 0.75,
            }}
          >
            Please finish or release{" "}
            {locks.length === 1 ? "this test" : "these tests"} before signing
            out — the lock will block other testers.
          </p>
        </div>
      )}

      {/* ── Divider (only when both sections present) ──────────────────────── */}
      {locks.length > 0 && totalOther > 0 && (
        <div
          className="border-t"
          style={{ borderColor: "var(--border-color)" }}
        />
      )}

      {/* ── Others' locks (amber) ──────────────────────────────────────────── */}
      {totalOther > 0 && (
        <div className="flex flex-col gap-1.5">
          <p
            className="text-[11px] font-bold uppercase tracking-widest pl-1"
            style={{ color: "var(--color-other-lock)" }}
          >
            Locked by others
          </p>
          {Array.from(otherLockedModules.entries()).map(
            ([moduleName, count]) => (
              <div
                key={moduleName}
                className="flex items-center justify-between gap-3 flex-wrap pl-2"
              >
                <div
                  className="flex items-center gap-2 text-xs"
                  style={{
                    color:
                      "color-mix(in srgb, var(--color-other-lock) 80%, white)",
                  }}
                >
                  <Lock size={11} className="shrink-0" />
                  <span>
                    <span className="font-semibold">{moduleName}</span>
                    <span className="mx-1.5 opacity-50">·</span>
                    <span className="opacity-75">
                      {count} test{count > 1 ? "s" : ""} locked
                    </span>
                  </span>
                </div>
                <button
                  onClick={() => onNavigate("module", moduleName)}
                  className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition-colors"
                  style={{
                    color: "var(--color-other-lock)",
                    borderColor:
                      "color-mix(in srgb, var(--color-other-lock) 50%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-other-lock) 12%, transparent)",
                  }}
                >
                  View
                </button>
              </div>
            )
          )}
          <p
            className="pl-2 text-[11px] leading-snug mt-0.5"
            style={{
              color:
                "color-mix(in srgb, var(--color-other-lock) 75%, transparent)",
              opacity: 0.75,
            }}
          >
            These tests are currently in use by other testers and cannot be
            edited.
          </p>
        </div>
      )}
    </div>
  );
};

export default LockWarningBanner;
