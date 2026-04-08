import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabase";

const IDLE_MS    = 15_000;       
const WARNING_MS = 5 * 60_000;  // 5 min countdown before auto-logout

export function useSessionTimeout(
  userId: string | undefined,
  onSignOut: () => Promise<void>,
) {
  const [warning,     setWarning]     = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(WARNING_MS / 1000));

  const idleTimer  = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const countdown  = useRef<ReturnType<typeof setInterval> | null>(null);
  const inWarning  = useRef(false);
  const secLeft    = useRef(Math.floor(WARNING_MS / 1000));

  // Always-fresh refs — avoids stale closures in event listeners
  const userIdRef       = useRef(userId);
  const onSignOutRef    = useRef(onSignOut);
  useEffect(() => { userIdRef.current    = userId;    }, [userId]);
  useEffect(() => { onSignOutRef.current = onSignOut; }, [onSignOut]);

  // ── Clear both timers ───────────────────────────────────────────────
  const clearTimers = useCallback(() => {
    if (idleTimer.current) { clearTimeout(idleTimer.current);  idleTimer.current = null; }
    if (countdown.current) { clearInterval(countdown.current); countdown.current = null; }
  }, []);

  // ── Release lock + sign out ─────────────────────────────────────────
  const releaseAndSignOut = useCallback(async () => {
    clearTimers();
    const uid = userIdRef.current;
    if (uid) {
      await supabase.from("test_locks").delete().eq("user_id", uid);
    }
    await onSignOutRef.current();
  }, [clearTimers]);

  // ── Start the 5-min warning countdown ──────────────────────────────
  const startWarning = useCallback(() => {
    inWarning.current = true;
    secLeft.current   = Math.floor(WARNING_MS / 1000);
    setWarning(true);
    setSecondsLeft(secLeft.current);

    countdown.current = setInterval(() => {
      secLeft.current -= 1;
      setSecondsLeft(secLeft.current);
      if (secLeft.current <= 0) {
        releaseAndSignOut();
      }
    }, 1000);
  }, [releaseAndSignOut]);

  // ── Reset idle timer on activity (no-op during warning) ────────────
  const resetIdleTimer = useCallback(() => {
    if (inWarning.current) return;
    clearTimers();
    idleTimer.current = setTimeout(startWarning, IDLE_MS);
  }, [clearTimers, startWarning]);

  // Keep a ref so the event listener always calls the latest version
  const resetIdleTimerRef = useRef(resetIdleTimer);
  useEffect(() => { resetIdleTimerRef.current = resetIdleTimer; }, [resetIdleTimer]);

  // ── "Stay logged in" — dismiss warning, restart idle timer ─────────
  const stayLoggedIn = useCallback(() => {
    clearTimers();
    inWarning.current = false;
    secLeft.current   = Math.floor(WARNING_MS / 1000);
    setWarning(false);
    setSecondsLeft(secLeft.current);
    if (userIdRef.current) {
      idleTimer.current = setTimeout(startWarning, IDLE_MS);
    }
  }, [clearTimers, startWarning]);

  // ── Wire up activity listeners ──────────────────────────────────────
  useEffect(() => {
    if (!userId) {
      clearTimers();
      inWarning.current = false;
      setWarning(false);
      return;
    }

    // Use ref so the listener is never stale — no eslint-disable needed
    const onActivity = () => resetIdleTimerRef.current();

    const POINTER_EVENTS = [
      "mousemove", "mousedown", "keydown", "touchstart",
    ] as const;

    POINTER_EVENTS.forEach(e =>
      document.addEventListener(e, onActivity, { passive: true })
    );

    // scroll via window + capture:true catches overflow-container scrolls
    // that do NOT bubble up to document
    window.addEventListener("scroll", onActivity, { passive: true, capture: true });

    // Kick off the initial idle timer
    idleTimer.current = setTimeout(startWarning, IDLE_MS);

    return () => {
      POINTER_EVENTS.forEach(e => document.removeEventListener(e, onActivity));
      window.removeEventListener("scroll", onActivity, { capture: true });
      clearTimers();
    };
  }, [userId, clearTimers, startWarning]); // no suppressions needed now

  return { warning, secondsLeft, stayLoggedIn, releaseAndSignOut };
}