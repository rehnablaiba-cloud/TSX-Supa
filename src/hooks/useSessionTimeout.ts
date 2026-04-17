// src/hooks/useSessionTimeout.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabase";

const IDLE_MS    = 60_000;
const WARNING_MS = 5 * 60_000;

export function useSessionTimeout(
  userId: string | undefined,
  onSignOut: () => Promise<void>,
) {
  const [warning,     setWarning]     = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(WARNING_MS / 1000));

  const idleTimer      = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const countdown      = useRef<ReturnType<typeof setInterval> | null>(null);
  const inWarning      = useRef(false);
  const secLeft        = useRef(Math.floor(WARNING_MS / 1000));

  // ── NEW: wall-clock anchors ──────────────────────────────────────────────
  const lastActivityAt = useRef<number>(Date.now()); // updated on every activity
  const warningStartAt = useRef<number | null>(null); // set when warning begins
  // ────────────────────────────────────────────────────────────────────────

  const userIdRef    = useRef(userId);
  const onSignOutRef = useRef(onSignOut);
  useEffect(() => { userIdRef.current    = userId;    }, [userId]);
  useEffect(() => { onSignOutRef.current = onSignOut; }, [onSignOut]);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) { clearTimeout(idleTimer.current);  idleTimer.current = null; }
    if (countdown.current) { clearInterval(countdown.current); countdown.current = null; }
  }, []);

  const releaseAndSignOut = useCallback(async () => {
    clearTimers();
    const uid = userIdRef.current;
    if (uid) await supabase.from("test_locks").delete().eq("user_id", uid);
    await onSignOutRef.current();
  }, [clearTimers]);

  const startWarning = useCallback(() => {
    inWarning.current    = true;
    warningStartAt.current = Date.now(); // ← anchor for background tab calc
    secLeft.current      = Math.floor(WARNING_MS / 1000);
    setWarning(true);
    setSecondsLeft(secLeft.current);

    countdown.current = setInterval(() => {
      // Use wall-clock so ticks that fire late still show the right number
      const elapsed = Date.now() - (warningStartAt.current ?? Date.now());
      const remaining = Math.max(0, Math.floor((WARNING_MS - elapsed) / 1000));
      secLeft.current = remaining;
      setSecondsLeft(remaining);
      if (remaining <= 0) releaseAndSignOut();
    }, 1000);
  }, [releaseAndSignOut]);

  const resetIdleTimer = useCallback(() => {
    if (inWarning.current) return;
    lastActivityAt.current = Date.now(); // ← record when activity happened
    clearTimers();
    idleTimer.current = setTimeout(startWarning, IDLE_MS);
  }, [clearTimers, startWarning]);

  const resetIdleTimerRef = useRef(resetIdleTimer);
  useEffect(() => { resetIdleTimerRef.current = resetIdleTimer; }, [resetIdleTimer]);

  const stayLoggedIn = useCallback(() => {
    clearTimers();
    inWarning.current      = false;
    warningStartAt.current = null;
    secLeft.current        = Math.floor(WARNING_MS / 1000);
    setWarning(false);
    setSecondsLeft(secLeft.current);
    if (userIdRef.current) {
      lastActivityAt.current = Date.now();
      idleTimer.current = setTimeout(startWarning, IDLE_MS);
    }
  }, [clearTimers, startWarning]);

  // ── Page Visibility handler ──────────────────────────────────────────────
  const handleVisibilityChange = useCallback(() => {
    if (!userIdRef.current) return;

    if (document.visibilityState === "hidden") {
      // Tab going into background — timers will be throttled/frozen.
      // Just clear them; wall-clock refs are already up to date.
      clearTimers();
      return;
    }

    // Tab became visible again — calculate actual elapsed time.
    const now = Date.now();

    if (inWarning.current && warningStartAt.current !== null) {
      // We were already in the warning phase when hidden.
      const elapsed  = now - warningStartAt.current;
      const remaining = Math.max(0, Math.floor((WARNING_MS - elapsed) / 1000));
      if (remaining <= 0) {
        releaseAndSignOut();
        return;
      }
      // Resume the countdown from the correct remaining time.
      secLeft.current = remaining;
      setSecondsLeft(remaining);
      countdown.current = setInterval(() => {
        const e = Date.now() - (warningStartAt.current ?? now);
        const r = Math.max(0, Math.floor((WARNING_MS - e) / 1000));
        secLeft.current = r;
        setSecondsLeft(r);
        if (r <= 0) releaseAndSignOut();
      }, 1000);
      return;
    }

    // We were in the normal idle phase when hidden.
    const idleElapsed = now - lastActivityAt.current;

    if (idleElapsed >= IDLE_MS + WARNING_MS) {
      // Been idle longer than the full idle + warning window → sign out now.
      releaseAndSignOut();
    } else if (idleElapsed >= IDLE_MS) {
      // Past the idle threshold → jump straight into the warning.
      const alreadyIntoWarning = idleElapsed - IDLE_MS;
      warningStartAt.current = now - alreadyIntoWarning; // backdate anchor
      startWarning();
      // Correct the displayed seconds immediately
      const remaining = Math.max(0, Math.floor((WARNING_MS - alreadyIntoWarning) / 1000));
      secLeft.current = remaining;
      setSecondsLeft(remaining);
    } else {
      // Still within the idle window — restart the remaining idle time.
      const remaining = IDLE_MS - idleElapsed;
      idleTimer.current = setTimeout(startWarning, remaining);
    }
  }, [clearTimers, releaseAndSignOut, startWarning]);
  // ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!userId) {
      clearTimers();
      inWarning.current = false;
      setWarning(false);
      return;
    }

    const onActivity = () => resetIdleTimerRef.current();
    const POINTER_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart"] as const;
    POINTER_EVENTS.forEach(e => document.addEventListener(e, onActivity, { passive: true }));
    window.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    lastActivityAt.current = Date.now();
    idleTimer.current = setTimeout(startWarning, IDLE_MS);

    return () => {
      POINTER_EVENTS.forEach(e => document.removeEventListener(e, onActivity));
      window.removeEventListener("scroll", onActivity, { capture: true });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimers();
    };
  }, [userId, clearTimers, startWarning, handleVisibilityChange]);

  return { warning, secondsLeft, stayLoggedIn, releaseAndSignOut };
}