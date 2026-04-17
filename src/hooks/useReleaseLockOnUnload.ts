// src/hooks/useReleaseLockOnUnload.ts
import { useEffect, useRef } from "react";
import { supabase } from "../supabase";

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 s  (must be < 90 s TTL above)

// Module-level token cache — always reflects the latest auth state,
// so it's synchronously readable inside beforeunload without a Promise.
let _cachedToken: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  _cachedToken = session?.access_token ?? null;
});
// Seed from the stored session immediately (resolves from localStorage cache)
supabase.auth.getSession().then(({ data: { session } }) => {
  _cachedToken = session?.access_token ?? null;
});

const useReleaseLockOnUnload = (moduleTestId: string, userId: string) => {
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!moduleTestId || !userId) return;

    // ── Heartbeat ────────────────────────────────────────────────────────
    // Keeps last_heartbeat fresh so Supabase can auto-expire abandoned locks.
    const sendHeartbeat = () => {
      supabase.rpc("update_lock_heartbeat", {
        p_module_test_id: moduleTestId,
        p_user_id:        userId,
      });
    };

    sendHeartbeat(); // immediate ping on mount
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    // ── Best-effort fast-path release on tab close ───────────────────────
    // Uses the module-level cached token — no async needed.
    const releaseLock = () => {
      const token = _cachedToken;
      if (!token) return;

      // Primary: keepalive fetch (DELETE)
      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/testlock` +
        `?module_test_id=eq.${moduleTestId}&user_id=eq.${userId}`,
        {
          method:    "DELETE",
          keepalive: true,
          headers: {
            "apikey":        import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${token}`,
            "Content-Type":  "application/json",
          },
        }
      ).catch(() => {
        // Fallback: sendBeacon to an RPC endpoint (POST only, no body needed
        // beyond the JSON args). Works where keepalive DELETE is blocked.
        navigator.sendBeacon?.(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/release_lock_beacon`,
          new Blob(
            [JSON.stringify({ p_module_test_id: moduleTestId, p_user_id: userId })],
            { type: "application/json" }
          )
        );
      });
    };

    window.addEventListener("beforeunload", releaseLock);
    window.addEventListener("pagehide",     releaseLock); // iOS Safari

    return () => {
      window.removeEventListener("beforeunload", releaseLock);
      window.removeEventListener("pagehide",     releaseLock);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);

      // Normal unmount (navigation away inside the app) — use the Supabase
      // client normally; no keepalive tricks needed here.
      supabase
        .from("testlock")
        .delete()
        .eq("module_test_id", moduleTestId)
        .eq("user_id", userId);
    };
  }, [moduleTestId, userId]);
};

export default useReleaseLockOnUnload;