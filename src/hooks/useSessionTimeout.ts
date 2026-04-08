// src/hooks/useSessionTimeout.ts  — DEBUG VERSION
// Remove the console.logs once working
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabase";

const IDLE_MS    = 60_000;       // ← 15s for testing (change back to 60_000)
const WARNING_MS = 5*60_000;       // ← 30s for testing (change back to 5 * 60_000)

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

  const userIdRef    = useRef(userId);
  const onSignOutRef = useRef(onSignOut);
  useEffect(() => { userIdRef.current    = userId;    }, [userId]);
  useEffect(() => { onSignOutRef.current = onSignOut; }, [onSignOut]);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) { clearTimeout(idleTimer.current);  idleTimer.current = null; }
    if (countdown.current) { clearInterval(countdown.current); countdown.current = null; }
  }, []);

  const releaseAndSignOut = useCallback(async () => {
    console.log("[SessionTimeout] AUTO SIGN-OUT triggered");
    clearTimers();
    const uid = userIdRef.current;
    if (uid) await supabase.from("test_locks").delete().eq("user_id", uid);
    await onSignOutRef.current();
  }, [clearTimers]);

  const startWarning = useCallback(() => {
    console.log("[SessionTimeout] startWarning() called — showing modal");
    inWarning.current = true;
    secLeft.current   = Math.floor(WARNING_MS / 1000);
    setWarning(true);
    setSecondsLeft(secLeft.current);

    countdown.current = setInterval(() => {
      secLeft.current -= 1;
      console.log("[SessionTimeout] countdown tick:", secLeft.current);
      setSecondsLeft(secLeft.current);
      if (secLeft.current <= 0) releaseAndSignOut();
    }, 1000);
  }, [releaseAndSignOut]);

  const resetIdleTimer = useCallback(() => {
    if (inWarning.current) return;
    clearTimers();
    idleTimer.current = setTimeout(startWarning, IDLE_MS);
  }, [clearTimers, startWarning]);

  // Always-fresh ref — no stale closure in listener
  const resetIdleTimerRef = useRef(resetIdleTimer);
  useEffect(() => { resetIdleTimerRef.current = resetIdleTimer; }, [resetIdleTimer]);

  const stayLoggedIn = useCallback(() => {
    console.log("[SessionTimeout] stayLoggedIn() called");
    clearTimers();
    inWarning.current = false;
    secLeft.current   = Math.floor(WARNING_MS / 1000);
    setWarning(false);
    setSecondsLeft(secLeft.current);
    if (userIdRef.current) idleTimer.current = setTimeout(startWarning, IDLE_MS);
  }, [clearTimers, startWarning]);

  useEffect(() => {
    if (!userId) {
      console.log("[SessionTimeout] No userId — hook inactive");
      clearTimers();
      inWarning.current = false;
      setWarning(false);
      return;
    }

    console.log("[SessionTimeout] Activated for userId:", userId,
      `— idle timeout: ${IDLE_MS/1000}s, warning: ${WARNING_MS/1000}s`);

    const onActivity = () => resetIdleTimerRef.current();

    const POINTER_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart"] as const;
    POINTER_EVENTS.forEach(e => document.addEventListener(e, onActivity, { passive: true }));
    window.addEventListener("scroll", onActivity, { passive: true, capture: true });

    idleTimer.current = setTimeout(startWarning, IDLE_MS);
    console.log("[SessionTimeout] Initial idle timer started");

    return () => {
      console.log("[SessionTimeout] Cleanup — removing listeners");
      POINTER_EVENTS.forEach(e => document.removeEventListener(e, onActivity));
      window.removeEventListener("scroll", onActivity, { capture: true });
      clearTimers();
    };
  }, [userId, clearTimers, startWarning]);

  return { warning, secondsLeft, stayLoggedIn, releaseAndSignOut };
}